// ─── V3: DXF → 3D Model Types ───────────────────────────────────────────────

/** 2D point in drawing units (typically mm) */
export interface Point2D {
  x: number;
  y: number;
}

/** 3D point in drawing units */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/** Bounding box in 2D */
export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ─── DXF Layer Classification ────────────────────────────────────────────────

export type LayerClassification =
  | "wall"
  | "door"
  | "window"
  | "dimension"
  | "furniture"
  | "annotation"
  | "hatch"
  | "other";

export interface LayerInfo {
  name: string;
  classification: LayerClassification;
  entityCount: number;
  color: number;
  visible: boolean;
  frozen: boolean;
}

// ─── Wall Types ──────────────────────────────────────────────────────────────

export type WallDrawingStyle = "single-line" | "double-line" | "polyline";

export interface Wall {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;       // from section data or default
  heightSource: "section" | "default";
  layer: string;
  style: WallDrawingStyle;
}

// ─── Opening Types ───────────────────────────────────────────────────────────

export type OpeningType = "door" | "window";

export interface Opening {
  id: string;
  type: OpeningType;
  wallId: string;       // which wall this opening belongs to
  position: number;     // distance along wall from start point
  width: number;
  height: number;
  sillHeight: number;   // distance from floor to bottom of opening
  heightSource: "section" | "default";
  layer: string;
  blockName?: string;   // original AutoCAD block name if available
}

// ─── Room Types ──────────────────────────────────────────────────────────────

export type RoomType = "interior" | "exterior" | "service";

export interface Room {
  id: string;
  label: string;        // from DXF text annotations (e.g. "LIVING", "BEDROOM 1")
  roomType: RoomType;   // interior (walls+roof), exterior (open air), service (parking etc.)
  boundary: Point2D[];  // closed polygon defining room perimeter
  area: number;         // in square drawing units
  ceilingHeight: number;
  heightSource: "section" | "default";
  centroid: Point2D;
}

// ─── Section Types ───────────────────────────────────────────────────────────

export interface SectionHeight {
  /** Horizontal position along the section cut (maps to a position in the floor plan) */
  horizontalPosition: number;
  /** Floor level (typically 0) */
  floorLevel: number;
  /** Ceiling level */
  ceilingLevel: number;
  /** Any openings visible in this section cut */
  openings: SectionOpening[];
}

export interface SectionOpening {
  horizontalPosition: number;
  width: number;
  sillHeight: number;
  headHeight: number;
  type: OpeningType;
}

export interface SectionData {
  /** The section cut line position and direction in the floor plan */
  cutLineStart: Point2D;
  cutLineEnd: Point2D;
  /** Extracted heights along this section */
  heights: SectionHeight[];
  /** Roof profile extracted from this section */
  roofProfile: RoofProfilePoint[];
}

// ─── Roof Types ──────────────────────────────────────────────────────────────

/** A point on the roof profile as seen in a section drawing */
export interface RoofProfilePoint {
  /** Horizontal position along the section cut */
  x: number;
  /** Elevation (height) of the roof at this point */
  y: number;
}

/** A roof ridge line as seen in the roof plan (plan view XY position) */
export interface RoofRidgeLine {
  start: Point2D;
  end: Point2D;
  /** Elevation of the ridge (from section cross-reference) */
  elevation: number;
  elevationSource: "section" | "default";
}

/** A roof eave edge as seen in the roof plan */
export interface RoofEaveEdge {
  start: Point2D;
  end: Point2D;
  /** Elevation at the eave (typically wall top / fascia height) */
  elevation: number;
  elevationSource: "section" | "default";
}

/** A hip or valley line connecting ridge to eave */
export interface RoofHipLine {
  start: Point2D;   // typically at ridge
  end: Point2D;     // typically at eave corner
  type: "hip" | "valley";
}

/** Complete roof plan data parsed from a roof plan drawing */
export interface RoofPlanData {
  /** Outer eave boundary (closed polygon — the roof overhang outline) */
  eaveOutline: Point2D[];
  /** Individual eave edges (for different roof sections at different heights) */
  eaveEdges: RoofEaveEdge[];
  /** Ridge lines (peaks of the roof in plan view) */
  ridgeLines: RoofRidgeLine[];
  /** Hip and valley lines */
  hipLines: RoofHipLine[];
}

/** A triangulated roof face — the final 3D representation */
export interface RoofFace {
  id: string;
  /** 3D vertices of this roof face (triangle or quad) */
  vertices: Point3D[];
  /** Which ridge/hip/eave this face belongs to — for grouping */
  group: string;
}

/** A 3D roof segment derived from one or more section profiles */
export interface RoofSegment {
  id: string;
  /** The roof profile polyline in 3D — ridge lines, eave lines, slopes */
  profilePoints: Point3D[];
  /** Direction the profile is extruded along (perpendicular to section cut) */
  extrudeDirection: Point2D;
  /** How far to extrude in each direction from the section cut line */
  extrudeDistance: number;
  /** Source section(s) this was derived from */
  sectionIds: string[];
}

/** Column/post detected in section or plan — vertical structural elements */
export interface Column {
  id: string;
  position: Point2D;
  width: number;
  depth: number;
  height: number;
  layer: string;
}

// ─── Floor Plan (Complete Parsed Result) ─────────────────────────────────────

export interface FloorPlan {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  bounds: Bounds2D;
  units: DrawingUnits;
  layers: LayerInfo[];
  sections: SectionData[];
  roofSegments: RoofSegment[];
  roofFaces: RoofFace[];
  roofPlan: RoofPlanData | null;
  columns: Column[];
}

export type DrawingUnits = "mm" | "cm" | "m" | "in" | "ft";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface V3Config {
  units: DrawingUnits;
  defaultCeilingHeight: number;   // in drawing units
  defaultWallThickness: number;   // in drawing units (for single-line walls)
  defaultSillHeight: number;      // in drawing units
  defaultDoorHeadHeight: number;  // in drawing units
  defaultWindowHeadHeight: number;
}

export const DEFAULT_V3_CONFIG: V3Config = {
  units: "mm",
  defaultCeilingHeight: 2700,
  defaultWallThickness: 200,
  defaultSillHeight: 900,
  defaultDoorHeadHeight: 2100,
  defaultWindowHeadHeight: 2100,
};

// ─── Drawing File ────────────────────────────────────────────────────────────

export type DrawingType = "floor-plan" | "section" | "elevation" | "roof-plan" | "unknown";

export interface DrawingFile {
  id: string;
  fileName: string;
  type: DrawingType;
  /** Raw DXF content (after DWG→DXF conversion if needed) */
  dxfContent: string;
}

// ─── Camera Presets ──────────────────────────────────────────────────────────

export interface CameraPreset {
  name: string;
  label: string;
  position: Point3D;
  target: Point3D;
  fov: number;
}

// ─── V3 App State Extension ─────────────────────────────────────────────────

export type V3Step =
  | "v3-upload"         // upload DWG/DXF files
  | "v3-classify"       // classify drawings as floor plan / section
  | "v3-layers"         // confirm layer classification
  | "v3-config"         // set heights, thickness, units
  | "v3-preview-2d"     // 2D overlay verification (Gate 1)
  | "v3-model"          // 3D model viewer (Gate 2)
  | "v3-capture"        // capture views (Gate 3)
  | "v3-done";          // captured, hand off to existing pipeline

export interface V3State {
  active: boolean;
  step: V3Step;
  drawingFiles: DrawingFile[];
  config: V3Config;
  floorPlan: FloorPlan | null;
  capturedViews: CapturedView[];
  selectedViewIndex: number;
}

export interface CapturedView {
  id: string;
  label: string;
  base64: string;
  mimeType: string;
  presetName: string;
}

export const EMPTY_V3_STATE: V3State = {
  active: false,
  step: "v3-upload",
  drawingFiles: [],
  config: DEFAULT_V3_CONFIG,
  floorPlan: null,
  capturedViews: [],
  selectedViewIndex: -1,
};
