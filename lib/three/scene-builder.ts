/**
 * Three.js Scene Builder — Constructs a 3D scene from parsed floor plan data.
 *
 * Creates:
 * - Extruded walls with correct thickness and height
 * - Openings (doors/windows) cut from walls using CSG subtraction
 * - Floor slab and ceiling plane
 * - Roof geometry from section profiles
 * - Columns/posts
 * - Clean white/grey clay-model aesthetic
 */

import * as THREE from "three";
import type { FloorPlan, Wall, Opening, Room, RoofSegment, RoofFace, Column, Point2D, CameraPreset } from "../types-v3";

// ─── Materials ───────────────────────────────────────────────────────────────

/** Clay model materials — neutral colors for AI pipeline input */
const WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xe8e0d8,    // warm light grey
  roughness: 0.9,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const FLOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd4cec6,    // slightly darker warm grey
  roughness: 0.95,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const CEILING_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xf0ece8,    // lightest warm grey
  roughness: 0.9,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const ROOF_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xb8a898,    // warm terracotta/brown tone
  roughness: 0.85,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const COLUMN_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd0c8c0,    // light warm stone
  roughness: 0.8,
  metalness: 0.0,
});

const GLASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xc8dce8,    // light blue tint
  roughness: 0.1,
  metalness: 0.1,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
});

// ─── Scene Construction ──────────────────────────────────────────────────────

/**
 * Build a complete Three.js scene from a parsed floor plan.
 * Returns the scene, plus metadata for camera positioning.
 */
export function buildScene(floorPlan: FloorPlan): SceneResult {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f0);

  // Add lighting
  addLighting(scene);

  // Build walls with openings
  const wallGroup = new THREE.Group();
  wallGroup.name = "walls";

  for (const wall of floorPlan.walls) {
    const wallMesh = createWallMesh(wall, floorPlan.openings);
    wallGroup.add(wallMesh);
  }
  scene.add(wallGroup);

  // Build floor slabs
  const floorGroup = new THREE.Group();
  floorGroup.name = "floors";

  if (floorPlan.rooms.length > 0) {
    for (const room of floorPlan.rooms) {
      const floorMesh = createFloorMesh(room);
      if (floorMesh) floorGroup.add(floorMesh);
    }
  } else {
    // No rooms detected — create a single floor slab from bounds
    const floorMesh = createBoundsFloor(floorPlan);
    if (floorMesh) floorGroup.add(floorMesh);
  }
  scene.add(floorGroup);

  // Build ceilings
  const ceilingGroup = new THREE.Group();
  ceilingGroup.name = "ceilings";

  if (floorPlan.rooms.length > 0) {
    for (const room of floorPlan.rooms) {
      // Skip ceilings for exterior rooms (pool deck, garden, terrace, etc.)
      if (room.roomType === "exterior") continue;
      const ceilingMesh = createCeilingMesh(room);
      if (ceilingMesh) ceilingGroup.add(ceilingMesh);
    }
  }
  scene.add(ceilingGroup);

  // Add glass panes for windows
  const glassGroup = new THREE.Group();
  glassGroup.name = "glass";

  for (const opening of floorPlan.openings) {
    if (opening.type === "window") {
      const wall = floorPlan.walls.find((w) => w.id === opening.wallId);
      if (wall) {
        const glassMesh = createGlassPane(opening, wall);
        if (glassMesh) glassGroup.add(glassMesh);
      }
    }
  }
  scene.add(glassGroup);

  // Build roof — prefer roof faces (from roof plan + sections) over extruded segments
  const roofGroup = new THREE.Group();
  roofGroup.name = "roof";

  if (floorPlan.roofFaces.length > 0) {
    // Roof plan + section combined: render triangulated faces
    for (const face of floorPlan.roofFaces) {
      const faceMesh = createRoofFaceMesh(face);
      if (faceMesh) roofGroup.add(faceMesh);
    }
  } else {
    // Fallback: section-only extruded roof profiles
    for (const segment of floorPlan.roofSegments) {
      const roofMesh = createRoofMesh(segment);
      if (roofMesh) roofGroup.add(roofMesh);
    }
  }
  scene.add(roofGroup);

  // Build columns
  const columnGroup = new THREE.Group();
  columnGroup.name = "columns";
  for (const column of floorPlan.columns) {
    const columnMesh = createColumnMesh(column);
    if (columnMesh) columnGroup.add(columnMesh);
  }
  scene.add(columnGroup);

  // Compute camera presets based on floor plan geometry
  const presets = computeCameraPresets(floorPlan);

  return { scene, presets, bounds: floorPlan.bounds };
}

export interface SceneResult {
  scene: THREE.Scene;
  presets: CameraPreset[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// ─── Wall Mesh Creation ──────────────────────────────────────────────────────

function createWallMesh(wall: Wall, openings: Opening[]): THREE.Group {
  const group = new THREE.Group();
  group.name = `wall-${wall.id}`;

  // Wall direction and perpendicular
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);

  if (wallLength < 1) return group;

  // Unit vectors
  const ux = dx / wallLength;
  const uy = dy / wallLength;
  // Perpendicular (for thickness)
  const px = -uy;
  const py = ux;
  const halfThick = wall.thickness / 2;

  // Get openings for this wall, sorted by position
  const wallOpenings = openings
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.position - b.position);

  if (wallOpenings.length === 0) {
    // Simple wall — no openings, just a box
    const geometry = createWallBoxGeometry(wallLength, wall.height, wall.thickness);
    const mesh = new THREE.Mesh(geometry, WALL_MATERIAL);

    // Position at wall center
    const cx = (wall.start.x + wall.end.x) / 2;
    const cy = (wall.start.y + wall.end.y) / 2;
    mesh.position.set(cx, wall.height / 2, cy);

    // Rotate to align with wall direction
    const angle = Math.atan2(dy, dx);
    mesh.rotation.y = -angle;

    group.add(mesh);
  } else {
    // Wall with openings — create solid segments between openings
    // and above/below openings

    // Segments: [0, opening1.start], [opening1.end, opening2.start], ...
    const segments: { start: number; end: number }[] = [];
    let pos = 0;

    for (const opening of wallOpenings) {
      const openingStart = opening.position - opening.width / 2;
      const openingEnd = opening.position + opening.width / 2;

      // Solid segment before opening
      if (openingStart > pos + 1) {
        segments.push({ start: pos, end: openingStart });
      }

      // Wall above opening (lintel)
      const lintelHeight = wall.height - (opening.sillHeight + opening.height);
      if (lintelHeight > 10) {
        const lintelGeom = createWallBoxGeometry(opening.width, lintelHeight, wall.thickness);
        const lintelMesh = new THREE.Mesh(lintelGeom, WALL_MATERIAL);

        const lintelCenterAlongWall = opening.position;
        const lx = wall.start.x + lintelCenterAlongWall * ux;
        const ly = wall.start.y + lintelCenterAlongWall * uy;
        const lintelY = opening.sillHeight + opening.height + lintelHeight / 2;

        lintelMesh.position.set(lx, lintelY, ly);
        lintelMesh.rotation.y = -Math.atan2(dy, dx);
        group.add(lintelMesh);
      }

      // Wall below window (sill wall)
      if (opening.sillHeight > 10) {
        const sillGeom = createWallBoxGeometry(opening.width, opening.sillHeight, wall.thickness);
        const sillMesh = new THREE.Mesh(sillGeom, WALL_MATERIAL);

        const sillCenterAlongWall = opening.position;
        const sx = wall.start.x + sillCenterAlongWall * ux;
        const sy = wall.start.y + sillCenterAlongWall * uy;

        sillMesh.position.set(sx, opening.sillHeight / 2, sy);
        sillMesh.rotation.y = -Math.atan2(dy, dx);
        group.add(sillMesh);
      }

      pos = openingEnd;
    }

    // Final solid segment after last opening
    if (wallLength - pos > 1) {
      segments.push({ start: pos, end: wallLength });
    }

    // Create solid wall segments
    const angle = Math.atan2(dy, dx);
    for (const seg of segments) {
      const segLength = seg.end - seg.start;
      const segGeom = createWallBoxGeometry(segLength, wall.height, wall.thickness);
      const segMesh = new THREE.Mesh(segGeom, WALL_MATERIAL);

      const segCenter = (seg.start + seg.end) / 2;
      const sx = wall.start.x + segCenter * ux;
      const sy = wall.start.y + segCenter * uy;

      segMesh.position.set(sx, wall.height / 2, sy);
      segMesh.rotation.y = -angle;
      group.add(segMesh);
    }
  }

  return group;
}

function createWallBoxGeometry(
  length: number,
  height: number,
  thickness: number,
): THREE.BoxGeometry {
  // In Three.js: X = along wall, Y = up, Z = thickness
  return new THREE.BoxGeometry(length, height, thickness);
}

// ─── Glass Pane for Windows ──────────────────────────────────────────────────

function createGlassPane(opening: Opening, wall: Wall): THREE.Mesh | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);
  if (wallLength < 1) return null;

  const ux = dx / wallLength;
  const uy = dy / wallLength;

  const geometry = new THREE.PlaneGeometry(opening.width, opening.height);
  const mesh = new THREE.Mesh(geometry, GLASS_MATERIAL);

  const cx = wall.start.x + opening.position * ux;
  const cy = wall.start.y + opening.position * uy;
  const centerY = opening.sillHeight + opening.height / 2;

  mesh.position.set(cx, centerY, cy);
  mesh.rotation.y = -Math.atan2(dy, dx);

  return mesh;
}

// ─── Floor and Ceiling Meshes ────────────────────────────────────────────────

function createFloorMesh(room: Room): THREE.Mesh | null {
  if (room.boundary.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(room.boundary[0].x, room.boundary[0].y);
  for (let i = 1; i < room.boundary.length; i++) {
    shape.lineTo(room.boundary[i].x, room.boundary[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, FLOOR_MATERIAL);

  // Rotate to lie flat (Shape is in XY, we need it in XZ)
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;

  return mesh;
}

function createCeilingMesh(room: Room): THREE.Mesh | null {
  if (room.boundary.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(room.boundary[0].x, room.boundary[0].y);
  for (let i = 1; i < room.boundary.length; i++) {
    shape.lineTo(room.boundary[i].x, room.boundary[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, CEILING_MATERIAL);

  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = room.ceilingHeight;

  return mesh;
}

function createBoundsFloor(floorPlan: FloorPlan): THREE.Mesh | null {
  const { minX, minY, maxX, maxY } = floorPlan.bounds;
  const width = maxX - minX;
  const depth = maxY - minY;

  if (width < 1 || depth < 1) return null;

  // Add some padding
  const padding = 500;
  const geometry = new THREE.PlaneGeometry(width + padding * 2, depth + padding * 2);
  const mesh = new THREE.Mesh(geometry, FLOOR_MATERIAL);

  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);

  return mesh;
}

// ─── Roof Mesh Creation ──────────────────────────────────────────────────────

/**
 * Create a roof mesh from a RoofSegment.
 *
 * The roof segment has a 2D profile (seen in section view) that we extrude
 * perpendicular to the section cut direction to create a 3D roof surface.
 * This creates the pitched/gabled roof shapes visible in the architectural sections.
 */
/**
 * Create a mesh from a RoofFace (triangulated face from roof plan + section data).
 * Supports triangles (3 vertices) and quads (4 vertices).
 */
function createRoofFaceMesh(face: RoofFace): THREE.Mesh | null {
  if (face.vertices.length < 3) return null;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const v of face.vertices) {
    vertices.push(v.x, v.y, v.z);
  }

  if (face.vertices.length === 3) {
    // Triangle
    indices.push(0, 1, 2);
  } else if (face.vertices.length === 4) {
    // Quad → two triangles
    indices.push(0, 1, 2);
    indices.push(0, 2, 3);
  } else {
    // Fan triangulation for polygons with more vertices
    for (let i = 1; i < face.vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, ROOF_MATERIAL);
}

function createRoofMesh(segment: RoofSegment): THREE.Mesh | null {
  if (segment.profilePoints.length < 2) return null;

  const points = segment.profilePoints;
  const dir = segment.extrudeDirection;
  const dist = segment.extrudeDistance;

  // Create geometry by building a ribbon — the profile extruded in both directions
  const vertices: number[] = [];
  const indices: number[] = [];

  // For each profile point, create two vertices: one offset in +dir, one in -dir
  for (const point of points) {
    // +direction side
    vertices.push(
      point.x + dir.x * dist,
      point.y,
      point.z + dir.y * dist,
    );
    // -direction side
    vertices.push(
      point.x - dir.x * dist,
      point.y,
      point.z - dir.y * dist,
    );
  }

  // Build triangle strip between the two edges
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;       // +dir current
    const b = i * 2 + 1;   // -dir current
    const c = (i + 1) * 2; // +dir next
    const d = (i + 1) * 2 + 1; // -dir next

    // Two triangles per quad
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  // Add a thin slab thickness to the roof (offset the entire surface down slightly)
  const roofThickness = 150; // 150mm roof slab
  const bottomVertexOffset = vertices.length / 3;

  for (const point of points) {
    vertices.push(
      point.x + dir.x * dist,
      point.y - roofThickness,
      point.z + dir.y * dist,
    );
    vertices.push(
      point.x - dir.x * dist,
      point.y - roofThickness,
      point.z - dir.y * dist,
    );
  }

  // Bottom face (reverse winding for correct normals)
  for (let i = 0; i < points.length - 1; i++) {
    const a = bottomVertexOffset + i * 2;
    const b = bottomVertexOffset + i * 2 + 1;
    const c = bottomVertexOffset + (i + 1) * 2;
    const d = bottomVertexOffset + (i + 1) * 2 + 1;

    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  // Side faces (connect top to bottom along the +dir and -dir edges)
  for (let i = 0; i < points.length - 1; i++) {
    // +dir side
    const topA = i * 2;
    const topC = (i + 1) * 2;
    const botA = bottomVertexOffset + i * 2;
    const botC = bottomVertexOffset + (i + 1) * 2;
    indices.push(topA, topC, botA);
    indices.push(botA, topC, botC);

    // -dir side
    const topB = i * 2 + 1;
    const topD = (i + 1) * 2 + 1;
    const botB = bottomVertexOffset + i * 2 + 1;
    const botD = bottomVertexOffset + (i + 1) * 2 + 1;
    indices.push(topB, botB, topD);
    indices.push(botB, botD, topD);
  }

  // End caps (first and last profile positions)
  // Start cap
  const s0 = 0, s1 = 1, sb0 = bottomVertexOffset, sb1 = bottomVertexOffset + 1;
  indices.push(s0, s1, sb0);
  indices.push(s1, sb1, sb0);

  // End cap
  const lastIdx = points.length - 1;
  const e0 = lastIdx * 2, e1 = lastIdx * 2 + 1;
  const eb0 = bottomVertexOffset + lastIdx * 2, eb1 = bottomVertexOffset + lastIdx * 2 + 1;
  indices.push(e0, eb0, e1);
  indices.push(e1, eb0, eb1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, ROOF_MATERIAL);
}

// ─── Column Mesh Creation ────────────────────────────────────────────────────

function createColumnMesh(column: Column): THREE.Mesh {
  // Columns are simple rectangular or circular prisms
  const isCircular = Math.abs(column.width - column.depth) < 10;

  let geometry: THREE.BufferGeometry;
  if (isCircular) {
    geometry = new THREE.CylinderGeometry(
      column.width / 2, // top radius
      column.width / 2, // bottom radius
      column.height,
      12, // segments
    );
  } else {
    geometry = new THREE.BoxGeometry(column.width, column.height, column.depth);
  }

  const mesh = new THREE.Mesh(geometry, COLUMN_MATERIAL);
  mesh.position.set(column.position.x, column.height / 2, column.position.y);

  return mesh;
}

// ─── Lighting ────────────────────────────────────────────────────────────────

function addLighting(scene: THREE.Scene): void {
  // Ambient for base illumination
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  // Directional light (sun-like)
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(10000, 15000, 10000);
  directional.castShadow = false; // keep simple for clay model
  scene.add(directional);

  // Fill light from opposite side
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-8000, 10000, -5000);
  scene.add(fill);

  // Hemisphere light for natural sky/ground ambient
  const hemi = new THREE.HemisphereLight(0xf0f0f0, 0xd0d0d0, 0.4);
  scene.add(hemi);
}

// ─── Camera Presets ──────────────────────────────────────────────────────────

function computeCameraPresets(floorPlan: FloorPlan): CameraPreset[] {
  const { minX, minY, maxX, maxY } = floorPlan.bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  const depth = maxY - minY;
  const maxDim = Math.max(width, depth);

  // Get a representative ceiling height
  const ceilingHeight = floorPlan.rooms.length > 0
    ? Math.max(...floorPlan.rooms.map((r) => r.ceilingHeight))
    : floorPlan.walls.length > 0
      ? Math.max(...floorPlan.walls.map((w) => w.height))
      : 2700;

  const presets: CameraPreset[] = [];

  // Bird's eye view
  presets.push({
    name: "birds-eye",
    label: "Bird's Eye View",
    position: { x: centerX, y: maxDim * 1.5, z: centerY },
    target: { x: centerX, y: 0, z: centerY },
    fov: 50,
  });

  // Exterior eye-level — looking at the building from outside
  presets.push({
    name: "exterior-front",
    label: "Exterior Front",
    position: { x: centerX, y: 1600, z: maxY + maxDim * 0.8 },
    target: { x: centerX, y: ceilingHeight / 2, z: centerY },
    fov: 35,
  });

  presets.push({
    name: "exterior-corner",
    label: "Exterior Corner",
    position: { x: maxX + maxDim * 0.5, y: 1600, z: maxY + maxDim * 0.5 },
    target: { x: centerX, y: ceilingHeight / 2, z: centerY },
    fov: 35,
  });

  // Per-room interior presets
  for (const room of floorPlan.rooms) {
    const roomCenter = room.centroid;

    // Find the longest wall bounding this room to look at
    const roomWalls = floorPlan.walls.filter((w) => {
      // Simple check: wall midpoint is within the room's rough area
      const mx = (w.start.x + w.end.x) / 2;
      const my = (w.start.y + w.end.y) / 2;
      return isPointNearRoom(mx, my, room, 1000);
    });

    let lookAtPoint = { x: roomCenter.x, y: ceilingHeight / 2, z: roomCenter.y };

    if (roomWalls.length > 0) {
      // Find longest wall and look at it
      const longestWall = roomWalls.reduce((a, b) => {
        const la = Math.sqrt((a.end.x - a.start.x) ** 2 + (a.end.y - a.start.y) ** 2);
        const lb = Math.sqrt((b.end.x - b.start.x) ** 2 + (b.end.y - b.start.y) ** 2);
        return la > lb ? a : b;
      });
      lookAtPoint = {
        x: (longestWall.start.x + longestWall.end.x) / 2,
        y: ceilingHeight / 2,
        z: (longestWall.start.y + longestWall.end.y) / 2,
      };
    }

    // Position camera at room center, offset away from the target wall
    const camToTarget = {
      x: lookAtPoint.x - roomCenter.x,
      z: lookAtPoint.z - roomCenter.y,
    };
    const dist = Math.sqrt(camToTarget.x ** 2 + camToTarget.z ** 2);
    const offset = dist > 100 ? 0.3 : 0; // slightly behind center

    presets.push({
      name: `room-${room.id}`,
      label: `Interior: ${room.label || "Room"}`,
      position: {
        x: roomCenter.x - camToTarget.x * offset,
        y: 1600, // eye level
        z: roomCenter.y - camToTarget.z * offset,
      },
      target: lookAtPoint,
      fov: 50,
    });
  }

  return presets;
}

function isPointNearRoom(x: number, y: number, room: Room, tolerance: number): boolean {
  // Simple bounding box check
  let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
  for (const p of room.boundary) {
    if (p.x < rMinX) rMinX = p.x;
    if (p.y < rMinY) rMinY = p.y;
    if (p.x > rMaxX) rMaxX = p.x;
    if (p.y > rMaxY) rMaxY = p.y;
  }
  return (
    x >= rMinX - tolerance &&
    x <= rMaxX + tolerance &&
    y >= rMinY - tolerance &&
    y <= rMaxY + tolerance
  );
}
