import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Light,
  Matrix4,
  RectAreaLight,
  SpotLight,
  Vector3,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { ToggleablePart } from './architecture.ts';
import { stairPitchY, type AuditoriumLayout, type Box } from './layout.ts';

let areaLightsReady = false;

/**
 * The LTC lookup tables RectAreaLight needs are global to three.js; create them once per page.
 * (RectAreaLightUniformsLib.init() has no guard and would build new tables on every call.)
 */
function ensureAreaLights(): void {
  if (areaLightsReady) return;
  RectAreaLightUniformsLib.init();
  areaLightsReady = true;
}

/** What a light is fixed to; it switches off when that part is hidden. */
type Mount = ToggleablePart | 'room';

interface RigLight {
  name: string;
  light: Light;
  mount: Mount;
}

export interface RoomLighting {
  group: Group;
  /** The only shadow-casting light: the ceiling downlight, or the neutral inspection light while the ceiling is hidden. */
  key: DirectionalLight;
  setPartVisible(part: ToggleablePart, visible: boolean): void;
  setShadowQuality(mapSize: number, radius: number): void;
  /** Light states for development tooling and checks. */
  describe(): Record<string, { on: boolean; intensity: number; color: string }>;
  dispose(): void;
}

const WARM = 0xffc98f;

/**
 * "Explore the cinema" lighting, by role:
 * - base: a warm hemisphere standing in for indirect light: "sky" is the light coming down from the
 *   lit coves and slots, "ground" the warm light bounced off carpet and seats, which is all that
 *   reaches the ceiling; it keeps charcoal surfaces readable without lifting the exposure. The sky
 *   side stays well under the downlight, so floors and seat tops are modelled by the downlight and
 *   its shadows rather than lit flat; where the floor is hidden (under seats, in corners) the baked
 *   occlusion (bakedOcclusion.ts) takes it and the environment's share down further;
 * - ceiling downlight: one directional light standing in for the beam slots; the only shadow caster;
 *   normal bias 1.2 cm (a shadow texel is about 1 cm at 2048 px, 2 cm at 1024), enough against acne
 *   and small enough that shadows stay attached to the seat feet;
 * - screen: an area light over the picture, cool-neutral, lighting the stage and front rows
 *   (the screen's own unlit material does not light anything);
 * - architectural: one long area light per soffit cove washing the side walls, and one per aisle
 *   along the handrail recess lighting the steps (no light per strip segment or per step);
 * - curtains: a soft spot per curtain from the ceiling, inboard and in front of it, so the light
 *   crosses the folds sideways and models them.
 * Intensities are tuned by eye for tone mapping at exposure 1, not physical photometry.
 * Lights fixed to the ceiling or a wall switch off with it; with the ceiling hidden, the downlight
 * becomes a neutral inspection light so the room stays readable and seats keep their shadows.
 */
export function createRoomLighting(layout: AuditoriumLayout): RoomLighting {
  ensureAreaLights();
  const { interior, structure, screen, config, rows } = layout;
  const ceiling = config.interior.ceiling;
  const group = new Group();
  group.name = 'lighting';
  const lights: RigLight[] = [];
  const add = <L extends Light>(name: string, light: L, mount: Mount): L => {
    light.name = name;
    group.add(light);
    lights.push({ name, light, mount });
    return light;
  };

  add('base', new HemisphereLight(0x6c5f52, 0x7a5a4a, 2.0), 'room');

  // Ceiling downlight: from above, a little from the back and right, so seat shadows fall just
  // under and in front of each seat.
  const key = add('ceiling-downlight', new DirectionalLight(0xffe2c4, 1.85), 'ceiling');
  const centre = new Vector3(0, interior.y.max / 2, 0);
  key.position.copy(centre).addScaledVector(new Vector3(0.12, 1, 0.3).normalize(), 20);
  key.target.position.copy(centre);
  group.add(key.target);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  fitShadowCamera(key, structure);

  const screenLight = add('screen', new RectAreaLight(0xdde7f5, 1.6, screen.width, screen.height), 'room');
  screenLight.position.set(screen.center.x, screen.center.y, screen.center.z + 0.05);
  screenLight.lookAt(screen.center.x, screen.center.y, interior.z.max);

  // Soffit coves: a long, thin area light in each slot, aimed down and out at the wall panels.
  const bh = ceiling.bulkhead;
  const slotX = structure.x.max - bh.width + bh.lipWidth + bh.slotWidth / 2;
  const coveLength = interior.z.max - bh.firstZ;
  for (const side of [-1, 1] as const) {
    const cove = add(`cove-${side < 0 ? 'left' : 'right'}`, new RectAreaLight(WARM, 45, coveLength, bh.slotWidth), 'ceiling');
    cove.position.set(side * slotX, interior.y.max - bh.depth + ceiling.slotRecess, (bh.firstZ + interior.z.max) / 2);
    orientStrip(cove, new Vector3(0, 0, 1), new Vector3(side * 0.45, -1, 0).normalize());
  }

  // Aisle guides: along the handrail recess, aimed down and in at the steps. The right one sits on
  // the right wall, so it goes with it; the left wall never hides.
  const first = rows[0];
  const last = rows[rows.length - 1];
  const along = new Vector3(0, last.floorY - first.floorY, last.treadZ.min - first.treadZ.min);
  const runLength = along.length();
  along.normalize();
  const guideHeight = config.interior.wallPanels.dadoHeight - 0.05;
  for (const side of [-1, 1] as const) {
    const midZ = (first.treadZ.min + last.treadZ.min) / 2;
    const guide = add(
      `aisle-guide-${side < 0 ? 'left' : 'right'}`,
      new RectAreaLight(WARM, 28, runLength, 0.03),
      side > 0 ? 'rightWall' : 'room',
    );
    guide.position.set(side * (structure.x.max - 0.02), stairPitchY(layout, midZ) + guideHeight, midZ);
    // Straight down, with the part along the slope removed so it stays perpendicular to the strip.
    const down = new Vector3(0, -1, 0).addScaledVector(along, along.y).normalize();
    orientStrip(guide, along, new Vector3(-side * 0.7, 0, 0).addScaledVector(down, 0.7).normalize());
  }

  // Curtain lights: on the ceiling towards the room centre, aimed out across the folds.
  const c = config.interior.curtains;
  for (const side of [-1, 1] as const) {
    const x = (side * (c.innerX + c.outerX)) / 2;
    const spot = add(`curtain-${side < 0 ? 'left' : 'right'}`, new SpotLight(0xffe4cc, 90, 0, 0.5, 0.8, 2), 'ceiling');
    spot.position.set(side * (c.innerX - 2.2), interior.y.max - 0.25, c.centerZ + 1.8);
    spot.target.position.set(x, 1.8, c.centerZ);
    group.add(spot.target);
  }

  const ceilingColour = key.color.clone();
  const inspectionColour = new Color(0xf2efea);
  const hidden = new Set<ToggleablePart>();
  const apply = () => {
    for (const { light, mount } of lights) {
      if (light === key) continue;
      light.visible = mount === 'room' || !hidden.has(mount);
    }
    key.color.copy(hidden.has('ceiling') ? inspectionColour : ceilingColour);
  };

  return {
    group,
    key,
    setPartVisible(part, visible) {
      if (visible) hidden.delete(part);
      else hidden.add(part);
      apply();
    },
    setShadowQuality(mapSize, radius) {
      key.shadow.mapSize.set(mapSize, mapSize);
      key.shadow.radius = radius;
      // Reallocated at the new size on the next shadow update.
      key.shadow.map?.dispose();
      key.shadow.map = null;
    },
    describe() {
      return Object.fromEntries(
        lights.map(({ name, light }) => [
          name === key.name && hidden.has('ceiling') ? 'inspection-light' : name,
          { on: light.visible, intensity: light.intensity, color: `#${light.color.getHexString()}` },
        ]),
      );
    },
    dispose() {
      for (const { light } of lights) light.dispose();
    },
  };
}

export interface StudioLighting {
  group: Group;
  key: DirectionalLight;
  setShadowQuality(mapSize: number, radius: number): void;
  dispose(): void;
}

/**
 * Three-point lighting for the seat inspector, with the key casting onto the floor: a near-white key
 * (the upholstery reads true), a warm fill from the dark stage and a champagne rim, as in the room.
 */
export function createStudioLighting(): StudioLighting {
  const group = new Group();
  group.name = 'studio-lighting';
  const base = new HemisphereLight(0xcfc2b4, 0x1c1511, 1.3);
  const key = new DirectionalLight(0xfff1e2, 2.2);
  key.position.set(-2.5, 4, -2.8);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const camera = key.shadow.camera;
  camera.left = -2.4;
  camera.right = 2.4;
  camera.top = 2.4;
  camera.bottom = -2.4;
  camera.near = 0.5;
  camera.far = 12;
  camera.updateProjectionMatrix();
  const rim = new DirectionalLight(0xffd9a6, 1.1);
  rim.position.set(2.5, 2.5, 3);
  group.add(base, key, key.target, rim);
  return {
    group,
    key,
    setShadowQuality(mapSize, radius) {
      key.shadow.mapSize.set(mapSize, mapSize);
      key.shadow.radius = radius;
      key.shadow.map?.dispose();
      key.shadow.map = null;
    },
    dispose() {
      base.dispose();
      key.dispose();
      rim.dispose();
    },
  };
}

/**
 * Orients a strip-shaped area light: its width runs along `along`, and it emits towards `facing`
 * (which must be perpendicular to `along`).
 */
function orientStrip(light: RectAreaLight, along: Vector3, facing: Vector3): void {
  const x = along.clone().normalize();
  const z = facing.clone().normalize().negate(); // area lights emit along their local −Z
  const y = new Vector3().crossVectors(z, x).normalize();
  light.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Fits the directional shadow camera tightly around `box` as seen from the light. */
function fitShadowCamera(light: DirectionalLight, box: Box): void {
  const camera = light.shadow.camera;
  camera.position.copy(light.position);
  camera.lookAt(light.target.position);
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [box.x.min, box.x.max]) {
    for (const y of [box.y.min, box.y.max]) {
      for (const z of [box.z.min, box.z.max]) {
        const p = new Vector3(x, y, z).applyMatrix4(inverse);
        min.min(p);
        max.max(p);
      }
    }
  }
  const margin = 0.2;
  camera.left = min.x - margin;
  camera.right = max.x + margin;
  camera.bottom = min.y - margin;
  camera.top = max.y + margin;
  camera.near = Math.max(0.1, -max.z - margin);
  camera.far = -min.z + margin;
  camera.updateProjectionMatrix();
}
