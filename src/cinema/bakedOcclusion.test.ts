import { type Mesh, NoColorSpace, RedFormat } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchitecture } from './architecture.ts';
import { applyBakedOcclusion, createFloorOcclusion } from './bakedOcclusion.ts';
import { createAuditoriumLayout } from './layout.ts';
import { createBlockoutMaterials, disposeMaterials } from './materials.ts';

const layout = createAuditoriumLayout();
const { structure, stage } = layout;
const materials = createBlockoutMaterials();
const architecture = buildArchitecture(layout, materials);
const floor = createFloorOcclusion(layout);
applyBakedOcclusion(layout, architecture, materials, floor);

afterAll(() => {
  architecture.dispose();
  disposeMaterials(materials);
});

const meshes = (material: string) => {
  const found: Mesh[] = [];
  architecture.group.traverse((o) => {
    if ((o as Mesh).isMesh && o.userData.material === material) found.push(o as Mesh);
  });
  return found;
};
const aisleX = (layout.aisles[0].x.min + layout.aisles[0].x.max) / 2;

describe('floor occlusion', () => {
  it('is a linear single-channel texture read through the second texture coordinate', () => {
    expect(floor.texture.format).toBe(RedFormat);
    expect(floor.texture.colorSpace).toBe(NoColorSpace);
    expect(floor.texture.channel).toBe(1);
  });

  it('darkens the floor under every seat and leaves open floor alone', () => {
    for (const seat of layout.seats) expect(floor.sample(seat.position.x, seat.position.z)).toBeLessThan(0.55);
    // The cross aisle between the stage and row A, and the middle of the side aisles.
    const front = (stage.z.max + layout.treads[0].z.min) / 2;
    expect(floor.sample(0, front - 0.6)).toBeGreaterThan(0.97);
    for (const tread of layout.treads) expect(floor.sample(aisleX, (tread.z.min + tread.z.max) / 2)).toBeGreaterThan(0.95);
  });

  it('darkens the foot of each riser, the wall bases and the stage foot, softly', () => {
    for (const tread of layout.treads) {
      const foot = floor.sample(aisleX, tread.z.min - 0.02);
      expect(foot).toBeLessThan(0.82);
      expect(foot).toBeGreaterThan(0.5);
      expect(floor.sample(aisleX, tread.z.min - 0.3)).toBeGreaterThan(0.95);
    }
    expect(floor.sample(structure.x.min + 0.02, 0)).toBeLessThan(0.8);
    expect(floor.sample(structure.x.max - 0.02, 0)).toBeLessThan(0.8);
    expect(floor.sample(0, stage.z.max + 0.02)).toBeLessThan(0.82);
    expect(floor.sample(0, stage.z.max + 0.5)).toBeGreaterThan(0.97);
  });
});

describe('applying the baked occlusion', () => {
  it('gives every floor mesh a plan coordinate, and its material the occlusion', () => {
    const sizeX = structure.x.max - structure.x.min;
    const sizeZ = structure.z.max - structure.z.min;
    for (const name of ['carpet', 'aisle', 'stage'] as const) {
      expect(materials[name].aoMap).toBe(floor.texture);
      const found = meshes(name);
      expect(found.length).toBeGreaterThan(0);
      for (const mesh of found) {
        const position = mesh.geometry.getAttribute('position');
        const uv1 = mesh.geometry.getAttribute('uv1');
        expect(uv1.count).toBe(position.count);
        // 0–1 across the structure (the slab runs on under the walls, where the edge texel repeats).
        for (let i = 0; i < uv1.count; i++) {
          expect(structure.x.min + uv1.getX(i) * sizeX).toBeCloseTo(position.getX(i), 4);
          expect(structure.z.min + uv1.getY(i) * sizeZ).toBeCloseTo(position.getZ(i), 4);
        }
      }
    }
  });

  it('shades the backs of the curtain folds darker than the crests', () => {
    expect(materials.curtain.vertexColors).toBe(true);
    const [mesh] = meshes('curtain');
    const position = mesh.geometry.getAttribute('position');
    const color = mesh.geometry.getAttribute('color');
    expect(color.count).toBe(position.count);
    let back = { z: Infinity, k: 0 };
    let crest = { z: -Infinity, k: 0 };
    for (let i = 0; i < position.count; i++) {
      const k = color.getX(i);
      expect(k).toBeGreaterThanOrEqual(0.5);
      expect(k).toBeLessThanOrEqual(1);
      const z = position.getZ(i);
      if (z < back.z) back = { z, k };
      if (z > crest.z) crest = { z, k };
    }
    expect(back.k).toBeLessThan(0.6);
    expect(crest.k).toBe(1);
  });
});
