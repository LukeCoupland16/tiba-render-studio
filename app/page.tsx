"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import type { AppState, AppStep, Surface, SurfaceMaterial, RenderOptions, ReferenceImage, VariantRender } from "@/lib/types";
import { EMPTY_STATE } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import dynamic from "next/dynamic";

const V3Flow = dynamic(() => import("@/app/components/V3Flow"), { ssr: false });

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
// Language picker popup
// ─────────────────────────────────────────────────────────────────────────────

function LanguagePicker({ onSelect }: { onSelect: (lang: Lang) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/90 backdrop-blur-sm animate-fade-in">
      <div className="card p-8 max-w-sm w-full mx-4 space-y-6 text-center">
        <div>
          <div className="w-12 h-12 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-gold text-lg font-bold">T</span>
          </div>
          <h2 className="text-stone-100 text-xl font-semibold font-display">
            Choose your language
          </h2>
          <p className="text-stone-400 text-sm mt-1">Scegli la tua lingua</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onSelect("en")}
            className="p-4 rounded-xl border border-stone-700 bg-stone-900 hover:border-gold/60 hover:bg-gold/5 transition-all text-center group"
          >
            <span className="text-2xl block mb-2">🇬🇧</span>
            <span className="text-stone-100 font-medium text-sm group-hover:text-gold transition-colors">English</span>
          </button>
          <button
            onClick={() => onSelect("it")}
            className="p-4 rounded-xl border border-stone-700 bg-stone-900 hover:border-gold/60 hover:bg-gold/5 transition-all text-center group"
          >
            <span className="text-2xl block mb-2">🇮🇹</span>
            <span className="text-stone-100 font-medium text-sm group-hover:text-gold transition-colors">Italiano</span>
          </button>
        </div>
      </div>
    </div>
  );
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

const STEP_LABELS_EN: Record<AppStep, string> = {
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

const STEP_LABELS_IT: Record<AppStep, string> = {
  upload: "Setup",
  stage1: "Render",
  "variant-review": "Varianti",
  "confirm-base": "Conferma",
  surfaces: "Superfici",
  configure: "Pietra",
  stage3: "Anteprima",
  review: "Revisione",
  "render-options": "Opzioni",
  stage4: "Finale",
  complete: "Fatto",
};

function StepBar({ current, lang }: { current: AppStep; lang: Lang }) {
  const idx = STEP_ORDER.indexOf(current);
  const labels = lang === "it" ? STEP_LABELS_IT : STEP_LABELS_EN;
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
              {labels[step]}
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
// Surface crop
// ─────────────────────────────────────────────────────────────────────────────

function SurfaceCrop({
  imageBase64,
  imageMimeType,
  box,
}: {
  imageBase64: string;
  imageMimeType: string;
  box: [number, number, number, number];
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
  lang,
}: {
  onFile: (file: File) => void;
  accept?: string;
  label: string;
  sublabel?: string;
  previewUrl?: string;
  className?: string;
  lang: Lang;
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
            <span className="text-sm text-white font-medium">{t("misc.clickToChange", lang)}</span>
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
          <span className="text-xs text-stone-600 mt-1">{t("upload.accepted", lang)}</span>
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

// Small "Change" button
function ChangeFileButton({ onFile, lang }: { onFile: (file: File) => void; lang: Lang }) {
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
        {t("config.change", lang)}
      </button>
    </>
  );
}

// Compact inline upload button for surface cards
function SurfaceUploadButton({ onFile, lang }: { onFile: (file: File) => void; lang: Lang }) {
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
            {t("config.uploadMat", lang)}
          </p>
          <p className="text-stone-600 text-xs">{t("config.uploadMatSub", lang)}</p>
        </div>
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading overlay
// ─────────────────────────────────────────────────────────────────────────────

function LoadingCard({ message, lang }: { message: string; lang: Lang }) {
  return (
    <div className="card p-10 flex flex-col items-center gap-6 animate-fade-in">
      <div className="relative">
        <div className="spinner w-12 h-12 border-[3px]" />
        <div className="absolute inset-0 rounded-full border-2 border-gold/20 animate-ping-slow" />
      </div>
      <div className="text-center">
        <p className="text-stone-200 font-medium">{message}</p>
        <p className="text-stone-500 text-sm mt-1">{t("loading.wait", lang)}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error card
// ─────────────────────────────────────────────────────────────────────────────

function ErrorCard({ message, onRetry, lang }: { message: string; onRetry: () => void; lang: Lang }) {
  return (
    <div className="card border-red-900/50 p-8 flex flex-col items-center gap-4 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-full bg-red-900/30 flex items-center justify-center">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <p className="text-stone-200 font-medium">{t("error.title", lang)}</p>
        <p className="text-stone-400 text-sm mt-1">{message}</p>
      </div>
      <button onClick={onRetry} className="btn-secondary text-sm">
        {t("error.retry", lang)}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface helpers
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

function ScalePicker({
  value,
  onChange,
  lang,
}: {
  value: "small" | "medium" | "large";
  onChange: (v: "small" | "medium" | "large") => void;
  lang: Lang;
}) {
  const options = [
    { value: "small" as const, label: t("scale.fine", lang), sublabel: t("scale.fineSub", lang) },
    { value: "medium" as const, label: t("scale.natural", lang), sublabel: t("scale.naturalSub", lang), recommended: true },
    { value: "large" as const, label: t("scale.statement", lang), sublabel: t("scale.statementSub", lang) },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {options.map((opt) => (
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
              {t("scale.recommended", lang)}
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
  lang,
}: {
  value: string;
  onChange: (name: string) => void;
  lang: Lang;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [mapPin, setMapPin] = useState<{ lat: number; lon: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <label className="text-stone-300 text-sm font-medium">
        {t("options.location", lang)} <span className="text-stone-500 font-normal">{t("options.locationOptional", lang)}</span>
      </label>
      <p className="text-stone-500 text-xs">{t("options.locationSub", lang)}</p>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t("options.locationPlaceholder", lang)}
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
  const [lang, setLang] = useState<Lang | null>(null);
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [v3Mode, setV3Mode] = useState(false);

  // ── helpers ────────────────────────────────────────────────────────────────

  // Safe lang accessor (defaults to "en" before selection, but won't render main UI until selected)
  const L = lang ?? "en";

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
      const text = await res.text();
      let msg: string;
      try { msg = (JSON.parse(text) as { error?: string }).error ?? text; }
      catch { msg = text; }
      if (res.status === 413) throw new Error(t("error.tooLarge", L));
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

  async function handleStartGeneration() {
    const base64 = state.screenshotBase64;
    const mimeType = state.screenshotMimeType;

    if (!base64) {
      setError(t("error.uploadFirst", L));
      return;
    }

    set({ error: null, loading: true, step: "stage1", variants: [] });

    try {
      const variants: VariantRender[] = [];
      const refs = state.referenceImages;
      const hasRefs = refs.length > 0;
      const totalCount = hasRefs ? 3 : 1;

      // 1. Standard base render
      set({ loadingMessage: t("loading.standard", L).replace("{n}", "1").replace("{t}", String(totalCount)) });
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
        set({ loadingMessage: t("loading.variantA", L).replace("{n}", "2").replace("{t}", "3") });
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
          title: L === "it" ? "Variante A — Fedele" : "Variant A — Faithful",
          base64: varACompressed.base64,
          mimeType: varACompressed.mimeType,
        });
        set({ variants: [...variants] });

        // 3. Variant B — reference-inspired (creative)
        set({ loadingMessage: t("loading.variantB", L).replace("{n}", "3").replace("{t}", "3") });
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
          title: L === "it" ? "Variante B — Creativa" : "Variant B — Creative",
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
      setError(err instanceof Error ? err.message : t("error.genFailed", L));
    }
  }

  // ── Combine variants based on user feedback ───────────────────────────────

  async function handleCombineVariants() {
    const { screenshotBase64, screenshotMimeType, variants, variantFeedback } = state;

    set({ error: null, loading: true, step: "stage1", loadingMessage: t("loading.combining", L) });
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
      setError(err instanceof Error ? err.message : t("error.combineFailed", L));
      set({ step: "variant-review" });
    }
  }

  // ── Pick a single variant as the base ─────────────────────────────────────

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
    set({ error: null, loading: true, step: "stage1", loadingMessage: t("loading.regenerating", L) });
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
      setError(err instanceof Error ? err.message : t("error.regenFailed", L));
      set({ step: "confirm-base" });
    }
  }

  // ── Stage 2 ───────────────────────────────────────────────────────────────

  async function runStage2() {
    set({ error: null, loading: true, step: "stage1", loadingMessage: t("loading.surfaces", L) });
    try {
      const result = await post<{ surfaces: Surface[] }>("/api/stage2", {
        baseRenderBase64: state.baseRenderBase64,
        baseRenderMimeType: state.baseRenderMimeType,
      });

      const surfaces = result.surfaces;

      if (surfaces.length === 0) {
        setError(t("error.noSurfaces", L));
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
      setError(err instanceof Error ? err.message : t("error.surfaceFailed", L));
      set({ step: "confirm-base" });
    }
  }

  // ── Stage 3 ───────────────────────────────────────────────────────────────

  async function handleGeneratePreviews() {
    const { surfaces, surfaceMaterials, scale } = state;
    const surfacesWithMaterial = surfaces.filter((s) => surfaceMaterials[s.label]);

    if (surfacesWithMaterial.length === 0) {
      setError(t("error.noMaterial", L));
      return;
    }

    const count = surfacesWithMaterial.length;
    set({
      error: null,
      loading: true,
      step: "stage3",
      loadingMessage: t("loading.preview", L).replace("{i}", "1").replace("{n}", String(count)).replace("{label}", surfacesWithMaterial[0].label),
    });

    try {
      const allPreviews: Array<{ surface: string; base64: string; mimeType: string }> = [];

      for (let i = 0; i < surfacesWithMaterial.length; i++) {
        const surface = surfacesWithMaterial[i];
        set({
          loadingMessage: t("loading.preview", L).replace("{i}", String(i + 1)).replace("{n}", String(count)).replace("{label}", surface.label),
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
      setError(err instanceof Error ? err.message : t("error.previewFailed", L));
      set({ step: "configure" });
    }
  }

  // ── Stage 4 ───────────────────────────────────────────────────────────────

  async function handleFinalRender() {
    const { surfaces, surfaceMaterials, scale, renderOptions } = state;
    const surfacesWithMaterial = surfaces.filter((s) => surfaceMaterials[s.label]);
    const count = surfacesWithMaterial.length;

    set({
      error: null,
      loading: true,
      step: "stage4",
      loadingMessage: t("loading.describeMat", L).replace("{i}", "1").replace("{n}", String(count)).replace("{label}", surfacesWithMaterial[0].label),
    });

    try {
      let runningBase64 = state.baseRenderBase64;
      let runningMimeType = state.baseRenderMimeType;

      for (let i = 0; i < surfacesWithMaterial.length; i++) {
        const surface = surfacesWithMaterial[i];
        const mat = surfaceMaterials[surface.label];

        set({ loadingMessage: t("loading.describeMat", L).replace("{i}", String(i + 1)).replace("{n}", String(count)).replace("{label}", surface.label) });
        const { description: materialDescription } = await post<{ description: string }>(
          "/api/describe-stone",
          { stoneBase64: mat.base64, stoneMimeType: mat.mimeType }
        );

        set({ loadingMessage: t("loading.renderSurface", L).replace("{i}", String(i + 1)).replace("{n}", String(count)).replace("{label}", surface.label) });
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
      setError(err instanceof Error ? err.message : t("error.finalFailed", L));
      set({ step: "render-options" });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const { step, loading, loadingMessage, error } = state;

  const canGenerate =
    state.screenshotPreviewUrl !== "" &&
    state.projectName.trim() !== "";

  // ── Language picker (shown first) ─────────────────────────────────────────
  if (lang === null) {
    return <LanguagePicker onSelect={setLang} />;
  }

  // ── Render option labels (translated) ─────────────────────────────────────
  const renderOptionGroups = [
    {
      label: t("options.lighting", L),
      key: "lightingStyle" as keyof RenderOptions,
      options: [
        { value: "natural-daylight", label: t("opt.natural-daylight", L) },
        { value: "golden-hour", label: t("opt.golden-hour", L) },
        { value: "overcast", label: t("opt.overcast", L) },
        { value: "dramatic-spotlight", label: t("opt.dramatic-spotlight", L) },
        { value: "candlelight", label: t("opt.candlelight", L) },
        { value: "blue-hour", label: t("opt.blue-hour", L) },
        { value: "night-interior", label: t("opt.night-interior", L) },
      ],
    },
    {
      label: t("options.timeOfDay", L),
      key: "timeOfDay" as keyof RenderOptions,
      options: [
        { value: "morning", label: t("opt.morning", L) },
        { value: "midday", label: t("opt.midday", L) },
        { value: "afternoon", label: t("opt.afternoon", L) },
        { value: "evening", label: t("opt.evening", L) },
        { value: "night", label: t("opt.night", L) },
      ],
    },
    {
      label: t("options.mood", L),
      key: "mood" as keyof RenderOptions,
      options: [
        { value: "bright-airy", label: t("opt.bright-airy", L) },
        { value: "warm-cosy", label: t("opt.warm-cosy", L) },
        { value: "moody-dramatic", label: t("opt.moody-dramatic", L) },
        { value: "clean-minimal", label: t("opt.clean-minimal", L) },
        { value: "luxurious-opulent", label: t("opt.luxurious-opulent", L) },
        { value: "rustic-natural", label: t("opt.rustic-natural", L) },
      ],
    },
    {
      label: t("options.camera", L),
      key: "cameraStyle" as keyof RenderOptions,
      options: [
        { value: "wide-angle", label: t("opt.wide-angle", L) },
        { value: "standard", label: t("opt.standard", L) },
        { value: "intimate", label: t("opt.intimate", L) },
      ],
    },
  ];

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
                {t("header.title", L)}
              </span>
              {state.projectName && (
                <span className="text-stone-500 text-sm font-normal hidden sm:inline">
                  — {state.projectName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {step !== "upload" && (
              <StepBar current={step} lang={L} />
            )}
            <button
              onClick={() => setLang(L === "en" ? "it" : "en")}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors px-2 py-1 rounded border border-stone-800 hover:border-stone-600"
              title={L === "en" ? "Passa all'italiano" : "Switch to English"}
            >
              {L === "en" ? "🇮🇹" : "🇬🇧"}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 space-y-6">

        {/* ── PROJECT SETUP / UPLOAD ── */}
        {step === "upload" && !loading && !error && v3Mode && (
          <div className="space-y-6 animate-slide-up">
            <V3Flow
              onComplete={(base64, mimeType) => {
                set({
                  screenshotBase64: base64,
                  screenshotMimeType: mimeType,
                  screenshotPreviewUrl: `data:${mimeType};base64,${base64}`,
                });
                setV3Mode(false);
              }}
              onCancel={() => setV3Mode(false)}
            />
          </div>
        )}

        {step === "upload" && !loading && !error && !v3Mode && (
          <div className="space-y-6 animate-slide-up">
            <div className="text-center space-y-3">
              <h1 className="font-display text-3xl sm:text-4xl text-stone-100 leading-tight">
                {t("upload.hero", L)}{" "}
                <span className="text-gold">{t("upload.heroHighlight", L)}</span>
              </h1>
              <p className="text-stone-400 text-base max-w-lg mx-auto">
                {t("upload.subtitle", L)}
              </p>
            </div>

            {/* Mode Toggle */}
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-stone-200 font-medium text-sm">Input Mode</p>
                  <p className="text-stone-500 text-xs mt-0.5">
                    Choose how to provide your architectural geometry
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gold text-stone-950"
                  >
                    SketchUp Screenshot
                  </button>
                  <button
                    onClick={() => setV3Mode(true)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700 hover:border-gold/40 transition-all"
                  >
                    AutoCAD DXF (V3)
                  </button>
                  <Link
                    href="/batch"
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700 hover:border-gold/40 transition-all"
                  >
                    Batch Mode
                  </Link>
                </div>
              </div>
            </div>

            {/* Project name */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-xl font-semibold">{t("upload.projectSetup", L)}</h2>
                <p className="text-stone-400 text-sm mt-1">
                  {t("upload.projectSetupSub", L)}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">{t("upload.projectName", L)}</label>
                <input
                  type="text"
                  value={state.projectName}
                  onChange={(e) => set({ projectName: e.target.value })}
                  placeholder={t("upload.projectNamePlaceholder", L)}
                  className="w-full bg-stone-900 border border-stone-700 text-stone-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 placeholder:text-stone-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">{t("upload.screenshot", L)}</label>
                <DropZone
                  onFile={async (file) => {
                    const { base64, mimeType } = await fileToBase64(file);
                    set({
                      screenshotBase64: base64,
                      screenshotMimeType: mimeType,
                      screenshotPreviewUrl: dataUrl(base64, mimeType),
                    });
                  }}
                  label={t("upload.dropScreenshot", L)}
                  sublabel={t("upload.dropBrowse", L)}
                  previewUrl={state.screenshotPreviewUrl || undefined}
                  className="h-48"
                  lang={L}
                />
              </div>
            </div>

            {/* Reference images */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-lg font-semibold">{t("upload.refTitle", L)}</h2>
                <p className="text-stone-400 text-sm mt-1">
                  {t("upload.refSub", L)}
                </p>
              </div>

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
                          placeholder={t("upload.refNotePlaceholder", L)}
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
                label={t("upload.addRef", L)}
                sublabel={t("upload.addRefSub", L)}
                className="h-28"
              />
            </div>

            {/* Generate button */}
            <div className="card p-5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-stone-200 font-medium text-sm">{t("upload.ready", L)}</p>
                  <p className="text-stone-400 text-xs mt-0.5">
                    {state.referenceImages.length > 0
                      ? t("upload.ready3", L)
                      : t("upload.ready1", L)}
                  </p>
                </div>
                <button
                  className="btn-primary w-full sm:w-auto"
                  disabled={!canGenerate}
                  onClick={() => handleStartGeneration()}
                >
                  {t("upload.generate", L)}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { icon: "🏗️", label: t("upload.feat1", L), sub: t("upload.feat1sub", L) },
                { icon: "🎨", label: t("upload.feat2", L), sub: t("upload.feat2sub", L) },
                { icon: "📐", label: t("upload.feat3", L), sub: t("upload.feat3sub", L) },
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
          <LoadingCard message={loadingMessage} lang={L} />
        )}

        {/* ── ERROR ── */}
        {error && (
          <ErrorCard
            message={error}
            onRetry={() => set({ ...EMPTY_STATE, projectName: state.projectName, referenceImages: state.referenceImages })}
            lang={L}
          />
        )}

        {/* ── VARIANT REVIEW ── */}
        {step === "variant-review" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">{t("variants.step", L)}</p>
              <h2 className="text-stone-100 text-xl font-semibold">{t("variants.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("variants.sub", L)
                  .replace("{n}", String(state.variants.length))
                  .replace("{s}", state.variants.length !== 1 ? (L === "it" ? "i" : "s") : (L === "it" ? "e" : ""))}
              </p>
            </div>

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
                      {t("variants.useThis", L)}
                    </button>
                  </div>
                  <RenderImage base64={variant.base64} mimeType={variant.mimeType} />
                </div>
              ))}
            </div>

            {state.variants.length > 1 && (
              <div className="card p-5 space-y-3">
                <div>
                  <h3 className="text-stone-200 font-medium text-sm">{t("variants.combineTitle", L)}</h3>
                  <p className="text-stone-500 text-xs mt-0.5">
                    {t("variants.combineSub", L)}
                  </p>
                </div>
                <textarea
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                  rows={4}
                  placeholder={t("variants.combinePlaceholder", L)}
                  value={state.variantFeedback}
                  onChange={(e) => set({ variantFeedback: e.target.value })}
                />
                <button
                  className="btn-primary w-full"
                  disabled={!state.variantFeedback.trim()}
                  onClick={handleCombineVariants}
                >
                  {t("variants.combineBtn", L)}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CONFIRM BASE RENDER ── */}
        {step === "confirm-base" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">{t("confirm.step", L)}</p>
              <h2 className="text-stone-100 text-xl font-semibold">{t("confirm.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("confirm.sub", L)}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider px-1">{t("confirm.original", L)}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.screenshotPreviewUrl}
                  alt="Original screenshot"
                  className="w-full rounded-xl border border-stone-800 object-contain bg-stone-900"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider px-1">{t("confirm.render", L)}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dataUrl(state.baseRenderBase64, state.baseRenderMimeType)}
                  alt="Base render"
                  className="w-full rounded-xl border border-stone-800 object-contain bg-stone-900"
                />
              </div>
            </div>

            <div className="card p-5 space-y-3">
              <div>
                <h3 className="text-stone-200 font-medium text-sm">{t("confirm.fixTitle", L)}</h3>
                <p className="text-stone-500 text-xs mt-0.5">
                  {t("confirm.fixSub", L)}
                </p>
              </div>
              <textarea
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                rows={3}
                placeholder={t("confirm.fixPlaceholder", L)}
                value={state.baseRenderFeedback}
                onChange={(e) => set({ baseRenderFeedback: e.target.value })}
              />
              <div className="flex flex-col sm:flex-row gap-3">
                {state.variants.length > 1 && (
                  <button
                    className="btn-secondary"
                    onClick={() => set({ step: "variant-review" })}
                  >
                    {t("confirm.backVariants", L)}
                  </button>
                )}
                <button
                  className="btn-secondary"
                  disabled={!state.baseRenderFeedback.trim()}
                  onClick={handleRegenerateBase}
                >
                  {t("confirm.regenerate", L)}
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={runStage2}
                >
                  {t("confirm.approve", L)}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIGURE ── */}
        {(step === "surfaces" || step === "configure") && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">{t("config.step", L)}</p>
              <h2 className="text-stone-100 text-xl font-semibold">{t("config.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("config.sub", L)
                  .replace("{n}", String(state.surfaces.length))
                  .replace("{s}", state.surfaces.length !== 1 ? (L === "it" ? "i" : "s") : (L === "it" ? "e" : ""))}
              </p>
            </div>

            <div className="space-y-3">
              {state.surfaces.map((surface) => {
                const material = state.surfaceMaterials[surface.label] as SurfaceMaterial | undefined;
                return (
                  <div key={surface.label} className="card p-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                        <div>
                          <p className="text-stone-100 font-semibold text-sm">
                            {friendlyName(surface.label)}
                          </p>
                          <p className="text-stone-400 text-xs mt-0.5">{surface.description}</p>
                        </div>

                        {material ? (
                          <div className="flex items-center gap-3 p-2 rounded-lg bg-stone-800/50 border border-stone-700">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={material.previewUrl}
                              alt="material"
                              className="w-10 h-10 rounded-md object-cover border border-stone-600 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-gold text-xs font-medium">{t("config.matUploaded", L)}</p>
                              <p className="text-stone-500 text-xs">{t("config.matApplied", L)}</p>
                            </div>
                            <ChangeFileButton
                              lang={L}
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
                          <SurfaceUploadButton
                            lang={L}
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
                {t("config.back", L)}
              </button>
              <button
                className="btn-primary flex-1"
                disabled={Object.keys(state.surfaceMaterials).length === 0}
                onClick={handleGeneratePreviews}
              >
                {t("config.generatePreviews", L)}
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
              <p className="text-stone-400 text-sm">{t("review.step", L)}</p>
              <h2 className="text-stone-100 text-xl font-semibold">{t("review.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("review.sub", L)}
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
                    <span className="text-stone-600 text-xs">— {t("review.preview", L)}</span>
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
                <p className="text-stone-200 font-medium text-sm">{t("review.happy", L)}</p>
                <p className="text-stone-400 text-xs mt-0.5">
                  {t("review.happySub", L)}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  className="btn-secondary"
                  onClick={() => set({ step: "configure", previewImages: [] })}
                >
                  {t("review.changeMats", L)}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => set({ step: "render-options" })}
                >
                  {t("review.setOptions", L)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── RENDER OPTIONS ── */}
        {step === "render-options" && !loading && !error && (
          <div className="space-y-6 animate-slide-up">
            <div className="card p-6 space-y-2">
              <p className="text-stone-400 text-sm">{t("options.step", L)}</p>
              <h2 className="text-stone-100 text-xl font-semibold">{t("options.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("options.sub", L)}
              </p>
            </div>

            <div className="card p-6 space-y-5">
              {renderOptionGroups.map(({ label, key, options }) => (
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
                  lang={L}
                />
              </div>
            </div>

            <div className="card p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-stone-200 font-medium text-sm">{t("options.ready", L)}</p>
                <p className="text-stone-400 text-xs mt-0.5">
                  {t("options.readySub", L)}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  className="btn-secondary"
                  onClick={() => set({ step: "review" })}
                >
                  {t("options.backPreview", L)}
                </button>
                <button
                  className="btn-primary"
                  onClick={handleFinalRender}
                >
                  {t("options.createFinal", L)}
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
              <h2 className="text-stone-100 text-2xl font-semibold font-display">{t("complete.title", L)}</h2>
              <p className="text-stone-400 text-sm">
                {t("complete.sub", L)}
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
                {t("complete.download", L)}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setState(EMPTY_STATE)}
              >
                {t("complete.newProject", L)}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-6">
        <p className="text-center text-stone-600 text-xs">
          {t("footer.text", L)}
        </p>
      </footer>
    </div>
  );
}
