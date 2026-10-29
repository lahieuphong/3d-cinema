import type { SeatSelection } from './selection.ts';
import { el, icon, ICONS } from './ui.ts';

export interface SeatSummaryHandlers {
  /** "Sơ đồ ghế" / "Mở sơ đồ": opens or closes the seat panel. */
  onTogglePanel(): void;
  onViewFromSeat(seatId: string): void;
}

export interface SeatSummary {
  element: HTMLElement;
  /** The button that opens the panel (focus comes back here when it closes). */
  toggle: HTMLButtonElement;
  setPanelOpen(open: boolean): void;
  /** The seat the camera is at, if any ("Xem từ ghế …" is not offered for it). */
  setViewing(seatId: string | null): void;
  /** No 3D: "Xem từ ghế …" is not offered. */
  setViewAvailable(available: boolean): void;
  dispose(): void;
}

const MAP_ICON = 'M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z';

/**
 * The seat task's compact line under the view: what is selected (one line; the panel has the full
 * list), the seat being looked at, "Sơ đồ ghế" and "Xem từ ghế …". Labelled as demo data, never as
 * a booking. Text lines and buttons keep their size as the selection changes (seat IDs all have
 * three characters), so the view above never resizes because of it.
 */
export function createSeatSummary(host: HTMLElement, selection: SeatSelection, handlers: SeatSummaryHandlers): SeatSummary {
  const listeners = new AbortController();
  const { signal } = listeners;
  const max = selection.maxSelected;

  const element = el('div', 'cinema-summary');
  const text = el('p', 'cinema-summary__text');
  const tag = el('span', 'cinema-summary__demo', 'Minh họa');
  tag.title = 'Dữ liệu ghế minh họa — chưa giữ chỗ thực tế';
  const selected = el('span', 'cinema-summary__selected');
  text.append(tag, ' ', selected);
  const active = el('p', 'cinema-summary__active');

  const actions = el('div', 'cinema-summary__actions');
  const toggle = el('button', 'cinema-button cinema-summary__map');
  toggle.type = 'button';
  toggle.dataset.action = 'seat-panel';
  toggle.setAttribute('aria-controls', 'cinema-seat-panel');
  toggle.setAttribute('aria-expanded', 'false');
  // One label per layout: "Mở sơ đồ" opens a sheet; "Sơ đồ ghế" shows or hides a side panel.
  toggle.append(icon(MAP_ICON), el('span', 'cinema-summary__map-sheet', 'Mở sơ đồ'), el('span', 'cinema-summary__map-side', 'Sơ đồ ghế'));
  const view = el('button', 'cinema-button cinema-summary__view');
  view.type = 'button';
  view.dataset.action = 'summary-view-seat';
  // An icon and its words, like the map button beside it (the words follow the seat).
  const viewLabel = el('span', '');
  view.append(icon(ICONS.eye), viewLabel);
  actions.append(toggle, view);
  element.append(text, active, actions);
  host.append(element);

  let viewAvailable = true;
  let viewing: string | null = null;
  const paint = () => {
    const ids = selection.selectedIds;
    selected.textContent =
      ids.length === 0
        ? 'Chưa chọn ghế nào — chạm một ghế trong phòng hoặc mở sơ đồ.'
        : `${ids.length >= max ? `Đã đủ ${max}/${max}` : `Đã chọn ${ids.length}/${max}`}: ${ids.join(', ')}`;
    const id = selection.active;
    const status = id ? selection.status(id) : null;
    active.textContent = viewing
      ? `Đang xem từ ghế ${viewing}`
      : id
        ? `Ghế đang xem: ${id} · ${status === 'reserved' ? 'đã đặt' : status === 'selected' ? 'đang chọn' : 'còn trống'}`
        : '';
    view.hidden = !id || !viewAvailable || id === viewing;
    if (id) viewLabel.textContent = `Xem từ ghế ${id}`;
  };
  const unsubscribe = selection.subscribe((change) => {
    if (change.selection || change.active) paint();
  });
  toggle.addEventListener('click', () => handlers.onTogglePanel(), { signal });
  view.addEventListener('click', () => selection.active && handlers.onViewFromSeat(selection.active), { signal });
  paint();

  return {
    element,
    toggle,
    setPanelOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
    },
    setViewing(seatId) {
      viewing = seatId;
      paint();
    },
    setViewAvailable(available) {
      viewAvailable = available;
      paint();
    },
    dispose() {
      unsubscribe();
      listeners.abort();
      element.remove();
    },
  };
}
