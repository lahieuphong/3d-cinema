import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape } from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/** Procedural building blocks for the cinema seat. All sizes in metres. */

export interface PillowOptions {
  /** Size along X. */
  width: number;
  /** Size along Z (the second axis of the plan outline). */
  depth: number;
  /** Size along Y, the soft axis; the crown is on the +Y face. */
  thickness: number;
  /** Superellipse exponent of the plan outline: small = squarer corners, 1 = ellipse. */
  outline: number;
  /** Exponent of the edge profile across the thickness: small = flatter faces with a tighter edge. */
  profile: number;
  /** Extra height at the centre of the +Y face, fading to zero at the outline. */
  crown: number;
  /**
   * Darkens the rolled edge (vertex colour, 0 = off), so the seams between neighbouring pads
   * read without modelling stitches. Faces keep their full colour.
   */
  seamShade?: number;
  radialSegments: number;
  /** Rings per half (top or bottom). */
  ringSegments: number;
}

/**
 * A closed, smooth cushion: a superellipsoid with its +Y face domed. Indexed with shared vertices
 * (including across the seam and at the poles) so shading stays smooth everywhere.
 */
export function createPillowGeometry(o: PillowOptions): BufferGeometry {
  const a = o.width / 2;
  const b = o.depth / 2;
  const c = o.thickness / 2;
  const U = o.radialSegments;
  const V = o.ringSegments * 2;
  const positions: number[] = [0, -c, 0];
  const colors: number[] = [1, 1, 1];
  const seam = o.seamShade ?? 0;

  for (let j = 1; j < V; j++) {
    const v = -Math.PI / 2 + (j / V) * Math.PI;
    const ring = signedPow(Math.cos(v), o.profile);
    const h = signedPow(Math.sin(v), o.profile);
    // Full colour on the faces, easing down towards the equator of the edge roll.
    const t = Math.min(1, Math.abs(h) / 0.6);
    const shade = 1 - seam * (1 - t * t * (3 - 2 * t));
    for (let i = 0; i < U; i++) {
      colors.push(shade, shade, shade);
      const u = (i / U) * Math.PI * 2;
      const x = a * ring * signedPow(Math.cos(u), o.outline);
      const z = b * ring * signedPow(Math.sin(u), o.outline);
      const dome = h > 0 ? o.crown * h * (1 - (x / a) ** 2) * (1 - (z / b) ** 2) : 0;
      positions.push(x, c * h + dome, z);
    }
  }
  const top = positions.length / 3;
  positions.push(0, c + o.crown, 0);
  colors.push(1, 1, 1);

  const ring = (j: number, i: number) => 1 + (j - 1) * U + (i % U);
  const indices: number[] = [];
  for (let i = 0; i < U; i++) indices.push(0, ring(1, i), ring(1, i + 1));
  for (let j = 1; j < V - 1; j++) {
    for (let i = 0; i < U; i++) {
      const lowA = ring(j, i);
      const lowB = ring(j, i + 1);
      const highA = ring(j + 1, i);
      const highB = ring(j + 1, i + 1);
      indices.push(lowA, highA, lowB, lowB, highA, highB);
    }
  }
  for (let i = 0; i < U; i++) indices.push(ring(V - 1, i + 1), ring(V - 1, i), top);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface PanelOutline {
  bottomWidth: number;
  topWidth: number;
  height: number;
  bottomCornerRadius: number;
  topCornerRadius: number;
}

/** Tapered panel outline in the XY plane, bottom edge on Y = 0, centred on X = 0. */
export function createPanelShape(o: PanelOutline): Shape {
  const bl = { x: -o.bottomWidth / 2, y: 0 };
  const br = { x: o.bottomWidth / 2, y: 0 };
  const tr = { x: o.topWidth / 2, y: o.height };
  const tl = { x: -o.topWidth / 2, y: o.height };
  return roundedPolygon([bl, br, tr, tl], [o.bottomCornerRadius, o.bottomCornerRadius, o.topCornerRadius, o.topCornerRadius]);
}

/**
 * Polygon with each corner replaced by a quadratic curve that starts and ends `radius` along the
 * adjacent edges. Corners with radius 0 stay sharp. Points must be counter-clockwise.
 */
export function roundedPolygon(points: Array<{ x: number; y: number }>, radii: number[]): Shape {
  const shape = new Shape();
  const n = points.length;
  const along = (from: { x: number; y: number }, to: { x: number; y: number }, distance: number) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const t = Math.min(0.5, distance / length);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };
  for (let k = 0; k < n; k++) {
    const corner = points[k];
    const prev = points[(k + n - 1) % n];
    const next = points[(k + 1) % n];
    const start = radii[k] > 0 ? along(corner, prev, radii[k]) : corner;
    const end = radii[k] > 0 ? along(corner, next, radii[k]) : corner;
    if (k === 0) shape.moveTo(start.x, start.y);
    else shape.lineTo(start.x, start.y);
    if (radii[k] > 0) shape.quadraticCurveTo(corner.x, corner.y, end.x, end.y);
  }
  shape.closePath();
  return shape;
}

/**
 * Extrudes `shape` along +Z with rounded edges. The bevel is pulled inside the outline, so the
 * finished solid matches the shape exactly in XY and spans Z = 0 … thickness.
 */
export function createBeveledSlab(
  shape: Shape,
  thickness: number,
  bevel: number,
  { curveSegments = 8, bevelSegments = 3 } = {},
): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  geometry.translate(0, 0, bevel);
  return withCreasedNormals(geometry);
}

/**
 * Smooth normals across bevels, hard edges where faces meet at more than `creaseAngle`.
 * toCreasedNormals hashes positions to 1/100 of a unit (1 cm here), too coarse for seat details,
 * so the geometry is scaled up for the call and back afterwards.
 */
export function withCreasedNormals(geometry: BufferGeometry, creaseAngle = Math.PI / 4): BufferGeometry {
  geometry.scale(100, 100, 100);
  const creased = toCreasedNormals(geometry, creaseAngle);
  creased.scale(0.01, 0.01, 0.01);
  if (creased !== geometry) geometry.dispose();
  return creased;
}

/**
 * Merges same-material pieces into one indexed geometry. Pieces are reduced to `attributes`
 * (position + normal by default), merged, then re-indexed so vertices with matching attributes
 * are shared again. The input geometries are disposed.
 */
export function mergePieces(pieces: BufferGeometry[], attributes: readonly string[] = ['position', 'normal']): BufferGeometry {
  const prepared = pieces.map((piece) => {
    const flat = piece.index ? piece.toNonIndexed() : piece.clone();
    for (const name of Object.keys(flat.attributes)) {
      if (!attributes.includes(name)) flat.deleteAttribute(name);
    }
    return flat;
  });
  const merged = mergeGeometries(prepared);
  if (!merged) throw new Error('Pieces could not be merged: attribute layouts differ.');
  const indexed = mergeVertices(merged, 1e-6);
  for (const geometry of [...pieces, ...prepared, merged]) geometry.dispose();
  return indexed;
}

function signedPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}
