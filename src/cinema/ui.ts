import { BRAND, markImg } from '../brand.ts';
import { loadReducedGlass, setReducedGlass } from '../glass.ts';
import { isPlainClick } from '../router.ts';
import type { ToggleablePart } from './architecture.ts';
import { CAMERA_PRESETS, type CameraPresetId } from './cameraPresets.ts';
import { createControlHub } from './controlHub.ts';
import type { FilmSource } from './media.ts';
import { QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import { CINEMA_TASKS, type CinemaTask, type PanelState } from './taskLayout.ts';

export const TOGGLEABLE_PARTS: ReadonlyArray<{ part: ToggleablePart; label: string }> = [
  { part: 'ceiling', label: 'Trần' },
  { part: 'backWall', label: 'Vách sau' },
  { part: 'rightWall', label: 'Vách phải' },
];

export interface CinemaUiHandlers {
  /** Khám phá, Chọn ghế or Xem phim (the task switch). */
  onTask(task: CinemaTask): void;
  onPreset(id: CameraPresetId): void;
  onReset(): void;
  /** Starts the tour, or stops it while it runs. */
  onTour(): void;
  /** Reduced-motion tour: previous (−1) or next (+1) stop. */
  onTourStep(delta: number): void;
  /** Starts walking ("Đi bộ"), or stops it while walking. */
  onExplore(): void;
  onToggle(part: ToggleablePart, visible: boolean): void;
  onQuality(level: QualityLevel): void;
  onOpenInspector(): void;
  /** Leaves a seat view for the view it was opened from. */
  onReturn(): void;
  /** The action next to "Góc nhìn" in Xem phim (view from the chosen seat, or go choose one). */
  onWatchAction(): void;
  /** Builds the 3D scene again (after a failure, or a context the browser does not give back). */
  onRetryScene(): void;
  /** The brand link back to the landing page, in-app (a plain link without it). */
  onHome?(): void;
  /** "Xem từ ghế này" on the card that follows a seat tapped in the room (phone layout). */
  onSeatCardView(seatId: string): void;
}

export interface CinemaUiOptions {
  /** A touch screen: the help speaks of fingers rather than a mouse. */
  touch: boolean;
  /** The film's title and attribution, for Cài đặt › Thông tin (the player keeps its own credit). */
  film: Pick<FilmSource, 'title' | 'credit' | 'creditUrl' | 'license' | 'licenseUrl'>;
}

/**
 * - `loading`: `code` while the 3D part of the app downloads, `scene` while the room is built;
 * - `context-lost`: `stuck` once the browser has not given the context back for a while;
 * - `error`: `retry` offers to build the scene again (not for a browser without WebGL).
 */
export type UiStatus =
  | { kind: 'loading'; step?: 'code' | 'scene' }
  | { kind: 'ready' }
  | { kind: 'context-lost'; stuck?: boolean }
  | { kind: 'error'; message: string; retry?: boolean };

/** What the tour bar shows; null hides it. */
export interface UiTourStatus {
  steps: boolean;
  stopIndex: number;
  stopCount: number;
  label: string;
}

export interface CinemaUi {
  root: HTMLElement;
  /** Element the 3D canvas (and the explore stick) is mounted into. */
  viewport: HTMLElement;
  /** The 3D view with its overlays (tour bar, way back, notices, status, the task bar). */
  stage: HTMLElement;
  /** The column of the view (and, on portrait tablets, the seat sheet under it). */
  screen: HTMLElement;
  /** The row of that column and the seat panel. */
  main: HTMLElement;
  /** Each task's controls: over the room above the task switch, or in the phone's round-button panel. */
  dock: Record<CinemaTask, HTMLElement>;
  /** "Góc nhìn: …" line of Xem phim, placed by the page next to the player. */
  watchView: HTMLElement;
  /** The task switch's button for `task` (focus goes back to it when what held focus is gone). */
  taskButton(task: CinemaTask): HTMLButtonElement;
  setTask(task: CinemaTask): void;
  /** Number of chosen seats, on the "Chọn ghế" switch. */
  setSeatCount(count: number): void;
  /** Mirrors the seat panel; a full-screen sheet makes the rest of the page inert (modal). */
  setPanel(state: PanelState): void;
  /** A short visual notice over the viewport (screen readers get the panel's live region). */
  setNotice(text: string): void;
  /** Shows the "back" button over the viewport with this label, or hides it (null). */
  setReturn(label: string | null): void;
  setActivePreset(id: CameraPresetId | null): void;
  setCameraState(state: string): void;
  setTour(status: UiTourStatus | null): void;
  setExploring(active: boolean): void;
  setPartVisible(part: ToggleablePart, visible: boolean): void;
  setQuality(level: QualityLevel): void;
  setCaption(text: string): void;
  setStatus(status: UiStatus): void;
  setTransitioning(active: boolean): void;
  /** Camera, display and inspection controls need the scene: off (with the reason) while there is none. */
  setSceneControls(available: boolean, reason?: string): void;
  setWatchView(text: string, action: string | null): void;
  /** The film is playing: in Xem phim the task switch steps back while nobody touches the page. */
  setPlaying(playing: boolean): void;
  /** Closes the control panel (and the "Góc khác" menu). */
  closeMenus(): void;
  /**
   * Phones (`immersive`): the room fills the screen and the task switch, the task's controls and
   * the settings open from a floating round button. Otherwise the tasks sit in a bar over the room
   * and "Cài đặt" in the header drops down the settings. Same elements either way.
   */
  setLayout(immersive: boolean): void;
  /** The button that opens the control panel now: where focus goes when what held it is gone. */
  readonly hubToggle: HTMLButtonElement;
  /** Phone layout: a small card for the seat just tapped in the room, with "Xem từ ghế này". */
  showSeatCard(seatId: string, text: string, canView: boolean): void;
  /** Phone layout, first visit: how the room and the control button work (once; again from Trợ giúp). */
  offerHubHint(): void;
  /**
   * The film's status chip (problems, "Thử lại"): at the head of the task bar, or on a phone at the
   * head of the overlay stack, so it never meets the way back or the tour bar.
   */
  attachFilmStatus(element: HTMLElement): void;
  /** The film's small play/pause: in the header, or on a phone at the foot of the overlay stack. */
  attachMini(element: HTMLElement): void;
  /** Without 3D: shows the film's own element in the viewport area, labelled as the 2D mode. */
  showVideo2d(video: HTMLVideoElement, label: string): void;
  hideVideo2d(): void;
  dispose(): void;
}

export const ICONS = {
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 1.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4zm3.4 3.8-4.6 2.2-2.2 4.6 4.6-2.2zm-3.4 2.4a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  seats: 'M7.5 4h9A2.5 2.5 0 0 1 19 6.5V11h.5a1.5 1.5 0 0 1 1.5 1.5V18h-2v2h-1.8v-2H6.8v2H5v-2H3v-5.5A1.5 1.5 0 0 1 4.5 11H5V6.5A2.5 2.5 0 0 1 7.5 4zm0 1.8a.7.7 0 0 0-.7.7V11h10.4V6.5a.7.7 0 0 0-.7-.7zm-2.7 7v3.4h14.4v-3.4z',
  watch: 'M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zm.3 1.8v10.4h14.4V6.8zm5.2 2.4 5 2.8-5 2.8z',
  settings:
    'M4 6.1h8.2a2.6 2.6 0 0 1 5 0H20v1.8h-2.8a2.6 2.6 0 0 1-5 0H4zm10.7.9a.8.8 0 1 0 0 0zM4 16.1h2.8a2.6 2.6 0 0 1 5 0H20v1.8h-8.2a2.6 2.6 0 0 1-5 0H4zM9.3 17a.8.8 0 1 0 0 0z',
  more: 'M7 10l5 5 5-5z',
  reset: 'M12 5a7 7 0 1 1-6.6 9.3l1.7-.6A5.2 5.2 0 1 0 8.4 8.3L10.5 10H4.6V4.1l2.5 2.5A7 7 0 0 1 12 5z',
  tour: 'M12 3.2a6.3 6.3 0 0 1 6.3 6.3c0 4.4-5 9.9-5.7 10.6a.8.8 0 0 1-1.2 0C10.7 19.4 5.7 13.9 5.7 9.5A6.3 6.3 0 0 1 12 3.2zm0 3.9a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
  walk: 'M13.5 2.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM10 8.2l2.6-.9a1.6 1.6 0 0 1 1.9.8l1.2 2.4 2.5 1-.7 1.7-3-1.2-.6-1.2-.9 3.6 2.2 2.4.9 4.5h-1.9l-.8-3.8-2.3-2.2-.9 3.1-2.8 2.9-1.3-1.3 2.5-2.6 1.4-5.9-.9.4-1.2 2.6-1.7-.8 1.5-3.2z',
  map: 'M4 5h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 11h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 17h4v2H4zm6 0h4v2h-4zm6 0h4v2h-4z',
  chevron: 'M9.2 5.6 7.8 7l5 5-5 5 1.4 1.4 6.4-6.4z',
  back: 'M14.8 5.6 16.2 7l-5 5 5 5-1.4 1.4L8.4 12z',
  stop: 'M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z',
  fullscreen: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
  // Khám phá's views: the room from the back (screen and curved rows), the seats from the front (an
  // armchair), the view from one seat (an eye; also "Xem từ ghế …"), and the rarer views (stacked frames).
  overview: 'M6 4h12a1 1 0 0 1 1 1v1.6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm-1 7.2c4.6 1.6 9.4 1.6 14 0v2.2c-4.6 1.6-9.4 1.6-14 0zM3 16c5.9 2.1 12.1 2.1 18 0v2.2c-5.9 2.1-12.1 2.1-18 0z',
  seatsView: 'M7.5 4h9A1.5 1.5 0 0 1 18 5.5V12H6V5.5A1.5 1.5 0 0 1 7.5 4zM3 11h2.2v3.3h13.6V11H21v5.5a1 1 0 0 1-1 1h-1V20h-2v-2.5H7V20H5v-2.5H4a1 1 0 0 1-1-1z',
  eye: 'M3 12c1.4-3.4 4.8-6 9-6s7.6 2.6 9 6c-1.4 3.4-4.8 6-9 6s-7.6-2.6-9-6zm1.9 0c1.2 2.4 3.9 4.2 7.1 4.2s5.9-1.8 7.1-4.2c-1.2-2.4-3.9-4.2-7.1-4.2S6.1 9.6 4.9 12zM12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z',
  views: 'M3.5 8h12A1.5 1.5 0 0 1 17 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 2 18.5v-9A1.5 1.5 0 0 1 3.5 8zM7 4h13.5A1.5 1.5 0 0 1 22 5.5v10a1.5 1.5 0 0 1-1.5 1.5H19v-1.8h1.2V5.8H8.8v.8H7z',
};

/** The visitor views' icons (the inspection views are rows in Công cụ nâng cao, words only). */
const PRESET_ICONS: Partial<Record<CameraPresetId, string>> = { overview: ICONS.overview, seats: ICONS.seatsView, seatEye: ICONS.eye };

/** An inline icon (decorative: the control around it carries the name). */
export function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('cinema-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** How long Xem phim waits, film playing and nobody touching the page, before the task switch steps back. */
const REST_MS = 3500;

/**
 * Builds the /cinema page chrome: the room fills the window and the controls float over it, in
 * glass, grouped by task.
 *
 * - The header: two small clusters along the top edge, the brand (home) on the left, the film's
 *   mini control and "Cài đặt" (Hiển thị; Hướng dẫn nhanh, Thông tin, Công cụ nâng cao; the way
 *   home) on the right.
 * - The task bar, bottom centre: the task switch (Khám phá, Chọn ghế, Xem phim) and, above it, only
 *   the current task's controls: camera views, tour and walking; the chosen seats and the map; the
 *   player. The film's problems head that stack.
 * - Over the view: tour bar, way back, notices and status.
 * - The seat map: a glass sidebar over the room, or a sheet under it on portrait screens.
 * The "Góc khác" menu is a non-modal popover; a press on the 3D view that closes it goes no further
 * (it never selects a seat or turns the camera). State is mirrored onto `data-*` attributes of the
 * root so automated checks can wait on it.
 *
 * On phones the header and the task bar leave; one floating round button opens all of it
 * (see `setLayout`).
 */
export function createCinemaUi(host: HTMLElement, handlers: CinemaUiHandlers, options: CinemaUiOptions): CinemaUi {
  const listeners = new AbortController();
  const { signal } = listeners;

  const root = el('div', 'cinema-app cinema-app--room');
  root.dataset.status = 'loading';
  root.dataset.touch = String(options.touch);

  const button = (label: string, className = 'cinema-button') => {
    const element = el('button', className, label);
    element.type = 'button';
    return element;
  };
  const presetButtons = new Map<CameraPresetId, HTMLButtonElement>();
  const presetButton = (id: CameraPresetId, className?: string) => {
    const preset = CAMERA_PRESETS.find((p) => p.id === id)!;
    const glyph = PRESET_ICONS[id];
    const element = button(glyph ? '' : preset.label, className);
    if (glyph) element.append(icon(glyph), el('span', '', preset.label));
    element.dataset.preset = id;
    element.setAttribute('aria-pressed', 'false');
    element.addEventListener('click', () => handlers.onPreset(id), { signal });
    presetButtons.set(id, element);
    return element;
  };

  // ------------------------------------------------------------------ menus
  const menus: Array<{ toggle: HTMLButtonElement; panel: HTMLElement }> = [];
  const menuOpen = (menu: { panel: HTMLElement }) => menu.panel.dataset.open === 'true';
  const setMenu = (menu: { toggle: HTMLButtonElement; panel: HTMLElement }, open: boolean, focusToggle = false) => {
    menu.panel.dataset.open = String(open);
    menu.toggle.setAttribute('aria-expanded', String(open));
    if (!open && focusToggle) menu.toggle.focus();
  };
  const menu = (toggle: HTMLButtonElement, panel: HTMLElement) => {
    const entry = { toggle, panel };
    menus.push(entry);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panel.id);
    panel.dataset.open = 'false';
    toggle.addEventListener(
      'click',
      () => {
        const open = !menuOpen(entry);
        for (const other of menus) if (other !== entry && menuOpen(other)) setMenu(other, false);
        setMenu(entry, open);
      },
      { signal },
    );
    panel.addEventListener(
      'keydown',
      (event) => {
        // Only while it is a popover that is open (in the phone's hub it is a section: Escape is the hub's).
        if (event.key !== 'Escape' || !menuOpen(entry)) return;
        event.preventDefault();
        event.stopPropagation();
        setMenu(entry, false, true);
      },
      { signal },
    );
    return entry;
  };

  // ------------------------------------------------------------------ header
  const header = el('header', 'cinema-header');
  // The brand leads home; the page's own heading is for screen readers (focus lands on it after
  // in-app navigation).
  const home = el('a', 'cinema-brand');
  home.href = '/';
  home.dataset.action = 'home';
  home.setAttribute('aria-label', `${BRAND.name}, về trang chủ`);
  home.innerHTML = `${markImg(32)}<span class="cinema-brand__name" aria-hidden="true">${BRAND.name}</span>`;
  home.addEventListener(
    'click',
    (event) => {
      if (!handlers.onHome || !isPlainClick(event, home.target)) return;
      event.preventDefault();
      handlers.onHome();
    },
    { signal },
  );
  const title = el('h1', 'cinema-title visually-hidden', 'Phòng chiếu 3D');
  title.tabIndex = -1;

  const headerEnd = el('div', 'cinema-header__end');
  const miniSlot = el('div', 'cinema-header__mini');

  // Opens Cài đặt (the hub's panel, dropped down under it).
  const settingsButton = button('', 'cinema-button cinema-menu__toggle');
  settingsButton.dataset.action = 'settings';
  settingsButton.setAttribute('aria-label', 'Cài đặt');
  settingsButton.append(icon(ICONS.settings), el('span', 'cinema-menu__label', 'Cài đặt'));

  // Cài đặt › Hiển thị: one row each, the label on the left and its control on the right.
  const qualityRow = el('div', 'cinema-hub__row cinema-hub__row--quality');
  const qualityHeading = el('span', 'cinema-hub__label', 'Chất lượng');
  qualityHeading.id = 'cinema-quality-heading';
  const qualityGroup = el('div', 'cinema-segmented');
  qualityGroup.setAttribute('role', 'group');
  qualityGroup.setAttribute('aria-labelledby', qualityHeading.id);
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const element = button(QUALITY_LABELS[level], 'cinema-segmented__button');
    element.dataset.quality = level;
    element.setAttribute('aria-pressed', 'false');
    element.setAttribute('aria-label', `Chất lượng ${QUALITY_LABELS[level].toLowerCase()}`);
    element.addEventListener('click', () => handlers.onQuality(level), { signal });
    qualityButtons.set(level, element);
    qualityGroup.append(element);
  }
  qualityRow.append(qualityHeading, qualityGroup);

  // Giảm hiệu ứng kính: solid panes (also follows the system's "reduce transparency").
  const glass = switchControl('Giảm hiệu ứng kính', 'glass', loadReducedGlass(), (on) => setReducedGlass(on), signal);
  glass.wrapper.classList.add('cinema-hub__row');

  // Công cụ nâng cao: technical views, cut-away switches, the seat inspector.
  const inspectViews = el('div', 'cinema-hub__rows');
  for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'inspection')) {
    inspectViews.append(presetButton(preset.id, 'cinema-hub__row cinema-hub__row--button'));
  }
  const visibilityRows = el('div', 'cinema-hub__rows');
  const toggles = new Map<ToggleablePart, HTMLInputElement>();
  for (const { part, label } of TOGGLEABLE_PARTS) {
    const { wrapper, input } = switchControl(label, part, true, (checked) => handlers.onToggle(part, checked), signal);
    wrapper.classList.add('cinema-hub__row');
    toggles.set(part, input);
    visibilityRows.append(wrapper);
  }
  const inspectorButton = button('', 'cinema-hub__row cinema-hub__row--button cinema-hub__row--nav');
  inspectorButton.dataset.action = 'open-inspector';
  inspectorButton.append(el('span', 'cinema-hub__label', 'Kiểm tra ghế'), icon(ICONS.chevron));
  inspectorButton.addEventListener('click', () => handlers.onOpenInspector(), { signal });

  headerEnd.append(miniSlot, settingsButton);
  header.append(title, home, headerEnd);

  // ------------------------------------------------------------------ the view
  const stage = el('div', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const caption = el('p', 'cinema-caption');
  caption.setAttribute('aria-live', 'polite');
  // The caption is read out but not drawn over the room (the CSS hides it; the control panel shows
  // it under its title). On phones the corner holds the card for a seat tapped in the room.
  const overlay = el('div', 'cinema-overlay');
  let captionTimer: ReturnType<typeof setTimeout> | undefined;
  const seatCard = el('section', 'cinema-seatcard');
  seatCard.hidden = true;
  seatCard.setAttribute('aria-label', 'Ghế vừa chạm');
  seatCard.dataset.keys = 'own';
  const seatCardText = el('p', 'cinema-seatcard__text');
  const seatCardView = button('', 'cinema-button cinema-button--compact cinema-button--accent cinema-seatcard__view');
  seatCardView.append(icon(ICONS.eye), el('span', '', 'Xem từ ghế này'));
  seatCardView.dataset.action = 'card-view-seat';
  const seatCardClose = button('', 'cinema-button cinema-button--compact cinema-button--icon cinema-seatcard__close');
  seatCardClose.dataset.action = 'card-close';
  seatCardClose.setAttribute('aria-label', 'Đóng thẻ ghế');
  seatCardClose.append(icon(CLOSE_ICON));
  seatCard.append(seatCardText, seatCardView, seatCardClose);
  let seatCardId: string | null = null;
  let seatCardTimer: ReturnType<typeof setTimeout> | undefined;
  const hideSeatCard = () => {
    clearTimeout(seatCardTimer);
    const hadFocus = seatCard.contains(document.activeElement);
    seatCard.hidden = true;
    seatCardId = null;
    if (hadFocus) hub.toggle.focus({ preventScroll: true });
  };
  // A moment to read and reach it; kept while a finger, the mouse or focus is on it.
  const armSeatCard = () => {
    clearTimeout(seatCardTimer);
    seatCardTimer = setTimeout(() => {
      if (!seatCard.matches(':hover, :focus-within')) hideSeatCard();
      else armSeatCard();
    }, 8000);
  };
  seatCardView.addEventListener(
    'click',
    () => {
      const id = seatCardId;
      hideSeatCard();
      if (id) handlers.onSeatCardView(id);
    },
    { signal },
  );
  seatCardClose.addEventListener('click', hideSeatCard, { signal });
  overlay.append(seatCard, caption);

  // The tour as a live card at the top: the pin, "Đang tham quan · 2/6" over the stop's name and a
  // segment per stop, then the way out; stepping (reduced motion) adds "Trước" / "Tiếp" under it.
  // The card is for the eyes; a hidden live line says the same to screen readers, once per stop.
  const tourBar = el('div', 'cinema-tourbar');
  tourBar.hidden = true;
  const tourText = el('span', 'visually-hidden');
  tourText.setAttribute('aria-live', 'polite');
  const tourIcon = el('span', 'cinema-tourbar__icon');
  tourIcon.append(icon(ICONS.tour));
  const tourInfo = el('span', 'cinema-tourbar__info');
  tourInfo.setAttribute('aria-hidden', 'true');
  const tourMeta = el('span', 'cinema-tourbar__meta');
  const tourTitle = el('span', 'cinema-tourbar__title');
  const tourProgress = el('span', 'cinema-tourbar__progress');
  tourInfo.append(tourMeta, tourTitle, tourProgress);
  const tourBarButton = (action: string, glyph: string, text: string, iconAfter = false) => {
    const element = button('', 'cinema-button cinema-button--compact');
    element.dataset.action = action;
    const label = el('span', '', text);
    if (iconAfter) element.append(label, icon(glyph));
    else element.append(icon(glyph), label);
    return { element, label };
  };
  const previousStop = tourBarButton('tour-previous', ICONS.back, 'Trước');
  previousStop.element.addEventListener('click', () => handlers.onTourStep(-1), { signal });
  const nextStop = tourBarButton('tour-next', ICONS.chevron, 'Tiếp', true);
  nextStop.element.addEventListener('click', () => handlers.onTourStep(1), { signal });
  const stopTour = tourBarButton('tour-stop', ICONS.stop, 'Dừng');
  stopTour.element.classList.add('cinema-tourbar__stop');
  stopTour.element.addEventListener('click', () => handlers.onTour(), { signal });
  const tourSteps = el('span', 'cinema-tourbar__steps');
  tourSteps.append(previousStop.element, nextStop.element);
  tourBar.append(tourText, tourIcon, tourInfo, stopTour.element, tourSteps);

  const notice = el('p', 'cinema-notice');
  notice.setAttribute('aria-hidden', 'true');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const returnButton = button('', 'cinema-button cinema-button--compact cinema-return');
  returnButton.dataset.action = 'return';
  returnButton.hidden = true;
  returnButton.addEventListener('click', () => handlers.onReturn(), { signal });

  const status = el('div', 'cinema-status');
  status.setAttribute('role', 'status');

  // ------------------------------------------------------------------ the task bar
  // Bottom centre over the room: the film's problems, the current task's controls, the switch.
  const taskBar = el('div', 'cinema-taskbar');
  const taskTools = el('div', 'cinema-taskbar__tools');
  const tasks = el('div', 'cinema-tasks');
  tasks.setAttribute('role', 'group');
  tasks.setAttribute('aria-label', 'Tác vụ');
  const taskButtons = new Map<CinemaTask, HTMLButtonElement>();
  const seatCount = el('span', 'cinema-tasks__count');
  seatCount.setAttribute('aria-hidden', 'true');
  seatCount.hidden = true;
  for (const { id, label } of CINEMA_TASKS) {
    const element = el('button', 'cinema-tasks__button');
    element.type = 'button';
    element.dataset.task = id;
    element.setAttribute('aria-pressed', 'false');
    element.append(icon(ICONS[id]), el('span', 'cinema-tasks__label', label));
    if (id === 'seats') element.append(seatCount);
    element.addEventListener('click', () => handlers.onTask(id), { signal });
    taskButtons.set(id, element);
    tasks.append(element);
  }
  taskBar.append(taskTools, tasks);
  stage.append(viewport, overlay, tourBar, returnButton, notice, status, taskBar);

  // ------------------------------------------------------------------ each task's controls
  const dockPanel = (task: CinemaTask) => {
    const section = el('section', 'cinema-dock__panel');
    section.dataset.dock = task;
    section.setAttribute('aria-label', CINEMA_TASKS.find((t) => t.id === task)!.label);
    return section;
  };
  const dock: Record<CinemaTask, HTMLElement> = { explore: dockPanel('explore'), seats: dockPanel('seats'), watch: dockPanel('watch') };

  // Khám phá: the visitor views (the rarer ones fold into "Góc khác" on narrow screens), the tour
  // and walking. Every button is an icon then its words; labels never change with state (pressed
  // shows it), so the row never re-wraps. In the hub each group has a small title.
  const exploreGroup = (label: string) => {
    const element = group(label);
    const title = el('span', 'cinema-explore__title', label);
    title.setAttribute('aria-hidden', 'true');
    element.append(title);
    return element;
  };
  const views = exploreGroup('Góc nhìn');
  views.classList.add('cinema-explore__views');
  const moreToggle = button('', 'cinema-button cinema-more__toggle');
  moreToggle.dataset.action = 'more-views';
  moreToggle.append(icon(ICONS.views), el('span', '', 'Góc khác'), icon(ICONS.more));
  const morePanel = el('div', 'cinema-more');
  morePanel.id = 'cinema-more-views';
  const resetButton = button('', 'cinema-button cinema-explore__reset');
  resetButton.dataset.action = 'reset';
  resetButton.title = 'Về góc ban đầu';
  resetButton.append(icon(ICONS.reset), el('span', 'cinema-explore__reset-label', 'Về góc ban đầu'));
  resetButton.addEventListener('click', () => handlers.onReset(), { signal });
  morePanel.append(presetButton('seats'), presetButton('seatEye'), resetButton);
  views.append(presetButton('overview'), moreToggle, morePanel);
  const moreMenu = menu(moreToggle, morePanel);
  for (const element of morePanel.querySelectorAll('button')) {
    element.addEventListener('click', () => menuOpen(moreMenu) && setMenu(moreMenu, false, true), { signal });
  }

  const modes = exploreGroup('Di chuyển');
  modes.classList.add('cinema-explore__modes');
  const tourButton = button('', 'cinema-button cinema-mode');
  tourButton.dataset.action = 'tour';
  tourButton.setAttribute('aria-pressed', 'false');
  tourButton.append(icon(ICONS.tour), el('span', '', 'Tham quan'));
  tourButton.addEventListener('click', () => handlers.onTour(), { signal });
  const exploreButton = button('', 'cinema-button cinema-mode');
  exploreButton.dataset.action = 'explore';
  exploreButton.setAttribute('aria-pressed', 'false');
  exploreButton.append(icon(ICONS.walk), el('span', '', 'Đi bộ'));
  exploreButton.addEventListener('click', () => handlers.onExplore(), { signal });
  modes.append(tourButton, exploreButton);
  const exploreRow = el('div', 'cinema-explore');
  const sceneNote = el('p', 'cinema-dock__note');
  sceneNote.hidden = true;
  exploreRow.append(views, modes);
  dock.explore.append(exploreRow, sceneNote);

  // Xem phim: where the camera is, and the one camera action that fits.
  const watchView = el('div', 'cinema-watchview');
  const watchText = el('span', 'cinema-watchview__text');
  const watchAction = button('', 'cinema-button cinema-button--compact cinema-watchview__action');
  watchAction.dataset.action = 'watch-seat';
  watchAction.hidden = true;
  watchAction.addEventListener('click', () => handlers.onWatchAction(), { signal });
  watchView.append(watchText, watchAction);

  taskTools.append(dock.explore, dock.seats, dock.watch);

  const screen = el('div', 'cinema-screen');
  screen.append(stage);
  const main = el('main', 'cinema-main');
  main.append(screen);

  root.append(header, main);
  host.replaceChildren(root);

  // ------------------------------------------------------------------ the control hub
  let immersive = false;
  let filmStatus: HTMLElement | null = null;
  let mini: HTMLElement | null = null;
  const placeFilmStatus = () => {
    if (!filmStatus) return;
    if (immersive) overlay.prepend(filmStatus);
    else taskBar.prepend(filmStatus);
  };
  const placeMini = () => {
    if (!mini) return;
    if (immersive) overlay.append(mini);
    else miniSlot.append(mini);
  };
  const hub = createControlHub(root, {
    anchor: settingsButton,
    // Actions that need the room in sight close the panel; settings, sound and seeking keep it open.
    closeOn: [
      '[data-preset]',
      '[data-action="reset"]',
      '[data-action="tour"]',
      '[data-action="explore"]',
      '[data-action="seat-panel"]',
      '[data-action="summary-view-seat"]',
      '[data-action="watch-seat"]',
      '[data-action="open-inspector"]',
      '[data-action="hub-home"]',
    ].join(', '),
    // A modal panel: the room and its overlays are out of reach (and of screen readers) meanwhile.
    onOpenChange: (open) => {
      main.inert = open;
      if (open) wakeTaskBar();
    },
    // The first-visit hint stays above the overlay stack (the film's problems, the credit).
    keepClear: () => (overlay.getClientRects().length > 0 ? overlay.getBoundingClientRect() : null),
  });
  // The stack grows (a film problem, the seat card): the hint moves up with it. The task bar's
  // height keeps the walking stick (touch screens) above it.
  const overlayResize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target === overlay && immersive) hub.refresh();
      if (target === taskBar) root.style.setProperty('--taskbar-height', `${Math.round(taskBar.getBoundingClientRect().height)}px`);
    }
  });
  overlayResize.observe(overlay);
  overlayResize.observe(taskBar);
  // ------------------------------------------------------------------ Cài đặt and its screens
  /** Rows one under the other, light separators between them (no card per row). */
  const rows = (...items: HTMLElement[]) => {
    const list = el('div', 'cinema-hub__rows');
    list.append(...items);
    return list;
  };
  /** A titled group of rows. */
  let groupCount = 0;
  const rowGroup = (label: string, list: HTMLElement) => {
    const section = el('section', 'cinema-hub__group');
    const heading = el('h3', 'cinema-hub__group-title', label);
    heading.id = `cinema-hub-group-${++groupCount}`;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(heading, list);
    return section;
  };
  // Why the display and inspection controls are off, while there is no scene (else empty, unseen).
  const settingsNote = el('p', 'cinema-hub__note cinema-hub__note--scene');
  const advancedNote = el('p', 'cinema-hub__note cinema-hub__note--scene');
  settingsNote.hidden = advancedNote.hidden = true;

  // Hiển thị › Toàn màn hình: the browser's full screen, where it can (never on iPhone Safari); the
  // page works without it. Its words follow the state; a refusal is said under it.
  const fullscreenLabel = el('span', 'cinema-hub__label', 'Toàn màn hình');
  const fullscreenButton = button('', 'cinema-hub__row cinema-hub__row--button cinema-hub__fullscreen');
  fullscreenButton.dataset.action = 'fullscreen';
  fullscreenButton.setAttribute('aria-pressed', 'false');
  fullscreenButton.append(fullscreenLabel, icon(ICONS.fullscreen));
  const fullscreenNote = el('p', 'cinema-hub__note');
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled;
  fullscreenButton.hidden = fullscreenNote.hidden = !fullscreenSupported;
  const paintFullscreen = () => {
    const on = document.fullscreenElement !== null;
    fullscreenButton.setAttribute('aria-pressed', String(on));
    fullscreenLabel.textContent = on ? 'Thoát toàn màn hình' : 'Toàn màn hình';
  };
  fullscreenButton.addEventListener(
    'click',
    () => {
      fullscreenNote.textContent = '';
      const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      request.catch(() => (fullscreenNote.textContent = 'Trình duyệt không cho bật toàn màn hình lúc này.'));
    },
    { signal },
  );
  document.addEventListener('fullscreenchange', paintFullscreen, { signal });

  // Về trang chủ: a plain link at the foot of Cài đặt.
  const homeLink = el('a', 'cinema-hub__home', 'Về trang chủ');
  homeLink.href = '/';
  homeLink.dataset.action = 'hub-home';
  homeLink.addEventListener(
    'click',
    (event) => {
      if (!handlers.onHome || !isPlainClick(event, homeLink.target)) return;
      event.preventDefault();
      handlers.onHome();
    },
    { signal },
  );
  const homeRow = el('div', 'cinema-hub__foot');
  homeRow.append(homeLink);

  hub.content('settings').append(
    settingsNote,
    rowGroup('Hiển thị', rows(qualityRow, glass.wrapper, fullscreenButton, fullscreenNote)),
    rowGroup(
      'Khác',
      rows(
        hub.link('help', 'Hướng dẫn nhanh', 'hub-help'),
        hub.link('about', 'Thông tin', 'hub-about'),
        // The action of the folded "Công cụ kiểm tra" it replaces (checks and scripts look for it).
        hub.link('advanced', 'Công cụ nâng cao', 'inspect-tools'),
      ),
    ),
    homeRow,
  );

  // Hướng dẫn nhanh: four lines, for the mouse or for a finger.
  const facts = (lines: ReadonlyArray<readonly [string, string | Node]>) => {
    const list = el('dl', 'cinema-hub__rows cinema-hub__facts');
    for (const [term, value] of lines) {
      const row = el('div', 'cinema-hub__row cinema-hub__fact');
      const definition = el('dd', 'cinema-hub__value');
      definition.append(value);
      row.append(el('dt', 'cinema-hub__label', term), definition);
      list.append(row);
    }
    return list;
  };
  hub.content('help').append(
    facts([
      ['Nhìn quanh', options.touch ? 'Kéo một ngón' : 'Kéo chuột'],
      ['Chọn ghế', options.touch ? 'Chạm ghế hoặc mở sơ đồ' : 'Bấm ghế hoặc mở sơ đồ'],
      ['Đi bộ', options.touch ? 'Cần điều khiển' : 'WASD, phím mũi tên'],
      ['Phát phim', 'Xem phim → Phát'],
    ]),
  );

  // Thông tin: what this is, and the film's attribution (the player shows it too, as the licence asks).
  const outLink = (label: string, href: string) => {
    const a = el('a', '', label);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  const about = el('div', 'cinema-hub__about');
  about.append(el('p', 'cinema-hub__about-name', BRAND.name), el('p', 'cinema-hub__about-note', 'Bản demo — không bán vé hoặc giữ chỗ.'));
  hub.content('about').append(
    about,
    rowGroup(
      'Phim trên màn chiếu',
      facts([
        ['Phim', options.film.title],
        ['Ghi công', outLink(options.film.credit, options.film.creditUrl)],
        ['Giấy phép', outLink(options.film.license, options.film.licenseUrl)],
      ]),
    ),
  );

  // Công cụ nâng cao.
  // Kiểm tra ghế opens another page: an action of its own, under the two groups.
  const inspectorRow = el('div', 'cinema-hub__group');
  inspectorRow.append(rows(inspectorButton));
  hub.content('advanced').append(advancedNote, rowGroup('Góc kiểm tra', inspectViews), rowGroup('Thành phần phòng', visibilityRows), inspectorRow);

  // The first-visit hint on phones: how the room works and where its controls are.
  const hintLines = options.touch
    ? ['Kéo một ngón để nhìn quanh, chụm hai ngón để phóng to hay thu nhỏ.', 'Chạm một ghế trong phòng để chọn, rồi “Xem từ ghế này”.', 'Khám phá, chọn ghế, xem phim và cài đặt: ở nút tròn này.']
    : ['Kéo chuột để nhìn quanh, cuộn để phóng to hay thu nhỏ.', 'Bấm một ghế trong phòng để chọn, rồi “Xem từ ghế này”.', 'Khám phá, chọn ghế, xem phim và cài đặt: ở nút tròn này.'];

  const HINT_KEY = 'tp-cinema-hub-hint';
  const showHint = () => hub.showHint(hintLines, () => {
    try {
      localStorage.setItem(HINT_KEY, 'seen');
    } catch {
      // Not remembered: it may show once more on the next visit.
    }
  });

  // Menus close on a press anywhere else. On the 3D view that press is used up, so dismissing a
  // menu never selects a seat or turns the camera.
  window.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Node | null;
      let closed = false;
      for (const entry of menus) {
        if (!menuOpen(entry) || entry.panel.contains(target) || entry.toggle.contains(target)) continue;
        setMenu(entry, false);
        closed = true;
      }
      if (closed && target && viewport.contains(target)) event.stopPropagation();
    },
    { capture: true, signal },
  );

  // ------------------------------------------------------------------ the task bar at rest
  // Watching, film playing, nobody touching the page: the task switch steps back (the player and its
  // credit stay). Any pointer move, key or focus brings it back; never while it is hovered, focused
  // or the timeline is held.
  let task: CinemaTask = 'explore';
  let playing = false;
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  const armRest = () => {
    clearTimeout(restTimer);
    if (immersive || task !== 'watch' || !playing) return;
    restTimer = setTimeout(() => {
      if (taskBar.matches(':hover, :focus-within') || hub.isOpen) armRest();
      else taskBar.dataset.rest = 'true';
    }, REST_MS);
  };
  function wakeTaskBar() {
    if (taskBar.dataset.rest === 'true') taskBar.dataset.rest = 'false';
    armRest();
  }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin', 'wheel'] as const) {
    window.addEventListener(type, wakeTaskBar, { capture: true, passive: true, signal });
  }

  const sceneControls = [
    ...presetButtons.values(),
    moreToggle,
    tourButton,
    exploreButton,
    resetButton,
    ...toggles.values(),
    ...qualityButtons.values(),
    inspectorButton,
    previousStop.element,
    nextStop.element,
    stopTour.element,
    returnButton,
  ];
  let announced = '';
  let video2d: HTMLElement | null = null;

  const ui: CinemaUi = {
    root,
    viewport,
    stage,
    screen,
    main,
    dock,
    watchView,
    taskButton: (id) => taskButtons.get(id)!,
    setTask(next) {
      task = next;
      root.dataset.task = next;
      for (const [id, element] of taskButtons) element.setAttribute('aria-pressed', String(id === next));
      for (const [id, section] of Object.entries(dock)) section.hidden = id !== next;
      if (menuOpen(moreMenu)) setMenu(moreMenu, false);
      wakeTaskBar();
    },
    setSeatCount(count) {
      seatCount.hidden = count === 0;
      seatCount.textContent = String(count);
    },
    setPanel(state) {
      root.dataset.panel = state;
      root.dataset.seatPanel = String(state !== 'closed');
      // The full-screen sheet is modal: everything else is out of reach until it closes.
      header.inert = state === 'expanded';
      screen.inert = state === 'expanded';
      hub.root.inert = state === 'expanded';
      if (state === 'expanded') hub.close(false);
    },
    setNotice(text) {
      clearTimeout(noticeTimer);
      notice.textContent = text;
      if (text) noticeTimer = setTimeout(() => (notice.textContent = ''), 3500);
    },
    setReturn(label) {
      returnButton.hidden = label === null;
      returnButton.textContent = label ? `← ${label}` : '';
    },
    setActivePreset(id) {
      root.dataset.preset = id ?? '';
      for (const [presetId, element] of presetButtons) element.setAttribute('aria-pressed', String(presetId === id));
    },
    setCameraState(state) {
      root.dataset.camera = state;
    },
    setTour(next) {
      root.dataset.tour = next ? (next.steps ? 'steps' : 'playing') : 'off';
      // Same label either way (pressed shows it is on), so the dock never re-wraps and resizes.
      tourButton.setAttribute('aria-pressed', String(next !== null));
      tourBar.hidden = next === null;
      if (!next) {
        announced = '';
        return;
      }
      tourBar.dataset.steps = String(next.steps);
      tourSteps.hidden = !next.steps;
      previousStop.element.disabled = next.stopIndex === 0;
      nextStop.label.textContent = next.stopIndex === next.stopCount - 1 ? 'Kết thúc' : 'Tiếp';
      stopTour.label.textContent = next.steps ? 'Thoát' : 'Dừng';
      stopTour.element.querySelector('path')!.setAttribute('d', next.steps ? CLOSE_ICON : ICONS.stop);
      // Announced once per stop, not every frame; the card follows the same moments.
      const text = `${next.steps ? 'Điểm' : 'Đang tham quan · điểm'} ${next.stopIndex + 1}/${next.stopCount}: ${next.label}`;
      if (text !== announced) {
        announced = text;
        tourText.textContent = text;
        tourMeta.textContent = `${next.steps ? 'Tham quan từng điểm' : 'Đang tham quan'} · ${next.stopIndex + 1}/${next.stopCount}`;
        tourTitle.textContent = next.label;
        // One segment per stop: the ones seen, this one, the ones to come.
        if (tourProgress.childElementCount !== next.stopCount) {
          tourProgress.replaceChildren(...Array.from({ length: next.stopCount }, () => el('i', '')));
        }
        [...tourProgress.children].forEach((segment, k) => {
          (segment as HTMLElement).dataset.state = k < next.stopIndex ? 'done' : k === next.stopIndex ? 'current' : 'next';
        });
      }
    },
    setExploring(active) {
      root.dataset.explore = String(active);
      exploreButton.setAttribute('aria-pressed', String(active));
    },
    setPartVisible(part, visible) {
      const input = toggles.get(part);
      if (input) input.checked = visible;
    },
    setQuality(level) {
      root.dataset.quality = level;
      for (const [value, element] of qualityButtons) element.setAttribute('aria-pressed', String(value === level));
    },
    setCaption(text) {
      // The caption is a live region: rewriting the same sentence would read it again.
      if (caption.textContent === text) return;
      caption.textContent = text;
      hub.setNow(text);
      // Phones show it for a moment only (the CSS hides it once it is no longer fresh).
      caption.dataset.fresh = 'true';
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => (caption.dataset.fresh = 'false'), 5000);
    },
    setStatus(next) {
      renderStatus(root, status, next, handlers.onRetryScene);
    },
    setTransitioning(active) {
      root.dataset.transitioning = String(active);
    },
    setSceneControls(available, reason) {
      for (const control of sceneControls) control.disabled = !available;
      // The reason where the controls are: Khám phá, Cài đặt (quality) and Công cụ nâng cao.
      for (const note of [sceneNote, settingsNote, advancedNote]) {
        note.hidden = available || !reason;
        note.textContent = available ? '' : (reason ?? '');
      }
      root.dataset.scene = String(available);
    },
    setWatchView(text, action) {
      if (watchText.textContent !== text) watchText.textContent = text;
      watchAction.hidden = action === null;
      if (action !== null && watchAction.textContent !== action) watchAction.textContent = action;
    },
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      wakeTaskBar();
    },
    closeMenus() {
      for (const entry of menus) if (menuOpen(entry)) setMenu(entry, false);
      hub.close(false);
    },
    setLayout(next) {
      if (next === immersive) return;
      immersive = next;
      root.dataset.layout = next ? 'immersive' : 'standard';
      ui.closeMenus();
      if (!next) hideSeatCard();
      // The same elements move: the tasks and their controls into the round button's panel, or back
      // over the room.
      if (next) {
        hub.tasks.append(tasks);
        hub.content('task').append(dock.explore, dock.seats, dock.watch);
      } else {
        taskBar.append(tasks);
        taskTools.append(dock.explore, dock.seats, dock.watch);
      }
      placeFilmStatus();
      placeMini();
      hub.setFloating(next);
      wakeTaskBar();
    },
    attachFilmStatus(element) {
      filmStatus = element;
      placeFilmStatus();
    },
    attachMini(element) {
      mini = element;
      placeMini();
    },
    get hubToggle() {
      return immersive ? hub.toggle : settingsButton;
    },
    showSeatCard(seatId, text, canView) {
      if (!immersive) return;
      seatCardId = seatId;
      seatCardText.textContent = text;
      seatCardView.hidden = !canView;
      seatCard.hidden = false;
      armSeatCard();
    },
    offerHubHint() {
      if (!immersive) return;
      try {
        if (localStorage.getItem(HINT_KEY) === 'seen') return;
      } catch {
        // No storage: show it.
      }
      showHint();
    },
    showVideo2d(video, label) {
      if (video2d) return;
      const box = el('div', 'cinema-video2d');
      video.className = 'cinema-video2d__video';
      video.setAttribute('aria-label', label);
      box.append(el('p', 'cinema-video2d__label', label), video);
      stage.classList.add('cinema-stage--video2d');
      // Under the status line (the reason there is no 3D), in place of the room.
      status.after(box);
      video2d = box;
    },
    hideVideo2d() {
      if (!video2d) return;
      video2d.querySelector('video')?.remove();
      video2d.remove();
      video2d = null;
      stage.classList.remove('cinema-stage--video2d');
    },
    dispose() {
      clearTimeout(noticeTimer);
      clearTimeout(captionTimer);
      clearTimeout(seatCardTimer);
      clearTimeout(restTimer);
      listeners.abort();
      overlayResize.disconnect();
      hub.dispose();
      // Full screen was for the room: the landing page comes back in a normal window.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      root.remove();
    },
  };

  root.dataset.layout = 'standard';
  taskBar.dataset.rest = 'false';
  hub.setFloating(false);
  hub.setActive(true);
  ui.setTask('explore');
  ui.setPanel('closed');
  ui.setStatus({ kind: 'loading' });
  ui.setTransitioning(false);
  ui.setTour(null);
  ui.setExploring(false);
  ui.setCameraState('preset');
  return ui;
}

export const CLOSE_ICON = 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z';

const LOADING_TEXT = {
  code: 'Đang tải phần 3D của trang…',
  scene: 'Đang dựng phòng chiếu 3D…',
};

/**
 * Shows `next` in a status overlay and mirrors it on `root.dataset.status`. Shared by the
 * auditorium and the seat inspector. A retry button appears when `next` offers one and `onRetry`
 * is given; a failure never keeps a spinner.
 */
export function renderStatus(root: HTMLElement, status: HTMLElement, next: UiStatus, onRetry?: () => void): void {
  root.dataset.status = next.kind;
  status.replaceChildren();
  status.hidden = next.kind === 'ready';
  status.setAttribute('role', next.kind === 'error' ? 'alert' : 'status');
  status.classList.toggle('cinema-status--error', next.kind === 'error');
  const card = el('div', 'cinema-status__card');
  status.append(card);
  const retry = (label: string) => {
    const element = el('button', 'cinema-button cinema-button--accent cinema-status__retry', label);
    element.type = 'button';
    element.dataset.action = 'retry-scene';
    element.addEventListener('click', () => onRetry?.(), { once: true });
    return element;
  };
  if (next.kind === 'loading') {
    card.append(el('span', 'cinema-status__spinner'), el('span', '', LOADING_TEXT[next.step ?? 'scene']));
  } else if (next.kind === 'context-lost') {
    if (next.stuck && onRetry) {
      card.append(
        el('strong', '', 'Cảnh 3D chưa được khôi phục'),
        el('span', 'cinema-status__hint', 'Trình duyệt chưa trả lại ngữ cảnh WebGL. Dựng lại cảnh sẽ giữ nguyên ghế đã chọn và vị trí phim.'),
        retry('Dựng lại cảnh 3D'),
      );
    } else {
      card.append(el('span', 'cinema-status__spinner'), el('span', '', 'Mất ngữ cảnh WebGL. Đang chờ trình duyệt khôi phục…'));
    }
  } else if (next.kind === 'error') {
    card.append(el('strong', '', 'Không thể hiển thị cảnh 3D'), el('span', '', next.message));
    if (next.retry && onRetry) card.append(retry('Thử lại'));
    else card.append(el('span', 'cinema-status__hint', 'Hãy bật tăng tốc phần cứng (WebGL) hoặc mở trang bằng trình duyệt khác.'));
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function group(label: string): HTMLDivElement {
  const element = el('div', 'cinema-toolbar__group');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  return element;
}

/** A labelled on/off switch (checkbox with role="switch"); `id` goes to `data-toggle`. */
export function switchControl(
  label: string,
  id: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  signal: AbortSignal,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = el('label', 'cinema-switch');
  const input = el('input', 'cinema-switch__input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.dataset.toggle = id;
  input.addEventListener('change', () => onChange(input.checked), { signal });
  wrapper.append(input, el('span', 'cinema-switch__label', label), el('span', 'cinema-switch__track'));
  return { wrapper, input };
}
