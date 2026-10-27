import type { SeatData } from './layout.ts';

/** What a seat shows: derived from the reserved set and the selection, never stored twice. */
export type SeatStatus = 'available' | 'selected' | 'reserved';

/**
 * Demo reservations: fixed, spread over several rows and both sides, so every state shows up in
 * the map and the auditorium. A01, A06, F06, J06 and J11 stay available (they are the seats the
 * checks view from). Never randomised, so every render, quality level and reload looks the same.
 */
export const DEMO_RESERVED_SEAT_IDS: readonly string[] = [
  'A04', 'A05',
  'C07', 'C08', 'C09',
  'D01', 'D02',
  'E05', 'E06', 'E07',
  'G10', 'G11',
  'H03', 'H04', 'H05', 'H06',
  'J03', 'J04',
];

export type ToggleResult =
  | { ok: true; selected: boolean }
  | { ok: false; reason: 'reserved' | 'limit' | 'unknown' };

/** What changed in one update; listeners repaint only these seats. */
export interface SelectionChange {
  /** Seats whose status, hover or active flag changed. */
  seats: ReadonlySet<string>;
  selection: boolean;
  active: boolean;
  hover: boolean;
  /** Set when an attempted toggle was refused. */
  refused?: { seatId: string; reason: 'reserved' | 'limit' };
}

/**
 * The single source of truth for seat selection, independent of the renderer and the DOM:
 * the 3D view, the 2D map and the info panel all read it and all changes go through it.
 *
 * - `reserved` comes from a fixed demo fixture and never changes.
 * - `selected` holds at most `maxSelected` seats; reserved seats can never be added.
 * - `active` is the seat whose details are shown (and that "view from this seat" uses); it is
 *   independent of the selection: looking at a seat does not select it, deselecting keeps it active.
 * - `hovered` is a transient pointer state.
 * Lives for the whole app session (outside any page mount), so it survives quality switches,
 * context restores and opening the seat inspector. Not persisted across reloads.
 */
export class SeatSelection {
  readonly seats: readonly SeatData[];
  readonly maxSelected: number;
  private readonly byId: ReadonlyMap<string, SeatData>;
  private readonly reserved: ReadonlySet<string>;
  private readonly selected = new Set<string>();
  private activeId: string | null = null;
  private hoveredId: string | null = null;
  private readonly listeners = new Set<(change: SelectionChange) => void>();

  constructor(seats: readonly SeatData[], reservedIds: readonly string[], maxSelected: number) {
    this.seats = seats;
    this.maxSelected = maxSelected;
    this.byId = new Map(seats.map((seat) => [seat.id, seat]));
    for (const id of reservedIds) if (!this.byId.has(id)) throw new Error(`Unknown reserved seat ${id}`);
    this.reserved = new Set(reservedIds);
  }

  seat(id: string): SeatData | undefined {
    return this.byId.get(id);
  }

  status(id: string): SeatStatus {
    if (this.reserved.has(id)) return 'reserved';
    return this.selected.has(id) ? 'selected' : 'available';
  }

  isReserved(id: string): boolean {
    return this.reserved.has(id);
  }

  /** Selected seat ids in row, then column order (A01 … J11). */
  get selectedIds(): string[] {
    return this.seats.filter((seat) => this.selected.has(seat.id)).map((seat) => seat.id);
  }

  get reservedIds(): string[] {
    return this.seats.filter((seat) => this.reserved.has(seat.id)).map((seat) => seat.id);
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  get active(): string | null {
    return this.activeId;
  }

  get hovered(): string | null {
    return this.hoveredId;
  }

  /** Selects an available seat or deselects a selected one; refuses reserved seats and the 9th seat. */
  toggle(id: string): ToggleResult {
    if (!this.byId.has(id)) return { ok: false, reason: 'unknown' };
    if (this.reserved.has(id)) {
      this.emit({ seats: new Set(), selection: false, active: false, hover: false, refused: { seatId: id, reason: 'reserved' } });
      return { ok: false, reason: 'reserved' };
    }
    if (this.selected.has(id)) {
      this.selected.delete(id);
      this.emit({ seats: new Set([id]), selection: true, active: false, hover: false });
      return { ok: true, selected: false };
    }
    if (this.selected.size >= this.maxSelected) {
      this.emit({ seats: new Set(), selection: false, active: false, hover: false, refused: { seatId: id, reason: 'limit' } });
      return { ok: false, reason: 'limit' };
    }
    this.selected.add(id);
    this.emit({ seats: new Set([id]), selection: true, active: false, hover: false });
    return { ok: true, selected: true };
  }

  deselect(id: string): void {
    if (this.selected.delete(id)) this.emit({ seats: new Set([id]), selection: true, active: false, hover: false });
  }

  /** Deselects everything; reservations are untouched. */
  clear(): void {
    if (this.selected.size === 0) return;
    const seats = new Set(this.selected);
    this.selected.clear();
    this.emit({ seats, selection: true, active: false, hover: false });
  }

  setActive(id: string | null): void {
    if (id !== null && !this.byId.has(id)) return;
    if (id === this.activeId) return;
    const seats = new Set([this.activeId, id].filter((value): value is string => value !== null));
    this.activeId = id;
    this.emit({ seats, selection: false, active: true, hover: false });
  }

  setHovered(id: string | null): void {
    if (id !== null && !this.byId.has(id)) return;
    if (id === this.hoveredId) return;
    const seats = new Set([this.hoveredId, id].filter((value): value is string => value !== null));
    this.hoveredId = id;
    this.emit({ seats, selection: false, active: false, hover: true });
  }

  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: (change: SelectionChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Number of subscribers, for lifecycle checks (must not grow across remounts and restores). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  private emit(change: SelectionChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
