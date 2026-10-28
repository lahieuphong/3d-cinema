import { type Material, WebGLRenderer } from 'three';
import { SharedTextureListeners } from './sharedTextureListeners.ts';

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
   * needed. `dt` is 0 on the first frame after the loop was idle.
   */
  onFrame(time: number, dt: number): boolean;
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
  private renderedOnce = false;
  private disposed = false;
  private contextLost = false;
  /** Time of the previous frame while the loop keeps running; null once it has gone idle. */
  private lastFrameTime: number | null = null;
  /** Workaround for three.js r186 listeners on page-wide textures (see that module). */
  private readonly sharedTextures: SharedTextureListeners;
  /** Frames drawn by the on-demand loop; stays put while nothing moves. */
  private framesRendered = 0;

  constructor(container: HTMLElement, options: RenderHostOptions) {
    this.container = container;
    this.options = options;
    this.maxPixelRatio = options.maxPixelRatio;
    if (typeof WebGL2RenderingContext === 'undefined') {
      throw new WebGLUnavailableError('Trình duyệt này không hỗ trợ WebGL 2.');
    }
    try {
      this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (cause) {
      throw new WebGLUnavailableError('Không tạo được ngữ cảnh WebGL. Tăng tốc phần cứng có thể đang bị tắt.', { cause });
    }
    this.renderer.setClearColor(options.background);
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

  /** Starts tracking the container size and draws the first frame. Call once the scene is built. */
  start(): void {
    if (this.disposed || this.resizeObserver) return;
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
    this.resize();
    this.requestRender();
  }

  readonly requestRender = (): void => {
    if (this.disposed || this.contextLost || this.frameId !== null) return;
    this.frameId = requestAnimationFrame(this.renderFrame);
  };

  /** Renderer figures after the last frame, for development tooling and automated checks. */
  getDebugInfo() {
    const { info } = this.renderer;
    return {
      drawingBuffer: { width: this.canvas.width, height: this.canvas.height },
      pixelRatio: this.renderer.getPixelRatio(),
      render: { calls: info.render.calls, triangles: info.render.triangles },
      memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      framesRendered: this.framesRendered,
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
    const dt = this.lastFrameTime === null ? 0 : Math.min(maxDelta, Math.max(0, time - this.lastFrameTime)) / 1000;
    const needsAnotherFrame = this.options.onFrame(time, dt);
    this.sharedTextures.collect();
    if (!this.renderedOnce) {
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.options.onResize(width, height);
    return true;
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
    this.renderFrame(performance.now());
  }

  private readonly handleContextLost = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastFrameTime = null;
    this.contextLost = true;
    // The listener of the context that is going away; the restored context brings its own.
    this.sharedTextures.release();
    this.options.onContextLost?.();
    this.options.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.sharedTextures.attach();
    this.options.onContextRestored?.();
    this.options.onStatus({ kind: 'ready' });
    this.requestRender();
  };
}

export { prefersReducedMotion } from './quality.ts';
