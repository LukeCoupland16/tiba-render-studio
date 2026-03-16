"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { AppState, AppStep, Surface, SurfaceMaterial, RenderOptions, ReferenceImage, VariantRender } from "@/lib/types";
import { EMPTY_STATE } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Resize + compress a raw image src string (data URL or object URL) to max 1920px JPEG 85%.
function compressImageSrc(src: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const MAX = 1920;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.src = src;
  });
}

// Compress a File upload before sending to the API.
function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      compressImageSrc(reader.result as string).then(resolve).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

// Read a material photo file as-is — no JPEG compression, preserves original format.
// Used for material uploads so texture fidelity is not degraded by lossy compression.
function materialFileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIdx = dataUrl.indexOf(",");
      const header = dataUrl.slice(0, commaIdx);
      const base64 = dataUrl.slice(commaIdx + 1);
      const mimeType = header.match(/data:([^;]+)/)?.[1] ?? file.type ?? "image/png";
      resolve({ base64, mimeType });
    };
    reader.readAsDataURL(file);
  });
}

// Compress a base64 image returned from the API before storing in state.
function compressBase64(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  return compressImageSrc(`data:${mimeType};base64,${base64}`);
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

let refIdCounter = 0;
function nextRefId() {
  return `ref-${++refIdCounter}-${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────────────────────────────────────

const STEP_ORDER: AppStep[] = [
  "upload",
  "stage1",
  "variant-review",
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
  upload: "Setup",
  stage1: "Render",
  "variant-review": "Variants",
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
  const visible = ["upload", "variant-review", "confirm-base", "configure", "review", "render-options", "complete"] as AppStep[];
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

// Multi-file drop zone for reference images
function MultiDropZone({
  onFiles,
  accept = "image/*",
  label,
  sublabel,
  className = "",
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  label: string;
  sublabel?: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
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
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
        }}
      />
      <div className="flex flex-col items-center gap-3 p-6 text-center select-none">
        <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center">
          <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
        <div>
          <p className="text-stone-200 font-medium text-sm">{label}</p>
          {sublabel && <p className="text-stone-500 text-xs mt-1">{sublabel}</p>}
        </div>
      </div>
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
    if (!res.ok) {
      // Handle plain-text error responses (e.g. Vercel 413 "Request Entity Too Large")
      const text = await res.text();
      let msg: string;
      try { msg = (JSON.parse(text) as { error?: string }).error ?? text; }
      catch { msg = text; }
      if (res.status === 413) throw new Error("Image too large to process. Try a smaller or lower-resolution file.");
      throw new Error(msg || `Request failed (${res.status})`);
    }
    const json = await res.json() as T & { error?: string };
    if (json.error) throw new Error(json.error);
    return json;
  }

  // ── Reference image management ────────────────────────────────────────────

  async function handleAddReferenceImages(files: File[]) {
    const newRefs: ReferenceImage[] = [];
    for (const file of files) {
      const { base64, mimeType } = await fileToBase64(file);
      newRefs.push({
        id: nextRefId(),
        base64,
        mimeType,
        previewUrl: dataUrl(base64, mimeType),
        inspirationNote: "",
      });
    }
    set({ referenceImages: [...state.referenceImages, ...newRefs] });
  }

  function updateReferenceNote(id: string, note: string) {
    set({
      referenceImages: state.referenceImages.map((r) =>
        r.id === id ? { ...r, inspirationNote: note } : r
      ),
    });
  }

  function removeReference(id: string) {
    set({ referenceImages: state.referenceImages.filter((r) => r.id !== id) });
  }

  // ── Stage 1 V2: Generate 3 variants automatically ─────────────────────────
  // Auto-chains: standard → variant A → variant B — no user interaction needed

  async function handleStartGeneration() {
    const base64 = state.screenshotBase64;
    const mimeType = state.screenshotMimeType;

    if (!base64) {
      setError("Please upload a SketchUp screenshot first.");
      return;
    }

    set({ error: null, loading: true, step: "stage1", variants: [] });

    try {
      const variants: VariantRender[] = [];
      const refs = state.referenceImages;
      const hasRefs = refs.length > 0;
      const totalCount = hasRefs ? 3 : 1;

      // 1. Standard base render
      set({ loadingMessage: `Generating standard render (1/${totalCount})… You can leave your laptop.` });
      const stdResult = await post<{ baseRenderBase64: string; baseRenderMimeType: string }>(
        "/api/stage1",
        { screenshotBase64: base64, screenshotMimeType: mimeType }
      );
      const stdCompressed = await compressBase64(stdResult.baseRenderBase64, stdResult.baseRenderMimeType);
      variants.push({
        label: "standard",
        title: "Standard",
        base64: stdCompressed.base64,
        mimeType: stdCompressed.mimeType,
      });
      set({ variants: [...variants] });

      if (hasRefs) {
        // 2. Variant A — reference-inspired (faithful)
        set({ loadingMessage: "Generating Variant A — reference-inspired (2/3)…" });
        const varAResult = await post<{ base64: string; mimeType: string }>(
          "/api/stage1-variant",
          {
            screenshotBase64: base64,
            screenshotMimeType: mimeType,
            references: refs.map((r) => ({
              base64: r.base64,
              mimeType: r.mimeType,
              note: r.inspirationNote || "General style and proportions",
            })),
            variantLabel: "A",
          }
        );
        const varACompressed = await compressBase64(varAResult.base64, varAResult.mimeType);
        variants.push({
          label: "variant-a",
          title: "Variant A — Faithful",
          base64: varACompressed.base64,
          mimeType: varACompressed.mimeType,
        });
        set({ variants: [...variants] });

        // 3. Variant B — reference-inspired (creative)
        set({ loadingMessage: "Generating Variant B — creative interpretation (3/3)…" });
        const varBResult = await post<{ base64: string; mimeType: string }>(
          "/api/stage1-variant",
          {
            screenshotBase64: base64,
            screenshotMimeType: mimeType,
            references: refs.map((r) => ({
              base64: r.base64,
              mimeType: r.mimeType,
              note: r.inspirationNote || "General style and proportions",
            })),
            variantLabel: "B",
          }
        );
        const varBCompressed = await compressBase64(varBResult.base64, varBResult.mimeType);
        variants.push({
          label: "variant-b",
          title: "Variant B — Creative",
          base64: varBCompressed.base64,
          mimeType: varBCompressed.mimeType,
        });
        set({ variants: [...variants] });
      }

      set({
        variants: [...variants],
        step: variants.length > 1 ? "variant-review" : "confirm-base",
        baseRenderBase64: variants[0].base64,
        baseRenderMimeType: variants[0].mimeType,
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    }
  }

  // ── Combine variants based on user feedback ───────────────────────────────

  async function handleCombineVariants() {
    const { screenshotBase64, screenshotMimeType, variants, variantFeedback } = state;

    set({ error: null, loading: true, step: "stage1", loadingMessage: "Combining the best of each variant…" });
    try {
      const result = await post<{ base64: string; mimeType: string }>(
        "/api/stage1-combine",
        {
          screenshotBase64,
          screenshotMimeType,
          variants: variants.map((v) => ({ base64: v.base64, mimeType: v.mimeType })),
          feedback: variantFeedback,
        }
      );
      const compressed = await compressBase64(result.base64, result.mimeType);
      set({
        baseRenderBase64: compressed.base64,
        baseRenderMimeType: compressed.mimeType,
        step: "confirm-base",
        loading: false,
        error: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Combination failed. Please try again.");
      set({ step: "variant-review" });
    }
  }

  // ── Pick a single variant as the base (skip combine) ──────────────────────

  function handlePickVariant(variant: VariantRender) {
    set({
      baseRenderBase64: variant.base64,
      baseRenderMimeType: variant.mimeType,
      step: "confirm-base",
    });
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
      const compressed = await compressBase64(result.baseRenderBase64, result.baseRenderMimeType);
      set({
        baseRenderBase64: compressed.base64,
        baseRenderMimeType: compressed.mimeType,
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
      loadingMessage: `Previewing surface 1 of ${count}: ${surfacesWithMaterial[0].label}…`,
    });

    try {
      const allPreviews: Array<{ surface: string; base64: string; mimeType: string }> = [];

      for (let i = 0; i < surfacesWithMaterial.length; i++) {
        const surface = surfacesWithMaterial[i];
        set({
          loadingMessage: `Previewing surface ${i + 1} of ${count}: ${surface.label}…`,
        });

        const result = await post<{
          previews: Array<{ surface: string; base64: string; mimeType: string }>;
        }>("/api/stage3", {
          screenshotBase64: state.screenshotBase64,
          screenshotMimeType: state.screenshotMimeType,
          baseRenderBase64: state.baseRenderBase64,
          baseRenderMimeType: state.baseRenderMimeType,
          surfaces: [{
            label: surface.label,
            description: surface.description,
            materialBase64: surfaceMaterials[surface.label].base64,
            materialMimeType: surfaceMaterials[surface.label].mimeType,
          }],
          scale,
        });

        allPreviews.push(...result.previews);
      }

      set({
        previewImages: allPreviews,
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
    const count = surfacesWithMaterial.length;

    set({
      error: null,
      loading: true,
      step: "stage4",
      loadingMessage: `Describing material 1 of ${count}: ${surfacesWithMaterial[0].label}…`,
    });

    try {
      let runningBase64 = state.baseRenderBase64;
      let runningMimeType = state.baseRenderMimeType;

      for (let i = 0; i < surfacesWithMaterial.length; i++) {
        const surface = surfacesWithMaterial[i];
        const mat = surfaceMaterials[surface.label];

        // Describe the material first (quick call, separate timeout budget)
        set({ loadingMessage: `Describing material ${i + 1} of ${count}: ${surface.label}…` });
        const { description: materialDescription } = await post<{ description: string }>(
          "/api/describe-stone",
          { stoneBase64: mat.base64, stoneMimeType: mat.mimeType }
        );

        // Apply this surface's material on top of the accumulated render
        set({ loadingMessage: `Rendering surface ${i + 1} of ${count}: ${surface.label}…` });
        const result = await post<{ base64: string; mimeType: string }>(
          "/api/stage4",
          {
            screenshotBase64: state.screenshotBase64,
            screenshotMimeType: state.screenshotMimeType,
            runningBase64,
            runningMimeType,
            surface: {
              label: surface.label,
              description: surface.description,
              materialBase64: mat.base64,
              materialMimeType: mat.mimeType,
            },
            materialDescription,
            scale,
            renderOptions,
          }
        );

        runningBase64 = result.base64;
        runningMimeType = result.mimeType;
      }

      set({
        finalBase64: runningBase64,
        finalMimeType: runningMimeType,
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

  // Check if project setup is ready to generate
  const canGenerate =
    state.screenshotPreviewUrl !== "" &&
    state.projectName.trim() !== "";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
              <span className="text-gold text-xs font-bold">T</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-display text-stone-100 text-lg font-semibold tracking-tight">
                Render Studio
              </span>
              {state.projectName && (
                <span className="text-stone-500 text-sm font-normal hidden sm:inline">
                  — {state.projectName}
                </span>
              )}
            </div>
          </div>
          {step !== "upload" && (
            <StepBar current={step} />
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 space-y-6">

        {/* ── PROJECT SETUP / UPLOAD ── */}
        {step === "upload" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="text-center space-y-3">
              <h1 className="font-display text-3xl sm:text-4xl text-stone-100 leading-tight">
                Turn your drawings into{" "}
                <span className="text-gold">photorealistic renders</span>
              </h1>
              <p className="text-stone-400 text-base max-w-lg mx-auto">
                Set up your project, upload reference images for inspiration,
                and we&apos;ll generate three render variants automatically.
              </p>
            </div>

            {/* Project name */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-xl font-semibold">Project setup</h2>
                <p className="text-stone-400 text-sm mt-1">
                  Name your project and upload the SketchUp screenshot.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">Project name</label>
                <input
                  type="text"
                  value={state.projectName}
                  onChange={(e) => set({ projectName: e.target.value })}
                  placeholder="e.g. Candidasa Villa"
                  className="w-full bg-stone-900 border border-stone-700 text-stone-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 placeholder:text-stone-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">SketchUp screenshot</label>
                <DropZone
                  onFile={async (file) => {
                    const { base64, mimeType } = await fileToBase64(file);
                    set({
                      screenshotBase64: base64,
                      screenshotMimeType: mimeType,
                      screenshotPreviewUrl: dataUrl(base64, mimeType),
                    });
                  }}
                  label="Drop your SketchUp screenshot here"
                  sublabel="Or click to browse your files"
                  previewUrl={state.screenshotPreviewUrl || undefined}
                  className="h-48"
                />
              </div>
            </div>

            {/* Reference images */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-lg font-semibold">Reference images</h2>
                <p className="text-stone-400 text-sm mt-1">
                  Upload renders, photos, or mood board images for inspiration.
                  Two variant renders will be generated based on these references.
                </p>
              </div>

              {/* Uploaded references */}
              {state.referenceImages.length > 0 && (
                <div className="space-y-3">
                  {state.referenceImages.map((ref) => (
                    <div key={ref.id} className="flex gap-3 p-3 rounded-xl bg-stone-800/50 border border-stone-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ref.previewUrl}
                        alt="reference"
                        className="w-20 h-20 rounded-lg object-cover border border-stone-600 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0 space-y-2">
                        <textarea
                          value={ref.inspirationNote}
                          onChange={(e) => updateReferenceNote(ref.id, e.target.value)}
                          placeholder="What should we draw inspiration from? e.g. 'The warm timber ceiling proportions' or 'The stone wall texture and colour palette'"
                          className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                          rows={2}
                        />
                      </div>
                      <button
                        onClick={() => removeReference(ref.id)}
                        className="text-stone-500 hover:text-red-400 transition-colors flex-shrink-0 self-start p-1"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <MultiDropZone
                onFiles={handleAddReferenceImages}
                label="Add reference images"
                sublabel="Drop multiple images or click to browse"
                className="h-28"
              />
            </div>

            {/* Generate button */}
            <div className="card p-5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-stone-200 font-medium text-sm">Ready to generate?</p>
                  <p className="text-stone-400 text-xs mt-0.5">
                    {state.referenceImages.length > 0
                      ? `3 variants will be generated automatically (standard + 2 inspired). Takes ~3 minutes.`
                      : `1 standard render will be generated. Add reference images above for 3 variants.`}
                  </p>
                </div>
                <button
                  className="btn-primary w-full sm:w-auto"
                  disabled={!canGenerate}
                  onClick={() => handleStartGeneration()}
                >
                  Generate renders
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { icon: "🏗️", label: "Preserves your layout", sub: "Walls, doors & windows stay exactly as drawn" },
                { icon: "🎨", label: "3 design variants", sub: "Standard + 2 reference-inspired options" },
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
            onRetry={() => set({ ...EMPTY_STATE, projectName: state.projectName, referenceImages: state.referenceImages })}
          />
        )}

        {/* ── VARIANT REVIEW (3 variants) ── */}
        {step === "variant-review" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 1 of 5 — pick or combine</p>
              <h2 className="text-stone-100 text-xl font-semibold">Review your render variants</h2>
              <p className="text-stone-400 text-sm">
                We generated {state.variants.length} variant{state.variants.length !== 1 ? "s" : ""}.
                You can pick one directly or describe what to combine from each.
              </p>
            </div>

            {/* Variant cards */}
            <div className="space-y-4">
              {state.variants.map((variant) => (
                <div key={variant.label} className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        variant.label === "standard" ? "bg-stone-400" :
                        variant.label === "variant-a" ? "bg-gold" : "bg-amber-500"
                      }`} />
                      <span className="text-stone-200 text-sm font-medium">{variant.title}</span>
                    </div>
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => handlePickVariant(variant)}
                    >
                      Use this one
                    </button>
                  </div>
                  <RenderImage base64={variant.base64} mimeType={variant.mimeType} />
                </div>
              ))}
            </div>

            {/* Combination feedback */}
            {state.variants.length > 1 && (
              <div className="card p-5 space-y-3">
                <div>
                  <h3 className="text-stone-200 font-medium text-sm">Combine the best of each</h3>
                  <p className="text-stone-500 text-xs mt-0.5">
                    Describe what you like from each variant and we&apos;ll merge them into one render.
                  </p>
                </div>
                <textarea
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                  rows={4}
                  placeholder="e.g. I like the wall proportions from Variant A, the floor material from Standard, and the ceiling warmth from Variant B…"
                  value={state.variantFeedback}
                  onChange={(e) => set({ variantFeedback: e.target.value })}
                />
                <button
                  className="btn-primary w-full"
                  disabled={!state.variantFeedback.trim()}
                  onClick={handleCombineVariants}
                >
                  Combine into final base render
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CONFIRM BASE RENDER ── */}
        {step === "confirm-base" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">Step 2 of 5</p>
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
                {state.variants.length > 1 && (
                  <button
                    className="btn-secondary"
                    onClick={() => set({ step: "variant-review" })}
                  >
                    ← Back to variants
                  </button>
                )}
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
              <p className="text-stone-400 text-sm">Step 3 of 5</p>
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
                                const { base64, mimeType } = await materialFileToBase64(file);
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
                              const { base64, mimeType } = await materialFileToBase64(file);
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
              <p className="text-stone-400 text-sm">Step 4 of 5 — almost there!</p>
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
              <p className="text-stone-400 text-sm">Step 5 of 5 — almost there!</p>
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
                    `${state.projectName ? state.projectName.replace(/\s+/g, "-").toLowerCase() : "tiba"}-render-${Date.now()}.png`
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
                Start a new project
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
