import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';

/**
 * Room materials: one per surface role, shared by every mesh with that role and disposed by the
 * scene owner. All lit materials are physically based (Standard/Physical) so the area lights reach
 * them. Palette: charcoal walls and ceiling, dark carpet, muted champagne metal, deep red curtains;
 * the wine-red seats stay the main accent.
 *
 * `envMapIntensity` scales the dim, code-generated interior environment (environment.ts):
 * metals use most of it, fabrics almost none.
 */
export function createBlockoutMaterials() {
  const carpetTexture = createCarpetTexture();
  return {
    // Dark, matte carpet with a faint fleck: room floor, seat tiers; the aisles are a step lighter.
    carpet: new MeshStandardMaterial({ color: 0x33292d, map: carpetTexture, roughness: 1, metalness: 0, envMapIntensity: 0.05 }),
    aisle: new MeshStandardMaterial({ color: 0x45393e, map: carpetTexture, roughness: 1, metalness: 0, envMapIntensity: 0.05 }),
    // Low step lights on every aisle nosing; marks the light, does not light the room by itself.
    aisleNosing: new MeshStandardMaterial({ color: 0x2a2219, emissive: 0xffb866, emissiveIntensity: 0.45, roughness: 0.6 }),
    stage: new MeshStandardMaterial({ color: 0x2a2629, roughness: 0.9, metalness: 0, envMapIntensity: 0.1 }),
    // Structural wall faces (seen in the recessed band and bays) and the ceiling slab.
    wall: new MeshStandardMaterial({ color: 0x4a4447, roughness: 0.95, metalness: 0, envMapIntensity: 0.05 }),
    // Acoustic fabric panels: fully matte.
    panel: new MeshStandardMaterial({ color: 0x48454a, roughness: 1, metalness: 0, envMapIntensity: 0.05 }),
    // Matte graphite paint: beams, soffits, skirting, door, speaker cabinets, mounts, valances.
    graphite: new MeshStandardMaterial({ color: 0x38393d, roughness: 0.8, metalness: 0, envMapIntensity: 0.25 }),
    // Dark champagne metal: broad, soft reflections rather than a yellow glow.
    trim: new MeshStandardMaterial({ color: 0x9a8b70, roughness: 0.5, metalness: 0.75, envMapIntensity: 0.6 }),
    grille: new MeshStandardMaterial({ color: 0x141518, roughness: 1, metalness: 0, envMapIntensity: 0 }),
    driver: new MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.45, metalness: 0, envMapIntensity: 0.4 }),
    // Deep red velvet: darker and bluer than the seats; sheen picks the folds out at grazing light.
    curtain: new MeshPhysicalMaterial({
      color: 0x5c0f1b,
      roughness: 0.9,
      metalness: 0,
      sheen: 0.7,
      sheenColor: 0x9a3341,
      sheenRoughness: 0.55,
      envMapIntensity: 0.05,
    }),
    projector: new MeshStandardMaterial({ color: 0x45474d, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.4 }),
    // Marks where the light slots are; the area lights in lighting.ts do the lighting.
    lightSlot: new MeshStandardMaterial({ color: 0x000000, emissive: 0xffc98f, emissiveIntensity: 0.7 }),
    // Unlit and not tone-mapped, so the sign keeps its green and white.
    exitSign: new MeshBasicMaterial({ map: createExitSignTexture(), toneMapped: false }),
    screenFrame: new MeshStandardMaterial({ color: 0x0f1012, roughness: 0.95, metalness: 0, envMapIntensity: 0 }),
    // The brightest surface in the room: unlit, neutral to slightly cool, not tone-mapped.
    screen: new MeshBasicMaterial({ color: 0xd9dfe7, toneMapped: false }),
  } satisfies Record<string, Material>;
}

export type BlockoutMaterials = ReturnType<typeof createBlockoutMaterials>;

/**
 * Seat materials, shared by every seat in the auditorium and by the seat inspector.
 * No textures: the leather look comes from roughness, the cushion shapes and the darker seams
 * (vertex colour on the upholstery).
 */
export function createSeatMaterials() {
  return {
    // Wine-red leather: non-metal, soft broad highlight, never plastic-glossy.
    upholstery: new MeshStandardMaterial({ color: 0x6e1328, roughness: 0.6, metalness: 0, vertexColors: true, envMapIntensity: 0.3 }),
    // Back cover in a deeper, slightly flatter tone of the same leather.
    shell: new MeshStandardMaterial({ color: 0x601226, roughness: 0.68, metalness: 0, envMapIntensity: 0.25 }),
    // Graphite powder coat: matte, so flat faces do not glint at grazing angles.
    frame: new MeshStandardMaterial({ color: 0x25282f, roughness: 0.78, metalness: 0, envMapIntensity: 0.25 }),
    // Exposed dark steel: hubs, foot plates, hinge brackets.
    metal: new MeshStandardMaterial({ color: 0x3d3e43, roughness: 0.38, metalness: 0.85, envMapIntensity: 0.7 }),
    // Dark but not black, so the inside of the cup holder still shows its shape.
    cupWell: new MeshStandardMaterial({ color: 0x151619, roughness: 0.8, metalness: 0, envMapIntensity: 0.1 }),
  } satisfies Record<string, Material>;
}

export type SeatMaterials = ReturnType<typeof createSeatMaterials>;

/** Disposes every material and each texture they use, each exactly once. */
export function disposeMaterials(materials: Record<string, Material>): void {
  const textures = new Set<Texture>();
  for (const material of Object.values(materials)) {
    for (const value of Object.values(material)) {
      if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

/** Carpet tile size in metres; world-space UVs are divided by it (see architecture.ts). */
export const CARPET_TILE = 0.5;

/**
 * Carpet fleck: 128 × 128 RGBA8 (64 KiB, ~85 KiB with mipmaps), tiled every CARPET_TILE metres.
 * Seeded white noise, blurred twice with wrap-around so it tiles, mapped to a narrow near-white band
 * that only modulates the carpet colour by a few percent. Soft and low in contrast so it does not
 * shimmer when the camera moves. Built once per scene; colour data, so sRGB.
 */
export function createCarpetTexture(seed = 0x5eed2604): DataTexture {
  const size = 128;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let field = Float32Array.from({ length: size * size }, random);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += field[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        }
        next[y * size + x] = sum / 9;
      }
    }
    field = next;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(228 + 27 * ((field[i] - min) / (max - min)));
    data.set([v, v, v, 255], i * 4);
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Exit sign face: a white running figure heading for a doorway and an arrow pointing down at the
 * door below, on green. 512 × 256 px for a 0.38 × 0.19 m sign, about 13 px per cm.
 * Outside a browser (unit tests) a 1 × 1 green texture stands in.
 */
function createExitSignTexture(): Texture {
  if (typeof document === 'undefined') {
    const fallback = new DataTexture(new Uint8Array([20, 125, 62, 255]), 1, 1);
    fallback.colorSpace = SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#147d3e';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Doorway.
  g.lineWidth = 10;
  g.strokeRect(232, 40, 92, 176);
  // Running figure heading into the doorway.
  g.beginPath();
  g.arc(150, 62, 20, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 22;
  g.beginPath();
  g.moveTo(140, 92); // torso
  g.lineTo(118, 150);
  g.moveTo(138, 100); // forward arm
  g.lineTo(178, 112);
  g.lineTo(204, 92);
  g.moveTo(134, 102); // back arm
  g.lineTo(98, 118);
  g.lineTo(72, 104);
  g.moveTo(118, 150); // forward leg
  g.lineTo(158, 168);
  g.lineTo(170, 214);
  g.moveTo(118, 150); // back leg
  g.lineTo(96, 190);
  g.lineTo(56, 196);
  g.stroke();

  // Arrow down to the door.
  g.beginPath();
  g.moveTo(400, 36);
  g.lineTo(436, 36);
  g.lineTo(436, 140);
  g.lineTo(476, 140);
  g.lineTo(418, 218);
  g.lineTo(360, 140);
  g.lineTo(400, 140);
  g.closePath();
  g.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
