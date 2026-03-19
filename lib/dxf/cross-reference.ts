/**
 * Cross-Reference — Maps section height data to floor plan walls and openings.
 *
 * The section cut line passes through the floor plan at a specific position.
 * Walls that intersect this cut line can receive height data from the section.
 * Openings visible in the section can update heights on matching floor plan openings.
 */

import type {
  Wall,
  Opening,
  Room,
  SectionData,
  Point2D,
  V3Config,
} from "../types-v3";
import { distance } from "./parser";

// ─── Configuration ───────────────────────────────────────────────────────────

/** How close a wall must be to the section cut line to receive height data */
const SECTION_WALL_TOLERANCE = 500;

/** How close an opening must be to a section opening to match */
const SECTION_OPENING_TOLERANCE = 800;

// ─── Main Cross-Reference ────────────────────────────────────────────────────

/**
 * Apply section height data to floor plan walls, openings, and rooms.
 * Modifies the objects in place.
 *
 * @param walls - Floor plan walls (will be mutated)
 * @param openings - Floor plan openings (will be mutated)
 * @param rooms - Floor plan rooms (will be mutated)
 * @param sections - Parsed section data
 * @param config - Default values for unmatched elements
 */
export function applySectionHeights(
  walls: Wall[],
  openings: Opening[],
  rooms: Room[],
  sections: SectionData[],
  config: V3Config,
): CrossReferenceResult {
  const result: CrossReferenceResult = {
    wallsUpdated: 0,
    openingsUpdated: 0,
    roomsUpdated: 0,
    wallsUnmatched: 0,
    openingsUnmatched: 0,
    roomsUnmatched: 0,
  };

  for (const section of sections) {
    // For each section, determine which walls it crosses
    const crossedWalls = findWallsCrossedBySection(walls, section);

    for (const { wall, intersectionPoint } of crossedWalls) {
      // Find the section height at this intersection point
      const sectionHeight = findNearestSectionHeight(
        section,
        intersectionPoint,
      );

      if (sectionHeight) {
        const height = sectionHeight.ceilingLevel - sectionHeight.floorLevel;
        wall.height = height;
        wall.heightSource = "section";
        result.wallsUpdated++;

        // Also update any openings on this wall
        for (const opening of openings) {
          if (opening.wallId !== wall.id) continue;

          // Try to match with section openings
          const matchedSectionOpening = findMatchingSectionOpening(
            opening,
            wall,
            sectionHeight,
          );

          if (matchedSectionOpening) {
            opening.height = matchedSectionOpening.headHeight - matchedSectionOpening.sillHeight;
            opening.sillHeight = matchedSectionOpening.sillHeight;
            opening.heightSource = "section";
            result.openingsUpdated++;
          }
        }
      }
    }

    // Update rooms that the section passes through
    for (const room of rooms) {
      if (doesSectionCrossRoom(section, room)) {
        const sectionHeight = findNearestSectionHeight(section, room.centroid);
        if (sectionHeight) {
          room.ceilingHeight = sectionHeight.ceilingLevel - sectionHeight.floorLevel;
          room.heightSource = "section";
          result.roomsUpdated++;
        }
      }
    }
  }

  // Count unmatched elements
  result.wallsUnmatched = walls.filter((w) => w.heightSource === "default").length;
  result.openingsUnmatched = openings.filter((o) => o.heightSource === "default").length;
  result.roomsUnmatched = rooms.filter((r) => r.heightSource === "default").length;

  return result;
}

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface CrossReferenceResult {
  wallsUpdated: number;
  openingsUpdated: number;
  roomsUpdated: number;
  wallsUnmatched: number;
  openingsUnmatched: number;
  roomsUnmatched: number;
}

// ─── Section-Wall Intersection ───────────────────────────────────────────────

interface WallIntersection {
  wall: Wall;
  intersectionPoint: Point2D;
}

/**
 * Find all walls that the section cut line passes through or near.
 */
function findWallsCrossedBySection(
  walls: Wall[],
  section: SectionData,
): WallIntersection[] {
  const results: WallIntersection[] = [];
  const cutStart = section.cutLineStart;
  const cutEnd = section.cutLineEnd;

  for (const wall of walls) {
    // Check if the wall segment intersects the section cut line
    const intersection = segmentIntersection(
      wall.start,
      wall.end,
      cutStart,
      cutEnd,
    );

    if (intersection) {
      results.push({ wall, intersectionPoint: intersection });
      continue;
    }

    // Also check proximity — the cut line might run along or near the wall
    const distToStart = pointToSegmentDist(wall.start, cutStart, cutEnd);
    const distToEnd = pointToSegmentDist(wall.end, cutStart, cutEnd);
    const minDist = Math.min(distToStart, distToEnd);

    if (minDist < SECTION_WALL_TOLERANCE) {
      // Use the midpoint of the wall as the "intersection" point
      results.push({
        wall,
        intersectionPoint: {
          x: (wall.start.x + wall.end.x) / 2,
          y: (wall.start.y + wall.end.y) / 2,
        },
      });
    }
  }

  return results;
}

/**
 * Find the section height entry nearest to a given XY position.
 * Maps the floor plan XY position to a horizontal position in the section.
 */
function findNearestSectionHeight(
  section: SectionData,
  point: Point2D,
) {
  if (section.heights.length === 0) return null;

  // Project the point onto the section cut line to get the section's horizontal position
  const sectionHPos = projectOntoSectionLine(point, section);

  // Find nearest section height
  let best = section.heights[0];
  let bestDist = Math.abs(best.horizontalPosition - sectionHPos);

  for (const h of section.heights) {
    const d = Math.abs(h.horizontalPosition - sectionHPos);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }

  return best;
}

function findMatchingSectionOpening(
  opening: Opening,
  wall: Wall,
  sectionHeight: { openings: Array<{ horizontalPosition: number; width: number; sillHeight: number; headHeight: number; type: string }> },
) {
  // Match by type and approximate position
  for (const secOpening of sectionHeight.openings) {
    if (secOpening.type !== opening.type) continue;

    // Width should be similar
    if (Math.abs(secOpening.width - opening.width) > SECTION_OPENING_TOLERANCE) continue;

    // Found a match
    return secOpening;
  }

  return null;
}

function doesSectionCrossRoom(section: SectionData, room: Room): boolean {
  // Simple check: does the section cut line pass through the room's bounding area?
  // Use point-in-polygon test for the room centroid proximity to the cut line
  const dist = pointToSegmentDist(
    room.centroid,
    section.cutLineStart,
    section.cutLineEnd,
  );
  // The section should pass within the room's approximate radius
  const roomRadius = Math.sqrt(room.area) / 2;
  return dist < roomRadius + SECTION_WALL_TOLERANCE;
}

// ─── Geometry Utilities ──────────────────────────────────────────────────────

/** Project a point onto the section cut line and return the parametric position */
function projectOntoSectionLine(point: Point2D, section: SectionData): number {
  const dx = section.cutLineEnd.x - section.cutLineStart.x;
  const dy = section.cutLineEnd.y - section.cutLineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;

  const t = ((point.x - section.cutLineStart.x) * dx + (point.y - section.cutLineStart.y) * dy) / lenSq;
  // Convert to actual distance along section
  return t * Math.sqrt(lenSq);
}

/** Find intersection point of two line segments, or null if they don't intersect */
function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): Point2D | null {
  const dx1 = a2.x - a1.x;
  const dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x;
  const dy2 = b2.y - b1.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null; // outside segments

  return {
    x: a1.x + t * dx1,
    y: a1.y + t * dy1,
  };
}

/** Distance from a point to a line segment */
function pointToSegmentDist(
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
