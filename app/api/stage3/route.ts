// Stage 3: Generate texture swap previews — one per surface, each with its own material
// POST {
//   screenshotBase64, screenshotMimeType,
//   baseRenderBase64, baseRenderMimeType,
//   surfaces: Array<{ label, description, materialBase64, materialMimeType, stoneDescription }>,
//   scale: "small" | "medium" | "large"
// }
// Returns { previews: Array<{ surface, base64, mimeType }> }

import { NextRequest, NextResponse } from "next/server";
import { generateImage, describeStone } from "@/lib/gemini";
import { stage3Prompt, SCALE_MODIFIERS } from "@/lib/prompts";

export const maxDuration = 60;

interface SurfaceInput {
  label: string;
  description: string;
  materialBase64: string;
  materialMimeType: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      screenshotBase64?: string;
      screenshotMimeType?: string;
      baseRenderBase64?: string;
      baseRenderMimeType?: string;
      surfaces?: SurfaceInput[];
      scale?: "small" | "medium" | "large";
    };

    const {
      screenshotBase64,
      screenshotMimeType = "image/png",
      baseRenderBase64,
      baseRenderMimeType = "image/png",
      surfaces = [],
      scale = "medium",
    } = body;

    if (!screenshotBase64 || !baseRenderBase64) {
      return NextResponse.json({ error: "Missing required images." }, { status: 400 });
    }
    if (surfaces.length === 0) {
      return NextResponse.json({ error: "No surfaces provided." }, { status: 400 });
    }

    const scaleModifier = SCALE_MODIFIERS[scale];

    // Describe each stone material, then fire all previews in parallel
    const results = await Promise.all(
      surfaces.map(async (surface) => {
        const stoneDescription = await describeStone(
          surface.materialBase64,
          surface.materialMimeType
        );

        const prompt = stage3Prompt(
          surface.label,
          surface.description,
          stoneDescription,
          scaleModifier
        );

        const result = await generateImage(
          prompt,
          [
            { data: screenshotBase64, mimeType: screenshotMimeType },
            { data: baseRenderBase64, mimeType: baseRenderMimeType },
            { data: surface.materialBase64, mimeType: surface.materialMimeType },
          ],
          false
        );

        return {
          surface: surface.label,
          base64: result.data,
          mimeType: result.mimeType,
        };
      })
    );

    return NextResponse.json({ previews: results });
  } catch (err) {
    console.error("[Stage 3]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Preview generation failed." },
      { status: 500 }
    );
  }
}
