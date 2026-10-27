/** Largest movement (CSS px) between press and release that still counts as a tap, by pointer type. */
export interface TapSettings {
  slopPx: { mouse: number; pen: number; touch: number };
  /** Presses held longer than this (ms) are not taps. */
  maxMs: number;
}

interface Press {
  type: string;
  x: number;
  y: number;
  time: number;
  /** Disqualified: moved too far, part of a multi-pointer gesture, or used up by stopping the tour. */
  spoiled: boolean;
}

/**
 * Tells taps from drags for presses that start on the canvas, by watching pointer events that the
 * camera controls also receive (it never captures or cancels them, so it cannot compete with the
 * controls). A press is a tap only if:
 * - it is the primary button and started on the canvas (not on the stick, a panel or a button);
 * - it moved less than the slop for its pointer type and was released within `maxMs`;
 * - no other pointer was down anywhere at any time during it (two-finger walk + look, pinch,
 *   lifting one finger of several), and it was not cancelled (pointercancel, blur);
 * - it was not the press that stopped the tour.
 * `anyDown`/`anyUp` see every pointer on the page; `down`/`move`/`up` only canvas pointers.
 */
export class TapTracker {
  private readonly settings: TapSettings;
  private readonly presses = new Map<number, Press>();
  /** Every pointer currently down on the page, wherever it started. */
  private readonly active = new Set<number>();

  constructor(settings: TapSettings) {
    this.settings = settings;
  }

  /** A pointer went down anywhere on the page. */
  anyDown(id: number): void {
    this.active.add(id);
    if (this.active.size > 1) for (const press of this.presses.values()) press.spoiled = true;
  }

  /** A pointer went up or was cancelled anywhere on the page. */
  anyUp(id: number): void {
    this.active.delete(id);
  }

  /** A press on the canvas. `consumed`: it already did something else (stopped the tour). */
  down(id: number, type: string, button: number, x: number, y: number, time: number, consumed = false): void {
    this.presses.set(id, { type, x, y, time, spoiled: consumed || button !== 0 || this.active.size > 1 });
  }

  move(id: number, x: number, y: number): void {
    const press = this.presses.get(id);
    if (!press || press.spoiled) return;
    const slop = this.settings.slopPx[press.type as keyof TapSettings['slopPx']] ?? this.settings.slopPx.touch;
    if (Math.hypot(x - press.x, y - press.y) > slop) press.spoiled = true;
  }

  /** The press ended; returns true if it was a tap. */
  up(id: number, x: number, y: number, time: number): boolean {
    this.move(id, x, y);
    const press = this.presses.get(id);
    this.presses.delete(id);
    return Boolean(press && !press.spoiled && time - press.time <= this.settings.maxMs);
  }

  cancel(id: number): void {
    this.presses.delete(id);
    this.active.delete(id);
  }

  /** Window blur, tab hidden, context lost: nothing in progress can become a tap. */
  cancelAll(): void {
    this.presses.clear();
    this.active.clear();
  }

  /** True while any canvas press is in progress (hover is not updated then). */
  get pressing(): boolean {
    return this.presses.size > 0;
  }
}
