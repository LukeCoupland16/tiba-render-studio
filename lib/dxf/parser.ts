/**
 * DXF Parser — Parses DXF file content into structured entity data
 * with automatic layer classification based on standard architectural naming.
 */

import DxfParser from "dxf-parser";
import type {
  LayerInfo,
  LayerClassification,
  DrawingUnits,
  Bounds2D,
  Point2D,
} from "../types-v3";

// ─── Layer Name Pattern Matching ─────────────────────────────────────────────

/** Standard architectural layer naming conventions (AIA / common patterns) */
const LAYER_PATTERNS: Record<LayerClassification, RegExp[]> = {
  wall: [
    /\bwall\b/i,
    /\bA[-_]?WALL\b/i,
    /\bS[-_]?WALL\b/i,
    /\bWALL[-_]?INT\b/i,
    /\bWALL[-_]?EXT\b/i,
    /\bA[-_]?CUT\b/i,           // wall cross-sections in plan
    /\bMURO\b/i,                 // Spanish/Italian
    /\bWAND\b/i,                 // German
    /\bTANGGULAN\b/i,           // Indonesian (retaining wall)
    /\bBETON\b/i,               // Indonesian (concrete)
    /\bOUT\s*LINE\s*BANGUNAN\b/i, // Indonesian (building outline)
  ],
  door: [
    /\bdoor\b/i,
    /\bA[-_]?DOOR\b/i,
    /\bDR\b/i,
    /\bPUERTA\b/i,       // Spanish
    /\bPORTA\b/i,        // Italian/Portuguese
    /\bPINTU\b/i,        // Indonesian
  ],
  window: [
    /\bwindow\b/i,
    /\bA[-_]?GLAZ\b/i,
    /\bA[-_]?WINDOW\b/i,
    /\bWIN\b/i,
    /\bVENTANA\b/i,      // Spanish
    /\bFENSTER\b/i,      // German
    /\bJENDELA\b/i,      // Indonesian
  ],
  dimension: [
    /\bdim\b/i,
    /\bA[-_]?DIM\b/i,
    /\bDIMENSION\b/i,
    /\bANNO[-_]?DIM\b/i,
    /\bCOTA\b/i,         // Spanish
    /\bLEV\b/i,          // Level annotations
  ],
  furniture: [
    /\bfurn\b/i,
    /\bA[-_]?FURN\b/i,
    /\bAI[-_]?FURN\b/i,
    /\bFURNITURE\b/i,
    /\bEQUIP\b/i,
    /\bAPPLIANCE\b/i,
    /\bMUEBLE\b/i,       // Spanish
    /\b\d{2}[-_]?FURNITURE\b/i, // numbered furniture layers (07-FURNITURE)
  ],
  annotation: [
    /\btext\b/i,
    /\banno\b/i,
    /\bA[-_]?ANNO\b/i,
    /\bNOTE\b/i,
    /\bLABEL\b/i,
    /\bTITLE\b/i,
    /\bA[-_]?ELEV\b/i,       // elevation lines in plan view
    /\bCONT[-_]?M[NJ]R\b/i, // contour lines
    /\bPATOK\b/i,            // Indonesian (survey stakes)
    /\bPAGAR\b/i,            // Indonesian (fence)
    /\bBATAS\b/i,            // Indonesian (boundary)
    /\bASIRAN\b/i,           // Indonesian (irrigation/drainage lines)
  ],
  hatch: [
    /\bhatch\b/i,
    /\bA[-_]?AREA\b/i,
    /\bPATTERN\b/i,
    /\bFILL\b/i,
    /\bLINGKAR\b/i,    // Indonesian (tree trunk circles)
    /\bPOHON\b/i,      // Indonesian (tree)
    /\bTREE/i,         // Trees / landscape
    /\bCAY\b/i,        // Tree (Vietnamese/botanical)
    /\bNANGKA\b/i,     // Indonesian (jackfruit tree)
  ],
  other: [],
};

/** Layers to skip entirely — landscape and vegetation that add noise */
const SKIP_LAYER_PATTERNS = [
  /\bLINGKAR\b/i,     // tree trunk outlines
  /\bPOHON\b/i,       // trees
  /\bTREE/i,
  /\bCAY\b/i,
  /\bNANGKA\b/i,
];

/** Classify a layer name based on standard patterns */
export function classifyLayer(layerName: string): LayerClassification {
  for (const [classification, patterns] of Object.entries(LAYER_PATTERNS)) {
    if (classification === "other") continue;
    for (const pattern of patterns) {
      if (pattern.test(layerName)) {
        return classification as LayerClassification;
      }
    }
  }
  return "other";
}

// ─── Unit Detection ──────────────────────────────────────────────────────────

/** Map DXF $INSUNITS values to our DrawingUnits type */
const INSUNITS_MAP: Record<number, DrawingUnits> = {
  1: "in",   // Inches
  2: "ft",   // Feet
  4: "mm",   // Millimeters
  5: "cm",   // Centimeters
  6: "m",    // Meters
};

// ─── Entity Types We Care About ──────────────────────────────────────────────

export interface ParsedLine {
  type: "LINE";
  layer: string;
  start: Point2D;
  end: Point2D;
}

export interface ParsedPolyline {
  type: "LWPOLYLINE" | "POLYLINE";
  layer: string;
  vertices: Point2D[];
  closed: boolean;
  width?: number; // constant width if set
}

export interface ParsedArc {
  type: "ARC";
  layer: string;
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface ParsedCircle {
  type: "CIRCLE";
  layer: string;
  center: Point2D;
  radius: number;
}

export interface ParsedInsert {
  type: "INSERT";
  layer: string;
  blockName: string;
  position: Point2D;
  scaleX: number;
  scaleY: number;
  rotation: number;
  attributes: Record<string, string>;
}

export interface ParsedText {
  type: "TEXT" | "MTEXT";
  layer: string;
  position: Point2D;
  text: string;
  height: number;
}

export type ParsedEntity =
  | ParsedLine
  | ParsedPolyline
  | ParsedArc
  | ParsedCircle
  | ParsedInsert
  | ParsedText;

// ─── Block Definition ────────────────────────────────────────────────────────

export interface BlockDefinition {
  name: string;
  entities: ParsedEntity[];
  bounds: Bounds2D;
}

// ─── Full Parse Result ───────────────────────────────────────────────────────

export interface DxfParseResult {
  layers: LayerInfo[];
  entities: ParsedEntity[];
  blocks: BlockDefinition[];
  units: DrawingUnits;
  bounds: Bounds2D;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a DXF file string into structured data.
 * Extracts entities from model space, classifies layers, and detects units.
 */
export function parseDxf(dxfContent: string): DxfParseResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfContent);

  if (!dxf) {
    throw new Error("Failed to parse DXF file — file may be corrupt or unsupported");
  }

  // Extract units from header
  let units: DrawingUnits = "mm"; // default
  if (dxf.header && dxf.header["$INSUNITS"]) {
    const insUnits = dxf.header["$INSUNITS"] as number;
    units = INSUNITS_MAP[insUnits] || "mm";
  }

  // Extract and classify layers
  const layers: LayerInfo[] = [];
  const layerEntityCounts: Record<string, number> = {};

  if (dxf.tables?.layer?.layers) {
    for (const [name, layerData] of Object.entries(dxf.tables.layer.layers)) {
      const ld = layerData as { color?: number; visible?: boolean; frozen?: boolean };
      layers.push({
        name,
        classification: classifyLayer(name),
        entityCount: 0, // will be counted below
        color: ld.color || 7,
        visible: ld.visible !== false,
        frozen: ld.frozen === true,
      });
      layerEntityCounts[name] = 0;
    }
  }

  // Parse entities from model space
  const entities: ParsedEntity[] = [];
  if (dxf.entities) {
    for (const entity of dxf.entities) {
      const parsed = parseEntity(entity);
      if (parsed) {
        entities.push(parsed);
        if (parsed.layer && layerEntityCounts[parsed.layer] !== undefined) {
          layerEntityCounts[parsed.layer]++;
        }
      }
    }
  }

  // Update entity counts
  for (const layer of layers) {
    layer.entityCount = layerEntityCounts[layer.name] || 0;
  }

  // Parse ALL block definitions (including anonymous *U blocks — these contain
  // the actual geometry in many AutoCAD files)
  const blockMap = new Map<string, ParsedEntity[]>();
  const blocks: BlockDefinition[] = [];
  if (dxf.blocks) {
    for (const [name, block] of Object.entries(dxf.blocks)) {
      const blockData = block as { entities?: unknown[] };
      const blockEntities: ParsedEntity[] = [];
      if (blockData.entities) {
        for (const entity of blockData.entities) {
          const parsed = parseEntity(entity);
          if (parsed) blockEntities.push(parsed);
        }
      }
      blockMap.set(name, blockEntities);
      blocks.push({
        name,
        entities: blockEntities,
        bounds: computeEntityBounds(blockEntities),
      });
    }
  }

  // Flatten INSERT entities: recursively resolve block references into
  // world-space geometry. This is critical for AutoCAD files where the
  // drawing is composed of nested block references.
  const flattenedEntities = flattenInserts(entities, blockMap);

  // Recount entities by layer after flattening
  for (const key of Object.keys(layerEntityCounts)) {
    layerEntityCounts[key] = 0;
  }
  for (const e of flattenedEntities) {
    if (e.layer) {
      if (layerEntityCounts[e.layer] === undefined) {
        layerEntityCounts[e.layer] = 0;
        // Add new layer if it came from a block
        if (!layers.find((l) => l.name === e.layer)) {
          layers.push({
            name: e.layer,
            classification: classifyLayer(e.layer),
            entityCount: 0,
            color: 7,
            visible: true,
            frozen: false,
          });
        }
      }
      layerEntityCounts[e.layer]++;
    }
  }
  for (const layer of layers) {
    layer.entityCount = layerEntityCounts[layer.name] || 0;
  }

  // Compute overall bounds from flattened entities
  const bounds = computeEntityBounds(flattenedEntities);

  return { layers, entities: flattenedEntities, blocks, units, bounds };
}

// ─── Entity Parsing ──────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseEntity(entity: any): ParsedEntity | null {
  const layer = entity.layer || "0";

  switch (entity.type) {
    case "LINE":
      if (!entity.vertices || entity.vertices.length < 2) return null;
      return {
        type: "LINE",
        layer,
        start: { x: entity.vertices[0].x, y: entity.vertices[0].y },
        end: { x: entity.vertices[1].x, y: entity.vertices[1].y },
      };

    case "LWPOLYLINE":
    case "POLYLINE": {
      const verts = entity.vertices;
      if (!verts || verts.length < 2) return null;
      return {
        type: entity.type as "LWPOLYLINE" | "POLYLINE",
        layer,
        vertices: verts.map((v: any) => ({ x: v.x, y: v.y })),
        closed: entity.shape === true || entity.closed === true,
        width: typeof entity.width === "number" ? entity.width : undefined,
      };
    }

    case "ARC":
      return {
        type: "ARC",
        layer,
        center: { x: entity.center?.x || 0, y: entity.center?.y || 0 },
        radius: entity.radius || 0,
        startAngle: entity.startAngle || 0,
        endAngle: entity.endAngle || 0,
      };

    case "CIRCLE":
      return {
        type: "CIRCLE",
        layer,
        center: { x: entity.center?.x || 0, y: entity.center?.y || 0 },
        radius: entity.radius || 0,
      };

    case "INSERT":
      return {
        type: "INSERT",
        layer,
        blockName: entity.name || "",
        position: { x: entity.position?.x || 0, y: entity.position?.y || 0 },
        scaleX: entity.xScale || 1,
        scaleY: entity.yScale || 1,
        rotation: entity.rotation || 0,
        attributes: extractAttributes(entity),
      };

    case "TEXT":
    case "MTEXT":
      return {
        type: entity.type as "TEXT" | "MTEXT",
        layer,
        position: {
          x: entity.position?.x || entity.startPoint?.x || 0,
          y: entity.position?.y || entity.startPoint?.y || 0,
        },
        text: entity.text || entity.string || "",
        height: entity.height || entity.nominalTextHeight || 0,
      };

    default:
      return null;
  }
}

function extractAttributes(entity: any): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (entity.attribs) {
    for (const [key, value] of Object.entries(entity.attribs)) {
      const v = value as any;
      attrs[key] = v?.text || v?.value || String(v);
    }
  }
  return attrs;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Geometry Utilities ──────────────────────────────────────────────────────

export function computeEntityBounds(entities: ParsedEntity[]): Bounds2D {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function expand(p: Point2D) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  for (const e of entities) {
    switch (e.type) {
      case "LINE":
        expand(e.start);
        expand(e.end);
        break;
      case "LWPOLYLINE":
      case "POLYLINE":
        for (const v of e.vertices) expand(v);
        break;
      case "ARC":
      case "CIRCLE":
        expand({ x: e.center.x - e.radius, y: e.center.y - e.radius });
        expand({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        break;
      case "INSERT":
      case "TEXT":
      case "MTEXT":
        expand(e.position);
        break;
    }
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

/** Get all entities on a specific layer */
export function getEntitiesByLayer(
  entities: ParsedEntity[],
  layerName: string,
): ParsedEntity[] {
  return entities.filter((e) => e.layer === layerName);
}

/** Get all entities matching a layer classification */
export function getEntitiesByClassification(
  entities: ParsedEntity[],
  layers: LayerInfo[],
  classification: LayerClassification,
): ParsedEntity[] {
  const layerNames = new Set(
    layers.filter((l) => l.classification === classification).map((l) => l.name),
  );
  return entities.filter((e) => layerNames.has(e.layer));
}

/** Get only LINE and POLYLINE entities (for wall detection) */
export function getLinearEntities(
  entities: ParsedEntity[],
): (ParsedLine | ParsedPolyline)[] {
  return entities.filter(
    (e): e is ParsedLine | ParsedPolyline =>
      e.type === "LINE" || e.type === "LWPOLYLINE" || e.type === "POLYLINE",
  );
}

/** Get only INSERT entities (for opening detection) */
export function getInsertEntities(entities: ParsedEntity[]): ParsedInsert[] {
  return entities.filter((e): e is ParsedInsert => e.type === "INSERT");
}

/** Get only TEXT/MTEXT entities (for room labels) */
export function getTextEntities(entities: ParsedEntity[]): ParsedText[] {
  return entities.filter(
    (e): e is ParsedText => e.type === "TEXT" || e.type === "MTEXT",
  );
}

/** Get only ARC entities (for door swing detection) */
export function getArcEntities(entities: ParsedEntity[]): ParsedArc[] {
  return entities.filter((e): e is ParsedArc => e.type === "ARC");
}

/** Distance between two points */
export function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Line length */
export function lineLength(start: Point2D, end: Point2D): number {
  return distance(start, end);
}

/** Angle of a line segment in radians */
export function lineAngle(start: Point2D, end: Point2D): number {
  return Math.atan2(end.y - start.y, end.x - start.x);
}

/** Normalize an angle to [0, PI) — treats opposite directions as the same */
export function normalizeAngle(angle: number): number {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a;
}

/** Point along a line at parameter t (0 = start, 1 = end) */
export function pointOnLine(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };
}

/** Perpendicular distance from a point to an infinite line defined by two points */
export function perpendicularDistance(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return distance(point, lineStart);
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

/** Midpoint of a line segment */
export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ─── Block Flattening (INSERT Explosion) ─────────────────────────────────────

/**
 * Recursively resolve INSERT entities into world-space geometry.
 *
 * Many AutoCAD drawings store all geometry inside blocks, with the model space
 * containing only INSERT references. This function "explodes" those references
 * by copying each block's entities, applying the INSERT's position, scale,
 * and rotation transforms, and recursing into nested INSERTs.
 *
 * @param entities - Entities from model space (may contain INSERT references)
 * @param blockMap - Map of block name → entities within that block
 * @param maxDepth - Maximum recursion depth to prevent infinite loops
 * @returns All entities flattened to world space
 */
export function flattenInserts(
  entities: ParsedEntity[],
  blockMap: Map<string, ParsedEntity[]>,
  maxDepth: number = 10,
): ParsedEntity[] {
  const result: ParsedEntity[] = [];

  /** Block names that should be preserved as INSERTs (room markers, labels) */
  const PRESERVE_INSERT_PATTERNS = [
    /room/i, /name/i, /tag/i, /label/i, /IMMASA/i, /space/i,
  ];

  for (const entity of entities) {
    if (entity.type === "INSERT" && maxDepth > 0) {
      const blockEntities = blockMap.get(entity.blockName);

      // Preserve room-name/label INSERTs alongside their flattened content
      // so downstream room detection can use their positions
      const isMarkerBlock = PRESERVE_INSERT_PATTERNS.some((p) =>
        p.test(entity.blockName),
      );
      if (isMarkerBlock) {
        result.push(entity); // keep the INSERT for room detection
      }

      if (!blockEntities || blockEntities.length === 0) {
        if (!isMarkerBlock) result.push(entity);
        continue;
      }

      // Transform each entity in the block to world space
      const transformed = blockEntities.map((blockEntity) =>
        transformEntity(blockEntity, entity.position, entity.scaleX, entity.scaleY, entity.rotation),
      ).filter((e): e is ParsedEntity => e !== null);

      // Recursively flatten any INSERTs within this block
      const flattened = flattenInserts(transformed, blockMap, maxDepth - 1);
      result.push(...flattened);
    } else {
      result.push(entity);
    }
  }

  return result;
}

/**
 * Transform an entity by applying position offset, scale, and rotation.
 * Used when "exploding" a block INSERT.
 */
function transformEntity(
  entity: ParsedEntity,
  offset: Point2D,
  scaleX: number,
  scaleY: number,
  rotationDeg: number,
): ParsedEntity | null {
  const rad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  function xform(p: Point2D): Point2D {
    // Scale, rotate, then translate
    const sx = p.x * scaleX;
    const sy = p.y * scaleY;
    return {
      x: sx * cosR - sy * sinR + offset.x,
      y: sx * sinR + sy * cosR + offset.y,
    };
  }

  switch (entity.type) {
    case "LINE":
      return {
        ...entity,
        start: xform(entity.start),
        end: xform(entity.end),
      };

    case "LWPOLYLINE":
    case "POLYLINE":
      return {
        ...entity,
        vertices: entity.vertices.map(xform),
      };

    case "ARC":
      return {
        ...entity,
        center: xform(entity.center),
        radius: entity.radius * Math.abs(scaleX),
        startAngle: entity.startAngle + rotationDeg,
        endAngle: entity.endAngle + rotationDeg,
      };

    case "CIRCLE":
      return {
        ...entity,
        center: xform(entity.center),
        radius: entity.radius * Math.abs(scaleX),
      };

    case "INSERT":
      return {
        ...entity,
        position: xform(entity.position),
        scaleX: entity.scaleX * scaleX,
        scaleY: entity.scaleY * scaleY,
        rotation: entity.rotation + rotationDeg,
      };

    case "TEXT":
    case "MTEXT":
      return {
        ...entity,
        position: xform(entity.position),
        height: entity.height * Math.abs(scaleY),
      };

    default:
      return null;
  }
}

// ─── Coordinate Normalization ────────────────────────────────────────────────

/**
 * Detect and extract the building zone from a DXF parse result.
 *
 * Many AutoCAD files use real-world survey coordinates (UTM/geographic),
 * placing the building at coordinates like (1,140,000, 9,090,000).
 * This function identifies the building's bounding box by looking at
 * architectural layers (walls, doors, furniture) and returns an offset
 * to normalize coordinates to local building space (origin at 0,0).
 */
export function detectBuildingZone(
  result: DxfParseResult,
): { offset: Point2D; buildingBounds: Bounds2D } | null {
  // Use ALL architectural layers (wall + door + window + furniture) to find the building
  // Using only wall layers is too sparse — doors and furniture provide better density
  const archLayers = new Set(
    result.layers
      .filter((l) =>
        l.classification === "wall" ||
        l.classification === "door" ||
        l.classification === "window" ||
        l.classification === "furniture",
      )
      .map((l) => l.name),
  );
  const anchorEntities = result.entities.filter((e) => archLayers.has(e.layer));

  if (anchorEntities.length === 0) return null;

  const archBounds = computeEntityBounds(anchorEntities);

  // Sanity check: if the bounds are implausibly large (>60m in any dimension
  // for a single building), there are likely paper-space/title-block entities mixed in.
  // Re-cluster using only the densest area.
  const bw = archBounds.maxX - archBounds.minX;
  const bh = archBounds.maxY - archBounds.minY;
  if (bw > 60000 || bh > 60000) {
    // Use spatial clustering: find the densest 30m × 30m cell
    const cellSize = 30000; // 30m cells
    const cells = new Map<string, { count: number; minX: number; minY: number; maxX: number; maxY: number }>();

    for (const e of anchorEntities) {
      let px = 0, py = 0;
      if ("start" in e) { px = (e as any).start.x; py = (e as any).start.y; }
      else if ("center" in e) { px = (e as any).center.x; py = (e as any).center.y; }
      else if ("position" in e) { px = (e as any).position.x; py = (e as any).position.y; }
      else if ("vertices" in e && (e as any).vertices.length > 0) { px = (e as any).vertices[0].x; py = (e as any).vertices[0].y; }

      const cellKey = `${Math.floor(px / cellSize)},${Math.floor(py / cellSize)}`;
      const cell = cells.get(cellKey);
      if (cell) {
        cell.count++;
        if (px < cell.minX) cell.minX = px;
        if (py < cell.minY) cell.minY = py;
        if (px > cell.maxX) cell.maxX = px;
        if (py > cell.maxY) cell.maxY = py;
      } else {
        cells.set(cellKey, { count: 1, minX: px, minY: py, maxX: px, maxY: py });
      }
    }

    // Find the cluster with the most total entities (sum of cell + adjacent cells)
    let bestClusterKey = "";
    let bestClusterCount = 0;

    for (const [key, cell] of cells) {
      const [cx, cy] = key.split(",").map(Number);
      let clusterCount = 0;
      for (const [adjKey, adjCell] of cells) {
        const [ax, ay] = adjKey.split(",").map(Number);
        if (Math.abs(ax - cx) <= 1 && Math.abs(ay - cy) <= 1) {
          clusterCount += adjCell.count;
        }
      }
      if (clusterCount > bestClusterCount) {
        bestClusterCount = clusterCount;
        bestClusterKey = key;
      }
    }

    if (bestClusterKey) {
      const [bcx, bcy] = bestClusterKey.split(",").map(Number);

      // Expand to include adjacent cells
      let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
      for (const [key, cell] of cells) {
        const [cx, cy] = key.split(",").map(Number);
        if (Math.abs(cx - bcx) <= 1 && Math.abs(cy - bcy) <= 1) {
          if (cell.minX < cMinX) cMinX = cell.minX;
          if (cell.minY < cMinY) cMinY = cell.minY;
          if (cell.maxX > cMaxX) cMaxX = cell.maxX;
          if (cell.maxY > cMaxY) cMaxY = cell.maxY;
        }
      }

      return {
        offset: { x: cMinX, y: cMinY },
        buildingBounds: { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY },
      };
    }
  }

  const needsNormalization =
    Math.abs(archBounds.minX) > 100000 ||
    Math.abs(archBounds.minY) > 100000;

  if (!needsNormalization) return null;

  return {
    offset: { x: archBounds.minX, y: archBounds.minY },
    buildingBounds: archBounds,
  };
}

/**
 * Normalize all entity coordinates by subtracting an offset.
 * Also filters entities to only those within the building zone (with padding).
 */
export function normalizeEntities(
  entities: ParsedEntity[],
  offset: Point2D,
  buildingBounds: Bounds2D,
  padding: number = 5000,
): ParsedEntity[] {
  const zone = {
    minX: buildingBounds.minX - padding,
    minY: buildingBounds.minY - padding,
    maxX: buildingBounds.maxX + padding,
    maxY: buildingBounds.maxY + padding,
  };

  const result: ParsedEntity[] = [];

  for (const entity of entities) {
    if (!isEntityInZone(entity, zone)) continue;
    const shifted = offsetEntity(entity, offset);
    if (shifted) result.push(shifted);
  }

  return result;
}

function isEntityInZone(entity: ParsedEntity, zone: Bounds2D): boolean {
  let px = 0, py = 0;
  switch (entity.type) {
    case "LINE":
      px = (entity.start.x + entity.end.x) / 2;
      py = (entity.start.y + entity.end.y) / 2;
      break;
    case "LWPOLYLINE":
    case "POLYLINE":
      if (entity.vertices.length === 0) return false;
      px = entity.vertices[0].x;
      py = entity.vertices[0].y;
      break;
    case "ARC":
    case "CIRCLE":
      px = entity.center.x;
      py = entity.center.y;
      break;
    case "INSERT":
    case "TEXT":
    case "MTEXT":
      px = entity.position.x;
      py = entity.position.y;
      break;
  }
  return px >= zone.minX && px <= zone.maxX && py >= zone.minY && py <= zone.maxY;
}

function offsetEntity(entity: ParsedEntity, offset: Point2D): ParsedEntity | null {
  function shift(p: Point2D): Point2D {
    return { x: p.x - offset.x, y: p.y - offset.y };
  }

  switch (entity.type) {
    case "LINE":
      return { ...entity, start: shift(entity.start), end: shift(entity.end) };
    case "LWPOLYLINE":
    case "POLYLINE":
      return { ...entity, vertices: entity.vertices.map(shift) };
    case "ARC":
      return { ...entity, center: shift(entity.center) };
    case "CIRCLE":
      return { ...entity, center: shift(entity.center) };
    case "INSERT":
      return { ...entity, position: shift(entity.position) };
    case "TEXT":
    case "MTEXT":
      return { ...entity, position: shift(entity.position) };
    default:
      return null;
  }
}
