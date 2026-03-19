/**
 * Section Parser — Extracts height information from section drawing DXF files.
 *
 * Section drawings show the building cut vertically, revealing:
 * - Floor-to-ceiling heights
 * - Slab thicknesses
 * - Window sill and head heights
 * - Door head heights
 * - Double-height spaces, voids, dropped ceilings
 *
 * In a section DXF, the X axis represents horizontal position (maps to a
 * cut line through the floor plan) and the Y axis represents height/elevation.
 */

import type {
  SectionData,
  SectionHeight,
  SectionOpening,
  RoofProfilePoint,
  OpeningType,
  Point2D,
  V3Config,
  LayerInfo,
} from "../types-v3";
import type { ParsedEntity, ParsedLine, ParsedPolyline } from "./parser";
import {
  getEntitiesByClassification,
  getLinearEntities,
  getTextEntities,
  lineLength,
  lineAngle,
  normalizeAngle,
} from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Tolerance for detecting horizontal lines (floor/ceiling) — angle in radians (~3°) */
const HORIZONTAL_TOLERANCE = 0.05;
/** Tolerance for detecting vertical lines (walls in section) */
const VERTICAL_TOLERANCE = 0.05;
/** Minimum line length to consider as a floor/ceiling slab line */
const MIN_SLAB_LINE_LENGTH = 500;
/** Tolerance for grouping horizontal lines at similar Y levels */
const Y_LEVEL_TOLERANCE = 100;
/** Tolerance for matching openings in sections */
const OPENING_GAP_TOLERANCE = 200;

// ─── Main Section Parsing ────────────────────────────────────────────────────

/**
 * Parse a section drawing DXF and extract height information.
 *
 * @param entities - All parsed entities from the section DXF
 * @param layers - Layer classification info
 * @param config - V3 configuration for defaults
 * @returns SectionData with extracted heights and openings
 */
export function parseSection(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  config: V3Config,
): SectionData {
  // Get wall entities from the section (these show as vertical lines in section view)
  const wallEntities = getEntitiesByClassification(entities, layers, "wall");
  const allLinearEntities = getLinearEntities(entities);
  const wallLinearEntities = getLinearEntities(wallEntities);

  // Separate horizontal and vertical lines from ALL entities
  const { horizontal: allHorizontal, vertical: allVertical } =
    classifyLines(allLinearEntities);

  // Separate horizontal and vertical lines from WALL entities specifically
  const { vertical: wallVertical } = classifyLines(wallLinearEntities);

  // Extract floor and ceiling levels from horizontal lines
  const yLevels = extractYLevels(allHorizontal);

  // Extract section heights by analyzing vertical wall segments and horizontal slabs
  const heights = extractSectionHeights(yLevels, wallVertical, allHorizontal, config);

  // Detect openings visible in the section
  detectSectionOpenings(heights, entities, layers, wallVertical, config);

  // Extract the section cut line extent (horizontal range of the section)
  const xExtent = computeXExtent(allLinearEntities);

  // Extract roof profile — angled lines above the highest ceiling level
  const { horizontal: allH, vertical: allV, other: allAngled } =
    classifyLines(allLinearEntities);
  const roofProfile = extractRoofProfile(allAngled, allH, yLevels, heights);

  return {
    cutLineStart: { x: xExtent.min, y: 0 },
    cutLineEnd: { x: xExtent.max, y: 0 },
    heights,
    roofProfile,
  };
}

// ─── Line Classification ─────────────────────────────────────────────────────

interface ClassifiedLines {
  horizontal: LineWithMeta[];
  vertical: LineWithMeta[];
  other: LineWithMeta[];
}

interface LineWithMeta {
  start: Point2D;
  end: Point2D;
  length: number;
  angle: number;
  layer: string;
  // For horizontal lines, the Y coordinate
  yLevel?: number;
  // For vertical lines, the X coordinate
  xPosition?: number;
}

function classifyLines(
  entities: (ParsedLine | ParsedPolyline)[],
): ClassifiedLines {
  const result: ClassifiedLines = { horizontal: [], vertical: [], other: [] };

  for (const entity of entities) {
    if (entity.type === "LINE") {
      const angle = normalizeAngle(lineAngle(entity.start, entity.end));
      const len = lineLength(entity.start, entity.end);
      if (len < 10) continue; // skip tiny lines

      const meta: LineWithMeta = {
        start: entity.start,
        end: entity.end,
        length: len,
        angle,
        layer: entity.layer,
      };

      if (angle < HORIZONTAL_TOLERANCE || angle > Math.PI - HORIZONTAL_TOLERANCE) {
        meta.yLevel = (entity.start.y + entity.end.y) / 2;
        result.horizontal.push(meta);
      } else if (Math.abs(angle - Math.PI / 2) < VERTICAL_TOLERANCE) {
        meta.xPosition = (entity.start.x + entity.end.x) / 2;
        result.vertical.push(meta);
      } else {
        result.other.push(meta);
      }
    } else {
      // Convert polyline segments to individual lines
      for (let i = 0; i < entity.vertices.length - 1; i++) {
        const start = entity.vertices[i];
        const end = entity.vertices[i + 1];
        const angle = normalizeAngle(lineAngle(start, end));
        const len = lineLength(start, end);
        if (len < 10) continue;

        const meta: LineWithMeta = { start, end, length: len, angle, layer: entity.layer };

        if (angle < HORIZONTAL_TOLERANCE || angle > Math.PI - HORIZONTAL_TOLERANCE) {
          meta.yLevel = (start.y + end.y) / 2;
          result.horizontal.push(meta);
        } else if (Math.abs(angle - Math.PI / 2) < VERTICAL_TOLERANCE) {
          meta.xPosition = (start.x + end.x) / 2;
          result.vertical.push(meta);
        } else {
          result.other.push(meta);
        }
      }

      // Handle closing segment for closed polylines
      if (entity.closed && entity.vertices.length >= 3) {
        const start = entity.vertices[entity.vertices.length - 1];
        const end = entity.vertices[0];
        const angle = normalizeAngle(lineAngle(start, end));
        const len = lineLength(start, end);
        if (len >= 10) {
          const meta: LineWithMeta = { start, end, length: len, angle, layer: entity.layer };
          if (angle < HORIZONTAL_TOLERANCE || angle > Math.PI - HORIZONTAL_TOLERANCE) {
            meta.yLevel = (start.y + end.y) / 2;
            result.horizontal.push(meta);
          } else if (Math.abs(angle - Math.PI / 2) < VERTICAL_TOLERANCE) {
            meta.xPosition = (start.x + end.x) / 2;
            result.vertical.push(meta);
          }
        }
      }
    }
  }

  return result;
}

// ─── Y-Level Extraction ──────────────────────────────────────────────────────

interface YLevel {
  y: number;
  lines: LineWithMeta[];
  totalLength: number;
}

/**
 * Group horizontal lines by Y-level to identify floor and ceiling planes.
 * Significant horizontal lines at consistent Y levels indicate slab positions.
 */
function extractYLevels(horizontalLines: LineWithMeta[]): YLevel[] {
  // Filter for significant horizontal lines (long enough to be slabs)
  const significant = horizontalLines.filter((l) => l.length >= MIN_SLAB_LINE_LENGTH);

  // Sort by Y level
  significant.sort((a, b) => (a.yLevel || 0) - (b.yLevel || 0));

  // Group by Y level within tolerance
  const levels: YLevel[] = [];
  for (const line of significant) {
    const y = line.yLevel || 0;
    const existingLevel = levels.find(
      (level) => Math.abs(level.y - y) < Y_LEVEL_TOLERANCE,
    );

    if (existingLevel) {
      existingLevel.lines.push(line);
      existingLevel.totalLength += line.length;
      // Update Y to weighted average
      existingLevel.y =
        existingLevel.lines.reduce((sum, l) => sum + (l.yLevel || 0) * l.length, 0) /
        existingLevel.totalLength;
    } else {
      levels.push({
        y,
        lines: [line],
        totalLength: line.length,
      });
    }
  }

  // Sort by Y ascending (bottom to top in section view)
  levels.sort((a, b) => a.y - b.y);

  return levels;
}

// ─── Section Height Extraction ───────────────────────────────────────────────

function extractSectionHeights(
  yLevels: YLevel[],
  wallVerticals: LineWithMeta[],
  allHorizontals: LineWithMeta[],
  config: V3Config,
): SectionHeight[] {
  const heights: SectionHeight[] = [];

  if (yLevels.length < 2) {
    // Not enough horizontal lines to determine floor/ceiling
    // Return a single default height spanning the full section
    return [];
  }

  // The lowest significant Y level is likely the ground floor level
  // Pair consecutive levels as floor/ceiling
  for (let i = 0; i < yLevels.length - 1; i++) {
    const floorLevel = yLevels[i];
    const ceilingLevel = yLevels[i + 1];
    const roomHeight = ceilingLevel.y - floorLevel.y;

    // Sanity check — room height should be reasonable (1500–6000mm typically)
    if (roomHeight < 1500 || roomHeight > 8000) continue;

    // Find the horizontal range covered by both floor and ceiling lines
    const floorXRange = getXRange(floorLevel.lines);
    const ceilingXRange = getXRange(ceilingLevel.lines);

    // The valid horizontal range is the intersection
    const xMin = Math.max(floorXRange.min, ceilingXRange.min);
    const xMax = Math.min(floorXRange.max, ceilingXRange.max);
    if (xMin >= xMax) continue;

    const horizontalCenter = (xMin + xMax) / 2;

    heights.push({
      horizontalPosition: horizontalCenter,
      floorLevel: floorLevel.y,
      ceilingLevel: ceilingLevel.y,
      openings: [],
    });
  }

  return heights;
}

function getXRange(lines: LineWithMeta[]): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const line of lines) {
    const lineMinX = Math.min(line.start.x, line.end.x);
    const lineMaxX = Math.max(line.start.x, line.end.x);
    if (lineMinX < min) min = lineMinX;
    if (lineMaxX > max) max = lineMaxX;
  }
  return { min, max };
}

// ─── Opening Detection in Section ────────────────────────────────────────────

function detectSectionOpenings(
  heights: SectionHeight[],
  entities: ParsedEntity[],
  layers: LayerInfo[],
  wallVerticals: LineWithMeta[],
  config: V3Config,
): void {
  // Look for gaps in wall vertical lines that indicate openings
  // In a section view, a door is a gap from floor to ~2100mm
  // A window is a gap from ~900mm to ~2100mm

  // Get door and window entities from section
  const doorEntities = getEntitiesByClassification(entities, layers, "door");
  const windowEntities = getEntitiesByClassification(entities, layers, "window");
  const doorLines = getLinearEntities(doorEntities);
  const windowLines = getLinearEntities(windowEntities);

  for (const height of heights) {
    // Check for door-layer lines within this height's range
    for (const line of classifyLines(doorLines).horizontal) {
      const y = line.yLevel || 0;
      // A door head height line should be between floor and ceiling
      if (y > height.floorLevel && y < height.ceilingLevel) {
        const xCenter = (Math.min(line.start.x, line.end.x) + Math.max(line.start.x, line.end.x)) / 2;
        const width = Math.abs(line.end.x - line.start.x);
        if (width > 400 && width < 3000) {
          height.openings.push({
            horizontalPosition: xCenter,
            width,
            sillHeight: 0,
            headHeight: y - height.floorLevel,
            type: "door",
          });
        }
      }
    }

    // Check for window-layer lines within this height's range
    for (const line of classifyLines(windowLines).horizontal) {
      const y = line.yLevel || 0;
      if (y > height.floorLevel && y < height.ceilingLevel) {
        const xCenter = (Math.min(line.start.x, line.end.x) + Math.max(line.start.x, line.end.x)) / 2;
        const width = Math.abs(line.end.x - line.start.x);
        if (width > 400 && width < 5000) {
          // Try to find a matching sill line below
          const sillY = findSillLine(windowLines, xCenter, height.floorLevel, y, width);
          height.openings.push({
            horizontalPosition: xCenter,
            width,
            sillHeight: sillY !== null ? sillY - height.floorLevel : config.defaultSillHeight,
            headHeight: y - height.floorLevel,
            type: "window",
          });
        }
      }
    }
  }
}

function findSillLine(
  windowLines: (ParsedLine | ParsedPolyline)[],
  xCenter: number,
  floorLevel: number,
  headLevel: number,
  expectedWidth: number,
): number | null {
  const horizontals = classifyLines(windowLines).horizontal;

  for (const line of horizontals) {
    const y = line.yLevel || 0;
    // Sill should be between floor and head
    if (y <= floorLevel || y >= headLevel) continue;

    const lineXCenter = (Math.min(line.start.x, line.end.x) + Math.max(line.start.x, line.end.x)) / 2;
    const lineWidth = Math.abs(line.end.x - line.start.x);

    // Check if this line is near the same X position and similar width
    if (
      Math.abs(lineXCenter - xCenter) < OPENING_GAP_TOLERANCE &&
      Math.abs(lineWidth - expectedWidth) < OPENING_GAP_TOLERANCE
    ) {
      return y;
    }
  }

  return null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function computeXExtent(
  entities: (ParsedLine | ParsedPolyline)[],
): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const entity of entities) {
    if (entity.type === "LINE") {
      min = Math.min(min, entity.start.x, entity.end.x);
      max = Math.max(max, entity.start.x, entity.end.x);
    } else {
      for (const v of entity.vertices) {
        min = Math.min(min, v.x);
        max = Math.max(max, v.x);
      }
    }
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}

// ─── Roof Profile Extraction ─────────────────────────────────────────────────

/** Minimum angle from horizontal for a line to be considered a roof slope (radians, ~8°) */
const ROOF_SLOPE_MIN_ANGLE = 0.14;
/** Maximum angle from horizontal (radians, ~75° — steeper than this is a wall, not a roof) */
const ROOF_SLOPE_MAX_ANGLE = 1.31;
/** Minimum length for a roof line to avoid detecting small details */
const MIN_ROOF_LINE_LENGTH = 500;

/**
 * Extract the roof profile from section drawing geometry.
 *
 * Roof lines are:
 * - Angled (neither horizontal nor vertical) lines above the ceiling level
 * - Horizontal lines above the ceiling level that form eaves or ridges
 *
 * The roof profile is returned as a sorted polyline of (x, y) points
 * representing the roof outline from left to right.
 */
function extractRoofProfile(
  angledLines: LineWithMeta[],
  horizontalLines: LineWithMeta[],
  yLevels: YLevel[],
  heights: SectionHeight[],
): RoofProfilePoint[] {
  // Determine the highest ceiling level — anything above this is roof
  let maxCeilingY = 0;
  for (const h of heights) {
    if (h.ceilingLevel > maxCeilingY) maxCeilingY = h.ceilingLevel;
  }
  // Also check Y levels
  if (yLevels.length >= 2) {
    for (const level of yLevels) {
      if (level.y > maxCeilingY) maxCeilingY = level.y;
    }
  }

  // If no ceiling found, use a reasonable default threshold
  if (maxCeilingY === 0) {
    // Use the Y level that seems like a ceiling (second-highest significant level)
    const sortedLevels = [...yLevels].sort((a, b) => b.y - a.y);
    if (sortedLevels.length >= 1) {
      maxCeilingY = sortedLevels[0].y * 0.85; // roof must be above 85% of highest level
    }
  }

  // Collect roof points from angled lines above or near ceiling level
  const roofPoints: RoofProfilePoint[] = [];
  const ceilingThreshold = maxCeilingY * 0.8; // allow some tolerance below ceiling

  // Angled lines — the main roof slopes
  for (const line of angledLines) {
    const angle = Math.abs(normalizeAngle(line.angle));
    // Convert to angle from horizontal
    const angleFromHorizontal = angle > Math.PI / 2
      ? Math.PI - angle
      : angle;

    // Must be a valid roof slope angle
    if (angleFromHorizontal < ROOF_SLOPE_MIN_ANGLE) continue;
    if (angleFromHorizontal > ROOF_SLOPE_MAX_ANGLE) continue;
    if (line.length < MIN_ROOF_LINE_LENGTH) continue;

    // At least one endpoint must be above the ceiling threshold
    const maxY = Math.max(line.start.y, line.end.y);
    if (maxY < ceilingThreshold) continue;

    roofPoints.push({ x: line.start.x, y: line.start.y });
    roofPoints.push({ x: line.end.x, y: line.end.y });
  }

  // Horizontal lines above ceiling — ridge lines, eave extensions
  for (const line of horizontalLines) {
    const y = line.yLevel || 0;
    if (y < ceilingThreshold) continue;
    if (line.length < MIN_ROOF_LINE_LENGTH) continue;

    roofPoints.push({ x: line.start.x, y });
    roofPoints.push({ x: line.end.x, y });
  }

  if (roofPoints.length < 2) return [];

  // Sort by X position and build a clean profile (upper envelope)
  return buildRoofEnvelope(roofPoints);
}

/**
 * Build a clean roof profile polyline from scattered roof points.
 * Takes the upper envelope — at each X position, use the highest Y.
 */
function buildRoofEnvelope(points: RoofProfilePoint[]): RoofProfilePoint[] {
  // Sort by X
  points.sort((a, b) => a.x - b.x);

  // Merge points at similar X positions, keeping the highest Y
  const MERGE_X_TOLERANCE = 200;
  const merged: RoofProfilePoint[] = [];

  for (const point of points) {
    const existing = merged.find((m) => Math.abs(m.x - point.x) < MERGE_X_TOLERANCE);
    if (existing) {
      // Keep the higher point
      if (point.y > existing.y) {
        existing.y = point.y;
      }
      // Average X positions
      existing.x = (existing.x + point.x) / 2;
    } else {
      merged.push({ ...point });
    }
  }

  // Sort final result by X
  merged.sort((a, b) => a.x - b.x);

  return merged;
}
