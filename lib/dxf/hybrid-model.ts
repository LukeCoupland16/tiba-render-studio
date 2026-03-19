/**
 * Hybrid Model Generator — Uses AI vision to interpret floor plan images
 * combined with DXF-extracted measurements to produce a clean 3D model.
 *
 * The DXF parser gives us exact measurements (building dimensions, section heights).
 * AI vision gives us the spatial understanding (where walls run, room layout).
 * Together they produce a geometrically accurate 3D model.
 */

import type { FloorPlan, Wall, Opening, Room, Column, Point2D, V3Config } from "../types-v3";
import { v4 as uuid } from "uuid";

// ─── AI-Generated Model Schema ───────────────────────────────────────────────

/** The JSON schema we ask AI to produce */
export interface AIModelDescription {
  /** Building overall dimensions in mm */
  building: {
    width: number;
    depth: number;
  };
  /** Wall segments — each wall is a line from start to end with thickness */
  walls: Array<{
    /** Start point in mm from building origin (bottom-left) */
    startX: number;
    startY: number;
    /** End point in mm */
    endX: number;
    endY: number;
    /** Wall thickness in mm (typically 150-200mm) */
    thickness: number;
    /** Wall height in mm */
    height: number;
    /** What this wall belongs to */
    room?: string;
  }>;
  /** Door openings */
  doors: Array<{
    /** Center position */
    x: number;
    y: number;
    /** Width of the door opening in mm */
    width: number;
    /** Which direction the door faces: "north" | "south" | "east" | "west" */
    direction: string;
  }>;
  /** Window openings */
  windows: Array<{
    x: number;
    y: number;
    width: number;
    sillHeight: number;
    direction: string;
  }>;
  /** Rooms with labels */
  rooms: Array<{
    label: string;
    centerX: number;
    centerY: number;
    type: "interior" | "exterior" | "service";
  }>;
  /** Structural columns */
  columns: Array<{
    x: number;
    y: number;
    size: number;
  }>;
  /** Roof ridge lines */
  roofRidges: Array<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    height: number;
  }>;
  /** Roof eave height (where roof meets wall tops) */
  eaveHeight: number;
}

// ─── Prompt for AI Vision ────────────────────────────────────────────────────

export function buildVisionPrompt(
  measurements: {
    building: { width_m: string; depth_m: string };
    section_heights: Array<{ height_zones: Array<{ height_mm: number }> }>;
    columns: Array<{ x: number; y: number }>;
    rooms: Array<{ centroid: { x: number; y: number }; label: string }>;
  },
): string {
  // Extract useful ceiling heights from sections (filter out noise)
  const validHeights = measurements.section_heights
    .flatMap((s) => s.height_zones)
    .map((h) => h.height_mm)
    .filter((h) => h > 2000 && h < 8000)
    .sort((a, b) => a - b);

  const typicalCeiling = validHeights.length > 0
    ? validHeights[Math.floor(validHeights.length / 2)]
    : 3000;

  const maxCeiling = validHeights.length > 0
    ? validHeights[validHeights.length - 1]
    : 4500;

  return `You are an expert architectural analyst. Analyze this floor plan drawing and produce a complete 3D model description as JSON.

BUILDING DIMENSIONS (from CAD data — these are EXACT):
- Width: ${measurements.building.width_m}m
- Depth: ${measurements.building.depth_m}m
- Typical ceiling height: ${typicalCeiling}mm
- Maximum ceiling height: ${maxCeiling}mm (living area with pitched roof)

The coordinate system: X goes left to right (0 to ${parseFloat(measurements.building.width_m) * 1000}mm), Y goes bottom to top (0 to ${parseFloat(measurements.building.depth_m) * 1000}mm).

INSTRUCTIONS:
1. Trace EVERY visible wall in the floor plan as line segments (startX,startY → endX,endY)
2. Walls are typically 150mm thick for interior, 200mm for exterior
3. Identify all door openings (gaps in walls with door swing arcs)
4. Identify all window openings
5. Label each room you can see in the drawing
6. Note structural columns (small squares/circles at regular spacing)
7. Identify the main roof ridge line(s) — where the roof peaks

OUTPUT FORMAT — respond ONLY with valid JSON matching this exact schema:
{
  "building": { "width": <mm>, "depth": <mm> },
  "walls": [{ "startX": <mm>, "startY": <mm>, "endX": <mm>, "endY": <mm>, "thickness": <mm>, "height": <mm>, "room": "<label>" }],
  "doors": [{ "x": <mm>, "y": <mm>, "width": <mm>, "direction": "<north|south|east|west>" }],
  "windows": [{ "x": <mm>, "y": <mm>, "width": <mm>, "sillHeight": <mm>, "direction": "<north|south|east|west>" }],
  "rooms": [{ "label": "<name>", "centerX": <mm>, "centerY": <mm>, "type": "<interior|exterior|service>" }],
  "columns": [{ "x": <mm>, "y": <mm>, "size": <mm> }],
  "roofRidges": [{ "startX": <mm>, "startY": <mm>, "endX": <mm>, "endY": <mm>, "height": <mm> }],
  "eaveHeight": <mm>
}

Be thorough — trace every wall segment. A typical villa has 40-80 wall segments. Use the exact building dimensions provided. Respond with ONLY the JSON, no other text.`;
}

// ─── Convert AI Model to FloorPlan ──────────────────────────────────────────

export function aiModelToFloorPlan(
  model: AIModelDescription,
  config: V3Config,
): FloorPlan {
  const walls: Wall[] = model.walls.map((w) => ({
    id: uuid(),
    start: { x: w.startX, y: w.startY },
    end: { x: w.endX, y: w.endY },
    thickness: w.thickness || 150,
    height: w.height || config.defaultCeilingHeight,
    heightSource: "section" as const,
    layer: "AI_VISION",
    style: "single-line" as const,
  }));

  const openings: Opening[] = [
    ...model.doors.map((d) => ({
      id: uuid(),
      type: "door" as const,
      wallId: findNearestWallId(d, walls),
      position: 0,
      width: d.width || 900,
      height: config.defaultDoorHeadHeight,
      sillHeight: 0,
      heightSource: "default" as const,
      layer: "AI_VISION",
    })),
    ...model.windows.map((w) => ({
      id: uuid(),
      type: "window" as const,
      wallId: findNearestWallId(w, walls),
      position: 0,
      width: w.width || 1200,
      height: config.defaultWindowHeadHeight - (w.sillHeight || config.defaultSillHeight),
      sillHeight: w.sillHeight || config.defaultSillHeight,
      heightSource: "default" as const,
      layer: "AI_VISION",
    })),
  ];

  const rooms: Room[] = model.rooms.map((r) => ({
    id: uuid(),
    label: r.label,
    roomType: r.type || "interior",
    boundary: makeRoomBoundary(r, model.rooms),
    area: estimateRoomArea(r, model.rooms),
    ceilingHeight: config.defaultCeilingHeight,
    heightSource: "default" as const,
    centroid: { x: r.centerX, y: r.centerY },
  }));

  const columns: Column[] = model.columns.map((c) => ({
    id: uuid(),
    position: { x: c.x, y: c.y },
    width: c.size || 200,
    depth: c.size || 200,
    height: config.defaultCeilingHeight,
    layer: "AI_VISION",
  }));

  const bounds = {
    minX: -2000,
    minY: -2000,
    maxX: model.building.width + 2000,
    maxY: model.building.depth + 2000,
  };

  return {
    walls,
    openings,
    rooms,
    bounds,
    units: config.units,
    layers: [],
    sections: [],
    roofSegments: [],
    roofFaces: [],
    roofPlan: null,
    columns,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findNearestWallId(
  point: { x: number; y: number },
  walls: Wall[],
): string {
  let bestId = walls[0]?.id || "";
  let bestDist = Infinity;

  for (const wall of walls) {
    const mx = (wall.start.x + wall.end.x) / 2;
    const my = (wall.start.y + wall.end.y) / 2;
    const d = Math.sqrt((point.x - mx) ** 2 + (point.y - my) ** 2);
    if (d < bestDist) {
      bestDist = d;
      bestId = wall.id;
    }
  }
  return bestId;
}

function makeRoomBoundary(
  room: { centerX: number; centerY: number },
  allRooms: Array<{ centerX: number; centerY: number }>,
): Point2D[] {
  // Estimate room size from nearest neighbor distance
  let minDist = Infinity;
  for (const other of allRooms) {
    if (other === room) continue;
    const d = Math.sqrt(
      (room.centerX - other.centerX) ** 2 +
      (room.centerY - other.centerY) ** 2,
    );
    if (d < minDist) minDist = d;
  }
  const r = Math.min(Math.max(minDist / 2, 2000), 5000);

  return [
    { x: room.centerX - r, y: room.centerY - r },
    { x: room.centerX + r, y: room.centerY - r },
    { x: room.centerX + r, y: room.centerY + r },
    { x: room.centerX - r, y: room.centerY + r },
  ];
}

function estimateRoomArea(
  room: { centerX: number; centerY: number },
  allRooms: Array<{ centerX: number; centerY: number }>,
): number {
  let minDist = Infinity;
  for (const other of allRooms) {
    if (other === room) continue;
    const d = Math.sqrt(
      (room.centerX - other.centerX) ** 2 +
      (room.centerY - other.centerY) ** 2,
    );
    if (d < minDist) minDist = d;
  }
  const side = Math.min(Math.max(minDist, 4000), 10000);
  return side * side;
}
