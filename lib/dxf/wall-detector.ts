/**
 * Wall Detector — Detects walls from DXF entities on wall-classified layers.
 *
 * Handles three drawing styles:
 * 1. Single-line walls: Each LINE entity is a wall centerline, user provides thickness
 * 2. Double-line walls: Parallel LINE pairs represent inner/outer faces, thickness = gap
 * 3. Polyline walls: Closed LWPOLYLINE rectangles represent wall footprints
 */

import { v4 as uuid } from "uuid";
import type { Wall, Point2D, V3Config, LayerInfo } from "../types-v3";
import type { ParsedEntity, ParsedLine, ParsedPolyline } from "./parser";
import {
  getEntitiesByClassification,
  getLinearEntities,
  lineLength,
  lineAngle,
  normalizeAngle,
  perpendicularDistance,
  midpoint,
  distance,
} from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Maximum gap between parallel lines to be considered a double-line wall (in drawing units) */
const MAX_WALL_THICKNESS = 500;
/** Minimum gap between parallel lines to be considered a double-line wall */
const MIN_WALL_THICKNESS = 50;
/** Angular tolerance for "parallel" lines (in radians, ~2 degrees) */
const PARALLEL_ANGLE_TOLERANCE = 0.035;
/** Minimum wall length to avoid detecting tiny fragments */
const MIN_WALL_LENGTH = 100;
/** Overlap ratio required for parallel lines to be considered a wall pair */
const MIN_OVERLAP_RATIO = 0.5;

// ─── Line Segment Representation ─────────────────────────────────────────────

interface LineSegment {
  start: Point2D;
  end: Point2D;
  angle: number;       // normalized angle [0, PI)
  length: number;
  layer: string;
  used: boolean;       // flag to avoid double-matching
}

// ─── Main Detection Function ─────────────────────────────────────────────────

/**
 * Detect walls from DXF entities on wall-classified layers.
 * Returns an array of Wall objects with positions, thickness, and default heights.
 */
export function detectWalls(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  config: V3Config,
): Wall[] {
  // Get entities on wall-classified layers
  const wallEntities = getEntitiesByClassification(entities, layers, "wall");

  // Also scan layer "0" for wall-like geometry (many AutoCAD drawings
  // have walls on the default layer)
  const layer0Walls = detectWallsFromLayer0(entities, config);

  const linearEntities = getLinearEntities([...wallEntities, ...layer0Walls]);

  // Separate into individual line segments and polylines
  const lines: LineSegment[] = [];
  const polylines: ParsedPolyline[] = [];

  for (const entity of linearEntities) {
    if (entity.type === "LINE") {
      const len = lineLength(entity.start, entity.end);
      if (len >= MIN_WALL_LENGTH) {
        lines.push({
          start: entity.start,
          end: entity.end,
          angle: normalizeAngle(lineAngle(entity.start, entity.end)),
          length: len,
          layer: entity.layer,
          used: false,
        });
      }
    } else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      polylines.push(entity);
    }
  }

  const walls: Wall[] = [];

  // Strategy 1: Detect closed polyline walls (rectangular wall footprints)
  walls.push(...detectPolylineWalls(polylines, config));

  // Strategy 2: Detect double-line wall pairs (parallel lines)
  walls.push(...detectDoubleLineWalls(lines, config));

  // Strategy 3: Remaining unmatched lines become single-line walls
  walls.push(...detectSingleLineWalls(lines, config));

  return walls;
}

// ─── Strategy 1: Polyline Walls ──────────────────────────────────────────────

function detectPolylineWalls(
  polylines: ParsedPolyline[],
  config: V3Config,
): Wall[] {
  const walls: Wall[] = [];

  for (const poly of polylines) {
    // Only consider closed polylines with constant width (wall footprints)
    if (!poly.closed) continue;

    // If the polyline has a width property, it's a single-line wall with width
    if (poly.width && poly.width >= MIN_WALL_THICKNESS) {
      // Convert polyline segments to walls with the specified width
      for (let i = 0; i < poly.vertices.length; i++) {
        const start = poly.vertices[i];
        const end = poly.vertices[(i + 1) % poly.vertices.length];
        const len = lineLength(start, end);
        if (len < MIN_WALL_LENGTH) continue;

        walls.push({
          id: uuid(),
          start,
          end,
          thickness: poly.width,
          height: config.defaultCeilingHeight,
          heightSource: "default",
          layer: poly.layer,
          style: "polyline",
        });
      }
      continue;
    }

    // Check if this is a thin rectangle (wall footprint)
    if (poly.vertices.length === 4 || poly.vertices.length === 5) {
      const rectWall = tryRectangleWall(poly.vertices, poly.layer, config);
      if (rectWall) {
        walls.push(rectWall);
      }
    }
  }

  return walls;
}

/** Try to interpret a 4-vertex closed polyline as a rectangular wall */
function tryRectangleWall(
  vertices: Point2D[],
  layer: string,
  config: V3Config,
): Wall | null {
  // Get the 4 unique vertices (5th might be closing vertex)
  const verts = vertices.slice(0, 4);

  // Compute side lengths
  const sides = [];
  for (let i = 0; i < 4; i++) {
    sides.push(lineLength(verts[i], verts[(i + 1) % 4]));
  }

  // A wall rectangle should have 2 long sides and 2 short sides
  const sorted = [...sides].sort((a, b) => a - b);
  const shortSide = (sorted[0] + sorted[1]) / 2;
  const longSide = (sorted[2] + sorted[3]) / 2;

  // The short side is the wall thickness
  if (shortSide < MIN_WALL_THICKNESS || shortSide > MAX_WALL_THICKNESS) return null;
  if (longSide < MIN_WALL_LENGTH) return null;
  if (longSide / shortSide < 2) return null; // must be elongated

  // Find which pair of sides is the long pair (the wall centerline runs along these)
  let wallStart: Point2D, wallEnd: Point2D;
  if (sides[0] + sides[2] > sides[1] + sides[3]) {
    // sides 0 and 2 are long
    wallStart = midpoint(verts[0], verts[3]);
    wallEnd = midpoint(verts[1], verts[2]);
  } else {
    // sides 1 and 3 are long
    wallStart = midpoint(verts[0], verts[1]);
    wallEnd = midpoint(verts[2], verts[3]);
  }

  return {
    id: uuid(),
    start: wallStart,
    end: wallEnd,
    thickness: shortSide,
    height: config.defaultCeilingHeight,
    heightSource: "default",
    layer,
    style: "polyline",
  };
}

// ─── Strategy 2: Double-Line Walls ───────────────────────────────────────────

function detectDoubleLineWalls(
  lines: LineSegment[],
  config: V3Config,
): Wall[] {
  const walls: Wall[] = [];

  // Sort lines by angle for efficient parallel detection
  const sortedLines = [...lines].sort((a, b) => a.angle - b.angle);

  for (let i = 0; i < sortedLines.length; i++) {
    const lineA = sortedLines[i];
    if (lineA.used) continue;

    for (let j = i + 1; j < sortedLines.length; j++) {
      const lineB = sortedLines[j];
      if (lineB.used) continue;

      // Check angular tolerance — since sorted, can break early
      const angleDiff = Math.abs(lineA.angle - lineB.angle);
      if (angleDiff > PARALLEL_ANGLE_TOLERANCE && angleDiff < Math.PI - PARALLEL_ANGLE_TOLERANCE) {
        if (angleDiff > PARALLEL_ANGLE_TOLERANCE * 3) break; // too far apart in angle
        continue;
      }

      // Check perpendicular distance (wall thickness)
      const dist = perpendicularDistance(lineB.start, lineA.start, lineA.end);
      if (dist < MIN_WALL_THICKNESS || dist > MAX_WALL_THICKNESS) continue;

      // Check overlap — the lines should overlap significantly along their length
      const overlap = computeOverlap(lineA, lineB);
      if (overlap < MIN_OVERLAP_RATIO) continue;

      // This is a wall pair — compute centerline
      const center = computeCenterline(lineA, lineB);

      walls.push({
        id: uuid(),
        start: center.start,
        end: center.end,
        thickness: dist,
        height: config.defaultCeilingHeight,
        heightSource: "default",
        layer: lineA.layer,
        style: "double-line",
      });

      lineA.used = true;
      lineB.used = true;
      break; // move to next lineA
    }
  }

  return walls;
}

/** Compute how much two line segments overlap along their shared direction */
function computeOverlap(a: LineSegment, b: LineSegment): number {
  // Project both lines onto the direction of line A
  const dx = a.end.x - a.start.x;
  const dy = a.end.y - a.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;

  const ux = dx / len;
  const uy = dy / len;

  // Project line A endpoints
  const a0 = 0;
  const a1 = len;

  // Project line B endpoints onto line A's direction
  const b0 = (b.start.x - a.start.x) * ux + (b.start.y - a.start.y) * uy;
  const b1 = (b.end.x - a.start.x) * ux + (b.end.y - a.start.y) * uy;

  const bMin = Math.min(b0, b1);
  const bMax = Math.max(b0, b1);

  // Compute overlap
  const overlapStart = Math.max(a0, bMin);
  const overlapEnd = Math.min(a1, bMax);
  const overlapLength = Math.max(0, overlapEnd - overlapStart);

  const shorter = Math.min(a1 - a0, bMax - bMin);
  return shorter > 0 ? overlapLength / shorter : 0;
}

/** Compute the centerline of two parallel line segments */
function computeCenterline(
  a: LineSegment,
  b: LineSegment,
): { start: Point2D; end: Point2D } {
  // Project both lines onto line A's direction and take the union extent
  const dx = a.end.x - a.start.x;
  const dy = a.end.y - a.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;

  // Project all 4 endpoints
  const projections = [
    { t: 0, p: a.start },
    { t: len, p: a.end },
    {
      t: (b.start.x - a.start.x) * ux + (b.start.y - a.start.y) * uy,
      p: b.start,
    },
    {
      t: (b.end.x - a.start.x) * ux + (b.end.y - a.start.y) * uy,
      p: b.end,
    },
  ];

  // Take the overlap range
  const aMin = 0, aMax = len;
  const bTs = [projections[2].t, projections[3].t];
  const bMin = Math.min(...bTs), bMax = Math.max(...bTs);
  const tStart = Math.max(aMin, bMin);
  const tEnd = Math.min(aMax, bMax);

  // Centerline is at the midpoint between the two lines
  const midA_start = {
    x: a.start.x + tStart * ux,
    y: a.start.y + tStart * uy,
  };
  const midA_end = {
    x: a.start.x + tEnd * ux,
    y: a.start.y + tEnd * uy,
  };

  // Offset perpendicular to the midpoint between lines
  const perpX = -uy;
  const perpY = ux;
  const dist = perpendicularDistance(b.start, a.start, a.end);
  const halfDist = dist / 2;

  // Determine which side B is on
  const cross = dx * (b.start.y - a.start.y) - dy * (b.start.x - a.start.x);
  const sign = cross > 0 ? 1 : -1;

  return {
    start: {
      x: midA_start.x + sign * halfDist * perpX,
      y: midA_start.y + sign * halfDist * perpY,
    },
    end: {
      x: midA_end.x + sign * halfDist * perpX,
      y: midA_end.y + sign * halfDist * perpY,
    },
  };
}

// ─── Strategy 3: Single-Line Walls ───────────────────────────────────────────

function detectSingleLineWalls(
  lines: LineSegment[],
  config: V3Config,
): Wall[] {
  return lines
    .filter((line) => !line.used)
    .map((line) => ({
      id: uuid(),
      start: line.start,
      end: line.end,
      thickness: config.defaultWallThickness,
      height: config.defaultCeilingHeight,
      heightSource: "default" as const,
      layer: line.layer,
      style: "single-line" as const,
    }));
}

// ─── Wall Graph Utilities ────────────────────────────────────────────────────

/** Snap tolerance for connecting wall endpoints */
const SNAP_TOLERANCE = 50; // in drawing units

/**
 * Find walls that connect at endpoints (within snap tolerance).
 * Returns adjacency list: wallId → set of connected wallIds.
 */
export function buildWallGraph(walls: Wall[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const wall of walls) {
    graph.set(wall.id, new Set());
  }

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];

      // Check all 4 endpoint combinations
      if (
        distance(a.start, b.start) < SNAP_TOLERANCE ||
        distance(a.start, b.end) < SNAP_TOLERANCE ||
        distance(a.end, b.start) < SNAP_TOLERANCE ||
        distance(a.end, b.end) < SNAP_TOLERANCE
      ) {
        graph.get(a.id)!.add(b.id);
        graph.get(b.id)!.add(a.id);
      }
    }
  }

  return graph;
}

// ─── Layer 0 Wall Detection ──────────────────────────────────────────────────

/**
 * Detect wall-like geometry from layer "0" using geometric heuristics.
 *
 * In many AutoCAD drawings, walls are drawn on the default layer (0)
 * as closed rectangular polylines. We identify these by looking for
 * closed 4-vertex polylines where:
 * - One side is thin (50-400mm — the wall thickness)
 * - The other side is long (>500mm — the wall length)
 * - The aspect ratio is elongated (length/thickness > 2)
 *
 * We also detect long open polylines that could be wall outlines.
 */
function detectWallsFromLayer0(
  entities: ParsedEntity[],
  config: V3Config,
): ParsedPolyline[] {
  const layer0 = entities.filter((e) => e.layer === "0");
  const results: ParsedPolyline[] = [];

  for (const entity of layer0) {
    if (entity.type !== "LWPOLYLINE" && entity.type !== "POLYLINE") continue;

    // Strategy A: Closed rectangles that look like wall footprints
    if (entity.closed && (entity.vertices.length === 4 || entity.vertices.length === 5)) {
      const verts = entity.vertices.slice(0, 4);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const w = maxX - minX;
      const h = maxY - minY;
      const shortSide = Math.min(w, h);
      const longSide = Math.max(w, h);

      // Wall criteria: thin side 50-400mm, long side > 500mm, aspect ratio > 2
      if (shortSide >= 50 && shortSide <= 400 && longSide >= 500 && longSide / shortSide > 2) {
        // Re-tag as wall layer so downstream processing picks it up
        results.push({ ...entity, layer: "_V3_WALL_FROM_L0" });
      }
    }

    // Strategy B: Long open polylines that could be wall centerlines or outlines
    if (!entity.closed && entity.vertices.length >= 2) {
      let totalLen = 0;
      for (let i = 0; i < entity.vertices.length - 1; i++) {
        totalLen += lineLength(entity.vertices[i], entity.vertices[i + 1]);
      }
      // Only consider polylines > 3m as potential wall outlines
      if (totalLen > 3000 && totalLen < 200000) {
        // Check that segments are axis-aligned (walls are typically orthogonal)
        let axisAlignedCount = 0;
        for (let i = 0; i < entity.vertices.length - 1; i++) {
          const angle = normalizeAngle(lineAngle(entity.vertices[i], entity.vertices[i + 1]));
          const isAxisAligned =
            angle < 0.1 || angle > Math.PI - 0.1 || Math.abs(angle - Math.PI / 2) < 0.1;
          if (isAxisAligned) axisAlignedCount++;
        }
        const segments = entity.vertices.length - 1;
        if (segments > 0 && axisAlignedCount / segments > 0.7) {
          results.push({ ...entity, layer: "_V3_WALL_FROM_L0" });
        }
      }
    }
  }

  return results;
}
