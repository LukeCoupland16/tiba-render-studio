// ─────────────────────────────────────────────────────────────────────────────
// All AI prompts used in the render pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import type { RenderOptions } from "@/lib/types";

export const STRUCTURE_INSTRUCTION = `CRITICAL STRUCTURE INSTRUCTION: The architectural space in this render MUST be structurally identical to the reference SketchUp screenshot. Preserve the exact position of every wall, opening, ceiling, floor plane, and furniture element. Do not add, remove, or relocate any architectural element. Treat the SketchUp geometry as non-negotiable spatial boundaries. You are only permitted to apply photorealistic materials, textures, and lighting within the existing structure — not to alter it.

CRITICAL ASPECT RATIO INSTRUCTION: The output image MUST have the EXACT same aspect ratio and orientation as the input SketchUp screenshot. If the input is landscape, the output MUST be landscape. If the input is portrait, the output MUST be portrait. Do NOT crop, pad, or change the aspect ratio under any circumstances. Match the input dimensions exactly.`;

export const STYLE_BLOCK = `Aesthetic requirements:
- Wide dynamic range, 24–35mm prime lens feel, filmic white balance
- Photorealistic — not CGI, not 3D visualization`;

// ── Stage 1: Convert SketchUp screenshot → photorealistic base render ─────────
export function stage1Prompt(feedback?: string): string {
  const feedbackBlock = feedback?.trim()
    ? `\n\nThe user reviewed a previous version and requested these corrections:\n"${feedback.trim()}"\nPlease address these points carefully while still following all structural constraints above.`
    : "";

  return `${STRUCTURE_INSTRUCTION}

Convert this SketchUp architectural screenshot into a photorealistic interior render. Use neutral, clean materials on all surfaces — no stone yet. Capture the space as a blank canvas ready for material application.

${STYLE_BLOCK}

Maintain all spatial relationships exactly as shown in the SketchUp model.${feedbackBlock}`;
}

// ── Stage 2: Detect surfaces in the base render ───────────────────────────────
export function stage2Prompt(): string {
  return `Analyze this architectural render and identify every visually distinct surface region — walls, floors, ceilings, joinery, furniture faces, countertops, stairs, cladding, and any other surface that occupies meaningful space.

For each surface provide:
- label: invent a short, descriptive hyphenated slug that captures BOTH the material you see AND its location/role — e.g. "timber-floor", "white-plaster-wall-rear", "dark-granite-island-top", "oak-cabinet-doors", "concrete-ceiling", "marble-backsplash". Do NOT use a fixed list — describe what you actually see.
- description: one plain-English sentence describing exactly where it is in the scene (e.g. "The large plastered wall running across the back of the living room")
- areaPercent: your estimate of what percentage of the total image this surface occupies (integer, round to nearest whole number)
- suitable: true always — every surface is a candidate for material swapping
Include every surface that occupies at least 3% of the image. Do not pre-filter by whether stone would look good — include everything visible.

Respond ONLY with valid JSON — no markdown, no explanation, just the JSON:
{
  "surfaces": [
    {
      "label": "timber-floor",
      "description": "Hardwood timber floor covering the main living area",
      "areaPercent": 28,
      "suitable": true
    }
  ]
}`;
}

// ── Stage 3: Apply stone to one surface (preview, 512px) ──────────────────────
export function stage3Prompt(
  surfaceLabel: string,
  surfaceDescription: string,
  materialDescription: string,
  scaleModifier: string
): string {
  return `${STRUCTURE_INSTRUCTION}

You are viewing three reference images:
1. The original SketchUp architectural screenshot — this is the spatial blueprint. Do NOT alter any geometry.
2. A photorealistic base render of the same space — use this for lighting and scene reference.
3. A material sample photo — apply this material to the target surface.

Task: Generate a preview render that applies the material from image 3 ONLY to the ${surfaceLabel} surface (${surfaceDescription}). All other surfaces should remain exactly as shown in the base render.

Material: ${materialDescription}
Pattern/texture scale: ${scaleModifier}

Reproduce the material faithfully — match its colour, texture, finish, and scale exactly as it appears in the reference photo. Maintain photorealistic quality throughout. Keep the rest of the scene identical to the base render.`;
}

// ── Render option label maps ──────────────────────────────────────────────────

const LIGHTING_LABELS: Record<string, string> = {
  "natural-daylight": "crisp natural daylight from the existing window openings",
  "golden-hour": "warm golden-hour sunlight at a low angle, casting long soft shadows",
  "overcast": "soft overcast light — fully diffused, shadow-free, even exposure",
  "dramatic-spotlight": "dramatic architectural spotlighting with high contrast and deep shadows",
  "candlelight": "warm candlelight and ambient glow from low-level artificial sources",
  "blue-hour": "blue-hour dusk with a cool exterior sky and warm interior artificial lighting",
  "night-interior": "night scene lit entirely by artificial interior lighting — recessed, pendant, and accent",
};

const TIME_LABELS: Record<string, string> = {
  "morning": "early morning — pale cool light, gentle shadows, dew-fresh atmosphere",
  "midday": "midday — high sun, neutral bright light, minimal shadows",
  "afternoon": "late afternoon — warm directional light, medium-length shadows",
  "evening": "evening — golden low sun transitioning to artificial interior warmth",
  "night": "night — dark exterior, all warmth from interior artificial lighting",
};

const MOOD_LABELS: Record<string, string> = {
  "bright-airy": "bright and airy — high key, open, fresh, and spacious feeling",
  "warm-cosy": "warm and cosy — amber tones, intimate, inviting, hearth-like atmosphere",
  "moody-dramatic": "moody and dramatic — high contrast, deep shadows, cinematic tension",
  "clean-minimal": "clean and minimal — crisp whites, controlled palette, architectural magazine aesthetic",
  "luxurious-opulent": "luxurious and opulent — rich materials, deep tones, five-star hotel feel",
  "rustic-natural": "rustic and natural — earthy tones, organic textures, relaxed warmth",
};

const CAMERA_LABELS: Record<string, string> = {
  "wide-angle": "wide-angle overview — 24mm feel, maximum spatial context, slightly elevated viewpoint",
  "standard": "standard perspective — 35mm feel, natural human eye-level viewpoint",
  "intimate": "intimate close-up — 50mm feel, focused on a key feature or material detail",
};

function buildRenderOptionsBlock(opts: RenderOptions): string {
  const locationLine = opts.location
    ? `\n- Location: The space is situated in ${opts.location} — reflect the regional light quality, landscape character, and architectural vernacular typical of this area. Any exterior views, window light colour temperature, and surrounding context should feel authentic to this location.`
    : "";
  return `Render direction:
- Lighting: ${LIGHTING_LABELS[opts.lightingStyle] ?? opts.lightingStyle}
- Time of day: ${TIME_LABELS[opts.timeOfDay] ?? opts.timeOfDay}
- Mood: ${MOOD_LABELS[opts.mood] ?? opts.mood}
- Camera style: ${CAMERA_LABELS[opts.cameraStyle] ?? opts.cameraStyle}${locationLine}`;
}

// ── Stage 4: Sequential per-surface bake — one material per call ─────────────
// Each call applies ONE surface's material on top of the accumulated render state.
export function stage4SurfaceStepPrompt(
  surfaceLabel: string,
  surfaceDescription: string,
  materialDescription: string,
  scaleModifier: string,
  renderOptions?: RenderOptions
): string {
  const optionsBlock = renderOptions
    ? `\n${buildRenderOptionsBlock(renderOptions)}\n`
    : "";

  return `${STRUCTURE_INSTRUCTION}

You are viewing three reference images:
1. The original SketchUp architectural screenshot — this is the spatial blueprint. Do NOT alter any geometry.
2. The current render state — preserve all existing materials and surfaces exactly as shown.
3. A material sample photo — apply this material to the target surface only.

Task: Apply the material from image 3 ONLY to the ${surfaceLabel} surface (${surfaceDescription}). All other surfaces must remain exactly as shown in image 2.

Material: ${materialDescription}
Pattern/texture scale: ${scaleModifier}
${optionsBlock}${STYLE_BLOCK}

Push quality to the maximum. Reproduce the material faithfully — match its colour, texture, finish, and scale exactly as it appears in the reference photo.`;
}

// ── Stage 1 Variant: Inspired by reference images ────────────────────────────
// referenceNotes: array of { note } for each reference image supplied
export function stage1VariantPrompt(
  referenceNotes: Array<{ note: string }>,
  variantLabel: "A" | "B"
): string {
  const notesBlock = referenceNotes
    .map((r, i) => `  Reference image ${i + 1}: Draw inspiration from — "${r.note}"`)
    .join("\n");

  const variantDirection =
    variantLabel === "A"
      ? "Focus on proportions, spatial rhythm, and material palette from the reference images. Lean toward a faithful interpretation of the reference style."
      : "Take a more creative interpretation — use the reference images as a loose starting point but push the design further with bolder material choices, contrast, or atmosphere.";

  return `${STRUCTURE_INSTRUCTION}

You are viewing multiple images:
1. The first image is the original SketchUp architectural screenshot — this is the spatial blueprint. Do NOT alter any geometry.
2. The remaining images are reference renders/photos for design inspiration.

Task: Convert the SketchUp screenshot into a photorealistic interior render. Use the reference images for inspiration on proportions, form, material choices, colour palette, and overall style — but preserve the exact architectural geometry from the SketchUp model.

Inspiration notes for each reference:
${notesBlock}

Variant direction: ${variantDirection}

${STYLE_BLOCK}

Maintain all spatial relationships exactly as shown in the SketchUp model. Apply photorealistic materials inspired by the references — not identical copies, but clearly drawing from their character and mood.`;
}

// ── Stage 1 Combine: Merge best elements from variants ───────────────────────
export function stage1CombinePrompt(feedback: string): string {
  return `${STRUCTURE_INSTRUCTION}

You are viewing multiple images:
1. The original SketchUp architectural screenshot — this is the spatial blueprint. Do NOT alter any geometry.
2. Variant "Standard" — a clean neutral base render.
3. Variant "A" — a reference-inspired render.
4. Variant "B" — a second reference-inspired render.

Task: Generate a final combined base render that takes the best elements from each variant based on the user's feedback below. The result should be a cohesive, photorealistic interior render that preserves the exact SketchUp geometry.

User's combination instructions:
"${feedback.trim()}"

${STYLE_BLOCK}

Merge the specified elements seamlessly — unified lighting, consistent material transitions, and a single cohesive atmosphere. This combined render will be the base for subsequent material application.`;
}

// ── Scale modifier lookup ─────────────────────────────────────────────────────
export const SCALE_MODIFIERS = {
  small:
    "small pattern scale — tight, repeating texture where the pattern unit is small relative to the surface area",
  medium:
    "medium pattern scale — natural tile or slab sizing, pattern flows at a scale consistent with standard architectural use",
  large:
    "large pattern scale — oversized, dramatic pattern where each unit spans a substantial portion of the surface",
} as const;
