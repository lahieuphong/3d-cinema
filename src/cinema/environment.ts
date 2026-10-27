import {
  BackSide,
  BoxGeometry,
  DoubleSide,
  FrontSide,
  type BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Side,
  type Texture,
  Vector3,
  type WebGLRenderer,
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

  const generator = new PMREMGenerator(renderer);
  // Seen from mid-room at seated-eye height.
  const target = generator.fromScene(scene, 0.04, 0.1, 40, { position: new Vector3(0, 2.2, 1) });
  generator.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();

  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
