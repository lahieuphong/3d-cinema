import { el } from './ui.ts';

/**
 * The screens of the panel, one at a time: `task` (phones only: the task switch and the current
 * task's controls), `settings` (Cài đặt), and its three sub-screens. They only choose what the panel
 * shows; the task itself stays with taskLayout.
 */
export type HubView = 'task' | 'settings' | 'help' | 'about' | 'advanced';

const TITLES: Record<HubView, string> = {
  task: 'Điều khiển rạp',
  settings: 'Cài đặt',
  help: 'Hướng dẫn nhanh',
  about: 'Thông tin',
  advanced: 'Công cụ nâng cao',
};
const VIEWS = Object.keys(TITLES) as HubView[];
const CHEVRON = '<svg class="cinema-hub__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.2 5.6 7.8 7l5 5-5 5 1.4 1.4 6.4-6.4z"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.8 5.6 16.2 7l-5 5 5 5-1.4 1.4L8.4 12z"/></svg>';

export interface ControlHubOptions {
  /** The header's "Cài đặt": opens the panel under it when the hub is not floating (desktop, tablet). */
  anchor: HTMLButtonElement;
  /** Controls inside the panel that close it once used (camera moves, opening the seat map…). */
  closeOn: string;
  /** Opened or closed: the page makes the rest inert while it is open (modal). */
  onOpenChange(open: boolean): void;
  /** What the first-visit hint must stay above when it is in the same lower corner (the overlay stack). */
  keepClear?(): DOMRect | null;
}

export interface ControlHub {
  /** The floating button, the panel and the first-visit hint (shown on phones only, by the CSS). */
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  /** Under the title on phones: the task switch (Khám phá, Chọn ghế, Xem phim) is moved here. */
  readonly tasks: HTMLElement;
  readonly isOpen: boolean;
  /** The screen shown now. */
  readonly view: HubView;
  /** Where a screen's content goes (`task`: the current task's controls, above the "Cài đặt" row). */
  content(id: HubView): HTMLElement;
  /** A row of Cài đặt that opens one of its sub-screens (focus comes back to it on the way back). */
  link(id: Exclude<HubView, 'task' | 'settings'>, label: string, action: string): HTMLButtonElement;
  /** The line under the panel's title: what the camera shows now. */
  setNow(text: string): void;
  open(): void;
  /** `focusToggle`: focus returns to the button (unless it moved somewhere else on purpose). */
  close(focusToggle?: boolean): void;
  /** On or off; off closes it. */
  setActive(active: boolean): void;
  /**
   * Phones: the floating round button. Otherwise the panel drops down from the header's "Cài đặt"
   * (no floating button, no drag, no first-visit hint). Switching closes the panel.
   */
  setFloating(floating: boolean): void;
  /** Places the button, panel and hint again (something they keep clear of changed size). */
  refresh(): void;
  /** A short hint next to the button, until dismissed (`onDismiss`) or the panel is opened. */
  showHint(lines: string[], onDismiss: () => void): void;
  hideHint(): void;
  dispose(): void;
}

const STORAGE_KEY = 'tp-cinema-hub-position';
const MARGIN = 12;
const GAP = 10;
/**
 * Bands the button never covers (CSS px inside the safe area): the top, where the way back from a
 * seat and the tour card sit (the card, 12 px from the top, is 71 px tall while the tour plays and
 * 123 px while it steps, with "Trước" / "Tiếp" under it), and on the left side the lower corner,
 * where the walking stick appears.
 */
const TOP_CLEAR = 144;
const STICK_CLEAR = 152;
/** Movement before a press on the button becomes a drag (CSS px). */
const DRAG_SLOP = 8;
/** Idle time before the button steps back (it stays visible and usable). */
const REST_MS = 4000;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Position {
  side: 'left' | 'right';
  /** 0 at the top of the safe area, 1 at the bottom. */
  y: number;
}

/**
 * The phone layout's single floating control, after iOS AssistiveTouch: a round glass button over
 * the room (bottom right by default; it can be dragged to another spot and snaps to the nearest
 * side), and the panel it opens: the task switch on top, the current task's controls, and a
 * "Cài đặt" row. The panel shows one screen at a time and changes in place (no second panel, nothing
 * unfolds): Cài đặt, then its sub-screens (Hướng dẫn nhanh, Thông tin, Công cụ nâng cao). It holds
 * no state of its own beyond its position and that screen: the page moves its existing controls
 * into it, so the desktop and the phone show the same elements with the same handlers.
 *
 * The panel is a modal dialog over the room: a press outside it (on the scrim) closes it and goes
 * no further, so it never turns the camera or picks a seat; Tab stays inside. Escape goes back one
 * screen, and on the first one closes the panel (focus returns to the button); × always closes it.
 * Closed, it opens again on its first screen. The button keeps its place and closes the panel when
 * pressed again.
 *
 * On larger screens the tasks have their own bar over the room, and the same panel opens on Cài đặt,
 * dropped down from the header's "Cài đặt" instead (`setFloating(false)`).
 */
export function createControlHub(host: HTMLElement, options: ControlHubOptions): ControlHub {
  const listeners = new AbortController();
  const { signal } = listeners;
  const { anchor } = options;
  let active = false;
  let open = false;
  let floating = true;
  /** The button that opens the panel now: the round one on phones, "Cài đặt" otherwise. */
  const opener = () => (floating ? toggle : anchor);

  const root = el('div', 'cinema-hub');
  // The safe area as a box (env() is only readable from CSS): the button and panel stay inside it.
  const safe = el('div', 'cinema-hub__safe');
  safe.setAttribute('aria-hidden', 'true');
  const scrim = el('div', 'cinema-hub__scrim');
  scrim.hidden = true;

  const toggle = el('button', 'cinema-hub__toggle');
  toggle.type = 'button';
  toggle.dataset.action = 'hub';
  toggle.setAttribute('aria-label', 'Mở điều khiển rạp');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'cinema-hub-panel');
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.setAttribute('aria-controls', 'cinema-hub-panel');
  // Three glass rings around a lit core (the familiar floating home button).
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="cinema-hub__ring cinema-hub__ring--outer" cx="12" cy="12" r="10.5"/><circle class="cinema-hub__ring cinema-hub__ring--inner" cx="12" cy="12" r="7.75"/><circle class="cinema-hub__dot" cx="12" cy="12" r="5"/></svg>';

  const panel = el('div', 'cinema-hub__panel');
  panel.id = 'cinema-hub-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'cinema-hub-title');
  // Its sliders and buttons keep their keys (the walker's WASD and arrows stay out).
  panel.dataset.keys = 'own';
  const head = el('div', 'cinema-hub__head');
  const back = el('button', 'cinema-button cinema-hub__back');
  back.type = 'button';
  back.dataset.action = 'hub-back';
  back.innerHTML = BACK;
  const title = el('h2', 'cinema-hub__title', 'Điều khiển rạp');
  title.id = 'cinema-hub-title';
  title.tabIndex = -1;
  const close = el('button', 'cinema-button cinema-hub__close');
  close.type = 'button';
  close.dataset.action = 'hub-close';
  close.setAttribute('aria-label', 'Đóng điều khiển rạp');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg>';
  const now = el('p', 'cinema-hub__now');
  head.append(back, title, close);
  const tasks = el('div', 'cinema-hub__tasks');
  const body = el('div', 'cinema-hub__body');
  const views = new Map<HubView, HTMLElement>();
  for (const id of VIEWS) {
    const view = el('section', 'cinema-hub__view');
    view.id = `cinema-hub-${id}`;
    view.dataset.view = id;
    view.hidden = true;
    views.set(id, view);
    body.append(view);
  }
  // Phones: the task's controls, then the way into Cài đặt.
  const taskContent = el('div', 'cinema-hub__content');
  views.get('task')!.setAttribute('aria-label', 'Tác vụ đang chọn');
  views.get('task')!.append(taskContent);
  panel.append(head, now, tasks, body);

  // ------------------------------------------------------------------ screens
  let view: HubView = 'task';
  /** The first screen: the task on phones, Cài đặt from the header. */
  const firstView = (): HubView => (floating ? 'task' : 'settings');
  const parentOf = (id: HubView): HubView | null => (id === 'task' || id === firstView() ? null : id === 'settings' ? 'task' : 'settings');
  /** The row that opened each screen: focus goes back to it on the way back. */
  const openers = new Map<HubView, HTMLElement>();
  const show = (next: HubView, focus: HTMLElement | null) => {
    view = next;
    panel.dataset.view = next;
    for (const [id, element] of views) element.hidden = id !== next;
    // The camera line and the task switch belong to the task screen only.
    now.hidden = next !== 'task';
    tasks.hidden = next !== 'task';
    const parent = parentOf(next);
    back.hidden = parent === null;
    if (parent) back.setAttribute('aria-label', `Quay lại ${TITLES[parent]}`);
    // The dialog is named by its title: the new screen's name is read on the way in.
    title.textContent = TITLES[next];
    body.scrollTop = 0;
    if (open) placePanel();
    focus?.focus({ preventScroll: true });
  };
  const go = (next: HubView, from: HTMLElement) => {
    openers.set(next, from);
    show(next, title);
  };
  const goBack = () => {
    const parent = parentOf(view);
    if (!parent) return false;
    const from = openers.get(view);
    show(parent, from && views.get(parent)!.contains(from) ? from : title);
    return true;
  };
  const navRow = (label: string, action: string, next: HubView) => {
    const row = el('button', 'cinema-hub__row cinema-hub__row--nav');
    row.type = 'button';
    row.dataset.action = action;
    row.append(el('span', 'cinema-hub__label', label));
    row.insertAdjacentHTML('beforeend', CHEVRON);
    row.addEventListener('click', () => go(next, row), { signal });
    return row;
  };
  const settingsRows = el('div', 'cinema-hub__rows cinema-hub__rows--end');
  settingsRows.append(navRow('Cài đặt', 'hub-settings', 'settings'));
  views.get('task')!.append(settingsRows);
  back.addEventListener('click', () => goBack(), { signal });

  const hint = el('div', 'cinema-hub__hint');
  hint.hidden = true;
  hint.setAttribute('role', 'note');
  const hintText = el('div', 'cinema-hub__hint-text');
  const hintClose = el('button', 'cinema-button cinema-button--compact cinema-hub__hint-close', 'Đã hiểu');
  hintClose.type = 'button';
  hintClose.dataset.action = 'hub-hint-close';
  hint.append(hintText, hintClose);
  let onHintDismiss: (() => void) | null = null;

  root.append(safe, scrim, panel, hint, toggle);
  host.append(root);

  // ------------------------------------------------------------------ position
  let position: Position = { side: 'right', y: 1 };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Position | null;
    if (stored && (stored.side === 'left' || stored.side === 'right') && Number.isFinite(stored.y)) position = { side: stored.side, y: Math.min(1, Math.max(0, stored.y)) };
  } catch {
    // No storage (private mode, blocked): the default corner.
  }
  const safeBox = () => safe.getBoundingClientRect();
  const size = () => toggle.offsetWidth || 52;
  /** Where the button may be: below the top band, and on the left above the stick's corner. */
  const bounds = (side?: Position['side']) => {
    const box = safeBox();
    const top = box.top + Math.min(TOP_CLEAR, Math.max(MARGIN, box.height / 4));
    const bottom = box.bottom - size() - (side === 'left' ? STICK_CLEAR : MARGIN);
    return { left: box.left + MARGIN, right: box.right - MARGIN - size(), top, bottom: Math.max(top, bottom) };
  };
  // Where the button is going (its box may still be sliding there): the panel and hint follow this.
  let target = { x: 0, y: 0 };
  const moveTo = (x: number, y: number) => {
    target = { x: Math.round(x), y: Math.round(y) };
    toggle.style.left = `${target.x}px`;
    toggle.style.top = `${target.y}px`;
  };
  const buttonBox = () => ({ left: target.x, top: target.y, right: target.x + size(), bottom: target.y + size(), width: size(), height: size() });
  /** The button at its stored place, inside the safe area as it is now (after a rotation or resize too). */
  const place = () => {
    if (!active) return;
    if (!floating) {
      if (open) placePanel();
      return;
    }
    const b = bounds(position.side);
    moveTo(position.side === 'left' ? b.left : Math.max(b.left, b.right), b.top + Math.max(0, b.bottom - b.top) * position.y);
    root.dataset.side = position.side;
    if (open) placePanel();
    if (!hint.hidden) placeHint();
  };

  /**
   * Floating: beside the button (landscape) or above/below it (portrait), never over it. From the
   * header: under "Cài đặt", its right edge in line with the button's.
   */
  const placePanel = () => {
    const box = safeBox();
    const style = panel.style;
    style.top = style.bottom = style.left = style.width = style.maxHeight = '';
    if (!floating) {
      const button = anchor.getBoundingClientRect();
      const width = Math.min(400, box.width - 2 * GAP);
      const top = button.bottom + 8;
      style.left = `${Math.min(Math.max(box.left + GAP, button.right - width), box.right - GAP - width)}px`;
      style.width = `${width}px`;
      style.top = `${top}px`;
      style.maxHeight = `${box.bottom - GAP - top}px`;
      return;
    }
    const button = buttonBox();
    if (box.width > box.height) {
      const width = Math.min(400, box.width - button.width - 3 * GAP);
      const left = position.side === 'right' ? button.left - GAP - width : button.right + GAP;
      style.left = `${Math.max(box.left + GAP, left)}px`;
      style.width = `${width}px`;
      style.top = `${box.top + GAP}px`;
      style.maxHeight = `${box.height - 2 * GAP}px`;
    } else {
      style.left = `${box.left + GAP}px`;
      style.width = `${box.width - 2 * GAP}px`;
      if (button.top + button.height / 2 > box.top + box.height / 2) {
        // Button in the lower half: the panel ends just above it.
        style.bottom = `${window.innerHeight - (button.top - GAP)}px`;
        style.maxHeight = `${button.top - GAP - (box.top + GAP)}px`;
      } else {
        style.top = `${button.bottom + GAP}px`;
        style.maxHeight = `${box.bottom - GAP - (button.bottom + GAP)}px`;
      }
    }
  };

  const placeHint = () => {
    const box = safeBox();
    const button = buttonBox();
    const style = hint.style;
    const width = Math.min(300, box.width - 2 * GAP);
    style.width = `${width}px`;
    style.left = `${Math.min(Math.max(box.left + GAP, position.side === 'right' ? button.right - width : button.left), box.right - GAP - width)}px`;
    style.top = style.bottom = '';
    if (button.top + button.height / 2 > box.top + box.height / 2) {
      // Above the button, and above the overlay stack (the film's problems, the credit) when that
      // stack is down in the same corner: the hint never hides an error.
      const clear = options.keepClear?.();
      const lower = clear && clear.height > 0 && clear.bottom > button.top ? clear.top : Infinity;
      style.bottom = `${window.innerHeight - (Math.min(button.top, lower) - GAP)}px`;
    } else {
      style.top = `${button.bottom + GAP}px`;
    }
  };

  // ------------------------------------------------------------------ rest
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    clearTimeout(restTimer);
    root.dataset.rest = 'false';
    if (active && !open) restTimer = setTimeout(() => (root.dataset.rest = 'true'), REST_MS);
  };
  window.addEventListener('pointerdown', () => active && wake(), { capture: true, signal });
  toggle.addEventListener('focus', wake, { signal });

  // ------------------------------------------------------------------ drag (a press that moves) or tap
  let press: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let dragging = false;
  let suppressClick = false;
  /** When a press on the button last opened or closed the panel (its click, if any, is then skipped). */
  let pressedAt = -Infinity;
  const togglePanel = () => (open ? api.close(true) : api.open());
  toggle.addEventListener(
    'pointerdown',
    (event) => {
      if (!active || !floating || event.button !== 0) return;
      const rect = toggle.getBoundingClientRect();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      dragging = false;
    },
    { signal },
  );
  // Moves and the release are followed on the window: a touch can lose the button's pointer capture,
  // and the drag must still end (and snap) wherever the finger is lifted.
  window.addEventListener(
    'pointermove',
    (event) => {
      // No dragging while the panel is open (it is placed around the button).
      if (!press || event.pointerId !== press.id || open) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        dragging = true;
        try {
          toggle.setPointerCapture(event.pointerId);
        } catch {
          // Already released or captured elsewhere: the window still follows it.
        }
        root.dataset.dragging = 'true';
        hideHintSilently();
      }
      const b = bounds();
      moveTo(Math.min(b.right, Math.max(b.left, press.left + dx)), Math.min(b.bottom, Math.max(b.top, press.top + dy)));
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    press = null;
    if (!dragging) {
      // A tap: the press itself opens or closes the panel. Browsers do not always follow a touch with
      // a click (seen after a drag in Chrome's touch emulation); a click that does follow is skipped.
      if (event.type === 'pointerup' && toggle.contains(event.target as Node)) {
        pressedAt = performance.now();
        togglePanel();
      }
      return;
    }
    dragging = false;
    suppressClick = true;
    root.dataset.dragging = 'false';
    // Snap to the nearest side; keep the height (within that side's range: above the stick on the left).
    const b = bounds();
    const rect = toggle.getBoundingClientRect();
    const side: Position['side'] = rect.left + rect.width / 2 < (b.left + b.right + size()) / 2 ? 'left' : 'right';
    const range = bounds(side);
    position = { side, y: range.bottom > range.top ? Math.min(1, Math.max(0, (rect.top - range.top) / (range.bottom - range.top))) : 1 };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch {
      // Not stored: it still stays there for this visit.
    }
    place();
    // A click may or may not follow the release (touch vs mouse); either way it is not a tap.
    setTimeout(() => (suppressClick = false), 0);
  };
  window.addEventListener('pointerup', release, { signal });
  window.addEventListener('pointercancel', release, { signal });
  toggle.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      // Keyboard (Enter, Space: detail 0) and assistive technology that only sends a click; a click
      // after a press already handled is skipped.
      if (event.detail > 0 && performance.now() - pressedAt < 1000) return;
      togglePanel();
    },
    { signal },
  );
  anchor.addEventListener('click', () => active && !floating && togglePanel(), { signal });

  // ------------------------------------------------------------------ closing
  // The scrim covers the room, so a press there never reaches the camera or a seat. It closes the
  // panel once the press is over (a click): hiding it under a finger that is still down can leave the
  // browser's touch handling waiting, with no more frames drawn.
  scrim.addEventListener('click', () => api.close(false), { signal });
  close.addEventListener('click', () => api.close(true), { signal });
  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // A sub-screen goes back to the one it came from; the first one closes.
        if (!goBack()) api.close(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden]'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal },
  );
  // Camera moves, the seat map and other actions that need the room in sight close the panel.
  panel.addEventListener(
    'click',
    (event) => {
      const control = (event.target as Element | null)?.closest<HTMLElement>(options.closeOn);
      if (!control || !panel.contains(control) || (control as HTMLButtonElement).disabled) return;
      // Focus goes back to the button unless the action took it somewhere (the seat map's dialog).
      api.close(panel.contains(document.activeElement));
    },
    { signal },
  );
  hintClose.addEventListener('click', () => api.hideHint(), { signal });

  const onViewport = () => place();
  window.addEventListener('resize', onViewport, { signal });
  window.visualViewport?.addEventListener('resize', onViewport, { signal });

  const hideHintSilently = () => {
    if (hint.hidden) return;
    hint.hidden = true;
    const done = onHintDismiss;
    onHintDismiss = null;
    done?.();
  };

  const api: ControlHub = {
    root,
    toggle,
    panel,
    tasks,
    get isOpen() {
      return open;
    },
    get view() {
      return view;
    },
    content: (id) => (id === 'task' ? taskContent : views.get(id)!),
    link: (id, label, action) => navRow(label, action, id),
    setNow(text) {
      if (now.textContent !== text) now.textContent = text;
    },
    open() {
      if (!active || open) return;
      open = true;
      hideHintSilently();
      clearTimeout(restTimer);
      root.dataset.rest = 'false';
      root.dataset.open = 'true';
      opener().setAttribute('aria-expanded', 'true');
      scrim.hidden = false;
      panel.hidden = false;
      show(firstView(), null);
      options.onOpenChange(true);
      title.focus({ preventScroll: true });
    },
    close(focusToggle = false) {
      if (!open) return;
      open = false;
      root.dataset.open = 'false';
      opener().setAttribute('aria-expanded', 'false');
      const hadFocus = panel.contains(document.activeElement);
      scrim.hidden = true;
      panel.hidden = true;
      // Next time it opens on its first screen again (the task at hand on a phone).
      show(firstView(), null);
      openers.clear();
      options.onOpenChange(false);
      if (focusToggle || hadFocus) opener().focus({ preventScroll: true });
      wake();
    },
    refresh() {
      place();
    },
    setActive(next) {
      if (next === active) return;
      if (!next) {
        api.close(false);
        hideHintSilently();
      }
      active = next;
      root.dataset.active = String(next);
      if (next) {
        place();
        wake();
      } else {
        clearTimeout(restTimer);
      }
    },
    setFloating(next) {
      if (next === floating) return;
      api.close(false);
      hideHintSilently();
      floating = next;
      root.dataset.floating = String(next);
      close.setAttribute('aria-label', next ? 'Đóng điều khiển rạp' : 'Đóng cài đặt');
      show(firstView(), null);
      place();
      wake();
    },
    showHint(lines, onDismiss) {
      if (!active || open || !floating) return;
      hintText.replaceChildren(...lines.map((line) => el('p', '', line)));
      onHintDismiss = onDismiss;
      hint.hidden = false;
      placeHint();
    },
    hideHint() {
      hideHintSilently();
      if (active) opener().focus({ preventScroll: true });
    },
    dispose() {
      clearTimeout(restTimer);
      listeners.abort();
      root.remove();
    },
  };
  root.dataset.open = 'false';
  root.dataset.rest = 'false';
  root.dataset.active = 'false';
  root.dataset.floating = 'true';
  show(firstView(), null);
  return api;
}
