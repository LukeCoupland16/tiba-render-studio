// ─────────────────────────────────────────────────────────────────────────────
// Gemini image generation client (uses REST API directly for reliability)
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageInput {
  data: string;    // base64 encoded
  mimeType: string;
}

export interface GeneratedImage {
  data: string;    // base64 encoded
  mimeType: string;
}

// Call Gemini to generate an image.
// images: array of reference images (up to 3), sent in order before the prompt.
// usePro: true → use the pro/final-quality model, false → use the fast preview model.
export async function generateImage(
  prompt: string,
  images: ImageInput[],
  usePro = false
): Promise<GeneratedImage> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set in .env.local");

  const flashModel =
    process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp-image-generation";
  const proModel =
    process.env.GEMINI_PRO_MODEL || "gemini-2.0-flash-exp-image-generation";
  const model = usePro ? proModel : flashModel;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const aspectRatioReminder = "IMPORTANT: Output image MUST match the exact same aspect ratio and orientation (landscape/portrait) as the first input image. Do NOT crop or change dimensions.";

  const parts: unknown[] = [
    ...images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    })),
    { text: `${prompt}\n\n${aspectRatioReminder}` },
  ];

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature: 0.5,
      topP: 0.95,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // No timeout here — Next.js handles that via maxDuration on the route
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const responseParts: unknown[] =
    (json as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
      .candidates?.[0]?.content?.parts ?? [];

  for (const part of responseParts) {
    const p = part as { inlineData?: { data?: string; mimeType?: string } };
    if (p.inlineData?.data) {
      return {
        data: p.inlineData.data,
        mimeType: p.inlineData.mimeType ?? "image/png",
      };
    }
  }

  // Capture any text from Gemini in the error for debugging
  const textPart = responseParts.find(
    (p) => typeof (p as { text?: string }).text === "string"
  ) as { text?: string } | undefined;
  throw new Error(
    `Gemini returned no image. Model response: ${textPart?.text ?? "(no text)"}`
  );
}

// Analyse a material photo and return a plain-English description for use in render prompts.
export async function describeStone(
  materialBase64: string,
  materialMimeType: string
): Promise<string> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY is not set in .env.local");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: materialMimeType as string, data: materialBase64 } },
          {
            text: `Describe this surface material in one sentence that captures its appearance precisely enough to reproduce it in an architectural render.
Include: material type, dominant colour, texture/pattern character, and finish (e.g. matte, gloss, rough, smooth).
Examples:
- "Cream-white marble with fine grey veining and a polished high-gloss finish."
- "Warm oak timber with straight grain and a satin lacquer finish."
- "Dark charcoal concrete with a raw, slightly textured matte surface."
- "Forest green ceramic tile with a crackle glaze and satin sheen."
Only output the single sentence, nothing else.`,
          },
        ],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini describe error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const text =
    (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      .candidates?.[0]?.content?.parts?.[0]?.text ?? "Natural stone.";

  return text.trim();
}
