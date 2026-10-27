import { Box3, BoxGeometry, type BufferGeometry, Group, type Material, type Matrix4, Mesh } from 'three';
import type { Box } from './layout.ts';
import { mergePieces } from './seatGeometry.ts';

/** One placed piece of the room, with world-space bounds measured from its geometry. */
export interface PieceRecord {
  name: string;
  group: string;
  material: string;
  bounds: Box3;
}

/**
 * Collects the pieces of one scene group, records each piece's real bounds, then merges them
 * into a single mesh per material. Repeated modules (panels, speakers, beams …) therefore cost one
 * draw call per material per group instead of one per piece.
 */
export class MeshBatch<M extends Record<string, Material>> {
  readonly group: Group;
  private readonly materials: M;
  private readonly records: PieceRecord[];
  private readonly pending = new Map<keyof M & string, BufferGeometry[]>();

  constructor(name: string, materials: M, records: PieceRecord[]) {
    this.group = new Group();
    this.group.name = name;
    this.materials = materials;
    this.records = records;
  }

  /** Takes ownership of `geometry`, transforming it in place by `matrix` when given. */
  add(name: string, material: keyof M & string, geometry: BufferGeometry, matrix?: Matrix4): void {
    if (matrix) geometry.applyMatrix4(matrix);
    geometry.computeBoundingBox();
    this.records.push({ name, group: this.group.name, material, bounds: geometry.boundingBox!.clone() });
    const list = this.pending.get(material) ?? [];
    list.push(geometry);
    this.pending.set(material, list);
  }

  addBox(name: string, material: keyof M & string, box: Box): void {
    const geometry = new BoxGeometry(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min);
    geometry.translate((box.x.min + box.x.max) / 2, (box.y.min + box.y.max) / 2, (box.z.min + box.z.max) / 2);
    this.add(name, material, geometry);
  }

  /**
   * Merges the collected pieces into one mesh per material and adds them to the group.
   * Materials in `keepUv` keep texture coordinates. Returns the merged geometries (owned by the caller).
   */
  build(keepUv: ReadonlySet<string> = new Set()): BufferGeometry[] {
    const built: BufferGeometry[] = [];
    for (const [material, pieces] of this.pending) {
      const geometry = mergePieces(pieces, keepUv.has(material) ? ['position', 'normal', 'uv'] : ['position', 'normal']);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, this.materials[material]);
      mesh.name = `${this.group.name}:${material}`;
      mesh.userData.material = material;
      this.group.add(mesh);
      built.push(geometry);
    }
    this.pending.clear();
    return built;
  }
}
