import { DataTexture, type Material, REVISION, type Texture, UniformsLib, type WebGLRenderer } from 'three';

/**
 * Workaround for a three.js retention problem, verified on r186 (REVISION '186').
 *
 * Cause: a few textures live for the whole page and are shared by every renderer and context:
 * the rect-area-light LTC tables (`UniformsLib.LTC_*`) and the DFG lookup table of physically based
 * materials (module-private, created by `getDFGLUT()`). When a WebGL context first uploads a
 * texture, that context's texture manager (WebGLTextures) adds its `onTextureDispose` function as a
 * `dispose` listener. Nothing removes it when the context is lost and restored (three re-creates
 * its managers on restore) or when the renderer is disposed. The old function's closure keeps the
 * old context's whole bookkeeping reachable: shader programs, uniforms, state. Measured: about
 * 0.37 MiB of JS heap per context restore and 0.25 MiB per renderer, growing without bound.
 *
 * Ownership: one texture manager uses one `onTextureDispose` function for every texture it
 * uploads. A private 1×1 probe texture that only this renderer ever uploads therefore tells us the
 * current context's function exactly. When that context ends (lost, or renderer disposed), exactly
 * that function is removed from the shared textures. Listeners of any other renderer or context,
 * and any other texture (scene textures, the film's VideoTexture), are never touched. The removed
 * function could only delete GPU handles that died with its context.
 *
 * Applies only while one renderer owns a context: call `attach` when a context comes up,
 * `release` when it is lost, `dispose` when the renderer goes (`collect` after frames). Remove this
 * module (and its calls in RenderHost) once three.js drops its listeners on context loss and renderer disposal itself;
 * the lifecycle check in `npm run capture` (one listener per shared texture after restores and
 * remounts) shows whether it is still needed.
 */
export class SharedTextureListeners {
  static readonly verifiedRevision = '186';
  private readonly renderer: WebGLRenderer;
  private readonly materialProbe?: () => Material | undefined;
  private readonly probe = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly shared = new Set<Texture>();
  /** The `dispose` listener of the texture manager of the context in use, once known. */
  private current: Listener | null = null;

  /** `materialProbe`: a material that has been drawn with PBR shading, to reach the DFG table. */
  constructor(renderer: WebGLRenderer, materialProbe?: () => Material | undefined) {
    this.renderer = renderer;
    this.materialProbe = materialProbe;
    // Version 1: every new context (new texture manager) uploads it once, adding its listener.
    this.probe.needsUpdate = true;
    if (import.meta.env?.DEV && REVISION !== SharedTextureListeners.verifiedRevision) {
      console.info(`[cinema] SharedTextureListeners was verified on three r${SharedTextureListeners.verifiedRevision}; running r${REVISION}.`);
    }
  }

  /** A context is up (first start, or restored): learn its texture manager's listener. */
  attach(): void {
    this.renderer.initTexture(this.probe);
    this.current = listenersOf(this.probe).at(-1) ?? null;
  }

  /** Finds the shared textures; the DFG table is only reachable once a PBR material was drawn. */
  collect(): void {
    if (this.shared.size >= 5) return;
    const lib = UniformsLib as unknown as Record<string, Texture | undefined>;
    for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2']) if (lib[key]?.isTexture) this.shared.add(lib[key]);
    const material = this.materialProbe?.();
    if (!material) return;
    const uniforms = (this.renderer.properties.get(material) as { uniforms?: { dfgLUT?: { value?: Texture } } }).uniforms;
    const lut = uniforms?.dfgLUT?.value;
    if (lut?.isTexture) this.shared.add(lut);
  }

  /** The context in use ended (lost, or about to be dropped): remove its listener only. */
  release(): void {
    const listener = this.current;
    if (!listener) return;
    for (const texture of [...this.shared, this.probe]) texture.removeEventListener('dispose', listener);
    this.current = null;
  }

  /** The renderer is being disposed (its context still alive): free the probe, then release. */
  dispose(): void {
    // The live context's own listener frees the probe's GPU texture (and leaves the probe).
    this.probe.dispose();
    this.release();
  }

  /** Development/tests: dispose listeners on each shared texture (1 = the live context's). */
  counts(): number[] {
    return [...this.shared].map((texture) => listenersOf(texture).length);
  }

  /** Development/tests: whether the live context's listener is known. */
  get attached(): boolean {
    return this.current !== null;
  }
}

type Listener = (event: unknown) => void;

/** EventDispatcher's listeners for 'dispose' (a three.js internal field, not in its typings). */
function listenersOf(texture: Texture): Listener[] {
  return (texture as unknown as { _listeners?: Record<string, Listener[] | undefined> })._listeners?.dispose ?? [];
}
