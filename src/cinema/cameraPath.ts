import { CatmullRomCurve3, Vector3 } from 'three';
import { collidersAt, pointClear, type CollisionWorld } from './collision.ts';
import type { Vec3 } from './layout.ts';

/**
 * Camera orientation without roll: yaw about +Y (0 looks towards −Z, the screen; positive turns
 * left) and pitch about the camera's X axis (positive looks up). Applied as Euler 'YXZ'.
 */
export interface Orientation {
  yaw: number;
  pitch: number;
}

/** Orientation that looks from `from` towards `to`. */
export function orientationTowards(from: Vec3, to: Vec3): Orientation {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Unit view direction for an orientation. */
export function directionOf({ yaw, pitch }: Orientation): Vec3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

/** Signed yaw change from `a` to `b` along the shorter way round, in (−π, π]. */
export function yawDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Interpolates two orientations: yaw the shorter way round, pitch linearly; never rolls. */
export function lerpOrientation(a: Orientation, b: Orientation, t: number): Orientation {
  return { yaw: a.yaw + yawDelta(a.yaw, b.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t };
}

/** Angle between two orientations' view directions, in radians. */
export function angleBetween(a: Orientation, b: Orientation): number {
  const da = directionOf(a);
  const db = directionOf(b);
  return Math.acos(Math.min(1, Math.max(-1, da.x * db.x + da.y * db.y + da.z * db.z)));
}

/**
 * Smooth start and stop with a constant cruise in between: speed ramps up over the first
 * `accel` of the time and down over the last, so the peak speed is only 1 / (1 − accel) times the
 * average (a cubic ease peaks at 1.5×).
 */
export function easeTrapezoid(t: number, accel = 0.3): number {
  const v = 1 / (1 - accel);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < accel) return (v * t * t) / (2 * accel);
  if (t > 1 - accel) return 1 - (v * (1 - t) ** 2) / (2 * accel);
  return v * (accel / 2 + (t - accel));
}

/** A position curve through points, sampled by arc length (u in [0, 1]). */
export interface PathCurve {
  length: number;
  pointAt(u: number, target?: Vector3): Vector3;
}

export function createPathCurve(points: readonly Vec3[]): PathCurve {
  const vectors = points.map((p) => new Vector3(p.x, p.y, p.z));
  if (vectors.length === 2) {
    const [a, b] = vectors;
    return { length: a.distanceTo(b), pointAt: (u, target = new Vector3()) => target.lerpVectors(a, b, u) };
  }
  // Centripetal Catmull-Rom does not overshoot or loop at sharp corners.
  const curve = new CatmullRomCurve3(vectors, false, 'centripetal');
  curve.arcLengthDivisions = 400;
  return { length: curve.getLength(), pointAt: (u, target = new Vector3()) => curve.getPointAt(Math.min(1, Math.max(0, u)), target) };
}

/** Clearance kept from colliders, walls, floor and ceiling by camera transitions and the tour. */
export const PATH_MARGIN = 0.15;
const SAMPLE_STEP = 0.05;

/**
 * True if every point along the curve (every 5 cm) is clear of the room's colliders. A collider
 * that already contains one end (a seated eye inside its row's box) is ignored near that end only.
 */
export function pathClear(world: CollisionWorld, curve: PathCurve, ends: readonly [Vec3, Vec3], margin = PATH_MARGIN): boolean {
  const samples = Math.max(2, Math.ceil(curve.length / SAMPLE_STEP));
  const startInside = collidersAt(world, ends[0], margin);
  const endInside = collidersAt(world, ends[1], margin);
  const point = new Vector3();
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    curve.pointAt(u, point);
    const distanceFromStart = u * curve.length;
    const distanceToEnd = (1 - u) * curve.length;
    const ignore = new Set<string>();
    if (distanceFromStart < 0.6) startInside.forEach((name) => ignore.add(name));
    if (distanceToEnd < 0.6) endInside.forEach((name) => ignore.add(name));
    if (!pointClear(world, point, margin, ignore)) return false;
  }
  return true;
}

/**
 * Plans a transition between two camera positions inside the room: the straight line if it is
 * clear; otherwise up over the obstacle at a safe height, across, and down. Returns null when
 * neither is clear; the caller then cuts straight to the new view instead of flying through
 * something.
 */
export function planCameraPath(world: CollisionWorld, from: Vec3, to: Vec3): Vec3[] | null {
  const direct = [from, to];
  if (pathClear(world, createPathCurve(direct), [from, to])) return direct;

  const { room, colliders } = world;
  const tallest = Math.max(...colliders.filter((c) => c.y.max < room.y.max - 1).map((c) => c.y.max));
  const lift = Math.min(room.y.max - 1, Math.max(from.y, to.y, tallest + 1));
  const up = [from, { ...from, y: lift }, { ...to, y: lift }, to];
  if (pathClear(world, createPathCurve(up), [from, to])) return up;
  return null;
}

