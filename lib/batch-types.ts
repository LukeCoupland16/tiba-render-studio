// ─────────────────────────────────────────────────────────────────────────────
// Types for the batch render flow
// ─────────────────────────────────────────────────────────────────────────────

import type { Framing } from "@/lib/prompts";

export interface BatchRenderSlot {
  id: string;                // e.g. "base-standard", "ref1-grand"
  label: string;             // display name e.g. "Base — Standard"
  type: "base" | "variant";  // which API to call
  framing: Framing;
  referenceIndex?: number;   // which reference image (0, 1, 2) — only for variants
  status: "pending" | "generating" | "done" | "error";
  base64?: string;
  mimeType?: string;
  error?: string;
}

export interface BatchReference {
  base64: string;
  mimeType: string;
  previewUrl: string;
  inspirationNote: string;
}

export type BatchStep = "upload" | "generating" | "results";

export interface BatchState {
  step: BatchStep;
  projectName: string;

  // Input
  screenshotBase64: string;
  screenshotMimeType: string;
  screenshotPreviewUrl: string;
  references: BatchReference[];

  // Render slots
  slots: BatchRenderSlot[];

  // Drive export
  driveUploading: boolean;
  driveUrl: string;
  driveError: string;
}

/** Build the 8 render slots from 3 references */
export function buildSlots(): BatchRenderSlot[] {
  const slots: BatchRenderSlot[] = [
    { id: "base-standard", label: "Base — Standard", type: "base", framing: "standard", status: "pending" },
    { id: "base-grand", label: "Base — Grand Scale", type: "base", framing: "grand-scale", status: "pending" },
  ];

  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    slots.push({
      id: `ref${n}-standard`,
      label: `Ref ${n} — Standard`,
      type: "variant",
      framing: "standard",
      referenceIndex: i,
      status: "pending",
    });
    slots.push({
      id: `ref${n}-grand`,
      label: `Ref ${n} — Grand Scale`,
      type: "variant",
      framing: "grand-scale",
      referenceIndex: i,
      status: "pending",
    });
  }

  return slots;
}

export const EMPTY_BATCH_STATE: BatchState = {
  step: "upload",
  projectName: "",
  screenshotBase64: "",
  screenshotMimeType: "image/png",
  screenshotPreviewUrl: "",
  references: [],
  slots: [],
  driveUploading: false,
  driveUrl: "",
  driveError: "",
};
