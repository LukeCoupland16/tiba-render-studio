// Stage 2: Detect surfaces in the base render using Gemini vision
// POST { baseRenderBase64, baseRenderMimeType }
// Returns { surfaces: Surface[] }

import { NextRequest, NextResponse } from "next/server";
import { stage2Prompt } from "@/lib/prompts";
import type { Surface } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      baseRenderBase64?: string;
      baseRenderMimeType?: string;
    };

    const { baseRenderBase64, baseRenderMimeType = "image/png" } = body;

    if (!baseRenderBase64) {
      return NextResponse.json(
        { error: "No base render provided." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set in .env.local");

    // Use Gemini Flash for vision/text analysis (no image output needed here)
    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: baseRenderMimeType, data: baseRenderBase64 } },
            { text: stage2Prompt() },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              surfaces: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    label:       { type: "STRING" },
                    description: { type: "STRING" },
                    areaPercent: { type: "INTEGER" },
                    suitable:    { type: "BOOLEAN" },
                  },
                  required: ["label", "description", "areaPercent", "suitable"],
                },
              },
            },
            required: ["surfaces"],
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini vision error (${res.status}): ${errText}`);
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Structured output mode guarantees valid JSON — parse directly
    let surfaces: Surface[] = [];
    try {
      const parsed = JSON.parse(rawText) as { surfaces?: Surface[] };
      surfaces = parsed.surfaces ?? [];
    } catch (parseErr) {
      console.error("[Stage 2] parse error:", parseErr);
      console.error("[Stage 2] raw (first 800):", rawText.slice(0, 800));
      throw new Error("Surface detection returned unexpected data. Try again.");
    }

    // Show all surfaces (user decides which to change), sort by area descending
    const filtered = surfaces
      .filter((s) => s.areaPercent >= 3)
      .sort((a, b) => b.areaPercent - a.areaPercent);

    return NextResponse.json({ surfaces: filtered });
  } catch (err) {
    console.error("[Stage 2]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong analysing the surfaces.",
      },
      { status: 500 }
    );
  }
}
