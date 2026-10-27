import { Box3, Matrix4, Mesh, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchitecture } from './architecture.ts';
import { CAMERA_PRESETS, computePresetPose, fovForAspect } from './cameraPresets.ts';
import { createAuditoriumLayout, floorElevationAt } from './layout.ts';
import { createBlockoutMaterials, disposeMaterials } from './materials.ts';
import { computeSeatModelBounds, createPlaceholderSeatModel, createSeatInstances, seatPivotMatrix } from './seats.ts';

const layout = createAuditoriumLayout();
const { config, interior, shell } = layout;
const materials = createBlockoutMaterials();
const model = createPlaceholderSeatModel(config, materials);
const architecture = buildArchitecture(layout, materials);

afterAll(() => {
  architecture.dispose();
  model.dispose();
  disposeMaterials(materials);
});

const EPS = 1e-6;
// Geometry and instance matrices are stored as Float32, so compare them to ~1 µm.
const GPU_DIGITS = 6;
const toBox3 = (b: typeof interior) => new Box3(new Vector3(b.x.min, b.y.min, b.z.min), new Vector3(b.x.max, b.y.max, b.z.max));
const expandedBy = (box: Box3) => box.clone().expandByScalar(EPS);

describe('placeholder seat model', () => {
  const bounds = computeSeatModelBounds(model);

  it('stands on the floor at its pivot', () => {
    expect(bounds.min.y).toBeCloseTo(0, GPU_DIGITS);
  });

  it('fits inside the footprint', () => {
    expect(bounds.min.x).toBeGreaterThanOrEqual(-config.seat.footprintWidth / 2);
    expect(bounds.max.x).toBeLessThanOrEqual(config.seat.footprintWidth / 2);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-config.seat.footprintDepth / 2);
    expect(bounds.max.z).toBeLessThanOrEqual(config.seat.footprintDepth / 2);
  });

  it('faces -Z: the backrest is behind the cushion', () => {
    const centreZ = (name: string) => {
      const part = model.parts.find((p) => p.name === name)!;
      return new Vector3().setFromMatrixPosition(part.matrix).z;
    };
    expect(centreZ('backrest')).toBeGreaterThan(centreZ('cushion'));
  });

  it('shares geometry between mirrored parts', () => {
    const geometries = new Set(model.parts.map((p) => p.geometry));
    expect(geometries.size).toBeLessThan(model.parts.length);
  });
});

describe('seat instances', () => {
  const instances = createSeatInstances(model, layout.seats);
  afterAll(() => instances.dispose());

  it('creates one instanced mesh per part with one instance per seat', () => {
    expect(instances.meshes).toHaveLength(model.parts.length);
    for (const mesh of instances.meshes) expect(mesh.count).toBe(110);
  });

  it('places every seat on its floor, inside the seating zone', () => {
    const bounds = computeSeatModelBounds(model);
    const zone = new Box3(
      new Vector3(layout.seatingZone.x.min, 0, layout.seatingZone.z.min),
      new Vector3(layout.seatingZone.x.max, interior.y.max, layout.seatingZone.z.max),
    );
    const pivot = new Matrix4();
    for (const seat of layout.seats) {
      const world = bounds.clone().applyMatrix4(seatPivotMatrix(seat, pivot));
      expect(world.min.y).toBeCloseTo(seat.floorY, GPU_DIGITS);
      expect(expandedBy(zone).containsBox(world)).toBe(true);
      // The floor under both ends of the seat is the seat's own row floor.
      expect(floorElevationAt(layout, world.min.z + 1e-4)).toBeCloseTo(seat.floorY, 9);
      expect(floorElevationAt(layout, world.max.z - 1e-4)).toBeCloseTo(seat.floorY, 9);
    }
  });

  it('uses instance i for seats[i]', () => {
    const matrix = new Matrix4();
    const mesh = instances.meshes[0];
    const part = model.parts[0];
    for (const seat of [layout.seats[0], layout.seats[57], layout.seats[109]]) {
      mesh.getMatrixAt(seat.index, matrix);
      const expected = seatPivotMatrix(seat).multiply(part.matrix);
      matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], GPU_DIGITS));
    }
  });
});

describe('architecture', () => {
  const meshes: Mesh[] = [];
  architecture.group.updateMatrixWorld(true);
  architecture.group.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  const shellNames = new Set(['floor', 'ceiling', 'wall-left', 'wall-right', 'wall-front', 'wall-back']);

  it('keeps the shell around the clear interior', () => {
    for (const mesh of meshes.filter((m) => shellNames.has(m.name))) {
      const box = new Box3().setFromObject(mesh);
      expect(expandedBy(toBox3(shell)).containsBox(box)).toBe(true);
      // Shell solids may touch the interior but never reach into it.
      const inside = toBox3(interior).intersect(box);
      const size = inside.isEmpty() ? new Vector3() : inside.getSize(new Vector3());
      expect(Math.min(size.x, size.y, size.z)).toBeLessThan(EPS);
    }
  });

  it('keeps every other element inside the room', () => {
    const others = meshes.filter((m) => !shellNames.has(m.name));
    expect(others.length).toBeGreaterThan(10);
    for (const mesh of others) {
      expect(expandedBy(toBox3(interior)).containsBox(new Box3().setFromObject(mesh))).toBe(true);
    }
  });

  it('builds the stepped floor up to the last row elevation', () => {
    const tiers = meshes.find((m) => m.name === 'seat-tiers')!;
    const box = new Box3().setFromObject(tiers);
    expect(box.max.y).toBeCloseTo(layout.metrics.lastRowFloorY, GPU_DIGITS);
    expect(box.min.x).toBeCloseTo(layout.seatingZone.x.min, GPU_DIGITS);
    expect(box.max.x).toBeCloseTo(layout.seatingZone.x.max, GPU_DIGITS);
    expect(box.max.z).toBeCloseTo(interior.z.max, GPU_DIGITS);
    for (const side of ['left', 'right']) {
      const aisle = meshes.find((m) => m.name === `aisle-${side}`)!;
      expect(new Box3().setFromObject(aisle).max.y).toBeCloseTo(layout.metrics.lastRowFloorY, GPU_DIGITS);
    }
  });

  it('sets the screen surface between the frame faces so they are never coplanar', () => {
    const surface = meshes.find((m) => m.name === 'screen-surface')!;
    const frame = layout.screen.frame;
    expect(surface.position.z).toBeGreaterThan(frame.z.min);
    expect(surface.position.z).toBeLessThan(frame.z.max);
  });

  it('exposes the ceiling, back wall and right wall for hiding', () => {
    expect(architecture.toggleable.ceiling.name).toBe('ceiling');
    expect(architecture.toggleable.backWall.name).toBe('wall-back');
    expect(architecture.toggleable.rightWall.name).toBe('wall-right');
  });
});

describe('camera presets', () => {
  const aspects = [16 / 9, 4 / 3, 820 / 1180, 390 / 844];

  it('widens the vertical FOV on narrow screens within limits', () => {
    expect(fovForAspect(config, 16 / 9)).toBe(config.camera.fov);
    const portrait = fovForAspect(config, 390 / 844);
    expect(portrait).toBeGreaterThan(config.camera.fov);
    expect(portrait).toBeLessThanOrEqual(config.camera.maxFov);
  });

  it('keeps inside presets inside the room, above the floor and below the ceiling', () => {
    for (const aspect of aspects) {
      for (const id of ['overview', 'seats', 'seatEye'] as const) {
        const { position, lookAt } = computePresetPose(id, layout, aspect);
        expect(position.x).toBeGreaterThan(interior.x.min);
        expect(position.x).toBeLessThan(interior.x.max);
        expect(position.z).toBeGreaterThan(interior.z.min);
        expect(position.z).toBeLessThan(interior.z.max);
        expect(position.y).toBeGreaterThan(floorElevationAt(layout, position.z) + 1);
        expect(position.y).toBeLessThan(interior.y.max - 0.3);
        expect(Number.isFinite(lookAt.x + lookAt.y + lookAt.z)).toBe(true);
      }
    }
  });

  it('places the overview camera behind the last row, looking towards the screen', () => {
    const { position, lookAt } = computePresetPose('overview', layout, 16 / 9);
    expect(position.z).toBeGreaterThan(layout.rows.at(-1)!.seatZ + config.seat.footprintDepth / 2);
    expect(lookAt.z).toBeLessThan(position.z);
  });

  it('puts the seat-eye camera at F06, 1.15 m above its floor, looking at the screen', () => {
    const seat = layout.seatById.get('F06')!;
    const { position, lookAt, mode } = computePresetPose('seatEye', layout, 16 / 9);
    expect(mode).toBe('eye');
    expect(position.x).toBeCloseTo(seat.position.x, 9);
    expect(position.y).toBeCloseTo(seat.floorY + 1.15, 9);
    expect(lookAt).toEqual(layout.screen.center);
  });

  it('frames the side section from outside the hidden right wall', () => {
    expect(CAMERA_PRESETS.find((p) => p.id === 'side')!.hides).toContain('rightWall');
    for (const aspect of aspects) {
      const { position } = computePresetPose('side', layout, aspect);
      expect(position.x).toBeGreaterThan(shell.x.max);
      expect(Math.hypot(position.x, position.y - 3.25, position.z)).toBeLessThan(60);
    }
  });
});
