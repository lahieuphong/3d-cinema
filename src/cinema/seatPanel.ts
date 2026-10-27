import type { AuditoriumLayout, SeatData } from './layout.ts';
import type { SeatSelection, SeatStatus, SelectionChange } from './selection.ts';
import { el } from './ui.ts';

export interface SeatPanelHandlers {
  /** "Xem từ ghế này" for the active seat. */
  onViewFromSeat(seatId: string): void;
  /** The panel was opened or closed (the page resizes the 3D view). */
  onOpenChange(open: boolean): void;
}

export interface SeatPanel {
  element: HTMLElement;
  readonly open: boolean;
  /** `returnFocus`: when closing, focus goes back to the button that toggles the panel. */
  setOpen(open: boolean, options?: { returnFocus?: HTMLElement }): void;
  /** Disables "view from this seat" (no 3D) with the reason shown next to it. */
  setViewAvailable(available: boolean, reason?: string): void;
  dispose(): void;
}

const STATUS_TEXT: Record<SeatStatus, string> = { available: 'còn trống', selected: 'đang chọn', reserved: 'đã đặt' };

/**
 * Seat selection panel: demo notice, the 2D map, the active seat's details and the selected list.
 * Everything is generated from SeatData and reads the shared SeatSelection; nothing here keeps a
 * second copy of seat state.
 *
 * Map: HTML, one button per seat inside an ARIA grid (rows A–J, screen at the top, seat numbers
 * left → right as in the room). Roving tabindex: the grid is one Tab stop; arrow keys move by row
 * and column, Home/End go to the ends of a row (Ctrl+Home/End to A01/J11), Enter or Space toggles.
 * Each seat's accessible name is its ID and state; selected seats have aria-pressed="true",
 * reserved ones aria-disabled="true". The panel is a non-modal region (no focus trap); Escape
 * inside it closes it and returns focus to its toggle.
 * Announcements go to a polite live region outside the panel, one short sentence per change.
 */
export function createSeatPanel(
  host: HTMLElement,
  announcerHost: HTMLElement,
  layout: AuditoriumLayout,
  selection: SeatSelection,
  handlers: SeatPanelHandlers,
): SeatPanel {
  const listeners = new AbortController();
  const { signal } = listeners;
  const max = selection.maxSelected;

  const panel = el('aside', 'cinema-seats');
  panel.id = 'cinema-seat-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Chọn ghế');
  panel.hidden = true;

  const header = el('div', 'cinema-seats__header');
  const title = el('h2', 'cinema-seats__title', 'Chọn ghế');
  const close = el('button', 'cinema-button cinema-button--compact', 'Đóng');
  close.type = 'button';
  close.dataset.action = 'seat-panel-close';
  header.append(title, close);
  const demo = el('p', 'cinema-seats__demo', 'Dữ liệu ghế minh họa — chưa giữ chỗ thực tế.');

  // Active seat.
  const info = el('section', 'cinema-seats__info');
  info.setAttribute('aria-label', 'Ghế đang xem');
  const infoEmpty = el('p', 'cinema-seats__muted', 'Chọn một ghế trên sơ đồ hoặc trong khán phòng để xem thông tin.');
  const details = el('dl', 'cinema-seats__details');
  const detail = (term: string) => {
    const item = el('div', '');
    const value = el('dd', '');
    item.append(el('dt', '', term), value);
    details.append(item);
    return value;
  };
  const infoId = detail('Ghế');
  const infoRow = detail('Hàng');
  const infoNumber = detail('Số ghế');
  const infoStatus = detail('Trạng thái');
  infoStatus.dataset.seatStatus = '';
  const infoActions = el('div', 'cinema-seats__actions');
  const toggleActive = el('button', 'cinema-button cinema-button--compact');
  toggleActive.type = 'button';
  toggleActive.dataset.action = 'toggle-active-seat';
  const viewFrom = el('button', 'cinema-button cinema-button--compact', 'Xem từ ghế này');
  viewFrom.type = 'button';
  viewFrom.dataset.action = 'view-from-seat';
  infoActions.append(toggleActive, viewFrom);
  const viewHint = el('p', 'cinema-seats__muted');
  viewHint.hidden = true;
  info.append(infoEmpty, details, infoActions, viewHint);

  // Selected list.
  const chosen = el('section', 'cinema-seats__chosen');
  chosen.setAttribute('aria-label', 'Ghế đã chọn');
  const count = el('p', 'cinema-seats__count');
  const list = el('ul', 'cinema-seats__list');
  const limit = el('p', 'cinema-seats__limit');
  limit.hidden = true;
  const clear = el('button', 'cinema-button cinema-button--compact', 'Bỏ chọn tất cả');
  clear.type = 'button';
  clear.dataset.action = 'clear-selection';
  chosen.append(count, list, limit, clear);

  // Map.
  const mapSection = el('section', 'cinema-seats__map');
  mapSection.setAttribute('aria-label', 'Sơ đồ ghế');
  const help = el('p', 'cinema-seats__muted cinema-seats__help', 'Phím mũi tên: di chuyển giữa các ghế · Home/End: đầu/cuối hàng · Enter hoặc Space: chọn/bỏ chọn.');
  help.id = 'cinema-seat-map-help';
  const scroller = el('div', 'cinema-map');
  const screen = el('div', 'cinema-map__screen', 'Màn chiếu');
  screen.setAttribute('aria-hidden', 'true');
  const grid = el('div', 'cinema-map__grid');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Sơ đồ ghế, màn chiếu ở phía trên, hàng A gần màn nhất');
  grid.setAttribute('aria-describedby', help.id);
  const buttons = new Map<string, HTMLButtonElement>();
  const rows = layout.rows.map((row) => layout.seats.filter((seat) => seat.rowIndex === row.index));
  for (const row of rows) {
    const rowElement = el('div', 'cinema-map__row');
    rowElement.setAttribute('role', 'row');
    const label = el('span', 'cinema-map__label', row[0].rowLabel);
    label.setAttribute('role', 'rowheader');
    label.setAttribute('aria-label', `Hàng ${row[0].rowLabel}`);
    rowElement.append(label);
    for (const seat of row) {
      const cell = el('div', 'cinema-map__cell');
      cell.setAttribute('role', 'gridcell');
      const button = el('button', 'cinema-seat', String(seat.seatNumber));
      button.type = 'button';
      button.dataset.seat = seat.id;
      button.tabIndex = -1;
      cell.append(button);
      rowElement.append(cell);
      buttons.set(seat.id, button);
    }
    const end = el('span', 'cinema-map__label', row[0].rowLabel);
    end.setAttribute('aria-hidden', 'true');
    rowElement.append(end);
    grid.append(rowElement);
  }
  scroller.append(screen, grid);
  const legend = el('ul', 'cinema-map__legend');
  for (const [status, text] of [
    ['available', 'Còn trống'],
    ['selected', 'Đang chọn (✓)'],
    ['reserved', 'Đã đặt (✕)'],
    ['active', 'Đang xem'],
  ] as const) {
    const item = el('li', '');
    const swatch = el('span', `cinema-seat cinema-seat--swatch`);
    swatch.dataset.status = status === 'active' ? 'available' : status;
    if (status === 'active') swatch.dataset.active = 'true';
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, ` ${text}`);
    legend.append(item);
  }
  const swipe = el('p', 'cinema-map__swipe', '← Vuốt ngang để xem cả hàng →');
  swipe.setAttribute('aria-hidden', 'true');
  mapSection.append(help, swipe, scroller, legend);

  // The map comes first so nothing above it changes height as seats are picked: the details and
  // the list below grow and shrink, and a press on the map must land where it started.
  panel.append(header, demo, mapSection, info, chosen);
  host.append(panel);

  const announcer = el('div', 'visually-hidden');
  announcer.setAttribute('aria-live', 'polite');
  announcer.dataset.seatAnnouncer = '';
  announcerHost.append(announcer);

  let rovingId = layout.seats[0].id;
  let viewAvailable = true;

  const label = (seat: SeatData) => {
    const status = selection.status(seat.id);
    return status === 'reserved' ? `${seat.id}, đã đặt, không chọn được` : `${seat.id}, ${STATUS_TEXT[status]}`;
  };

  const paintSeat = (id: string) => {
    const button = buttons.get(id);
    const seat = selection.seat(id);
    if (!button || !seat) return;
    const status = selection.status(id);
    button.dataset.status = status;
    button.dataset.active = String(selection.active === id);
    button.dataset.hover = String(selection.hovered === id);
    button.setAttribute('aria-label', label(seat));
    button.setAttribute('aria-pressed', String(status === 'selected'));
    if (status === 'reserved') button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  };

  const setRoving = (id: string) => {
    buttons.get(rovingId)!.tabIndex = -1;
    rovingId = id;
    buttons.get(rovingId)!.tabIndex = 0;
  };

  const paintInfo = () => {
    const id = selection.active;
    const seat = id ? selection.seat(id) : undefined;
    infoEmpty.hidden = Boolean(seat);
    details.hidden = !seat;
    infoActions.hidden = !seat;
    if (!seat) return;
    const status = selection.status(seat.id);
    infoId.textContent = seat.id;
    infoRow.textContent = seat.rowLabel;
    infoNumber.textContent = String(seat.seatNumber);
    infoStatus.textContent = status === 'reserved' ? 'Đã đặt — không chọn được' : status === 'selected' ? 'Đang chọn' : 'Còn trống';
    infoStatus.dataset.seatStatus = status;
    toggleActive.textContent = status === 'selected' ? 'Bỏ chọn ghế này' : 'Chọn ghế này';
    toggleActive.disabled = status === 'reserved';
    viewFrom.disabled = !viewAvailable;
  };

  const paintList = () => {
    const ids = selection.selectedIds;
    count.textContent = `Đã chọn ${ids.length}/${max} ghế`;
    list.replaceChildren(
      ...ids.map((id) => {
        const item = el('li', 'cinema-seats__chip');
        const remove = el('button', 'cinema-seats__remove', '×');
        remove.type = 'button';
        remove.dataset.removeSeat = id;
        remove.setAttribute('aria-label', `Bỏ chọn ${id}`);
        item.append(el('span', '', id), remove);
        return item;
      }),
    );
    clear.disabled = ids.length === 0;
    if (ids.length < max) limit.hidden = true;
    else {
      limit.hidden = false;
      limit.textContent = `Đã đủ ${max} ghế, mức tối đa cho mỗi lần chọn.`;
    }
  };

  const announce = (text: string) => {
    // Re-set so the same sentence twice is still read.
    announcer.textContent = '';
    announcer.textContent = text;
  };

  const onChange = (change: SelectionChange) => {
    for (const id of change.seats) paintSeat(id);
    if (change.selection) paintList();
    if (change.selection || change.active) paintInfo();
    if (change.refused) {
      const { seatId, reason } = change.refused;
      if (reason === 'reserved') announce(`${seatId} đã được đặt, không chọn được.`);
      else {
        limit.hidden = false;
        limit.textContent = `Đã đủ ${max} ghế. Bỏ bớt một ghế để chọn ${seatId}.`;
        announce(`Đã đạt giới hạn ${max} ghế, chưa chọn ${seatId}.`);
      }
    }
  };
  const unsubscribe = selection.subscribe((change) => {
    onChange(change);
    if (change.selection && change.seats.size === 1) {
      const [id] = change.seats;
      const selectedNow = selection.status(id) === 'selected';
      announce(`${selectedNow ? 'Đã chọn' : 'Đã bỏ chọn'} ${id} (${selection.selectedCount}/${max}).`);
    } else if (change.selection && change.seats.size > 1) {
      announce('Đã bỏ chọn tất cả ghế.');
    }
  });

  const choose = (id: string) => {
    selection.setActive(id);
    selection.toggle(id);
  };

  // Map interactions: click toggles (Enter/Space on a button click it natively), focus shows details.
  grid.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-seat]');
      if (!button) return;
      setRoving(button.dataset.seat!);
      choose(button.dataset.seat!);
    },
    { signal },
  );
  grid.addEventListener(
    'focusin',
    (event) => {
      const id = (event.target as HTMLElement).dataset?.seat;
      if (!id) return;
      setRoving(id);
      selection.setActive(id);
    },
    { signal },
  );
  grid.addEventListener(
    'keydown',
    (event) => {
      const seat = selection.seat(rovingId)!;
      const row = rows[seat.rowIndex];
      let next: SeatData | undefined;
      switch (event.key) {
        case 'ArrowLeft':
          next = row[seat.columnIndex - 1];
          break;
        case 'ArrowRight':
          next = row[seat.columnIndex + 1];
          break;
        case 'ArrowUp':
          next = rows[seat.rowIndex - 1]?.[seat.columnIndex];
          break;
        case 'ArrowDown':
          next = rows[seat.rowIndex + 1]?.[seat.columnIndex];
          break;
        case 'Home':
          next = event.ctrlKey ? rows[0][0] : row[0];
          break;
        case 'End':
          next = event.ctrlKey ? rows.at(-1)!.at(-1) : row.at(-1);
          break;
        default:
          return;
      }
      // Handled here, so the camera's keyboard handlers (which also skip grids) never see it.
      event.preventDefault();
      if (next) buttons.get(next.id)!.focus();
    },
    { signal },
  );

  toggleActive.addEventListener('click', () => selection.active && selection.toggle(selection.active), { signal });
  viewFrom.addEventListener('click', () => selection.active && handlers.onViewFromSeat(selection.active), { signal });
  clear.addEventListener('click', () => selection.clear(), { signal });
  list.addEventListener(
    'click',
    (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-seat]')?.dataset.removeSeat;
      if (id) selection.deselect(id);
    },
    { signal },
  );

  let toggleButton: HTMLElement | undefined;
  const api: SeatPanel = {
    element: panel,
    get open() {
      return !panel.hidden;
    },
    setOpen(open, options) {
      if (options?.returnFocus) toggleButton = options.returnFocus;
      if (open === !panel.hidden) return;
      panel.hidden = !open;
      if (!open && panel.contains(document.activeElement)) toggleButton?.focus();
      handlers.onOpenChange(open);
    },
    setViewAvailable(available, reason) {
      viewAvailable = available;
      viewHint.hidden = available;
      viewHint.textContent = available ? '' : (reason ?? '');
      paintInfo();
    },
    dispose() {
      unsubscribe();
      listeners.abort();
      panel.remove();
      announcer.remove();
    },
  };
  close.addEventListener('click', () => api.setOpen(false), { signal });
  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      api.setOpen(false);
    },
    { signal },
  );

  for (const seat of layout.seats) paintSeat(seat.id);
  setRoving(selection.active ?? layout.seats.find((seat) => selection.status(seat.id) !== 'reserved')!.id);
  paintInfo();
  paintList();
  return api;
}
