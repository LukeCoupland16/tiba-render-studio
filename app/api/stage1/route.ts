// Stage 1: Convert a SketchUp screenshot → photorealistic base render
// POST { screenshotBase64, screenshotMimeType }
// Returns { baseRenderBase64, baseRenderMimeType }

import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini";
import { stage1Prompt } from "@/lib/prompts";

export const maxDuration = 60; // allow up to 5 min on Vercel Pro

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      screenshotBase64?: string;
      screenshotMimeType?: string;
    };

    const { screenshotBase64, screenshotMimeType = "image/png", feedback } =
      body as { screenshotBase64?: string; screenshotMimeType?: string; feedback?: string };

    if (!screenshotBase64) {
      return NextResponse.json(
        { error: "No screenshot provided." },
        { status: 400 }
      );
    }

    const result = await generateImage(
      stage1Prompt(feedback),
      [{ data: screenshotBase64, mimeType: screenshotMimeType }],
      false // use fast model for base render
    );

    return NextResponse.json({
      baseRenderBase64: result.data,
      baseRenderMimeType: result.mimeType,
    });
  } catch (err) {
    console.error("[Stage 1]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong generating the base render.",
      },
      { status: 500 }
    );
  }
}
