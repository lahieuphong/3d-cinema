import { Color, PerspectiveCamera, Ray, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchitecture } from './architecture.ts';
import { computePresetPose } from './cameraPresets.ts';
import { createAuditoriumLayout } from './layout.ts';
import { createBlockoutMaterials, createSeatMaterials, disposeMaterials } from './materials.ts';
import { QUALITY_LEVELS } from './quality.ts';
import { SeatHighlighter, tintFor } from './seatHighlight.ts';
import { pickSeat, SeatPicker, visibleMeshes } from './seatPicking.ts';
import { createCinemaSeatModel, createSeatInstances } from './seats.ts';
import { seatViewPose } from './seatView.ts';
import { DEMO_RESERVED_SEAT_IDS, SeatSelection, type SelectionChange } from './selection.ts';

const layout = createAuditoriumLayout();
const { config } = layout;
const newSelection = () => new SeatSelection(layout.seats, DEMO_RESERVED_SEAT_IDS, config.selection.maxSeats);

describe('seat selection model', () => {
  it('uses a fixed demo fixture spread over several rows, keeping the checked seats available', () => {
    const selection = newSelection();
    expect(new Set(DEMO_RESERVED_SEAT_IDS.map((id) => id[0])).size).toBeGreaterThanOrEqual(5);
    for (const id of ['A01', 'A06', 'F06', 'J06', 'J11']) expect(selection.status(id)).toBe('available');
    // Same list every time: nothing random.
    expect(newSelection().reservedIds).toEqual(selection.reservedIds);
    expect(selection.reservedIds).toEqual([...DEMO_RESERVED_SEAT_IDS]);
  });

  it('derives every seat status from reserved and selected, and refuses reserved seats', () => {
    const selection = newSelection();
    expect(selection.toggle('B03')).toEqual({ ok: true, selected: true });
    expect(selection.status('B03')).toBe('selected');
    expect(selection.toggle('A04')).toEqual({ ok: false, reason: 'reserved' });
    expect(selection.status('A04')).toBe('reserved');
    expect(selection.toggle('B03')).toEqual({ ok: true, selected: false });
    expect(selection.status('B03')).toBe('available');
    expect(selection.toggle('Z99')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('stops at 8 seats without losing any, and reports why', () => {
    const selection = newSelection();
    const changes: SelectionChange[] = [];
    selection.subscribe((change) => changes.push(change));
    const ids = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08'];
    for (const id of ids) expect(selection.toggle(id).ok).toBe(true);
    expect(selection.toggle('B09')).toEqual({ ok: false, reason: 'limit' });
    expect(selection.selectedIds).toEqual(ids);
    expect(changes.at(-1)?.refused).toEqual({ seatId: 'B09', reason: 'limit' });
    // Deselecting one makes room again.
    selection.deselect('B04');
    expect(selection.toggle('B09').ok).toBe(true);
  });

  it('lists the selection in row and column order; clear leaves reservations alone', () => {
    const selection = newSelection();
    for (const id of ['J11', 'A01', 'F06', 'A06']) selection.toggle(id);
    expect(selection.selectedIds).toEqual(['A01', 'A06', 'F06', 'J11']);
    selection.clear();
    expect(selection.selectedCount).toBe(0);
    expect(selection.reservedIds).toEqual([...DEMO_RESERVED_SEAT_IDS]);
  });

  it('keeps the active seat independent of the selection', () => {
    const selection = newSelection();
    selection.setActive('C08'); // reserved: can be looked at, never selected
    expect(selection.active).toBe('C08');
    expect(selection.selectedCount).toBe(0);
    selection.setActive('B02');
    selection.toggle('B02');
    selection.toggle('B02');
    expect(selection.active).toBe('B02');
    selection.clear();
    expect(selection.active).toBe('B02');
  });

  it('notifies only the seats that changed, and unsubscribes cleanly', () => {
    const selection = newSelection();
    const seen: string[][] = [];
    const off = selection.subscribe((change) => seen.push([...change.seats].sort()));
    selection.setHovered('B01');
    selection.setHovered('B02');
    selection.setHovered('B02');
    expect(seen).toEqual([['B01'], ['B01', 'B02']]);
    off();
    expect(selection.listenerCount).toBe(0);
  });
});

describe('seat highlight colours', () => {
  const h = config.selection.highlight;
  const base = new Color(createSeatMaterials().upholstery.color);

  it('keeps the base colour for available seats and multiplies it into visible, distinct states', () => {
    const shade = (status: 'available' | 'selected' | 'reserved', emphasised = false) =>
      base.clone().multiply(tintFor(status, emphasised, h));
    const luminance = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(shade('available').equals(base)).toBe(true);
    // Selected is brighter and warmer (more green relative to red, towards amber), never darker.
    expect(luminance(shade('selected'))).toBeGreaterThan(luminance(base) * 1.4);
    expect(shade('selected').g / shade('selected').r).toBeGreaterThan(base.g / base.r);
    // Reserved is dimmer and less red, but not black.
    expect(luminance(shade('reserved'))).toBeLessThan(luminance(base));
    expect(luminance(shade('reserved'))).toBeGreaterThan(luminance(base) * 0.4);
    expect(shade('reserved').r / Math.max(shade('reserved').b, 1e-6)).toBeLessThan(base.r / base.b);
    // Hover only brightens: the hue of each state stays.
    for (const status of ['available', 'selected', 'reserved'] as const) {
      const a = shade(status);
      const b = shade(status, true);
      expect(luminance(b)).toBeGreaterThan(luminance(a));
      expect(b.r / b.g).toBeCloseTo(a.r / a.g, 6);
    }
  });

  it('paints instances from the selection and shows a tag only on selected seats, at both levels', () => {
    const materials = createSeatMaterials();
    const highlighter = new SeatHighlighter(config.selection.maxSeats, h);
    try {
      for (const level of QUALITY_LEVELS) {
        const model = createCinemaSeatModel(config, materials, config.quality[level].seat);
        const instances = createSeatInstances(model, layout.seats);
        const selection = newSelection();
        selection.toggle('F06');
        highlighter.attach(instances, model);
        expect(highlighter.apply(selection)).toBe(true);
        const index = (id: string) => layout.seatById.get(id)!.index;
        // Instance colours are stored as 32-bit floats.
        const close = (actual: number[] | null, expected: number[]) => expected.forEach((v, i) => expect(actual![i]).toBeCloseTo(v, 6));
        close(highlighter.tintOf(index('F06')), tintFor('selected', false, h).toArray());
        close(highlighter.tintOf(index('A04')), tintFor('reserved', false, h).toArray());
        close(highlighter.tintOf(index('A01')), [1, 1, 1]);
        expect(highlighter.tagShown(index('F06'))).toBe(true);
        expect(highlighter.tagShown(index('A01'))).toBe(false);
        // Nothing to repaint when nothing changed.
        expect(highlighter.apply(selection)).toBe(false);
        // Tags hold only the selected seats; with none selected the mesh is not drawn at all.
        expect([highlighter.markers.count, highlighter.markers.visible]).toEqual([1, true]);
        selection.clear();
        highlighter.apply(selection);
        expect([highlighter.markers.count, highlighter.markers.visible]).toEqual([0, false]);
        instances.dispose();
        model.dispose();
      }
    } finally {
      highlighter.dispose();
      disposeMaterials(materials);
    }
  });
});

describe('seat picking', () => {
  const materials = createSeatMaterials();
  const roomMaterials = createBlockoutMaterials();
  const architecture = buildArchitecture(layout, roomMaterials);
  architecture.group.updateMatrixWorld(true);
  const models = QUALITY_LEVELS.map((level) => createCinemaSeatModel(config, materials, config.quality[level].seat));
  const pickers = models.map((model) => new SeatPicker(layout.seats, model));
  afterAll(() => {
    for (const model of models) model.dispose();
    architecture.dispose();
    disposeMaterials(materials);
    disposeMaterials(roomMaterials);
  });
  const occluders = () => visibleMeshes(architecture.group);
  const down = (x: number, z: number, y = 4) => new Ray(new Vector3(x, y, z), new Vector3(0, -1, 0));

  it('finds every seat from straight above, the same at both quality levels', () => {
    for (const picker of pickers) {
      for (const seat of layout.seats) {
        const hit = pickSeat(picker, down(seat.position.x, seat.position.z - 0.1), { occluders: occluders() });
        expect(hit?.seat.id, seat.id).toBe(seat.id);
      }
    }
  });

  it('leaves the gaps between seats and between rows empty (unlike the walking colliders)', () => {
    const seat = layout.seatById.get('E06')!;
    const pitch = config.seating.seatPitch;
    // Between E06 and E07 at cushion depth: the two armrests leave a gap only a few cm wide, so
    // aim at the floor gap between rows instead, and just past the last seat of a row.
    const betweenRows = (seat.position.z + config.seat.footprintDepth / 2 + layout.rows[5].treadZ.min) / 2 + 0.02;
    for (const picker of pickers) {
      expect(pickSeat(picker, down(seat.position.x, betweenRows), { occluders: occluders() })).toBeNull();
      expect(pickSeat(picker, down(layout.seatById.get('E11')!.position.x + pitch * 0.62, seat.position.z), { occluders: occluders() })).toBeNull();
    }
  });

  it('picks the nearest seat when one hides another, and nothing through a visible wall', () => {
    const picker = pickers[0];
    const back = layout.seatById.get('F06')!;
    const front = layout.seatById.get('E06')!;
    // Low ray from the gap behind row F, through F06's backrest towards E06: F06 is in front.
    const origin = new Vector3(back.position.x, back.floorY + 0.8, back.position.z + config.seat.footprintDepth / 2 + 0.2);
    const ray = new Ray(origin, new Vector3(front.position.x, front.floorY + 0.5, front.position.z).sub(origin).normalize());
    expect(pickSeat(picker, ray, { occluders: occluders() })?.seat.id).toBe('F06');

    // From outside the right wall (the section view): blocked while the wall shows, picked when hidden.
    const side = computePresetPose('side', layout, 16 / 9).position;
    const target = layout.seatById.get('E11')!;
    const sideRay = new Ray(
      new Vector3(side.x, side.y, side.z),
      new Vector3(target.position.x, target.floorY + 0.6, target.position.z).sub(new Vector3(side.x, side.y, side.z)).normalize(),
    );
    expect(pickSeat(picker, sideRay, { occluders: occluders() })).toBeNull();
    architecture.toggleable.rightWall.visible = false;
    expect(pickSeat(picker, sideRay, { occluders: occluders() })?.seat.id).toBe('E11');
    architecture.toggleable.rightWall.visible = true;
  });

  it('honours the reach limit and ignores the seat the camera sits in', () => {
    const picker = pickers[0];
    const pose = seatViewPose(layout, layout.seatById.get('F06')!);
    const eye = new Vector3(pose.position.x, pose.position.y, pose.position.z);
    const own = new Ray(eye, new Vector3(0, -1, 0.05).normalize());
    expect(pickSeat(picker, own, { occluders: occluders() })?.seat.id).toBe('F06');
    const ignored = pickSeat(picker, own, { occluders: occluders(), ignoreSeat: layout.seatById.get('F06')!.index });
    expect(ignored?.seat.id).not.toBe('F06');
    // A seat 3–4 m below an overhead ray: out of a 2 m reach, within a 5 m one.
    const target = layout.seatById.get('C03')!;
    expect(pickSeat(picker, down(target.position.x, target.position.z - 0.1), { occluders: occluders(), maxDistance: 2 })).toBeNull();
    expect(pickSeat(picker, down(target.position.x, target.position.z - 0.1), { occluders: occluders(), maxDistance: 5 })?.seat.id).toBe('C03');
  });

  it('is cheap enough for hover: well under a millisecond per proxy query', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.05, 80);
    const pose = computePresetPose('overview', layout, 16 / 9);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    camera.updateMatrixWorld();
    const ray = new Ray();
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      ray.origin.copy(camera.position);
      ray.direction.set((i % 25) / 12.5 - 1, -((Math.floor(i / 25) % 20) / 10 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
      pickers[0].nearest(ray);
    }
    expect((performance.now() - start) / 500).toBeLessThan(1);
  });
});
