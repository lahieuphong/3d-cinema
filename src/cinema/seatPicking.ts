import { Box3, Matrix4, type Object3D, Ray, Raycaster, Vector3 } from 'three';
import type { SeatData } from './layout.ts';
import { computeSeatModelBounds, seatPivotMatrix, type SeatModel } from './seats.ts';

export interface SeatHit {
  seat: SeatData;
  /** Along the ray, in metres (seat transforms are rigid, so local and world distances agree). */
  distance: number;
}

export interface PickOptions {
  /** Visible meshes that can hide a seat (walls, floor, stage…). Hidden ones must not be passed. */
  occluders: readonly Object3D[];
  maxDistance?: number;
  /** A seat index never picked (the seat the camera is sitting in). */
  ignoreSeat?: number;
}

/**
 * Picking proxies for the seats: for every seat, the boxes of its real components (cushion, back
 * pads, shell, armrests, standards, cup holder…) in seat-local space, taken from the built model,
 * so they hug the seat at either quality level and leave the gaps between seats and rows empty
 * (unlike the walking colliders, one box per row). A ray is moved into each seat's frame and tested
 * against the seat's overall box, then its component boxes: no triangles, so it is cheap enough for
 * hover. Instance i is `seats[i]`, exactly as for the rendered instances.
 */
export class SeatPicker {
  readonly seats: readonly SeatData[];
  private readonly toLocal: Matrix4[];
  private readonly bounds: Box3;
  private readonly boxes: Box3[];

  constructor(seats: readonly SeatData[], model: SeatModel) {
    this.seats = seats;
    this.toLocal = seats.map((seat) => seatPivotMatrix(seat).invert());
    this.bounds = computeSeatModelBounds(model);
    this.boxes = model.components.map((component) => component.bounds.clone());
  }

  /** Nearest seat whose proxy the ray hits, ignoring occluders. */
  nearest(ray: Ray, maxDistance = Infinity, ignoreSeat = -1): SeatHit | null {
    const local = new Ray();
    const point = new Vector3();
    let best: SeatHit | null = null;
    for (let i = 0; i < this.seats.length; i++) {
      if (i === ignoreSeat) continue;
      local.copy(ray).applyMatrix4(this.toLocal[i]);
      if (!local.intersectBox(this.bounds, point)) continue;
      for (const box of this.boxes) {
        if (!local.intersectBox(box, point)) continue;
        const distance = local.origin.distanceTo(point);
        if (distance <= maxDistance && (best === null || distance < best.distance)) best = { seat: this.seats[i], distance };
      }
    }
    return best;
  }
}

const raycaster = new Raycaster();

/**
 * The seat under a ray: the nearest proxy hit, unless a visible occluder (wall, floor riser,
 * stage, curtain, screen) lies in front of it. Seats in front hide seats behind them through the
 * proxies themselves. Occluders are only raycast when a seat was hit, and only up to it.
 */
export function pickSeat(picker: SeatPicker, ray: Ray, options: PickOptions): SeatHit | null {
  const hit = picker.nearest(ray, options.maxDistance, options.ignoreSeat);
  if (!hit) return null;
  raycaster.set(ray.origin, ray.direction);
  raycaster.near = 0;
  raycaster.far = Math.max(0, hit.distance - 0.005);
  const blocked = raycaster.intersectObjects(options.occluders as Object3D[], false).length > 0;
  return blocked ? null : hit;
}

/** Visible meshes under `root` (hidden groups and their children are skipped). */
export function visibleMeshes(root: Object3D): Object3D[] {
  const meshes: Object3D[] = [];
  root.traverseVisible((object) => {
    if ((object as { isMesh?: boolean }).isMesh) meshes.push(object);
  });
  return meshes;
}
