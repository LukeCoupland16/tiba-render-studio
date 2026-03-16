// Stage 4: Final high-quality render using the primary (first) surface material
// POST {
//   screenshotBase64, screenshotMimeType,
//   baseRenderBase64, baseRenderMimeType,
//   surfaces: Array<{ label, description, materialBase64, materialMimeType }>,
//   scale: "small" | "medium" | "large"
// }
// Returns { finalBase64, finalMimeType }

import { NextRequest, NextResponse } from "next/server";
import { generateImage, describeStone } from "@/lib/gemini";
import { stage4Prompt, SCALE_MODIFIERS } from "@/lib/prompts";
import type { RenderOptions } from "@/lib/types";

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
      renderOptions?: RenderOptions;
    };

    const {
      screenshotBase64,
      screenshotMimeType = "image/png",
      baseRenderBase64,
      baseRenderMimeType = "image/png",
      surfaces = [],
      scale = "medium",
      renderOptions,
    } = body;

    if (!screenshotBase64 || !baseRenderBase64 || surfaces.length === 0) {
      return NextResponse.json({ error: "Missing required data." }, { status: 400 });
    }

    // Use the first (largest/primary) surface material as the reference image
    const primaryMaterial = surfaces[0];
    const stoneDescription = await describeStone(
      primaryMaterial.materialBase64,
      primaryMaterial.materialMimeType
    );

    const scaleModifier = SCALE_MODIFIERS[scale];
    const prompt = stage4Prompt(
      surfaces.map((s) => ({ label: s.label, description: s.description })),
      stoneDescription,
      scaleModifier,
      renderOptions
    );

    const result = await generateImage(
      prompt,
      [
        { data: screenshotBase64, mimeType: screenshotMimeType },
        { data: baseRenderBase64, mimeType: baseRenderMimeType },
        { data: primaryMaterial.materialBase64, mimeType: primaryMaterial.materialMimeType },
      ],
      true // pro model for final bake
    );

    return NextResponse.json({
      finalBase64: result.data,
      finalMimeType: result.mimeType,
    });
  } catch (err) {
    console.error("[Stage 4]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Final render failed." },
      { status: 500 }
    );
  }
}
