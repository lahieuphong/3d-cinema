import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Shape,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { AuditoriumLayout, Box, FloorTread, Range } from './layout.ts';
import type { BlockoutMaterials } from './materials.ts';

/** Shell parts that can be hidden to look inside the room. */
export type ToggleablePart = 'ceiling' | 'backWall' | 'rightWall';

export interface Architecture {
  group: Group;
  toggleable: Record<ToggleablePart, Mesh>;
  /** Disposes the geometries created here. Materials belong to the caller. */
  dispose(): void;
}

/**
 * Builds the room blockout: shell, stepped seating floor, side aisles, stage and screen.
 *
 * Solids only ever touch along faces that point in opposite directions (one of the pair is
 * always back-facing or buried), and the screen sits between the frame's front and back faces,
 * so no two visible surfaces are coplanar.
 */
export function buildArchitecture(layout: AuditoriumLayout, materials: BlockoutMaterials): Architecture {
  const { interior, shell, config } = layout;
  const group = new Group();
  group.name = 'architecture';
  const geometries = new Set<BufferGeometry>();

  const addMesh = (name: string, geometry: BufferGeometry, material: Material, parent: Object3D) => {
    geometries.add(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  const addBox = (name: string, box: Box, material: Material, parent: Object3D) => {
    const geometry = new BoxGeometry(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min);
    const mesh = addMesh(name, geometry, material, parent);
    mesh.position.set(mid(box.x), mid(box.y), mid(box.z));
    return mesh;
  };
  const addGroup = (name: string) => {
    const child = new Group();
    child.name = name;
    group.add(child);
    return child;
  };

  // Room shell. Walls sit outside the clear interior; the side walls run the full shell length
  // and the front/back walls fit between them, so no two solids overlap at the corners.
  const roomShell = addGroup('room-shell');
  addBox('floor', { x: shell.x, y: { min: shell.y.min, max: interior.y.min }, z: shell.z }, materials.floor, roomShell);
  const ceiling = addBox('ceiling', { x: shell.x, y: { min: interior.y.max, max: shell.y.max }, z: shell.z }, materials.ceiling, roomShell);
  addBox('wall-left', { x: { min: shell.x.min, max: interior.x.min }, y: interior.y, z: shell.z }, materials.wall, roomShell);
  const rightWall = addBox('wall-right', { x: { min: interior.x.max, max: shell.x.max }, y: interior.y, z: shell.z }, materials.wall, roomShell);
  addBox('wall-front', { x: interior.x, y: interior.y, z: { min: shell.z.min, max: interior.z.min } }, materials.wall, roomShell);
  const backWall = addBox('wall-back', { x: interior.x, y: interior.y, z: { min: interior.z.max, max: shell.z.max } }, materials.wall, roomShell);

  // Stepped floor: one prism for the seat block and one per aisle, all cut from the same row profile,
  // so the aisles step up exactly with the rows.
  const steppedFloor = addGroup('stepped-floor');
  const seatTiers = createSteppedFloorGeometry(layout.treads, layout.seatingZone.x);
  if (seatTiers) addMesh('seat-tiers', seatTiers, materials.tier, steppedFloor);
  for (const aisle of layout.aisles) {
    const aisleSteps = createSteppedFloorGeometry(layout.treads, aisle.x);
    if (aisleSteps) addMesh(`aisle-${aisle.side}`, aisleSteps, materials.aisle, steppedFloor);
  }

  // A contrasting strip on the front edge of every aisle step. It sits on top of the tread,
  // so it never shares a plane with the riser below it.
  const nosing = config.aisles.nosing;
  const nosingGeometry = new BoxGeometry(config.aisles.width - nosing.wallInset, nosing.height, nosing.depth);
  for (const aisle of layout.aisles) {
    const x =
      aisle.side === 'left'
        ? { min: aisle.x.min + nosing.wallInset, max: aisle.x.max }
        : { min: aisle.x.min, max: aisle.x.max - nosing.wallInset };
    for (const tread of layout.treads) {
      const mesh = addMesh(`aisle-${aisle.side}-nosing-${tread.rowIndex}`, nosingGeometry, materials.aisleNosing, steppedFloor);
      mesh.position.set(mid(x), tread.y + nosing.height / 2, tread.z.min + nosing.depth / 2);
    }
  }

  addBox('stage', layout.stage, materials.stage, group);

  // Screen: the surface extends slightly behind the frame so no gap shows at the edges.
  const { screen } = layout;
  const { frame } = config.screen;
  const screenGroup = addGroup('screen');
  const surface = addMesh(
    'screen-surface',
    new PlaneGeometry(screen.width + 2 * frame.overlap, screen.height + 2 * frame.overlap),
    materials.screen,
    screenGroup,
  );
  surface.position.set(screen.center.x, screen.center.y, screen.center.z);

  const outer = screen.frame;
  const picture = screen.picture;
  addBox('frame-top', { x: outer.x, y: { min: picture.y.max, max: outer.y.max }, z: outer.z }, materials.screenFrame, screenGroup);
  addBox('frame-bottom', { x: outer.x, y: { min: outer.y.min, max: picture.y.min }, z: outer.z }, materials.screenFrame, screenGroup);
  addBox('frame-left', { x: { min: outer.x.min, max: picture.x.min }, y: picture.y, z: outer.z }, materials.screenFrame, screenGroup);
  addBox('frame-right', { x: { min: picture.x.max, max: outer.x.max }, y: picture.y, z: outer.z }, materials.screenFrame, screenGroup);

  return {
    group,
    toggleable: { ceiling, backWall, rightWall },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      geometries.clear();
    },
  };
}

/**
 * Extrudes the stepped floor profile (drawn in the Z/Y plane from the tread list) across `x`.
 * Returns null when no row is raised above the room floor.
 */
function createSteppedFloorGeometry(treads: FloorTread[], x: Range): ExtrudeGeometry | null {
  if (treads.length === 0) return null;

  const shape = new Shape();
  shape.moveTo(treads[0].z.min, 0);
  for (const tread of treads) {
    shape.lineTo(tread.z.min, tread.y);
    shape.lineTo(tread.z.max, tread.y);
  }
  shape.lineTo(treads[treads.length - 1].z.max, 0);

  const geometry = new ExtrudeGeometry(shape, { depth: x.max - x.min, bevelEnabled: false });
  // Shape space (u, v, w) → world (Z = u, Y = v, X = -w), then shift so X spans [x.min, x.max].
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(x.max, 0, 0);
  return geometry;
}

function mid(range: Range): number {
  return (range.min + range.max) / 2;
}
