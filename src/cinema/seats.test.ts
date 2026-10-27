import { Box3, type BufferGeometry, Matrix4, Mesh, Raycaster, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuditoriumLayout, floorElevationAt, seatEyePosition, type SeatData } from './layout.ts';
import { createSeatMaterials, disposeMaterials } from './materials.ts';
import { QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import { computeSeatModelBounds, createCinemaSeatModel, createSeatInstances, seatPivotMatrix, type SeatModel } from './seats.ts';

const layout = createAuditoriumLayout();
const { config, interior } = layout;
const materials = createSeatMaterials();
const models = Object.fromEntries(
  QUALITY_LEVELS.map((level) => [level, createCinemaSeatModel(config, materials, config.quality[level].seat)]),
) as Record<QualityLevel, SeatModel>;
const model = models.high;
const bounds = computeSeatModelBounds(model);

afterAll(() => {
  for (const level of QUALITY_LEVELS) models[level].dispose();
  disposeMaterials(materials);
});

// Geometry and instance matrices are stored as Float32, so compare them to ~1 µm.
const GPU_DIGITS = 6;
const EPS = 1e-6;
const componentOf = (seatModel: SeatModel, name: string) => {
  const found = seatModel.components.find((c) => c.name === name);
  if (!found) throw new Error(`No seat component "${name}"`);
  return found.bounds;
};
const worldBounds = (seat: SeatData) => bounds.clone().applyMatrix4(seatPivotMatrix(seat));
const triangles = (seatModel: SeatModel) => seatModel.parts.reduce((sum, part) => sum + part.geometry.index!.count / 3, 0);

/** Seat-local positions of every vertex of a part. */
function partVertices(seatModel: SeatModel, name: string): Vector3[] {
  const geometry = seatModel.parts.find((p) => p.name === name)!.geometry;
  const position = geometry.attributes.position;
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
}

// Both quality levels build the same seat design at different segment counts; every shape check
// applies to both.
describe.each(QUALITY_LEVELS)('cinema seat model (%s)', (level) => {
  const model = models[level];
  const bounds = computeSeatModelBounds(model);
  const component = (name: string) => componentOf(model, name);

  it('stands on the floor at its pivot, and only the feet touch it', () => {
    expect(bounds.min.y).toBeCloseTo(0, GPU_DIGITS);
    const touching = model.components.filter((c) => c.bounds.min.y < 1e-4).map((c) => c.name);
    expect(touching.sort()).toEqual(['foot-plate-left', 'foot-plate-right', 'standard-left', 'standard-right']);
  });

  it('fits inside the footprint, including the reclined backrest, armrests and cup holder', () => {
    const halfWidth = config.seat.footprintWidth / 2;
    const halfDepth = config.seat.footprintDepth / 2;
    for (const { name, bounds: b } of [{ name: 'model', bounds }, ...model.components]) {
      expect(b.min.x, name).toBeGreaterThanOrEqual(-halfWidth);
      expect(b.max.x, name).toBeLessThanOrEqual(halfWidth);
      expect(b.min.z, name).toBeGreaterThanOrEqual(-halfDepth);
      expect(b.max.z, name).toBeLessThanOrEqual(halfDepth);
      expect(b.min.y, name).toBeGreaterThanOrEqual(-EPS);
    }
  });

  it('has the proportions of a standard cinema seat (measured from the geometry)', () => {
    const size = bounds.getSize(new Vector3());
    const cushion = component('cushion');
    expect(size.x).toBeGreaterThanOrEqual(0.72);
    expect(size.x).toBeLessThanOrEqual(0.76);
    expect(size.z).toBeLessThanOrEqual(0.75);
    expect(size.y).toBeGreaterThanOrEqual(1.05);
    expect(size.y).toBeLessThanOrEqual(1.15);
    expect(cushion.max.y).toBeGreaterThanOrEqual(0.43);
    expect(cushion.max.y).toBeLessThanOrEqual(0.47);
    expect(cushion.max.x - cushion.min.x).toBeGreaterThanOrEqual(0.48);
    expect(cushion.max.x - cushion.min.x).toBeLessThanOrEqual(0.52);
  });

  it('faces -Z with the backrest leaning back towards +Z', () => {
    const centreZ = (name: string) => component(name).getCenter(new Vector3()).z;
    expect(centreZ('cushion')).toBeLessThan(centreZ('lumbar'));
    expect(centreZ('lumbar')).toBeLessThan(centreZ('headrest'));
    // The rear cover's top is further back than its bottom.
    const shell = partVertices(model, 'shell');
    const meanZ = (points: Vector3[]) => points.reduce((sum, p) => sum + p.z, 0) / points.length;
    const top = shell.filter((p) => p.y > component('backrest-shell').max.y - 0.1);
    const bottom = shell.filter((p) => p.y < component('backrest-shell').min.y + 0.1);
    expect(meanZ(top)).toBeGreaterThan(meanZ(bottom) + 0.05);
    // Armrest fronts and the cup holder are at the front of the seat.
    expect(model.cupHolder.center.z).toBeLessThan(0);
  });

  it('has two armrests, one each side of the cushion, clear of it', () => {
    const left = component('armrest-left');
    const right = component('armrest-right');
    const cushion = component('cushion');
    expect(left.max.x).toBeLessThan(cushion.min.x);
    expect(right.min.x).toBeGreaterThan(cushion.max.x);
    expect(left.max.y).toBeCloseTo(right.max.y, GPU_DIGITS);
  });

  it('keeps the cup holder open: a ray dropped into it reaches the dark bottom first', () => {
    const meshes = model.parts.map((part) => {
      const mesh = new Mesh(part.geometry, part.material);
      mesh.name = part.name;
      return mesh;
    });
    const { center, radius, depth } = model.cupHolder;
    const raycaster = new Raycaster();
    for (const [dx, dz] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
      const origin = new Vector3(center.x + dx * radius, center.y + 0.5, center.z + dz * radius);
      raycaster.set(origin, new Vector3(0, -1, 0));
      const [hit] = raycaster.intersectObjects(meshes, false);
      expect(hit?.object.name).toBe('cupWell');
      expect(hit.point.y).toBeCloseTo(center.y - depth, 3);
    }
  });

  it('has consistent winding and normals on every triangle', () => {
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const face = new Vector3();
    const edge = new Vector3();
    const normal = new Vector3();
    for (const part of model.parts) {
      const { index, attributes } = part.geometry as BufferGeometry & { index: NonNullable<BufferGeometry['index']> };
      const { position, normal: normals } = attributes;
      for (let i = 0; i < normals.count; i++) {
        expect(Math.abs(normal.fromBufferAttribute(normals, i).length() - 1)).toBeLessThan(1e-3);
      }
      let degenerate = 0;
      let flipped = 0;
      for (let t = 0; t < index.count; t += 3) {
        const [i0, i1, i2] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        a.fromBufferAttribute(position, i0);
        b.fromBufferAttribute(position, i1);
        c.fromBufferAttribute(position, i2);
        face.subVectors(b, a).cross(edge.subVectors(c, a));
        if (face.lengthSq() < 1e-20) {
          degenerate++;
          continue;
        }
        normal.fromBufferAttribute(normals, i0);
        normal.add(edge.fromBufferAttribute(normals, i1)).add(edge.fromBufferAttribute(normals, i2));
        if (face.dot(normal) <= 0) flipped++;
      }
      expect({ part: part.name, degenerate, flipped }).toEqual({ part: part.name, degenerate: 0, flipped: 0 });
    }
  });

  it('keeps the seated eye clear of its own seat', () => {
    const seat = layout.seatById.get('F06')!;
    const eye = seatEyePosition(layout, seat);
    const local = new Vector3(eye.x, eye.y, eye.z).applyMatrix4(seatPivotMatrix(seat).invert());
    for (const { name, bounds: b } of model.components) expect(b.containsPoint(local), name).toBe(false);
  });

  it('merges pieces into one geometry per material', () => {
    expect(model.parts.map((p) => p.name)).toEqual(['upholstery', 'shell', 'frame', 'metal', 'cupWell']);
    expect(new Set(model.parts.map((p) => p.geometry)).size).toBe(model.parts.length);
    expect(model.parts.map((p) => p.material)).toEqual([
      materials.upholstery,
      materials.shell,
      materials.frame,
      materials.metal,
      materials.cupWell,
    ]);
    for (const part of model.parts) expect(part.matrix.equals(new Matrix4())).toBe(true);
  });
});

describe('economy seat level of detail', () => {
  const high = models.high;
  const economy = models.economy;

  it('has the same components as the high level', () => {
    expect(economy.components.map((c) => c.name)).toEqual(high.components.map((c) => c.name));
  });

  it('keeps every component within 1 cm of its high-level bounds, so the silhouette does not change', () => {
    for (const { name, bounds: b } of high.components) {
      const e = componentOf(economy, name);
      for (const key of ['min', 'max'] as const) {
        for (const axis of ['x', 'y', 'z'] as const) expect(Math.abs(e[key][axis] - b[key][axis]), `${name}.${key}.${axis}`).toBeLessThanOrEqual(0.01);
      }
    }
    const e = computeSeatModelBounds(economy);
    expect(e.min.y).toBeCloseTo(0, GPU_DIGITS);
    expect(e.getSize(new Vector3()).distanceTo(bounds.getSize(new Vector3()))).toBeLessThanOrEqual(0.01);
  });

  it('uses at most half the triangles of the high level', () => {
    expect(triangles(economy)).toBeLessThanOrEqual(triangles(high) / 2);
  });

  it('maps instance i to seats[i] at the same positions as the high level', () => {
    const instances = createSeatInstances(economy, layout.seats);
    const matrix = new Matrix4();
    const position = new Vector3();
    try {
      expect(instances.meshes).toHaveLength(economy.parts.length);
      for (const mesh of instances.meshes) {
        expect(mesh.count).toBe(110);
        layout.seats.forEach((seat, i) => {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          expect(position.distanceTo(new Vector3(seat.position.x, seat.position.y, seat.position.z))).toBeLessThan(EPS);
        });
      }
      expect(layout.seats.map((_, i) => instances.seatForInstance(i)?.id)).toEqual(layout.seats.map((s) => s.id));
    } finally {
      instances.dispose();
    }
  });
});

describe('seat instances', () => {
  const instances = createSeatInstances(model, layout.seats);
  afterAll(() => instances.dispose());

  it('creates one instanced mesh per part with one instance per seat, sharing the model resources', () => {
    expect(instances.meshes).toHaveLength(model.parts.length);
    instances.meshes.forEach((mesh, i) => {
      expect(mesh.count).toBe(110);
      expect(mesh.geometry).toBe(model.parts[i].geometry);
      expect(mesh.material).toBe(model.parts[i].material);
    });
  });

  it('places every seat on its floor, inside the seating zone', () => {
    const zone = new Box3(
      new Vector3(layout.seatingZone.x.min, 0, layout.seatingZone.z.min),
      new Vector3(layout.seatingZone.x.max, interior.y.max, layout.seatingZone.z.max),
    );
    for (const seat of layout.seats) {
      const world = worldBounds(seat);
      expect(world.min.y).toBeCloseTo(seat.floorY, GPU_DIGITS);
      expect(zone.clone().expandByScalar(EPS).containsBox(world)).toBe(true);
      // The floor under both ends of the seat is the seat's own row floor.
      expect(floorElevationAt(layout, world.min.z + 1e-4)).toBeCloseTo(seat.floorY, 9);
      expect(floorElevationAt(layout, world.max.z - 1e-4)).toBeCloseTo(seat.floorY, 9);
      for (const aisle of layout.aisles) expect(world.max.x <= aisle.x.min || world.min.x >= aisle.x.max).toBe(true);
    }
  });

  it('leaves a gap between neighbouring seats and between rows', () => {
    for (const row of layout.rows) {
      const rowSeats = layout.seats.filter((s) => s.rowIndex === row.index);
      for (let i = 1; i < rowSeats.length; i++) {
        const gap = worldBounds(rowSeats[i]).min.x - worldBounds(rowSeats[i - 1]).max.x;
        expect(gap).toBeGreaterThanOrEqual(0.02);
      }
    }
    for (let r = 1; r < layout.rows.length; r++) {
      const front = layout.seats.find((s) => s.rowIndex === r - 1 && s.seatNumber === 6)!;
      const back = layout.seats.find((s) => s.rowIndex === r && s.seatNumber === 6)!;
      expect(worldBounds(back).min.z - worldBounds(front).max.z).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('keeps the last row clear of the ceiling', () => {
    const last = layout.seats.at(-1)!;
    expect(worldBounds(last).max.y).toBeLessThan(interior.y.max - 3);
  });

  it('maps instance i of every part to seats[i]', () => {
    const matrix = new Matrix4();
    const position = new Vector3();
    for (const mesh of instances.meshes) {
      layout.seats.forEach((seat, i) => {
        mesh.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        expect(position.x).toBeCloseTo(seat.position.x, GPU_DIGITS);
        expect(position.y).toBeCloseTo(seat.position.y, GPU_DIGITS);
        expect(position.z).toBeCloseTo(seat.position.z, GPU_DIGITS);
      });
    }
    expect(layout.seats.map((_, i) => instances.seatForInstance(i)?.id)).toEqual(layout.seats.map((s) => s.id));
    expect(instances.seatForInstance(110)).toBeUndefined();
  });

  it('bounds every instance so frustum culling never drops a seat', () => {
    const matrix = new Matrix4();
    const point = new Vector3();
    for (const mesh of instances.meshes) {
      const sphere = mesh.boundingSphere!;
      const position = mesh.geometry.attributes.position;
      let worst = -Infinity;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        for (let v = 0; v < position.count; v++) {
          worst = Math.max(worst, sphere.distanceToPoint(point.fromBufferAttribute(position, v).applyMatrix4(matrix)));
        }
      }
      expect(worst, mesh.name).toBeLessThanOrEqual(1e-4);
    }
  });
});

describe('seat resource ownership', () => {
  it('disposes each shared geometry and material exactly once', () => {
    const ownMaterials = createSeatMaterials();
    const ownModel: SeatModel = createCinemaSeatModel(config, ownMaterials);
    const counts = new Map<object, number>();
    const track = (resource: { addEventListener(type: 'dispose', listener: () => void): void }) =>
      resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
    for (const part of ownModel.parts) track(part.geometry);
    for (const material of Object.values(ownMaterials)) track(material);

    const own = createSeatInstances(ownModel, layout.seats);
    own.dispose();
    expect(counts.size).toBe(0);

    ownModel.dispose();
    disposeMaterials(ownMaterials);
    expect([...counts.values()]).toEqual(Array(ownModel.parts.length + Object.keys(ownMaterials).length).fill(1));
  });
});
