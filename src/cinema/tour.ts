import { Vector3 } from 'three';
import { createPathCurve, easeTrapezoid, orientationTowards, yawDelta, type Orientation, type PathCurve } from './cameraPath.ts';
import type { CameraPose } from './cameraPresets.ts';
import { stairPitchY, type AuditoriumLayout, type Vec3 } from './layout.ts';

/** A point where the tour pauses briefly; with reduced motion, the tour steps between these. */
export interface TourStop {
  id: string;
  label: string;
  position: Vec3;
  lookAt: Vec3;
  /** Seconds spent still at this stop before moving on. */
  hold: number;
}

/**
 * The move from one stop to the next: through `via` (if any), over `seconds`. `turn` forces the
 * direction of a turn of about 180°, so it sweeps across the room rather than past a near wall.
 */
export interface TourLeg {
  seconds: number;
  via: Vec3[];
  turn?: 'left' | 'right';
}

export interface Tour {
  stops: TourStop[];
  /** `legs[i]` goes from `stops[i]` to `stops[i + 1]`. */
  legs: TourLeg[];
  duration: number;
}

export interface TourSample {
  position: Vector3;
  orientation: Orientation;
  /** Stop the camera is at, or the last one it left. */
  stopIndex: number;
  holding: boolean;
}

/**
 * The guided tour, about 30 s, from the overview and back:
 * overview → over the seats to above row B, facing the screen, curtains and stage → down to the
 * front right, the curtain, front speaker and exit door → turn (across the room) at the foot of the
 * right aisle to look back over the rows → up the right aisle past the row ends → back to the overview.
 * Positions come from the layout (eye height above the floor where the camera stands, aisle centre
 * lines, the stair pitch line); every point along the way is checked against the colliders in tests.
 */
export function createTour(layout: AuditoriumLayout, overview: CameraPose): Tour {
  const { config, interior, stage, screen, rows } = layout;
  const eye = config.camera.explore.eyeHeight;
  const aisleX = interior.x.max - config.aisles.width / 2;
  const frontZ = stage.z.max + 2.6;
  const curtain = config.interior.curtains;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const aisleFootZ = first.treadZ.min - 0.5;
  const aisleTopZ = last.treadZ.min + 0.4;
  const onStairs = (z: number) => ({ x: aisleX, y: stairPitchY(layout, z) + eye, z });

  const stops: TourStop[] = [
    { id: 'overview', label: 'Tổng quan phòng chiếu', position: overview.position, lookAt: overview.lookAt, hold: 1 },
    // Far enough back (above row B) for the whole picture, the curtains and the stage to fit.
    {
      id: 'screen',
      label: 'Màn chiếu, rèm và bục',
      position: { x: 0, y: 2.8, z: rows[1].seatZ },
      lookAt: { x: 0, y: screen.center.y - 0.4, z: screen.center.z },
      hold: 1.8,
    },
    {
      id: 'curtain',
      label: 'Rèm, loa trước và cửa thoát bên phải',
      position: { x: 3.4, y: eye + 0.2, z: frontZ },
      lookAt: { x: (curtain.innerX + curtain.outerX) / 2, y: 2.6, z: curtain.centerZ + 0.5 },
      hold: 1,
    },
    {
      id: 'rows',
      label: 'Nhìn lại các hàng ghế từ chân lối đi',
      position: onStairs(aisleFootZ),
      lookAt: { x: 0.5, y: rows[4].floorY + 1, z: rows[5].seatZ },
      hold: 1.8,
    },
    {
      id: 'aisle',
      label: 'Lên lối đi bên phải, dọc các đầu hàng',
      position: onStairs(aisleTopZ),
      // Across the rows towards the screen end, not at the back wall.
      lookAt: { x: -2, y: last.floorY + 0.6, z: last.seatZ - 2.5 },
      hold: 0.8,
    },
    { id: 'end', label: 'Trở lại tổng quan', position: overview.position, lookAt: overview.lookAt, hold: 0 },
  ];
  const legs: TourLeg[] = [
    { seconds: 5.5, via: [] },
    { seconds: 3, via: [] },
    { seconds: 4.5, via: [], turn: 'left' },
    // Parallel to the stair pitch line, so the eye stays at standing height above the steps.
    { seconds: 5.5, via: [onStairs(first.treadZ.min), onStairs(last.treadZ.min)] },
    { seconds: 5, via: [] },
  ];
  const duration = stops.reduce((sum, stop) => sum + stop.hold, 0) + legs.reduce((sum, leg) => sum + leg.seconds, 0);
  return { stops, legs, duration };
}

/** Samples a tour at any time, with precomputed curves; pure, so tests can walk the whole path. */
export class TourPath {
  readonly tour: Tour;
  private readonly curves: PathCurve[];
  private readonly orientations: Orientation[];
  /** Yaw change per leg: the shorter way round unless the leg says which way to turn. */
  private readonly turns: number[];

  constructor(tour: Tour) {
    this.tour = tour;
    this.curves = tour.legs.map((leg, i) => createPathCurve([tour.stops[i].position, ...leg.via, tour.stops[i + 1].position]));
    this.orientations = tour.stops.map((stop) => orientationTowards(stop.position, stop.lookAt));
    this.turns = tour.legs.map((leg, i) => {
      const delta = yawDelta(this.orientations[i].yaw, this.orientations[i + 1].yaw);
      if (leg.turn === 'left' && delta < 0) return delta + 2 * Math.PI;
      if (leg.turn === 'right' && delta > 0) return delta - 2 * Math.PI;
      return delta;
    });
  }

  /** Start time of each stop's hold. */
  stopTimes(): number[] {
    const times: number[] = [];
    let t = 0;
    this.tour.stops.forEach((stop, i) => {
      times.push(t);
      t += stop.hold + (this.tour.legs[i]?.seconds ?? 0);
    });
    return times;
  }

  sample(time: number, target = new Vector3()): TourSample {
    const { stops, legs } = this.tour;
    let t = Math.max(0, time);
    for (let i = 0; i < stops.length; i++) {
      if (t <= stops[i].hold || i === stops.length - 1) {
        const p = stops[i].position;
        return { position: target.set(p.x, p.y, p.z), orientation: { ...this.orientations[i] }, stopIndex: i, holding: true };
      }
      t -= stops[i].hold;
      if (t < legs[i].seconds) {
        const eased = easeTrapezoid(t / legs[i].seconds);
        this.curves[i].pointAt(eased, target);
        const from = this.orientations[i];
        const to = this.orientations[i + 1];
        const orientation = { yaw: from.yaw + this.turns[i] * eased, pitch: from.pitch + (to.pitch - from.pitch) * eased };
        return { position: target, orientation, stopIndex: i, holding: false };
      }
      t -= legs[i].seconds;
    }
    throw new Error('unreachable');
  }
}
