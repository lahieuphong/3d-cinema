import { Material, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { SharedTextureListeners } from './sharedTextureListeners.ts';

type Listener = (event: { target: Texture }) => void;

/**
 * A stand-in for one WebGLRenderer whose context can be lost and restored: like three's texture
 * manager, each context has one `onTextureDispose` function, added to a texture on its first upload
 * and removing itself when called.
 */
function fakeRenderer(lut: Texture) {
  let uploaded = new WeakSet<Texture>();
  const makeContextListener = (): Listener => {
    const listener: Listener = (event) => event.target.removeEventListener('dispose', listener as never);
    return listener;
  };
  const renderer = {
    contextListener: makeContextListener(),
    initTexture(texture: Texture) {
      if (uploaded.has(texture) || texture.version === 0) return;
      uploaded.add(texture);
      texture.addEventListener('dispose', renderer.contextListener as never);
    },
    /** Drawing a PBR material uploads the shared table. */
    draw() {
      renderer.initTexture(lut);
    },
    restoreContext() {
      uploaded = new WeakSet();
      renderer.contextListener = makeContextListener();
    },
    properties: { get: () => ({ uniforms: { dfgLUT: { value: lut } } }) },
  };
  return renderer;
}

const listeners = (texture: Texture) =>
  ((texture as unknown as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []) as Listener[];

function sharedTexture(): Texture {
  const texture = new Texture();
  texture.needsUpdate = true;
  return texture;
}

describe('shared texture listeners workaround', () => {
  it('removes only the ended context’s listener from the shared textures', () => {
    const lut = sharedTexture();
    const renderer = fakeRenderer(lut);
    // Another renderer on the page also uses the table; its listener must survive.
    const foreign: Listener = () => {};
    lut.addEventListener('dispose', foreign as never);
    // The film's texture, uploaded by the same context, is not a shared texture: never touched here.
    const film = sharedTexture();
    renderer.initTexture(film);

    const workaround = new SharedTextureListeners(renderer as unknown as WebGLRenderer, () => new Material());
    workaround.attach();
    expect(workaround.attached).toBe(true);
    renderer.draw();
    workaround.collect();
    expect(workaround.counts()).toEqual([2]);
    const first = renderer.contextListener;

    // Context lost: its listener goes from the table, nothing else does.
    workaround.release();
    expect(listeners(lut)).toEqual([foreign]);
    expect(listeners(film)).toEqual([first]);

    // Restored: the new context uploads the table again; still one listener of ours.
    renderer.restoreContext();
    workaround.attach();
    renderer.draw();
    workaround.collect();
    expect(listeners(lut)).toEqual([foreign, renderer.contextListener]);
    expect(renderer.contextListener).not.toBe(first);

    // Many loss/restore rounds never pile listeners up.
    for (let i = 0; i < 20; i++) {
      workaround.release();
      renderer.restoreContext();
      workaround.attach();
      renderer.draw();
    }
    expect(listeners(lut)).toHaveLength(2);

    // Renderer disposed: ours goes, the other renderer's stays.
    workaround.dispose();
    expect(listeners(lut)).toEqual([foreign]);
    expect(workaround.attached).toBe(false);
  });

  it('does nothing before a context listener is known', () => {
    const lut = sharedTexture();
    const foreign: Listener = () => {};
    lut.addEventListener('dispose', foreign as never);
    const renderer = fakeRenderer(lut);
    const workaround = new SharedTextureListeners(renderer as unknown as WebGLRenderer, () => new Material());
    workaround.collect();
    workaround.release();
    expect(listeners(lut)).toEqual([foreign]);
  });
});
