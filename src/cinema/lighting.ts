import { DirectionalLight, Group, HemisphereLight } from 'three';
import type { AuditoriumLayout } from './layout.ts';

export interface Lighting {
  group: Group;
  dispose(): void;
}

/**
 * Neutral inspection lighting, no shadows. Two directional lights come from opposite corners so
 * every face orientation gets a different tone: treads vs risers, and each wall vs its neighbours.
 * A weak upward light stands in for floor bounce so the ceiling reads as a surface, not a void.
 */
export function createLighting(layout: AuditoriumLayout): Lighting {
  const { interior } = layout;
  const group = new Group();
  group.name = 'lighting';

  const ambient = new HemisphereLight(0xe4e9f2, 0x9c958a, 2);

  // From high above the screen end: lights treads, risers (facing -Z), the left wall and the back wall.
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(interior.x.max * 0.5, interior.y.max * 2, interior.z.min * 0.8);

  // From the back-left corner: lights the right wall, the front wall and seat backs.
  const fill = new DirectionalLight(0xdfe4ff, 0.9);
  fill.position.set(interior.x.min, interior.y.max, interior.z.max);

  const bounce = new DirectionalLight(0xfff4e6, 0.8);
  bounce.position.set(0, -1, interior.z.max * 0.1);

  group.add(ambient, key, fill, bounce);

  return {
    group,
    dispose() {
      ambient.dispose();
      key.dispose();
      fill.dispose();
      bounce.dispose();
    },
  };
}
