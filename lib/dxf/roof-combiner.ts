/**
 * Roof Combiner — Merges roof plan (XY) with section profiles (heights)
 * to produce accurate 3D roof faces.
 *
 * The roof plan gives us WHERE ridges, eaves, and hips are in plan view.
 * The sections give us HOW HIGH those features are.
 * Combined, we get the complete 3D roof surface.
 *
 * Algorithm:
 * 1. For each ridge line from the roof plan, find the section that crosses it
 *    and extract the ridge elevation.
 * 2. For each eave edge, the elevation is typically the wall top height
 *    (confirmed by sections where available).
 * 3. Build triangulated roof faces by connecting:
 *    - Ridge points (high) to eave corners (low) via hip lines
 *    - Adjacent eave edges to the ridge line they slope toward
 */

import { v4 as uuid } from "uuid";
import type {
  RoofPlanData,
  RoofFace,
  RoofSegment,
  SectionData,
  Point2D,
  Point3D,
  V3Config,
  Bounds2D,
} from "../types-v3";
import { distance } from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/** How close a section cut must be to a ridge to provide its elevation */
const SECTION_MATCH_TOLERANCE = 2000;

// ─── Main Combiner ──────────────────────────────────────────────────────────

/**
 * Combine roof plan data with section profiles to produce 3D roof faces
 * and updated roof segments.
 */
export function combineRoofData(
  roofPlan: RoofPlanData | null,
  sections: SectionData[],
  bounds: Bounds2D,
  config: V3Config,
): { roofFaces: RoofFace[]; roofSegments: RoofSegment[] } {
  // If no roof plan available, fall back to section-only extrusion
  if (!roofPlan || (roofPlan.ridgeLines.length === 0 && roofPlan.eaveOutline.length === 0)) {
    return {
      roofFaces: [],
      roofSegments: buildSectionOnlyRoof(sections, bounds),
    };
  }

  // Step 1: Assign elevations to ridge lines from sections
  assignRidgeElevations(roofPlan, sections, config);

  // Step 2: Assign elevations to eave edges from sections
  assignEaveElevations(roofPlan, sections, config);

  // Step 3: Build 3D roof faces from plan geometry + elevations
  const roofFaces = buildRoofFaces(roofPlan, config);

  return { roofFaces, roofSegments: [] };
}

// ─── Elevation Assignment ────────────────────────────────────────────────────

/**
 * Find the elevation of each ridge line by checking which sections cross it
 * and reading the roof peak height from the section profile.
 */
function assignRidgeElevations(
  roofPlan: RoofPlanData,
  sections: SectionData[],
  config: V3Config,
): void {
  for (const ridge of roofPlan.ridgeLines) {
    const ridgeMidX = (ridge.start.x + ridge.end.x) / 2;
    const ridgeMidY = (ridge.start.y + ridge.end.y) / 2;
    const ridgeMid: Point2D = { x: ridgeMidX, y: ridgeMidY };

    let bestElevation = 0;
    let foundSection = false;

    for (const section of sections) {
      // Check if this section's cut line passes near the ridge
      const distToSection = pointToSegmentDist(
        ridgeMid,
        section.cutLineStart,
        section.cutLineEnd,
      );

      if (distToSection > SECTION_MATCH_TOLERANCE) continue;

      // Find the highest point in this section's roof profile
      // (that's the ridge elevation)
      if (section.roofProfile.length > 0) {
        const maxRoofY = Math.max(...section.roofProfile.map((p) => p.y));
        if (maxRoofY > bestElevation) {
          bestElevation = maxRoofY;
          foundSection = true;
        }
      }

      // Also check section heights — the max ceiling is a lower bound
      for (const h of section.heights) {
        if (h.ceilingLevel > bestElevation && !foundSection) {
          bestElevation = h.ceilingLevel;
        }
      }
    }

    if (foundSection || bestElevation > 0) {
      ridge.elevation = bestElevation;
      ridge.elevationSource = "section";
    } else {
      // Default: ridge is 30% above the default ceiling height (typical pitch)
      ridge.elevation = config.defaultCeilingHeight * 1.3;
      ridge.elevationSource = "default";
    }
  }
}

/**
 * Assign elevations to eave edges. Eaves are typically at the wall top height,
 * which we can read from sections where they cross the eave.
 */
function assignEaveElevations(
  roofPlan: RoofPlanData,
  sections: SectionData[],
  config: V3Config,
): void {
  for (const eave of roofPlan.eaveEdges) {
    const eaveMid: Point2D = {
      x: (eave.start.x + eave.end.x) / 2,
      y: (eave.start.y + eave.end.y) / 2,
    };

    for (const section of sections) {
      const distToSection = pointToSegmentDist(
        eaveMid,
        section.cutLineStart,
        section.cutLineEnd,
      );

      if (distToSection > SECTION_MATCH_TOLERANCE) continue;

      // The eave elevation is typically the lowest point in the roof profile
      // or the highest ceiling level at the building edge
      if (section.roofProfile.length > 0) {
        const minRoofY = Math.min(...section.roofProfile.map((p) => p.y));
        if (minRoofY > 0) {
          eave.elevation = minRoofY;
          eave.elevationSource = "section";
          break;
        }
      }

      // Fallback: use the ceiling height from the nearest section height
      if (section.heights.length > 0) {
        const nearestHeight = section.heights.reduce((best, h) => {
          const d = Math.abs(h.horizontalPosition - eaveMid.x);
          const bestD = Math.abs(best.horizontalPosition - eaveMid.x);
          return d < bestD ? h : best;
        });
        eave.elevation = nearestHeight.ceilingLevel;
        eave.elevationSource = "section";
        break;
      }
    }

    // If still default, use config
    if (eave.elevationSource === "default") {
      eave.elevation = config.defaultCeilingHeight;
    }
  }
}

// ─── 3D Face Building ────────────────────────────────────────────────────────

/**
 * Build triangulated 3D roof faces from the roof plan with assigned elevations.
 *
 * For each pair of adjacent eave edges + the ridge they slope toward:
 * - Build a quad (or triangle) from the two eave corner points (low)
 *   to the nearest ridge point(s) (high)
 * - Connect via hip lines where available
 */
function buildRoofFaces(
  roofPlan: RoofPlanData,
  config: V3Config,
): RoofFace[] {
  const faces: RoofFace[] = [];

  if (roofPlan.ridgeLines.length === 0 || roofPlan.eaveOutline.length < 3) {
    return faces;
  }

  // For each eave edge, find the nearest ridge and build a roof face
  for (const eave of roofPlan.eaveEdges) {
    const nearestRidge = findNearestRidge(eave, roofPlan.ridgeLines);
    if (!nearestRidge) continue;

    // Project the eave edge endpoints onto the ridge line to find the corresponding ridge points
    const ridgeStart = projectPointOntoLine(
      eave.start,
      nearestRidge.start,
      nearestRidge.end,
    );
    const ridgeEnd = projectPointOntoLine(
      eave.end,
      nearestRidge.start,
      nearestRidge.end,
    );

    // Build a quad: eave.start → eave.end → ridgeEnd → ridgeStart
    const face: RoofFace = {
      id: uuid(),
      vertices: [
        { x: eave.start.x, y: eave.elevation, z: eave.start.y },
        { x: eave.end.x, y: eave.elevation, z: eave.end.y },
        { x: ridgeEnd.x, y: nearestRidge.elevation, z: ridgeEnd.y },
        { x: ridgeStart.x, y: nearestRidge.elevation, z: ridgeStart.y },
      ],
      group: `ridge-${nearestRidge.start.x.toFixed(0)}`,
    };
    faces.push(face);
  }

  // If we have hip lines, add triangular faces for the roof ends (gable ends)
  for (const hip of roofPlan.hipLines) {
    // A hip line connects a ridge point (high) to an eave corner (low)
    const nearestRidge = findNearestRidgeToPoint(hip.start, roofPlan.ridgeLines);
    const ridgeElevation = nearestRidge?.elevation || config.defaultCeilingHeight * 1.3;

    // Find the eave elevation at the hip end
    const nearestEave = findNearestEaveToPoint(hip.end, roofPlan.eaveEdges);
    const eaveElevation = nearestEave?.elevation || config.defaultCeilingHeight;

    // The hip face is a triangle from the hip start (ridge height)
    // to the eave corner and the adjacent eave points
    // For now, just create the hip line as a connecting element
    // (the quad faces above already cover the main roof slopes)

    // Find two eave edges that share the hip end point
    const adjacentEaves = roofPlan.eaveEdges.filter((e) =>
      distance(e.start, hip.end) < 300 || distance(e.end, hip.end) < 300,
    );

    if (adjacentEaves.length >= 2) {
      // Build a triangular hip face
      const eaveCorner = hip.end;
      const eave1Other = distance(adjacentEaves[0].start, eaveCorner) < 300
        ? adjacentEaves[0].end
        : adjacentEaves[0].start;
      const eave2Other = distance(adjacentEaves[1].start, eaveCorner) < 300
        ? adjacentEaves[1].end
        : adjacentEaves[1].start;

      faces.push({
        id: uuid(),
        vertices: [
          { x: eaveCorner.x, y: eaveElevation, z: eaveCorner.y },
          { x: hip.start.x, y: ridgeElevation, z: hip.start.y },
          { x: eave1Other.x, y: eaveElevation, z: eave1Other.y },
        ],
        group: "hip",
      });

      faces.push({
        id: uuid(),
        vertices: [
          { x: eaveCorner.x, y: eaveElevation, z: eaveCorner.y },
          { x: hip.start.x, y: ridgeElevation, z: hip.start.y },
          { x: eave2Other.x, y: eaveElevation, z: eave2Other.y },
        ],
        group: "hip",
      });
    }
  }

  // Add roof slab thickness by creating matching underside faces
  const undersideFaces: RoofFace[] = [];
  const ROOF_THICKNESS = 150;

  for (const face of faces) {
    undersideFaces.push({
      id: uuid(),
      vertices: face.vertices.map((v) => ({
        x: v.x,
        y: v.y - ROOF_THICKNESS,
        z: v.z,
      })).reverse(), // reverse winding for underside
      group: face.group + "-underside",
    });
  }

  return [...faces, ...undersideFaces];
}

// ─── Section-Only Fallback ───────────────────────────────────────────────────

/**
 * When no roof plan is available, build roof segments from section profiles only.
 * (This is the original approach — extrude section profiles perpendicular to cut.)
 */
function buildSectionOnlyRoof(
  sections: SectionData[],
  bounds: Bounds2D,
): RoofSegment[] {
  const segments: RoofSegment[] = [];
  const buildingWidth = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  for (const section of sections) {
    if (section.roofProfile.length < 2) continue;

    const cutDx = section.cutLineEnd.x - section.cutLineStart.x;
    const cutDy = section.cutLineEnd.y - section.cutLineStart.y;
    const cutLen = Math.sqrt(cutDx * cutDx + cutDy * cutDy);
    if (cutLen === 0) continue;

    const perpX = -cutDy / cutLen;
    const perpY = cutDx / cutLen;

    const profilePoints = section.roofProfile.map((p) => {
      const t = cutLen > 0 ? (p.x - section.cutLineStart.x) / cutLen : 0;
      return {
        x: section.cutLineStart.x + t * cutDx,
        y: p.y,
        z: section.cutLineStart.y + t * cutDy,
      };
    });

    segments.push({
      id: uuid(),
      profilePoints,
      extrudeDirection: { x: perpX, y: perpY },
      extrudeDistance: buildingWidth * 0.6,
      sectionIds: [],
    });
  }

  return segments;
}

// ─── Geometry Utilities ──────────────────────────────────────────────────────

function findNearestRidge(
  eave: { start: Point2D; end: Point2D },
  ridges: { start: Point2D; end: Point2D; elevation: number }[],
) {
  const eaveMid: Point2D = {
    x: (eave.start.x + eave.end.x) / 2,
    y: (eave.start.y + eave.end.y) / 2,
  };

  let best = null;
  let bestDist = Infinity;

  for (const ridge of ridges) {
    const dist = pointToSegmentDist(eaveMid, ridge.start, ridge.end);
    if (dist < bestDist) {
      bestDist = dist;
      best = ridge;
    }
  }

  return best;
}

function findNearestRidgeToPoint(
  point: Point2D,
  ridges: { start: Point2D; end: Point2D; elevation: number }[],
) {
  let best = null;
  let bestDist = Infinity;

  for (const ridge of ridges) {
    const dist = pointToSegmentDist(point, ridge.start, ridge.end);
    if (dist < bestDist) {
      bestDist = dist;
      best = ridge;
    }
  }

  return best;
}

function findNearestEaveToPoint(
  point: Point2D,
  eaves: { start: Point2D; end: Point2D; elevation: number }[],
) {
  let best = null;
  let bestDist = Infinity;

  for (const eave of eaves) {
    const d1 = distance(point, eave.start);
    const d2 = distance(point, eave.end);
    const d = Math.min(d1, d2);
    if (d < bestDist) {
      bestDist = d;
      best = eave;
    }
  }

  return best;
}

/** Project a point onto a line segment, returning the closest point on the line */
function projectPointOntoLine(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
): Point2D {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return lineStart;

  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };
}

function pointToSegmentDist(
  point: Point2D,
  segStart: Point2D,
  segEnd: Point2D,
): number {
  const proj = projectPointOntoLine(point, segStart, segEnd);
  return distance(point, proj);
}
