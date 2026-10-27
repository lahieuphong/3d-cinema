import { MeshBasicMaterial, MeshLambertMaterial, type Material } from 'three';

/**
 * Flat blockout materials, one per surface group, so each group reads as a distinct tone.
 * Created once per scene and shared by every mesh in that group; disposed by the scene owner.
 */
export function createBlockoutMaterials() {
  return {
    floor: new MeshLambertMaterial({ color: 0x4a4e55 }),
    wall: new MeshLambertMaterial({ color: 0x70757d }),
    ceiling: new MeshLambertMaterial({ color: 0x7b7f87 }),
    tier: new MeshLambertMaterial({ color: 0x5a5e66 }),
    aisle: new MeshLambertMaterial({ color: 0x8a8e96 }),
    aisleNosing: new MeshLambertMaterial({ color: 0xd8b65a }),
    stage: new MeshLambertMaterial({ color: 0x3c3f45 }),
    screenFrame: new MeshLambertMaterial({ color: 0x1d1e22 }),
    // Unlit so the screen reads as a bright surface regardless of the room lights.
    screen: new MeshBasicMaterial({ color: 0xf1f1ea }),
    seatUpholstery: new MeshLambertMaterial({ color: 0x7a1d24 }),
    seatFrame: new MeshLambertMaterial({ color: 0x2b2c31 }),
  } satisfies Record<string, Material>;
}

export type BlockoutMaterials = ReturnType<typeof createBlockoutMaterials>;

export function disposeMaterials(materials: BlockoutMaterials): void {
  for (const material of Object.values(materials)) material.dispose();
}
