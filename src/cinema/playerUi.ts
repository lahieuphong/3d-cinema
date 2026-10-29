import type { FilmSource } from './media.ts';
import type { MediaChange, MediaNotice, MediaSnapshot, MediaState } from './mediaController.ts';
import { el, icon, ICONS as UI_ICONS } from './ui.ts';

/** A strip of film (the window and its perforations): "the films". */
const FILM_ICON =
  'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 2v14h10V5zM4.8 5.2v1.6h1.4V5.2zm0 3.4v1.6h1.4V8.6zm0 3.4v1.6h1.4V12zm0 3.4V17h1.4v-1.6zm13-10.2v1.6h1.4V5.2zm0 3.4v1.6h1.4V8.6zm0 3.4v1.6h1.4V12zm0 3.4V17h1.4v-1.6z';
const CHECK_ICON = 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L21.1 7.4 19.7 6z';

export interface PlayerHandlers {
  onPlay(): void;
  onPause(): void;
  onReplay(): void;
  onSeek(seconds: number): void;
  /** Turns the sound off or on, from the element's own state (its events arrive a moment later). */
  onToggleMute(): void;
  onVolume(volume: number): void;
  /** Load the source again after an error or a long wait (never automatic). */
  onRetry(): void;
  /** Another film chosen in the film list (only offered with more than one film). */
  onFilm?(id: string): void;
}

export interface PlayerUi {
  /** Controls and the film's title, the way to the other films (Xem phim). Credits: Cài đặt › Thông tin. */
  readonly root: HTMLElement;
  /** Play/pause with the state, for the header while another task is shown (after the first play). */
  readonly mini: HTMLButtonElement;
  /** Loading, waiting, notices and errors with "Thử lại": a chip over the view, so it never shifts the controls. */
  readonly status: HTMLElement;
  /** Polite live region (state changes and problems only); placed where it is never hidden. */
  readonly live: HTMLElement;
  /** Mirrors the media; only the parts that `change` touches are written. */
  update(snapshot: MediaSnapshot, change: MediaChange | 'all'): void;
  /** Playback is impossible for now (no 3D context): play is disabled and `reason` is shown. */
  setUnavailable(reason: string | null): void;
  /**
   * Another film is on the screen: title and the list's tick; screen readers hear it, and that
   * it plays on when `playing` (then "Đang phát" is not said again a moment later).
   */
  setFilm(film: FilmSource, playing: boolean): void;
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
  // The speaker, then a clear gap before its waves or its ×.
  sound: 'M2.5 9v6h4l5 4V5l-5 4zM17 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14.5 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  muted: 'M2.5 9v6h4l5 4V5l-5 4zM19.5 12l2.4-2.4-1.3-1.3-2.4 2.4-2.4-2.4-1.3 1.3 2.4 2.4-2.4 2.4 1.3 1.3 2.4-2.4 2.4 2.4 1.3-1.3z',
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

/** The mini control's words for each state. */
const MINI: Partial<Record<MediaState, string>> = {
  loading: 'Đang tải…',
  buffering: 'Đang tải…',
  playing: 'Đang phát',
  paused: 'Tạm dừng',
  ready: 'Tạm dừng',
  ended: 'Đã hết',
};

/**
 * The film player's controls: a glass dock over the room in Xem phim (clear of the explore stick,
 * the way back and the seat panel), or in the phone's control panel. Built once; media events only
 * update text, values and attributes, and never per frame. A small copy of the main button (`mini`)
 * keeps play/pause in reach from the other tasks once the film has been started.
 *
 * Input stays here: its pane lies over the canvas, so presses never pick seats or turn the camera, and
 * `data-keys="own"` keeps arrow keys and Space on its controls away from the explore walker. No
 * page-wide shortcut exists (Space only activates a focused button, as usual).
 */
export function createPlayerUi(film: FilmSource, handlers: PlayerHandlers, films: readonly FilmSource[] = [film]): PlayerUi {
  const listeners = new AbortController();
  const { signal } = listeners;
  const root = el('section', 'cinema-player');
  root.dataset.keys = 'own';
  root.setAttribute('aria-label', `Trình phát phim: ${film.title}`);
  let shown = film;

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

  // More than one film: the title is the way to the others. Over the room a menu opens above it
  // (like "Góc khác"); in the phone's panel the list is simply there, as rows (the CSS decides).
  const choice = films.length > 1 ? el('div', 'cinema-films') : null;
  const filmToggle = el('button', 'cinema-films__toggle');
  const filmMenu = el('div', 'cinema-films__menu');
  const filmButtons = new Map<string, HTMLButtonElement>();
  const setMenu = (open: boolean, focusToggle = false) => {
    filmMenu.dataset.open = String(open);
    filmToggle.setAttribute('aria-expanded', String(open));
    if (!open && focusToggle) filmToggle.focus();
  };
  if (choice) {
    filmToggle.type = 'button';
    filmToggle.dataset.action = 'film-menu';
    filmMenu.id = 'cinema-film-menu';
    filmToggle.setAttribute('aria-controls', filmMenu.id);
    title.className = 'cinema-player__title cinema-films__title';
    filmToggle.append(icon(FILM_ICON), title, icon(UI_ICONS.more));
    filmMenu.setAttribute('role', 'group');
    filmMenu.setAttribute('aria-label', 'Chọn phim');
    const heading = el('span', 'cinema-films__heading', 'Phim');
    heading.setAttribute('aria-hidden', 'true');
    filmMenu.append(heading);
    for (const source of films) {
      const option = el('button', 'cinema-film');
      option.type = 'button';
      option.dataset.film = source.id;
      option.setAttribute('aria-pressed', String(source.id === film.id));
      const thumb = el('img', 'cinema-film__thumb');
      thumb.alt = '';
      thumb.width = 96;
      thumb.height = 54;
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      // Fetched when the list first shows; it shimmers until then (site.css).
      if (source.thumb) {
        thumb.dataset.loading = '';
        const done = () => delete thumb.dataset.loading;
        thumb.addEventListener('load', done, { signal, once: true });
        thumb.addEventListener('error', done, { signal, once: true });
        thumb.src = source.thumb;
      }
      const words = el('span', 'cinema-film__text');
      words.append(el('span', 'cinema-film__name', source.title), el('span', 'cinema-film__meta', `${source.length} · ${source.studio}`));
      const check = icon(CHECK_ICON);
      check.classList.add('cinema-film__check');
      option.append(thumb, words, check);
      option.addEventListener(
        'click',
        () => {
          const open = filmMenu.dataset.open === 'true';
          setMenu(false, open);
          if (source.id !== shown.id) handlers.onFilm?.(source.id);
        },
        { signal },
      );
      filmButtons.set(source.id, option);
      filmMenu.append(option);
    }
    setMenu(false);
    filmToggle.addEventListener('click', () => setMenu(filmMenu.dataset.open !== 'true'), { signal });
    // A press anywhere else closes the menu; Escape closes it and comes back to the title.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (filmMenu.dataset.open === 'true' && !choice.contains(event.target as Node)) setMenu(false);
      },
      { signal, capture: true },
    );
    choice.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || filmMenu.dataset.open !== 'true') return;
        event.preventDefault();
        event.stopPropagation();
        setMenu(false, true);
      },
      { signal },
    );
    choice.append(filmToggle, filmMenu);
    info.append(choice);
  } else {
    info.append(title);
  }
  root.append(controls, info);

  /** Another film on the screen: its title and name, the list's tick. */
  const showFilm = (source: FilmSource) => {
    shown = source;
    title.textContent = source.title;
    root.setAttribute('aria-label', `Trình phát phim: ${source.title}`);
    filmToggle.setAttribute('aria-label', `${source.title} — đổi phim`);
    for (const [id, option] of filmButtons) option.setAttribute('aria-pressed', String(id === source.id));
  };
  if (choice) showFilm(film);

  const chip = el('div', 'cinema-filmstatus');
  chip.dataset.keys = 'own';
  const status = el('span', 'cinema-player__status');
  const retry = el('button', 'cinema-button cinema-button--compact cinema-player__retry', 'Thử lại');
  retry.type = 'button';
  retry.dataset.action = 'media-retry';
  retry.hidden = true;
  // Phones keep the player in the control hub: a notice that asks for a press carries the button
  // (the CSS shows it there only; elsewhere the player is next to the notice).
  const resumeButton = el('button', 'cinema-button cinema-button--compact cinema-player__resume');
  resumeButton.type = 'button';
  resumeButton.dataset.action = 'media-resume';
  resumeButton.hidden = true;
  chip.append(status, resumeButton, retry);

  const mini = el('button', 'cinema-mini');
  mini.type = 'button';
  mini.dataset.action = 'media-mini';
  mini.hidden = true;
  const miniText = el('span', 'cinema-mini__text');
  mini.append(iconSvg(), miniText);

  // State changes and problems only; never the running time.
  const live = el('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  live.dataset.filmLive = '';

  let last: MediaSnapshot | null = null;
  let unavailable: string | null = null;
  /** The user is dragging the seek bar: media time must not move it back. */
  let seeking = false;
  let announced = '';
  /** A film switch already said it plays on. */
  let playSaid = false;

  const runPrimary = () => {
    if (!last || primary.disabled) return;
    const action = primaryAction(last);
    if (action === 'pause') handlers.onPause();
    else if (action === 'replay') handlers.onReplay();
    else handlers.onPlay();
  };
  primary.addEventListener('click', runPrimary, { signal });
  mini.addEventListener('click', runPrimary, { signal });
  resumeButton.addEventListener('click', runPrimary, { signal });
  mute.addEventListener('click', () => handlers.onToggleMute(), { signal });
  retry.addEventListener('click', () => handlers.onRetry(), { signal });
  volume.addEventListener(
    'input',
    () => {
      fill(volume);
      handlers.onVolume(Number(volume.value));
    },
    { signal },
  );
  seek.addEventListener('pointerdown', () => (seeking = true), { signal });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, () => (seeking = false), { signal });
  }
  seek.addEventListener(
    'input',
    () => {
      // Preview while dragging; the media seeks on release (and on each arrow key press).
      current.textContent = formatTime(Number(seek.value));
      fill(seek);
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
  /** The slider's played (or loud) part, drawn by the CSS from `--fill`. */
  const fill = (slider: HTMLInputElement) => {
    const max = Number(slider.max) || 0;
    const value = max > 0 ? `${((Number(slider.value) / max) * 100).toFixed(2)}%` : '0%';
    if (slider.style.getPropertyValue('--fill') !== value) slider.style.setProperty('--fill', value);
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
    fill(seek);
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
    fill(volume);
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
    // Waiting for data: the words shimmer (site.css) instead of a spinner beside them.
    const busy = !unavailable && !snapshot.error && !snapshot.notice && (snapshot.state === 'loading' || snapshot.state === 'buffering');
    status.classList.toggle('cinema-player__status--busy', busy);
    status.classList.toggle('shimmer-text', busy);
    retry.hidden = unavailable !== null || !(snapshot.state === 'error' || snapshot.notice === 'slow');
    retry.textContent = snapshot.state === 'error' ? 'Thử lại' : 'Tải lại';
    chip.hidden = message === '';
    chip.dataset.kind = snapshot.state === 'error' ? 'error' : 'info';
    // How much it matters (phones show only what needs attention over the room): a failure, a
    // notice (paused for a reason, blocked, slow), or waiting for data once the film has started.
    chip.dataset.level =
      snapshot.state === 'error'
        ? 'error'
        : unavailable !== null || snapshot.notice
          ? 'notice'
          : snapshot.started && (snapshot.state === 'loading' || snapshot.state === 'buffering')
            ? 'busy'
            : 'info';
    const needsPress = !primary.disabled && (snapshot.notice === 'blocked' || snapshot.notice === 'hidden' || snapshot.notice === 'context-lost');
    resumeButton.hidden = !needsPress;
    text(resumeButton, needsPress ? label : '');

    // The mini control: only once the film has been started (nothing to pause before that).
    mini.hidden = !snapshot.started || snapshot.state === 'error' || unavailable !== null;
    setIcon(mini, action === 'pause' ? ICONS.pause : action === 'replay' ? ICONS.replay : ICONS.play);
    const miniState = MINI[snapshot.state] ?? '';
    text(miniText, miniState);
    set(mini, 'aria-label', `${label} phim${miniState ? ` · ${miniState}` : ''}`);
    mini.dataset.state = snapshot.state;

    const spoken = snapshot.error?.message ?? (snapshot.notice ? NOTICES[snapshot.notice] : (ANNOUNCE[snapshot.state] ?? ''));
    if (spoken && playSaid) {
      playSaid = false;
      if (spoken === ANNOUNCE.playing) {
        announced = spoken;
        return;
      }
    }
    if (spoken && spoken !== announced) {
      announced = spoken;
      live.textContent = spoken;
    }
  };

  const ui: PlayerUi = {
    root,
    mini,
    status: chip,
    live,
    update(snapshot, change) {
      last = snapshot;
      // Another film: everything starts over (state, time, sound).
      const all = change === 'all' || change === 'film';
      if (all || change === 'state' || change === 'notice') renderState(snapshot);
      if (all || change === 'time' || change === 'state' || change === 'size') renderTime(snapshot);
      if (all || change === 'volume' || change === 'state') renderSound(snapshot);
    },
    setUnavailable(reason) {
      unavailable = reason;
      if (last) renderState(last);
    },
    setFilm(source, playing) {
      if (source.id === shown.id) return;
      showFilm(source);
      playSaid = playing;
      announced = `${playing ? 'Đang phát' : 'Đang chiếu'}: ${source.title}`;
      live.textContent = announced;
    },
    dispose() {
      listeners.abort();
      root.remove();
      chip.remove();
      mini.remove();
      live.remove();
    },
  };
  return ui;
}

function iconButton(className: string): HTMLButtonElement {
  const button = el('button', `cinema-button cinema-player__button ${className}`);
  button.type = 'button';
  button.append(iconSvg());
  return button;
}

function iconSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  return svg;
}

function setIcon(button: HTMLElement, d: string): void {
  const path = button.querySelector('path')!;
  if (path.getAttribute('d') !== d) path.setAttribute('d', d);
}
