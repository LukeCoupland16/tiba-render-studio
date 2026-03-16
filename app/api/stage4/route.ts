// Stage 4: Apply one surface's material to the accumulated render state.
// The frontend drives the sequential loop, calling this once per surface and
// passing the previous result as runningBase. describeStone is called by the
// frontend via /api/describe-stone before each call here.
//
// POST {
//   screenshotBase64, screenshotMimeType,
//   runningBase64, runningMimeType,
//   surface: { label, description, materialBase64, materialMimeType },
//   materialDescription: string,
//   scale: "small" | "medium" | "large",
//   renderOptions?: RenderOptions
// }
// Returns { base64, mimeType }

import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini";
import { stage4SurfaceStepPrompt, SCALE_MODIFIERS } from "@/lib/prompts";
import type { RenderOptions } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      screenshotBase64?: string;
      screenshotMimeType?: string;
      runningBase64?: string;
      runningMimeType?: string;
      surface?: { label: string; description: string; materialBase64: string; materialMimeType: string };
      materialDescription?: string;
      scale?: "small" | "medium" | "large";
      renderOptions?: RenderOptions;
    };

    const {
      screenshotBase64,
      screenshotMimeType = "image/png",
      runningBase64,
      runningMimeType = "image/png",
      surface,
      materialDescription = "Natural stone material.",
      scale = "medium",
      renderOptions,
    } = body;

    if (!screenshotBase64 || !runningBase64 || !surface) {
      return NextResponse.json({ error: "Missing required data." }, { status: 400 });
    }

    const scaleModifier = SCALE_MODIFIERS[scale];
    const prompt = stage4SurfaceStepPrompt(
      surface.label,
      surface.description,
      materialDescription,
      scaleModifier,
      renderOptions
    );

    const result = await generateImage(
      prompt,
      [
        { data: screenshotBase64, mimeType: screenshotMimeType },         // slot 1: spatial blueprint
        { data: runningBase64, mimeType: runningMimeType },               // slot 2: accumulated render state
        { data: surface.materialBase64, mimeType: surface.materialMimeType }, // slot 3: this surface's material
      ],
      true // pro model for final bake
    );

    return NextResponse.json({ base64: result.data, mimeType: result.mimeType });
  } catch (err) {
    console.error("[Stage 4]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Final render failed." },
      { status: 500 }
    );
  }
}
