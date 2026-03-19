/**
 * Room Detector — Identifies enclosed rooms from wall geometry.
 *
 * Uses wall connectivity to find closed loops, then extracts room labels
 * from nearby TEXT/MTEXT entities.
 */

import { v4 as uuid } from "uuid";
import type { Room, RoomType, Wall, Point2D, V3Config, LayerInfo, Bounds2D } from "../types-v3";
import type { ParsedEntity, ParsedInsert } from "./parser";
import {
  getEntitiesByClassification,
  getTextEntities,
  getInsertEntities,
  distance,
  computeEntityBounds,
} from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Snap tolerance for wall endpoint matching */
const SNAP_TOLERANCE = 100;
/** Maximum distance from a text label to a room centroid to associate them */
const LABEL_DISTANCE_TOLERANCE = 3000;

// ─── Main Room Detection ─────────────────────────────────────────────────────

/**
 * Detect rooms by finding enclosed regions formed by walls.
 * Uses a simplified approach: find closed polygons in the wall graph.
 */
export function detectRooms(
  walls: Wall[],
  entities: ParsedEntity[],
  layers: LayerInfo[],
  config: V3Config,
): Room[] {
  // Strategy 1: Build a graph of connected wall endpoints and find closed loops
  const graph = buildEndpointGraph(walls);
  const cycles = findMinimalCycles(graph, walls);

  const rooms: Room[] = [];
  for (const cycle of cycles) {
    const boundary = cycle.map((nodeId) => graph.nodes.get(nodeId)!);
    const area = computePolygonArea(boundary);

    if (area < 1e6) continue; // < 1 sq meter
    if (area > 1e9) continue; // > 1000 sq meters

    const centroid = computeCentroid(boundary);

    rooms.push({
      id: uuid(),
      label: "",
      roomType: "interior",
      boundary,
      area,
      ceilingHeight: config.defaultCeilingHeight,
      heightSource: "default",
      centroid,
    });
  }

  // Strategy 2 (fallback): If wall-graph produced few/no rooms, create rooms
  // from INSERT positions of room-name blocks. Common in tropical/open-plan
  // architecture where walls don't form closed loops.
  if (rooms.length < 3) {
    const insertRooms = detectRoomsFromInserts(entities, walls, config);
    rooms.push(...insertRooms);
  }

  // Assign labels from text entities
  assignRoomLabels(rooms, entities, layers);

  return rooms;
}

// ─── Graph Building ──────────────────────────────────────────────────────────

interface EndpointGraph {
  nodes: Map<string, Point2D>;
  edges: Map<string, Set<string>>;
}

function pointKey(p: Point2D): string {
  // Round to snap tolerance to merge nearby endpoints
  const rx = Math.round(p.x / SNAP_TOLERANCE) * SNAP_TOLERANCE;
  const ry = Math.round(p.y / SNAP_TOLERANCE) * SNAP_TOLERANCE;
  return `${rx},${ry}`;
}

function buildEndpointGraph(walls: Wall[]): EndpointGraph {
  const nodes = new Map<string, Point2D>();
  const edges = new Map<string, Set<string>>();

  for (const wall of walls) {
    const startKey = pointKey(wall.start);
    const endKey = pointKey(wall.end);

    if (!nodes.has(startKey)) nodes.set(startKey, wall.start);
    if (!nodes.has(endKey)) nodes.set(endKey, wall.end);

    if (!edges.has(startKey)) edges.set(startKey, new Set());
    if (!edges.has(endKey)) edges.set(endKey, new Set());

    edges.get(startKey)!.add(endKey);
    edges.get(endKey)!.add(startKey);
  }

  return { nodes, edges };
}

// ─── Cycle Detection ─────────────────────────────────────────────────────────

/**
 * Find minimal cycles (rooms) in the wall graph.
 * Uses a face-finding algorithm based on the planar subdivision.
 */
function findMinimalCycles(
  graph: EndpointGraph,
  walls: Wall[],
): string[][] {
  const cycles: string[][] = [];
  const visitedEdges = new Set<string>();

  // For each node, try to walk a minimal cycle using the "turn right" heuristic
  for (const [startNode] of graph.edges) {
    const neighbors = graph.edges.get(startNode);
    if (!neighbors) continue;

    for (const nextNode of neighbors) {
      const edgeKey = `${startNode}->${nextNode}`;
      if (visitedEdges.has(edgeKey)) continue;

      const cycle = walkCycle(graph, startNode, nextNode, visitedEdges);
      if (cycle && cycle.length >= 3 && cycle.length <= 20) {
        cycles.push(cycle);
      }
    }
  }

  // Deduplicate cycles (same nodes in different order)
  return deduplicateCycles(cycles);
}

function walkCycle(
  graph: EndpointGraph,
  startNode: string,
  secondNode: string,
  visitedEdges: Set<string>,
): string[] | null {
  const path: string[] = [startNode];
  let prevNode = startNode;
  let currNode = secondNode;
  const maxSteps = 30;

  for (let step = 0; step < maxSteps; step++) {
    path.push(currNode);
    const edgeKey = `${prevNode}->${currNode}`;
    visitedEdges.add(edgeKey);

    if (currNode === startNode) {
      // Found a cycle
      return path.slice(0, -1); // remove the duplicate start node
    }

    const neighbors = graph.edges.get(currNode);
    if (!neighbors || neighbors.size === 0) return null;

    // Choose the next node using "turn right" — the neighbor that makes the
    // smallest clockwise angle from the incoming direction
    const currPoint = graph.nodes.get(currNode)!;
    const prevPoint = graph.nodes.get(prevNode)!;
    const incomingAngle = Math.atan2(
      currPoint.y - prevPoint.y,
      currPoint.x - prevPoint.x,
    );

    let bestNode: string | null = null;
    let bestAngle = Infinity;

    for (const neighbor of neighbors) {
      if (neighbor === prevNode) continue;
      const neighborPoint = graph.nodes.get(neighbor)!;
      const outAngle = Math.atan2(
        neighborPoint.y - currPoint.y,
        neighborPoint.x - currPoint.x,
      );

      // Clockwise angle from incoming direction
      let turnAngle = incomingAngle - outAngle;
      if (turnAngle <= 0) turnAngle += 2 * Math.PI;

      if (turnAngle < bestAngle) {
        bestAngle = turnAngle;
        bestNode = neighbor;
      }
    }

    if (!bestNode) return null;

    prevNode = currNode;
    currNode = bestNode;
  }

  return null; // exceeded max steps
}

function deduplicateCycles(cycles: string[][]): string[][] {
  const unique: string[][] = [];
  const seen = new Set<string>();

  for (const cycle of cycles) {
    // Normalize: sort the node keys and join
    const key = [...cycle].sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

// ─── Fallback: Rooms from INSERT Positions ───────────────────────────────────

/** Common block names used for room labels/tags */
const ROOM_BLOCK_PATTERNS = [
  /room\s*name/i,
  /room\s*tag/i,
  /room\s*label/i,
  /space\s*tag/i,
  /area\s*tag/i,
  /IMMASA/i,
];

/**
 * Create rooms from INSERT block positions when wall-graph detection fails.
 *
 * Room-name blocks (like "IMMASA Room Name") are placed by architects at the
 * center of each room. We use these positions as room centroids and create
 * approximate square boundaries based on distance to nearest neighbors.
 */
function detectRoomsFromInserts(
  entities: ParsedEntity[],
  walls: Wall[],
  config: V3Config,
): Room[] {
  // Find INSERT entities that look like room name blocks
  const inserts = getInsertEntities(entities);
  const roomInserts = inserts.filter((ins) =>
    ROOM_BLOCK_PATTERNS.some((p) => p.test(ins.blockName)),
  );

  if (roomInserts.length === 0) return [];

  // Deduplicate — some blocks are placed twice (line 1 + line 2 of name)
  // Merge inserts within 2m of each other
  const DEDUP_DIST = 2000;
  const uniquePositions: Point2D[] = [];
  for (const ins of roomInserts) {
    const isDup = uniquePositions.some(
      (p) => distance(p, ins.position) < DEDUP_DIST,
    );
    if (!isDup) {
      uniquePositions.push(ins.position);
    }
  }

  // Create rooms with approximate boundaries
  const rooms: Room[] = [];

  for (const pos of uniquePositions) {
    // Estimate room size from distance to nearest neighbor
    let minNeighborDist = Infinity;
    for (const other of uniquePositions) {
      if (other === pos) continue;
      const d = distance(pos, other);
      if (d < minNeighborDist) minNeighborDist = d;
    }

    // Room "radius" is half the distance to nearest neighbor, capped
    const roomRadius = Math.min(
      Math.max(minNeighborDist / 2, 2000), // at least 2m
      6000, // at most 6m
    );

    // Create a square boundary
    const boundary: Point2D[] = [
      { x: pos.x - roomRadius, y: pos.y - roomRadius },
      { x: pos.x + roomRadius, y: pos.y - roomRadius },
      { x: pos.x + roomRadius, y: pos.y + roomRadius },
      { x: pos.x - roomRadius, y: pos.y + roomRadius },
    ];

    const area = (roomRadius * 2) ** 2;

    rooms.push({
      id: uuid(),
      label: "", // will be assigned by label detection
      roomType: "interior", // will be reclassified after label assignment
      boundary,
      area,
      ceilingHeight: config.defaultCeilingHeight,
      heightSource: "default",
      centroid: pos,
    });
  }

  return rooms;
}

// ─── Room Label Assignment ───────────────────────────────────────────────────

function assignRoomLabels(
  rooms: Room[],
  entities: ParsedEntity[],
  layers: LayerInfo[],
): void {
  // Get text entities from annotation layers + all text entities
  const annotationTexts = getTextEntities(
    getEntitiesByClassification(entities, layers, "annotation"),
  );
  const allTexts = getTextEntities(entities);

  // Combine and deduplicate
  const texts = [...annotationTexts];
  const seenPositions = new Set(annotationTexts.map((t) => `${t.position.x},${t.position.y}`));
  for (const t of allTexts) {
    const key = `${t.position.x},${t.position.y}`;
    if (!seenPositions.has(key)) {
      texts.push(t);
      seenPositions.add(key);
    }
  }

  // Room-like label patterns
  const roomLabelPattern = /\b(LIVING|BEDROOM|BED\s*ROOM|BATH|BATHROOM|KITCHEN|DINING|MASTER|GUEST|STUDY|OFFICE|LOBBY|ENTRY|FOYER|HALL|CORRIDOR|GARAGE|STORE|LAUNDRY|TERRACE|BALCONY|POOL|SPA|LOUNGE|PATIO|GARDEN|VOID|DOUBLE\s*HEIGHT|MEZZANINE|PANTRY|WC|TOILET|POWDER|CLOSET|WARDROBE|DRESSING|KAMAR|DAPUR|RUANG|TERAS|KOLAM|GUDANG|CARPORT|PARKING|OUTDOOR|SHOWER|SECURITY|STAFF|BBQ|POND|GAZEBO|PAVILION)\b/i;

  for (const text of texts) {
    // Check if text looks like a room label
    const cleanText = text.text.replace(/\\P/g, "\n").replace(/\{[^}]*\}/g, "").trim();
    if (!roomLabelPattern.test(cleanText)) continue;

    // Find the nearest room centroid
    let bestRoom: Room | null = null;
    let bestDist = Infinity;

    for (const room of rooms) {
      if (room.label) continue; // already labeled

      // Check if text is inside the room (approximate using centroid distance)
      const dist = distance(text.position, room.centroid);
      if (dist < bestDist && dist < LABEL_DISTANCE_TOLERANCE) {
        bestDist = dist;
        bestRoom = room;
      }
    }

    if (bestRoom) {
      bestRoom.label = cleanText;
    }
  }

  // Assign generic labels to unlabeled rooms
  let roomIndex = 1;
  for (const room of rooms) {
    if (!room.label) {
      room.label = `Room ${roomIndex}`;
      roomIndex++;
    }
  }

  // Classify room types based on labels
  classifyRoomTypes(rooms);
}

/** Patterns for exterior/outdoor spaces */
const EXTERIOR_PATTERNS = /\b(POOL|SWIMMING|DECK|GARDEN|TERRACE|BALCONY|PATIO|OUTDOOR|BBQ|POND|GAZEBO|PAVILION|CARPORT|PARKING|TEMPLE|KOLAM|TAMAN|TERAS)\b/i;
/** Patterns for service/utility spaces */
const SERVICE_PATTERNS = /\b(SECURITY|STAFF|PARKING|GARAGE|STORE|GUDANG|LAUNDRY|MECHANICAL|ELECTRICAL|PUMP)\b/i;

function classifyRoomTypes(rooms: Room[]): void {
  for (const room of rooms) {
    if (EXTERIOR_PATTERNS.test(room.label)) {
      room.roomType = "exterior";
      // Exterior rooms don't need ceilings in the 3D model
    } else if (SERVICE_PATTERNS.test(room.label)) {
      room.roomType = "service";
    } else {
      room.roomType = "interior";
    }
  }
}

// ─── Geometry Utilities ──────────────────────────────────────────────────────

/** Compute the area of a polygon using the shoelace formula */
function computePolygonArea(vertices: Point2D[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

/** Compute the centroid of a polygon */
function computeCentroid(vertices: Point2D[]): Point2D {
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return {
    x: cx / vertices.length,
    y: cy / vertices.length,
  };
}
