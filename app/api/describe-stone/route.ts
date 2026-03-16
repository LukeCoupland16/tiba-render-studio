// Describe a stone material photo in plain English (called automatically after upload)
// POST { stoneBase64, stoneMimeType }
// Returns { description: string }

import { NextRequest, NextResponse } from "next/server";
import { describeStone } from "@/lib/gemini";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      stoneBase64?: string;
      stoneMimeType?: string;
    };

    const { stoneBase64, stoneMimeType = "image/jpeg" } = body;

    if (!stoneBase64) {
      return NextResponse.json(
        { error: "No stone image provided." },
        { status: 400 }
      );
    }

    const description = await describeStone(stoneBase64, stoneMimeType);
    return NextResponse.json({ description });
  } catch (err) {
    console.error("[Describe Stone]", err);
    return NextResponse.json(
      { description: "Natural stone material." }, // graceful fallback
      { status: 200 }
    );
  }
}
