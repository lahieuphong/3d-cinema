import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roundedPolygon, withCreasedNormals } from './seatGeometry.ts';

/** Procedural building blocks for the interior fit-out. All sizes in metres. */

/**
 * A round tube swept along a polyline whose interior corners are filleted with the given radii
 * (one per interior corner). Frames are parallel-transported, so the tube never twists through the
 * bends. Both ends are capped. Indexed, smooth normals.
 */
export function createSweptTube(
  corners: Vector3[],
  radius: number,
  bendRadii: number[],
  radialSegments = 12,
  bendSegments = 6,
): BufferGeometry {
  const samples: Vector3[] = [corners[0].clone()];
  const last = corners.length - 1;
  for (let i = 1; i < last; i++) {
    const corner = corners[i];
    const incoming = corner.clone().sub(corners[i - 1]);
    const outgoing = corners[i + 1].clone().sub(corner);
    const lengthIn = incoming.length();
    const lengthOut = outgoing.length();
    incoming.normalize();
    outgoing.normalize();
    const turn = incoming.angleTo(outgoing);
    if (turn < 1e-4) {
      samples.push(corner.clone());
      continue;
    }
    // The first and last corners may use their whole outer segment; shared segments are split.
    const reach = Math.min(
      bendRadii[i - 1] * Math.tan(turn / 2),
      i === 1 ? lengthIn : lengthIn / 2,
      i === last - 1 ? lengthOut : lengthOut / 2,
    );
    const start = corner.clone().addScaledVector(incoming, -reach);
    const end = corner.clone().addScaledVector(outgoing, reach);
    for (let k = 0; k <= bendSegments; k++) {
      const s = k / bendSegments;
      samples.push(
        new Vector3()
          .addScaledVector(start, (1 - s) ** 2)
          .addScaledVector(corner, 2 * s * (1 - s))
          .addScaledVector(end, s ** 2),
      );
    }
  }
  samples.push(corners[last].clone());
  const path = samples.filter((p, k) => k === 0 || p.distanceTo(samples[k - 1]) > 1e-6);

  const tangents = path.map((_, k) => {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    return b.clone().sub(a).normalize();
  });
  const up = Math.abs(tangents[0].y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const normals = [new Vector3().crossVectors(tangents[0], up).normalize().cross(tangents[0]).normalize()];
  for (let k = 1; k < path.length; k++) {
    const axis = new Vector3().crossVectors(tangents[k - 1], tangents[k]);
    const n = normals[k - 1].clone();
    if (axis.lengthSq() > 1e-12) n.applyAxisAngle(axis.normalize(), tangents[k - 1].angleTo(tangents[k]));
    normals.push(n);
  }

  const positions: number[] = [];
  const vertexNormals: number[] = [];
  const indices: number[] = [];
  const direction = new Vector3();
  path.forEach((point, k) => {
    const binormal = new Vector3().crossVectors(tangents[k], normals[k]);
    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      direction.copy(normals[k]).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
      positions.push(point.x + radius * direction.x, point.y + radius * direction.y, point.z + radius * direction.z);
      vertexNormals.push(direction.x, direction.y, direction.z);
    }
  });
  for (let k = 0; k < path.length - 1; k++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = k * radialSegments + j;
      const b = k * radialSegments + ((j + 1) % radialSegments);
      const c = (k + 1) * radialSegments + ((j + 1) % radialSegments);
      const d = (k + 1) * radialSegments + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  // End caps with their own flat-shaded vertices.
  for (const [k, sign] of [[0, -1], [path.length - 1, 1]] as const) {
    const centre = positions.length / 3;
    const n = tangents[k].clone().multiplyScalar(sign);
    positions.push(path[k].x, path[k].y, path[k].z);
    vertexNormals.push(n.x, n.y, n.z);
    for (let j = 0; j < radialSegments; j++) {
      const ring = k * radialSegments + j;
      positions.push(positions[ring * 3], positions[ring * 3 + 1], positions[ring * 3 + 2]);
      vertexNormals.push(n.x, n.y, n.z);
    }
    for (let j = 0; j < radialSegments; j++) {
      const a = centre + 1 + j;
      const b = centre + 1 + ((j + 1) % radialSegments);
      if (sign < 0) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(vertexNormals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface DrapeOptions {
  width: number;
  height: number;
  folds: number;
  /** Peak-to-peak depth of the folds at the top. */
  foldDepth: number;
  /** How much deeper the folds are at the hem (0.35 = 35 % deeper). */
  hemFlare: number;
  thickness: number;
  segmentsPerFold: number;
  rows: number;
  /** Lay the curtain out towards -X instead of +X. */
  mirror: boolean;
}

/**
 * A pleated curtain: a closed solid with vertical folds, front facing +Z, spanning X = 0 … ±width
 * and Y = 0 … height. The wave cross-section is offset by half the thickness along its normal on
 * each side and extruded upwards, so edges and hem are finished from every angle.
 */
export function createDrapeGeometry(o: DrapeOptions): BufferGeometry {
  const columns = o.folds * o.segmentsPerFold;
  const amplitude = o.foldDepth / 2;
  const front: Vector2[] = [];
  const back: Vector2[] = [];
  const sign = o.mirror ? -1 : 1;
  for (let i = 0; i <= columns; i++) {
    const u = i / columns;
    const phase = Math.PI * 2 * o.folds * u;
    const z = amplitude * Math.sin(phase);
    const slope = ((amplitude * Math.PI * 2 * o.folds) / o.width) * Math.cos(phase);
    const length = Math.hypot(slope, 1);
    const nx = -slope / length;
    const nz = 1 / length;
    const x = u * o.width;
    // Shape space (u, v) with v = −z: rotateX(−π/2) below turns v back into +Z and extrusion into +Y.
    front.push(new Vector2(sign * (x + (nx * o.thickness) / 2), -(z + (nz * o.thickness) / 2)));
    back.push(new Vector2(sign * (x - (nx * o.thickness) / 2), -(z - (nz * o.thickness) / 2)));
  }
  const shape = new Shape([...front, ...back.reverse()]);
  const geometry = new ExtrudeGeometry(shape, { depth: o.height, steps: o.rows, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);

  // Folds deepen towards the hem.
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const t = 1 - position.getY(i) / o.height;
    position.setZ(i, position.getZ(i) * (1 + o.hemFlare * t));
  }
  return withCreasedNormals(geometry, Math.PI / 3);
}

export interface SpeakerOptions {
  width: number;
  height: number;
  depth: number;
  woofer: { radius: number; offsetY: number };
  tweeter: { radius: number; offsetY: number };
}

export interface SpeakerPiece {
  name: string;
  material: 'graphite' | 'grille' | 'driver';
  geometry: BufferGeometry;
}

/**
 * One speaker in its own frame: cabinet centred on the origin, front facing +Z. The front baffle
 * (grille) has openings for the drivers; the woofer cone and tweeter dome sit in the recess between
 * the baffle face and the cabinet, in front of the cabinet so they stay visible.
 */
export function createSpeakerPieces(o: SpeakerOptions): SpeakerPiece[] {
  const baffleDepth = 0.03;
  const front = o.depth / 2;
  const recessBack = front - baffleDepth;

  const cabinet = new RoundedBoxGeometry(o.width, o.height, o.depth - baffleDepth, 2, 0.02);
  cabinet.translate(0, 0, -baffleDepth / 2);

  const inset = 0.01;
  const outline = roundedPolygon(
    [
      { x: -o.width / 2 + inset, y: -o.height / 2 + inset },
      { x: o.width / 2 - inset, y: -o.height / 2 + inset },
      { x: o.width / 2 - inset, y: o.height / 2 - inset },
      { x: -o.width / 2 + inset, y: o.height / 2 - inset },
    ],
    [0.015, 0.015, 0.015, 0.015],
  );
  for (const driver of [o.woofer, o.tweeter]) {
    const hole = new Path();
    hole.absarc(0, driver.offsetY, driver.radius + 0.004, 0, Math.PI * 2, true);
    outline.holes.push(hole);
  }
  const baffle = new ExtrudeGeometry(outline, { depth: baffleDepth, bevelEnabled: false, curveSegments: 20 });
  baffle.translate(0, 0, recessBack);

  // Woofer: rolled surround and a cone falling back towards a dust cap, profile walked inwards so
  // lathe normals face forward. Revolved about Y, then turned to face +Z.
  const r = o.woofer.radius;
  const cone = new LatheGeometry(
    [
      [r, 0],
      [r - 0.004, 0.005],
      [r - 0.011, 0.006],
      [r - 0.017, 0.002],
      [r - 0.02, 0],
      // Inner edge meets the dust cap's base ring (radius 0.04 · sin 0.9 ≈ 0.031).
      [0.031, -0.02],
    ].map(([x, y]) => new Vector2(x, y)),
    24,
  );
  cone.rotateX(Math.PI / 2);
  cone.translate(0, o.woofer.offsetY, front - 0.004);
  const dustCap = new SphereGeometry(0.04, 16, 4, 0, Math.PI * 2, 0, 0.9);
  dustCap.rotateX(Math.PI / 2);
  dustCap.translate(0, o.woofer.offsetY, front - 0.004 - 0.02 - 0.04 * Math.cos(0.9));

  const tweeter = new SphereGeometry(o.tweeter.radius, 12, 4, 0, Math.PI * 2, 0, 1.2);
  tweeter.rotateX(Math.PI / 2);
  tweeter.translate(0, o.tweeter.offsetY, recessBack + 0.002 - o.tweeter.radius * Math.cos(1.2));
  const tweeterRing = new TorusGeometry(o.tweeter.radius + 0.002, 0.003, 6, 16);
  tweeterRing.translate(0, o.tweeter.offsetY, recessBack + 0.004);

  return [
    { name: 'cabinet', material: 'graphite', geometry: cabinet },
    { name: 'baffle', material: 'grille', geometry: baffle },
    { name: 'woofer', material: 'driver', geometry: cone },
    { name: 'dust-cap', material: 'driver', geometry: dustCap },
    { name: 'tweeter', material: 'driver', geometry: tweeter },
    { name: 'tweeter-ring', material: 'graphite', geometry: tweeterRing },
  ];
}

/** Rotation about +Y then about the rotated +X: yaw turns the front, tilt (positive) aims it down. */
export function yawTilt(yaw: number, tilt: number): Matrix4 {
  return new Matrix4().makeRotationY(yaw).multiply(new Matrix4().makeRotationX(tilt));
}
