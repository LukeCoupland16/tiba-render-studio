/**
 * DXF Module — Main entry point that orchestrates the full parsing pipeline.
 *
 * Pipeline: DXF Content → Parse → Detect Walls → Detect Openings →
 *           Detect Rooms → Parse Sections → Cross-Reference Heights → FloorPlan
 */

import { v4 as uuid } from "uuid";
import type {
  FloorPlan,
  DrawingFile,
  V3Config,
  LayerInfo,
  LayerClassification,
  RoofSegment,
  RoofPlanData,
  Column,
  SectionData,
  Point2D,
} from "../types-v3";
import { parseDxf, detectBuildingZone, normalizeEntities, computeEntityBounds, type DxfParseResult } from "./parser";
import { detectWalls } from "./wall-detector";
import { detectOpenings } from "./opening-detector";
import { detectRooms } from "./room-detector";
import { parseSection } from "./section-parser";
import { parseRoofPlan } from "./roof-plan-parser";
import { combineRoofData } from "./roof-combiner";
import { applySectionHeights, type CrossReferenceResult } from "./cross-reference";

// ─── Main Processing Pipeline ────────────────────────────────────────────────

export interface ProcessingResult {
  floorPlan: FloorPlan;
  crossRefResult: CrossReferenceResult | null;
  warnings: string[];
}

/**
 * Process a set of drawing files into a complete FloorPlan.
 *
 * @param drawingFiles - Classified drawing files (floor plan + sections)
 * @param config - V3 configuration
 * @param layerOverrides - Optional user overrides for layer classification
 */
export function processDrawings(
  drawingFiles: DrawingFile[],
  config: V3Config,
  layerOverrides?: Map<string, LayerClassification>,
): ProcessingResult {
  const warnings: string[] = [];

  // Find the floor plan file
  const floorPlanFile = drawingFiles.find((f) => f.type === "floor-plan");
  if (!floorPlanFile) {
    throw new Error("No floor plan drawing found. Please upload at least one floor plan.");
  }

  // Parse the floor plan DXF
  let parseResult: DxfParseResult;
  try {
    parseResult = parseDxf(floorPlanFile.dxfContent);
  } catch (err) {
    throw new Error(`Failed to parse floor plan DXF: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Apply user layer classification overrides
  const layers = parseResult.layers.map((layer) => {
    if (layerOverrides?.has(layer.name)) {
      return { ...layer, classification: layerOverrides.get(layer.name)! };
    }
    return layer;
  });

  // Normalize coordinates if needed (survey/UTM → local building space)
  const buildingZone = detectBuildingZone({ ...parseResult, layers });
  let workingEntities = parseResult.entities;
  let normalizedBounds = parseResult.bounds;

  if (buildingZone) {
    workingEntities = normalizeEntities(
      parseResult.entities,
      buildingZone.offset,
      buildingZone.buildingBounds,
    );
    normalizedBounds = computeEntityBounds(workingEntities);
    warnings.push(
      `Coordinates normalized: offset (${(buildingZone.offset.x / 1000).toFixed(1)}m, ${(buildingZone.offset.y / 1000).toFixed(1)}m). ` +
      `Building zone: ${((normalizedBounds.maxX - normalizedBounds.minX) / 1000).toFixed(1)}m × ${((normalizedBounds.maxY - normalizedBounds.minY) / 1000).toFixed(1)}m.`,
    );
  }

  // Detect walls
  const walls = detectWalls(workingEntities, layers, config);
  if (walls.length === 0) {
    warnings.push("No walls detected. Check that wall layers are correctly classified.");
  }

  // Detect openings (doors and windows)
  const openings = detectOpenings(workingEntities, layers, walls, config);

  // Detect rooms (enclosed regions)
  const rooms = detectRooms(walls, workingEntities, layers, config);
  if (rooms.length === 0) {
    warnings.push("No enclosed rooms detected. The wall graph may not form closed loops.");
  }

  // Parse section drawings
  const sectionFiles = drawingFiles.filter((f) => f.type === "section");
  const sections = [];

  for (const sectionFile of sectionFiles) {
    try {
      const sectionParseResult = parseDxf(sectionFile.dxfContent);
      const sectionLayers = sectionParseResult.layers.map((layer) => {
        if (layerOverrides?.has(layer.name)) {
          return { ...layer, classification: layerOverrides.get(layer.name)! };
        }
        return layer;
      });

      // Normalize section coordinates — sections are often in the same
      // survey coordinate space as the floor plan.
      // For sections, we normalize using the wall/structural entity bounds,
      // or fall back to detecting large Y-offsets (survey coords).
      let sectionEntities = sectionParseResult.entities;

      const sectionZone = detectBuildingZone({ ...sectionParseResult, layers: sectionLayers });
      if (sectionZone) {
        sectionEntities = normalizeEntities(
          sectionParseResult.entities,
          sectionZone.offset,
          sectionZone.buildingBounds,
          20000,
        );
      } else {
        // Fallback: if Y values are > 100,000mm, the section uses survey coords.
        // Find the minimum Y of all entities and subtract it (sets ground level ≈ 0).
        const allBounds = computeEntityBounds(sectionParseResult.entities);
        if (Math.abs(allBounds.minY) > 100000) {
          // Use all entities, just shift Y so the lowest point is near 0
          // Keep X as-is (or also normalize if needed)
          const offset = { x: 0, y: allBounds.minY };
          if (Math.abs(allBounds.minX) > 100000) {
            offset.x = allBounds.minX;
          }
          sectionEntities = sectionParseResult.entities
            .map((e) => offsetEntitySimple(e, offset))
            .filter((e): e is NonNullable<typeof e> => e !== null);
        }
      }

      const sectionData = parseSection(sectionEntities, sectionLayers, config);
      sections.push(sectionData);
    } catch (err) {
      warnings.push(`Failed to parse section "${sectionFile.fileName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (sectionFiles.length === 0) {
    warnings.push("No section drawings provided. All heights will use defaults.");
  }

  // Cross-reference section heights with floor plan
  let crossRefResult: CrossReferenceResult | null = null;
  if (sections.length > 0) {
    crossRefResult = applySectionHeights(walls, openings, rooms, sections, config);

    if (crossRefResult.wallsUnmatched > 0) {
      warnings.push(
        `${crossRefResult.wallsUnmatched} of ${walls.length} walls using default height (not covered by sections).`,
      );
    }
  }

  // Parse roof plan (if provided)
  let roofPlan: RoofPlanData | null = null;
  const roofPlanFile = drawingFiles.find((f) => f.type === "roof-plan");
  if (roofPlanFile) {
    try {
      const roofParseResult = parseDxf(roofPlanFile.dxfContent);
      const roofLayers = roofParseResult.layers.map((layer) => {
        if (layerOverrides?.has(layer.name)) {
          return { ...layer, classification: layerOverrides.get(layer.name)! };
        }
        return layer;
      });
      roofPlan = parseRoofPlan(roofParseResult.entities, roofLayers, config);
      if (roofPlan.ridgeLines.length > 0) {
        warnings.push(
          `Roof plan: detected ${roofPlan.ridgeLines.length} ridge line(s), ` +
          `${roofPlan.eaveEdges.length} eave edge(s), ` +
          `${roofPlan.hipLines.length} hip/valley line(s).`,
        );
      }
    } catch (err) {
      warnings.push(`Failed to parse roof plan "${roofPlanFile.fileName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Combine roof plan + section profiles into 3D roof geometry
  const { roofFaces, roofSegments } = combineRoofData(
    roofPlan,
    sections,
    normalizedBounds,
    config,
  );

  if (sections.length > 0 && roofSegments.length === 0 && roofFaces.length === 0) {
    warnings.push("No roof geometry detected. The roof may not appear in the 3D model.");
  }

  // Detect columns from floor plan (vertical structural elements)
  const columns = detectColumns(workingEntities, layers);

  // Compute tight bounds from architectural elements only (exclude landscape)
  const archPoints: Point2D[] = [];
  for (const w of walls) { archPoints.push(w.start, w.end); }
  for (const o of openings) {
    const wall = walls.find(w => w.id === o.wallId);
    if (wall) archPoints.push(wall.start, wall.end);
  }
  for (const r of rooms) { archPoints.push(r.centroid); }
  for (const c of columns) { archPoints.push(c.position); }

  let tightBounds = normalizedBounds;
  if (archPoints.length > 4) {
    let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity;
    for (const p of archPoints) {
      if (p.x < tMinX) tMinX = p.x;
      if (p.y < tMinY) tMinY = p.y;
      if (p.x > tMaxX) tMaxX = p.x;
      if (p.y > tMaxY) tMaxY = p.y;
    }
    // Add 2m padding
    tightBounds = {
      minX: tMinX - 2000,
      minY: tMinY - 2000,
      maxX: tMaxX + 2000,
      maxY: tMaxY + 2000,
    };
  }

  const floorPlan: FloorPlan = {
    walls,
    openings,
    rooms,
    bounds: tightBounds,
    units: config.units !== parseResult.units ? config.units : parseResult.units,
    layers,
    sections,
    roofSegments,
    roofFaces,
    roofPlan,
    columns,
  };

  return { floorPlan, crossRefResult, warnings };
}

/** Simple offset for entity coordinates (no zone filtering) */
function offsetEntitySimple(
  entity: import("./parser").ParsedEntity,
  offset: { x: number; y: number },
): import("./parser").ParsedEntity | null {
  function shift(p: { x: number; y: number }) {
    return { x: p.x - offset.x, y: p.y - offset.y };
  }
  switch (entity.type) {
    case "LINE": return { ...entity, start: shift(entity.start), end: shift(entity.end) };
    case "LWPOLYLINE": case "POLYLINE": return { ...entity, vertices: entity.vertices.map(shift) };
    case "ARC": return { ...entity, center: shift(entity.center) };
    case "CIRCLE": return { ...entity, center: shift(entity.center) };
    case "INSERT": return { ...entity, position: shift(entity.position) };
    case "TEXT": case "MTEXT": return { ...entity, position: shift(entity.position) };
    default: return entity;
  }
}

/**
 * Detect columns from the floor plan.
 * Columns typically appear as small filled rectangles or circles on structural layers.
 */
function detectColumns(
  entities: import("./parser").ParsedEntity[],
  layers: LayerInfo[],
): Column[] {
  // Look for small closed rectangles or circles that could be columns
  const columns: Column[] = [];
  const structuralLayers = new Set(
    layers
      .filter((l) =>
        /\bCOL\b/i.test(l.name) ||
        /\bS[-_]?COL\b/i.test(l.name) ||
        /\bSTRUCT/i.test(l.name) ||
        /\bPILLAR/i.test(l.name) ||
        /\bPOST/i.test(l.name) ||
        /\bA[-_]?FRAME\b/i.test(l.name) ||
        /\bSTR[-_]?BOLT\b/i.test(l.name),
      )
      .map((l) => l.name),
  );

  for (const entity of entities) {
    if (!structuralLayers.has(entity.layer)) continue;

    if (entity.type === "CIRCLE" && entity.radius < 500 && entity.radius > 50) {
      columns.push({
        id: uuid(),
        position: entity.center,
        width: entity.radius * 2,
        depth: entity.radius * 2,
        height: 2700, // default, updated by section cross-reference
        layer: entity.layer,
      });
    }

    if (
      (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") &&
      entity.closed &&
      entity.vertices.length === 4
    ) {
      // Check if it's a small rectangle (column footprint)
      const verts = entity.vertices;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
      const w = maxX - minX;
      const d = maxY - minY;
      if (w > 50 && w < 800 && d > 50 && d < 800) {
        columns.push({
          id: uuid(),
          position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
          width: w,
          depth: d,
          height: 2700,
          layer: entity.layer,
        });
      }
    }
  }

  return columns;
}

/**
 * Quick-parse a DXF file to extract layers only (for the layer selection UI).
 * Much faster than full processing.
 */
export function quickParseLayers(dxfContent: string): LayerInfo[] {
  const result = parseDxf(dxfContent);
  return result.layers;
}

// Re-export types used by consumers
export type { DxfParseResult } from "./parser";
export type { CrossReferenceResult } from "./cross-reference";
