import { type Material, WebGLRenderer } from 'three';
import { GpuTimer } from './gpuTimer.ts';
import { SharedTextureListeners } from './sharedTextureListeners.ts';
import { measure } from './timing.ts';

export type ViewStatus = { kind: 'ready' } | { kind: 'context-lost' } | { kind: 'error'; message: string };

/** Thrown when the browser cannot provide the WebGL 2 context three.js needs. */
export class WebGLUnavailableError extends Error {
  override name = 'WebGLUnavailableError';
}

export interface RenderHostOptions {
  background: number;
  maxPixelRatio: number;
  ariaLabel: string;
  /** Frame steps longer than this (seconds) are clamped, so nothing jumps after a pause. */
  maxDeltaSeconds?: number;
  /** Called with the new CSS size whenever the container resizes (never with 0). */
  onResize(width: number, height: number): void;
  /**
   * Advances animation by `dt` seconds and draws one frame. Returns true while another frame is
   * needed. `dt` is 0 on the first frame after the loop was idle; `interval` is the real time since
   * the previous frame (ms) when this one follows it directly, else null. `partial` when only
   * `requestPartialRender()` asked for this frame: the canvas still holds the previous one, so
   * only what changed needs drawing.
   */
  onFrame(time: number, dt: number, interval: number | null, partial: boolean): boolean;
  /**
   * A frame's GPU time (ms), a few frames after it was drawn, where the browser can measure it;
   * `continuous` when that frame followed the previous one directly.
   */
  onGpuTime?(ms: number, continuous: boolean): void;
  onStatus(status: ViewStatus): void;
  /** The context is gone: stop anything that moves; nothing is drawn until it comes back. */
  onContextLost?(): void;
  /** After a lost WebGL context comes back: rebuild anything that lived only on the GPU. */
  onContextRestored?(): void;
  /** A physically based material that is drawn, through which the page-wide DFG table is found. */
  textureProbe?(): Material | undefined;
}

/**
 * Owns one WebGL renderer and its canvas inside `container`: size and pixel ratio, an on-demand
 * frame loop, context loss reporting and teardown. A frame is scheduled only by `requestRender()`,
 * and frames keep coming only while `onFrame` asks for more; while the context is lost, none are.
 */
export class RenderHost {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly options: RenderHostOptions;
  private maxPixelRatio: number;
  private resizeObserver: ResizeObserver | null = null;
  private frameId: number | null = null;
  /** Something other than `requestPartialRender()` asked for the next frame. */
  private fullPending = true;
  private started = false;
  private renderedOnce = false;
  private disposed = false;
  private contextLost = false;
  /** Time of the previous frame while the loop keeps running; null once it has gone idle. */
  private lastFrameTime: number | null = null;
  /** Workaround for three.js r186 listeners on page-wide textures (see that module). */
  private readonly sharedTextures: SharedTextureListeners;
  /** Frames drawn by the on-demand loop; stays put while nothing moves. */
  private framesRendered = 0;
  private readonly gpuTimer: GpuTimer;
  /** The longest side the drawing buffer may have on this GPU (read once). */
  private maxSide: number | null = null;

  constructor(container: HTMLElement, options: RenderHostOptions) {
    this.container = container;
    this.options = options;
    this.maxPixelRatio = options.maxPixelRatio;
    if (typeof WebGL2RenderingContext === 'undefined') {
      throw new WebGLUnavailableError('Trình duyệt này không hỗ trợ WebGL 2.');
    }
    try {
      // The canvas keeps its last frame (preserveDrawingBuffer), so a frame that only changes the
      // film's picture redraws only that part of the canvas (see requestPartialRender).
      this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    } catch (cause) {
      throw new WebGLUnavailableError('Không tạo được ngữ cảnh WebGL. Tăng tốc phần cứng có thể đang bị tắt.', { cause });
    }
    this.renderer.setClearColor(options.background);
    // Shader error checks query each program's status and logs on its first use: a synchronous
    // round trip to the GPU process per program, which waits for any compile still running.
    // three.js advises turning them off in production; development keeps them, so a broken shader
    // is still reported there.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.sharedTextures = new SharedTextureListeners(this.renderer, options.textureProbe);
    this.sharedTextures.attach();

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cinema-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', options.ariaLabel);
    container.append(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  /**
   * Starts tracking the container size and draws the first frame. Call once the scene is built
   * (and its shaders compiled): until then nothing is drawn, whatever asks for a frame.
   */
  start(): void {
    if (this.disposed || this.resizeObserver) return;
    this.started = true;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resize()) this.drawNow();
    });
    this.resizeObserver.observe(this.container);
    this.resize();
    this.requestRender();
  }

  /**
   * Caps the device pixel ratio (quality setting) and resizes the drawing buffer to match. Called
   * from an input task, so the scheduled frame still draws before the browser paints; drawing here
   * at once would also catch the caller halfway (e.g. shadow map reallocated, not yet redrawn).
   */
  setMaxPixelRatio(value: number): void {
    this.maxPixelRatio = value;
    // Before start() nothing is sized yet: start() applies it.
    if (!this.started) return;
    this.resize();
    this.requestRender();
  }

  readonly requestRender = (): void => {
    this.fullPending = true;
    this.schedule();
  };

  /**
   * A frame in which only something small may change (a new film frame on the screen): unless
   * anything else asks for the same frame, the owner may draw just that part (`partial`).
   */
  readonly requestPartialRender = (): void => {
    this.schedule();
  };

  private schedule(): void {
    if (!this.started || this.disposed || this.contextLost || this.frameId !== null) return;
    this.frameId = requestAnimationFrame(this.renderFrame);
  }

  /** Renderer figures after the last frame, for development tooling and automated checks. */
  getDebugInfo() {
    const { info } = this.renderer;
    return {
      drawingBuffer: { width: this.canvas.width, height: this.canvas.height },
      pixelRatio: this.renderer.getPixelRatio(),
      render: { calls: info.render.calls, triangles: info.render.triangles },
      memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      framesRendered: this.framesRendered,
      gpuTiming: this.gpuTimer.supported,
      /** Dispose listeners on each page-wide three.js texture: 1 (this context's) when nothing leaks. */
      pageTextureListeners: this.sharedTextures.counts(),
    };
  }

  /** Stops the loop and releases the renderer, its GL context and the canvas. Scene resources belong to the caller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    // This renderer's listener leaves the page-wide textures while its context is still alive.
    this.sharedTextures.dispose();
    this.gpuTimer.dispose();
    this.renderer.dispose();
    // Release the GL context now instead of waiting for GC, so remounts never pile up contexts
    // (a context that is already lost has nothing left to release).
    if (!this.contextLost) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private readonly renderFrame = (time: number): void => {
    this.frameId = null;
    this.framesRendered++;
    const maxDelta = (this.options.maxDeltaSeconds ?? 0.1) * 1000;
    const interval = this.lastFrameTime === null ? null : Math.max(0, time - this.lastFrameTime);
    const dt = interval === null ? 0 : Math.min(maxDelta, interval) / 1000;
    this.gpuTimer.collect((ms, continuous) => this.options.onGpuTime?.(ms, continuous));
    const partial = !this.fullPending && this.renderedOnce;
    this.fullPending = false;
    const start = performance.now();
    this.gpuTimer.begin(interval !== null);
    const needsAnotherFrame = this.options.onFrame(time, dt, interval, partial);
    this.gpuTimer.end();
    this.sharedTextures.collect();
    if (!this.renderedOnce) {
      measure('first-frame', start);
      this.renderedOnce = true;
      this.options.onStatus({ kind: 'ready' });
    }
    this.lastFrameTime = needsAnotherFrame ? time : null;
    if (needsAnotherFrame) this.requestRender();
  };

  /** Applies the container's size; false while it has none (hidden). */
  private resize(): boolean {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return false;
    // Re-read the device pixel ratio: it changes with browser zoom and when moving between screens.
    // Never beyond what the GPU can allocate (very large or very dense screens).
    this.maxSide ??= this.maxDrawingBufferSide();
    const ratio = Math.min(window.devicePixelRatio, this.maxPixelRatio, this.maxSide / width, this.maxSide / height);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.options.onResize(width, height);
    return true;
  }

  /** The longest side the drawing buffer may have on this GPU. */
  private maxDrawingBufferSide(): number {
    const gl = this.renderer.getContext();
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
    const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number | null;
    return Math.min(viewport ? Math.min(viewport[0], viewport[1]) : 4096, renderbuffer || 4096);
  }

  /**
   * Sizing the canvas clears it. When the container resizes (seat panel opened, window resized or
   * rotated) the frame is therefore drawn at once instead of on the next animation frame:
   * ResizeObserver callbacks run after this frame's animation callbacks, after layout and before
   * paint, so a frame requested from there would leave the cleared canvas on screen for one frame.
   * Before the first frame, or without a context, it only schedules one.
   */
  private drawNow(): void {
    if (this.disposed || this.contextLost || !this.renderedOnce) {
      this.requestRender();
      return;
    }
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.fullPending = true;
    this.renderFrame(performance.now());
  }

  private readonly handleContextLost = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastFrameTime = null;
    this.contextLost = true;
    this.gpuTimer.lost();
    // The listener of the context that is going away; the restored context brings its own.
    this.sharedTextures.release();
    this.options.onContextLost?.();
    this.options.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.fullPending = true;
    this.gpuTimer.restored(this.renderer.getContext() as WebGL2RenderingContext);
    this.sharedTextures.attach();
    this.options.onContextRestored?.();
    // Lost before the first frame: "ready" comes with the first frame, once the owner starts.
    if (!this.started) return;
    this.options.onStatus({ kind: 'ready' });
    this.requestRender();
  };
}

export { prefersReducedMotion } from './quality.ts';
