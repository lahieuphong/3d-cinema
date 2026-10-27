import { CylinderGeometry, Matrix4, PlaneGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createDrapeGeometry, createSpeakerPieces, createSweptTube, yawTilt } from './interiorGeometry.ts';
import { floorElevationAt, stairPitchY, toRadians, type AuditoriumLayout, type Box, type Range } from './layout.ts';
import type { BlockoutMaterials } from './materials.ts';
import type { MeshBatch } from './meshBatch.ts';
import { createBeveledSlab, roundedPolygon } from './seatGeometry.ts';

type Batch = MeshBatch<BlockoutMaterials>;

/** −1 = left wall (−X), 1 = right wall (+X). */
export type WallSide = -1 | 1;

export interface WallBay {
  index: number;
  z: Range;
  kind: 'panel' | 'door' | 'speaker';
}

/**
 * Side-wall bays, front to back, one row pitch wide so their joints line up with the stair risers.
 * The last bay runs on to the back wall.
 */
export function sideWallBays(layout: AuditoriumLayout): WallBay[] {
  const p = layout.config.interior.wallPanels;
  const end = layout.interior.z.max;
  const bays: WallBay[] = [];
  for (let z = p.firstBayZ; end - z > p.bayWidth / 2; z += p.bayWidth) {
    const index = bays.length;
    const max = end - (z + p.bayWidth) < p.bayWidth / 2 ? end : z + p.bayWidth;
    const kind = index === p.doorBay ? 'door' : p.speakerBays.includes(index) ? 'speaker' : 'panel';
    bays.push({ index, z: { min: z, max }, kind });
  }
  return bays;
}

/** The door opening, the same on both side walls: clear leaf width plus the frame on each side. */
export function doorOpening(layout: AuditoriumLayout): { z: Range; y: Range; centerZ: number } {
  const d = layout.config.interior.door;
  const bay = sideWallBays(layout).find((b) => b.kind === 'door')!;
  const centerZ = (bay.z.min + bay.z.max) / 2;
  const half = d.width / 2 + d.frame;
  return { z: { min: centerZ - half, max: centerZ + half }, y: { min: 0, max: d.height + d.frame }, centerZ };
}

/** Clear height kept free over aisle floors when measuring the walkway. */
export const AISLE_HEADROOM = 2.1;

/**
 * Measures each aisle's clear walking width from the built pieces: the distance from the aisle's
 * seat-side edge to the nearest piece towards the wall that lies within the aisle's length and
 * below floor + headroom. Floor finishes are ignored; handrails are not. The last 5 cm at the back
 * wall are left out: finishes on that end wall (its skirting) shorten the aisle, not narrow it.
 */
export function measureAisleClearance(layout: AuditoriumLayout, pieces: ReadonlyArray<{ name: string; group: string; bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }>) {
  return layout.aisles.map((aisle) => {
    const sign = aisle.side === 'right' ? 1 : -1;
    const inner = sign > 0 ? aisle.x.min : -aisle.x.max;
    const length = { min: aisle.z.min, max: aisle.z.max - 0.05 };
    let clearWidth = Infinity;
    let limitedBy = '';
    for (const piece of pieces) {
      if (piece.group === 'floor' && !piece.name.startsWith('handrail')) continue;
      const b = piece.bounds;
      if (b.max.z <= length.min || b.min.z >= length.max) continue;
      const z0 = Math.max(b.min.z, length.min);
      const z1 = Math.min(b.max.z, length.max);
      const floorMax = Math.max(floorElevationAt(layout, z0), floorElevationAt(layout, z1));
      if (b.min.y >= floorMax + AISLE_HEADROOM - 1e-6) continue;
      // Extent measured outwards from the room centre line on this side.
      const near = sign > 0 ? b.min.x : -b.max.x;
      const far = sign > 0 ? b.max.x : -b.min.x;
      if (far <= inner + 1e-6) continue; // entirely on the seat side
      const distance = Math.max(near, inner) - inner;
      if (distance < clearWidth) {
        clearWidth = distance;
        limitedBy = piece.name;
      }
    }
    return { side: aisle.side, clearWidth, limitedBy };
  });
}

/** Distance from the finished side-wall face outwards (into the lining and wall) → world X. */
function sideX(layout: AuditoriumLayout, side: WallSide, depth: number): number {
  return side * (layout.interior.x.max + depth);
}

function sideBox(layout: AuditoriumLayout, side: WallSide, depth: Range, y: Range, z: Range): Box {
  const a = sideX(layout, side, depth.min);
  const b = sideX(layout, side, depth.max);
  return { x: { min: Math.min(a, b), max: Math.max(a, b) }, y, z };
}

/** Frame on a wall face: origin on the face, +Z pointing into the room. */
function sideWallFrame(layout: AuditoriumLayout, side: WallSide, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(side * layout.structure.x.max, y, z).multiply(new Matrix4().makeRotationY((-side * Math.PI) / 2));
}

function sideName(side: WallSide): string {
  return side < 0 ? 'left' : 'right';
}

/**
 * A slab lying in a side wall: `polygon` is drawn in the wall plane (Z, Y), and the slab spans
 * `depth` … `depth + thickness` outwards from the finished face.
 */
function wallSlab(layout: AuditoriumLayout, side: WallSide, polygon: Array<{ z: number; y: number }>, depth: number, thickness: number, bevel: number) {
  // Shape U is −Z on the right wall and +Z on the left so the rotation below lands it in place.
  const shape = roundedPolygon(
    polygon.map(({ z, y }) => ({ x: side > 0 ? -z : z, y })),
    polygon.map(() => 0),
  );
  const geometry = createBeveledSlab(shape, thickness, bevel, { curveSegments: 1, bevelSegments: 1 });
  geometry.rotateY((side * Math.PI) / 2);
  geometry.translate(sideX(layout, side, depth), 0, 0);
  return geometry;
}

/**
 * One side wall: the structural wall (split around the door opening) and everything fixed to it —
 * acoustic panels, joint inlays, stepped skirting, speakers, the door and its exit sign.
 * All of it lives at or behind the finished face, except the speakers, which hang above head height.
 */
export function buildSideWall(batch: Batch, layout: AuditoriumLayout, side: WallSide): void {
  const { config, interior, structure, shell, rows } = layout;
  const name = sideName(side);
  const lining = structure.x.max - interior.x.max;
  const wallDepth = { min: lining, max: lining + config.room.wallThickness };
  const opening = doorOpening(layout);

  batch.addBox(`wall-${name}-front`, 'wall', sideBox(layout, side, wallDepth, interior.y, { min: shell.z.min, max: opening.z.min }));
  batch.addBox(`wall-${name}-back`, 'wall', sideBox(layout, side, wallDepth, interior.y, { min: opening.z.max, max: shell.z.max }));
  batch.addBox(`wall-${name}-lintel`, 'wall', sideBox(layout, side, wallDepth, { min: opening.y.max, max: interior.y.max }, opening.z));

  const p = config.interior.wallPanels;
  const bays = sideWallBays(layout);
  const panelBottom = (z: number) => stairPitchY(layout, z) + p.dadoHeight;
  for (const bay of bays.filter((b) => b.kind === 'panel')) {
    const z0 = bay.z.min + p.joint / 2;
    const z1 = bay.z.max - p.joint / 2;
    const lower = [
      { z: z0, y: panelBottom(z0) },
      { z: z1, y: panelBottom(z1) },
      { z: z1, y: p.splitY - p.joint / 2 },
      { z: z0, y: p.splitY - p.joint / 2 },
    ];
    const upper = [
      { z: z0, y: p.splitY + p.joint / 2 },
      { z: z1, y: p.splitY + p.joint / 2 },
      { z: z1, y: p.topY },
      { z: z0, y: p.topY },
    ];
    batch.add(`panel-${name}-${bay.index}-lower`, 'panel', wallSlab(layout, side, lower, 0, p.thickness, p.bevel));
    batch.add(`panel-${name}-${bay.index}-upper`, 'panel', wallSlab(layout, side, upper, 0, p.thickness, p.bevel));
  }

  // Champagne inlays in the joints either side of the door and speaker bays.
  const edges = new Set<number>();
  for (const bay of bays.filter((b) => b.kind !== 'panel')) {
    for (const z of [bay.z.min, bay.z.max]) if (z < interior.z.max - 1e-6) edges.add(z);
  }
  for (const z of edges) {
    batch.addBox(
      `trim-${name}-${z.toFixed(2)}`,
      'trim',
      sideBox(layout, side, { min: p.trim.recess, max: p.trim.depth }, { min: panelBottom(z), max: p.topY }, { min: z - p.trim.width / 2, max: z + p.trim.width / 2 }),
    );
  }

  // Skirting on the structural face, stepping up with the floor; interrupted by the door.
  const sk = config.interior.skirting;
  const skirt = (label: string, z: Range, y: number) =>
    batch.addBox(`skirting-${name}-${label}`, 'graphite', sideBox(layout, side, { min: lining - sk.thickness, max: lining }, { min: y, max: y + sk.height }, z));
  skirt('front-a', { min: p.firstBayZ, max: opening.z.min }, rows[0].floorY);
  skirt('front-b', { min: opening.z.max, max: rows[0].treadZ.min }, rows[0].floorY);
  rows.forEach((row, i) => skirt(row.label, { min: row.treadZ.min, max: i === rows.length - 1 ? interior.z.max : row.treadZ.max }, row.floorY));

  // Speakers in their bays; the front pair turns towards the audience.
  const s = config.interior.speakers;
  for (const bay of bays.filter((b) => b.kind === 'speaker')) {
    const toe = bay.index === 0 ? toRadians(s.toeInDeg) : 0;
    addSpeaker(batch, layout, `speaker-${name}-${bay.index}`, sideWallFrame(layout, side, s.centerY, (bay.z.min + bay.z.max) / 2), side * toe);
  }

  addDoor(batch, layout, side, opening);
}

function addDoor(batch: Batch, layout: AuditoriumLayout, side: WallSide, opening: ReturnType<typeof doorOpening>): void {
  const { config, structure, interior } = layout;
  const name = sideName(side);
  const d = config.interior.door;
  const lining = structure.x.max - interior.x.max;
  const through = { min: 0, max: lining + config.room.wallThickness };
  const leafZ = { min: opening.z.min + d.frame, max: opening.z.max - d.frame };

  batch.addBox(`door-${name}-jamb-a`, 'graphite', sideBox(layout, side, through, opening.y, { min: opening.z.min, max: leafZ.min }));
  batch.addBox(`door-${name}-jamb-b`, 'graphite', sideBox(layout, side, through, opening.y, { min: leafZ.max, max: opening.z.max }));
  batch.addBox(`door-${name}-head`, 'graphite', sideBox(layout, side, through, { min: d.height, max: opening.y.max }, leafZ));
  batch.addBox(`door-${name}-threshold`, 'trim', sideBox(layout, side, through, { min: 0, max: d.thresholdHeight }, leafZ));
  const leafFace = lining + d.leafSetback;
  batch.addBox(
    `door-${name}-leaf`,
    'graphite',
    sideBox(layout, side, { min: leafFace, max: leafFace + d.leafThickness }, { min: d.thresholdHeight, max: d.height - 0.005 }, leafZ),
  );

  // Push bar across the leaf, on two brackets.
  const bar = d.pushBar;
  const barDepth = leafFace - bar.standoff;
  const barGeometry = new CylinderGeometry(bar.radius, bar.radius, bar.length, 12);
  barGeometry.rotateX(Math.PI / 2);
  barGeometry.translate(sideX(layout, side, barDepth), bar.y, opening.centerZ);
  batch.add(`door-${name}-push-bar`, 'trim', barGeometry);
  for (const end of [-1, 1]) {
    const z = opening.centerZ + end * (bar.length / 2 - 0.03);
    batch.addBox(
      `door-${name}-push-bar-bracket-${end < 0 ? 'a' : 'b'}`,
      'trim',
      sideBox(layout, side, { min: barDepth, max: leafFace }, { min: bar.y - 0.02, max: bar.y + 0.02 }, { min: z - 0.015, max: z + 0.015 }),
    );
  }

  // Exit sign on the wall above the door.
  const sign = config.interior.exitSign;
  const frame = sideWallFrame(layout, side, opening.y.max + sign.gapAboveDoor + sign.height / 2, opening.centerZ);
  batch.add(
    `exit-sign-${name}-housing`,
    'graphite',
    new RoundedBoxGeometry(sign.width, sign.height, sign.depth, 1, 0.01),
    frame.clone().multiply(new Matrix4().makeTranslation(0, 0, sign.depth / 2)),
  );
  batch.add(
    `exit-sign-${name}-face`,
    'exitSign',
    new PlaneGeometry(sign.width - 0.04, sign.height - 0.04),
    frame.clone().multiply(new Matrix4().makeTranslation(0, 0, sign.depth + 0.001)),
  );
}

/**
 * A wall-mounted speaker. `wallFrame` has its origin on the wall face with +Z into the room;
 * the cabinet hangs off a wall plate and arm, turned by `toe` and tilted down.
 */
function addSpeaker(batch: Batch, layout: AuditoriumLayout, name: string, wallFrame: Matrix4, toe: number): void {
  const s = layout.config.interior.speakers;
  // Turning the cabinet swings one back corner towards the wall; push it out to keep clear.
  const standoff = s.standoff + (s.width / 2) * Math.sin(Math.abs(toe));
  batch.add(`${name}-wall-plate`, 'graphite', new RoundedBoxGeometry(0.14, 0.22, 0.015, 1, 0.004), wallFrame.clone().multiply(new Matrix4().makeTranslation(0, 0, 0.0075)));
  const armLength = standoff + 0.02 - 0.015;
  const arm = new RoundedBoxGeometry(0.05, 0.05, armLength, 1, 0.006);
  batch.add(`${name}-arm`, 'graphite', arm, wallFrame.clone().multiply(new Matrix4().makeTranslation(0, 0, 0.015 + armLength / 2)));

  const cabinet = wallFrame
    .clone()
    .multiply(new Matrix4().makeTranslation(0, 0, standoff))
    .multiply(yawTilt(toe, toRadians(s.tiltDeg)))
    .multiply(new Matrix4().makeTranslation(0, 0, s.depth / 2));
  for (const piece of createSpeakerPieces(s)) batch.add(`${name}-${piece.name}`, piece.material, piece.geometry, cabinet);
}

/** Back wall with its skirting, the rear speaker pair and the projector on its wall bracket. */
export function buildBackWall(batch: Batch, layout: AuditoriumLayout): void {
  const { config, interior, structure, shell, rows } = layout;
  batch.addBox('wall-back', 'wall', { x: structure.x, y: interior.y, z: { min: interior.z.max, max: shell.z.max } });

  const sk = config.interior.skirting;
  const floorY = rows[rows.length - 1].floorY;
  // Stops at the side skirtings so the corners do not overlap.
  batch.addBox('skirting-back', 'graphite', {
    x: { min: structure.x.min + sk.thickness, max: structure.x.max - sk.thickness },
    y: { min: floorY, max: floorY + sk.height },
    z: { min: interior.z.max - sk.thickness, max: interior.z.max },
  });

  const s = config.interior.speakers;
  for (const x of [-s.rearX, s.rearX]) {
    const frame = new Matrix4().makeTranslation(x, s.centerY, interior.z.max).multiply(new Matrix4().makeRotationY(Math.PI));
    addSpeaker(batch, layout, `speaker-back-${x < 0 ? 'left' : 'right'}`, frame, 0);
  }

  addProjector(batch, layout);
}

/** Projector frame: origin at the lens tip, local −Z along the throw towards the screen centre. */
export function projectorFrame(layout: AuditoriumLayout): Matrix4 {
  const p = layout.config.interior.projector;
  const lens = new Vector3(0, p.lensY, layout.interior.z.max - p.lensDistanceFromWall);
  const target = layout.screen.center;
  const pitch = Math.atan2(lens.y - target.y, lens.z - target.z);
  return new Matrix4().makeTranslation(lens.x, lens.y, lens.z).multiply(new Matrix4().makeRotationX(-pitch));
}

function addProjector(batch: Batch, layout: AuditoriumLayout): void {
  const p = layout.config.interior.projector;
  const frame = projectorFrame(layout);
  const place = (x: number, y: number, z: number) => frame.clone().multiply(new Matrix4().makeTranslation(x, y, z));

  const glass = new CylinderGeometry(p.lens.radius - 0.015, p.lens.radius - 0.015, 0.006, 24);
  glass.rotateX(Math.PI / 2);
  batch.add('projector-lens-glass', 'driver', glass, place(0, 0, 0.003));
  const barrel = new CylinderGeometry(p.lens.radius, p.lens.radius, p.lens.length, 24);
  barrel.rotateX(Math.PI / 2);
  batch.add('projector-lens-barrel', 'graphite', barrel, place(0, 0, 0.004 + p.lens.length / 2));

  const b = p.body;
  const bodyFront = p.lens.length;
  batch.add('projector-body', 'projector', new RoundedBoxGeometry(b.width, b.height, b.depth, 2, b.cornerRadius), place(0, 0, bodyFront + b.depth / 2));
  const cradleY = -b.height / 2 - 0.01;
  batch.add('projector-cradle', 'graphite', new RoundedBoxGeometry(b.width + 0.04, 0.02, b.depth - 0.08, 1, 0.005), place(0, cradleY, bodyFront + b.depth / 2));

  // Level arms from the back of the cradle to a plate on the back wall.
  const cradleBack = new Vector3(0, cradleY - 0.01, bodyFront + b.depth - 0.05).applyMatrix4(frame);
  const wallZ = layout.interior.z.max;
  const armY = { min: cradleBack.y - 0.04, max: cradleBack.y };
  for (const x of [-0.22, 0.22]) {
    batch.addBox(`projector-arm-${x < 0 ? 'left' : 'right'}`, 'graphite', {
      x: { min: x - 0.02, max: x + 0.02 },
      y: armY,
      z: { min: cradleBack.z - 0.06, max: wallZ - 0.02 },
    });
  }
  batch.add(
    'projector-wall-plate',
    'graphite',
    new RoundedBoxGeometry(0.56, 0.28, 0.02, 1, 0.005),
    new Matrix4().makeTranslation(0, (armY.min + armY.max) / 2, wallZ - 0.01),
  );
}

/** Front wall, and a pleated curtain with its valance either side of the screen. */
export function buildFrontWall(batch: Batch, layout: AuditoriumLayout): void {
  const { config, interior, structure, shell } = layout;
  batch.addBox('wall-front', 'wall', { x: structure.x, y: interior.y, z: { min: shell.z.min, max: interior.z.min } });

  const c = config.interior.curtains;
  for (const side of [-1, 1] as const) {
    const drape = createDrapeGeometry({
      width: c.outerX - c.innerX,
      height: c.topY - c.bottomY,
      folds: c.folds,
      foldDepth: c.foldDepth,
      hemFlare: c.hemFlare,
      thickness: c.thickness,
      segmentsPerFold: c.segmentsPerFold,
      rows: c.rows,
      mirror: side < 0,
    });
    drape.translate(side * c.innerX, c.bottomY, c.centerZ);
    batch.add(`curtain-${sideName(side)}`, 'curtain', drape);
    const x = [side * c.valance.innerX, side * structure.x.max];
    batch.addBox(`valance-${sideName(side)}`, 'graphite', {
      x: { min: Math.min(...x), max: Math.max(...x) },
      y: { min: c.valance.bottomY, max: interior.y.max },
      z: { min: interior.z.min, max: c.valance.frontZ },
    });
  }
}

/**
 * Ceiling slab, a soffit along each side wall with a recessed light slot, and shallow cross beams
 * with a light slot down the middle. Nothing hangs over the screen end of the room.
 */
export function buildCeiling(batch: Batch, layout: AuditoriumLayout): void {
  const { config, interior, structure, shell } = layout;
  const ceiling = config.interior.ceiling;
  const top = interior.y.max;
  batch.addBox('ceiling', 'wall', { x: shell.x, y: { min: top, max: shell.y.max }, z: shell.z });

  const stripAbove = (bottom: number) => ({ min: bottom + ceiling.slotRecess, max: bottom + ceiling.slotRecess + ceiling.stripThickness });
  const bh = ceiling.bulkhead;
  const bulkheadY = { min: top - bh.depth, max: top };
  const bulkheadZ = { min: bh.firstZ, max: interior.z.max };
  const innerEdge = structure.x.max - bh.width;
  for (const side of [-1, 1] as const) {
    const span = (from: number, to: number) => {
      const a = side * from;
      const b = side * to;
      return { min: Math.min(a, b), max: Math.max(a, b) };
    };
    const slotInner = innerEdge + bh.lipWidth;
    const slotOuter = slotInner + bh.slotWidth;
    batch.addBox(`bulkhead-${sideName(side)}`, 'graphite', { x: span(slotOuter, structure.x.max), y: bulkheadY, z: bulkheadZ });
    batch.addBox(`bulkhead-${sideName(side)}-lip`, 'graphite', { x: span(innerEdge, slotInner), y: bulkheadY, z: bulkheadZ });
    batch.addBox(`cove-strip-${sideName(side)}`, 'lightSlot', { x: span(slotInner, slotOuter), y: stripAbove(bulkheadY.min), z: bulkheadZ });
  }

  const beams = ceiling.beams;
  const beamX = { min: -innerEdge, max: innerEdge };
  const beamY = { min: top - beams.depth, max: top };
  for (let k = 0; k < beams.count; k++) {
    const z = beams.firstZ + k * beams.pitch;
    const halfSlot = beams.slotWidth / 2;
    batch.addBox(`beam-${k}-front`, 'graphite', { x: beamX, y: beamY, z: { min: z - beams.width / 2, max: z - halfSlot } });
    batch.addBox(`beam-${k}-back`, 'graphite', { x: beamX, y: beamY, z: { min: z + halfSlot, max: z + beams.width / 2 } });
    batch.addBox(`beam-${k}-strip`, 'lightSlot', { x: beamX, y: stripAbove(beamY.min), z: { min: z - halfSlot, max: z + halfSlot } });
  }
}

/**
 * Handrails in the recessed band along both side walls: a continuous rail following the stair
 * pitch line, extended past the bottom and top nosings and returned into the wall, on posts that
 * stand on the treads. Everything sits outside the clear aisle (beyond the finished wall face).
 */
export function buildHandrails(batch: Batch, layout: AuditoriumLayout): void {
  const { config, interior, structure, rows } = layout;
  const h = config.interior.handrail;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const railCentreY = (z: number) => stairPitchY(layout, z) + h.height - h.radius;
  const zBottom = first.treadZ.min - h.extension;
  const zTop = last.treadZ.min + h.extension;

  for (const side of [-1, 1] as const) {
    const xRail = side * (interior.x.max + h.inset);
    const xWall = side * structure.x.max;
    const yLow = railCentreY(first.treadZ.min);
    const yHigh = railCentreY(last.treadZ.min);
    const rail = createSweptTube(
      [
        new Vector3(xWall, yLow, zBottom),
        new Vector3(xRail, yLow, zBottom),
        new Vector3(xRail, yLow, first.treadZ.min),
        new Vector3(xRail, yHigh, last.treadZ.min),
        new Vector3(xRail, yHigh, zTop),
        new Vector3(xWall, yHigh, zTop),
      ],
      h.radius,
      [h.returnBendRadius, h.bendRadius, h.bendRadius, h.returnBendRadius],
    );
    batch.add(`handrail-${sideName(side)}`, 'trim', rail);

    // A post in the middle of every tread under the slope, and one on the top landing.
    const postZ = [...rows.slice(0, -1).map((row) => (row.treadZ.min + row.treadZ.max) / 2), last.treadZ.min + h.extension / 2];
    postZ.forEach((z, i) => {
      const floor = floorElevationAt(layout, z);
      const top = railCentreY(z);
      const post = new CylinderGeometry(h.postRadius, h.postRadius, top - floor, 10);
      post.translate(xRail, (floor + top) / 2, z);
      batch.add(`handrail-${sideName(side)}-post-${i}`, 'trim', post);
      const flange = new CylinderGeometry(h.flange.radius, h.flange.radius, h.flange.height, 16);
      flange.translate(xRail, floor + h.flange.height / 2, z);
      batch.add(`handrail-${sideName(side)}-flange-${i}`, 'trim', flange);
    });
  }
}
