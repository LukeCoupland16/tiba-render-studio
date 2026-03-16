// Stage 1 Combine: Merge best elements from 3 variant renders based on user feedback
// POST { screenshotBase64, screenshotMimeType, variants: [{ base64, mimeType }], feedback }
// Returns { base64, mimeType }

import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini";
import { stage1CombinePrompt } from "@/lib/prompts";
import type { ImageInput } from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      screenshotBase64: string;
      screenshotMimeType?: string;
      variants: Array<{ base64: string; mimeType: string }>;
      feedback: string;
    };

    const {
      screenshotBase64,
      screenshotMimeType = "image/png",
      variants,
      feedback,
    } = body;

    if (!screenshotBase64) {
      return NextResponse.json({ error: "No screenshot provided." }, { status: 400 });
    }

    if (!variants || variants.length < 2) {
      return NextResponse.json({ error: "At least 2 variant renders required." }, { status: 400 });
    }

    if (!feedback?.trim()) {
      return NextResponse.json({ error: "Combination feedback is required." }, { status: 400 });
    }

    // Build image array: screenshot first, then all variant renders
    const images: ImageInput[] = [
      { data: screenshotBase64, mimeType: screenshotMimeType },
      ...variants.map((v) => ({ data: v.base64, mimeType: v.mimeType })),
    ];

    const result = await generateImage(stage1CombinePrompt(feedback), images, true);

    return NextResponse.json({
      base64: result.data,
      mimeType: result.mimeType,
    });
  } catch (err) {
    console.error("[Stage 1 Combine]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong combining the variants.",
      },
      { status: 500 }
    );
  }
}
