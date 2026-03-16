// ─────────────────────────────────────────────────────────────────────────────
// All AI prompts used in the render pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import type { RenderOptions } from "@/lib/types";

export const STRUCTURE_INSTRUCTION = `CRITICAL STRUCTURE INSTRUCTION: The architectural space in this render MUST be structurally identical to the reference SketchUp screenshot. Preserve the exact position of every wall, opening, ceiling, floor plane, and furniture element. Do not add, remove, or relocate any architectural element. Treat the SketchUp geometry as non-negotiable spatial boundaries. You are only permitted to apply photorealistic materials, textures, and lighting within the existing structure — not to alter it.`;

export const STYLE_BLOCK = `Aesthetic requirements:
- Luminous directional natural light from existing window openings
- Warm neutrals as architectural base; stone carries visual character
- Wide dynamic range, 24–35mm prime lens feel, filmic white balance
- Photorealistic — not CGI, not 3D visualization
- Rich stone micro-contrast, polished high-gloss finish where appropriate`;

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

// ── Stage 4: Final high-quality composite bake ────────────────────────────────
export function stage4Prompt(
  surfaceList: Array<{ label: string; description: string }>,
  materialDescription: string,
  scaleModifier: string,
  renderOptions?: RenderOptions
): string {
  const surfaces = surfaceList
    .map((s) => `  - ${s.label}: ${s.description}`)
    .join("\n");

  const optionsBlock = renderOptions
    ? `\n${buildRenderOptionsBlock(renderOptions)}\n`
    : "";

  return `${STRUCTURE_INSTRUCTION}

You are viewing three reference images:
1. The original SketchUp architectural screenshot — this is the spatial blueprint. Do NOT alter any geometry.
2. A photorealistic base render of the same space — use for lighting, scene, and atmosphere reference.
3. The material sample photo — this is the material to apply.

Task: Generate the final, maximum-quality photorealistic render applying the material to ALL of these surfaces simultaneously:
${surfaces}

Material: ${materialDescription}
Pattern/texture scale: ${scaleModifier}
${optionsBlock}
${STYLE_BLOCK}

This is the final deliverable — push quality to the maximum. Reproduce the material faithfully on every listed surface — match its colour, texture, finish, and scale exactly as it appears in the reference photo.`;
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
