import type { ToggleablePart } from './architecture.ts';
import { CAMERA_PRESETS, type CameraPresetId } from './cameraPresets.ts';
import type { AuditoriumLayout } from './layout.ts';
import type { ViewStatus } from './view.ts';

export const TOGGLEABLE_PARTS: ReadonlyArray<{ part: ToggleablePart; label: string }> = [
  { part: 'ceiling', label: 'Trần' },
  { part: 'backWall', label: 'Vách sau' },
  { part: 'rightWall', label: 'Vách phải' },
];

export interface CinemaUiHandlers {
  onPreset(id: CameraPresetId): void;
  onReset(): void;
  onToggle(part: ToggleablePart, visible: boolean): void;
}

export type UiStatus = ViewStatus | { kind: 'loading' };

export interface CinemaUi {
  /** Element the 3D canvas is mounted into. */
  viewport: HTMLElement;
  setActivePreset(id: CameraPresetId): void;
  setPartVisible(part: ToggleablePart, visible: boolean): void;
  setCaption(text: string): void;
  setStatus(status: UiStatus): void;
  setTransitioning(active: boolean): void;
  dispose(): void;
}

/**
 * Builds the /cinema page chrome: header with seat counts, camera/visibility toolbar,
 * the viewport, a caption and a status overlay. State is mirrored onto `data-*` attributes
 * of the root element so automated checks can wait on it.
 */
export function createCinemaUi(host: HTMLElement, layout: AuditoriumLayout, handlers: CinemaUiHandlers): CinemaUi {
  const listeners = new AbortController();
  const { signal } = listeners;
  const { rowLabels, seatsPerRow } = layout.config.seating;

  const root = el('div', 'cinema-app');
  root.dataset.status = 'loading';

  const header = el('header', 'cinema-header');
  const title = el('h1', 'cinema-title', 'Phòng chiếu 3D');
  const badge = el('span', 'cinema-badge', 'Khối thô kiến trúc');
  title.append(' ', badge);
  const stats = el('dl', 'cinema-stats');
  stats.append(
    stat('Số hàng', `${layout.rows.length} (${rowLabels[0]}–${rowLabels[rowLabels.length - 1]})`),
    stat('Ghế mỗi hàng', String(seatsPerRow)),
    stat('Tổng số ghế', String(layout.seats.length)),
  );
  header.append(title, stats);

  const toolbar = el('div', 'cinema-toolbar');

  const presetGroup = group('Góc camera');
  const presetButtons = new Map<CameraPresetId, HTMLButtonElement>();
  for (const preset of CAMERA_PRESETS) {
    const button = el('button', 'cinema-button', preset.label);
    button.type = 'button';
    button.dataset.preset = preset.id;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => handlers.onPreset(preset.id), { signal });
    presetButtons.set(preset.id, button);
    presetGroup.append(button);
  }

  const resetButton = el('button', 'cinema-button cinema-button--reset', 'Về góc ban đầu');
  resetButton.type = 'button';
  resetButton.dataset.action = 'reset';
  resetButton.addEventListener('click', () => handlers.onReset(), { signal });
  presetGroup.append(resetButton);

  const visibilityGroup = group('Hiện thành phần');
  const toggles = new Map<ToggleablePart, HTMLInputElement>();
  for (const { part, label } of TOGGLEABLE_PARTS) {
    const wrapper = el('label', 'cinema-switch');
    const input = el('input', 'cinema-switch__input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = true;
    input.dataset.toggle = part;
    input.addEventListener('change', () => handlers.onToggle(part, input.checked), { signal });
    toggles.set(part, input);
    wrapper.append(input, el('span', 'cinema-switch__track'), el('span', 'cinema-switch__label', label));
    visibilityGroup.append(wrapper);
  }
  toolbar.append(presetGroup, visibilityGroup);

  const stage = el('main', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const caption = el('p', 'cinema-caption');
  caption.setAttribute('aria-live', 'polite');
  const status = el('div', 'cinema-status');
  status.setAttribute('role', 'status');
  stage.append(viewport, caption, status);

  root.append(header, toolbar, stage);
  host.replaceChildren(root);

  const controls = [...presetButtons.values(), resetButton, ...toggles.values()];

  const ui: CinemaUi = {
    viewport,
    setActivePreset(id) {
      root.dataset.preset = id;
      for (const [presetId, button] of presetButtons) button.setAttribute('aria-pressed', String(presetId === id));
    },
    setPartVisible(part, visible) {
      const input = toggles.get(part);
      if (input) input.checked = visible;
    },
    setCaption(text) {
      caption.textContent = text;
    },
    setStatus(next) {
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
        for (const control of controls) control.disabled = true;
      }
    },
    setTransitioning(active) {
      root.dataset.transitioning = String(active);
    },
    dispose() {
      listeners.abort();
      root.remove();
    },
  };

  ui.setStatus({ kind: 'loading' });
  ui.setTransitioning(false);
  return ui;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function group(label: string): HTMLDivElement {
  const element = el('div', 'cinema-toolbar__group');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  return element;
}

function stat(term: string, value: string): HTMLDivElement {
  const item = el('div', 'cinema-stats__item');
  item.append(el('dt', '', term), el('dd', '', value));
  return item;
}
