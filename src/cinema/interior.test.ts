import { Box3, type BufferGeometry, Mesh, Raycaster, type Texture, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchitecture, INTERIOR_MATERIALS } from './architecture.ts';
import { doorOpening, measureAisleClearance, projectorFrame, sideWallBays } from './interior.ts';
import { createAuditoriumLayout, floorElevationAt, seatEyePosition, stairPitchY } from './layout.ts';
import { createBlockoutMaterials, disposeMaterials } from './materials.ts';
import type { PieceRecord } from './meshBatch.ts';

const layout = createAuditoriumLayout();
const { config, interior, structure } = layout;
const materials = createBlockoutMaterials();
const architecture = buildArchitecture(layout, materials);
architecture.group.updateMatrixWorld(true);

afterAll(() => {
  architecture.dispose();
  disposeMaterials(materials);
});

const EPS = 1e-4;
const pieces = architecture.pieces;
const named = (prefix: string) => pieces.filter((p) => p.name.startsWith(prefix));
const overlaps = (a: Box3, b: Box3) =>
  a.min.x < b.max.x - EPS && b.min.x < a.max.x - EPS &&
  a.min.y < b.max.y - EPS && b.min.y < a.max.y - EPS &&
  a.min.z < b.max.z - EPS && b.min.z < a.max.z - EPS;

/** Floor-fixed pieces: the room floor, stepped floor, nosings, stage and handrails. */
const isFloorPiece = (p: PieceRecord) => p.group === 'floor';
const isShellPiece = (p: PieceRecord) => p.name === 'floor' || p.name === 'ceiling' || p.name.startsWith('wall-');

describe('side walls and aisles', () => {
  it('keeps the finished wall face on the clear width (12 m between panel faces)', () => {
    const panels = named('panel-');
    expect(panels.length).toBeGreaterThan(30);
    const right = panels.filter((p) => p.bounds.min.x > 0);
    const left = panels.filter((p) => p.bounds.max.x < 0);
    expect(Math.min(...right.map((p) => p.bounds.min.x))).toBeCloseTo(interior.x.max, 4);
    expect(Math.max(...left.map((p) => p.bounds.max.x))).toBeCloseTo(interior.x.min, 4);
  });

  it('leaves the full 1.50 m aisle clear from floor to 2.1 m headroom, measured from the geometry', () => {
    const clearance = measureAisleClearance(layout, pieces);
    expect(clearance).toHaveLength(2);
    for (const { side, clearWidth, limitedBy } of clearance) {
      expect(clearWidth, `${side} aisle, limited by ${limitedBy}`).toBeGreaterThanOrEqual(config.aisles.width - EPS);
      // The walkway ends at the finished panel face, not at the handrail.
      expect(limitedBy, side).toMatch(/^panel-/);
    }
  });

  it('hangs speakers above head height over the aisles', () => {
    const cabinets = pieces.filter((p) => /^speaker-(left|right)-\d+-cabinet$/.test(p.name));
    expect(cabinets).toHaveLength(2 * config.interior.wallPanels.speakerBays.length);
    for (const { name, bounds } of cabinets) {
      const floorMax = Math.max(floorElevationAt(layout, bounds.min.z), floorElevationAt(layout, bounds.max.z));
      expect(bounds.min.y - floorMax, name).toBeGreaterThanOrEqual(2.1);
    }
  });

  it('keeps every seat footprint free of interior pieces', () => {
    const fp = config.seat;
    for (const seat of layout.seats) {
      const envelope = new Box3(
        new Vector3(seat.position.x - fp.footprintWidth / 2, seat.floorY, seat.position.z - fp.footprintDepth / 2),
        new Vector3(seat.position.x + fp.footprintWidth / 2, seat.floorY + 1.2, seat.position.z + fp.footprintDepth / 2),
      );
      for (const p of pieces) {
        if (isFloorPiece(p) && !p.name.startsWith('handrail')) continue;
        expect(overlaps(p.bounds, envelope), `${p.name} in ${seat.id}`).toBe(false);
      }
    }
  });

  it('lays out bays from the room and rows: door and speaker bays hold no panels', () => {
    const bays = sideWallBays(layout);
    expect(bays.at(-1)!.z.max).toBeCloseTo(interior.z.max, 9);
    // Bay joints on the stairs line up with the risers.
    for (const row of layout.rows) expect(bays.some((b) => Math.abs(b.z.min - row.treadZ.min) < 1e-9)).toBe(true);
    for (const bay of bays.filter((b) => b.kind !== 'panel')) {
      expect(named(`panel-right-${bay.index}-`)).toHaveLength(0);
    }
  });
});

describe('handrails', () => {
  const h = config.interior.handrail;

  it('stands every post on the tread below it and reaches the rail', () => {
    const posts = pieces.filter((p) => /^handrail-(left|right)-post-\d+$/.test(p.name));
    expect(posts).toHaveLength(2 * layout.rows.length);
    for (const { name, bounds } of posts) {
      const z = (bounds.min.z + bounds.max.z) / 2;
      expect(bounds.min.y, name).toBeCloseTo(floorElevationAt(layout, z), 4);
      expect(bounds.max.y, name).toBeCloseTo(stairPitchY(layout, z) + h.height - h.radius, 4);
    }
  });

  it('runs the rail at handrail height along the stairs, inside the wall recess', () => {
    for (const side of ['left', 'right']) {
      const rail = named(`handrail-${side}`).find((p) => p.name === `handrail-${side}`)!.bounds;
      const first = layout.rows[0];
      const last = layout.rows.at(-1)!;
      expect(rail.min.y).toBeCloseTo(first.floorY + h.height - 2 * h.radius, 3);
      expect(rail.max.y).toBeCloseTo(last.floorY + h.height, 3);
      expect(rail.min.z).toBeLessThan(first.treadZ.min - h.extension + 0.01);
      expect(rail.max.z).toBeGreaterThan(last.treadZ.min + h.extension - 0.01);
      // Beyond the finished face, up to the structural wall.
      const innerX = side === 'left' ? -rail.max.x : rail.min.x;
      expect(innerX).toBeGreaterThanOrEqual(interior.x.max);
      expect(side === 'left' ? -rail.min.x : rail.max.x).toBeLessThanOrEqual(structure.x.max + EPS);
    }
  });

  it('keeps the panels clear above the rail', () => {
    for (const panel of named('panel-').filter((p) => p.name.endsWith('-lower'))) {
      const z = (panel.bounds.min.z + panel.bounds.max.z) / 2;
      expect(panel.bounds.min.y - (stairPitchY(layout, z) + h.height)).toBeGreaterThan(0.25 - 0.05);
    }
  });
});

describe('screen and projection', () => {
  const blockers: Mesh[] = [];
  architecture.group.traverse((object) => {
    if (object instanceof Mesh && object.parent?.name !== 'screen') blockers.push(object);
  });
  const { picture, center } = layout.screen;
  const targets = [
    new Vector3(center.x, center.y, center.z),
    new Vector3(picture.x.min + 0.05, picture.y.min + 0.05, center.z),
    new Vector3(picture.x.max - 0.05, picture.y.min + 0.05, center.z),
    new Vector3(picture.x.min + 0.05, picture.y.max - 0.05, center.z),
    new Vector3(picture.x.max - 0.05, picture.y.max - 0.05, center.z),
  ];
  const firstBlocker = (from: Vector3, to: Vector3) => {
    const direction = to.clone().sub(from);
    const distance = direction.length();
    const ray = new Raycaster(from, direction.normalize(), 0, distance - 0.01);
    return ray.intersectObjects(blockers, false)[0]?.object.name;
  };

  it('lets every seat eye we test see the whole picture past the new interior', () => {
    for (const id of ['A01', 'A06', 'A11', 'F06', 'J01', 'J11']) {
      const eye = seatEyePosition(layout, layout.seatById.get(id)!);
      const from = new Vector3(eye.x, eye.y, eye.z);
      for (const target of targets) expect(firstBlocker(from, target), `${id} → ${target.toArray()}`).toBeUndefined();
    }
  });

  it('has a clear throw from the projector lens to the picture', () => {
    const frame = projectorFrame(layout);
    const lens = new Vector3(0, 0, -0.02).applyMatrix4(frame); // just in front of the lens glass
    for (const target of targets) expect(firstBlocker(lens, target), `${target.toArray()}`).toBeUndefined();
    // The projector aims at the screen centre.
    const aim = new Vector3(0, 0, -1).transformDirection(frame);
    const toCentre = new Vector3(center.x, center.y, center.z).sub(lens).normalize();
    expect(aim.angleTo(toCentre)).toBeLessThan(0.01);
  });

  it('keeps the ceiling clear above the screen and curtains beside it', () => {
    const frame = layout.screen.frame;
    // Clear zone over the screen: from the front wall to the front edge of the stage, independent
    // of where the beams are configured.
    const aboveScreen = new Box3(
      new Vector3(frame.x.min, frame.y.max, interior.z.min),
      new Vector3(frame.x.max, interior.y.max, layout.stage.z.max),
    );
    for (const p of pieces.filter((piece) => piece.group === 'ceiling' && piece.name !== 'ceiling')) {
      expect(overlaps(p.bounds, aboveScreen), p.name).toBe(false);
    }
    for (const curtain of named('curtain-')) {
      expect(curtain.bounds.min.x > frame.x.max || curtain.bounds.max.x < frame.x.min, curtain.name).toBe(true);
      expect(overlaps(curtain.bounds, new Box3(new Vector3(layout.stage.x.min, 0, layout.stage.z.min), new Vector3(layout.stage.x.max, layout.stage.y.max, layout.stage.z.max)))).toBe(false);
    }
  });
});

describe('fixtures do not collide', () => {
  const pairs: Array<[string, string]> = [
    ['speaker-', 'panel-'],
    ['speaker-', 'trim-'],
    ['door-', 'panel-'],
    ['exit-sign-', 'panel-'],
    ['beam-', 'projector-'],
    ['bulkhead-', 'panel-'],
    ['bulkhead-', 'valance-'],
    ['curtain-', 'valance-'],
    ['handrail-', 'door-'],
    ['speaker-back', 'projector-'],
    ['guide-strip-', 'panel-'],
    ['guide-strip-', 'door-'],
    ['guide-strip-', 'handrail-left-post'],
    ['guide-strip-', 'handrail-right-post'],
  ];
  for (const [a, b] of pairs) {
    it(`${a}* and ${b}* are apart`, () => {
      for (const pa of named(a)) {
        for (const pb of named(b)) {
          // The curtain tops tuck into the valance on purpose.
          if (a === 'curtain-' && pa.name.split('-')[1] === pb.name.split('-')[1]) continue;
          expect(overlaps(pa.bounds, pb.bounds), `${pa.name} × ${pb.name}`).toBe(false);
        }
      }
    });
  }

  // The strip is sloped, so its box overlaps the rail's and the skirting's; check the actual gaps.
  it('runs the aisle guide strip behind the handrail and above the skirting', () => {
    const h = config.interior.handrail;
    for (const side of ['left', 'right'] as const) {
      const strip = named(`guide-strip-${side}`)[0].bounds;
      const railFace = interior.x.max + h.inset + h.radius;
      if (side === 'right') expect(strip.min.x).toBeGreaterThan(railFace + 0.01);
      else expect(strip.max.x).toBeLessThan(-railFace - 0.01);
      // Bottom edge of the strip, which runs parallel to the stair pitch line.
      const stripBottom = (z: number) => stairPitchY(layout, z) + config.interior.wallPanels.dadoHeight - 0.06 - 0.011;
      for (const skirt of named(`skirting-${side}-`)) {
        for (const z of [skirt.bounds.min.z, skirt.bounds.max.z]) {
          if (z < strip.min.z || z > strip.max.z) continue;
          expect(stripBottom(z) - skirt.bounds.max.y, skirt.name).toBeGreaterThan(0.1);
        }
      }
    }
  });

  it('cuts a real door opening: no structural wall behind the leaf', () => {
    const opening = doorOpening(layout);
    for (const side of ['left', 'right']) {
      const leaf = named(`door-${side}-leaf`)[0].bounds;
      expect(leaf.min.z).toBeGreaterThanOrEqual(opening.z.min);
      expect(leaf.max.z).toBeLessThanOrEqual(opening.z.max);
      for (const wall of named(`wall-${side}-`)) expect(overlaps(wall.bounds, leaf), wall.name).toBe(false);
      // The threshold sits on the room floor, level with it.
      expect(named(`door-${side}-threshold`)[0].bounds.min.y).toBeCloseTo(0, 6);
    }
  });
});

describe('hide groups', () => {
  const groupOf = (name: string) => pieces.find((p) => p.name === name)?.group;

  it('hides everything fixed to the right wall with it', () => {
    const rightFixtures = pieces.filter((p) => /^(panel|trim|skirting|speaker|door|exit-sign)-right/.test(p.name) || p.name.startsWith('wall-right'));
    expect(rightFixtures.length).toBeGreaterThan(40);
    for (const p of rightFixtures) expect(p.group, p.name).toBe('right-wall');
    for (const p of pieces.filter((piece) => piece.group === 'right-wall')) expect(p.bounds.min.x, p.name).toBeGreaterThan(0);
  });

  it('hides beams, soffits and light slots with the ceiling', () => {
    for (const p of pieces.filter((piece) => /^(beam|bulkhead|cove-strip)/.test(piece.name))) expect(p.group, p.name).toBe('ceiling');
  });

  it('hides the rear speakers and the projector with the back wall', () => {
    for (const p of pieces.filter((piece) => /^(speaker-back|projector|skirting-back)/.test(piece.name))) expect(p.group, p.name).toBe('back-wall');
    expect(groupOf('wall-back')).toBe('back-wall');
  });

  it('keeps floor-standing fixtures (handrails) with the floor, so nothing is left floating', () => {
    for (const p of named('handrail-')) expect(p.group, p.name).toBe('floor');
    expect(architecture.toggleable.rightWall.children.length).toBeGreaterThan(3);
    expect(architecture.toggleable.ceiling.children.length).toBeGreaterThan(1);
  });

  it('puts interior fit-out in its own materials, separate from the room shell', () => {
    for (const p of pieces.filter((piece) => !isShellPiece(piece) && piece.group !== 'floor' && piece.group !== 'screen')) {
      expect(INTERIOR_MATERIALS.has(p.material), `${p.name} (${p.material})`).toBe(true);
    }
  });
});

describe('interior resources', () => {
  it('merges each group into one mesh per material', () => {
    architecture.group.children.forEach((group) => {
      const used = group.children.map((mesh) => mesh.userData.material);
      expect(new Set(used).size, group.name).toBe(used.length);
    });
  });

  it('disposes every geometry, material and shared texture (exit sign, carpet) exactly once', () => {
    const ownMaterials = createBlockoutMaterials();
    const own = buildArchitecture(layout, ownMaterials);
    const counts = new Map<object, number>();
    const track = (resource: { addEventListener(type: 'dispose', listener: () => void): void }) =>
      resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
    const geometries = new Set<BufferGeometry>();
    own.group.traverse((object) => {
      if (object instanceof Mesh) geometries.add(object.geometry);
    });
    geometries.forEach(track);
    Object.values(ownMaterials).forEach(track);
    const textures = new Set<Texture>();
    for (const material of Object.values(ownMaterials)) {
      for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
    }
    // The carpet texture is shared by the carpet and aisle materials.
    expect(ownMaterials.carpet.map).toBe(ownMaterials.aisle.map);
    expect([...textures]).toEqual(expect.arrayContaining([ownMaterials.exitSign.map, ownMaterials.carpet.map]));
    textures.forEach(track);

    own.dispose();
    disposeMaterials(ownMaterials);
    expect(counts.size).toBe(geometries.size + Object.keys(ownMaterials).length + textures.size);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });
});
