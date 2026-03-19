"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  V3State,
  V3Step,
  V3Config,
  DrawingFile,
  DrawingType,
  FloorPlan,
  LayerInfo,
  LayerClassification,
  CapturedView,
} from "@/lib/types-v3";
import { EMPTY_V3_STATE, DEFAULT_V3_CONFIG } from "@/lib/types-v3";

// ─── V3 Step Bar ─────────────────────────────────────────────────────────────

const V3_STEPS: { step: V3Step; label: string }[] = [
  { step: "v3-upload", label: "Upload" },
  { step: "v3-model", label: "3D Model" },
  { step: "v3-capture", label: "Capture" },
];

function V3StepBar({ current }: { current: V3Step }) {
  const currentIdx = V3_STEPS.findIndex((s) => s.step === current);
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {V3_STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.step} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
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
              {s.label}
            </span>
            {i < V3_STEPS.length - 1 && (
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

// ─── Main V3 Flow Component ─────────────────────────────────────────────────

interface V3FlowProps {
  onComplete: (screenshotBase64: string, screenshotMimeType: string) => void;
  onCancel: () => void;
}

export default function V3Flow({ onComplete, onCancel }: V3FlowProps) {
  const [state, setState] = useState<V3State>(EMPTY_V3_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const update = useCallback((patch: Partial<V3State>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-stone-100 text-xl font-semibold font-display">
            V3: AutoCAD to 3D Model
          </h2>
          <p className="text-stone-400 text-sm mt-1">
            Generate a dimensionally accurate 3D model from your architectural drawings
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
        >
          ← Back to SketchUp mode
        </button>
      </div>

      {/* Step bar */}
      <V3StepBar current={state.step} />

      {/* Error display */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/30 text-amber-300 text-sm space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-stone-900 border border-stone-700">
          <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
          <span className="text-stone-300 text-sm">Processing drawings...</span>
        </div>
      )}

      {/* Step content */}
      {state.step === "v3-upload" && (
        <HybridUploadStep
          state={state}
          update={update}
          setLoading={setLoading}
          setError={setError}
          setWarnings={setWarnings}
        />
      )}
      {state.step === "v3-model" && (
        <ModelStep state={state} update={update} />
      )}
      {state.step === "v3-capture" && (
        <CaptureStep state={state} update={update} onComplete={onComplete} />
      )}
    </div>
  );
}

// ─── Step 1: Upload DXF/DWG Files ────────────────────────────────────────────

// ─── Hybrid Upload Step — Image-based AI interpretation ──────────────────────

function HybridUploadStep({
  state,
  update,
  setLoading,
  setError,
  setWarnings,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
  setWarnings: (w: string[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; type: string; base64: string; mimeType: string; previewUrl?: string }>>([]);
  const [buildingWidth, setBuildingWidth] = useState("42");
  const [buildingDepth, setBuildingDepth] = useState("28");

  const handleFiles = useCallback(async (files: FileList) => {
    const newFiles: typeof uploadedFiles = [];

    for (const file of Array.from(files)) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.slice(i, Math.min(i + 8192, bytes.length)));
      }
      const base64 = btoa(binary);

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isPdf = ext === "pdf" || file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");

      if (!isPdf && !isImage) {
        setError(`Unsupported file: ${file.name}. Upload PDF or image files.`);
        continue;
      }

      newFiles.push({
        name: file.name,
        type: isPdf ? "pdf" : "image",
        base64,
        mimeType: isPdf ? "application/pdf" : file.type,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }

    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }, [setError]);

  const removeFile = useCallback((idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const processWithAI = useCallback(async () => {
    if (uploadedFiles.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      // Check if we have a PDF (send all pages) or individual images
      const pdfFile = uploadedFiles.find((f) => f.type === "pdf");
      const imageFiles = uploadedFiles.filter((f) => f.type === "image");

      const payload: Record<string, unknown> = {
        buildingWidth,
        buildingDepth,
      };

      if (pdfFile) {
        payload.pdfBase64 = pdfFile.base64;
      }

      if (imageFiles.length > 0) {
        payload.images = imageFiles.map((f) => ({
          base64: f.base64,
          mimeType: f.mimeType,
        }));
      }

      // If we have neither PDF nor images, error
      if (!pdfFile && imageFiles.length === 0) {
        throw new Error("Upload at least one PDF or image file.");
      }

      const res = await fetch("/api/hybrid-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setWarnings([
        `AI detected: ${data.wallCount} walls, ${data.doorCount} doors, ${data.windowCount || 0} windows, ${data.roomCount} rooms, ${data.columnCount || 0} columns`,
      ]);

      update({
        floorPlan: data.floorPlan,
        step: "v3-model",
      });
    } catch (err: any) {
      setError(err.message || "AI model generation failed");
    } finally {
      setLoading(false);
    }
  }, [uploadedFiles, buildingWidth, buildingDepth, update, setLoading, setError, setWarnings]);

  const hasPdf = uploadedFiles.some((f) => f.type === "pdf");

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className="border-2 border-dashed border-stone-700 rounded-xl p-8 text-center hover:border-gold/40 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-gold/60"); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove("border-gold/60"); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("border-gold/60");
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
        />
        <div className="space-y-2">
          <div className="w-12 h-12 rounded-lg bg-stone-800 border border-stone-700 flex items-center justify-center mx-auto">
            <span className="text-stone-400 text-xl">&#x2B06;</span>
          </div>
          <p className="text-stone-300 font-medium">
            Drop your architectural drawings here
          </p>
          <p className="text-stone-500 text-sm">
            Upload a <strong>PDF drawing set</strong> (plan + sections) or individual <strong>images</strong> of your floor plan.
            AI will analyze all pages and generate a 3D model.
          </p>
        </div>
      </div>

      {/* Uploaded files list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-stone-300 text-sm font-medium">
            Uploaded ({uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""})
          </h3>
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-stone-900 border border-stone-700">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-mono ${
                  f.type === "pdf" ? "bg-red-900/30 text-red-400" : "bg-blue-900/30 text-blue-400"
                }`}>
                  {f.type === "pdf" ? "PDF" : "IMG"}
                </div>
                <div>
                  <span className="text-stone-200 text-sm">{f.name}</span>
                  {f.type === "pdf" && (
                    <p className="text-stone-500 text-xs">All pages will be analyzed</p>
                  )}
                </div>
              </div>
              <button onClick={() => removeFile(i)} className="text-stone-500 hover:text-red-400 text-sm">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Building dimensions */}
      {uploadedFiles.length > 0 && (
        <div className="card p-4 space-y-3">
          <p className="text-stone-300 text-sm font-medium">
            Building Dimensions
          </p>
          <p className="text-stone-500 text-xs">
            {hasPdf
              ? "The AI will read dimensions from the drawings, but providing the overall size helps with accuracy."
              : "Enter the overall building footprint dimensions to help AI scale correctly."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-stone-500 text-xs">Width (m)</label>
              <input
                type="number"
                value={buildingWidth}
                onChange={(e) => setBuildingWidth(e.target.value)}
                className="w-full bg-stone-800 text-stone-200 text-sm rounded-lg px-3 py-2 border border-stone-700 focus:border-gold/50 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-stone-500 text-xs">Depth (m)</label>
              <input
                type="number"
                value={buildingDepth}
                onChange={(e) => setBuildingDepth(e.target.value)}
                className="w-full bg-stone-800 text-stone-200 text-sm rounded-lg px-3 py-2 border border-stone-700 focus:border-gold/50 outline-none font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* Generate button */}
      {uploadedFiles.length > 0 && (
        <button
          onClick={processWithAI}
          className="w-full py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          Generate 3D Model with AI Vision
          {hasPdf && <span className="text-stone-700 text-xs ml-2">(all PDF pages)</span>}
        </button>
      )}
    </div>
  );
}

// ─── Original DXF Upload Step (kept for reference) ───────────────────────────

function UploadStep({
  state,
  update,
  setError,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  setError: (e: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const newDrawings: DrawingFile[] = [...state.drawingFiles];

      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext !== "dxf" && ext !== "dwg") {
          setError(`Unsupported file: ${file.name}. Please upload .dxf or .dwg files.`);
          continue;
        }

        let content: string;

        if (ext === "dwg") {
          // Convert DWG → DXF server-side via ODA File Converter
          try {
            const buffer = await file.arrayBuffer();
            // Convert ArrayBuffer to base64 in chunks (btoa can't handle large files)
            const bytes = new Uint8Array(buffer);
            let binary = "";
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(
                ...bytes.slice(i, Math.min(i + chunkSize, bytes.length)),
              );
            }
            const base64 = btoa(binary);

            const res = await fetch("/api/parse-drawings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "convert-dwg",
                dwgBase64: base64,
                fileName: file.name,
              }),
            });
            const data = await res.json();
            if (data.error) {
              setError(`DWG conversion failed: ${data.error}`);
              continue;
            }
            content = data.dxfContent;
          } catch (err) {
            setError(
              `DWG conversion failed. You can also export DXF from AutoCAD (File → Save As → DXF).`,
            );
            continue;
          }
        } else {
          // Read DXF file as text
          content = await file.text();
        }
        newDrawings.push({
          id: `df-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          type: "unknown",
          dxfContent: content,
        });
      }

      update({ drawingFiles: newDrawings });
    },
    [state.drawingFiles, update, setError],
  );

  const removeFile = useCallback(
    (id: string) => {
      update({
        drawingFiles: state.drawingFiles.filter((f) => f.id !== id),
      });
    },
    [state.drawingFiles, update],
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className="border-2 border-dashed border-stone-700 rounded-xl p-8 text-center hover:border-gold/40 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("border-gold/60");
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove("border-gold/60");
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("border-gold/60");
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.dwg"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
          }}
        />
        <div className="space-y-2">
          <div className="w-12 h-12 rounded-lg bg-stone-800 border border-stone-700 flex items-center justify-center mx-auto">
            <span className="text-stone-400 text-xl">⬆</span>
          </div>
          <p className="text-stone-300 font-medium">
            Drop DXF files here or click to browse
          </p>
          <p className="text-stone-500 text-sm">
            Upload your floor plan and section drawing DXF files
          </p>
        </div>
      </div>

      {/* File list */}
      {state.drawingFiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-stone-300 text-sm font-medium">
            Uploaded Files ({state.drawingFiles.length})
          </h3>
          {state.drawingFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between p-3 rounded-lg bg-stone-900 border border-stone-700"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-stone-800 flex items-center justify-center text-xs text-stone-400 font-mono">
                  DXF
                </div>
                <span className="text-stone-200 text-sm">{f.fileName}</span>
              </div>
              <button
                onClick={() => removeFile(f.id)}
                className="text-stone-500 hover:text-red-400 text-sm transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Continue button */}
      {state.drawingFiles.length > 0 && (
        <button
          onClick={() => update({ step: "v3-classify" })}
          className="w-full py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          Continue — Classify Drawings
        </button>
      )}
    </div>
  );
}

// ─── Step 2: Classify Drawings ───────────────────────────────────────────────

function ClassifyStep({
  state,
  update,
  setError,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  setError: (e: string | null) => void;
}) {
  const setType = useCallback(
    (id: string, type: DrawingType) => {
      update({
        drawingFiles: state.drawingFiles.map((f) =>
          f.id === id ? { ...f, type } : f,
        ),
      });
    },
    [state.drawingFiles, update],
  );

  const hasFloorPlan = state.drawingFiles.some((f) => f.type === "floor-plan");
  const hasSection = state.drawingFiles.some((f) => f.type === "section");
  const allClassified = state.drawingFiles.every((f) => f.type !== "unknown");

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Tell us what each drawing contains. You need at least one floor plan and one section.
      </p>

      {state.drawingFiles.map((f) => (
        <div
          key={f.id}
          className="p-4 rounded-lg bg-stone-900 border border-stone-700 space-y-3"
        >
          <p className="text-stone-200 text-sm font-medium">{f.fileName}</p>
          <div className="flex gap-2">
            {(["floor-plan", "section", "roof-plan", "elevation"] as DrawingType[]).map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setType(f.id, type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    f.type === type
                      ? "bg-gold text-stone-950"
                      : "bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700"
                  }`}
                >
                  {type === "floor-plan"
                    ? "Floor Plan"
                    : type === "section"
                    ? "Section"
                    : type === "roof-plan"
                    ? "Roof Plan"
                    : "Elevation"}
                </button>
              ),
            )}
          </div>
        </div>
      ))}

      {/* Validation messages */}
      {!hasFloorPlan && allClassified && (
        <p className="text-amber-400 text-sm">
          ⚠ No floor plan selected. At least one floor plan is required.
        </p>
      )}
      {!hasSection && allClassified && (
        <p className="text-amber-400 text-sm">
          ⚠ No section selected. Heights will use defaults without section data.
        </p>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => update({ step: "v3-upload" })}
          className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => {
            if (!hasFloorPlan) {
              setError("Please classify at least one file as a Floor Plan.");
              return;
            }
            update({ step: "v3-layers" });
          }}
          disabled={!allClassified || !hasFloorPlan}
          className="flex-1 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue — Review Layers
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Layer Classification ────────────────────────────────────────────

function LayerStep({
  state,
  update,
  setLoading,
  setError,
  setWarnings,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
  setWarnings: (w: string[]) => void;
}) {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Quick-parse layers on mount
  useEffect(() => {
    if (loaded) return;
    const floorPlanFile = state.drawingFiles.find(
      (f) => f.type === "floor-plan",
    );
    if (!floorPlanFile) return;

    setLoading(true);
    fetch("/api/parse-drawings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "quick-parse-layers",
        dxfContent: floorPlanFile.dxfContent,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLayers(data.layers);
        setLoaded(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loaded, state.drawingFiles, setLoading, setError]);

  const updateLayerClassification = useCallback(
    (layerName: string, classification: LayerClassification) => {
      setLayers((prev) =>
        prev.map((l) =>
          l.name === layerName ? { ...l, classification } : l,
        ),
      );
    },
    [],
  );

  const classifications: LayerClassification[] = [
    "wall",
    "door",
    "window",
    "dimension",
    "furniture",
    "annotation",
    "hatch",
    "other",
  ];

  // Only show layers with entities
  const significantLayers = layers.filter((l) => l.entityCount > 0);

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Confirm how each layer should be interpreted. Walls, doors, and windows are
        the most important.
      </p>

      {significantLayers.length > 0 && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {significantLayers.map((layer) => (
            <div
              key={layer.name}
              className="flex items-center justify-between p-3 rounded-lg bg-stone-900 border border-stone-700"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: `hsl(${(layer.color * 37) % 360}, 60%, 50%)`,
                  }}
                />
                <div className="min-w-0">
                  <p className="text-stone-200 text-sm font-mono truncate">
                    {layer.name}
                  </p>
                  <p className="text-stone-500 text-xs">
                    {layer.entityCount} entities
                  </p>
                </div>
              </div>
              <select
                value={layer.classification}
                onChange={(e) =>
                  updateLayerClassification(
                    layer.name,
                    e.target.value as LayerClassification,
                  )
                }
                className="bg-stone-800 text-stone-300 text-sm rounded-lg px-3 py-1.5 border border-stone-700 focus:border-gold/50 outline-none"
              >
                {classifications.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {(["wall", "door", "window"] as const).map((type) => {
          const count = significantLayers.filter(
            (l) => l.classification === type,
          ).length;
          const entities = significantLayers
            .filter((l) => l.classification === type)
            .reduce((sum, l) => sum + l.entityCount, 0);
          return (
            <div
              key={type}
              className={`p-3 rounded-lg border text-center ${
                count > 0
                  ? "bg-green-900/20 border-green-700/30"
                  : "bg-stone-900 border-stone-700"
              }`}
            >
              <p className="text-stone-400 text-xs capitalize">{type}s</p>
              <p
                className={`text-lg font-semibold ${
                  count > 0 ? "text-green-400" : "text-stone-600"
                }`}
              >
                {entities}
              </p>
              <p className="text-stone-500 text-xs">
                {count} layer{count !== 1 ? "s" : ""}
              </p>
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => update({ step: "v3-classify" })}
          className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => {
            // Store layer overrides in a way that the config step can use
            const overrides: Record<string, LayerClassification> = {};
            for (const layer of layers) {
              overrides[layer.name] = layer.classification;
            }
            // Store overrides in config for now (we'll pass to API later)
            update({
              step: "v3-config",
              // @ts-expect-error — layerOverrides is carried forward for processing
              _layerOverrides: overrides,
              _parsedLayers: layers,
            });
          }}
          className="flex-1 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          Continue — Set Dimensions
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Configuration (Heights, Thickness, Units) ───────────────────────

function ConfigStep({
  state,
  update,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
}) {
  const [config, setConfig] = useState<V3Config>(state.config);

  const fields: {
    key: keyof V3Config;
    label: string;
    unit: string;
    min: number;
    max: number;
  }[] = [
    { key: "defaultCeilingHeight", label: "Default Ceiling Height", unit: "mm", min: 1500, max: 8000 },
    { key: "defaultWallThickness", label: "Default Wall Thickness", unit: "mm", min: 50, max: 600 },
    { key: "defaultSillHeight", label: "Default Window Sill Height", unit: "mm", min: 0, max: 2000 },
    { key: "defaultDoorHeadHeight", label: "Default Door Head Height", unit: "mm", min: 1800, max: 3000 },
    { key: "defaultWindowHeadHeight", label: "Default Window Head Height", unit: "mm", min: 1800, max: 3000 },
  ];

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Set default dimensions. These are used when section drawings don&apos;t cover a specific area.
        Section-derived heights always take priority.
      </p>

      {/* Units selector */}
      <div className="p-4 rounded-lg bg-stone-900 border border-stone-700">
        <label className="text-stone-300 text-sm font-medium block mb-2">
          Drawing Units
        </label>
        <div className="flex gap-2">
          {(["mm", "cm", "m", "in", "ft"] as const).map((unit) => (
            <button
              key={unit}
              onClick={() => setConfig((c) => ({ ...c, units: unit }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                config.units === unit
                  ? "bg-gold text-stone-950"
                  : "bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700"
              }`}
            >
              {unit}
            </button>
          ))}
        </div>
      </div>

      {/* Dimension fields */}
      <div className="space-y-3">
        {fields.map((field) => (
          <div
            key={field.key}
            className="p-4 rounded-lg bg-stone-900 border border-stone-700"
          >
            <label className="text-stone-300 text-sm font-medium block mb-2">
              {field.label}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={config[field.key] as number}
                min={field.min}
                max={field.max}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    [field.key]: parseInt(e.target.value) || field.min,
                  }))
                }
                className="flex-1 bg-stone-800 text-stone-200 text-sm rounded-lg px-3 py-2 border border-stone-700 focus:border-gold/50 outline-none font-mono"
              />
              <span className="text-stone-500 text-sm w-8">{field.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => update({ step: "v3-layers" })}
          className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => update({ step: "v3-preview-2d", config })}
          className="flex-1 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          Continue — Process Drawings
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: 2D Preview / Verification (Gate 1) ─────────────────────────────

function Preview2DStep({
  state,
  update,
  setLoading,
  setError,
  setWarnings,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
  setWarnings: (w: string[]) => void;
}) {
  const [processed, setProcessed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Process drawings on mount
  useEffect(() => {
    if (processed) return;
    setProcessed(true);
    setLoading(true);

    // @ts-expect-error — accessing carried-forward overrides
    const layerOverrides = state._layerOverrides || {};

    fetch("/api/parse-drawings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "process",
        drawingFiles: state.drawingFiles,
        config: state.config,
        layerOverrides,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);

        update({ floorPlan: data.floorPlan });
        if (data.warnings) setWarnings(data.warnings);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [processed, state, update, setLoading, setError, setWarnings]);

  // Draw 2D preview when floor plan is ready
  useEffect(() => {
    if (!state.floorPlan || !canvasRef.current) return;
    draw2DPreview(canvasRef.current, state.floorPlan);
  }, [state.floorPlan]);

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Verify that walls, doors, and windows were detected correctly.
        This is a top-down view of the parsed floor plan.
      </p>

      {/* 2D Canvas Preview */}
      {state.floorPlan && (
        <>
          <div className="rounded-xl overflow-hidden border border-stone-700 bg-stone-950">
            <canvas
              ref={canvasRef}
              className="w-full"
              style={{ aspectRatio: "4/3" }}
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: "Walls", value: state.floorPlan.walls.length },
              { label: "Doors", value: state.floorPlan.openings.filter((o) => o.type === "door").length },
              { label: "Windows", value: state.floorPlan.openings.filter((o) => o.type === "window").length },
              { label: "Rooms", value: state.floorPlan.rooms.length },
              { label: "Roof Seg.", value: state.floorPlan.roofSegments.length },
              { label: "Columns", value: state.floorPlan.columns.length },
            ].map((stat) => (
              <div
                key={stat.label}
                className="p-3 rounded-lg bg-stone-900 border border-stone-700 text-center"
              >
                <p className="text-stone-400 text-xs">{stat.label}</p>
                <p className="text-stone-100 text-lg font-semibold">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Room areas */}
          {state.floorPlan.rooms.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-stone-300 text-sm font-medium">
                Detected Rooms
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {state.floorPlan.rooms.map((room) => (
                  <div
                    key={room.id}
                    className="p-3 rounded-lg bg-stone-900 border border-stone-700"
                  >
                    <p className="text-stone-200 text-sm font-medium">
                      {room.label}
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        room.roomType === "interior" ? "bg-blue-900/40 text-blue-400" :
                        room.roomType === "exterior" ? "bg-green-900/40 text-green-400" :
                        "bg-stone-800 text-stone-500"
                      }`}>
                        {room.roomType}
                      </span>
                    </p>
                    <p className="text-stone-500 text-xs">
                      {(room.area / 1e6).toFixed(1)} m²
                      {room.roomType === "interior" && (
                        <> · ceiling {room.ceilingHeight}mm
                          <span className={`ml-1 ${room.heightSource === "section" ? "text-green-400" : "text-amber-400"}`}>
                            ({room.heightSource})
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => update({ step: "v3-config" })}
          className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => update({ step: "v3-model" })}
          disabled={!state.floorPlan}
          className="flex-1 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Looks correct — View 3D Model
        </button>
      </div>
    </div>
  );
}

// ─── Step 6: 3D Model Viewer (Gate 2) ────────────────────────────────────────

function ModelStep({
  state,
  update,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [activePreset, setActivePreset] = useState<string>("");

  useEffect(() => {
    if (!state.floorPlan || !containerRef.current) return;

    // Dynamic import Three.js to avoid SSR issues
    import("@/lib/three/scene-builder").then(({ buildScene }) => {
      const result = buildScene(state.floorPlan!);
      setPresets(result.presets);

      // Set up Three.js renderer
      import("three").then((THREE) => {
        const container = containerRef.current!;
        const width = container.clientWidth;
        const height = 500;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.innerHTML = "";
        container.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(50, width / height, 1, 100000);

        // Set initial camera to first preset
        if (result.presets.length > 0) {
          const preset = result.presets[0];
          camera.position.set(preset.position.x, preset.position.y, preset.position.z);
          camera.lookAt(preset.target.x, preset.target.y, preset.target.z);
          camera.fov = preset.fov;
          camera.updateProjectionMatrix();
          setActivePreset(preset.name);
        }

        // OrbitControls via dynamic import
        import("three/examples/jsm/controls/OrbitControls.js").then(
          ({ OrbitControls }) => {
            const controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            if (result.presets.length > 0) {
              const preset = result.presets[0];
              controls.target.set(preset.target.x, preset.target.y, preset.target.z);
            }

            const animate = () => {
              requestAnimationFrame(animate);
              controls.update();
              renderer.render(result.scene, camera);
            };
            animate();

            rendererRef.current = { renderer, camera, controls, scene: result.scene };
          },
        );
      });
    });

    return () => {
      if (rendererRef.current) {
        rendererRef.current.renderer.dispose();
      }
    };
  }, [state.floorPlan]);

  const applyPreset = useCallback(
    (preset: any) => {
      if (!rendererRef.current) return;
      const { camera, controls } = rendererRef.current;
      camera.position.set(preset.position.x, preset.position.y, preset.position.z);
      controls.target.set(preset.target.x, preset.target.y, preset.target.z);
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
      controls.update();
      setActivePreset(preset.name);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Explore the 3D model. Use mouse to orbit, scroll to zoom, right-click to pan.
        Select a camera preset or position the camera manually.
      </p>

      {/* 3D Viewer */}
      <div
        ref={containerRef}
        className="rounded-xl overflow-hidden border border-stone-700 bg-stone-950"
        style={{ height: 500 }}
      />

      {/* Camera presets */}
      {presets.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-stone-300 text-sm font-medium">Camera Presets</h3>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  activePreset === preset.name
                    ? "bg-gold text-stone-950 font-medium"
                    : "bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => update({ step: "v3-preview-2d" })}
          className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => update({ step: "v3-capture" })}
          className="flex-1 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          Model looks correct — Capture Views
        </button>
      </div>
    </div>
  );
}

// ─── Step 7: View Capture (Gate 3) ───────────────────────────────────────────

function CaptureStep({
  state,
  update,
  onComplete,
}: {
  state: V3State;
  update: (p: Partial<V3State>) => void;
  onComplete: (base64: string, mimeType: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const [captures, setCaptures] = useState<CapturedView[]>([]);
  const [presets, setPresets] = useState<any[]>([]);

  useEffect(() => {
    if (!state.floorPlan || !containerRef.current) return;

    import("@/lib/three/scene-builder").then(({ buildScene }) => {
      const result = buildScene(state.floorPlan!);
      setPresets(result.presets);

      import("three").then((THREE) => {
        const container = containerRef.current!;
        const width = container.clientWidth;
        const height = 500;

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true, // needed for toDataURL
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(2); // high DPI for capture quality
        container.innerHTML = "";
        container.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(50, width / height, 1, 100000);

        if (result.presets.length > 0) {
          const preset = result.presets[0];
          camera.position.set(preset.position.x, preset.position.y, preset.position.z);
          camera.lookAt(preset.target.x, preset.target.y, preset.target.z);
          camera.fov = preset.fov;
          camera.updateProjectionMatrix();
        }

        import("three/examples/jsm/controls/OrbitControls.js").then(
          ({ OrbitControls }) => {
            const controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            if (result.presets.length > 0) {
              const preset = result.presets[0];
              controls.target.set(preset.target.x, preset.target.y, preset.target.z);
            }

            const animate = () => {
              requestAnimationFrame(animate);
              controls.update();
              renderer.render(result.scene, camera);
            };
            animate();

            rendererRef.current = { renderer, camera, controls, scene: result.scene };
          },
        );
      });
    });

    return () => {
      if (rendererRef.current) {
        rendererRef.current.renderer.dispose();
      }
    };
  }, [state.floorPlan]);

  const captureView = useCallback(() => {
    if (!rendererRef.current) return;
    const { renderer, scene, camera } = rendererRef.current;

    // Force render
    renderer.render(scene, camera);

    // Capture as PNG
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];

    const newCapture: CapturedView = {
      id: `cap-${Date.now()}`,
      label: `View ${captures.length + 1}`,
      base64,
      mimeType: "image/png",
      presetName: "custom",
    };

    setCaptures((prev) => [...prev, newCapture]);
  }, [captures.length]);

  const capturePreset = useCallback(
    (preset: any) => {
      if (!rendererRef.current) return;
      const { renderer, camera, controls, scene } = rendererRef.current;

      camera.position.set(preset.position.x, preset.position.y, preset.position.z);
      controls.target.set(preset.target.x, preset.target.y, preset.target.z);
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
      controls.update();

      // Need a frame to render
      renderer.render(scene, camera);

      const dataUrl = renderer.domElement.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];

      const newCapture: CapturedView = {
        id: `cap-${Date.now()}`,
        label: preset.label,
        base64,
        mimeType: "image/png",
        presetName: preset.name,
      };

      setCaptures((prev) => [...prev, newCapture]);
    },
    [],
  );

  const removeCapture = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const useCapture = useCallback(
    (capture: CapturedView) => {
      onComplete(capture.base64, capture.mimeType);
    },
    [onComplete],
  );

  return (
    <div className="space-y-4">
      <p className="text-stone-400 text-sm">
        Position the camera and capture views. Each captured view can be rendered
        through the full pipeline.
      </p>

      {/* 3D Viewer */}
      <div
        ref={containerRef}
        className="rounded-xl overflow-hidden border border-stone-700 bg-stone-950"
        style={{ height: 500 }}
      />

      {/* Capture controls */}
      <div className="flex gap-3">
        <button
          onClick={captureView}
          className="px-6 py-3 rounded-xl bg-gold text-stone-950 font-semibold hover:bg-gold/90 transition-colors"
        >
          📸 Capture Current View
        </button>
        <div className="flex-1" />
        {presets.length > 0 && (
          <div className="flex gap-2">
            {presets.slice(0, 4).map((preset) => (
              <button
                key={preset.name}
                onClick={() => capturePreset(preset)}
                className="px-3 py-2 rounded-lg bg-stone-800 text-stone-400 text-sm hover:text-stone-200 border border-stone-700 transition-colors"
                title={`Capture: ${preset.label}`}
              >
                📸 {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Captured views gallery */}
      {captures.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-stone-300 text-sm font-medium">
            Captured Views ({captures.length})
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {captures.map((capture) => (
              <div
                key={capture.id}
                className="rounded-lg border border-stone-700 overflow-hidden bg-stone-900"
              >
                <img
                  src={`data:${capture.mimeType};base64,${capture.base64}`}
                  alt={capture.label}
                  className="w-full aspect-video object-cover"
                />
                <div className="p-3 flex items-center justify-between">
                  <span className="text-stone-300 text-sm">{capture.label}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => useCapture(capture)}
                      className="px-3 py-1.5 rounded-lg bg-gold text-stone-950 text-xs font-medium hover:bg-gold/90 transition-colors"
                    >
                      Use for Render
                    </button>
                    <button
                      onClick={() => removeCapture(capture.id)}
                      className="px-2 py-1.5 rounded-lg text-stone-500 hover:text-red-400 text-xs transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => update({ step: "v3-model" })}
        className="px-6 py-3 rounded-xl bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
      >
        Back to Model
      </button>
    </div>
  );
}

// ─── 2D Canvas Drawing ───────────────────────────────────────────────────────

function draw2DPreview(canvas: HTMLCanvasElement, floorPlan: FloorPlan): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { bounds } = floorPlan;
  const padding = 40;
  const drawWidth = bounds.maxX - bounds.minX;
  const drawHeight = bounds.maxY - bounds.minY;

  // Set canvas size
  const canvasWidth = canvas.clientWidth * 2; // 2x for retina
  const aspectRatio = drawHeight / drawWidth;
  const canvasHeight = canvasWidth * Math.min(aspectRatio, 0.75);

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Scale to fit
  const scaleX = (canvasWidth - padding * 2) / drawWidth;
  const scaleY = (canvasHeight - padding * 2) / drawHeight;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = padding + (canvasWidth - padding * 2 - drawWidth * scale) / 2;
  const offsetY = padding + (canvasHeight - padding * 2 - drawHeight * scale) / 2;

  function tx(x: number): number {
    return offsetX + (x - bounds.minX) * scale;
  }
  function ty(y: number): number {
    // Flip Y axis (DXF Y goes up, canvas Y goes down)
    return canvasHeight - offsetY - (y - bounds.minY) * scale;
  }

  // Background
  ctx.fillStyle = "#0c0a09";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw rooms (filled)
  for (const room of floorPlan.rooms) {
    if (room.boundary.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(tx(room.boundary[0].x), ty(room.boundary[0].y));
    for (let i = 1; i < room.boundary.length; i++) {
      ctx.lineTo(tx(room.boundary[i].x), ty(room.boundary[i].y));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(200, 180, 160, 0.08)";
    ctx.fill();

    // Room label
    const labelX = tx(room.centroid.x);
    const labelY = ty(room.centroid.y);
    ctx.fillStyle = "rgba(200, 180, 160, 0.5)";
    ctx.font = `${Math.max(10, scale * 200)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.label, labelX, labelY);
  }

  // Draw walls
  ctx.strokeStyle = "#e8e0d8";
  ctx.lineWidth = Math.max(2, scale * 100); // approximate wall thickness on screen

  for (const wall of floorPlan.walls) {
    ctx.beginPath();
    ctx.moveTo(tx(wall.start.x), ty(wall.start.y));
    ctx.lineTo(tx(wall.end.x), ty(wall.end.y));

    // Color-code by height source
    ctx.strokeStyle =
      wall.heightSource === "section"
        ? "#86efac" // green
        : "#e8e0d8"; // default warm grey
    ctx.lineWidth = Math.max(2, wall.thickness * scale * 0.8);
    ctx.stroke();
  }

  // Draw openings
  for (const opening of floorPlan.openings) {
    const wall = floorPlan.walls.find((w) => w.id === opening.wallId);
    if (!wall) continue;

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) continue;

    const ux = dx / wallLen;
    const uy = dy / wallLen;

    const centerX = wall.start.x + opening.position * ux;
    const centerY = wall.start.y + opening.position * uy;
    const halfW = opening.width / 2;

    const x1 = tx(centerX - halfW * ux);
    const y1 = ty(centerY - halfW * uy);
    const x2 = tx(centerX + halfW * ux);
    const y2 = ty(centerY + halfW * uy);

    // Draw opening as a gap with colored markers
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = opening.type === "door" ? "#fbbf24" : "#60a5fa"; // gold for doors, blue for windows
    ctx.lineWidth = Math.max(3, wall.thickness * scale * 0.5);
    ctx.stroke();

    // Small dot at center
    ctx.beginPath();
    ctx.arc((x1 + x2) / 2, (y1 + y2) / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = opening.type === "door" ? "#fbbf24" : "#60a5fa";
    ctx.fill();
  }

  // Legend
  const legendY = canvasHeight - 20;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";

  ctx.fillStyle = "#e8e0d8";
  ctx.fillRect(20, legendY - 6, 12, 3);
  ctx.fillStyle = "#a8a29e";
  ctx.fillText("Walls", 36, legendY);

  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(90, legendY - 6, 12, 3);
  ctx.fillStyle = "#a8a29e";
  ctx.fillText("Doors", 106, legendY);

  ctx.fillStyle = "#60a5fa";
  ctx.fillRect(160, legendY - 6, 12, 3);
  ctx.fillStyle = "#a8a29e";
  ctx.fillText("Windows", 176, legendY);

  ctx.fillStyle = "#86efac";
  ctx.fillRect(250, legendY - 6, 12, 3);
  ctx.fillStyle = "#a8a29e";
  ctx.fillText("Section height", 266, legendY);
}
