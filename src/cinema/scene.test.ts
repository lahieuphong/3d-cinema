import { Box3, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchitecture } from './architecture.ts';
import { CAMERA_PRESETS, computePresetPose, fovForAspect } from './cameraPresets.ts';
import { createAuditoriumLayout, floorElevationAt } from './layout.ts';
import { createBlockoutMaterials, disposeMaterials } from './materials.ts';

// Seat model and seat instance tests live in seats.test.ts.
const layout = createAuditoriumLayout();
const { config, interior, shell } = layout;
const materials = createBlockoutMaterials();
const architecture = buildArchitecture(layout, materials);

afterAll(() => {
  architecture.dispose();
  disposeMaterials(materials);
});

const EPS = 1e-6;
// Geometry and instance matrices are stored as Float32, so compare them to ~1 µm.
const GPU_DIGITS = 6;
const toBox3 = (b: typeof interior) => new Box3(new Vector3(b.x.min, b.y.min, b.z.min), new Vector3(b.x.max, b.y.max, b.z.max));
const expandedBy = (box: Box3) => box.clone().expandByScalar(EPS);

describe('architecture', () => {
  const piece = (name: string) => {
    const found = architecture.pieces.find((p) => p.name === name);
    if (!found) throw new Error(`No piece "${name}"`);
    return found.bounds;
  };
  const isShell = (name: string) => name === 'floor' || name === 'ceiling' || name.startsWith('wall-');

  it('keeps the shell around the structure, never reaching into it', () => {
    const shellPieces = architecture.pieces.filter((p) => isShell(p.name));
    expect(shellPieces.map((p) => p.name).sort()).toEqual([
      'ceiling',
      'floor',
      'wall-back',
      'wall-front',
      'wall-left-back',
      'wall-left-front',
      'wall-left-lintel',
      'wall-right-back',
      'wall-right-front',
      'wall-right-lintel',
    ]);
    for (const { name, bounds } of shellPieces) {
      expect(expandedBy(toBox3(shell)).containsBox(bounds), name).toBe(true);
      // Shell solids may touch the structure (interior + side lining) but never reach into it.
      const inside = toBox3(layout.structure).intersect(bounds.clone());
      const size = inside.isEmpty() ? new Vector3() : inside.getSize(new Vector3());
      expect(Math.min(size.x, size.y, size.z), name).toBeLessThan(EPS);
    }
  });

  it('keeps every other element inside the structure (door frames pass through the wall)', () => {
    const others = architecture.pieces.filter((p) => !isShell(p.name));
    expect(others.length).toBeGreaterThan(100);
    for (const { name, bounds } of others) {
      const limit = name.startsWith('door-') ? shell : layout.structure;
      expect(expandedBy(toBox3(limit)).containsBox(bounds), name).toBe(true);
    }
  });

  it('builds the stepped floor up to the last row elevation', () => {
    const box = piece('seat-tiers');
    expect(box.max.y).toBeCloseTo(layout.metrics.lastRowFloorY, GPU_DIGITS);
    expect(box.min.x).toBeCloseTo(layout.seatingZone.x.min, GPU_DIGITS);
    expect(box.max.x).toBeCloseTo(layout.seatingZone.x.max, GPU_DIGITS);
    expect(box.max.z).toBeCloseTo(interior.z.max, GPU_DIGITS);
    for (const side of ['left', 'right']) {
      const aisle = piece(`aisle-${side}`);
      expect(aisle.max.y).toBeCloseTo(layout.metrics.lastRowFloorY, GPU_DIGITS);
      // The aisle floor runs on under the wall lining to the structural wall.
      expect(side === 'left' ? aisle.min.x : aisle.max.x).toBeCloseTo(side === 'left' ? layout.structure.x.min : layout.structure.x.max, GPU_DIGITS);
    }
  });

  it('sets the screen surface between the frame faces so they are never coplanar', () => {
    const surface = piece('screen-surface');
    const frame = layout.screen.frame;
    expect(surface.min.z).toBeCloseTo(surface.max.z, GPU_DIGITS);
    expect(surface.min.z).toBeGreaterThan(frame.z.min);
    expect(surface.max.z).toBeLessThan(frame.z.max);
  });

  it('exposes the ceiling, back wall and right wall groups for hiding', () => {
    expect(architecture.toggleable.ceiling.name).toBe('ceiling');
    expect(architecture.toggleable.backWall.name).toBe('back-wall');
    expect(architecture.toggleable.rightWall.name).toBe('right-wall');
  });
});

describe('camera presets', () => {
  const aspects = [16 / 9, 4 / 3, 820 / 1180, 390 / 844];

  it('widens the vertical FOV on narrow screens within limits', () => {
    expect(fovForAspect(config.camera, 16 / 9)).toBe(config.camera.fov);
    const portrait = fovForAspect(config.camera, 390 / 844);
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
