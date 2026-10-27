import { type Material, type Texture, UniformsLib, WebGLRenderer } from 'three';

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

/** EventDispatcher's listener lists (a three.js internal field, not in its type definitions). */
type Listeners = { _listeners?: Record<string, Array<(event: unknown) => void> | undefined> };

/**
 * Textures three.js (r186) keeps for the whole page and shares between renderers and contexts: the
 * area lights' LTC tables and the DFG lookup table used by physically based materials.
 *
 * Each WebGL context that uploads one adds a `dispose` listener to it from that context's texture
 * manager, and nothing ever removes it. After a context loss and restore, or once a renderer is
 * disposed, the old listener keeps the old context's whole bookkeeping alive (programs, uniforms,
 * state: measured about 0.37 MiB per restore). The listeners can only delete GPU handles that died
 * with their context, so dropping them is safe; this app has one renderer at a time.
 */
function dropDisposeListeners(textures: Iterable<Texture>, only?: ReadonlyMap<Texture, ReadonlyArray<(event: unknown) => void>>): void {
  for (const texture of textures) {
    const listeners = only ? only.get(texture) : (texture as unknown as Listeners)._listeners?.dispose;
    for (const listener of [...(listeners ?? [])]) texture.removeEventListener('dispose', listener);
  }
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
  /** Page-wide three.js textures (see dropDisposeListeners); the DFG table joins once found. */
  private readonly pageTextures = new Set<Texture>();
  /** Their dispose listeners from the context that was just lost. */
  private staleListeners: Map<Texture, ReadonlyArray<(event: unknown) => void>> | null = null;
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
      pageTextureListeners: [...this.pageTextures].map((texture) => (texture as unknown as Listeners)._listeners?.dispose?.length ?? 0),
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
    // Every listener on the page-wide textures now belongs to a dead renderer.
    dropDisposeListeners(this.pageTextures);
  }

  private readonly renderFrame = (time: number): void => {
    this.frameId = null;
    this.framesRendered++;
    const maxDelta = (this.options.maxDeltaSeconds ?? 0.1) * 1000;
    const dt = this.lastFrameTime === null ? 0 : Math.min(maxDelta, Math.max(0, time - this.lastFrameTime)) / 1000;
    const needsAnotherFrame = this.options.onFrame(time, dt);
    this.findPageTextures();
    if (!this.renderedOnce) {
      this.renderedOnce = true;
      this.options.onStatus({ kind: 'ready' });
    }
    this.lastFrameTime = needsAnotherFrame ? time : null;
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

  /** Collects the page-wide textures; the DFG table is only reachable once a material using it is drawn. */
  private findPageTextures(): void {
    if (this.pageTextures.size >= 5) return;
    const lib = UniformsLib as unknown as Record<string, Texture | undefined>;
    for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2']) if (lib[key]?.isTexture) this.pageTextures.add(lib[key]);
    const probe = this.options.textureProbe?.();
    const lut = probe ? (this.renderer.properties.get(probe) as { uniforms?: { dfgLUT?: { value?: Texture } } }).uniforms?.dfgLUT?.value : undefined;
    if (lut?.isTexture) this.pageTextures.add(lut);
  }

  private readonly handleContextLost = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastFrameTime = null;
    this.contextLost = true;
    // These listeners belong to the context that is going away; dropped once the new one is up.
    this.staleListeners = new Map(
      [...this.pageTextures].map((texture) => [texture, [...((texture as unknown as Listeners)._listeners?.dispose ?? [])]]),
    );
    this.options.onContextLost?.();
    this.options.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    if (this.staleListeners) dropDisposeListeners(this.staleListeners.keys(), this.staleListeners);
    this.staleListeners = null;
    this.options.onContextRestored?.();
    this.options.onStatus({ kind: 'ready' });
    this.requestRender();
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
