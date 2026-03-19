/**
 * Roof Plan Parser — Extracts roof geometry from a roof plan drawing.
 *
 * A roof plan (seen from above) shows:
 * - Eave outline: the outer boundary of the roof (including overhangs)
 * - Ridge lines: dashed lines along the roof peaks
 * - Hip lines: diagonal lines where two roof slopes meet at an outer corner
 * - Valley lines: diagonal lines where two roof slopes meet at an inner corner
 *
 * Combined with section data (which provides elevation/height),
 * these plan-view positions fully define the 3D roof geometry.
 */

import type {
  RoofPlanData,
  RoofRidgeLine,
  RoofEaveEdge,
  RoofHipLine,
  Point2D,
  LayerInfo,
  V3Config,
} from "../types-v3";
import type { ParsedEntity, ParsedLine, ParsedPolyline } from "./parser";
import {
  getLinearEntities,
  lineLength,
  lineAngle,
  normalizeAngle,
  distance,
} from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Minimum line lengths — set high to filter out hatch patterns (shingle tiles,
 * roofing material textures) which appear as thousands of tiny repeated lines.
 * Real structural roof elements (ridges, eaves, hips) are building-scale.
 */
/** Minimum line length for a ridge line (mm) — ridges span most of the building */
const MIN_RIDGE_LENGTH = 8000;
/** Minimum line length for a hip/valley line — diagonals from ridge to eave corner */
const MIN_HIP_LENGTH = 5000;
/** Minimum line length for an eave edge — at least a room width */
const MIN_EAVE_LENGTH = 5000;
/** Minimum line length for ANY line to be considered structural (filters shingle hatch) */
const MIN_STRUCTURAL_LENGTH = 4000;
/** Angle tolerance for horizontal/vertical classification (~5°) */
const ANGLE_TOLERANCE = 0.087;
/** Hip/valley lines are diagonal — angle between 15° and 75° from horizontal */
const HIP_MIN_ANGLE = 0.26;  // ~15°
const HIP_MAX_ANGLE = 1.31;  // ~75°
/** Distance tolerance for connecting endpoints into a closed outline */
const SNAP_TOLERANCE = 500;

// ─── Layer Pattern Matching ──────────────────────────────────────────────────

const ROOF_LAYER_PATTERNS = [
  /\bROOF\b/i,
  /\bA[-_]?ROOF\b/i,
  /\bATAP\b/i,        // Indonesian
  /\bTETTO\b/i,       // Italian
  /\bDACH\b/i,        // German
  /\bTEJADO\b/i,      // Spanish
];

const RIDGE_LAYER_PATTERNS = [
  /\bRIDGE\b/i,
  /\bA[-_]?ROOF[-_]?RIDGE\b/i,
  /\bBUBUNG/i,        // Indonesian
];

const EAVE_LAYER_PATTERNS = [
  /\bEAVE\b/i,
  /\bFASCIA\b/i,
  /\bOVERHANG\b/i,
  /\bLISTELLO/i,      // Italian
];

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a roof plan DXF and extract roof geometry.
 */
export function parseRoofPlan(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  config: V3Config,
): RoofPlanData {
  // Identify roof-related layers
  const roofLayers = new Set<string>();
  const ridgeLayers = new Set<string>();
  const eaveLayers = new Set<string>();

  for (const layer of layers) {
    const name = layer.name;
    if (RIDGE_LAYER_PATTERNS.some((p) => p.test(name))) {
      ridgeLayers.add(name);
      roofLayers.add(name);
    } else if (EAVE_LAYER_PATTERNS.some((p) => p.test(name))) {
      eaveLayers.add(name);
      roofLayers.add(name);
    } else if (ROOF_LAYER_PATTERNS.some((p) => p.test(name))) {
      roofLayers.add(name);
    }
  }

  // Get all linear entities on roof-related layers
  const roofEntities = entities.filter((e) => roofLayers.has(e.layer));
  const allLinearEntities = getLinearEntities(roofEntities);

  // Also get ALL linear entities if no roof layers found — fallback to geometric analysis
  const fallbackEntities = roofLayers.size === 0
    ? getLinearEntities(entities)
    : allLinearEntities;

  // Separate lines into segments
  let segments = extractLineSegments(fallbackEntities);

  // Filter hatch patterns: detect clusters of same-length, evenly-spaced,
  // parallel lines (characteristic of shingle/tile hatch patterns).
  segments = filterHatchPatterns(segments);

  // Classify segments into ridges, eaves, and hips/valleys
  const ridgeLines = detectRidgeLines(segments, ridgeLayers);
  const eaveEdges = detectEaveEdges(segments, eaveLayers, config);
  const hipLines = detectHipLines(segments, ridgeLines, eaveEdges);

  // Build eave outline (closed polygon)
  const eaveOutline = buildEaveOutline(eaveEdges);

  return {
    eaveOutline,
    eaveEdges,
    ridgeLines,
    hipLines,
  };
}

// ─── Line Segment Extraction ─────────────────────────────────────────────────

interface RoofLineSegment {
  start: Point2D;
  end: Point2D;
  length: number;
  angle: number;        // normalized [0, PI)
  layer: string;
  isDashed: boolean;     // ridges are often dashed
  used: boolean;
}

function extractLineSegments(
  entities: (ParsedLine | ParsedPolyline)[],
): RoofLineSegment[] {
  const segments: RoofLineSegment[] = [];

  for (const entity of entities) {
    if (entity.type === "LINE") {
      const len = lineLength(entity.start, entity.end);
      if (len < MIN_STRUCTURAL_LENGTH) continue;
      segments.push({
        start: entity.start,
        end: entity.end,
        length: len,
        angle: normalizeAngle(lineAngle(entity.start, entity.end)),
        layer: entity.layer,
        isDashed: false, // DXF line type info would help here
        used: false,
      });
    } else {
      // Polyline segments
      for (let i = 0; i < entity.vertices.length - 1; i++) {
        const start = entity.vertices[i];
        const end = entity.vertices[i + 1];
        const len = lineLength(start, end);
        if (len < MIN_STRUCTURAL_LENGTH) continue;
        segments.push({
          start,
          end,
          length: len,
          angle: normalizeAngle(lineAngle(start, end)),
          layer: entity.layer,
          isDashed: false,
          used: false,
        });
      }
      // Closing segment for closed polylines
      if (entity.closed && entity.vertices.length >= 3) {
        const start = entity.vertices[entity.vertices.length - 1];
        const end = entity.vertices[0];
        const len = lineLength(start, end);
        if (len >= 50) {
          segments.push({
            start,
            end,
            length: len,
            angle: normalizeAngle(lineAngle(start, end)),
            layer: entity.layer,
            isDashed: false,
            used: false,
          });
        }
      }
    }
  }

  return segments;
}

// ─── Hatch Pattern Filter ────────────────────────────────────────────────────

/**
 * Detect and remove hatch pattern lines (shingle tiles, material textures).
 *
 * Hatch patterns are characterized by:
 * - Many lines of similar length and angle
 * - Regular spacing between parallel lines
 *
 * We detect groups of 5+ parallel lines of similar length and remove them,
 * keeping only unique/non-repeating structural elements.
 */
function filterHatchPatterns(segments: RoofLineSegment[]): RoofLineSegment[] {
  // Group segments by angle + length (hatch signature)
  const ANGLE_BIN = 0.05; // ~3° bins
  const LENGTH_BIN = 500;  // 500mm length bins

  const bins = new Map<string, RoofLineSegment[]>();

  for (const seg of segments) {
    const angleBin = Math.round(seg.angle / ANGLE_BIN);
    const lengthBin = Math.round(seg.length / LENGTH_BIN);
    const key = `${angleBin}:${lengthBin}`;

    if (!bins.has(key)) bins.set(key, []);
    bins.get(key)!.push(seg);
  }

  // Mark bins with many segments as hatch patterns
  const hatchSegments = new Set<RoofLineSegment>();

  for (const [, binSegments] of bins) {
    if (binSegments.length >= 3) {
      // This is likely a hatch pattern — multiple lines of the same angle+length
      // Keep only the longest 1 (it might be an actual structural line)
      const sorted = [...binSegments].sort((a, b) => b.length - a.length);
      for (const seg of sorted.slice(1)) {
        hatchSegments.add(seg);
      }
    }
  }

  return segments.filter((seg) => !hatchSegments.has(seg));
}

// ─── Ridge Line Detection ────────────────────────────────────────────────────

/**
 * Ridge lines are:
 * - On ridge-specific layers (most reliable)
 * - Or: long horizontal/near-horizontal lines inside the building footprint
 *   that don't align with walls (they're typically dashed in drawings)
 * - They represent the highest point of the roof in plan view
 */
function detectRidgeLines(
  segments: RoofLineSegment[],
  ridgeLayers: Set<string>,
): RoofRidgeLine[] {
  const ridges: RoofRidgeLine[] = [];

  for (const seg of segments) {
    // Strategy 1: On a known ridge layer
    if (ridgeLayers.has(seg.layer)) {
      if (seg.length >= MIN_RIDGE_LENGTH) {
        seg.used = true;
        ridges.push({
          start: seg.start,
          end: seg.end,
          elevation: 0, // will be set by section cross-reference
          elevationSource: "default",
        });
      }
      continue;
    }

    // Strategy 2: Geometric heuristic — long, roughly horizontal lines
    // that are inside the building footprint (ridges typically run along
    // the length of the building)
    if (seg.length >= MIN_RIDGE_LENGTH * 1.5 && !seg.used) {
      // Must be roughly horizontal or vertical (ridges follow building axes)
      const isAxisAligned =
        seg.angle < ANGLE_TOLERANCE ||
        seg.angle > Math.PI - ANGLE_TOLERANCE ||
        Math.abs(seg.angle - Math.PI / 2) < ANGLE_TOLERANCE;

      if (isAxisAligned) {
        // This could be a ridge — mark as candidate
        // (We'll validate later by checking if it's between eave edges)
        seg.used = true;
        ridges.push({
          start: seg.start,
          end: seg.end,
          elevation: 0,
          elevationSource: "default",
        });
      }
    }
  }

  return ridges;
}

// ─── Eave Edge Detection ─────────────────────────────────────────────────────

/**
 * Eave edges form the outer boundary of the roof.
 * They are:
 * - On eave-specific layers
 * - Or: the outermost horizontal/vertical lines on roof layers
 *   (the perimeter of the roof plan)
 */
function detectEaveEdges(
  segments: RoofLineSegment[],
  eaveLayers: Set<string>,
  config: V3Config,
): RoofEaveEdge[] {
  const eaves: RoofEaveEdge[] = [];

  // First pass: lines on known eave layers
  for (const seg of segments) {
    if (eaveLayers.has(seg.layer) && seg.length >= MIN_EAVE_LENGTH && !seg.used) {
      seg.used = true;
      eaves.push({
        start: seg.start,
        end: seg.end,
        elevation: config.defaultCeilingHeight, // eaves are typically at wall top
        elevationSource: "default",
      });
    }
  }

  if (eaves.length > 0) return eaves;

  // Fallback: find the outermost perimeter lines
  // These are axis-aligned lines that form the building's roof outline
  const perimeterSegments = segments.filter((s) => {
    if (s.used || s.length < MIN_EAVE_LENGTH) return false;
    const isAxisAligned =
      s.angle < ANGLE_TOLERANCE ||
      s.angle > Math.PI - ANGLE_TOLERANCE ||
      Math.abs(s.angle - Math.PI / 2) < ANGLE_TOLERANCE;
    return isAxisAligned;
  });

  // Find the bounding box of all segments
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    for (const p of [seg.start, seg.end]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // Eave edges are near the perimeter — within 20% of the bounding box edge
  const xRange = maxX - minX;
  const yRange = maxY - minY;
  const perimeterTolerance = Math.max(xRange, yRange) * 0.2;

  for (const seg of perimeterSegments) {
    const midX = (seg.start.x + seg.end.x) / 2;
    const midY = (seg.start.y + seg.end.y) / 2;

    const nearEdge =
      midX - minX < perimeterTolerance ||
      maxX - midX < perimeterTolerance ||
      midY - minY < perimeterTolerance ||
      maxY - midY < perimeterTolerance;

    if (nearEdge) {
      seg.used = true;
      eaves.push({
        start: seg.start,
        end: seg.end,
        elevation: config.defaultCeilingHeight,
        elevationSource: "default",
      });
    }
  }

  return eaves;
}

// ─── Hip/Valley Line Detection ───────────────────────────────────────────────

/**
 * Hip and valley lines are diagonal lines connecting ridge endpoints to eave corners.
 * - Hip: outer corner (roof slopes away on both sides)
 * - Valley: inner corner (roof slopes meet, forming a channel)
 */
function detectHipLines(
  segments: RoofLineSegment[],
  ridges: RoofRidgeLine[],
  eaves: RoofEaveEdge[],
): RoofHipLine[] {
  const hips: RoofHipLine[] = [];

  // Collect all ridge endpoints and eave endpoints
  const ridgePoints: Point2D[] = [];
  for (const r of ridges) {
    ridgePoints.push(r.start, r.end);
  }

  const eavePoints: Point2D[] = [];
  for (const e of eaves) {
    eavePoints.push(e.start, e.end);
  }

  // Look for diagonal lines that connect ridge areas to eave areas
  for (const seg of segments) {
    if (seg.used || seg.length < MIN_HIP_LENGTH) continue;

    // Must be diagonal (not axis-aligned)
    const angleFromHoriz = seg.angle > Math.PI / 2
      ? Math.PI - seg.angle
      : seg.angle;
    if (angleFromHoriz < HIP_MIN_ANGLE || angleFromHoriz > HIP_MAX_ANGLE) continue;

    // Check if one end is near a ridge point and the other near an eave point
    const startNearRidge = ridgePoints.some((p) => distance(p, seg.start) < SNAP_TOLERANCE);
    const endNearRidge = ridgePoints.some((p) => distance(p, seg.end) < SNAP_TOLERANCE);
    const startNearEave = eavePoints.some((p) => distance(p, seg.start) < SNAP_TOLERANCE);
    const endNearEave = eavePoints.some((p) => distance(p, seg.end) < SNAP_TOLERANCE);

    if ((startNearRidge && endNearEave) || (endNearRidge && startNearEave)) {
      seg.used = true;
      // Orient: start at ridge, end at eave
      const ridgeEnd = startNearRidge ? seg.start : seg.end;
      const eaveEnd = startNearRidge ? seg.end : seg.start;
      hips.push({
        start: ridgeEnd,
        end: eaveEnd,
        type: "hip", // distinguish hip vs valley later if needed
      });
    }
  }

  // Also check for diagonal lines near eave corners (these might be hips
  // even if we couldn't match them to a specific ridge point)
  for (const seg of segments) {
    if (seg.used || seg.length < MIN_HIP_LENGTH) continue;

    const angleFromHoriz = seg.angle > Math.PI / 2
      ? Math.PI - seg.angle
      : seg.angle;
    if (angleFromHoriz < HIP_MIN_ANGLE || angleFromHoriz > HIP_MAX_ANGLE) continue;

    // If at least one end is near an eave corner, it's likely a hip
    const eitherNearEave =
      eavePoints.some((p) => distance(p, seg.start) < SNAP_TOLERANCE) ||
      eavePoints.some((p) => distance(p, seg.end) < SNAP_TOLERANCE);

    if (eitherNearEave) {
      seg.used = true;
      hips.push({
        start: seg.start,
        end: seg.end,
        type: "hip",
      });
    }
  }

  return hips;
}

// ─── Eave Outline Assembly ───────────────────────────────────────────────────

/**
 * Build a closed polygon from eave edges by connecting nearby endpoints.
 */
function buildEaveOutline(eaves: RoofEaveEdge[]): Point2D[] {
  if (eaves.length === 0) return [];

  // Collect all unique endpoints
  const allPoints: Point2D[] = [];
  for (const eave of eaves) {
    addUniquePoint(allPoints, eave.start);
    addUniquePoint(allPoints, eave.end);
  }

  if (allPoints.length < 3) return allPoints;

  // Order points to form a convex hull (or at least a reasonable polygon)
  // Use centroid-angle sorting for a simple outline
  const cx = allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length;
  const cy = allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length;

  allPoints.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  return allPoints;
}

function addUniquePoint(points: Point2D[], newPoint: Point2D): void {
  const exists = points.some(
    (p) => distance(p, newPoint) < SNAP_TOLERANCE,
  );
  if (!exists) {
    points.push(newPoint);
  }
}
