import { WebGLRenderer } from 'three';

export type ViewStatus = { kind: 'ready' } | { kind: 'context-lost' } | { kind: 'error'; message: string };

/** Thrown when the browser cannot provide the WebGL 2 context three.js needs. */
export class WebGLUnavailableError extends Error {
  override name = 'WebGLUnavailableError';
}

export interface RenderHostOptions {
  background: number;
  maxPixelRatio: number;
  ariaLabel: string;
  /** Called with the new CSS size whenever the container resizes (never with 0). */
  onResize(width: number, height: number): void;
  /** Advances animation and draws one frame. Returns true while another frame is needed. */
  onFrame(time: number): boolean;
  onStatus(status: ViewStatus): void;
  /** After a lost WebGL context comes back: rebuild anything that lived only on the GPU. */
  onContextRestored?(): void;
}

/**
 * Owns one WebGL renderer and its canvas inside `container`: size and pixel ratio, an on-demand
 * frame loop, context loss reporting and teardown. A frame is scheduled only by `requestRender()`,
 * and frames keep coming only while `onFrame` asks for more.
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
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.container);
    this.resize();
    this.requestRender();
  }

  /** Caps the device pixel ratio (quality setting) and resizes the drawing buffer to match. */
  setMaxPixelRatio(value: number): void {
    this.maxPixelRatio = value;
    this.resize();
  }

  readonly requestRender = (): void => {
    if (this.disposed || this.frameId !== null) return;
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
    this.renderer.dispose();
    // Release the GL context now instead of waiting for GC, so remounts never pile up contexts.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private readonly renderFrame = (time: number): void => {
    this.frameId = null;
    this.framesRendered++;
    const needsAnotherFrame = this.options.onFrame(time);
    if (!this.renderedOnce) {
      this.renderedOnce = true;
      this.options.onStatus({ kind: 'ready' });
    }
    if (needsAnotherFrame) this.requestRender();
  };

  private readonly resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    // Re-read the device pixel ratio: it changes with browser zoom and when moving between screens.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.options.onResize(width, height);
    this.requestRender();
  };

  private readonly handleContextLost = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.options.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.options.onContextRestored?.();
    this.options.onStatus({ kind: 'ready' });
    this.requestRender();
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
