import { BoxGeometry, type BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, PlaneGeometry, Shape } from 'three';
import { buildBackWall, buildCeiling, buildFrontWall, buildHandrails, buildSideWall } from './interior.ts';
import type { AuditoriumLayout, FloorTread, Range } from './layout.ts';
import { CARPET_TILE, type BlockoutMaterials } from './materials.ts';
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
  const { steps, finish } = architectureSteps(layout, materials);
  for (const step of steps) step();
  return finish();
}

/**
 * The same build as steps, one or two groups each (built and merged), so a caller can let the page
 * respond between them; `finish()` after the last one returns the room.
 */
export function architectureSteps(layout: AuditoriumLayout, materials: BlockoutMaterials): { steps: Array<() => void>; finish(): Architecture } {
  const group = new Group();
  group.name = 'architecture';
  const pieces: PieceRecord[] = [];
  const batch = (name: string) => new MeshBatch(name, materials, pieces);
  const geometries: BufferGeometry[] = [];
  const built = new Map<string, MeshBatch<BlockoutMaterials>>();
  // Each group is merged into one mesh per material as soon as it is complete.
  const done = (...batches: Array<MeshBatch<BlockoutMaterials>>) => {
    for (const b of batches) {
      geometries.push(...b.build(new Set(['exitSign', 'carpet', 'aisle'])));
      group.add(b.group);
      built.set(b.group.name, b);
    }
  };
  const steps = [
    () => done(buildFloor(layout, batch)),
    () => {
      const screen = buildScreen(layout, batch);
      const ceiling = batch('ceiling');
      buildCeiling(ceiling, layout);
      done(screen, ceiling);
    },
    () => {
      const leftWall = batch('left-wall');
      buildSideWall(leftWall, layout, -1);
      done(leftWall);
    },
    () => {
      const rightWall = batch('right-wall');
      buildSideWall(rightWall, layout, 1);
      done(rightWall);
    },
    () => {
      const frontWall = batch('front-wall');
      buildFrontWall(frontWall, layout);
      const backWall = batch('back-wall');
      buildBackWall(backWall, layout);
      done(frontWall, backWall);
    },
  ];
  return {
    steps,
    finish: () => ({
      group,
      toggleable: { ceiling: built.get('ceiling')!.group, backWall: built.get('back-wall')!.group, rightWall: built.get('right-wall')!.group },
      pieces,
      dispose() {
        for (const geometry of geometries) geometry.dispose();
        geometries.length = 0;
      },
    }),
  };
}

/** Stepped floor and aisles, their nosings, the stage and the handrails. */
function buildFloor(layout: AuditoriumLayout, batch: (name: string) => MeshBatch<BlockoutMaterials>): MeshBatch<BlockoutMaterials> {
  const { interior, structure, shell, config } = layout;
  const floor = batch('floor');
  const slab = new BoxGeometry(shell.x.max - shell.x.min, interior.y.min - shell.y.min, shell.z.max - shell.z.min);
  slab.translate((shell.x.min + shell.x.max) / 2, (shell.y.min + interior.y.min) / 2, (shell.z.min + shell.z.max) / 2);
  floor.add('floor', 'carpet', withWorldUv(slab, CARPET_TILE));
  // Stepped floor: one prism for the seat block and one per aisle, all cut from the same row
  // profile, so the aisles step up exactly with the rows. The aisle prisms continue under the
  // side-wall lining to the structural wall, where the handrail posts stand.
  const seatTiers = createSteppedFloorGeometry(layout.treads, layout.seatingZone.x);
  if (seatTiers) floor.add('seat-tiers', 'carpet', withWorldUv(seatTiers, CARPET_TILE));
  for (const aisle of layout.aisles) {
    const x = aisle.side === 'left' ? { min: structure.x.min, max: aisle.x.max } : { min: aisle.x.min, max: structure.x.max };
    const steps = createSteppedFloorGeometry(layout.treads, x);
    if (steps) floor.add(`aisle-${aisle.side}`, 'aisle', withWorldUv(steps, CARPET_TILE));
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
  return floor;
}

/** Screen: the surface extends slightly behind the frame so no gap shows at the edges. */
function buildScreen(layout: AuditoriumLayout, batch: (name: string) => MeshBatch<BlockoutMaterials>): MeshBatch<BlockoutMaterials> {
  const { config } = layout;
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
  return screen;
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

/**
 * Replaces texture coordinates with world-space planar ones (`tile` metres per repeat), projected
 * along each vertex's dominant normal axis, so carpet fleck has the same scale on every floor piece.
 */
function withWorldUv<G extends BufferGeometry>(geometry: G, tile: number): G {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const [nx, ny, nz] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    const [u, v] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return geometry;
}
