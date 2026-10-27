import {
  Box3,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { AuditoriumConfig } from './config.ts';
import { toRadians, type SeatData } from './layout.ts';
import type { SeatMaterials } from './materials.ts';
import { createBeveledSlab, createPanelShape, createPillowGeometry, mergePieces, roundedPolygon } from './seatGeometry.ts';

/**
 * Seat model contract (unchanged since Prompt 01):
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
  /** Part transform in seat-local space (identity when the transform is baked into the geometry). */
  matrix: Matrix4;
}

/** A named piece of the seat before merging, with its seat-local bounds measured from the built geometry. */
export interface SeatComponent {
  name: string;
  part: string;
  bounds: Box3;
}

export interface SeatModel {
  name: string;
  parts: SeatModelPart[];
  components: SeatComponent[];
  /** Top centre of the cup holder opening, its radius and depth, in seat-local space. */
  cupHolder: { center: Vector3; radius: number; depth: number };
  /** Disposes geometries owned by the model. Materials are shared and owned by the caller. */
  dispose(): void;
}

type PartName = keyof SeatMaterials;

interface Piece {
  name: string;
  part: PartName;
  geometry: BufferGeometry;
  matrix: Matrix4;
}

/**
 * Builds the procedural cinema seat from `config.seat.model`.
 *
 * Pieces are authored with their own local transforms, baked into seat-local space and merged per
 * material, so 110 seats cost one draw call per material:
 * - `upholstery`: seat cushion, lumbar, upper-back and headrest pads (soft superellipsoid pillows).
 * - `shell`: the backrest's rear cover (tapered, bevelled panel).
 * - `frame`: side standards, foot plates, seat pan and pivot hubs, armrests, hinge brackets,
 *   lower back cover, cup holder rim.
 * - `cupWell`: inside wall and bottom of the cup holder.
 */
export function createCinemaSeatModel(config: AuditoriumConfig, materials: SeatMaterials): SeatModel {
  const m = config.seat.model;
  const pieces: Piece[] = [];
  const add = (name: string, part: PartName, geometry: BufferGeometry, matrix = new Matrix4()) =>
    pieces.push({ name, part, geometry, matrix });

  // Standards: side panels from the floor up into the armrests, one under each armrest.
  const s = m.standard;
  const standardTop = m.armrest.topHeight - m.armrest.height / 2;
  for (const side of [-1, 1]) {
    // Side profile drawn in the (Z, Y) plane with a flat foot on the floor.
    const profile = roundedPolygon(
      [
        { x: s.footFrontZ, y: 0 },
        { x: s.footBackZ, y: 0 },
        { x: s.topBackZ, y: standardTop },
        { x: s.topFrontZ, y: standardTop },
      ],
      [0, 0, s.topCornerRadius, s.topCornerRadius],
    );
    // Shape (u, v, extrusion w) → seat (Z = u, Y = v, X = −w), then centred under the armrest.
    const standard = createBeveledSlab(profile, s.thickness, s.bevel, { curveSegments: 6, bevelSegments: 2 });
    standard.rotateY(-Math.PI / 2);
    centreOnX(standard, side * m.armrest.centerX);
    add(`standard-${sideName(side)}`, 'frame', standard);

    add(
      `foot-plate-${sideName(side)}`,
      'frame',
      new RoundedBoxGeometry(m.footPlate.width, m.footPlate.height, s.footBackZ - s.footFrontZ, 1, m.footPlate.height / 3),
      translation(side * m.armrest.centerX, m.footPlate.height / 2, (s.footFrontZ + s.footBackZ) / 2),
    );
  }

  // Armrests. The cup holder side is shortened at the front to make room for the holder.
  const a = m.armrest;
  const cup = m.cupHolder;
  for (const side of [-1, 1]) {
    const frontZ = side === cup.side ? cup.centerZ + cup.outerRadius - 0.008 : a.frontZ;
    add(
      `armrest-${sideName(side)}`,
      'frame',
      new RoundedBoxGeometry(a.width, a.height, a.backZ - frontZ, 2, a.cornerRadius),
      translation(side * a.centerX, a.topHeight - a.height / 2, (frontZ + a.backZ) / 2),
    );
  }

  // Cup holder: a revolved rim and outer wall in the frame colour, and a dark well inside it.
  // Profiles run counter-clockwise in (radius, height) so lathe normals face out of the solid.
  const cupCenter = new Vector3(cup.side * a.centerX, a.topHeight, cup.centerZ);
  // Both rim edges are filleted; the two fillets must fit in the wall thickness with a flat top left over.
  const fillet = Math.min(0.004, (cup.outerRadius - cup.innerRadius) / 2.5);
  const lip = 0.012;
  add(
    'cup-holder-rim',
    'frame',
    lathe([
      [cup.innerRadius + 0.001, -cup.wallHeight],
      [cup.outerRadius - fillet, -cup.wallHeight],
      ...arc(cup.outerRadius - fillet, -cup.wallHeight + fillet, fillet, -Math.PI / 2, 0, 2),
      [cup.outerRadius, -fillet],
      ...arc(cup.outerRadius - fillet, -fillet, fillet, 0, Math.PI / 2, 3),
      [cup.innerRadius + fillet, 0],
      ...arc(cup.innerRadius + fillet, -fillet, fillet, Math.PI / 2, Math.PI, 3),
      [cup.innerRadius, -lip],
    ]),
    translation(cupCenter.x, cupCenter.y, cupCenter.z),
  );
  const wellFillet = 0.008;
  add(
    'cup-holder-well',
    'cupWell',
    lathe([
      [cup.innerRadius, -lip],
      [cup.innerRadius, -cup.depth + wellFillet],
      ...arc(cup.innerRadius - wellFillet, -cup.depth + wellFillet, wellFillet, 0, -Math.PI / 2, 3),
    ]),
    translation(cupCenter.x, cupCenter.y, cupCenter.z),
  );
  // A flat disc closes the bottom (a lathe cannot reach the axis without a pinhole or degenerate
  // triangles); it reaches slightly under the fillet so no seam opens between them.
  const wellBottom = new CircleGeometry(cup.innerRadius - wellFillet + 0.001, 24);
  wellBottom.rotateX(-Math.PI / 2);
  add('cup-holder-well-bottom', 'cupWell', wellBottom, translation(cupCenter.x, cupCenter.y - cup.depth, cupCenter.z));

  // Pivot hubs: short cylinders from under the cushion into each standard, carrying the seat pan.
  const hub = m.seatHub;
  const hubOuterX = m.armrest.centerX;
  for (const side of [-1, 1]) {
    const geometry = new CylinderGeometry(hub.radius, hub.radius, hubOuterX - hub.innerX, 16);
    geometry.rotateZ(Math.PI / 2);
    add(`seat-hub-${sideName(side)}`, 'frame', geometry, translation((side * (hub.innerX + hubOuterX)) / 2, hub.centerY, hub.centerZ));
  }

  // Seat pan and cushion share a frame tilted about the pan's top centre, front edge up.
  const pan = m.seatPan;
  const cushion = m.cushion;
  const seatFrame = translation(0, pan.topHeight, pan.centerZ).multiply(new Matrix4().makeRotationX(toRadians(cushion.tiltDeg)));
  add(
    'seat-pan',
    'frame',
    new RoundedBoxGeometry(pan.width, pan.height, pan.depth, 2, pan.cornerRadius),
    seatFrame.clone().multiply(translation(0, -pan.height / 2, 0)),
  );
  const shape = m.padShape;
  add(
    'cushion',
    'upholstery',
    createPillowGeometry({ ...pillowStyle(shape), width: cushion.width, depth: cushion.depth, thickness: cushion.thickness }),
    seatFrame.clone().multiply(translation(0, cushion.thickness / 2 - cushion.embed, cushion.centerZ - pan.centerZ)),
  );

  // Backrest, authored in its own frame: origin on the hinge line, +Y up the backrest, +Z out of
  // its back. The frame leans back (towards +Z) by the recline angle.
  const back = m.backrest;
  const backFrame = translation(0, back.hingeHeight, back.hingeZ).multiply(new Matrix4().makeRotationX(toRadians(back.reclineDeg)));
  add('backrest-shell', 'shell', createBeveledSlab(createPanelShape(back.shell), back.shell.thickness, back.shell.bevel), backFrame);

  const panel = back.backPanel;
  add(
    'back-panel',
    'frame',
    createBeveledSlab(
      createPanelShape({
        bottomWidth: panel.width,
        topWidth: panel.width,
        height: panel.height,
        bottomCornerRadius: panel.cornerRadius,
        topCornerRadius: panel.cornerRadius,
      }),
      panel.thickness,
      panel.bevel,
      { curveSegments: 4, bevelSegments: 2 },
    ),
    // Sits on the back face of the shell, sunk 2 mm into it.
    backFrame.clone().multiply(translation(0, panel.centerY - panel.height / 2, back.shell.thickness - 0.002)),
  );

  for (const pad of back.pads) {
    const geometry = createPillowGeometry({ ...pillowStyle(shape), width: pad.width, depth: pad.height, thickness: pad.thickness });
    // Turn the pillow's domed +Y face to the front (-Z) and its depth axis up the backrest.
    geometry.rotateX(-Math.PI / 2);
    add(pad.name, 'upholstery', geometry, backFrame.clone().multiply(translation(0, pad.centerY, -pad.thickness / 2 + back.padEmbed)));
  }

  const bracket = m.hingeBracket;
  for (const side of [-1, 1]) {
    add(
      `hinge-bracket-${sideName(side)}`,
      'frame',
      new RoundedBoxGeometry(bracket.width, bracket.height, bracket.depth, 1, bracket.cornerRadius),
      translation(side * bracket.centerX, bracket.centerY, bracket.centerZ),
    );
  }

  // Bake each piece into seat-local space, measure it, then merge per material.
  const components: SeatComponent[] = [];
  const byPart = new Map<PartName, BufferGeometry[]>();
  for (const piece of pieces) {
    piece.geometry.applyMatrix4(piece.matrix);
    piece.geometry.computeBoundingBox();
    components.push({ name: piece.name, part: piece.part, bounds: piece.geometry.boundingBox!.clone() });
    byPart.set(piece.part, [...(byPart.get(piece.part) ?? []), piece.geometry]);
  }
  const partOrder: PartName[] = ['upholstery', 'shell', 'frame', 'cupWell'];
  const parts: SeatModelPart[] = partOrder.map((name) => ({
    name,
    geometry: mergePieces(byPart.get(name) ?? []),
    material: materials[name],
    matrix: new Matrix4(),
  }));
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }

  return {
    name: 'cinema-seat',
    parts,
    components,
    cupHolder: { center: cupCenter, radius: cup.innerRadius, depth: cup.depth },
    dispose() {
      for (const part of parts) part.geometry.dispose();
    },
  };
}

/** Seat-local bounding box of a model, measured from its geometry. */
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
  seats: readonly SeatData[];
  /**
   * The seat behind an instance id, e.g. from a raycast hit on any of `meshes`
   * (`hit.instanceId`). Every part shares the same mapping.
   */
  seatForInstance(instanceId: number): SeatData | undefined;
  /** Releases the instance buffers. Geometry and materials belong to the model / caller. */
  dispose(): void;
}

export function createSeatInstances(model: SeatModel, seats: readonly SeatData[]): SeatInstances {
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
    // Bounds over every instance, so frustum culling never drops seats at the edge of the view.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  });

  return {
    group,
    meshes,
    seats,
    seatForInstance: (instanceId) => seats[instanceId],
    dispose() {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

function pillowStyle(shape: AuditoriumConfig['seat']['model']['padShape']) {
  return {
    outline: shape.outline,
    profile: shape.profile,
    crown: shape.crown,
    radialSegments: shape.radialSegments,
    ringSegments: shape.ringSegments,
  };
}

/** Revolves a (radius, height) profile about +Y. */
function lathe(profile: Array<[number, number]>): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    24,
  );
}

/** Points on a circular arc in the (radius, height) plane, excluding the start point. */
function arc(cx: number, cy: number, radius: number, from: number, to: number, steps: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let k = 1; k <= steps; k++) {
    const t = from + ((to - from) * k) / steps;
    points.push([cx + radius * Math.cos(t), cy + radius * Math.sin(t)]);
  }
  return points;
}

function translation(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}

function centreOnX(geometry: BufferGeometry, x: number): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(x - (box.min.x + box.max.x) / 2, 0, 0);
}

function sideName(side: number): string {
  return side < 0 ? 'left' : 'right';
}
