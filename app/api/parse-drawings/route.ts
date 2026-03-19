/**
 * API Route: /api/parse-drawings
 *
 * Accepts DXF file content and configuration, returns parsed FloorPlan JSON.
 * Handles the full pipeline: parse → detect walls → detect openings →
 * detect rooms → parse sections → cross-reference heights.
 */

import { NextRequest, NextResponse } from "next/server";
import type { DrawingFile, V3Config, LayerClassification } from "@/lib/types-v3";
import { processDrawings, quickParseLayers } from "@/lib/dxf";
import { convertDwgToDxf, isConverterAvailable } from "@/lib/dwg/converter";

// Allow large request bodies for DWG file uploads (up to 20MB)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─── POST: Full Drawing Processing ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "quick-parse-layers") {
      return handleQuickParseLayers(body);
    }

    if (action === "process") {
      return handleProcess(body);
    }

    if (action === "convert-dwg") {
      return await handleConvertDwg(body);
    }

    if (action === "check-converter") {
      return NextResponse.json({ available: isConverterAvailable() });
    }

    return NextResponse.json(
      { error: "Unknown action. Use 'quick-parse-layers', 'process', 'convert-dwg', or 'check-converter'." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[parse-drawings] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// ─── Quick Parse: Extract Layers Only ────────────────────────────────────────

interface QuickParseRequest {
  action: "quick-parse-layers";
  dxfContent: string;
}

function handleQuickParseLayers(body: QuickParseRequest) {
  const { dxfContent } = body;

  if (!dxfContent) {
    return NextResponse.json(
      { error: "dxfContent is required" },
      { status: 400 },
    );
  }

  const layers = quickParseLayers(dxfContent);

  return NextResponse.json({ layers });
}

// ─── Full Processing ─────────────────────────────────────────────────────────

interface ProcessRequest {
  action: "process";
  drawingFiles: DrawingFile[];
  config: V3Config;
  layerOverrides?: Record<string, LayerClassification>;
}

function handleProcess(body: ProcessRequest) {
  const { drawingFiles, config, layerOverrides } = body;

  if (!drawingFiles || drawingFiles.length === 0) {
    return NextResponse.json(
      { error: "At least one drawing file is required" },
      { status: 400 },
    );
  }

  if (!config) {
    return NextResponse.json(
      { error: "V3 configuration is required" },
      { status: 400 },
    );
  }

  // Convert layer overrides from plain object to Map
  const overridesMap = layerOverrides
    ? new Map(Object.entries(layerOverrides) as [string, LayerClassification][])
    : undefined;

  const result = processDrawings(drawingFiles, config, overridesMap);

  return NextResponse.json({
    floorPlan: result.floorPlan,
    crossRefResult: result.crossRefResult,
    warnings: result.warnings,
  });
}

// ─── DWG → DXF Conversion ────────────────────────────────────────────────────

interface ConvertDwgRequest {
  action: "convert-dwg";
  /** Base64-encoded DWG file content */
  dwgBase64: string;
  fileName: string;
}

async function handleConvertDwg(body: ConvertDwgRequest) {
  const { dwgBase64, fileName } = body;

  if (!dwgBase64 || !fileName) {
    return NextResponse.json(
      { error: "dwgBase64 and fileName are required" },
      { status: 400 },
    );
  }

  const dwgBuffer = Buffer.from(dwgBase64, "base64");
  const dxfContent = await convertDwgToDxf(dwgBuffer, fileName);

  return NextResponse.json({ dxfContent });
}
