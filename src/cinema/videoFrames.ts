/**
 * Asks for a render each time the film presents a new frame, and only while it plays.
 *
 * With `requestVideoFrameCallback` (Chrome, Edge, Safari 15.4+, Firefox 132+) one callback is
 * pending at a time and each one asks for a render; the render host merges that with camera,
 * hover and selection requests into one frame. VideoTexture registers its own frame callback to
 * mark the texture for upload; this one only schedules the render, so nothing is uploaded twice.
 * A 24 fps film therefore draws about 24 frames a second while the camera rests, not 60.
 *
 * Without it, a timer at `fallbackFps` asks for renders instead (VideoTexture then uploads the
 * current frame once per render), and only while playing: never while paused, ended, buffering,
 * hidden, or after a lost context.
 */
export class VideoFrameClock {
  readonly supported: boolean;
  private readonly video: HTMLVideoElement;
  private readonly onFrame: () => void;
  private readonly fallbackFps: number;
  private callbackId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Frames reported since creation (presented frames, or fallback ticks). */
  frames = 0;

  constructor(video: HTMLVideoElement, onFrame: () => void, fallbackFps = 30) {
    this.video = video;
    this.onFrame = onFrame;
    this.fallbackFps = fallbackFps;
    this.supported = typeof video.requestVideoFrameCallback === 'function';
  }

  /** Follows the media: true while frames are expected (playing), false otherwise. */
  run(playing: boolean): void {
    if (playing === this.running) return;
    this.running = playing;
    if (!playing) {
      this.cancel();
      return;
    }
    if (this.supported) this.callbackId = this.video.requestVideoFrameCallback(this.handleFrame);
    else this.timer = setInterval(this.handleTick, 1000 / this.fallbackFps);
  }

  /** Callbacks or timers waiting (0 or 1), for checks. */
  get pending(): number {
    return (this.callbackId !== null ? 1 : 0) + (this.timer !== null ? 1 : 0);
  }

  dispose(): void {
    this.running = false;
    this.cancel();
  }

  private cancel(): void {
    if (this.callbackId !== null) this.video.cancelVideoFrameCallback(this.callbackId);
    this.callbackId = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private readonly handleFrame = (): void => {
    this.callbackId = null;
    if (!this.running) return;
    this.frames++;
    this.onFrame();
    this.callbackId = this.video.requestVideoFrameCallback(this.handleFrame);
  };

  private readonly handleTick = (): void => {
    if (!this.running) return;
    this.frames++;
    this.onFrame();
  };
}
