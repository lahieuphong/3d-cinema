import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_FILM, devFilm, type FilmSource } from './media.ts';
import { MediaController, type MediaChange, type MediaSnapshot } from './mediaController.ts';
import { formatTime, primaryAction } from './playerUi.ts';
import { containSize, screenContent } from './screenVideo.ts';
import { VideoFrameClock } from './videoFrames.ts';

/**
 * Just enough of an HTMLVideoElement: properties, events and a play() whose promise the test
 * settles. Events are dispatched by the test, as a browser would, never by play() itself.
 */
class FakeVideo extends EventTarget {
  preload = 'auto';
  playsInline = false;
  loop = true;
  autoplay = true;
  crossOrigin: string | null = 'anonymous';
  muted = false;
  volume = 1;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = Number.NaN;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  error: { code: number } | null = null;
  webkitAudioDecodedByteCount = 0;
  srcValue = '';
  loads = 0;
  removed = false;
  attributes = new Map<string, string>();
  playable = 'maybe';
  pendingPlay: { resolve(): void; reject(error: unknown): void } | null = null;

  set src(value: string) {
    this.srcValue = value;
  }
  get src(): string {
    return this.srcValue;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'src') this.srcValue = '';
  }
  canPlayType() {
    return this.playable;
  }
  load() {
    this.loads++;
    this.readyState = 0;
    this.paused = true;
  }
  remove() {
    this.removed = true;
  }
  play(): Promise<void> {
    this.paused = false;
    return new Promise((resolve, reject) => (this.pendingPlay = { resolve, reject }));
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.fire('pause');
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
  /** Metadata of a 33 s 1280×720 clip arrives. */
  loadMetadata(duration = 33) {
    this.duration = duration;
    this.videoWidth = 1280;
    this.videoHeight = 720;
    this.readyState = 1;
    this.fire('loadedmetadata');
    this.readyState = 2;
    this.fire('loadeddata');
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: ConstructorParameters<typeof MediaController>[1] = {}, film: FilmSource = DEMO_FILM) {
  const video = new FakeVideo();
  const controller = new MediaController(film, { ...options, element: video as unknown as HTMLVideoElement });
  const changes: Array<[MediaChange, MediaSnapshot]> = [];
  controller.subscribe((snapshot, change) => changes.push([change, snapshot]));
  video.fire('loadstart');
  return { video, controller, changes };
}

afterEach(() => vi.useRealTimers());

describe('media controller', () => {
  it('can wait to fetch anything until load() or play() (the page lets its 3D scene arrive first)', async () => {
    const video = new FakeVideo();
    const controller = new MediaController(DEMO_FILM, { element: video as unknown as HTMLVideoElement, loadNow: false });
    expect(video.src).toBe('');
    expect(controller.snapshot.state).toBe('idle');
    controller.load();
    controller.load();
    expect(video.src).toBe(DEMO_FILM.src);
    const later = new FakeVideo();
    const waiting = new MediaController(DEMO_FILM, { element: later as unknown as HTMLVideoElement, loadNow: false });
    void waiting.play();
    expect(later.src).toBe(DEMO_FILM.src);
    expect(later.paused).toBe(false);
    waiting.dispose();
    controller.load();
    controller.dispose();
    controller.load();
    expect(video.src).toBe('');
  });

  it('starts paused, without autoplay or loop, metadata only, inline, with sound as left', () => {
    const { video, controller } = setup();
    expect(video.preload).toBe('metadata');
    expect(video.playsInline).toBe(true);
    expect(video.attributes.has('playsinline')).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(false);
    expect(video.src).toBe(DEMO_FILM.src);
    expect(controller.snapshot.state).toBe('loading');
    video.loadMetadata();
    expect(controller.snapshot).toMatchObject({ state: 'ready', duration: 33, videoWidth: 1280, started: false, hasFrame: true });
    expect(video.paused).toBe(true);
  });

  it('is "playing" only once the element says so, not when play() is called', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    const result = controller.play();
    expect(controller.snapshot.state).toBe('ready');
    video.pendingPlay!.resolve();
    expect(await result).toBe('playing');
    expect(controller.snapshot.state).toBe('ready');
    video.fire('playing');
    expect(controller.snapshot.state).toBe('playing');
    controller.pause();
    expect(controller.snapshot.state).toBe('paused');
  });

  it('reports a refused play() as blocked and stays out of "playing"', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    const result = controller.play();
    video.paused = true;
    video.pendingPlay!.reject(new DOMException('no gesture', 'NotAllowedError'));
    expect(await result).toBe('blocked');
    expect(controller.snapshot).toMatchObject({ state: 'ready', notice: 'blocked' });
    // The user tries again: the notice goes, playback starts.
    const again = controller.play();
    expect(controller.snapshot.notice).toBeNull();
    video.pendingPlay!.resolve();
    video.fire('playing');
    expect(await again).toBe('playing');
    expect(controller.snapshot.state).toBe('playing');
  });

  it('play then pause at once: the late play() settles as cancelled and the element stays paused', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    const result = controller.play();
    controller.pause();
    video.paused = false; // the browser started anyway
    video.pendingPlay!.resolve();
    expect(await result).toBe('cancelled');
    expect(video.paused).toBe(true);
  });

  it('play then leave: nothing restarts, the source and decoder are released, no more events', async () => {
    const { video, controller, changes } = setup();
    video.loadMetadata();
    const result = controller.play();
    controller.dispose();
    const before = changes.length;
    video.pendingPlay!.resolve();
    expect(await result).toBe('cancelled');
    expect(video.paused).toBe(true);
    expect(video.src).toBe('');
    expect(video.loads).toBe(1);
    expect(video.removed).toBe(true);
    expect(controller.listenerCount).toBe(0);
    video.fire('playing');
    video.fire('timeupdate');
    expect(changes.length).toBe(before);
    expect(await controller.play()).toBe('cancelled');
  });

  it('context lost while play() is pending: cancelled, paused, with a notice to resume by hand', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    const result = controller.play();
    controller.suspend('context-lost');
    video.pendingPlay!.resolve();
    expect(await result).toBe('cancelled');
    expect(video.paused).toBe(true);
    expect(controller.snapshot.notice).toBe('context-lost');
  });

  it('a hidden tab pauses with a notice; nothing resumes by itself', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    void controller.play();
    video.pendingPlay!.resolve();
    video.fire('playing');
    controller.suspend('hidden');
    expect(controller.snapshot).toMatchObject({ state: 'paused', notice: 'hidden' });
    await tick();
    expect(video.paused).toBe(true);
    // Suspending something already paused says nothing.
    const quiet = setup();
    quiet.video.loadMetadata();
    quiet.controller.suspend('hidden');
    expect(quiet.controller.snapshot.notice).toBeNull();
  });

  it('a seek while loading waits for the metadata; seeks are clamped to the known duration', () => {
    const { video, controller } = setup();
    controller.seek(12);
    expect(video.currentTime).toBe(0);
    video.loadMetadata();
    expect(video.currentTime).toBe(12);
    controller.seek(500);
    expect(video.currentTime).toBeCloseTo(32.95);
    controller.seek(-3);
    expect(video.currentTime).toBe(0);
    controller.seek(Number.NaN);
    expect(video.currentTime).toBe(0);
  });

  it('an unknown (unbounded) duration disables seeking instead of guessing', () => {
    const { video, controller } = setup();
    video.loadMetadata(Number.POSITIVE_INFINITY);
    expect(controller.snapshot.duration).toBeNull();
    controller.seek(5);
    expect(video.currentTime).toBe(0);
    video.duration = 4;
    video.fire('durationchange');
    controller.seek(2);
    expect(video.currentTime).toBe(2);
  });

  it('ended, then replay from the start', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    void controller.play();
    video.pendingPlay!.resolve();
    video.fire('playing');
    video.currentTime = 33;
    video.ended = true;
    video.paused = true;
    video.fire('pause');
    video.fire('ended');
    expect(controller.snapshot.state).toBe('ended');
    expect(primaryAction(controller.snapshot)).toBe('replay');
    void controller.replay();
    expect(video.currentTime).toBe(0);
    video.ended = false;
    video.fire('seeked');
    video.pendingPlay!.resolve();
    video.fire('playing');
    expect(controller.snapshot.state).toBe('playing');
  });

  it('buffering: says so after a while, never retries by itself', () => {
    vi.useFakeTimers();
    const { video, controller } = setup({ slowAfterMs: 5000 });
    video.loadMetadata();
    void controller.play();
    video.fire('waiting');
    expect(controller.snapshot.state).toBe('buffering');
    expect(primaryAction(controller.snapshot)).toBe('pause');
    vi.advanceTimersByTime(4999);
    expect(controller.snapshot.notice).toBeNull();
    vi.advanceTimersByTime(1);
    expect(controller.snapshot.notice).toBe('slow');
    vi.advanceTimersByTime(60_000);
    expect(video.loads).toBe(0);
    video.fire('playing');
    expect(controller.snapshot).toMatchObject({ state: 'playing', notice: null });
  });

  it('media errors: a readable message, play refused, retry only on request (once)', async () => {
    const { video, controller } = setup();
    video.loadMetadata();
    video.error = { code: 3 };
    video.fire('error');
    expect(controller.snapshot.state).toBe('error');
    expect(controller.snapshot.error?.code).toBe('decode');
    expect(controller.snapshot.error?.message).toMatch(/giải mã/);
    expect(await controller.play()).toBe('error');
    expect(video.loads).toBe(0);
    controller.retry();
    expect(video.loads).toBe(1);
    expect(controller.snapshot).toMatchObject({ state: 'loading', error: null });

    const missing = setup();
    missing.video.error = { code: 4 };
    missing.video.fire('error');
    expect(missing.controller.snapshot.error?.code).toBe('unsupported');
    expect(missing.controller.snapshot.error?.message).toMatch(/không tồn tại|không hỗ trợ/);
  });

  it('a type the browser cannot play fails at once without fetching', () => {
    const video = new FakeVideo();
    video.playable = '';
    const controller = new MediaController(DEMO_FILM, { element: video as unknown as HTMLVideoElement });
    expect(video.src).toBe('');
    expect(controller.snapshot.state).toBe('error');
    expect(controller.snapshot.error?.code).toBe('unsupported');
  });

  it('volume and mute follow the element; raising the volume unmutes', () => {
    const { video, controller, changes } = setup();
    video.loadMetadata();
    controller.setMuted(true);
    video.fire('volumechange');
    expect(controller.snapshot.muted).toBe(true);
    controller.setVolume(0.4);
    expect(video.volume).toBeCloseTo(0.4);
    expect(video.muted).toBe(false);
    controller.setVolume(3);
    expect(video.volume).toBe(1);
    expect(changes.some(([change]) => change === 'volume')).toBe(true);
  });

  it('finds out whether there is sound once playback has run a little', () => {
    const { video, controller } = setup();
    video.loadMetadata();
    expect(controller.snapshot.hasAudio).toBeNull();
    video.currentTime = 0.8;
    video.fire('timeupdate');
    expect(controller.snapshot.hasAudio).toBe(false);
    const loud = setup();
    loud.video.loadMetadata();
    loud.video.currentTime = 0.8;
    loud.video.webkitAudioDecodedByteCount = 4096;
    loud.video.fire('timeupdate');
    expect(loud.controller.snapshot.hasAudio).toBe(true);
  });

  it('comes back where it was left (inspector round trip): time, sound, paused', () => {
    const { video, controller } = setup({ resume: { time: 14.5, muted: true, volume: 0.3, started: true } });
    expect(video.muted).toBe(true);
    expect(video.volume).toBeCloseTo(0.3);
    video.loadMetadata();
    expect(video.currentTime).toBe(14.5);
    expect(controller.snapshot).toMatchObject({ state: 'paused', started: true });
    expect(video.paused).toBe(true);
  });
});

describe('film picture and controls', () => {
  it('fits any shape inside the 16:9 screen without stretching (contain)', () => {
    const screen = { width: 8.5, height: 4.78125 };
    expect(containSize(16 / 9, screen.width, screen.height)).toEqual(screen);
    const portrait = containSize(9 / 16, screen.width, screen.height);
    expect(portrait.height).toBeCloseTo(screen.height);
    expect(portrait.width / portrait.height).toBeCloseTo(9 / 16);
    const wide = containSize(2.39, screen.width, screen.height);
    expect(wide.width).toBeCloseTo(screen.width);
    expect(wide.width / wide.height).toBeCloseTo(2.39);
    expect(containSize(Number.NaN, screen.width, screen.height)).toEqual(screen);
  });

  it('shows the poster until playback has begun and a frame exists', () => {
    const base = { state: 'ready', started: false, hasFrame: true } as MediaSnapshot;
    expect(screenContent(base, true)).toBe('poster');
    expect(screenContent(base, false)).toBe('blank');
    expect(screenContent({ ...base, started: true, state: 'playing' }, true)).toBe('video');
    expect(screenContent({ ...base, started: true, hasFrame: false, state: 'buffering' }, true)).toBe('poster');
    expect(screenContent({ ...base, started: true, state: 'error' }, true)).toBe('poster');
  });

  it('formats times and picks the main button', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(33.04)).toBe('0:33');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(null)).toBe('--:--');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('--:--');
    const snapshot = (state: MediaSnapshot['state']) => ({ state }) as MediaSnapshot;
    expect(primaryAction(snapshot('ready'))).toBe('play');
    expect(primaryAction(snapshot('paused'))).toBe('play');
    expect(primaryAction(snapshot('playing'))).toBe('pause');
    expect(primaryAction(snapshot('buffering'))).toBe('pause');
    expect(primaryAction(snapshot('ended'))).toBe('replay');
  });

  it('development film override accepts plain file names only', () => {
    expect(devFilm('?film=pattern-16x9.mp4')?.src).toBe('/fixtures/media/pattern-16x9.mp4');
    expect(devFilm('?film=pattern-no-duration.webm')?.type).toBe('video/webm');
    expect(devFilm('?film=../secret')).toBeNull();
    expect(devFilm('')).toBeNull();
  });
});

describe('video frame clock', () => {
  class FrameVideo {
    callbacks = new Map<number, () => void>();
    next = 1;
    requestVideoFrameCallback(callback: () => void) {
      const id = this.next++;
      this.callbacks.set(id, callback);
      return id;
    }
    cancelVideoFrameCallback(id: number) {
      this.callbacks.delete(id);
    }
    present() {
      const pending = [...this.callbacks.values()];
      this.callbacks.clear();
      for (const callback of pending) callback();
    }
  }

  it('asks for one render per presented frame, only while playing, one callback at a time', () => {
    const video = new FrameVideo();
    let renders = 0;
    const clock = new VideoFrameClock(video as unknown as HTMLVideoElement, () => renders++);
    expect(clock.supported).toBe(true);
    video.present();
    expect(renders).toBe(0);
    clock.run(true);
    clock.run(true);
    expect(video.callbacks.size).toBe(1);
    for (let i = 0; i < 24; i++) video.present();
    expect(renders).toBe(24);
    expect(video.callbacks.size).toBe(1);
    clock.run(false);
    expect(video.callbacks.size).toBe(0);
    expect(clock.pending).toBe(0);
    video.present();
    expect(renders).toBe(24);
    // Many play/pause cycles never pile up callbacks.
    for (let i = 0; i < 50; i++) {
      clock.run(true);
      clock.run(false);
    }
    clock.run(true);
    expect(video.callbacks.size).toBe(1);
    clock.dispose();
    expect(video.callbacks.size).toBe(0);
  });

  it('without the API: a bounded timer while playing, nothing otherwise', () => {
    vi.useFakeTimers();
    let renders = 0;
    const clock = new VideoFrameClock({} as HTMLVideoElement, () => renders++, 30);
    expect(clock.supported).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(renders).toBe(0);
    clock.run(true);
    vi.advanceTimersByTime(1000);
    expect(renders).toBeGreaterThanOrEqual(29);
    expect(renders).toBeLessThanOrEqual(30);
    clock.run(false);
    const stopped = renders;
    vi.advanceTimersByTime(5000);
    expect(renders).toBe(stopped);
    clock.run(true);
    clock.dispose();
    vi.advanceTimersByTime(5000);
    expect(renders).toBe(stopped);
    expect(clock.pending).toBe(0);
  });
});
