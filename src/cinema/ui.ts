import type { ToggleablePart } from './architecture.ts';
import { CAMERA_PRESETS, type CameraPresetId } from './cameraPresets.ts';
import type { AuditoriumLayout } from './layout.ts';
import { QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import type { ViewStatus } from './renderHost.ts';

export const TOGGLEABLE_PARTS: ReadonlyArray<{ part: ToggleablePart; label: string }> = [
  { part: 'ceiling', label: 'Trần' },
  { part: 'backWall', label: 'Vách sau' },
  { part: 'rightWall', label: 'Vách phải' },
];

export interface CinemaUiHandlers {
  onPreset(id: CameraPresetId): void;
  onReset(): void;
  /** Starts the tour, or stops it while it runs. */
  onTour(): void;
  /** Reduced-motion tour: previous (−1) or next (+1) stop. */
  onTourStep(delta: number): void;
  /** Starts exploring, or stops it while exploring. */
  onExplore(): void;
  onToggle(part: ToggleablePart, visible: boolean): void;
  onQuality(level: QualityLevel): void;
  onOpenInspector(): void;
  /** Opens or closes the seat panel (map, details, selected list). */
  onSeatPanel(): void;
  /** Leaves a seat view for the view it was opened from. */
  onReturn(): void;
}

export type UiStatus = ViewStatus | { kind: 'loading' };

/** What the tour bar shows; null hides it. */
export interface UiTourStatus {
  steps: boolean;
  stopIndex: number;
  stopCount: number;
  label: string;
}

export interface CinemaUi {
  /** Element the 3D canvas (and the explore stick) is mounted into. */
  viewport: HTMLElement;
  /** The row holding the viewport; the seat panel goes in here next to (or under) it. */
  main: HTMLElement;
  /** Root of the page, for page-wide live regions. */
  root: HTMLElement;
  /** The toolbar button that opens the seat panel (focus returns here when it closes). */
  seatPanelButton: HTMLButtonElement;
  setSeatPanelOpen(open: boolean): void;
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
  dispose(): void;
}

/**
 * Builds the /cinema page chrome: header with seat counts; a toolbar with the visitor views, the
 * tour and explore modes, reset and quality; a collapsible "Kiểm tra" (inspection) row with the
 * technical views, the cut-away switches and the seat inspector; the viewport with caption, tour
 * bar and status overlay. State is mirrored onto `data-*` attributes of the root element so
 * automated checks can wait on it.
 */
export function createCinemaUi(host: HTMLElement, layout: AuditoriumLayout, handlers: CinemaUiHandlers): CinemaUi {
  const listeners = new AbortController();
  const { signal } = listeners;
  const { rowLabels, seatsPerRow } = layout.config.seating;

  const root = el('div', 'cinema-app');
  root.dataset.status = 'loading';

  const header = el('header', 'cinema-header');
  const title = el('h1', 'cinema-title', 'Phòng chiếu 3D');
  const badge = el('span', 'cinema-badge', 'Tham quan & khám phá');
  title.append(' ', badge);
  const stats = el('dl', 'cinema-stats');
  stats.append(
    stat('Số hàng', `${layout.rows.length} (${rowLabels[0]}–${rowLabels[rowLabels.length - 1]})`),
    stat('Ghế mỗi hàng', String(seatsPerRow)),
    stat('Tổng số ghế', String(layout.seats.length)),
  );
  header.append(title, stats);

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

  const toolbar = el('div', 'cinema-toolbar');
  const viewGroup = group('Góc nhìn');
  for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'experience')) viewGroup.append(presetButton(preset.id));

  const modeGroup = group('Trải nghiệm');
  const tourButton = button('Tham quan');
  tourButton.dataset.action = 'tour';
  tourButton.setAttribute('aria-pressed', 'false');
  tourButton.addEventListener('click', () => handlers.onTour(), { signal });
  const exploreButton = button('Khám phá');
  exploreButton.dataset.action = 'explore';
  exploreButton.setAttribute('aria-pressed', 'false');
  exploreButton.addEventListener('click', () => handlers.onExplore(), { signal });
  const seatPanelButton = button('Sơ đồ ghế');
  seatPanelButton.dataset.action = 'seat-panel';
  seatPanelButton.setAttribute('aria-expanded', 'false');
  seatPanelButton.setAttribute('aria-controls', 'cinema-seat-panel');
  seatPanelButton.addEventListener('click', () => handlers.onSeatPanel(), { signal });
  const resetButton = button('Về góc ban đầu');
  resetButton.dataset.action = 'reset';
  resetButton.addEventListener('click', () => handlers.onReset(), { signal });
  modeGroup.append(tourButton, exploreButton, seatPanelButton, resetButton);

  const qualityGroup = group('Chất lượng hiển thị');
  qualityGroup.classList.add('cinema-toolbar__group--quality');
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

  // Inspection tools, collapsed by default: technical views, cut-away switches, seat inspector.
  const inspectPanel = el('div', 'cinema-toolbar cinema-toolbar--inspect');
  inspectPanel.id = 'cinema-inspect-tools';
  inspectPanel.hidden = true;
  const inspectToggle = button('Kiểm tra', 'cinema-button cinema-button--compact');
  inspectToggle.dataset.action = 'inspect-tools';
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
  qualityGroup.append(inspectToggle);

  const inspectViews = group('Góc kiểm tra');
  for (const preset of CAMERA_PRESETS.filter((p) => p.space === 'inspection')) {
    inspectViews.append(presetButton(preset.id, 'cinema-button cinema-button--compact'));
  }
  const visibilityGroup = group('Hiện thành phần');
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

  toolbar.append(viewGroup, modeGroup, qualityGroup);

  const stage = el('main', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const caption = el('p', 'cinema-caption');
  caption.setAttribute('aria-live', 'polite');

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
  stage.append(viewport, caption, tourBar, returnButton, notice, status);
  const main = el('div', 'cinema-main');
  main.append(stage);

  root.append(header, toolbar, inspectPanel, main);
  host.replaceChildren(root);

  const controls = [
    ...presetButtons.values(),
    tourButton,
    exploreButton,
    resetButton,
    ...toggles.values(),
    ...qualityButtons.values(),
    inspectToggle,
    inspectorButton,
    previousStop,
    nextStop,
    stopTour,
    returnButton,
  ];
  let announced = '';

  const ui: CinemaUi = {
    viewport,
    main,
    root,
    seatPanelButton,
    setSeatPanelOpen(open) {
      seatPanelButton.setAttribute('aria-expanded', String(open));
      seatPanelButton.setAttribute('aria-pressed', String(open));
      root.dataset.seatPanel = String(open);
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
      // Same label either way (pressed shows it is on), so the toolbar never re-wraps and resizes the view.
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
      caption.textContent = text;
    },
    setStatus(next) {
      renderStatus(root, status, next);
      // Without 3D every camera and display control goes; the seat panel (2D map) stays usable.
      if (next.kind === 'error') for (const control of controls) control.disabled = true;
    },
    setTransitioning(active) {
      root.dataset.transitioning = String(active);
    },
    dispose() {
      clearTimeout(noticeTimer);
      listeners.abort();
      root.remove();
    },
  };

  ui.setStatus({ kind: 'loading' });
  ui.setTransitioning(false);
  ui.setTour(null);
  ui.setExploring(false);
  ui.setCameraState('preset');
  return ui;
}

/**
 * Shows `next` in a status overlay and mirrors it on `root.dataset.status`.
 * Shared by the auditorium and the seat inspector.
 */
export function renderStatus(root: HTMLElement, status: HTMLElement, next: UiStatus): void {
  root.dataset.status = next.kind;
  status.replaceChildren();
  status.hidden = next.kind === 'ready';
  status.setAttribute('role', next.kind === 'error' ? 'alert' : 'status');
  status.classList.toggle('cinema-status--error', next.kind === 'error');
  if (next.kind === 'loading') {
    status.append(el('span', 'cinema-status__spinner'), el('span', '', 'Đang khởi tạo cảnh 3D…'));
  } else if (next.kind === 'context-lost') {
    status.append(el('span', '', 'Mất ngữ cảnh WebGL. Đang chờ trình duyệt khôi phục…'));
  } else if (next.kind === 'error') {
    status.append(
      el('strong', '', 'Không thể hiển thị cảnh 3D'),
      el('span', '', next.message),
      el('span', 'cinema-status__hint', 'Hãy bật tăng tốc phần cứng (WebGL) hoặc mở trang bằng trình duyệt khác.'),
    );
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

function stat(term: string, value: string): HTMLDivElement {
  const item = el('div', 'cinema-stats__item');
  item.append(el('dt', '', term), el('dd', '', value));
  return item;
}
