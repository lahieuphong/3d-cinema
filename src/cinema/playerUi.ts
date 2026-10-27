import type { FilmSource } from './media.ts';
import type { MediaChange, MediaNotice, MediaSnapshot, MediaState } from './mediaController.ts';
import { el } from './ui.ts';

export interface PlayerHandlers {
  onPlay(): void;
  onPause(): void;
  onReplay(): void;
  onSeek(seconds: number): void;
  onMuted(muted: boolean): void;
  onVolume(volume: number): void;
  /** Load the source again after an error or a long wait (never automatic). */
  onRetry(): void;
}

export interface PlayerUi {
  readonly root: HTMLElement;
  /** Mirrors the media; only the parts that `change` touches are written. */
  update(snapshot: MediaSnapshot, change: MediaChange | 'all'): void;
  /** Playback is impossible for now (no 3D context): play is disabled and `reason` is shown. */
  setUnavailable(reason: string | null): void;
  dispose(): void;
}

const NOTICES: Record<MediaNotice, string> = {
  blocked: 'Trình duyệt chưa cho phát video. Bấm Phát để thử lại.',
  hidden: 'Đã tạm dừng khi bạn chuyển sang tab khác. Bấm Tiếp tục để xem tiếp.',
  'context-lost': 'Đã tạm dừng vì cảnh 3D bị gián đoạn. Bấm Tiếp tục khi cảnh hiện lại.',
  slow: 'Mạng chậm: video vẫn đang tải. Chờ thêm, hoặc bấm Tải lại.',
};

const STATUS: Partial<Record<MediaState, string>> = {
  idle: 'Đang chuẩn bị video…',
  loading: 'Đang tải thông tin video…',
  buffering: 'Đang chờ dữ liệu…',
};

/** Spoken once per change of state (never per second). */
const ANNOUNCE: Partial<Record<MediaState, string>> = {
  playing: 'Đang phát',
  paused: 'Đã tạm dừng',
  ended: 'Đã hết video',
};

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  replay: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  sound: 'M4 9v6h4l5 4V5L8 9zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  muted: 'M4 9v6h4l5 4V5L8 9zm12.6 3 2.4-2.4-1.2-1.2-2.4 2.4-2.4-2.4-1.2 1.2 2.4 2.4-2.4 2.4 1.2 1.2 2.4-2.4 2.4 2.4 1.2-1.2z',
};

/** m:ss (or h:mm:ss); "--:--" while unknown. */
export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** What the main button does for this state. */
export function primaryAction(snapshot: MediaSnapshot): 'play' | 'pause' | 'replay' {
  if (snapshot.state === 'ended') return 'replay';
  if (snapshot.state === 'playing' || snapshot.state === 'buffering') return 'pause';
  return 'play';
}

/**
 * The film player's controls, under the 3D view (never over the canvas, the explore stick, the way
 * back or the seat sheet). Built once; media events only update text, values and attributes.
 *
 * Input stays here: it is outside the canvas, so presses never pick seats or turn the camera, and
 * `data-keys="own"` keeps arrow keys and Space on its controls away from the explore walker. No
 * page-wide shortcut exists (Space only activates a focused button, as usual).
 */
export function createPlayerUi(film: FilmSource, handlers: PlayerHandlers): PlayerUi {
  const listeners = new AbortController();
  const { signal } = listeners;
  const root = el('section', 'cinema-player');
  root.dataset.keys = 'own';
  root.setAttribute('aria-label', `Trình phát phim: ${film.title}`);

  const controls = el('div', 'cinema-player__controls');
  const primary = iconButton('cinema-player__primary');
  primary.dataset.action = 'media-primary';
  const time = el('span', 'cinema-player__time');
  time.setAttribute('aria-hidden', 'true');
  const current = el('span', '', '0:00');
  const total = el('span', '', '--:--');
  time.append(current, ' / ', total);

  const seek = el('input', 'cinema-player__seek');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '0';
  seek.step = '0.5';
  seek.value = '0';
  seek.dataset.action = 'media-seek';
  seek.setAttribute('aria-label', 'Tua video');
  seek.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');

  const mute = iconButton('cinema-player__mute');
  mute.dataset.action = 'media-mute';
  const volume = el('input', 'cinema-player__volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.dataset.action = 'media-volume';
  volume.setAttribute('aria-label', 'Âm lượng');
  const volumeHint = el('span', 'cinema-player__hint', 'Âm lượng: dùng phím của thiết bị');
  volumeHint.hidden = true;
  controls.append(primary, time, seek, mute, volume, volumeHint);

  const info = el('div', 'cinema-player__info');
  const title = el('strong', 'cinema-player__title', film.title);
  const credit = el('span', 'cinema-player__credit');
  credit.append(link(film.credit, film.creditUrl), ' · ', link(film.license, film.licenseUrl));
  credit.title = `${film.credit} · ${film.license}`;
  const status = el('span', 'cinema-player__status');
  const retry = el('button', 'cinema-button cinema-button--compact cinema-player__retry', 'Thử lại');
  retry.type = 'button';
  retry.dataset.action = 'media-retry';
  retry.hidden = true;
  info.append(title, credit, status, retry);

  // State changes and problems only; never the running time.
  const live = el('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  root.append(controls, info, live);

  let last: MediaSnapshot | null = null;
  let unavailable: string | null = null;
  /** The user is dragging the seek bar: media time must not move it back. */
  let seeking = false;
  let announced = '';

  primary.addEventListener(
    'click',
    () => {
      if (!last || primary.disabled) return;
      const action = primaryAction(last);
      if (action === 'pause') handlers.onPause();
      else if (action === 'replay') handlers.onReplay();
      else handlers.onPlay();
    },
    { signal },
  );
  mute.addEventListener('click', () => last && handlers.onMuted(!last.muted), { signal });
  retry.addEventListener('click', () => handlers.onRetry(), { signal });
  volume.addEventListener('input', () => handlers.onVolume(Number(volume.value)), { signal });
  seek.addEventListener('pointerdown', () => (seeking = true), { signal });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, () => (seeking = false), { signal });
  }
  seek.addEventListener(
    'input',
    () => {
      // Preview while dragging; the media seeks on release (and on each arrow key press).
      current.textContent = formatTime(Number(seek.value));
      seek.setAttribute('aria-valuetext', `${formatTime(Number(seek.value))} trên ${total.textContent}`);
    },
    { signal },
  );
  // Keys jump 5 s (10 s with Page Up/Down), a useful step for a short film; the native step is fine-grained.
  seek.addEventListener(
    'keydown',
    (event) => {
      if (!last || seek.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
      const duration = last.duration ?? 0;
      const jumps: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -10, PageUp: 10 };
      let target: number | null = null;
      if (event.key in jumps) target = last.currentTime + jumps[event.key];
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = duration;
      if (target === null) return;
      event.preventDefault();
      handlers.onSeek(Math.min(duration, Math.max(0, target)));
    },
    { signal },
  );
  seek.addEventListener(
    'change',
    () => {
      seeking = false;
      handlers.onSeek(Number(seek.value));
    },
    { signal },
  );

  const set = (element: HTMLElement, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  const text = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };

  const renderTime = (snapshot: MediaSnapshot) => {
    const duration = snapshot.duration;
    text(total, formatTime(duration));
    seek.disabled = duration === null || snapshot.state === 'error';
    set(seek, 'max', String(duration ?? 0));
    if (seeking) return;
    text(current, formatTime(snapshot.currentTime));
    const value = String(Math.round(snapshot.currentTime * 10) / 10);
    if (seek.value !== value) seek.value = value;
    set(seek, 'aria-valuetext', duration === null ? 'Chưa biết thời lượng' : `${formatTime(snapshot.currentTime)} trên ${formatTime(duration)}`);
  };

  const renderSound = (snapshot: MediaSnapshot) => {
    const silent = snapshot.hasAudio === false;
    setIcon(mute, snapshot.muted || silent ? ICONS.muted : ICONS.sound);
    set(mute, 'aria-pressed', String(snapshot.muted));
    set(mute, 'aria-label', silent ? 'Video không có âm thanh' : 'Tắt tiếng');
    mute.title = silent ? 'Video không có âm thanh' : snapshot.muted ? 'Bật tiếng' : 'Tắt tiếng';
    mute.disabled = silent;
    volume.hidden = !snapshot.volumeControllable;
    volumeHint.hidden = snapshot.volumeControllable || silent;
    volume.disabled = silent;
    const value = String(snapshot.volume);
    if (volume.value !== value) volume.value = value;
    set(volume, 'aria-valuetext', `${Math.round(snapshot.volume * 100)} %${snapshot.muted ? ' (đang tắt tiếng)' : ''}`);
    root.dataset.muted = String(snapshot.muted);
  };

  const renderState = (snapshot: MediaSnapshot) => {
    const action = primaryAction(snapshot);
    const resume = action === 'play' && snapshot.started && snapshot.currentTime > 0;
    const label = action === 'pause' ? 'Tạm dừng' : action === 'replay' ? 'Phát lại' : resume ? 'Tiếp tục' : 'Phát';
    setIcon(primary, action === 'pause' ? ICONS.pause : action === 'replay' ? ICONS.replay : ICONS.play);
    set(primary, 'aria-label', label);
    primary.title = label;
    primary.disabled = snapshot.state === 'error' || unavailable !== null;
    root.dataset.state = snapshot.state;
    root.dataset.notice = snapshot.notice ?? '';

    const message = unavailable ?? (snapshot.error ? snapshot.error.message : snapshot.notice ? NOTICES[snapshot.notice] : (STATUS[snapshot.state] ?? ''));
    text(status, message);
    status.classList.toggle('cinema-player__status--error', snapshot.state === 'error');
    status.classList.toggle('cinema-player__status--busy', !snapshot.error && !snapshot.notice && (snapshot.state === 'loading' || snapshot.state === 'buffering'));
    retry.hidden = !(snapshot.state === 'error' || snapshot.notice === 'slow');
    retry.textContent = snapshot.state === 'error' ? 'Thử lại' : 'Tải lại';

    const spoken = snapshot.error?.message ?? (snapshot.notice ? NOTICES[snapshot.notice] : (ANNOUNCE[snapshot.state] ?? ''));
    if (spoken && spoken !== announced) {
      announced = spoken;
      live.textContent = spoken;
    }
  };

  const ui: PlayerUi = {
    root,
    update(snapshot, change) {
      last = snapshot;
      if (change === 'all' || change === 'state' || change === 'notice') renderState(snapshot);
      if (change === 'all' || change === 'time' || change === 'state' || change === 'size') renderTime(snapshot);
      if (change === 'all' || change === 'volume' || change === 'state') renderSound(snapshot);
    },
    setUnavailable(reason) {
      unavailable = reason;
      if (last) renderState(last);
    },
    dispose() {
      listeners.abort();
      root.remove();
    },
  };
  return ui;
}

function iconButton(className: string): HTMLButtonElement {
  const button = el('button', `cinema-button cinema-player__button ${className}`);
  button.type = 'button';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  button.append(svg);
  return button;
}

function setIcon(button: HTMLButtonElement, d: string): void {
  const path = button.querySelector('path')!;
  if (path.getAttribute('d') !== d) path.setAttribute('d', d);
}

function link(label: string, href: string): HTMLAnchorElement {
  const a = el('a', '', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
