import {
  CanvasTexture,
  DataTexture,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';

/**
 * Room materials: one per surface role, shared by every mesh with that role and disposed by the
 * scene owner. Colours follow the interior palette: charcoal walls and ceiling, dark carpet,
 * dark champagne metal, deep red curtains; the wine-red seats stay the main accent.
 * Matte surfaces use Lambert; metal, emissive and textured surfaces use Standard/Basic.
 */
export function createBlockoutMaterials() {
  return {
    // Dark, low-sheen carpet: room floor and seat tiers; the aisles are a step lighter.
    carpet: new MeshLambertMaterial({ color: 0x2b2427 }),
    aisle: new MeshLambertMaterial({ color: 0x3b3236 }),
    aisleNosing: new MeshLambertMaterial({ color: 0xc9a86a }),
    stage: new MeshLambertMaterial({ color: 0x1f1d21 }),
    // Structural wall faces (seen in the recessed band and bays) and the ceiling slab.
    wall: new MeshLambertMaterial({ color: 0x17181b }),
    // Acoustic fabric panels.
    panel: new MeshLambertMaterial({ color: 0x2e2f35 }),
    // Matte graphite: beams, soffits, skirting, door, speaker cabinets, mounts, valances.
    graphite: new MeshStandardMaterial({ color: 0x25262a, roughness: 0.75, metalness: 0 }),
    // Dark champagne metal: inlays, handrails, push bars, thresholds.
    trim: new MeshStandardMaterial({ color: 0x8c7a57, roughness: 0.45, metalness: 0.35 }),
    grille: new MeshLambertMaterial({ color: 0x141518 }),
    driver: new MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.4, metalness: 0 }),
    // Deep red velvet: same family as the seats, darker and bluer, fully matte.
    curtain: new MeshStandardMaterial({ color: 0x5c0f1b, roughness: 0.95, metalness: 0 }),
    projector: new MeshStandardMaterial({ color: 0x45474d, roughness: 0.5, metalness: 0.1 }),
    // Marks where the light slots are; it does not light anything (Prompt 04 adds the lighting).
    lightSlot: new MeshStandardMaterial({ color: 0x000000, emissive: 0xffd8a8, emissiveIntensity: 1.4 }),
    // Unlit so the sign reads as illuminated.
    exitSign: new MeshBasicMaterial({ map: createExitSignTexture() }),
    screenFrame: new MeshLambertMaterial({ color: 0x0f1012 }),
    // Unlit so the screen reads as a bright surface regardless of the room lights.
    screen: new MeshBasicMaterial({ color: 0xf1f1ea }),
  } satisfies Record<string, Material>;
}

export type BlockoutMaterials = ReturnType<typeof createBlockoutMaterials>;

/**
 * Seat materials, shared by every seat in the auditorium and by the seat inspector.
 * No textures: the soft leather look comes from roughness and the cushion shapes.
 */
export function createSeatMaterials() {
  return {
    // Wine-red leather: matte with a soft sheen, never plastic-glossy.
    upholstery: new MeshStandardMaterial({ color: 0x6d1420, roughness: 0.64, metalness: 0 }),
    // Back cover in a deeper tone of the same leather.
    shell: new MeshStandardMaterial({ color: 0x4a0d16, roughness: 0.7, metalness: 0 }),
    // Graphite powder-coat: dark with a slight sheen that spreads rather than glints.
    frame: new MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.62, metalness: 0 }),
    // Dark but not black, so the inside of the cup holder still shows its shape.
    cupWell: new MeshStandardMaterial({ color: 0x151619, roughness: 0.8, metalness: 0 }),
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
