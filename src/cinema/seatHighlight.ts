import { CapsuleGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import type { AuditoriumConfig } from './config.ts';
import type { SeatSelection, SeatStatus } from './selection.ts';
import { seatPivotMatrix, type SeatInstances, type SeatModel } from './seats.ts';

type HighlightSettings = AuditoriumConfig['selection']['highlight'];

/** Seat parts whose colour carries the state: the leather (pads and cushion) and the back cover. */
const TINTED_PARTS = new Set(['upholstery', 'shell']);

/**
 * Linear factor multiplied with a tinted part's base colour (InstancedMesh instance colours multiply
 * the material colour, and the upholstery's seam vertex colours). Factors above 1 brighten.
 * Priority: reserved and selected decide the hue; hover/active ("emphasis") only brightens, so a
 * reserved seat never looks available on hover and a selected seat stays selected when focused.
 */
export function tintFor(status: SeatStatus, emphasised: boolean, settings: HighlightSettings, target = new Color()): Color {
  if (status === 'selected') target.setRGB(...settings.selected);
  else if (status === 'reserved') target.setRGB(...settings.reserved);
  else target.setRGB(1, 1, 1);
  if (emphasised) target.multiplyScalar(settings.emphasis);
  return target;
}

/**
 * Seat states in the auditorium without per-seat materials or geometry:
 * - instance colours on the existing seat meshes (one attribute per tinted part, 110 entries);
 * - for selected seats, a small amber tag on top of the backrest: one extra instanced mesh holding
 *   only the selected seats (at most the selection limit), hidden while nothing is selected, so an
 *   empty selection costs no draw call at all.
 * Applied from the selection model; after the seats are rebuilt (quality switch, context restore)
 * `attach` + `apply` paint the new instances from the same state.
 */
export class SeatHighlighter {
  readonly markers: InstancedMesh;
  private readonly settings: HighlightSettings;
  private instances: SeatInstances | null = null;
  private readonly markerMatrices: Matrix4[] = [];
  /** Seat indices with a tag, in instance order. */
  private tagged: number[] = [];
  private readonly color = new Color();

  constructor(maxTags: number, settings: HighlightSettings) {
    this.settings = settings;
    const geometry = new CapsuleGeometry(settings.marker.radius, settings.marker.length, 4, 10);
    geometry.rotateZ(Math.PI / 2);
    const material = new MeshStandardMaterial({
      color: settings.marker.color,
      emissive: settings.marker.emissive,
      emissiveIntensity: settings.marker.emissiveIntensity,
      roughness: 0.5,
    });
    this.markers = new InstancedMesh(geometry, material, maxTags);
    this.markers.name = 'seat-selected-tags';
    this.markers.count = 0;
    this.markers.visible = false;
    this.markers.frustumCulled = false;
  }

  /** Points the highlighter at a (re)built set of seat instances and places the tags on that model. */
  attach(instances: SeatInstances, model: SeatModel): void {
    this.instances = instances;
    const shell = model.components.find((c) => c.name === 'backrest-shell')!.bounds;
    // Resting on the top edge of the reclined back cover, a little in from its back face.
    const local = new Matrix4().makeTranslation(0, shell.max.y + this.settings.marker.radius * 0.6, shell.max.z - 0.035);
    this.markerMatrices.length = 0;
    for (const seat of instances.seats) this.markerMatrices.push(seatPivotMatrix(seat).multiply(local));
    // Tags already showing move onto the new model (it differs by millimetres between levels).
    this.tagged.forEach((seatIndex, i) => this.markers.setMatrixAt(i, this.markerMatrices[seatIndex]));
    this.markers.instanceMatrix.needsUpdate = true;
    for (const mesh of instances.meshes) {
      if (!TINTED_PARTS.has(mesh.userData.seatPart)) continue;
      for (let i = 0; i < instances.seats.length; i++) mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Repaints `seatIds` (or every seat) from the selection. Returns true if anything changed. */
  apply(selection: SeatSelection, seatIds?: Iterable<string>): boolean {
    const instances = this.instances;
    if (!instances) return false;
    const indices = seatIds ? [...seatIds].map((id) => selection.seat(id)?.index).filter((i): i is number => i !== undefined) : instances.seats.map((s) => s.index);
    let changed = false;
    const current = new Color();
    for (const mesh of instances.meshes) {
      if (!TINTED_PARTS.has(mesh.userData.seatPart) || !mesh.instanceColor) continue;
      for (const i of indices) {
        const id = instances.seats[i].id;
        tintFor(selection.status(id), selection.hovered === id || selection.active === id, this.settings, this.color);
        mesh.getColorAt(i, current);
        // Stored as 32-bit floats: compare with a tolerance, not exactly.
        if (Math.abs(current.r - this.color.r) + Math.abs(current.g - this.color.g) + Math.abs(current.b - this.color.b) < 1e-5) continue;
        mesh.setColorAt(i, this.color);
        changed = true;
      }
      mesh.instanceColor.needsUpdate = true;
    }
    const tagged = selection.selectedIds.map((id) => selection.seat(id)!.index).slice(0, this.markers.instanceMatrix.count);
    if (tagged.join() !== this.tagged.join()) {
      this.tagged = tagged;
      tagged.forEach((seatIndex, i) => this.markers.setMatrixAt(i, this.markerMatrices[seatIndex]));
      this.markers.count = tagged.length;
      this.markers.visible = tagged.length > 0;
      this.markers.instanceMatrix.needsUpdate = true;
      changed = true;
    }
    return changed;
  }

  /** Development/tests: the tint currently on seat `index` of a tinted part. */
  tintOf(index: number, part = 'upholstery'): [number, number, number] | null {
    const mesh = this.instances?.meshes.find((m) => m.userData.seatPart === part);
    if (!mesh?.instanceColor) return null;
    mesh.getColorAt(index, this.color);
    return [this.color.r, this.color.g, this.color.b];
  }

  /** Development/tests: whether seat `index` shows its selected tag. */
  tagShown(index: number): boolean {
    return this.tagged.includes(index);
  }

  dispose(): void {
    this.markers.geometry.dispose();
    (this.markers.material as MeshStandardMaterial).dispose();
    this.markers.dispose();
  }
}
