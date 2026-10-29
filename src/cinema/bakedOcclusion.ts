import { BufferAttribute, DataTexture, LinearFilter, LinearMipmapLinearFilter, MathUtils, type Mesh, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import type { Architecture } from './architecture.ts';
import type { AuditoriumLayout } from './layout.ts';
import type { BlockoutMaterials } from './materials.ts';

/** Floor materials that take the occlusion (their meshes get a second, plan-view texture coordinate). */
const FLOOR_MATERIALS = ['carpet', 'aisle', 'stage'] as const;

/** Texture cell size in metres: the shapes are blurred over several cells, so this is plenty. */
const CELL = 0.03;

/** Indirect light left under a seat, and in a concave floor corner (riser foot, wall base, stage foot). */
const SEAT = 0.38;
const CORNER = 0.5;

/** Curtain colour left at the back of a fold, between two crests. */
const FOLD = 0.55;

export interface FloorOcclusion {
  texture: DataTexture;
  /** Test helper: the occlusion factor (1 = open, lower = occluded) at a point of the plan. */
  sample(x: number, z: number): number;
}

/**
 * Ambient occlusion of the room's floors, baked once from the layout into a small single-channel
 * texture over the plan: under every seat, at the foot of every riser, along the walls and around the
 * stage. Applied as an aoMap it darkens only indirect light (the hemisphere's bounce and the
 * environment), which nothing else occludes, so it gives the contact the downlight's shadow map
 * cannot (it is the only light that casts) without doubling that shadow. Same at every quality level:
 * a 0.1 MB texture and one texture fetch.
 */
export function createFloorOcclusion(layout: AuditoriumLayout): FloorOcclusion {
  const { structure, config } = layout;
  const x0 = structure.x.min;
  const z0 = structure.z.min;
  const width = Math.ceil((structure.x.max - x0) / CELL);
  const height = Math.ceil((structure.z.max - z0) / CELL);
  const field = new Float32Array(width * height).fill(1);
  const cx = (x: number) => Math.round((x - x0) / CELL);
  const cz = (z: number) => Math.round((z - z0) / CELL);
  /** Multiplies `value(x, z)` (0–1) into the cells of a plan rectangle. */
  const rect = (xMin: number, xMax: number, zMin: number, zMax: number, value: (x: number, z: number) => number) => {
    for (let j = Math.max(0, cz(zMin)); j < Math.min(height, cz(zMax)); j++) {
      for (let i = Math.max(0, cx(xMin)); i < Math.min(width, cx(xMax)); i++) {
        field[j * width + i] *= value(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL);
      }
    }
  };
  /** From `dark` in a corner (distance 0) up to 1 at `reach`, steep near the corner and flat at the end. */
  const ramp = (distance: number, reach: number, dark: number) => 1 - (1 - dark) * (1 - Math.min(1, Math.max(0, distance / reach))) ** 2;

  // Under each seat: the pan, the back and the standards close the floor off from the room. The
  // footprints are hard-edged, so they are blurred; the corners below are soft already.
  const seatW = config.seat.footprintWidth;
  const seatD = config.seat.footprintDepth;
  for (const seat of layout.seats) {
    const { x, z } = seat.position;
    rect(x - seatW / 2 + 0.04, x + seatW / 2 - 0.04, z - seatD / 2 + 0.06, z + seatD / 2 - 0.02, () => SEAT);
  }
  blur(field, width, height, 3);

  // The foot of every riser: the corner between a tread and the face rising from it.
  const wallX = structure.x.max;
  for (const tread of layout.treads) {
    const riser = tread.z.min;
    rect(x0, wallX, riser - 0.2, riser - 0.005, (_x, z) => ramp(riser - z, 0.2, CORNER));
  }

  // Along the walls (side walls behind the aisles, the back wall) and the front wall beside the stage.
  rect(x0, x0 + 0.25, z0, structure.z.max, (x) => ramp(x - x0, 0.25, CORNER));
  rect(wallX - 0.25, wallX, z0, structure.z.max, (x) => ramp(wallX - x, 0.25, CORNER));
  rect(x0, wallX, structure.z.max - 0.25, structure.z.max, (_x, z) => ramp(structure.z.max - z, 0.25, CORNER));
  rect(x0, wallX, z0, z0 + 0.25, (_x, z) => ramp(z - z0, 0.25, CORNER));

  // The floor around the foot of the stage (its top along the screen wall is the front wall's base).
  const { stage } = layout;
  rect(stage.x.min, stage.x.max, stage.z.max, stage.z.max + 0.2, (_x, z) => ramp(z - stage.z.max, 0.2, CORNER));
  rect(stage.x.min - 0.2, stage.x.min, stage.z.min, stage.z.max, (x) => ramp(stage.x.min - x, 0.2, CORNER));
  rect(stage.x.max, stage.x.max + 0.2, stage.z.min, stage.z.max, (x) => ramp(x - stage.x.max, 0.2, CORNER));

  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, field[i])) * 255);

  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  // Plan coordinates live in the second texture coordinate (uv1); the first one tiles the carpet.
  texture.channel = 1;
  texture.needsUpdate = true;
  texture.name = 'floor-occlusion';
  return {
    texture,
    sample(x, z) {
      const i = Math.min(width - 1, Math.max(0, Math.floor((x - x0) / CELL)));
      const j = Math.min(height - 1, Math.max(0, Math.floor((z - z0) / CELL)));
      return data[j * width + i] / 255;
    },
  };
}

/**
 * Applies the baked occlusion to the built room (its merged meshes are in room space already):
 * - floors (carpet, aisles, stage): a plan coordinate as uv1 (x and z across the structure, 0–1) and
 *   the floor occlusion as their materials' aoMap;
 * - curtains: the backs of the folds darker than the crests, as vertex colour. The folds are what
 *   hides them, from every light, so it is part of the cloth's look rather than of one light.
 */
export function applyBakedOcclusion(layout: AuditoriumLayout, architecture: Architecture, materials: BlockoutMaterials, floor: FloorOcclusion): void {
  const { structure } = layout;
  const curtains = layout.config.interior.curtains;
  const sizeX = structure.x.max - structure.x.min;
  const sizeZ = structure.z.max - structure.z.min;
  architecture.group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if ((FLOOR_MATERIALS as readonly string[]).includes(mesh.userData.material)) {
      const uv1 = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        uv1[i * 2] = (position.getX(i) - structure.x.min) / sizeX;
        uv1[i * 2 + 1] = (position.getZ(i) - structure.z.min) / sizeZ;
      }
      mesh.geometry.setAttribute('uv1', new BufferAttribute(uv1, 2));
    } else if (mesh.userData.material === 'curtain') {
      const color = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        // The fold's half-depth at this height (deeper towards the hem; createDrapeGeometry), and where
        // the point sits in it: -1 at the back of a fold, +1 on a crest.
        const t = 1 - (position.getY(i) - curtains.bottomY) / (curtains.topY - curtains.bottomY);
        const amplitude = (curtains.foldDepth / 2) * (1 + curtains.hemFlare * MathUtils.clamp(t, 0, 1));
        const s = (position.getZ(i) - curtains.centerZ) / amplitude;
        const k = FOLD + (1 - FOLD) * MathUtils.smoothstep(s, -1, 0.6);
        color.fill(k, i * 3, i * 3 + 3);
      }
      mesh.geometry.setAttribute('color', new BufferAttribute(color, 3));
    }
  });
  for (const name of FLOOR_MATERIALS) {
    materials[name].aoMap = floor.texture;
    materials[name].aoMapIntensity = 1;
  }
  materials.curtain.vertexColors = true;
}

/** Three passes of a separable box blur (≈ Gaussian), clamped at the edges; a running sum per line. */
function blur(field: Float32Array, width: number, height: number, radius: number): void {
  const line = new Float32Array(Math.max(width, height));
  const span = 2 * radius + 1;
  // Blurs `count` values starting at `offset`, `stride` apart.
  const pass = (offset: number, stride: number, count: number) => {
    for (let k = 0; k < count; k++) line[k] = field[offset + k * stride];
    const at = (k: number) => line[Math.min(count - 1, Math.max(0, k))];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += at(k);
    for (let k = 0; k < count; k++) {
      field[offset + k * stride] = sum / span;
      sum += at(k + radius + 1) - at(k - radius);
    }
  };
  for (let n = 0; n < 3; n++) {
    for (let j = 0; j < height; j++) pass(j * width, 1, width);
    for (let i = 0; i < width; i++) pass(i, width, height);
  }
}
