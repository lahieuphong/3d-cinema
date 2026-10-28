import { BRAND, markSvg } from '../brand.ts';
import { isPlainClick } from '../router.ts';
import type { ToggleablePart } from './architecture.ts';
import { CAMERA_PRESETS, type CameraPresetId } from './cameraPresets.ts';
import { createControlHub } from './controlHub.ts';
import { QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import { CINEMA_TASKS, type CinemaTask, type PanelState } from './taskLayout.ts';

export const TOGGLEABLE_PARTS: ReadonlyArray<{ part: ToggleablePart; label: string }> = [
  { part: 'ceiling', label: 'Trần' },
  { part: 'backWall', label: 'Vách sau' },
  { part: 'rightWall', label: 'Vách phải' },
];

export interface CinemaUiHandlers {
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
  /** The 3D view with its overlays (caption, tour bar, way back, notices, status). */
  stage: HTMLElement;
  /** The column of the view and the task's controls under it. */
  screen: HTMLElement;
  /** The row of that column and the seat panel. */
  main: HTMLElement;
  /** Each task's controls, under the view; only the current task's are shown. */
  dock: Record<CinemaTask, HTMLElement>;
  /** In the header, for the film's small play/pause control while another task is shown. */
  miniSlot: HTMLElement;
  /** "Góc nhìn: …" line of Xem phim, placed by the page next to the player. */
  watchView: HTMLElement;
  /** Under the caption, over the view: for the film's credit while the player is not shown. */
  creditSlot: HTMLElement;
  taskButton(task: CinemaTask): HTMLButtonElement;
  setTask(task: CinemaTask): void;
  /** Mirrors the seat panel; a full-screen sheet makes the rest of the page inert (modal). */
  setPanel(state: PanelState): void;
  setSeatCount(count: number): void;
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
  /** Closes the settings and "Góc khác" menus (and the control hub). */
  closeMenus(): void;
  /**
   * Phones (`immersive`): the room fills the screen and the task controls, the player and the
   * settings move into the floating control hub; back in place otherwise. Same elements either way.
   */
  setLayout(immersive: boolean): void;
  /** The control hub's button: where focus goes on a phone when what held it is gone. */
  readonly hubToggle: HTMLButtonElement;
  /** Phone layout: a small card for the seat just tapped in the room, with "Xem từ ghế này". */
  showSeatCard(seatId: string, text: string, canView: boolean): void;
  /** Phone layout, first visit: how the room and the control button work (once; again from Trợ giúp). */
  offerHubHint(): void;
  /**
   * The film's status chip (problems, "Thử lại"): in a corner of the view; on a phone at the head of
   * the overlay stack with the caption and credit, so it never meets the way back or the tour bar.
   */
  attachFilmStatus(element: HTMLElement): void;
  /** Without 3D: shows the film's own element in the viewport area, labelled as the 2D mode. */
  showVideo2d(video: HTMLVideoElement, label: string): void;
  hideVideo2d(): void;
  dispose(): void;
}

const ICONS = {
  explore: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm3.6-11.6-2.1 5.1-5.1 2.1 2.1-5.1z',
  seats: 'M7 4h10a2 2 0 0 1 2 2v5h1a1 1 0 0 1 1 1v6h-2v2h-2v-2H7v2H5v-2H3v-6a1 1 0 0 1 1-1h1V6a2 2 0 0 1 2-2zm0 2v6h10V6zm-2 8v2h14v-2z',
  watch: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h14V7zm5 2 5 3-5 3z',
  settings: 'M4 6h9v2H4zm13 0h3v2h-3zm-3-2h2v6h-2zM4 16h3v2H4zm7 0h9v2h-9zm-3-2h2v6H8z',
  more: 'M7 10l5 5 5-5z',
};

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

/**
 * Builds the /cinema page chrome around three tasks: Khám phá (camera views, tour, walking),
 * Chọn ghế (selection summary and the seat panel) and Xem phim (the player).
 *
 * - Header: title, the task switch, the film's mini control (while another task is shown) and
 *   "Cài đặt" (quality, plus the inspection tools folded inside).
 * - The view: canvas with caption, tour bar, way back, notices and status over it.
 * - The dock under the view: the current task's controls only, so panels never stack up.
 * Menus are non-modal popovers: Escape, a press elsewhere or picking an action closes them and
 * focus returns to their button; a press on the 3D view that closes one goes no further (it never
 * selects a seat or turns the camera). State is mirrored onto `data-*` attributes of the root so
 * automated checks can wait on it.
 *
 * On phones the room fills the screen instead: header and dock leave the layout and their controls
 * (the same elements) move into the control hub's sections (see `setLayout`).
 */
export function createCinemaUi(host: HTMLElement, handlers: CinemaUiHandlers, options: CinemaUiOptions): CinemaUi {
  const listeners = new AbortController();
  const { signal } = listeners;

  const root = el('div', 'cinema-app');
  root.dataset.status = 'loading';

  const button = (label: string, className = 'cinema-button') => {
    const element = el('button', className, label);
    element.type = 'button';
    return element;
  };
  const presetButtons = new Map<CameraPresetId, HTMLButtonElement>();
  const presetButton = (id: CameraPresetId, className?: string) => {
    const preset = CAMERA_PRESETS.find((p) => p.id === id)!;
    const element = button(preset.label, className);
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
  home.innerHTML = `${markSvg(28)}<span class="cinema-brand__name" aria-hidden="true">${BRAND.name}</span>`;
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

  const tasks = el('div', 'cinema-tasks');
  tasks.setAttribute('role', 'group');
  tasks.setAttribute('aria-label', 'Tác vụ');
  const taskButtons = new Map<CinemaTask, HTMLButtonElement>();
  const seatCount = el('span', 'cinema-tasks__count');
  seatCount.setAttribute('aria-hidden', 'true');
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

  const headerEnd = el('div', 'cinema-header__end');
  const miniSlot = el('div', 'cinema-header__mini');

  const settings = el('div', 'cinema-menu');
  const settingsButton = button('', 'cinema-button cinema-menu__toggle');
  settingsButton.dataset.action = 'settings';
  settingsButton.setAttribute('aria-label', 'Cài đặt');
  settingsButton.append(icon(ICONS.settings), el('span', 'cinema-menu__label', 'Cài đặt'));
  const settingsPanel = el('div', 'cinema-popover cinema-settings');
  settingsPanel.id = 'cinema-settings';
  settingsPanel.setAttribute('role', 'group');
  settingsPanel.setAttribute('aria-label', 'Cài đặt');

  const qualityGroup = group('Chất lượng hiển thị');
  qualityGroup.classList.add('cinema-settings__row');
  qualityGroup.append(el('span', 'cinema-settings__heading', 'Chất lượng hiển thị'));
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const element = button(QUALITY_LABELS[level], 'cinema-button cinema-button--compact');
    element.dataset.quality = level;
    element.setAttribute('aria-pressed', 'false');
    element.setAttribute('aria-label', `Chất lượng ${QUALITY_LABELS[level].toLowerCase()}`);
    element.addEventListener('click', () => handlers.onQuality(level), { signal });
    qualityButtons.set(level, element);
    qualityGroup.append(element);
  }
  const qualityHint = el('p', 'cinema-settings__hint', 'Tiết kiệm: ghế ít chi tiết hơn, bóng và độ nét thấp hơn, nhẹ máy hơn.');

  // Inspection tools, folded inside the settings: technical views, cut-away switches, seat inspector.
  const inspectToggle = button('Công cụ kiểm tra', 'cinema-button cinema-button--compact cinema-settings__disclosure');
  inspectToggle.dataset.action = 'inspect-tools';
  const inspectPanel = el('div', 'cinema-settings__tools');
  inspectPanel.id = 'cinema-inspect-tools';
  inspectPanel.hidden = true;
  inspectToggle.setAttribute('aria-expanded', 'false');
  inspectToggle.setAttribute('aria-controls', inspectPanel.id);
  inspectToggle.addEventListener(
    'click',
    () => {
      inspectPanel.hidden = !inspectPanel.hidden;
      inspectToggle.setAttribute('aria-expanded', String(!inspectPanel.hidden));
    },
    { signal },
  );
  const inspectViews = group('Góc kiểm tra');
  inspectViews.classList.add('cinema-settings__row');
  for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'inspection')) {
    inspectViews.append(presetButton(preset.id, 'cinema-button cinema-button--compact'));
  }
  const visibilityGroup = group('Hiện thành phần');
  visibilityGroup.classList.add('cinema-settings__row');
  const toggles = new Map<ToggleablePart, HTMLInputElement>();
  for (const { part, label } of TOGGLEABLE_PARTS) {
    const { wrapper, input } = switchControl(label, part, true, (checked) => handlers.onToggle(part, checked), signal);
    toggles.set(part, input);
    visibilityGroup.append(wrapper);
  }
  const inspectorButton = button('Kiểm tra ghế', 'cinema-button cinema-button--compact');
  inspectorButton.dataset.action = 'open-inspector';
  inspectorButton.addEventListener('click', () => handlers.onOpenInspector(), { signal });
  inspectViews.append(inspectorButton);
  inspectPanel.append(inspectViews, visibilityGroup);
  settingsPanel.append(qualityGroup, qualityHint, inspectToggle, inspectPanel);
  settings.append(settingsButton, settingsPanel);
  const settingsMenu = menu(settingsButton, settingsPanel);
  // A technical view needs the room in sight: picking one closes the menu.
  for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'inspection')) {
    presetButtons.get(preset.id)!.addEventListener('click', () => setMenu(settingsMenu, false, true), { signal });
  }

  headerEnd.append(miniSlot, settings);
  header.append(title, home, tasks, headerEnd);

  // ------------------------------------------------------------------ the view
  const stage = el('div', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const caption = el('p', 'cinema-caption');
  caption.setAttribute('aria-live', 'polite');
  // Caption and film credit stack in one corner, so they never overlap each other. On phones the
  // caption only shows for a moment after it changes (the hub keeps it), and the card for a seat
  // tapped in the room joins the stack.
  const overlay = el('div', 'cinema-overlay');
  const creditSlot = el('div', 'cinema-overlay__credit');
  let captionTimer: ReturnType<typeof setTimeout> | undefined;
  const seatCard = el('section', 'cinema-seatcard');
  seatCard.hidden = true;
  seatCard.setAttribute('aria-label', 'Ghế vừa chạm');
  seatCard.dataset.keys = 'own';
  const seatCardText = el('p', 'cinema-seatcard__text');
  const seatCardView = button('Xem từ ghế này', 'cinema-button cinema-button--compact cinema-seatcard__view');
  seatCardView.dataset.action = 'card-view-seat';
  const seatCardClose = button('', 'cinema-button cinema-button--compact cinema-seatcard__close');
  seatCardClose.dataset.action = 'card-close';
  seatCardClose.setAttribute('aria-label', 'Đóng thẻ ghế');
  seatCardClose.textContent = '×';
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
  overlay.append(seatCard, caption, creditSlot);

  const tourBar = el('div', 'cinema-tourbar');
  tourBar.hidden = true;
  const tourText = el('span', 'cinema-tourbar__text');
  tourText.setAttribute('aria-live', 'polite');
  const previousStop = button('Trước', 'cinema-button cinema-button--compact');
  previousStop.dataset.action = 'tour-previous';
  previousStop.addEventListener('click', () => handlers.onTourStep(-1), { signal });
  const nextStop = button('Tiếp', 'cinema-button cinema-button--compact');
  nextStop.dataset.action = 'tour-next';
  nextStop.addEventListener('click', () => handlers.onTourStep(1), { signal });
  const stopTour = button('Dừng', 'cinema-button cinema-button--compact');
  stopTour.dataset.action = 'tour-stop';
  stopTour.addEventListener('click', () => handlers.onTour(), { signal });
  tourBar.append(tourText, previousStop, nextStop, stopTour);

  const notice = el('p', 'cinema-notice');
  notice.setAttribute('aria-hidden', 'true');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const returnButton = button('', 'cinema-button cinema-button--compact cinema-return');
  returnButton.dataset.action = 'return';
  returnButton.hidden = true;
  returnButton.addEventListener('click', () => handlers.onReturn(), { signal });

  const status = el('div', 'cinema-status');
  status.setAttribute('role', 'status');
  stage.append(viewport, overlay, tourBar, returnButton, notice, status);

  // ------------------------------------------------------------------ the dock
  const dockElement = el('div', 'cinema-dock');
  const dockPanel = (task: CinemaTask) => {
    const section = el('section', 'cinema-dock__panel');
    section.dataset.dock = task;
    section.setAttribute('aria-label', CINEMA_TASKS.find((t) => t.id === task)!.label);
    dockElement.append(section);
    return section;
  };
  const dock: Record<CinemaTask, HTMLElement> = { explore: dockPanel('explore'), seats: dockPanel('seats'), watch: dockPanel('watch') };

  // Khám phá: the visitor views (the rarer ones fold into "Góc khác" on narrow screens), the tour
  // and walking. Labels never change with state (pressed shows it), so the row never re-wraps.
  const views = group('Góc nhìn');
  views.classList.add('cinema-explore__views');
  const moreToggle = button('', 'cinema-button cinema-more__toggle');
  moreToggle.dataset.action = 'more-views';
  moreToggle.append(el('span', '', 'Góc khác'), icon(ICONS.more));
  const morePanel = el('div', 'cinema-more');
  morePanel.id = 'cinema-more-views';
  const resetButton = button('Về góc ban đầu');
  resetButton.dataset.action = 'reset';
  resetButton.addEventListener('click', () => handlers.onReset(), { signal });
  morePanel.append(presetButton('seats'), presetButton('seatEye'), resetButton);
  views.append(presetButton('overview'), moreToggle, morePanel);
  const moreMenu = menu(moreToggle, morePanel);
  for (const element of morePanel.querySelectorAll('button')) {
    element.addEventListener('click', () => menuOpen(moreMenu) && setMenu(moreMenu, false, true), { signal });
  }

  const modes = group('Tham quan và đi bộ');
  modes.classList.add('cinema-explore__modes');
  const tourButton = button('Tham quan');
  tourButton.dataset.action = 'tour';
  tourButton.setAttribute('aria-pressed', 'false');
  tourButton.addEventListener('click', () => handlers.onTour(), { signal });
  const exploreButton = button('Đi bộ');
  exploreButton.dataset.action = 'explore';
  exploreButton.setAttribute('aria-pressed', 'false');
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

  const screen = el('div', 'cinema-screen');
  screen.append(stage, dockElement);
  const main = el('main', 'cinema-main');
  main.append(screen);

  root.append(header, main);
  host.replaceChildren(root);

  // ------------------------------------------------------------------ the control hub (phones)
  let immersive = false;
  let filmStatus: HTMLElement | null = null;
  const placeFilmStatus = () => {
    if (!filmStatus) return;
    if (immersive) overlay.prepend(filmStatus);
    else stage.append(filmStatus);
  };
  const hub = createControlHub(root, {
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
      '[data-action="hub-guide"]',
    ].join(', '),
    // A modal panel: the room and its overlays are out of reach (and of screen readers) meanwhile.
    onOpenChange: (open) => {
      main.inert = open;
    },
    // The first-visit hint stays above the overlay stack (the film's problems, the credit).
    keepClear: () => (overlay.getClientRects().length > 0 ? overlay.getBoundingClientRect() : null),
  });
  // The stack grows (a film problem, the seat card): the hint moves up with it.
  const overlayResize = new ResizeObserver(() => immersive && hub.refresh());
  overlayResize.observe(overlay);

  // Hiển thị: the browser's full screen, where it can (never on iPhone Safari); the page works without it.
  const fullscreenRow = el('div', 'cinema-hub__row');
  const fullscreenButton = button('Toàn màn hình', 'cinema-button cinema-hub__fullscreen');
  fullscreenButton.dataset.action = 'fullscreen';
  fullscreenButton.setAttribute('aria-pressed', 'false');
  const fullscreenNote = el('p', 'cinema-hub__note');
  fullscreenRow.append(fullscreenButton, fullscreenNote);
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled;
  fullscreenRow.hidden = !fullscreenSupported;
  const paintFullscreen = () => {
    const on = document.fullscreenElement !== null;
    fullscreenButton.setAttribute('aria-pressed', String(on));
    fullscreenButton.textContent = on ? 'Thoát toàn màn hình' : 'Toàn màn hình';
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

  // Trợ giúp và thông tin: how the room works (also the first-visit hint, again on request).
  const hintLines = options.touch
    ? ['Kéo một ngón để nhìn quanh, chụm hai ngón để phóng to hay thu nhỏ.', 'Chạm một ghế trong phòng để chọn, rồi “Xem từ ghế này”.', 'Sơ đồ ghế, phim, âm thanh và chất lượng: ở nút tròn này.']
    : ['Kéo chuột để nhìn quanh, cuộn để phóng to hay thu nhỏ.', 'Bấm một ghế trong phòng để chọn, rồi “Xem từ ghế này”.', 'Sơ đồ ghế, phim, âm thanh và chất lượng: ở nút tròn này.'];
  const help = el('ul', 'cinema-hub__help');
  for (const line of [
    ...hintLines.slice(0, 2),
    'Đi bộ: kéo cần điều khiển ở góc dưới bên trái để đi, kéo phần còn lại để nhìn quanh.',
    'Phim không tự phát: bấm Phát trong mục Phim và âm thanh.',
    'Nút tròn kéo được sang chỗ khác; thả ra, nó nằm sát cạnh gần nhất.',
  ]) {
    help.append(el('li', '', line));
  }
  const guideButton = button('Xem lại hướng dẫn nhanh', 'cinema-button cinema-button--compact');
  guideButton.dataset.action = 'hub-guide';
  const demoNote = el('p', 'cinema-hub__note', `${BRAND.name} · ${BRAND.demoNote}. Ghế là dữ liệu minh họa.`);
  hub.section('help').append(help, guideButton, demoNote);

  // Điều hướng.
  const homeLink = el('a', 'cinema-button cinema-hub__home', 'Về trang chủ');
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
  hub.section('nav').append(homeLink);

  const HINT_KEY = 'tp-cinema-hub-hint';
  const showHint = () => hub.showHint(hintLines, () => {
    try {
      localStorage.setItem(HINT_KEY, 'seen');
    } catch {
      // Not remembered: it may show once more on the next visit.
    }
  });
  // After the panel has closed (the button is the hint's anchor).
  guideButton.addEventListener('click', () => setTimeout(showHint, 0), { signal });

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

  const sceneControls = [
    ...presetButtons.values(),
    moreToggle,
    tourButton,
    exploreButton,
    resetButton,
    ...toggles.values(),
    ...qualityButtons.values(),
    inspectorButton,
    previousStop,
    nextStop,
    stopTour,
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
    miniSlot,
    watchView,
    creditSlot,
    taskButton: (task) => taskButtons.get(task)!,
    setTask(task) {
      root.dataset.task = task;
      for (const [id, element] of taskButtons) element.setAttribute('aria-pressed', String(id === task));
      for (const [id, section] of Object.entries(dock)) section.hidden = id !== task;
      if (menuOpen(moreMenu)) setMenu(moreMenu, false);
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
    setSeatCount(count) {
      seatCount.textContent = count > 0 ? String(count) : '';
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
      // Same label either way (pressed shows it is on), so the dock never re-wraps and resizes the view.
      tourButton.setAttribute('aria-pressed', String(next !== null));
      tourBar.hidden = next === null;
      if (!next) {
        announced = '';
        return;
      }
      previousStop.hidden = !next.steps;
      nextStop.hidden = !next.steps;
      previousStop.disabled = next.stopIndex === 0;
      nextStop.textContent = next.stopIndex === next.stopCount - 1 ? 'Kết thúc' : 'Tiếp';
      stopTour.textContent = next.steps ? 'Thoát' : 'Dừng';
      // Announced once per stop, not every frame.
      const text = `${next.steps ? 'Điểm' : 'Đang tham quan · điểm'} ${next.stopIndex + 1}/${next.stopCount}: ${next.label}`;
      if (text !== announced) {
        announced = text;
        tourText.textContent = text;
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
      sceneNote.hidden = available || !reason;
      sceneNote.textContent = available ? '' : (reason ?? '');
      root.dataset.scene = String(available);
    },
    setWatchView(text, action) {
      if (watchText.textContent !== text) watchText.textContent = text;
      watchAction.hidden = action === null;
      if (action !== null && watchAction.textContent !== action) watchAction.textContent = action;
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
      if (next) {
        // Ghế và góc nhìn; Phim và âm thanh; Hiển thị (quality, full screen, then the inspection tools).
        hub.section('seats').append(dock.seats, dock.explore);
        hub.section('film').append(dock.watch);
        hub.section('display').append(settingsPanel);
        settingsPanel.insertBefore(fullscreenRow, inspectToggle);
      } else {
        hideSeatCard();
        dockElement.append(dock.explore, dock.seats, dock.watch);
        fullscreenRow.remove();
        settings.append(settingsPanel);
      }
      placeFilmStatus();
      hub.setActive(next);
    },
    attachFilmStatus(element) {
      filmStatus = element;
      placeFilmStatus();
    },
    hubToggle: hub.toggle,
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
      stage.append(box);
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
      listeners.abort();
      overlayResize.disconnect();
      hub.dispose();
      // Full screen was for the room: the landing page comes back in a normal window.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      root.remove();
    },
  };

  root.dataset.layout = 'standard';
  ui.setTask('explore');
  ui.setPanel('closed');
  ui.setStatus({ kind: 'loading' });
  ui.setTransitioning(false);
  ui.setTour(null);
  ui.setExploring(false);
  ui.setCameraState('preset');
  return ui;
}

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
  const retry = (label: string) => {
    const element = el('button', 'cinema-button cinema-status__retry', label);
    element.type = 'button';
    element.dataset.action = 'retry-scene';
    element.addEventListener('click', () => onRetry?.(), { once: true });
    return element;
  };
  if (next.kind === 'loading') {
    status.append(el('span', 'cinema-status__spinner'), el('span', '', LOADING_TEXT[next.step ?? 'scene']));
  } else if (next.kind === 'context-lost') {
    if (next.stuck && onRetry) {
      status.append(
        el('strong', '', 'Cảnh 3D chưa được khôi phục'),
        el('span', 'cinema-status__hint', 'Trình duyệt chưa trả lại ngữ cảnh WebGL. Dựng lại cảnh sẽ giữ nguyên ghế đã chọn và vị trí phim.'),
        retry('Dựng lại cảnh 3D'),
      );
    } else {
      status.append(el('span', '', 'Mất ngữ cảnh WebGL. Đang chờ trình duyệt khôi phục…'));
    }
  } else if (next.kind === 'error') {
    status.append(el('strong', '', 'Không thể hiển thị cảnh 3D'), el('span', '', next.message));
    if (next.retry && onRetry) status.append(retry('Thử lại'));
    else status.append(el('span', 'cinema-status__hint', 'Hãy bật tăng tốc phần cứng (WebGL) hoặc mở trang bằng trình duyệt khác.'));
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
  wrapper.append(input, el('span', 'cinema-switch__track'), el('span', 'cinema-switch__label', label));
  return { wrapper, input };
}
