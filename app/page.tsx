"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { AppState, AppStep, Surface, SurfaceMaterial, RenderOptions } from "@/lib/types";
import { EMPTY_STATE } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:image/png;base64,XXXX" — strip the prefix
      const [header, data] = result.split(",");
      const mimeType = header.split(":")[1].split(";")[0];
      resolve({ base64: data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrl(base64: string, mimeType: string) {
  return `data:${mimeType};base64,${base64}`;
}

function downloadImage(base64: string, mimeType: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl(base64, mimeType);
  a.download = filename;
  a.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────────────────────────────────────

const STEP_ORDER: AppStep[] = [
  "upload",
  "stage1",
  "confirm-base",
  "surfaces",
  "configure",
  "stage3",
  "review",
  "render-options",
  "stage4",
  "complete",
];

const STEP_LABELS: Record<AppStep, string> = {
  upload: "Upload",
  stage1: "Render",
  "confirm-base": "Confirm",
  surfaces: "Surfaces",
  configure: "Stone",
  stage3: "Preview",
  review: "Review",
  "render-options": "Options",
  stage4: "Final",
  complete: "Done",
};

function StepBar({ current }: { current: AppStep }) {
  const idx = STEP_ORDER.indexOf(current);
  const visible = ["upload", "confirm-base", "surfaces", "configure", "review", "render-options", "complete"] as AppStep[];
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {visible.map((step, i) => {
        const stepIdx = STEP_ORDER.indexOf(step);
        const done = stepIdx < idx;
        const active = stepIdx === idx || (stepIdx < idx && idx - stepIdx <= 2);
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`stage-badge text-xs transition-all ${
                done
                  ? "bg-gold/20 text-gold"
                  : active
                  ? "bg-gold text-stone-950"
                  : "bg-stone-800 text-stone-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={`hidden sm:inline text-xs font-medium ${
                active ? "text-stone-200" : done ? "text-gold/70" : "text-stone-600"
              }`}
            >
              {STEP_LABELS[step]}
            </span>
            {i < visible.length - 1 && (
              <div
                className={`hidden sm:block h-px w-6 ${done ? "bg-gold/40" : "bg-stone-800"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface crop — draws a bounding-box region from the base render onto a canvas
// ─────────────────────────────────────────────────────────────────────────────

function SurfaceCrop({
  imageBase64,
  imageMimeType,
  box,
}: {
  imageBase64: string;
  imageMimeType: string;
  box: [number, number, number, number]; // [y_min, x_min, y_max, x_max] 0–1000
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const [y1, x1, y2, x2] = box;
      const sx = (x1 / 1000) * img.naturalWidth;
      const sy = (y1 / 1000) * img.naturalHeight;
      const sw = ((x2 - x1) / 1000) * img.naturalWidth;
      const sh = ((y2 - y1) / 1000) * img.naturalHeight;

      // Cap output at 320×240 while preserving aspect ratio
      const maxW = 320;
      const maxH = 240;
      const scale = Math.min(maxW / sw, maxH / sh);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl(imageBase64, imageMimeType);
  }, [imageBase64, imageMimeType, box]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg border border-stone-700 object-cover w-full"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop Zone
// ─────────────────────────────────────────────────────────────────────────────

function DropZone({
  onFile,
  accept = "image/*",
  label,
  sublabel,
  previewUrl,
  className = "",
}: {
  onFile: (file: File) => void;
  accept?: string;
  label: string;
  sublabel?: string;
  previewUrl?: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""} ${className}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {previewUrl ? (
        <div className="w-full h-full relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="preview"
            className="w-full h-full object-contain rounded-lg"
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/50 rounded-lg transition-opacity">
            <span className="text-sm text-white font-medium">Click to change</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 p-8 text-center select-none">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div>
            <p className="text-stone-200 font-medium text-sm">{label}</p>
            {sublabel && <p className="text-stone-500 text-xs mt-1">{sublabel}</p>}
          </div>
          <span className="text-xs text-stone-600 mt-1">PNG, JPG, WEBP accepted</span>
        </div>
      )}
    </div>
  );
}

// Small "Change" button for replacing an already-uploaded file
function ChangeFileButton({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
      >
        Change
      </button>
    </>
  );
}

// Compact inline upload button for surface cards (no DropZone overflow issues)
function SurfaceUploadButton({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-stone-600
                   hover:border-gold/60 hover:bg-stone-800/40 transition-all text-left group"
      >
        <div className="w-8 h-8 rounded-md bg-stone-800 border border-stone-700 flex items-center justify-center flex-shrink-0
                        group-hover:border-gold/40 transition-colors">
          <svg className="w-4 h-4 text-stone-400 group-hover:text-gold transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-stone-300 text-xs font-medium group-hover:text-stone-100 transition-colors">
            Upload material photo
          </p>
          <p className="text-stone-600 text-xs">PNG, JPG, WEBP — product shot, swatch, screenshot</p>
        </div>
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading overlay
// ─────────────────────────────────────────────────────────────────────────────

function LoadingCard({ message }: { message: string }) {
  return (
    <div className="card p-10 flex flex-col items-center gap-6 animate-fade-in">
      <div className="relative">
        <div className="spinner w-12 h-12 border-[3px]" />
        <div className="absolute inset-0 rounded-full border-2 border-gold/20 animate-ping-slow" />
      </div>
      <div className="text-center">
        <p className="text-stone-200 font-medium">{message}</p>
        <p className="text-stone-500 text-sm mt-1">This may take up to a minute — please don&apos;t close the tab.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error card
// ─────────────────────────────────────────────────────────────────────────────

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card border-red-900/50 p-8 flex flex-col items-center gap-4 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-full bg-red-900/30 flex items-center justify-center">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <p className="text-stone-200 font-medium">Something went wrong</p>
        <p className="text-stone-400 text-sm mt-1">{message}</p>
      </div>
      <button onClick={onRetry} className="btn-secondary text-sm">
        Try again
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface selector
// ─────────────────────────────────────────────────────────────────────────────

const SURFACE_FRIENDLY_NAMES: Record<string, string> = {
  floor: "Floor",
  "wall-back": "Back wall",
  "wall-left": "Left wall",
  "wall-right": "Right wall",
  "wall-feature": "Feature wall",
  ceiling: "Ceiling",
  countertop: "Countertop",
  "island-top": "Kitchen island",
  "bar-top": "Bar top",
  "vanity-top": "Vanity top",
  backsplash: "Backsplash",
  "cabinet-front": "Cabinet fronts",
  "fireplace-surround": "Fireplace",
  "stair-tread": "Stair treads",
  "stair-riser": "Stair risers",
  tabletop: "Table top",
  column: "Columns",
  "window-sill": "Window sills",
  "bath-surround": "Bath surround",
  "shower-floor": "Shower floor",
  shelf: "Shelving",
};

function friendlyName(label: string) {
  return SURFACE_FRIENDLY_NAMES[label] ?? label.replace(/-/g, " ");
}

function SurfaceList({
  surfaces,
  selected,
  onChange,
}: {
  surfaces: Surface[];
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const toggle = (label: string) => {
    onChange(
      selected.includes(label)
        ? selected.filter((s) => s !== label)
        : [...selected, label]
    );
  };

  return (
    <div className="space-y-2">
      {surfaces.map((s) => {
        const checked = selected.includes(s.label);
        return (
          <button
            key={s.label}
            onClick={() => toggle(s.label)}
            className={`w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
              checked
                ? "border-gold/60 bg-gold/5"
                : "border-stone-800 bg-stone-900 hover:border-stone-600"
            }`}
          >
            <div
              className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                checked ? "bg-gold border-gold" : "border-stone-600"
              }`}
            >
              {checked && (
                <svg className="w-3 h-3 text-stone-950" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M2 6l3 3 5-5" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-stone-100 font-medium text-sm">{friendlyName(s.label)}</p>
                <span className="text-xs text-stone-500 flex-shrink-0">~{s.areaPercent}% of space</span>
              </div>
              <p className="text-stone-400 text-xs mt-0.5">{s.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scale picker
// ─────────────────────────────────────────────────────────────────────────────

const SCALE_OPTIONS = [
  {
    value: "small" as const,
    label: "Fine & detailed",
    sublabel: "Small repeating tiles — great for bathrooms and backsplashes",
    icon: "▪▪▪\n▪▪▪\n▪▪▪",
  },
  {
    value: "medium" as const,
    label: "Natural slab",
    sublabel: "Medium stone slabs — the most natural and versatile look",
    icon: "▬\n▬",
    recommended: true,
  },
  {
    value: "large" as const,
    label: "Statement walls",
    sublabel: "Large dramatic slabs — bold, floor-to-ceiling impact",
    icon: "█",
  },
];

function ScalePicker({
  value,
  onChange,
}: {
  value: "small" | "medium" | "large";
  onChange: (v: "small" | "medium" | "large") => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {SCALE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`relative p-4 rounded-xl border text-left transition-all ${
            value === opt.value
              ? "border-gold/60 bg-gold/5"
              : "border-stone-800 bg-stone-900 hover:border-stone-600"
          }`}
        >
          {opt.recommended && (
            <span className="absolute top-2 right-2 text-xs bg-gold/20 text-gold px-2 py-0.5 rounded-full font-medium">
              Recommended
            </span>
          )}
          <div
            className={`w-5 h-5 rounded-full border-2 mb-3 flex items-center justify-center transition-all ${
              value === opt.value ? "border-gold" : "border-stone-600"
            }`}
          >
            {value === opt.value && (
              <div className="w-2.5 h-2.5 rounded-full bg-gold" />
            )}
          </div>
          <p className="text-stone-100 font-medium text-sm">{opt.label}</p>
          <p className="text-stone-400 text-xs mt-1">{opt.sublabel}</p>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Image with caption
// ─────────────────────────────────────────────────────────────────────────────

function RenderImage({
  base64,
  mimeType,
  caption,
}: {
  base64: string;
  mimeType: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl(base64, mimeType)}
        alt={caption ?? "render"}
        className="w-full rounded-xl border border-stone-800 object-contain"
      />
      {caption && (
        <p className="text-stone-500 text-xs text-center">{caption}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Location search with OSM autocomplete + map preview
// ─────────────────────────────────────────────────────────────────────────────

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

function LocationSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [mapPin, setMapPin] = useState<{ lat: number; lon: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When a location is already set on mount, geocode it to show the map
  useEffect(() => {
    if (value && !mapPin) {
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=1`,
        { headers: { "Accept-Language": "en" } }
      )
        .then((r) => r.json())
        .then((data: NominatimResult[]) => {
          if (data[0]) setMapPin({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) });
        })
        .catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleInput(val: string) {
    setQuery(val);
    setMapPin(null);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5`,
          { headers: { "Accept-Language": "en" } }
        );
        const data: NominatimResult[] = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch { /* ignore */ }
    }, 400);
  }

  function selectResult(r: NominatimResult) {
    // Use a short readable name (first two comma-separated parts)
    const shortName = r.display_name.split(",").slice(0, 2).join(",").trim();
    setQuery(shortName);
    setMapPin({ lat: parseFloat(r.lat), lon: parseFloat(r.lon) });
    setOpen(false);
    onChange(shortName);
  }

  function clearLocation() {
    setQuery("");
    setMapPin(null);
    setResults([]);
    onChange("");
  }

  const mapUrl = mapPin
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapPin.lon - 0.15},${mapPin.lat - 0.1},${mapPin.lon + 0.15},${mapPin.lat + 0.1}&layer=mapnik&marker=${mapPin.lat},${mapPin.lon}`
    : null;

  return (
    <div className="space-y-2">
      <label className="text-stone-300 text-sm font-medium">Location <span className="text-stone-500 font-normal">(optional)</span></label>
      <p className="text-stone-500 text-xs">Sets the regional light quality, landscape, and exterior context visible through windows.</p>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search for a city or region…"
          className="w-full bg-stone-900 border border-stone-700 text-stone-200 text-sm rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 placeholder:text-stone-600"
        />
        {query && (
          <button
            onClick={clearLocation}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 text-lg leading-none"
          >
            ×
          </button>
        )}
        {open && results.length > 0 && (
          <ul className="absolute z-20 top-full mt-1 w-full bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden">
            {results.map((r) => (
              <li
                key={r.place_id}
                onMouseDown={() => selectResult(r)}
                className="px-3 py-2.5 text-sm text-stone-300 hover:bg-stone-800 cursor-pointer border-b border-stone-800 last:border-0 truncate"
              >
                {r.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {mapUrl && (
        <div className="rounded-lg overflow-hidden border border-stone-700 mt-2">
          <iframe
            src={mapUrl}
            width="100%"
            height="180"
            style={{ border: 0, display: "block" }}
            title="Location map"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);

  // ── helpers ────────────────────────────────────────────────────────────────

  function set(patch: Partial<AppState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function setError(msg: string) {
    set({ loading: false, error: msg });
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json() as T & { error?: string };
    if (!res.ok || json.error) {
      throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    return json;
  }

  // ── Stage 1: upload screenshot → base render ──────────────────────────────

  async function handleScreenshotUpload(file: File) {
    set({ error: null, loading: true, loadingMessage: "Converting your drawing to a realistic photo…" });
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const previewUrl = dataUrl(base64, mimeType);

      set({
        screenshotBase64: base64,
        screenshotMimeType: mimeType,
        screenshotPreviewUrl: previewUrl,
        step: "stage1",
        loadingMessage: "Converting your drawing to a realistic photo… (this takes about 30–60 seconds)",
      });

      const result = await post<{ baseRenderBase64: string; baseRenderMimeType: string }>(
        "/api/stage1",
        { screenshotBase64: base64, screenshotMimeType: mimeType }
      );

      set({
        baseRenderBase64: result.baseRenderBase64,
        baseRenderMimeType: result.baseRenderMimeType,
        step: "confirm-base",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  }

  // ── Regenerate base render with feedback ──────────────────────────────────

  async function handleRegenerateBase() {
    const { screenshotBase64, screenshotMimeType, baseRenderFeedback } = state;
    set({ error: null, loading: true, step: "stage1", loadingMessage: "Regenerating with your notes…" });
    try {
      const result = await post<{ baseRenderBase64: string; baseRenderMimeType: string }>(
        "/api/stage1",
        { screenshotBase64, screenshotMimeType, feedback: baseRenderFeedback }
      );
      set({
        baseRenderBase64: result.baseRenderBase64,
        baseRenderMimeType: result.baseRenderMimeType,
        baseRenderFeedback: "",
        step: "confirm-base",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed. Please try again.");
      set({ step: "confirm-base" });
    }
  }

  // ── Stage 2: detect surfaces (called after user confirms base render) ────────

  async function runStage2() {
    set({ error: null, loading: true, step: "stage1", loadingMessage: "Identifying surfaces in your space…" });
    try {
      const result = await post<{ surfaces: Surface[] }>("/api/stage2", {
        baseRenderBase64: state.baseRenderBase64,
        baseRenderMimeType: state.baseRenderMimeType,
      });

      const surfaces = result.surfaces;

      if (surfaces.length === 0) {
        setError(
          "We couldn't find any suitable surfaces in this image. Try a cleaner screenshot with more visible walls or floor."
        );
        return;
      }

      set({
        surfaces,
        selectedSurfaces: surfaces.map((s) => s.label),
        surfaceMaterials: {},
        step: "configure",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Surface detection failed. Please try again.");
      set({ step: "confirm-base" });
    }
  }

  // ── Stage 3: generate previews ────────────────────────────────────────────

  async function handleGeneratePreviews() {
    const { surfaces, surfaceMaterials, scale } = state;

    // Only process surfaces that have a material uploaded
    const surfacesWithMaterial = surfaces.filter((s) => surfaceMaterials[s.label]);

    if (surfacesWithMaterial.length === 0) {
      setError("Please upload at least one stone material photo.");
      return;
    }

    const count = surfacesWithMaterial.length;
    set({
      error: null,
      loading: true,
      step: "stage3",
      loadingMessage: `Generating ${count} preview${count > 1 ? "s" : ""}… this takes about a minute.`,
    });

    try {
      const result = await post<{
        previews: Array<{ surface: string; base64: string; mimeType: string }>;
      }>("/api/stage3", {
        screenshotBase64: state.screenshotBase64,
        screenshotMimeType: state.screenshotMimeType,
        baseRenderBase64: state.baseRenderBase64,
        baseRenderMimeType: state.baseRenderMimeType,
        surfaces: surfacesWithMaterial.map((s) => ({
          label: s.label,
          description: s.description,
          materialBase64: surfaceMaterials[s.label].base64,
          materialMimeType: surfaceMaterials[s.label].mimeType,
        })),
        scale,
      });

      set({
        previewImages: result.previews,
        step: "review",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview generation failed. Please try again.");
      set({ step: "configure" });
    }
  }

  // ── Stage 4: final render ─────────────────────────────────────────────────

  async function handleFinalRender() {
    const { surfaces, surfaceMaterials, scale, renderOptions } = state;
    const surfacesWithMaterial = surfaces.filter((s) => surfaceMaterials[s.label]);

    set({
      error: null,
      loading: true,
      step: "stage4",
      loadingMessage: "Creating your final high-quality render… this takes 1–2 minutes.",
    });

    try {
      const result = await post<{ finalBase64: string; finalMimeType: string }>(
        "/api/stage4",
        {
          screenshotBase64: state.screenshotBase64,
          screenshotMimeType: state.screenshotMimeType,
          baseRenderBase64: state.baseRenderBase64,
          baseRenderMimeType: state.baseRenderMimeType,
          surfaces: surfacesWithMaterial.map((s) => ({
            label: s.label,
            description: s.description,
            materialBase64: surfaceMaterials[s.label].base64,
            materialMimeType: surfaceMaterials[s.label].mimeType,
          })),
          scale,
          renderOptions,
        }
      );

      set({
        finalBase64: result.finalBase64,
        finalMimeType: result.finalMimeType,
        step: "complete",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Final render failed. Please try again.");
      set({ step: "render-options" });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const { step, loading, loadingMessage, error } = state;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
              <span className="text-gold text-xs font-bold">T</span>
            </div>
            <span className="font-display text-stone-100 text-lg font-semibold tracking-tight">
              Render Studio
            </span>
          </div>
          {step !== "upload" && (
            <StepBar current={step} />
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 space-y-6">

        {/* ── UPLOAD ── */}
        {step === "upload" && !loading && (
          <div className="space-y-6 animate-slide-up">
            <div className="text-center space-y-3">
              <h1 className="font-display text-3xl sm:text-4xl text-stone-100 leading-tight">
                Turn your drawings into{" "}
                <span className="text-gold">photorealistic renders</span>
              </h1>
              <p className="text-stone-400 text-base max-w-lg mx-auto">
                Upload a SketchUp screenshot and we&apos;ll show you what it looks like
                with real stone materials applied — in minutes.
              </p>
            </div>

            <div className="card p-6 space-y-4">
              <div>
                <p className="text-stone-200 font-medium text-sm mb-1">Step 1 of 4</p>
                <h2 className="text-stone-100 text-xl font-semibold">Upload your SketchUp drawing</h2>
                <p className="text-stone-400 text-sm mt-1">
                  Take a screenshot of your SketchUp model and drop it here.
                  Any view works — top, perspective, or interior.
                </p>
              </div>
              <DropZone
                onFile={handleScreenshotUpload}
                label="Drop your SketchUp screenshot here"
                sublabel="Or click to browse your files"
                className="h-56"
              />
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { icon: "🏗️", label: "Preserves your layout", sub: "Walls, doors & windows stay exactly as drawn" },
                { icon: "🪨", label: "Real stone textures", sub: "Upload any stone material photo" },
                { icon: "📐", label: "High quality output", sub: "Final render ready to share with clients" },
              ].map((f) => (
                <div key={f.label} className="card p-4 space-y-1">
                  <div className="text-2xl">{f.icon}</div>
                  <p className="text-stone-200 text-xs font-semibold">{f.label}</p>
                  <p className="text-stone-500 text-xs">{f.sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LOADING ── */}
        {loading && !error && (
          <LoadingCard message={loadingMessage} />
        )}

        {/* ── ERROR ── */}
        {error && (
          <ErrorCard
            message={error}
            onRetry={() => set({ ...EMPTY_STATE })}
          />
        )}

        {/* ── CONFIRM BASE RENDER ── */}
        {step === "confirm-base" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 1 of 5</p>
              <h2 className="text-stone-100 text-xl font-semibold">Does the layout look right?</h2>
              <p className="text-stone-400 text-sm">
                Check that the walls, doors, windows, and furniture positions match your drawing.
                The structure must be correct before we apply any materials.
              </p>
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider px-1">Your SketchUp drawing</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.screenshotPreviewUrl}
                  alt="Original screenshot"
                  className="w-full rounded-xl border border-stone-800 object-contain bg-stone-900"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider px-1">Photorealistic version</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dataUrl(state.baseRenderBase64, state.baseRenderMimeType)}
                  alt="Base render"
                  className="w-full rounded-xl border border-stone-800 object-contain bg-stone-900"
                />
              </div>
            </div>

            {/* Feedback box */}
            <div className="card p-5 space-y-3">
              <div>
                <h3 className="text-stone-200 font-medium text-sm">Something look off?</h3>
                <p className="text-stone-500 text-xs mt-0.5">
                  Describe what needs fixing and we&apos;ll regenerate. Leave blank if it looks correct.
                </p>
              </div>
              <textarea
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                rows={3}
                placeholder="e.g. The ceiling looks too low, or the window on the left is missing…"
                value={state.baseRenderFeedback}
                onChange={(e) => set({ baseRenderFeedback: e.target.value })}
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  className="btn-secondary"
                  disabled={!state.baseRenderFeedback.trim()}
                  onClick={handleRegenerateBase}
                >
                  Regenerate with these notes
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={runStage2}
                >
                  Looks correct — identify surfaces
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIGURE (surfaces + material upload, combined) ── */}
        {(step === "surfaces" || step === "configure") && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 2 of 4</p>
              <h2 className="text-stone-100 text-xl font-semibold">Choose materials for each surface</h2>
              <p className="text-stone-400 text-sm">
                We found {state.surfaces.length} surface{state.surfaces.length !== 1 ? "s" : ""} in your space.
                Upload a material photo next to any surface you want to change — leave it blank to keep it as-is.
              </p>
            </div>

            {/* Surface cards */}
            <div className="space-y-3">
              {state.surfaces.map((surface) => {
                const material = state.surfaceMaterials[surface.label] as SurfaceMaterial | undefined;
                return (
                  <div key={surface.label} className="card p-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      {/* Surface info + upload */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                        <div>
                          <p className="text-stone-100 font-semibold text-sm">
                            {friendlyName(surface.label)}
                          </p>
                          <p className="text-stone-400 text-xs mt-0.5">{surface.description}</p>
                        </div>

                        {material ? (
                          /* Material uploaded — show thumbnail + change button */
                          <div className="flex items-center gap-3 p-2 rounded-lg bg-stone-800/50 border border-stone-700">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={material.previewUrl}
                              alt="material"
                              className="w-10 h-10 rounded-md object-cover border border-stone-600 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-gold text-xs font-medium">Material uploaded</p>
                              <p className="text-stone-500 text-xs">Will be applied in the render</p>
                            </div>
                            <ChangeFileButton
                              onFile={async (file) => {
                                const { base64, mimeType } = await fileToBase64(file);
                                set({
                                  surfaceMaterials: {
                                    ...state.surfaceMaterials,
                                    [surface.label]: { base64, mimeType, previewUrl: dataUrl(base64, mimeType) },
                                  },
                                });
                              }}
                            />
                          </div>
                        ) : (
                          /* No material yet — compact inline upload button */
                          <SurfaceUploadButton
                            onFile={async (file) => {
                              const { base64, mimeType } = await fileToBase64(file);
                              set({
                                surfaceMaterials: {
                                  ...state.surfaceMaterials,
                                  [surface.label]: { base64, mimeType, previewUrl: dataUrl(base64, mimeType) },
                                },
                              });
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className="btn-secondary sm:w-auto"
                onClick={() => set({ step: "confirm-base" })}
              >
                ← Back
              </button>
              <button
                className="btn-primary flex-1"
                disabled={Object.keys(state.surfaceMaterials).length === 0}
                onClick={handleGeneratePreviews}
              >
                Generate previews
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── REVIEW PREVIEWS ── */}
        {step === "review" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 3 of 4 — almost there!</p>
              <h2 className="text-stone-100 text-xl font-semibold">Here&apos;s a preview</h2>
              <p className="text-stone-400 text-sm">
                These are quick previews — the final render will be significantly higher quality.
                If you&apos;re happy with the direction, click &ldquo;Create final render&rdquo; below.
              </p>
            </div>

            <div className="space-y-4">
              {state.previewImages.map((preview) => (
                <div key={preview.surface} className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gold" />
                    <span className="text-stone-300 text-sm font-medium">
                      {friendlyName(preview.surface)}
                    </span>
                    <span className="text-stone-600 text-xs">— preview</span>
                  </div>
                  <RenderImage
                    base64={preview.base64}
                    mimeType={preview.mimeType}
                  />
                </div>
              ))}
            </div>

            <div className="card p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-stone-200 font-medium text-sm">Happy with the direction?</p>
                <p className="text-stone-400 text-xs mt-0.5">
                  The final render will be higher resolution and fully composited.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  className="btn-secondary"
                  onClick={() => set({ step: "configure", previewImages: [] })}
                >
                  ← Change materials
                </button>
                <button
                  className="btn-primary"
                  onClick={() => set({ step: "render-options" })}
                >
                  Set render options →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── RENDER OPTIONS ── */}
        {step === "render-options" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 4 of 5 — almost there!</p>
              <h2 className="text-stone-100 text-xl font-semibold">Render options</h2>
              <p className="text-stone-400 text-sm">
                Fine-tune the lighting, mood, and atmosphere of your final render.
              </p>
            </div>

            <div className="card p-6 space-y-5">
              {(
                [
                  {
                    label: "Lighting style",
                    key: "lightingStyle" as keyof RenderOptions,
                    options: [
                      { value: "natural-daylight", label: "Natural daylight" },
                      { value: "golden-hour", label: "Golden hour" },
                      { value: "overcast", label: "Overcast / diffused" },
                      { value: "dramatic-spotlight", label: "Dramatic spotlight" },
                      { value: "candlelight", label: "Candlelight / warm ambient" },
                      { value: "blue-hour", label: "Blue hour / dusk" },
                      { value: "night-interior", label: "Night interior" },
                    ],
                  },
                  {
                    label: "Time of day",
                    key: "timeOfDay" as keyof RenderOptions,
                    options: [
                      { value: "morning", label: "Morning" },
                      { value: "midday", label: "Midday" },
                      { value: "afternoon", label: "Afternoon" },
                      { value: "evening", label: "Evening" },
                      { value: "night", label: "Night" },
                    ],
                  },
                  {
                    label: "Mood",
                    key: "mood" as keyof RenderOptions,
                    options: [
                      { value: "bright-airy", label: "Bright & airy" },
                      { value: "warm-cosy", label: "Warm & cosy" },
                      { value: "moody-dramatic", label: "Moody & dramatic" },
                      { value: "clean-minimal", label: "Clean & minimal" },
                      { value: "luxurious-opulent", label: "Luxurious & opulent" },
                      { value: "rustic-natural", label: "Rustic & natural" },
                    ],
                  },
                  {
                    label: "Camera style",
                    key: "cameraStyle" as keyof RenderOptions,
                    options: [
                      { value: "wide-angle", label: "Wide angle overview" },
                      { value: "standard", label: "Standard perspective" },
                      { value: "intimate", label: "Intimate close-up" },
                    ],
                  },
                ] as Array<{
                  label: string;
                  key: keyof RenderOptions;
                  options: Array<{ value: string; label: string }>;
                }>
              ).map(({ label, key, options }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-stone-300 text-sm font-medium">{label}</label>
                  <select
                    value={state.renderOptions[key]}
                    onChange={(e) =>
                      set({ renderOptions: { ...state.renderOptions, [key]: e.target.value } })
                    }
                    className="w-full bg-stone-900 border border-stone-700 text-stone-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 appearance-none cursor-pointer"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                  >
                    {options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="border-t border-stone-800 pt-5">
                <LocationSearch
                  value={state.renderOptions.location}
                  onChange={(name) => set({ renderOptions: { ...state.renderOptions, location: name } })}
                />
              </div>
            </div>

            <div className="card p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-stone-200 font-medium text-sm">Ready to generate?</p>
                <p className="text-stone-400 text-xs mt-0.5">
                  The final render takes 1–2 minutes at full quality.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  className="btn-secondary"
                  onClick={() => set({ step: "review" })}
                >
                  ← Back to preview
                </button>
                <button
                  className="btn-primary"
                  onClick={handleFinalRender}
                >
                  Create final render
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPLETE ── */}
        {step === "complete" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2 text-center">
              <div className="w-12 h-12 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center mx-auto mb-2">
                <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-stone-100 text-2xl font-semibold font-display">Your render is ready</h2>
              <p className="text-stone-400 text-sm">
                High-quality photorealistic render with your stone material applied.
              </p>
            </div>

            <div className="card overflow-hidden">
              <RenderImage
                base64={state.finalBase64}
                mimeType={state.finalMimeType}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className="btn-primary flex-1 py-4 text-base"
                onClick={() =>
                  downloadImage(
                    state.finalBase64,
                    state.finalMimeType,
                    `tiba-render-${Date.now()}.png`
                  )
                }
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download render
              </button>
              <button
                className="btn-secondary"
                onClick={() => setState(EMPTY_STATE)}
              >
                Start a new render
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-6">
        <p className="text-center text-stone-600 text-xs">
          Tiba Render Studio — powered by Gemini &amp; Claude
        </p>
      </footer>
    </div>
  );
}
