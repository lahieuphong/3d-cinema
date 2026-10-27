import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  angleBetween,
  createPathCurve,
  directionOf,
  easeTrapezoid,
  lerpOrientation,
  orientationTowards,
  pathClear,
  planCameraPath,
  PATH_MARGIN,
} from './cameraPath.ts';
import { CAMERA_PRESETS, computePresetPose, fovForAspect, horizontalFov, type CameraPose } from './cameraPresets.ts';
import { bodyFits, createCollisionWorld, moveBody, pointClear, SEAT_COLLIDER_HEIGHT } from './collision.ts';
import { createAuditoriumLayout, floorElevationAt, seatEyePosition, toDegrees } from './layout.ts';
import { createSeatMaterials, disposeMaterials } from './materials.ts';
import { QUALITY_LEVELS } from './quality.ts';
import { computeSeatModelBounds, createCinemaSeatModel, seatPivotMatrix } from './seats.ts';
import { seatViewPose } from './seatView.ts';
import { createTour, TourPath } from './tour.ts';
import { chooseWalkStart, stepWalker, turnWalker, type WalkerState } from './walker.ts';

const layout = createAuditoriumLayout();
const { config, interior, rows, screen, stage } = layout;
const world = createCollisionWorld(layout);
const walk = config.camera.explore;
const aisleX = interior.x.max - config.aisles.width / 2;

const ASPECTS = { desktop: 1398 / 784, tabletPortrait: 785 / 1020, phonePortrait: 364 / 649, phoneLandscape: 808 / 278 };

function stand(x: number, z: number, yaw = 0): WalkerState {
  const floorY = world.floorAt(x, z);
  return { x, z, floorY, eyeY: floorY + walk.eyeHeight, yaw, pitch: 0 };
}

/** Walks with a fixed intent for `seconds`, in frames of `dt`. */
function walkFor(state: WalkerState, intent: { forward: number; right: number }, seconds: number, dt = 1 / 60): WalkerState {
  let s = state;
  for (let t = 0; t < seconds; t += dt) s = stepWalker(world, walk, s, intent, dt).state;
  return s;
}

function cameraFor(pose: CameraPose, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(fovForAspect(config.camera, aspect), aspect, config.camera.near, config.camera.far);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  camera.updateMatrixWorld();
  return camera;
}

function visible(camera: PerspectiveCamera, point: { x: number; y: number; z: number }): boolean {
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return frustum.containsPoint(new Vector3(point.x, point.y, point.z));
}

describe('collision world', () => {
  it('has a box per seat row, the stage and both curtains, from layout data', () => {
    expect(world.colliders.map((c) => c.name)).toEqual([...rows.map((r) => `seats-${r.label}`), 'stage', 'curtain-left', 'curtain-right']);
  });

  it('covers every seat at both quality levels (backrest included)', () => {
    const materials = createSeatMaterials();
    try {
      for (const level of QUALITY_LEVELS) {
        const model = createCinemaSeatModel(config, materials, config.quality[level].seat);
        const bounds = computeSeatModelBounds(model);
        expect(bounds.max.y).toBeLessThan(SEAT_COLLIDER_HEIGHT);
        for (const seat of layout.seats) {
          const world_ = bounds.clone().applyMatrix4(seatPivotMatrix(seat));
          const row = world.colliders.find((c) => c.name === `seats-${seat.rowLabel}`)!;
          expect(world_.min.x).toBeGreaterThanOrEqual(row.x.min - 1e-6);
          expect(world_.max.x).toBeLessThanOrEqual(row.x.max + 1e-6);
          expect(world_.min.z).toBeGreaterThanOrEqual(row.z.min - 1e-6);
          expect(world_.max.z).toBeLessThanOrEqual(row.z.max + 1e-6);
        }
        model.dispose();
      }
    } finally {
      disposeMaterials(materials);
    }
  });

  it('keeps everything without a collider out of reach: handrails behind the wall face, speakers and signs above heads', () => {
    const h = config.interior.handrail;
    expect(interior.x.max + h.inset - h.radius).toBeGreaterThan(interior.x.max);
    const highestHead = Math.max(...rows.map((r) => r.floorY)) + walk.height;
    const s = config.interior.speakers;
    expect(s.centerY - s.height / 2).toBeGreaterThan(highestHead);
    // Exit signs hang above the doors on the front floor (Y 0).
    expect(config.interior.door.height).toBeGreaterThan(walk.height);
  });

  it('lets a person stand in the aisles, at the front and on the back landing, but not in a row or on the stage', () => {
    expect(bodyFits(world, walk, aisleX, rows[4].treadZ.min + 0.3, world.floorAt(0, rows[4].treadZ.min + 0.3))).toBe(true);
    expect(bodyFits(world, walk, 0, stage.z.max + 2, 0)).toBe(true);
    expect(bodyFits(world, walk, 0, interior.z.max - 0.6, rows.at(-1)!.floorY)).toBe(true);
    expect(bodyFits(world, walk, 0, rows[4].seatZ, rows[4].floorY)).toBe(false);
    expect(bodyFits(world, walk, 0, stage.z.min + 0.5, 0)).toBe(false);
  });
});

describe('walker', () => {
  it('walks up and down the aisle steps with the eye easing to standing height', () => {
    const start = stand(aisleX, rows[0].treadZ.min - 0.4, Math.PI); // facing +Z, up the aisle
    const top = walkFor(start, { forward: 1, right: 0 }, 9);
    expect(top.floorY).toBeCloseTo(rows.at(-1)!.floorY, 6);
    expect(top.eyeY).toBeCloseTo(top.floorY + walk.eyeHeight, 3);
    const down = walkFor(top, { forward: -1, right: 0 }, 9);
    expect(down.floorY).toBe(0);
    // Never more than one step at a time and never below the floor.
    let s = start;
    for (let i = 0; i < 600; i++) {
      const next = stepWalker(world, walk, s, { forward: 1, right: 0.3 }, 1 / 60).state;
      expect(Math.abs(next.floorY - s.floorY)).toBeLessThanOrEqual(walk.maxStep);
      expect(next.eyeY).toBeGreaterThan(next.floorY + 1);
      s = next;
    }
  });

  it('does not climb the stage or pass through the seat rows, walking straight or diagonally', () => {
    const front = stand(0, stage.z.max + 1.5);
    const atStage = walkFor(front, { forward: 1, right: 0 }, 5);
    expect(atStage.z).toBeGreaterThanOrEqual(stage.z.max + walk.radius - 1e-6);
    expect(atStage.floorY).toBe(0);

    // Straight at the seats, and diagonally (which slides along row A into an aisle and up it).
    for (const right of [0, 0.7, -0.7]) {
      let s = stand(0, stage.z.max + 1.5, Math.PI);
      for (let i = 0; i < 480; i++) {
        s = stepWalker(world, walk, s, { forward: 1, right }, 1 / 60).state;
        expect(bodyFits(world, walk, s.x, s.z, s.floorY)).toBe(true);
      }
      if (right === 0) expect(s.z).toBeLessThanOrEqual(rows[0].seatZ - config.seat.footprintDepth / 2 - walk.radius + 1e-6);
      else expect(Math.abs(s.x)).toBeGreaterThan(layout.seatingZone.x.max);
    }
  });

  it('never skips a collider, however large the step (slow frame, fast stick)', () => {
    // From the aisle straight across the seat block in one 20 m move.
    const from = stand(aisleX, rows[5].treadZ.min + 0.3, Math.PI / 2); // facing −X
    const moved = moveBody(world, walk, from, -20, 0);
    expect(moved.x).toBeGreaterThan(world.colliders[5].x.max);
    // A whole second at a huge dt is clamped by the caller; even unclamped, the body stops at the wall.
    const huge = stepWalker(world, walk, stand(aisleX, rows[5].treadZ.min + 0.3, -Math.PI / 2), { forward: 1, right: 0 }, 30).state;
    expect(huge.x).toBeLessThanOrEqual(interior.x.max - walk.radius + 1e-9);
    expect(bodyFits(world, walk, huge.x, huge.z, huge.floorY)).toBe(true);
  });

  it('slides along walls instead of stopping dead, and diagonal input is not faster', () => {
    const nearWall = stand(interior.x.max - walk.radius - 0.01, stage.z.max + 2, Math.PI / 4);
    const slid = walkFor(nearWall, { forward: 1, right: 0 }, 1);
    expect(Math.abs(slid.z - nearWall.z)).toBeGreaterThan(0.5);
    const open = stand(0, stage.z.max + 2, 0);
    const straight = stepWalker(world, walk, open, { forward: 1, right: 0 }, 0.1).state;
    const diagonal = stepWalker(world, walk, open, { forward: 1, right: 1 }, 0.1).state;
    const distance = (s: WalkerState) => Math.hypot(s.x - open.x, s.z - open.z);
    expect(distance(diagonal)).toBeCloseTo(distance(straight), 6);
  });

  it('limits pitch and never rolls', () => {
    const s = turnWalker(walk, stand(0, 0), 0.3, 10);
    expect(toDegrees(s.pitch)).toBeCloseTo(walk.maxPitchDeg, 6);
    expect(toDegrees(turnWalker(walk, s, 0, -20).pitch)).toBeCloseTo(walk.minPitchDeg, 6);
  });

  it('starts where the camera is if a person fits below it, otherwise at the nearest start point', () => {
    const points = [
      { id: 'aisle-right', label: '', x: aisleX, z: rows[5].treadZ.min + 0.3 },
      { id: 'front', label: '', x: 0, z: stage.z.max + 2.2 },
    ];
    const overview = computePresetPose('overview', layout, ASPECTS.desktop);
    const here = chooseWalkStart(world, walk, overview.position, orientationTowards(overview.position, overview.lookAt), points);
    expect(here.relocatedTo).toBeNull();
    expect(here.state.x).toBeCloseTo(overview.position.x, 9);
    const seat = seatEyePosition(layout, layout.seatById.get('F06')!);
    const moved = chooseWalkStart(world, walk, seat, { yaw: 0, pitch: 0 }, points);
    expect(moved.relocatedTo?.id).toBe('aisle-right');
  });
});

describe('camera paths', () => {
  it('eases with a capped peak speed and interpolates orientation without roll or flips', () => {
    let peak = 0;
    for (let t = 0; t < 1; t += 0.001) peak = Math.max(peak, (easeTrapezoid(t + 0.001) - easeTrapezoid(t)) / 0.001);
    expect(peak).toBeLessThan(1.5);
    const a = { yaw: 3, pitch: 0.2 };
    const b = { yaw: -3, pitch: -0.1 };
    // The short way round (across ±π), not through 0.
    expect(angleBetween(a, lerpOrientation(a, b, 0.5))).toBeLessThan(0.3);
    expect(directionOf(orientationTowards({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).x).toBeCloseTo(1, 9);
  });

  it('goes around the seats instead of through them, and through the air when that is clear', () => {
    const eye = seatEyePosition(layout, layout.seatById.get('F06')!);
    const aisle = { x: aisleX, y: rows[5].floorY + walk.eyeHeight, z: rows[5].treadZ.min + 0.3 };
    expect(pathClear(world, createPathCurve([eye, aisle]), [eye, aisle])).toBe(false);
    const planned = planCameraPath(world, eye, aisle)!;
    expect(planned.length).toBe(4);
    expect(pathClear(world, createPathCurve(planned), [eye, aisle])).toBe(true);

    const overview = computePresetPose('overview', layout, ASPECTS.desktop).position;
    const seats = computePresetPose('seats', layout, ASPECTS.desktop).position;
    expect(planCameraPath(world, overview, seats)).toEqual([overview, seats]);
  });

  it('plans a clear path between every pair of experience views at every aspect', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const poses = CAMERA_PRESETS.filter((p) => p.space === 'experience').map((p) => computePresetPose(p.id, layout, aspect));
      for (const a of poses) for (const b of poses) if (a !== b) expect(planCameraPath(world, a.position, b.position)).not.toBeNull();
    }
  });
});

describe('guided tour', () => {
  const path = new TourPath(createTour(layout, computePresetPose('overview', layout, ASPECTS.desktop)));
  const { tour } = path;
  const samples = Array.from({ length: Math.ceil(tour.duration / 0.02) + 1 }, (_, i) => i * 0.02);

  it('lasts 20–30 s, starts and ends at the overview, and holds at every stop', () => {
    expect(tour.duration).toBeGreaterThanOrEqual(20);
    expect(tour.duration).toBeLessThanOrEqual(30);
    expect(tour.stops[0].position).toEqual(tour.stops.at(-1)!.position);
    expect(tour.stops.slice(0, -1).every((stop) => stop.hold >= 0.8)).toBe(true);
  });

  it('stays clear of every collider, wall, floor and the ceiling at every point, not only the stops', () => {
    for (const t of samples) {
      const { position } = path.sample(t);
      expect(pointClear(world, position, PATH_MARGIN), `t = ${t.toFixed(2)} s at ${position.toArray().map((v) => v.toFixed(2))}`).toBe(true);
    }
  });

  it('moves and turns at moderate speeds with no jumps', () => {
    let maxSpeed = 0;
    let maxTurn = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = path.sample(samples[i - 1]);
      const b = path.sample(samples[i]);
      maxSpeed = Math.max(maxSpeed, a.position.distanceTo(b.position) / 0.02);
      maxTurn = Math.max(maxTurn, toDegrees(angleBetween(a.orientation, b.orientation)) / 0.02);
      expect(Math.abs(b.orientation.pitch)).toBeLessThan(Math.PI / 3);
    }
    expect(maxSpeed).toBeLessThan(3.5);
    expect(maxTurn).toBeLessThan(60);
  });

  it('keeps standing eye height along the aisle', () => {
    for (const t of samples) {
      const { position, stopIndex, holding } = path.sample(t);
      if (stopIndex !== 3 || holding) continue;
      const floor = floorElevationAt(layout, position.z);
      expect(position.y - floor).toBeGreaterThan(1.3);
      expect(position.y - floor).toBeLessThan(1.9);
    }
  });
});

describe('seat view helper', () => {
  const materials = createSeatMaterials();
  const models = QUALITY_LEVELS.map((level) => createCinemaSeatModel(config, materials, config.quality[level].seat));
  afterAll(() => {
    for (const model of models) model.dispose();
    disposeMaterials(materials);
  });
  const sample = ['A01', 'A06', 'A11', 'F06', 'J01', 'J06', 'J11'];

  it('puts the eye above its own seat, clear of cushion, backrest and headrest, at both levels', () => {
    for (const id of sample) {
      const seat = layout.seatById.get(id)!;
      const pose = seatViewPose(layout, seat);
      const local = new Vector3(pose.position.x, pose.position.y, pose.position.z).applyMatrix4(seatPivotMatrix(seat).invert());
      for (const model of models) {
        for (const { name, bounds } of model.components) expect(bounds.containsPoint(local), `${id} ${name}`).toBe(false);
        const cushion = model.components.find((c) => c.name === 'cushion')!.bounds;
        expect(local.y).toBeGreaterThan(cushion.max.y + 0.5);
        expect(Math.abs(local.x)).toBeLessThan(0.05);
      }
    }
  });

  it('looks at the screen centre and fits the whole picture, except from row A (front-row limitation)', () => {
    const cutOff = (aspect: number) =>
      sample.filter((id) => {
        const pose = seatViewPose(layout, layout.seatById.get(id)!);
        expect(pose.mode).toBe('eye');
        expect(pose.lookAt).toEqual(screen.center);
        const camera = cameraFor(pose, aspect);
        const corners = [screen.picture.x.min, screen.picture.x.max].flatMap((x) => [screen.picture.y.min, screen.picture.y.max].map((y) => ({ x, y, z: screen.center.z })));
        return !corners.every((corner) => visible(camera, corner));
      });
    // Row A is 5.8 m from an 8.5 m wide screen: from its ends (and, on a portrait screen, from
    // anywhere in it) a far corner needs a turn of the head. Every other row fits it in one view.
    expect(cutOff(ASPECTS.desktop)).toEqual(['A01', 'A11']);
    expect(cutOff(ASPECTS.tabletPortrait)).toEqual(['A01', 'A06', 'A11']);
  });

  it('records the front-row viewing angle (a known limitation of the layout)', () => {
    // Upward angle from a row A eye to the top of the picture; comfortable is roughly ≤ 30–35°.
    expect(layout.metrics.firstRowScreenTopAngleDeg).toBeGreaterThan(35);
    expect(layout.metrics.firstRowScreenTopAngleDeg).toBeLessThan(45);
  });
});

describe('preset framing', () => {
  it('keeps FOV reasonable on every screen shape', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const fov = fovForAspect(config.camera, aspect);
      expect(fov).toBeLessThanOrEqual(config.camera.maxFov);
      expect(horizontalFov(fov, aspect)).toBeLessThanOrEqual(config.camera.maxHorizontalFov + 1e-9);
    }
    expect(fovForAspect(config.camera, ASPECTS.desktop)).toBe(config.camera.fov);
  });

  it('places every experience view inside the room, clear of everything', () => {
    for (const aspect of Object.values(ASPECTS)) {
      for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'experience')) {
        const { position } = computePresetPose(preset.id, layout, aspect);
        const seated = preset.id === 'seatEye' ? new Set(['seats-F']) : undefined;
        expect(pointClear(world, position, 0.2, seated), `${preset.id} @ ${aspect.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('shows the whole picture and part of an aisle in the overview, on every screen shape', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const camera = cameraFor(computePresetPose('overview', layout, aspect), aspect);
      for (const x of [screen.picture.x.min, screen.picture.x.max]) {
        for (const y of [screen.picture.y.min, screen.picture.y.max]) expect(visible(camera, { x, y, z: screen.center.z }), `aspect ${aspect}`).toBe(true);
      }
      const aisleSeen = rows.some((row) => [aisleX, -aisleX].some((x) => visible(camera, { x, y: row.floorY, z: row.seatZ })));
      expect(aisleSeen, `aspect ${aspect}`).toBe(true);
    }
  });

  it('fits the whole floor plan in the plan view, screen at the top in portrait and on the left in landscape', () => {
    expect(CAMERA_PRESETS.find((p) => p.id === 'plan')).toMatchObject({ space: 'inspection', hides: ['ceiling'] });
    for (const aspect of Object.values(ASPECTS)) {
      const camera = cameraFor(computePresetPose('plan', layout, aspect), aspect);
      for (const x of [interior.x.min, interior.x.max]) {
        for (const z of [interior.z.min, interior.z.max]) expect(visible(camera, { x, y: 0, z }), `aspect ${aspect}`).toBe(true);
      }
      const project = (z: number) => new Vector3(0, 0, z).project(camera);
      const screenEnd = project(screen.center.z);
      const backEnd = project(interior.z.max);
      if (aspect < 1) expect(screenEnd.y).toBeGreaterThan(backEnd.y);
      else expect(screenEnd.x).toBeLessThan(backEnd.x);
    }
  });

  it('shows most seats from "Nhìn về ghế": all of them on landscape screens, at least half in portrait', () => {
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const camera = cameraFor(computePresetPose('seats', layout, aspect), aspect);
      const seen = layout.seats.filter((s) => visible(camera, { x: s.position.x, y: s.floorY + 0.5, z: s.position.z })).length;
      expect(seen / layout.seats.length, name).toBeGreaterThanOrEqual(aspect >= 1 ? 0.95 : 0.5);
    }
  });
});
