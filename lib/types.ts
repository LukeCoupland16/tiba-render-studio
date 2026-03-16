export type AppStep =
  | "upload"
  | "stage1"           // generating base render
  | "confirm-base"     // user confirms base render looks spatially correct
  | "surfaces"         // user reviews surfaces
  | "configure"        // user picks stone + scale
  | "stage3"           // generating previews
  | "review"           // user approves previews
  | "render-options"   // user sets lighting, mood, time of day etc.
  | "stage4"           // generating final render
  | "complete";        // done, download available

export interface RenderOptions {
  lightingStyle: string;
  timeOfDay: string;
  mood: string;
  cameraStyle: string;
  location: string; // free-text place name, e.g. "Tuscany, Italy"
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  lightingStyle: "natural-daylight",
  timeOfDay: "afternoon",
  mood: "bright-airy",
  cameraStyle: "standard",
  location: "",
};

export interface Surface {
  label: string;        // e.g. "floor", "wall-back"
  description: string;  // e.g. "The main floor area"
  areaPercent: number;  // approximate % of image
  suitable: boolean;    // AI recommendation
  box?: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalised 0–1000
}

export interface SurfaceMaterial {
  base64: string;
  mimeType: string;
  previewUrl: string;
}

export interface AppState {
  step: AppStep;

  // Screenshot the user uploaded
  screenshotBase64: string;
  screenshotMimeType: string;
  screenshotPreviewUrl: string;

  // Output of Stage 1
  baseRenderBase64: string;
  baseRenderMimeType: string;
  baseRenderFeedback: string; // user's correction notes for regeneration

  // Output of Stage 2 (surface detection)
  surfaces: Surface[];
  selectedSurfaces: string[]; // labels of ticked surfaces

  // Per-surface materials the user uploads
  surfaceMaterials: Record<string, SurfaceMaterial>;

  // Scale choice (global)
  scale: "small" | "medium" | "large";

  // Render mood/lighting options
  renderOptions: RenderOptions;

  // Output of Stage 3 (preview per surface)
  previewImages: Array<{ surface: string; base64: string; mimeType: string }>;

  // Output of Stage 4 (final render)
  finalBase64: string;
  finalMimeType: string;

  // UI state
  loading: boolean;
  loadingMessage: string;
  error: string | null;
}

export const EMPTY_STATE: AppState = {
  step: "upload",
  screenshotBase64: "",
  screenshotMimeType: "image/png",
  screenshotPreviewUrl: "",
  baseRenderBase64: "",
  baseRenderMimeType: "image/png",
  baseRenderFeedback: "",
  surfaces: [],
  selectedSurfaces: [],
  surfaceMaterials: {},
  scale: "medium",
  renderOptions: DEFAULT_RENDER_OPTIONS,
  previewImages: [],
  finalBase64: "",
  finalMimeType: "image/png",
  loading: false,
  loadingMessage: "",
  error: null,
};
