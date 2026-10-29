import type { FilmSource } from './media.ts';

/**
 * Player state, always derived from what the media element reports (events), never from the
 * commands sent to it: calling play() does not make it "playing"; the `playing` event does.
 * - `idle`: no source requested yet; `loading`: fetching metadata or data;
 * - `ready`: metadata known, not played yet; `playing`; `paused`;
 * - `buffering`: playback wanted but waiting for data; `ended`; `error`.
 */
export type MediaState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

/**
 * Something the user should know, shown next to the controls: playback stopped without them asking
 * (refused by the browser, tab hidden, 3D context lost) or data has been slow to arrive for a while.
 */
export type MediaNotice = 'blocked' | 'hidden' | 'context-lost' | 'slow';

export interface MediaSnapshot {
  state: MediaState;
  currentTime: number;
  /** Seconds, or null while unknown or unbounded (seeking is then disabled). */
  duration: number | null;
  muted: boolean;
  volume: number;
  /** False where scripts cannot set the volume (iOS): only mute is offered, plus a hint. */
  volumeControllable: boolean;
  /** null until known; some browsers only tell after a moment of playback. */
  hasAudio: boolean | null;
  videoWidth: number;
  videoHeight: number;
  /** A decoded frame is available to draw (readyState ≥ HAVE_CURRENT_DATA). */
  hasFrame: boolean;
  /** The user has pressed play at least once (the poster gives way to video frames). */
  started: boolean;
  notice: MediaNotice | null;
  error: { code: string; message: string } | null;
}

/** `film`: another film was chosen (title, tick, poster follow). */
export type MediaChange = 'state' | 'time' | 'volume' | 'size' | 'frame' | 'notice' | 'film';

export interface MediaControllerOptions {
  /** Restored from a previous mount (the seat inspector round trip): time, sound. */
  resume?: { time: number; muted: boolean; volume: number; started: boolean };
  /** Element to use (tests pass a fake); a new <video> otherwise. */
  element?: HTMLVideoElement;
  /** Buffering longer than this (ms) shows the slow-network notice (no automatic retry). */
  slowAfterMs?: number;
  /**
   * false: the source is attached later, with load() (or by play()). The page waits for its 3D
   * scene first, so the film's metadata does not compete with it for bandwidth.
   */
  loadNow?: boolean;
}

const ERROR_MESSAGES: Record<number, [string, string]> = {
  1: ['aborted', 'Đã dừng tải video.'],
  2: ['network', 'Không tải được video (lỗi mạng hoặc tệp không tồn tại).'],
  3: ['decode', 'Video bị lỗi khi giải mã.'],
  4: ['unsupported', 'Không mở được video: tệp không tồn tại hoặc trình duyệt không hỗ trợ định dạng này.'],
};

/** Whether scripts may change the volume here (iOS keeps it at 1 and ignores writes). */
function volumeIsControllable(): boolean {
  if (typeof document === 'undefined') return true;
  const probe = document.createElement('video');
  probe.volume = 0.5;
  return Math.abs(probe.volume - 0.5) < 1e-6;
}

/**
 * Owns the single HTMLVideoElement (and so the single audio stream) of the film player.
 *
 * Defaults: no autoplay, no loop, preload="metadata", playsInline, sound as the user left it.
 * play() may be refused (autoplay policy) or overtaken (pause, suspend, dispose before it settles):
 * every call takes a generation token, and a settled promise whose token is stale changes nothing
 * (if the element did start, it is paused again). After dispose nothing restarts the media.
 */
export class MediaController {
  readonly video: HTMLVideoElement;
  private current: FilmSource;
  private readonly listeners = new Set<(snapshot: MediaSnapshot, change: MediaChange) => void>();
  private readonly events = new AbortController();
  private state: MediaState = 'idle';
  private notice: MediaNotice | null = null;
  private error: MediaSnapshot['error'] = null;
  private started: boolean;
  private hasAudio: boolean | null = null;
  private readonly volumeControllable: boolean;
  /** Bumped by every play/pause/suspend/dispose, so stale play() promises are ignored. */
  private token = 0;
  private pendingSeek: number | null = null;
  private readonly slowAfterMs: number;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private sourceAttached = false;

  constructor(film: FilmSource, options: MediaControllerOptions = {}) {
    this.current = film;
    this.slowAfterMs = options.slowAfterMs ?? 12_000;
    this.volumeControllable = volumeIsControllable();
    const video = options.element ?? document.createElement('video');
    this.video = video;
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = false;
    video.autoplay = false;
    video.crossOrigin = null;
    const resume = options.resume;
    video.muted = resume?.muted ?? false;
    if (this.volumeControllable && resume) video.volume = resume.volume;
    this.started = resume?.started ?? false;
    if (resume && resume.time > 0) this.pendingSeek = resume.time;

    const { signal } = this.events;
    const on = (type: string, handler: () => void) => video.addEventListener(type, handler, { signal });
    on('loadstart', () => this.setState(this.started && !video.paused ? 'buffering' : 'loading'));
    on('loadedmetadata', () => {
      if (this.pendingSeek !== null) this.seek(this.pendingSeek);
      this.pendingSeek = null;
      this.readAudio();
      if (this.state === 'loading' || this.state === 'idle') this.setState(this.started ? 'paused' : 'ready');
      this.emit('size');
    });
    on('durationchange', () => this.emit('time'));
    on('loadeddata', () => this.emit('frame'));
    on('seeked', () => {
      if (this.state === 'ended' && !video.ended) this.setState('paused');
      this.emit('frame');
    });
    on('playing', () => {
      this.notice = null;
      this.setState('playing');
    });
    on('waiting', () => {
      if (!video.paused) this.setState('buffering');
    });
    // Idle: another film was just put on (its source is not loading yet); the old one's pause is stale.
    on('pause', () => {
      if (!video.ended && this.state !== 'error' && this.state !== 'idle') this.setState(this.started ? 'paused' : 'ready');
    });
    on('ended', () => this.setState('ended'));
    on('timeupdate', () => {
      if (this.hasAudio === null && video.currentTime > 0.5) this.readAudio();
      this.emit('time');
    });
    on('volumechange', () => this.emit('volume'));
    on('resize', () => this.emit('size'));
    on('error', () => {
      const code = video.error?.code ?? 0;
      const [name, message] = ERROR_MESSAGES[code] ?? ['unknown', 'Video gặp lỗi không xác định.'];
      this.error = { code: name, message };
      this.setState('error');
    });

    // A type the browser says it cannot play at all fails at once, without fetching anything.
    if (film.type && video.canPlayType(film.type) === '') {
      this.error = { code: 'unsupported', message: ERROR_MESSAGES[4][1] };
      this.state = 'error';
      return;
    }
    if (options.loadNow !== false) this.load();
  }

  /** The film on the screen. */
  get film(): FilmSource {
    return this.current;
  }

  /** Attaches the source (metadata only, by preload) once; later calls change nothing. */
  load(): void {
    if (this.disposed || this.state === 'error' || this.sourceAttached) return;
    this.sourceAttached = true;
    this.video.src = this.current.src;
  }

  /**
   * Puts another film on the same element (one audio stream still): what played stops, the new film
   * waits at its start, not started (its poster shows) with the sound as it was, until play().
   * Before the source is attached (the page still waiting for its scene) only the choice changes.
   */
  setFilm(film: FilmSource): void {
    if (this.disposed || film.id === this.current.id) return;
    this.token++;
    this.video.pause();
    clearTimeout(this.slowTimer);
    this.current = film;
    this.started = false;
    this.hasAudio = null;
    this.notice = null;
    this.error = null;
    this.pendingSeek = null;
    if (film.type && this.video.canPlayType(film.type) === '') {
      this.error = { code: 'unsupported', message: ERROR_MESSAGES[4][1] };
      this.state = 'error';
    } else {
      this.state = 'idle';
      if (this.sourceAttached) this.video.src = film.src;
    }
    this.emit('film');
  }

  get snapshot(): MediaSnapshot {
    const { video } = this;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    return {
      state: this.state,
      currentTime: video.currentTime || 0,
      duration,
      muted: video.muted,
      volume: video.volume,
      volumeControllable: this.volumeControllable,
      hasAudio: this.hasAudio,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasFrame: video.readyState >= 2,
      started: this.started,
      notice: this.notice,
      error: this.error,
    };
  }

  /**
   * Starts (or resumes) playback because the user asked. Resolves with what actually happened:
   * 'playing' once the element accepted, 'blocked' if the browser refused (no gesture / policy),
   * 'cancelled' if something newer (pause, suspend, dispose) took over, 'error' otherwise.
   */
  async play(): Promise<'playing' | 'blocked' | 'cancelled' | 'error'> {
    if (this.disposed) return 'cancelled';
    if (this.state === 'error') return 'error';
    this.load();
    const token = ++this.token;
    this.notice = null;
    this.started = true;
    this.emit('notice');
    if (this.video.ended) this.video.currentTime = 0;
    try {
      await this.video.play();
    } catch (error) {
      if (token !== this.token || this.disposed) return 'cancelled';
      const name = (error as DOMException | undefined)?.name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') {
        this.notice = 'blocked';
        this.setState(this.video.currentTime > 0 ? 'paused' : 'ready');
        this.emit('notice');
        return 'blocked';
      }
      // NotSupportedError and friends: the element's own `error` event, if any, has the details.
      this.error ??= { code: 'unsupported', message: ERROR_MESSAGES[4][1] };
      this.setState('error');
      return 'error';
    }
    if (token !== this.token || this.disposed) {
      // Overtaken while the element was starting: honour the newer command.
      this.video.pause();
      return 'cancelled';
    }
    return 'playing';
  }

  pause(): void {
    this.token++;
    this.video.pause();
  }

  /** Plays again from the start after the end. */
  replay(): Promise<'playing' | 'blocked' | 'cancelled' | 'error'> {
    this.seek(0);
    return this.play();
  }

  /**
   * Stops playback for a reason the user did not choose (hidden tab, lost WebGL context, leaving
   * the room). Nothing resumes by itself: the user presses play.
   */
  suspend(reason: MediaNotice): void {
    if (this.disposed) return;
    const wasPlaying = this.state === 'playing' || this.state === 'buffering' || !this.video.paused;
    this.pause();
    if (wasPlaying) {
      this.notice = reason;
      this.emit('notice');
    }
  }

  /** Seeks within the known duration (clamped); ignored while the duration is unknown. */
  seek(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    const duration = this.snapshot.duration;
    if (duration === null) {
      if (this.video.readyState === 0) this.pendingSeek = Math.max(0, seconds);
      return;
    }
    this.video.currentTime = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.05));
    this.emit('time');
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  /** Sets the volume (0–1) where the platform allows it; unmutes when raised above zero. */
  setVolume(volume: number): void {
    if (!this.volumeControllable) return;
    this.video.volume = Math.min(1, Math.max(0, volume));
    if (volume > 0 && this.video.muted) this.video.muted = false;
  }

  /** After an error: fetch the source again (does not start playback). */
  retry(): void {
    if (this.disposed) return;
    this.token++;
    this.error = null;
    this.notice = null;
    this.pendingSeek = this.video.currentTime || null;
    this.setState('loading');
    this.video.load();
  }

  subscribe(listener: (snapshot: MediaSnapshot, change: MediaChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Pauses, drops every listener and releases the decoder and the network connection (an
   * element without a source frees them). No pending play() can restart it afterwards.
   */
  dispose(): void {
    if (this.disposed) return;
    this.token++;
    this.disposed = true;
    clearTimeout(this.slowTimer);
    this.video.pause();
    this.events.abort();
    this.listeners.clear();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }

  private readAudio(): void {
    const video = this.video as HTMLVideoElement & { mozHasAudio?: boolean; audioTracks?: { length: number }; webkitAudioDecodedByteCount?: number };
    let known: boolean | null = null;
    if (typeof video.mozHasAudio === 'boolean') known = video.mozHasAudio;
    else if (video.audioTracks && typeof video.audioTracks.length === 'number') known = video.audioTracks.length > 0;
    else if (typeof video.webkitAudioDecodedByteCount === 'number' && video.currentTime > 0.5) known = video.webkitAudioDecodedByteCount > 0;
    if (known !== this.hasAudio) {
      this.hasAudio = known;
      this.emit('volume');
    }
  }

  private setState(state: MediaState): void {
    if (state === this.state) return;
    this.state = state;
    if (state !== 'error') this.error = null;
    // Waiting for data: after a while say so (once); the user decides whether to retry.
    clearTimeout(this.slowTimer);
    if (this.notice === 'slow') this.notice = null;
    if (state === 'buffering') {
      this.slowTimer = setTimeout(() => {
        if (this.disposed || this.state !== 'buffering') return;
        this.notice = 'slow';
        this.emit('notice');
      }, this.slowAfterMs);
    }
    this.emit('state');
  }

  private emit(change: MediaChange): void {
    if (this.disposed) return;
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) listener(snapshot, change);
  }
}
