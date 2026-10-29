import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Color,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Side,
  type Texture,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

export interface InteriorEnvironment {
  texture: Texture;
  dispose(): void;
}

/**
 * A reflection approximation for metal and satin surfaces: a dark room with warm light strips
 * along the ceiling edges and cross beams, a faint warm glow at floor level and a cool panel where
 * the screen is, prefiltered once with PMREM. It is never shown as a background and is not
 * updated per frame; materials scale it with `envMapIntensity` (fabrics almost not at all).
 * Rebuild it after a WebGL context restore, since the prefiltered target is lost with the context.
 */
export function createInteriorEnvironment(renderer: WebGLRenderer): InteriorEnvironment {
  const room = environmentRoom();
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(room.scene, SIGMA, NEAR, FAR, { size: SIZE, position: VIEW });
  generator.dispose();
  room.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}

/**
 * The same environment, with the shader programs it needs compiled first, in the background where
 * the browser can (KHR_parallel_shader_compile). On a first visit (no shader cache yet) compiling
 * them inside the prefiltering held the page for about 0.4 s on a fast desktop. Reaches into
 * PMREMGenerator (three r186) for its blur and GGX materials; if those are not where expected, the
 * prefiltering compiles them itself as before.
 */
export async function createInteriorEnvironmentAsync(renderer: WebGLRenderer): Promise<InteriorEnvironment> {
  const room = environmentRoom();
  const generator = new PMREMGenerator(renderer);
  try {
    await precompile(renderer, generator, room.scene);
    const target = generator.fromScene(room.scene, SIGMA, NEAR, FAR, { size: SIZE, position: VIEW });
    return { texture: target.texture, dispose: () => target.dispose() };
  } finally {
    generator.dispose();
    room.dispose();
  }
}

/** Seen from mid-room at seated-eye height; blur, near and far of the cube camera; the cube size. */
const VIEW = new Vector3(0, 2.2, 1);
const SIGMA = 0.04;
const NEAR = 0.1;
const FAR = 40;
const SIZE = 256;

interface PmremInternals {
  _setSize?(size: number): void;
  _allocateTargets?(): WebGLRenderTarget;
  _blurMaterial?: Material | null;
  _ggxMaterial?: Material | null;
}

async function precompile(renderer: WebGLRenderer, generator: PMREMGenerator, scene: Scene): Promise<void> {
  const internals = generator as unknown as PmremInternals;
  if (typeof internals._setSize !== 'function' || typeof internals._allocateTargets !== 'function') return;
  internals._setSize(SIZE);
  // Allocates the generator's working target and its blur and GGX materials (kept for fromScene).
  const target = internals._allocateTargets();
  // Like the generator's own planes, it has positions: whether a geometry has them is part of a
  // program's identity, so without them these would be other programs than the ones it draws with.
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const passes = new Scene();
  for (const material of [internals._blurMaterial, internals._ggxMaterial]) if (material) passes.add(new Mesh(geometry, material));
  const camera = new PerspectiveCamera(90, 1, NEAR, FAR);
  // Programs for a half-float target, as the prefiltering draws them (no tone mapping, linear
  // output). Compiling starts in these calls; only the waiting is asynchronous.
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  const ready = [renderer.compileAsync(scene, camera), renderer.compileAsync(passes, camera)];
  renderer.setRenderTarget(previous);
  try {
    await Promise.all(ready);
  } finally {
    target.dispose();
    geometry.dispose();
  }
}

/** The room standing in for the reflections, before prefiltering; disposed once prefiltered. */
function environmentRoom(): { scene: Scene; dispose(): void } {
  const scene = new Scene();
  scene.background = new Color(0x0b0a0c);
  const geometries: BufferGeometry[] = [];
  const materials: MeshBasicMaterial[] = [];
  const add = (geometry: BufferGeometry, colour: number, strength: number, place: (mesh: Mesh) => void, side: Side = BackSide) => {
    // Colours above 1 are HDR radiance; the PMREM target is half float.
    const material = new MeshBasicMaterial({ color: new Color(colour).multiplyScalar(strength), side });
    const mesh = new Mesh(geometry, material);
    place(mesh);
    scene.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  };

  add(new BoxGeometry(12, 6.5, 18), 0x121013, 1, (m) => m.position.set(0, 3.25, 0));
  const warm = 0xffc98f;
  for (const x of [-5.5, 5.5]) add(new BoxGeometry(0.1, 0.05, 17), warm, 6, (m) => m.position.set(x, 6.2, 0.4), DoubleSide);
  for (let k = 0; k < 7; k++) add(new BoxGeometry(11, 0.05, 0.1), warm, 4, (m) => m.position.set(0, 6.3, -6 + 2.3 * k), DoubleSide);
  add(new PlaneGeometry(8.5, 4.8), 0xdde7f5, 2.5, (m) => m.position.set(0, 3.4, -8.6), FrontSide);
  add(new PlaneGeometry(12, 18), 0x4a3424, 0.6, (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
  }, FrontSide);

  return {
    scene,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
