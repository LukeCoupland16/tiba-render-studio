/**
 * Opening Detector — Detects doors and windows from DXF entities.
 *
 * Detection strategies:
 * 1. Block insertions on door/window layers (most reliable)
 * 2. Arc entities on door layers (door swings)
 * 3. Gap analysis along wall lines (where wall segments are interrupted)
 */

import { v4 as uuid } from "uuid";
import type { Opening, OpeningType, Wall, Point2D, V3Config, LayerInfo } from "../types-v3";
import type { ParsedEntity, ParsedInsert, ParsedArc, ParsedPolyline } from "./parser";
import {
  getEntitiesByClassification,
  getInsertEntities,
  getArcEntities,
  distance,
  lineLength,
} from "./parser";

// ─── Block Name Patterns ─────────────────────────────────────────────────────

/** Common door block name patterns and how to extract width from name */
const DOOR_BLOCK_PATTERNS = [
  /\bDOOR[-_]?(\d+)/i,         // DOOR-900, DOOR_800
  /\bDR[-_]?(\d+)/i,           // DR-900, DR800
  /\bD(\d{3,4})\b/i,           // D900, D1200
  /\bPUERTA[-_]?(\d+)/i,       // PUERTA-900
  /\bPORTA[-_]?(\d+)/i,        // PORTA-900
  /\bDOOR\b/i,                 // Generic DOOR (no width encoded)
];

const WINDOW_BLOCK_PATTERNS = [
  /\bWINDOW[-_]?(\d+)/i,       // WINDOW-1200
  /\bWIN[-_]?(\d+)/i,          // WIN-1200
  /\bW(\d{3,4})\b/i,           // W1200
  /\bVENTANA[-_]?(\d+)/i,      // VENTANA-1200
  /\bFENSTER[-_]?(\d+)/i,      // FENSTER-1200
  /\bWINDOW\b/i,               // Generic WINDOW
];

/** Default opening widths when not encoded in block name */
const DEFAULT_DOOR_WIDTH = 900;
const DEFAULT_WINDOW_WIDTH = 1200;

// ─── Main Detection Function ─────────────────────────────────────────────────

/**
 * Detect doors and windows from DXF entities and associate them with walls.
 */
export function detectOpenings(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  walls: Wall[],
  config: V3Config,
): Opening[] {
  const openings: Opening[] = [];

  // Strategy 1: Block insertions on door/window layers
  openings.push(...detectBlockInsertions(entities, layers, walls, config));

  // Strategy 2: Arc entities (door swings) on door layers
  openings.push(...detectDoorSwings(entities, layers, walls, config));

  // Strategy 3: Rectangular polylines on door layers (door leaf outlines)
  openings.push(...detectDoorLeafRectangles(entities, layers, walls, config));

  // Deduplicate — same position on same wall within tolerance
  return deduplicateOpenings(openings);
}

// ─── Strategy 1: Block Insertions ────────────────────────────────────────────

function detectBlockInsertions(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  walls: Wall[],
  config: V3Config,
): Opening[] {
  const openings: Opening[] = [];

  // Get inserts from door layers
  const doorEntities = getEntitiesByClassification(entities, layers, "door");
  const doorInserts = getInsertEntities(doorEntities);

  for (const insert of doorInserts) {
    const opening = blockInsertToOpening(insert, "door", walls, config);
    if (opening) openings.push(opening);
  }

  // Get inserts from window layers
  const windowEntities = getEntitiesByClassification(entities, layers, "window");
  const windowInserts = getInsertEntities(windowEntities);

  for (const insert of windowInserts) {
    const opening = blockInsertToOpening(insert, "window", walls, config);
    if (opening) openings.push(opening);
  }

  return openings;
}

function blockInsertToOpening(
  insert: ParsedInsert,
  type: OpeningType,
  walls: Wall[],
  config: V3Config,
): Opening | null {
  // Extract width from block name
  const width = extractWidthFromBlockName(insert.blockName, type);

  // Find the nearest wall
  const wallMatch = findNearestWall(insert.position, walls);
  if (!wallMatch) return null;

  // Compute position along wall
  const posAlongWall = projectPointOntoWall(insert.position, wallMatch.wall);

  return {
    id: uuid(),
    type,
    wallId: wallMatch.wall.id,
    position: posAlongWall,
    width: width * Math.abs(insert.scaleX), // scale affects width
    height: type === "door" ? config.defaultDoorHeadHeight : (config.defaultWindowHeadHeight - config.defaultSillHeight),
    sillHeight: type === "door" ? 0 : config.defaultSillHeight,
    heightSource: "default",
    layer: insert.layer,
    blockName: insert.blockName,
  };
}

function extractWidthFromBlockName(name: string, type: OpeningType): number {
  const patterns = type === "door" ? DOOR_BLOCK_PATTERNS : WINDOW_BLOCK_PATTERNS;

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }

  return type === "door" ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH;
}

// ─── Strategy 2: Door Swings (Arcs) ─────────────────────────────────────────

function detectDoorSwings(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  walls: Wall[],
  config: V3Config,
): Opening[] {
  const openings: Opening[] = [];

  const doorEntities = getEntitiesByClassification(entities, layers, "door");
  const arcs = getArcEntities(doorEntities);

  for (const arc of arcs) {
    // The radius of the arc = door width
    // Note: after block explosion, angle sweep values may be unreliable
    // (rotation gets added to start/end angles). We rely primarily on
    // radius being in door-width range (500-2000mm) and being on a door layer.
    const doorWidth = arc.radius;
    if (doorWidth < 500 || doorWidth > 2000) continue; // reasonable door width range

    // The center of the arc is at the door hinge point
    const hingePoint = arc.center;

    // Find nearest wall
    const wallMatch = findNearestWall(hingePoint, walls);
    if (!wallMatch) continue;

    const posAlongWall = projectPointOntoWall(hingePoint, wallMatch.wall);

    openings.push({
      id: uuid(),
      type: "door",
      wallId: wallMatch.wall.id,
      position: posAlongWall,
      width: doorWidth,
      height: config.defaultDoorHeadHeight,
      sillHeight: 0,
      heightSource: "default",
      layer: arc.layer,
    });
  }

  return openings;
}

// ─── Strategy 3: Door Leaf Rectangles ────────────────────────────────────────

/**
 * Detect doors from rectangular polylines on door layers.
 * Door leaves in plan view appear as thin rectangles:
 * - Short side: 20-50mm (door panel thickness)
 * - Long side: 500-2000mm (door width / opening width)
 */
function detectDoorLeafRectangles(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  walls: Wall[],
  config: V3Config,
): Opening[] {
  const openings: Opening[] = [];

  const doorEntities = getEntitiesByClassification(entities, layers, "door");
  const doorPolys = doorEntities.filter(
    (e): e is ParsedPolyline =>
      (e.type === "LWPOLYLINE" || e.type === "POLYLINE") && e.closed === true,
  );

  for (const poly of doorPolys) {
    if (poly.vertices.length !== 4 && poly.vertices.length !== 5) continue;

    const verts = poly.vertices.slice(0, 4);
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

    // Door leaf: thin panel (20-60mm) with width 500-2000mm
    if (shortSide < 15 || shortSide > 60) continue;
    if (longSide < 500 || longSide > 2000) continue;

    const doorCenter: Point2D = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const doorWidth = longSide;

    // Find nearest wall
    const wallMatch = findNearestWall(doorCenter, walls);
    if (!wallMatch) continue;

    const posAlongWall = projectPointOntoWall(doorCenter, wallMatch.wall);

    openings.push({
      id: uuid(),
      type: "door",
      wallId: wallMatch.wall.id,
      position: posAlongWall,
      width: doorWidth,
      height: config.defaultDoorHeadHeight,
      sillHeight: 0,
      heightSource: "default",
      layer: poly.layer,
    });
  }

  return openings;
}

// ─── Wall Association Utilities ──────────────────────────────────────────────

/** Maximum distance from an opening to a wall to be associated */
const MAX_OPENING_WALL_DISTANCE = 500;

interface WallMatch {
  wall: Wall;
  distance: number;
}

/** Find the nearest wall to a point */
function findNearestWall(point: Point2D, walls: Wall[]): WallMatch | null {
  let best: WallMatch | null = null;

  for (const wall of walls) {
    const dist = pointToSegmentDistance(point, wall.start, wall.end);
    if (dist > MAX_OPENING_WALL_DISTANCE) continue;
    if (!best || dist < best.distance) {
      best = { wall, distance: dist };
    }
  }

  return best;
}

/** Project a point onto a wall segment and return the distance along the wall */
function projectPointOntoWall(point: Point2D, wall: Wall): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen === 0) return 0;

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        (wallLen * wallLen),
    ),
  );

  return t * wallLen;
}

/** Distance from a point to a line segment */
function pointToSegmentDistance(
  point: Point2D,
  segStart: Point2D,
  segEnd: Point2D,
): number {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distance(point, segStart);

  let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = {
    x: segStart.x + t * dx,
    y: segStart.y + t * dy,
  };

  return distance(point, proj);
}

// ─── Deduplication ───────────────────────────────────────────────────────────

const DEDUP_TOLERANCE = 200; // openings within this distance on the same wall are duplicates

function deduplicateOpenings(openings: Opening[]): Opening[] {
  const result: Opening[] = [];

  for (const opening of openings) {
    const isDuplicate = result.some(
      (existing) =>
        existing.wallId === opening.wallId &&
        Math.abs(existing.position - opening.position) < DEDUP_TOLERANCE &&
        existing.type === opening.type,
    );
    if (!isDuplicate) {
      result.push(opening);
    }
  }

  return result;
}
