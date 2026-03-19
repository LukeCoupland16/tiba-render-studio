/**
 * API Route: /api/hybrid-model
 *
 * Takes architectural drawing images (or PDF pages) + measurements
 * and uses Gemini vision to produce a structured 3D model description.
 *
 * Supports:
 * - Single floor plan image
 * - Multiple images (floor plan + sections + roof plan)
 * - PDF upload (all pages rendered and sent to AI)
 */

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { aiModelToFloorPlan, type AIModelDescription } from "@/lib/dxf/hybrid-model";
import { DEFAULT_V3_CONFIG } from "@/lib/types-v3";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { images, pdfBase64, measurements, buildingWidth, buildingDepth } = body;

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Collect all image parts for Gemini
    let imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    if (pdfBase64) {
      // Render PDF pages to images using pymupdf
      const allPages = await renderPdfPages(pdfBase64);

      // Send key pages to keep payload manageable:
      // Page 1 (floor plan) + up to 2 section pages (the most informative ones)
      // Sections are typically pages 3+ and are smaller/simpler
      const selectedPages: string[] = [];
      if (allPages.length > 0) selectedPages.push(allPages[0]); // floor plan
      if (allPages.length > 2) selectedPages.push(allPages[2]); // section A (or first section)
      if (allPages.length > 4) selectedPages.push(allPages[4]); // section C (full width cut)
      // If only 2 pages, send both
      if (allPages.length === 2) selectedPages.push(allPages[1]);

      console.log(`[hybrid-model] PDF: ${allPages.length} pages rendered, sending ${selectedPages.length} to AI`);

      imageParts = selectedPages.map((img) => ({
        inlineData: { mimeType: "image/png", data: img },
      }));
    } else if (images && images.length > 0) {
      imageParts = images.map((img: { base64: string; mimeType: string }) => ({
        inlineData: { mimeType: img.mimeType, data: img.base64 },
      }));
    } else {
      return NextResponse.json({ error: "Provide either 'images' array or 'pdfBase64'" }, { status: 400 });
    }

    const width = buildingWidth || measurements?.building?.width_m || "42";
    const depth = buildingDepth || measurements?.building?.depth_m || "28";

    // Build prompt for multi-page architectural drawings
    const prompt = buildMultiPagePrompt(width, depth, imageParts.length);

    // Call Gemini 2.5 Flash with all images
    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const parts = [
      ...imageParts,
      { text: prompt },
    ];

    console.log(`[hybrid-model] Sending ${imageParts.length} images to Gemini...`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          maxOutputTokens: 65536,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[hybrid-model] Gemini error:", errText.slice(0, 500));
      return NextResponse.json(
        { error: `Gemini API error (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const json = await res.json();
    const responseParts = (json as any).candidates?.[0]?.content?.parts ?? [];
    const textPart = responseParts.find((p: any) => typeof p.text === "string");

    if (!textPart?.text) {
      return NextResponse.json({ error: "Gemini returned no text response" }, { status: 502 });
    }

    // Parse JSON from response
    let rawText = textPart.text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let aiModel: AIModelDescription;
    try {
      aiModel = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from within the text (Gemini sometimes adds commentary)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          aiModel = JSON.parse(jsonMatch[0]);
        } catch {
          console.error("[hybrid-model] JSON parse error. First 1000 chars:", rawText.slice(0, 1000));
          return NextResponse.json({
            error: "Failed to parse AI model response. The AI may have returned incomplete JSON.",
            rawResponse: rawText.slice(0, 2000),
          }, { status: 502 });
        }
      } else {
        console.error("[hybrid-model] No JSON found. Response:", rawText.slice(0, 1000));
        return NextResponse.json({
          error: "AI did not return valid JSON. Try again or use fewer pages.",
          rawResponse: rawText.slice(0, 2000),
        }, { status: 502 });
      }
    }

    // Convert to FloorPlan
    const floorPlan = aiModelToFloorPlan(aiModel, DEFAULT_V3_CONFIG);

    console.log(`[hybrid-model] Success: ${aiModel.walls.length} walls, ${aiModel.doors.length} doors, ${aiModel.rooms.length} rooms`);

    return NextResponse.json({
      floorPlan,
      aiModel,
      wallCount: aiModel.walls.length,
      doorCount: aiModel.doors.length,
      windowCount: aiModel.windows?.length || 0,
      roomCount: aiModel.rooms.length,
      columnCount: aiModel.columns.length,
    });
  } catch (err) {
    console.error("[hybrid-model] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// ─── PDF Page Rendering ──────────────────────────────────────────────────────

async function renderPdfPages(pdfBase64: string): Promise<string[]> {
  const tempDir = mkdtempSync(join(tmpdir(), "pdf-render-"));

  try {
    // Write PDF to temp file
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    const pdfPath = join(tempDir, "input.pdf");
    writeFileSync(pdfPath, pdfBuffer);

    // Use pymupdf (fitz) to render pages at moderate DPI to keep payload reasonable
    // Gemini can handle multiple images but total size matters
    const script = `
import fitz, sys, os
doc = fitz.open("${pdfPath}")
# Render at 150 DPI — good balance of readability vs size
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=150)
    pix.save(os.path.join("${tempDir}", f"page_{i:02d}.png"))
print(doc.page_count)
`;

    const result = execSync(`python3 -c '${script}'`, {
      timeout: 30000,
      stdio: "pipe",
    });
    const pageCount = parseInt(result.toString().trim());

    // Read rendered pages as base64
    const pages: string[] = [];
    const files = readdirSync(tempDir)
      .filter((f) => f.startsWith("page_") && f.endsWith(".png"))
      .sort();

    for (const file of files) {
      const imgBuffer = readFileSync(join(tempDir, file));
      pages.push(imgBuffer.toString("base64"));
    }

    console.log(`[hybrid-model] Rendered ${pages.length} PDF pages`);
    return pages;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

// ─── Multi-Page Prompt ───────────────────────────────────────────────────────

function buildMultiPagePrompt(
  widthM: string,
  depthM: string,
  imageCount: number,
): string {
  const multiPageContext = imageCount > 1
    ? `You are viewing ${imageCount} pages of an architectural drawing set. These typically include:
- Page 1: LAYOUT/FLOOR PLAN — the main plan view showing walls, doors, rooms, furniture
- Page 2: ROOF PLAN — roof layout with ridge lines, eave lines, overhang edges
- Pages 3+: SECTION drawings — vertical cuts through the building showing heights, ceiling levels, roof profiles

Use ALL pages to build your model:
- Get wall positions, room layout, doors, and windows from the FLOOR PLAN
- Get roof ridge positions and shape from the ROOF PLAN
- Get ceiling heights, wall heights, and roof peak heights from the SECTIONS
`
    : "You are viewing a single floor plan image.";

  return `You are an expert architectural analyst. Analyze these architectural drawings and produce a complete 3D building model description as JSON.

${multiPageContext}

BUILDING DIMENSIONS (these are EXACT, from CAD data):
- Total width: ${widthM}m (X axis, left to right)
- Total depth: ${depthM}m (Y axis, bottom to top)

Coordinate system: origin at bottom-left corner of the building.
X: 0 to ${parseFloat(widthM) * 1000}mm (left to right)
Y: 0 to ${parseFloat(depthM) * 1000}mm (bottom to top)

INSTRUCTIONS:
1. Trace EVERY wall as a line segment (startX, startY → endX, endY) in millimeters
2. Exterior walls: 200mm thick. Interior walls: 150mm thick
3. Mark every door opening (position, width)
4. Mark every window opening (position, width, sill height)
5. Label every room/space you can identify
6. Mark structural columns (regular grid of small squares/circles)
7. From the SECTIONS: extract ceiling heights per room and the roof ridge heights
8. From the ROOF PLAN: identify the main ridge line(s) and their positions

A typical villa has 50-120 wall segments. Be thorough — trace every wall run.

OUTPUT FORMAT — respond ONLY with valid JSON:
{
  "building": { "width": <mm>, "depth": <mm> },
  "walls": [{ "startX": <mm>, "startY": <mm>, "endX": <mm>, "endY": <mm>, "thickness": <mm>, "height": <mm>, "room": "<label>" }],
  "doors": [{ "x": <mm>, "y": <mm>, "width": <mm>, "direction": "<north|south|east|west>" }],
  "windows": [{ "x": <mm>, "y": <mm>, "width": <mm>, "sillHeight": <mm>, "direction": "<north|south|east|west>" }],
  "rooms": [{ "label": "<name>", "centerX": <mm>, "centerY": <mm>, "type": "<interior|exterior|service>" }],
  "columns": [{ "x": <mm>, "y": <mm>, "size": <mm> }],
  "roofRidges": [{ "startX": <mm>, "startY": <mm>, "endX": <mm>, "endY": <mm>, "height": <mm> }],
  "eaveHeight": <mm>
}

Use heights from section drawings when visible. Default ceiling height: 3000mm if not visible in sections.
Respond with ONLY the JSON, no other text.`;
}
