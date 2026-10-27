import { floorElevationAt, type AuditoriumLayout, type Box, type Range, type Vec3 } from './layout.ts';

/**
 * Simple colliders for moving the camera through the room: axis-aligned boxes built from layout
 * data (never from the rendered triangles), the room's finished wall faces, and the stepped floor.
 *
 * - Walls, ceiling and closed doors: the room box. The doors sit in the wall openings and the
 *   handrails in the recess behind the panel face, so the box keeps the body clear of both.
 * - Seats: one box per row over the seat footprints, up to just above the backrests.
 * - Stage and curtains: one box each.
 * Speakers, exit signs and the projector hang above head height everywhere a person can stand
 * (checked in tests), so they need no collider.
 *
 * The same world serves the walker (explore mode) and the checks on transition and tour paths.
 * Hiding a wall or the ceiling in the inspection tools never changes it.
 */
export interface Collider {
  name: string;
  x: Range;
  y: Range;
  z: Range;
}

export interface CollisionWorld {
  layout: AuditoriumLayout;
  /** Inside faces of walls, floor and ceiling. */
  room: Box;
  colliders: Collider[];
  /** Height of the walkable floor under (x, z): the room floor, the stepped tiers or the back landing. */
  floorAt(x: number, z: number): number;
}

/** Top of every seat collider above its row floor; the tallest seat part (backrest) is 1.09 m. */
export const SEAT_COLLIDER_HEIGHT = 1.15;

export function createCollisionWorld(layout: AuditoriumLayout): CollisionWorld {
  const { config, rows, stage, interior } = layout;
  const halfWidth = config.seat.footprintWidth / 2;
  const halfDepth = config.seat.footprintDepth / 2;
  const colliders: Collider[] = [];

  for (const row of rows) {
    const seats = layout.seats.filter((seat) => seat.rowIndex === row.index);
    colliders.push({
      name: `seats-${row.label}`,
      x: { min: Math.min(...seats.map((s) => s.position.x)) - halfWidth, max: Math.max(...seats.map((s) => s.position.x)) + halfWidth },
      y: { min: row.floorY, max: row.floorY + SEAT_COLLIDER_HEIGHT },
      z: { min: row.seatZ - halfDepth, max: row.seatZ + halfDepth },
    });
  }

  colliders.push({ name: 'stage', ...stage });

  // Pleated curtains: the folds swing ±(depth / 2) about the centre line, more at the hem.
  const c = config.interior.curtains;
  const swing = (c.foldDepth / 2) * (1 + c.hemFlare) + c.thickness;
  for (const side of [-1, 1] as const) {
    const xs = [side * c.innerX, side * c.outerX];
    colliders.push({
      name: `curtain-${side < 0 ? 'left' : 'right'}`,
      x: { min: Math.min(...xs), max: Math.max(...xs) },
      y: { min: c.bottomY, max: c.topY },
      z: { min: c.centerZ - swing, max: c.centerZ + swing },
    });
  }

  return {
    layout,
    room: interior,
    colliders,
    floorAt: (_x, z) => floorElevationAt(layout, z),
  };
}

/** The walking body: a vertical cylinder standing on the floor. */
export interface BodySettings {
  radius: number;
  /** Eye above the floor the body stands on. */
  eyeHeight: number;
  /** Top of the head above the floor. */
  height: number;
  /** Largest floor change crossed in one go (an aisle step is 0.18 m, the stage 0.5 m). */
  maxStep: number;
}

/** Plan-view position of the body and the floor height it stands on. */
export interface BodyPosition {
  x: number;
  z: number;
  floorY: number;
}

/** True if the body fits at (x, z) standing on `floorY`: inside the walls and clear of every collider. */
export function bodyFits(world: CollisionWorld, body: BodySettings, x: number, z: number, floorY: number): boolean {
  const { room } = world;
  if (x < room.x.min + body.radius || x > room.x.max - body.radius) return false;
  if (z < room.z.min + body.radius || z > room.z.max - body.radius) return false;
  if (floorY + body.height > room.y.max) return false;
  return world.colliders.every((collider) => !bodyHits(collider, body, x, z, floorY));
}

/**
 * Moves the body by (dx, dz), sliding along walls and colliders. The move is split into steps no
 * longer than half the body radius, so nothing thinner than the body can be skipped however large
 * the move; each step is pushed out of colliders, clamped to the walls, and refused if the floor
 * there rises or drops by more than `maxStep` (it then tries each axis alone, to slide).
 */
export function moveBody(world: CollisionWorld, body: BodySettings, from: BodyPosition, dx: number, dz: number): BodyPosition {
  const length = Math.hypot(dx, dz);
  if (length === 0) return { ...from };
  const steps = Math.max(1, Math.ceil(length / (body.radius / 2)));
  let position = { ...from };
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps;
    const sz = dz / steps;
    position = tryStep(world, body, position, sx, sz) ?? tryStep(world, body, position, sx, 0) ?? tryStep(world, body, position, 0, sz) ?? position;
  }
  return position;
}

function tryStep(world: CollisionWorld, body: BodySettings, from: BodyPosition, dx: number, dz: number): BodyPosition | null {
  if (dx === 0 && dz === 0) return null;
  let x = from.x + dx;
  let z = from.z + dz;
  // Push out of colliders at the current floor level; repeat for corners between two boxes.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const collider of world.colliders) {
      const pushed = pushOut(collider, body, x, z, from.floorY);
      if (pushed) {
        [x, z] = pushed;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const { room } = world;
  x = clamp(x, room.x.min + body.radius, room.x.max - body.radius);
  z = clamp(z, room.z.min + body.radius, room.z.max - body.radius);
  if (Math.abs(x - from.x) < 1e-9 && Math.abs(z - from.z) < 1e-9) return null;

  const floorY = world.floorAt(x, z);
  if (Math.abs(floorY - from.floorY) > body.maxStep) return null;
  if (!bodyFits(world, body, x, z, floorY)) return null;
  return { x, z, floorY };
}

/** The part of the body that can hit things: from just above a climbable step up to the head. */
function overlapsVertically(collider: Collider, body: BodySettings, floorY: number): boolean {
  return collider.y.max > floorY + body.maxStep && collider.y.min < floorY + body.height;
}

function bodyHits(collider: Collider, body: BodySettings, x: number, z: number, floorY: number): boolean {
  if (!overlapsVertically(collider, body, floorY)) return false;
  const cx = clamp(x, collider.x.min, collider.x.max);
  const cz = clamp(z, collider.z.min, collider.z.max);
  return (x - cx) ** 2 + (z - cz) ** 2 < body.radius ** 2 - 1e-9;
}

/** New (x, z) just outside `collider`, or null if the body does not touch it. */
function pushOut(collider: Collider, body: BodySettings, x: number, z: number, floorY: number): [number, number] | null {
  if (!bodyHits(collider, body, x, z, floorY)) return null;
  const cx = clamp(x, collider.x.min, collider.x.max);
  const cz = clamp(z, collider.z.min, collider.z.max);
  const distance = Math.hypot(x - cx, z - cz);
  if (distance > 1e-9) {
    const push = body.radius - distance + 1e-6;
    return [x + ((x - cx) / distance) * push, z + ((z - cz) / distance) * push];
  }
  // Centre inside the box: leave by the nearest face.
  // [penetration depth, new x, new z]
  const exits: Array<[number, number, number]> = [
    [x - collider.x.min, collider.x.min - body.radius - 1e-6, z],
    [collider.x.max - x, collider.x.max + body.radius + 1e-6, z],
    [z - collider.z.min, x, collider.z.min - body.radius - 1e-6],
    [collider.z.max - z, x, collider.z.max + body.radius + 1e-6],
  ];
  exits.sort((a, b) => a[0] - b[0]);
  return [exits[0][1], exits[0][2]];
}

/**
 * True if a camera point is clear: inside the room with `margin` to every wall, the floor and the
 * ceiling, and outside every collider grown by `margin`. Colliders listed in `ignore` are skipped
 * (a seated eye starts inside its own row's box).
 */
export function pointClear(world: CollisionWorld, p: Vec3, margin: number, ignore: ReadonlySet<string> = EMPTY): boolean {
  const { room } = world;
  if (p.x < room.x.min + margin || p.x > room.x.max - margin) return false;
  if (p.z < room.z.min + margin || p.z > room.z.max - margin) return false;
  if (p.y < world.floorAt(p.x, p.z) + margin || p.y > room.y.max - margin) return false;
  return world.colliders.every(
    (c) =>
      ignore.has(c.name) ||
      p.x <= c.x.min - margin || p.x >= c.x.max + margin ||
      p.y <= c.y.min - margin || p.y >= c.y.max + margin ||
      p.z <= c.z.min - margin || p.z >= c.z.max + margin,
  );
}

/** Colliders that contain `p` (grown by `margin`), e.g. the seat row around a seated eye. */
export function collidersAt(world: CollisionWorld, p: Vec3, margin = 0): Set<string> {
  return new Set(
    world.colliders
      .filter(
        (c) =>
          p.x > c.x.min - margin && p.x < c.x.max + margin &&
          p.y > c.y.min - margin && p.y < c.y.max + margin &&
          p.z > c.z.min - margin && p.z < c.z.max + margin,
      )
      .map((c) => c.name),
  );
}

const EMPTY: ReadonlySet<string> = new Set();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
