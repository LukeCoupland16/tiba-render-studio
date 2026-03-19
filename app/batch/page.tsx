"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import type {
  BatchState,
  BatchRenderSlot,
  BatchReference,
} from "@/lib/batch-types";
import { buildSlots, EMPTY_BATCH_STATE } from "@/lib/batch-types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirrored from page.tsx — kept local to avoid coupling)
// ─────────────────────────────────────────────────────────────────────────────

function compressImageSrc(
  src: string
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const MAX = 1920;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
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

function fileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () =>
      compressImageSrc(reader.result as string).then(resolve).catch(reject);
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
// Drop zone components
// ─────────────────────────────────────────────────────────────────────────────

function DropZone({
  onFile,
  label,
  sublabel,
  previewUrl,
  className = "",
}: {
  onFile: (file: File) => void;
  label: string;
  sublabel?: string;
  previewUrl?: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""} ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
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
            <span className="text-sm text-white font-medium">
              Click to change
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 p-8 text-center select-none">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-stone-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
          <div>
            <p className="text-stone-200 font-medium text-sm">{label}</p>
            {sublabel && (
              <p className="text-stone-500 text-xs mt-1">{sublabel}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main batch page
// ─────────────────────────────────────────────────────────────────────────────

const CONCURRENCY = 2;

export default function BatchPage() {
  const [state, setState] = useState<BatchState>(EMPTY_BATCH_STATE);

  const set = useCallback(
    (patch: Partial<BatchState>) =>
      setState((prev) => ({ ...prev, ...patch })),
    []
  );

  const updateSlot = useCallback(
    (id: string, patch: Partial<BatchRenderSlot>) =>
      setState((prev) => ({
        ...prev,
        slots: prev.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),
    []
  );

  // ── Reference management ──────────────────────────────────────────────────

  const addReference = useCallback(
    async (file: File, index: number) => {
      const { base64, mimeType } = await fileToBase64(file);
      setState((prev) => {
        const refs = [...prev.references];
        refs[index] = {
          base64,
          mimeType,
          previewUrl: dataUrl(base64, mimeType),
          inspirationNote: "",
        };
        return { ...prev, references: refs };
      });
    },
    []
  );

  const updateRefNote = useCallback((index: number, note: string) => {
    setState((prev) => {
      const refs = [...prev.references];
      if (refs[index]) refs[index] = { ...refs[index], inspirationNote: note };
      return { ...prev, references: refs };
    });
  }, []);

  // ── Screenshot upload ─────────────────────────────────────────────────────

  const handleScreenshot = useCallback(async (file: File) => {
    const { base64, mimeType } = await fileToBase64(file);
    set({
      screenshotBase64: base64,
      screenshotMimeType: mimeType,
      screenshotPreviewUrl: dataUrl(base64, mimeType),
    });
  }, [set]);

  // ── Batch generation ──────────────────────────────────────────────────────

  async function generateSlot(slot: BatchRenderSlot) {
    updateSlot(slot.id, { status: "generating" });

    try {
      if (slot.type === "base") {
        const res = await fetch("/api/stage1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshotBase64: state.screenshotBase64,
            screenshotMimeType: state.screenshotMimeType,
            framing: slot.framing,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const compressed = await compressImageSrc(
          dataUrl(data.baseRenderBase64, data.baseRenderMimeType)
        );
        updateSlot(slot.id, {
          status: "done",
          base64: compressed.base64,
          mimeType: compressed.mimeType,
        });
      } else {
        const ref = state.references[slot.referenceIndex!];
        const res = await fetch("/api/stage1-variant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshotBase64: state.screenshotBase64,
            screenshotMimeType: state.screenshotMimeType,
            references: [
              {
                base64: ref.base64,
                mimeType: ref.mimeType,
                note: ref.inspirationNote || "Use this as style reference",
              },
            ],
            variantLabel: "A", // faithful interpretation for all batch variants
            framing: slot.framing,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const compressed = await compressImageSrc(
          dataUrl(data.base64, data.mimeType)
        );
        updateSlot(slot.id, {
          status: "done",
          base64: compressed.base64,
          mimeType: compressed.mimeType,
        });
      }
    } catch (err) {
      updateSlot(slot.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Generation failed",
      });
    }
  }

  async function runBatch() {
    const slots = buildSlots();
    set({ step: "generating", slots });

    // Throttled parallel: CONCURRENCY at a time
    for (let i = 0; i < slots.length; i += CONCURRENCY) {
      const chunk = slots.slice(i, i + CONCURRENCY);
      await Promise.allSettled(chunk.map((slot) => generateSlot(slot)));
    }

    set({ step: "results" });
  }

  // ── Drive export ──────────────────────────────────────────────────────────

  async function exportToDrive() {
    set({ driveUploading: true, driveError: "" });

    try {
      const completedSlots = state.slots.filter(
        (s) => s.status === "done" && s.base64
      );

      const images = [
        // Include the original SketchUp screenshot
        {
          base64: state.screenshotBase64,
          mimeType: state.screenshotMimeType,
          filename: `${state.projectName || "batch"}_00_sketchup-original.jpg`,
        },
        // Include reference images
        ...state.references.map((ref, i) => ({
          base64: ref.base64,
          mimeType: ref.mimeType,
          filename: `${state.projectName || "batch"}_00_reference-${i + 1}.jpg`,
        })),
        // Include all completed renders
        ...completedSlots.map((s) => ({
          base64: s.base64!,
          mimeType: s.mimeType!,
          filename: `${state.projectName || "batch"}_${s.id}.jpg`,
        })),
      ];

      const res = await fetch("/api/drive-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: state.projectName || "Batch Render",
          images,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      set({ driveUploading: false, driveUrl: data.folderUrl });
    } catch (err) {
      set({
        driveUploading: false,
        driveError:
          err instanceof Error ? err.message : "Drive upload failed",
      });
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const canGenerate =
    state.screenshotBase64 &&
    state.references.length === 3 &&
    state.references.every((r) => r.base64);

  const completedCount = state.slots.filter((s) => s.status === "done").length;
  const errorCount = state.slots.filter((s) => s.status === "error").length;
  const totalSlots = state.slots.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-stone-100">
              Batch Render{" "}
              <span className="text-gold">Studio</span>
            </h1>
            <p className="text-stone-400 text-sm mt-1">
              Generate 8 render variants from one SketchUp model
            </p>
          </div>
          <Link
            href="/"
            className="btn-secondary text-xs"
          >
            Single Render Mode
          </Link>
        </div>

        {/* ── UPLOAD PHASE ── */}
        {state.step === "upload" && (
          <div className="space-y-6 animate-slide-up">
            {/* Project name */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-xl font-semibold">
                  Project Setup
                </h2>
                <p className="text-stone-400 text-sm mt-1">
                  Upload your SketchUp screenshot and 3 reference images
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">
                  Project Name
                </label>
                <input
                  type="text"
                  value={state.projectName}
                  onChange={(e) => set({ projectName: e.target.value })}
                  placeholder="e.g. Villa Candidasa"
                  className="w-full bg-stone-900 border border-stone-700 text-stone-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 placeholder:text-stone-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-stone-300 text-sm font-medium">
                  SketchUp Screenshot
                </label>
                <DropZone
                  onFile={handleScreenshot}
                  label="Drop your SketchUp screenshot"
                  sublabel="PNG, JPG — this is the spatial blueprint"
                  previewUrl={state.screenshotPreviewUrl || undefined}
                  className="h-48"
                />
              </div>
            </div>

            {/* Reference images — 3 required */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-stone-100 text-lg font-semibold">
                  Reference Images (3 required)
                </h2>
                <p className="text-stone-400 text-sm mt-1">
                  Each reference will generate 2 variants: standard framing + grand scale
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => {
                  const ref = state.references[i] as BatchReference | undefined;
                  return (
                    <div key={i} className="space-y-2">
                      <label className="text-stone-300 text-sm font-medium">
                        Reference {i + 1}
                      </label>
                      <DropZone
                        onFile={(file) => addReference(file, i)}
                        label={`Drop reference ${i + 1}`}
                        previewUrl={ref?.previewUrl}
                        className="h-36"
                      />
                      {ref && (
                        <textarea
                          value={ref.inspirationNote}
                          onChange={(e) => updateRefNote(i, e.target.value)}
                          placeholder="What to draw inspiration from..."
                          className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-gold/60 transition-colors"
                          rows={2}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* What will be generated */}
            <div className="card p-6 space-y-3">
              <h3 className="text-stone-200 text-sm font-semibold">
                What will be generated
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {buildSlots().map((slot) => (
                  <div
                    key={slot.id}
                    className="bg-stone-800/50 border border-stone-700 rounded-lg p-3 text-center"
                  >
                    <p className="text-stone-300 font-medium">{slot.label}</p>
                    <p className="text-stone-500 mt-0.5">
                      {slot.framing === "grand-scale" ? "Wide angle" : "Standard angle"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <div className="card p-5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-stone-200 font-medium text-sm">
                    Ready to generate 8 variants
                  </p>
                  <p className="text-stone-400 text-xs mt-0.5">
                    4 renders at a time, ~2-3 minutes total
                  </p>
                </div>
                <button
                  className="btn-primary w-full sm:w-auto"
                  disabled={!canGenerate}
                  onClick={runBatch}
                >
                  Generate All
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── GENERATING PHASE ── */}
        {state.step === "generating" && (
          <div className="space-y-6 animate-slide-up">
            {/* Progress header */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-stone-100 text-xl font-semibold">
                    Generating Renders
                  </h2>
                  <p className="text-stone-400 text-sm mt-1">
                    {completedCount + errorCount}/{totalSlots} complete
                    {errorCount > 0 && (
                      <span className="text-red-400 ml-2">
                        ({errorCount} failed)
                      </span>
                    )}
                  </p>
                </div>
                <div className="spinner" />
              </div>
              <div className="w-full bg-stone-800 rounded-full h-2">
                <div
                  className="bg-gold h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${((completedCount + errorCount) / totalSlots) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Original SketchUp pinned at top */}
            <div className="card p-4">
              <p className="text-stone-400 text-xs font-medium mb-2 uppercase tracking-wider">
                Original SketchUp Model
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.screenshotPreviewUrl}
                alt="SketchUp original"
                className="w-full max-h-64 object-contain rounded-lg"
              />
            </div>

            {/* Render grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {state.slots.map((slot) => (
                <div key={slot.id} className="card overflow-hidden">
                  <div className="aspect-[4/3] bg-stone-800/50 relative">
                    {slot.status === "pending" && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-stone-600 text-xs">Queued</p>
                      </div>
                    )}
                    {slot.status === "generating" && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="spinner" />
                        <p className="text-stone-400 text-xs">Generating...</p>
                      </div>
                    )}
                    {slot.status === "done" && slot.base64 && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={dataUrl(slot.base64, slot.mimeType!)}
                        alt={slot.label}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {slot.status === "error" && (
                      <div className="absolute inset-0 flex items-center justify-center p-3">
                        <p className="text-red-400 text-xs text-center">
                          {slot.error || "Failed"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-stone-800">
                    <p className="text-stone-200 text-xs font-medium truncate">
                      {slot.label}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RESULTS PHASE ── */}
        {state.step === "results" && (
          <div className="space-y-6 animate-slide-up">
            {/* Header with actions */}
            <div className="card p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-stone-100 text-xl font-semibold">
                    Batch Results
                  </h2>
                  <p className="text-stone-400 text-sm mt-1">
                    {completedCount} of {totalSlots} renders completed
                    {errorCount > 0 && (
                      <span className="text-red-400 ml-2">
                        ({errorCount} failed)
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    className="btn-primary"
                    onClick={exportToDrive}
                    disabled={state.driveUploading || completedCount === 0}
                  >
                    {state.driveUploading ? (
                      <>
                        <div className="spinner !w-4 !h-4" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        Export to Google Drive
                      </>
                    )}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => set(EMPTY_BATCH_STATE)}
                  >
                    New Batch
                  </button>
                </div>
              </div>

              {state.driveUrl && (
                <div className="mt-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg">
                  <p className="text-green-300 text-sm">
                    Uploaded to Google Drive:{" "}
                    <a
                      href={state.driveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-green-200"
                    >
                      Open folder
                    </a>
                  </p>
                </div>
              )}

              {state.driveError && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
                  <p className="text-red-300 text-sm">{state.driveError}</p>
                </div>
              )}
            </div>

            {/* Results gallery — each render side-by-side with SketchUp original */}
            <div className="space-y-4">
              {state.slots
                .filter((s) => s.status === "done" && s.base64)
                .map((slot) => (
                  <div key={slot.id} className="card overflow-hidden">
                    <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            slot.framing === "grand-scale"
                              ? "bg-blue-400"
                              : "bg-stone-400"
                          }`}
                        />
                        <span className="text-stone-200 text-sm font-medium">
                          {slot.label}
                        </span>
                        {slot.framing === "grand-scale" && (
                          <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700/40">
                            Wide angle
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          downloadImage(
                            slot.base64!,
                            slot.mimeType!,
                            `${state.projectName || "batch"}_${slot.id}.jpg`
                          )
                        }
                        className="text-stone-400 hover:text-gold transition-colors"
                        title="Download"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="grid grid-cols-2">
                      {/* Original SketchUp */}
                      <div className="relative border-r border-stone-800">
                        <div className="absolute top-2 left-2 z-10 bg-black/60 text-stone-300 text-xs px-2 py-1 rounded">
                          SketchUp Original
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={state.screenshotPreviewUrl}
                          alt="SketchUp original"
                          className="w-full aspect-[4/3] object-contain bg-stone-900"
                        />
                      </div>
                      {/* Render */}
                      <div className="relative">
                        <div className="absolute top-2 left-2 z-10 bg-black/60 text-stone-300 text-xs px-2 py-1 rounded">
                          Render
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={dataUrl(slot.base64!, slot.mimeType!)}
                          alt={slot.label}
                          className="w-full aspect-[4/3] object-contain bg-stone-900"
                        />
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            {/* Failed renders */}
            {state.slots.some((s) => s.status === "error") && (
              <div className="card p-4 space-y-2">
                <h3 className="text-red-400 text-sm font-medium">
                  Failed Renders
                </h3>
                {state.slots
                  .filter((s) => s.status === "error")
                  .map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between bg-red-900/20 rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="text-stone-300">{slot.label}</span>
                      <span className="text-red-400 text-xs">
                        {slot.error}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
