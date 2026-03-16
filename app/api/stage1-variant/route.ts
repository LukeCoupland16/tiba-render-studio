// Stage 1 Variant: Generate a reference-inspired photorealistic render
// POST { screenshotBase64, screenshotMimeType, references: [{ base64, mimeType, note }], variantLabel }
// Returns { base64, mimeType }

import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini";
import { stage1VariantPrompt } from "@/lib/prompts";
import type { ImageInput } from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      screenshotBase64: string;
      screenshotMimeType?: string;
      references: Array<{ base64: string; mimeType: string; note: string }>;
      variantLabel: "A" | "B";
    };

    const {
      screenshotBase64,
      screenshotMimeType = "image/png",
      references,
      variantLabel,
    } = body;

    if (!screenshotBase64) {
      return NextResponse.json({ error: "No screenshot provided." }, { status: 400 });
    }

    if (!references || references.length === 0) {
      return NextResponse.json({ error: "No reference images provided." }, { status: 400 });
    }

    // Build image array: screenshot first, then all reference images
    const images: ImageInput[] = [
      { data: screenshotBase64, mimeType: screenshotMimeType },
      ...references.map((r) => ({ data: r.base64, mimeType: r.mimeType })),
    ];

    const prompt = stage1VariantPrompt(
      references.map((r) => ({ note: r.note })),
      variantLabel
    );

    const result = await generateImage(prompt, images, true);

    return NextResponse.json({
      base64: result.data,
      mimeType: result.mimeType,
    });
  } catch (err) {
    console.error("[Stage 1 Variant]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong generating the variant render.",
      },
      { status: 500 }
    );
  }
}
