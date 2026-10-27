import { type BufferGeometry, ExtrudeGeometry, Group, PlaneGeometry, Shape } from 'three';
import { buildBackWall, buildCeiling, buildFrontWall, buildHandrails, buildSideWall } from './interior.ts';
import type { AuditoriumLayout, FloorTread, Range } from './layout.ts';
import type { BlockoutMaterials } from './materials.ts';
import { MeshBatch, type PieceRecord } from './meshBatch.ts';

/** Shell parts that can be hidden to look inside the room; each hides with everything fixed to it. */
export type ToggleablePart = 'ceiling' | 'backWall' | 'rightWall';

/** Materials of the fit-out added in Prompt 03 (everything else is the Prompt 01 room shell). */
export const INTERIOR_MATERIALS: ReadonlySet<string> = new Set([
  'panel',
  'graphite',
  'trim',
  'grille',
  'driver',
  'curtain',
  'projector',
  'lightSlot',
  'exitSign',
]);

export interface Architecture {
  group: Group;
  toggleable: Record<ToggleablePart, Group>;
  /** Every placed piece with its world bounds, measured from the built geometry. */
  pieces: PieceRecord[];
  /** Disposes the geometries created here. Materials (and their textures) belong to the caller. */
  dispose(): void;
}

/**
 * Builds the room: shell, stepped floor and aisles, stage, screen, and the interior fit-out.
 *
 * The scene is split into groups by what each piece is fixed to — floor, screen, ceiling and the
 * four walls — so hiding the ceiling or a wall also hides its beams, panels, speakers, door and so on.
 * Each group is merged into one mesh per material.
 *
 * Solids only ever touch along faces that point in opposite directions (one of the pair is always
 * back-facing or buried), and thin parts are offset from the surfaces behind them, so no two
 * visible surfaces are coplanar.
 */
export function buildArchitecture(layout: AuditoriumLayout, materials: BlockoutMaterials): Architecture {
  const { interior, structure, shell, config } = layout;
  const group = new Group();
  group.name = 'architecture';
  const pieces: PieceRecord[] = [];
  const batch = (name: string) => new MeshBatch(name, materials, pieces);

  const floor = batch('floor');
  floor.addBox('floor', 'carpet', { x: shell.x, y: { min: shell.y.min, max: interior.y.min }, z: shell.z });
  // Stepped floor: one prism for the seat block and one per aisle, all cut from the same row
  // profile, so the aisles step up exactly with the rows. The aisle prisms continue under the
  // side-wall lining to the structural wall, where the handrail posts stand.
  const seatTiers = createSteppedFloorGeometry(layout.treads, layout.seatingZone.x);
  if (seatTiers) floor.add('seat-tiers', 'carpet', seatTiers);
  for (const aisle of layout.aisles) {
    const x = aisle.side === 'left' ? { min: structure.x.min, max: aisle.x.max } : { min: aisle.x.min, max: structure.x.max };
    const steps = createSteppedFloorGeometry(layout.treads, x);
    if (steps) floor.add(`aisle-${aisle.side}`, 'aisle', steps);
  }
  // A contrasting strip on the front edge of every aisle step. It sits on top of the tread,
  // so it never shares a plane with the riser below it.
  const nosing = config.aisles.nosing;
  for (const aisle of layout.aisles) {
    const x =
      aisle.side === 'left'
        ? { min: aisle.x.min + nosing.wallInset, max: aisle.x.max }
        : { min: aisle.x.min, max: aisle.x.max - nosing.wallInset };
    for (const tread of layout.treads) {
      floor.addBox(`aisle-${aisle.side}-nosing-${tread.rowIndex}`, 'aisleNosing', {
        x,
        y: { min: tread.y, max: tread.y + nosing.height },
        z: { min: tread.z.min, max: tread.z.min + nosing.depth },
      });
    }
  }
  floor.addBox('stage', 'stage', layout.stage);
  buildHandrails(floor, layout);

  // Screen: the surface extends slightly behind the frame so no gap shows at the edges.
  const screen = batch('screen');
  const { frame } = config.screen;
  const surface = new PlaneGeometry(layout.screen.width + 2 * frame.overlap, layout.screen.height + 2 * frame.overlap);
  surface.translate(layout.screen.center.x, layout.screen.center.y, layout.screen.center.z);
  screen.add('screen-surface', 'screen', surface);
  const outer = layout.screen.frame;
  const picture = layout.screen.picture;
  screen.addBox('frame-top', 'screenFrame', { x: outer.x, y: { min: picture.y.max, max: outer.y.max }, z: outer.z });
  screen.addBox('frame-bottom', 'screenFrame', { x: outer.x, y: { min: outer.y.min, max: picture.y.min }, z: outer.z });
  screen.addBox('frame-left', 'screenFrame', { x: { min: outer.x.min, max: picture.x.min }, y: picture.y, z: outer.z });
  screen.addBox('frame-right', 'screenFrame', { x: { min: picture.x.max, max: outer.x.max }, y: picture.y, z: outer.z });

  const ceiling = batch('ceiling');
  buildCeiling(ceiling, layout);
  const leftWall = batch('left-wall');
  buildSideWall(leftWall, layout, -1);
  const rightWall = batch('right-wall');
  buildSideWall(rightWall, layout, 1);
  const frontWall = batch('front-wall');
  buildFrontWall(frontWall, layout);
  const backWall = batch('back-wall');
  buildBackWall(backWall, layout);

  const geometries: BufferGeometry[] = [];
  for (const b of [floor, screen, ceiling, leftWall, rightWall, frontWall, backWall]) {
    geometries.push(...b.build(new Set(['exitSign'])));
    group.add(b.group);
  }

  return {
    group,
    toggleable: { ceiling: ceiling.group, backWall: backWall.group, rightWall: rightWall.group },
    pieces,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
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
