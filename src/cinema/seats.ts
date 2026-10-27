import {
  Box3,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { AuditoriumConfig } from './config.ts';
import type { SeatData } from './layout.ts';
import type { BlockoutMaterials } from './materials.ts';

/**
 * Seat model contract (kept stable for Prompt 02's detailed seat):
 * - Pivot at the centre of the footprint, on the floor surface (local Y = 0 touches the floor).
 * - The seat faces local -Z; the backrest is towards local +Z.
 * - Everything fits inside `config.seat.footprintWidth × footprintDepth`, centred on the pivot.
 *
 * A model is a list of parts. Each part becomes one InstancedMesh with one instance per seat,
 * so swapping the model never touches the layout.
 */
export interface SeatModelPart {
  name: string;
  geometry: BufferGeometry;
  material: Material;
  /** Part transform in seat-local space. */
  matrix: Matrix4;
}

export interface SeatModel {
  name: string;
  parts: SeatModelPart[];
  /** Disposes geometries owned by the model. Materials are shared and owned by the caller. */
  dispose(): void;
}

export function createPlaceholderSeatModel(
  config: AuditoriumConfig,
  materials: Pick<BlockoutMaterials, 'seatUpholstery' | 'seatFrame'>,
): SeatModel {
  const { cushion, backrest, standard } = config.seat.placeholder;

  const cushionGeometry = new BoxGeometry(cushion.width, cushion.thickness, cushion.depth);
  const backrestGeometry = new BoxGeometry(backrest.width, backrest.height, backrest.thickness);
  const standardGeometry = new BoxGeometry(standard.thickness, standard.height, standard.depth);

  // The backrest hinges about its bottom edge and reclines towards +Z (the back of the seat).
  const backrestMatrix = new Matrix4()
    .makeTranslation(0, backrest.bottomHeight, backrest.baseZ)
    .multiply(new Matrix4().makeRotationX((backrest.reclineDeg * Math.PI) / 180))
    .multiply(new Matrix4().makeTranslation(0, backrest.height / 2, 0));

  const parts: SeatModelPart[] = [
    {
      name: 'cushion',
      geometry: cushionGeometry,
      material: materials.seatUpholstery,
      matrix: new Matrix4().makeTranslation(0, cushion.topHeight - cushion.thickness / 2, cushion.frontZ + cushion.depth / 2),
    },
    { name: 'backrest', geometry: backrestGeometry, material: materials.seatUpholstery, matrix: backrestMatrix },
    {
      name: 'standard-left',
      geometry: standardGeometry,
      material: materials.seatFrame,
      matrix: new Matrix4().makeTranslation(-standard.centerX, standard.height / 2, standard.centerZ),
    },
    {
      name: 'standard-right',
      geometry: standardGeometry,
      material: materials.seatFrame,
      matrix: new Matrix4().makeTranslation(standard.centerX, standard.height / 2, standard.centerZ),
    },
  ];

  return {
    name: 'placeholder',
    parts,
    dispose() {
      for (const geometry of new Set(parts.map((part) => part.geometry))) geometry.dispose();
    },
  };
}

/** Seat-local bounding box of a model; used to check it against the footprint contract. */
export function computeSeatModelBounds(model: SeatModel): Box3 {
  const bounds = new Box3();
  const partBounds = new Box3();
  for (const part of model.parts) {
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    partBounds.copy(part.geometry.boundingBox!).applyMatrix4(part.matrix);
    bounds.union(partBounds);
  }
  return bounds;
}

const Y_AXIS = new Vector3(0, 1, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);

/** World transform of a seat pivot: translate to the pivot, then turn by the seat's yaw. */
export function seatPivotMatrix(seat: SeatData, target = new Matrix4()): Matrix4 {
  return target.compose(
    new Vector3(seat.position.x, seat.position.y, seat.position.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, seat.yaw),
    UNIT_SCALE,
  );
}

export interface SeatInstances {
  group: Group;
  /** One mesh per model part; instance `i` of every mesh is `seats[i]`. */
  meshes: InstancedMesh[];
  /** Releases the instance buffers. Geometry and materials belong to the model / caller. */
  dispose(): void;
}

export function createSeatInstances(model: SeatModel, seats: SeatData[]): SeatInstances {
  const group = new Group();
  group.name = `seats-${model.name}`;

  const pivot = new Matrix4();
  const world = new Matrix4();
  const meshes = model.parts.map((part) => {
    const mesh = new InstancedMesh(part.geometry, part.material, seats.length);
    mesh.name = `seat-${part.name}`;
    mesh.userData.seatPart = part.name;
    seats.forEach((seat, i) => {
      seatPivotMatrix(seat, pivot);
      mesh.setMatrixAt(i, world.multiplyMatrices(pivot, part.matrix));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  });

  return {
    group,
    meshes,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}
