import { type Light, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditoriumLayout } from './layout.ts';
import { createRoomLighting } from './lighting.ts';
import { createCarpetTexture } from './materials.ts';
import { defaultQuality, isQualityLevel, loadQuality, QUALITY_LEVELS, saveQuality } from './quality.ts';

const layout = createAuditoriumLayout();
const { config, structure } = layout;

describe('quality levels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts only the two known levels', () => {
    expect(QUALITY_LEVELS.every(isQualityLevel)).toBe(true);
    for (const value of ['ultra', '', 'HIGH', null, undefined, 1]) expect(isQualityLevel(value)).toBe(false);
  });

  it('defaults conservatively from capability hints, not the user agent', () => {
    expect(defaultQuality({ coarsePointer: false, logicalCores: 16, deviceMemoryGiB: 8 })).toBe('high');
    expect(defaultQuality({ coarsePointer: false })).toBe('high');
    expect(defaultQuality({ coarsePointer: true, logicalCores: 16, deviceMemoryGiB: 8 })).toBe('economy');
    expect(defaultQuality({ coarsePointer: false, logicalCores: 4 })).toBe('economy');
    expect(defaultQuality({ coarsePointer: false, logicalCores: 8, deviceMemoryGiB: 4 })).toBe('economy');
  });

  function stubBrowser(storage: Pick<Storage, 'getItem' | 'setItem'>, coarse = false) {
    vi.stubGlobal('window', { localStorage: storage, matchMedia: () => ({ matches: coarse }) });
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  }

  it('keeps a valid stored choice, ignores an invalid one, and survives blocked storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    stubBrowser(storage, true);
    expect(loadQuality()).toEqual({ level: 'economy', source: 'device' });
    saveQuality('high');
    expect(loadQuality()).toEqual({ level: 'high', source: 'stored' });
    values.set([...values.keys()][0], 'ultra');
    expect(loadQuality()).toEqual({ level: 'economy', source: 'device' });

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    stubBrowser(blocked);
    expect(loadQuality()).toEqual({ level: 'high', source: 'device' });
    expect(() => saveQuality('economy')).not.toThrow();
  });

  it('makes economy cheaper on every setting', () => {
    const { high, economy } = config.quality;
    expect(economy.maxPixelRatio).toBeLessThan(high.maxPixelRatio);
    expect(economy.shadowMapSize).toBeLessThan(high.shadowMapSize);
    for (const size of [high.shadowMapSize, economy.shadowMapSize]) expect(Math.log2(size) % 1).toBe(0);
    for (const key of Object.keys(high.seat) as Array<keyof typeof high.seat>) {
      expect(economy.seat[key], key).toBeLessThanOrEqual(high.seat[key]);
      expect(economy.seat[key], key).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('room lighting', () => {
  const lighting = createRoomLighting(layout);
  afterAll(() => lighting.dispose());
  const lights: Light[] = [];
  lighting.group.traverse((object) => {
    if ((object as Light).isLight) lights.push(object as Light);
  });
  const on = () =>
    Object.entries(lighting.describe())
      .filter(([, state]) => state.on)
      .map(([name]) => name)
      .sort();
  const all = Object.keys(lighting.describe()).sort();

  it('has exactly one shadow-casting light: the key', () => {
    expect(lights.filter((light) => light.castShadow)).toEqual([lighting.key]);
    expect(on()).toEqual(all);
  });

  it('fits the shadow camera tightly around the room', () => {
    lighting.group.updateMatrixWorld(true);
    const camera = lighting.key.shadow.camera;
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse;
    let corners = 0;
    for (const x of [structure.x.min, structure.x.max]) {
      for (const y of [structure.y.min, structure.y.max]) {
        for (const z of [structure.z.min, structure.z.max]) {
          const p = new Vector3(x, y, z).applyMatrix4(view);
          expect(p.x).toBeGreaterThanOrEqual(camera.left);
          expect(p.x).toBeLessThanOrEqual(camera.right);
          expect(p.y).toBeGreaterThanOrEqual(camera.bottom);
          expect(p.y).toBeLessThanOrEqual(camera.top);
          expect(-p.z).toBeGreaterThanOrEqual(camera.near);
          expect(-p.z).toBeLessThanOrEqual(camera.far);
          corners++;
        }
      }
    }
    expect(corners).toBe(8);
    // Not much larger than the room's diagonal in any direction.
    const diagonal = new Vector3(structure.x.max - structure.x.min, structure.y.max - structure.y.min, structure.z.max - structure.z.min).length();
    expect(camera.right - camera.left).toBeLessThan(diagonal + 1);
    expect(camera.top - camera.bottom).toBeLessThan(diagonal + 1);
    expect(camera.far - camera.near).toBeLessThan(diagonal + 1);
  });

  it('switches lights off with the part they are fixed to, and keeps an inspection light', () => {
    const keyColour = lighting.key.color.getHex();
    lighting.setPartVisible('ceiling', false);
    expect(on()).toEqual(['aisle-guide-left', 'aisle-guide-right', 'base', 'inspection-light', 'screen']);
    expect(lighting.key.visible && lighting.key.castShadow).toBe(true);
    expect(lighting.key.color.getHex()).not.toBe(keyColour);

    lighting.setPartVisible('rightWall', false);
    expect(on()).not.toContain('aisle-guide-right');
    expect(on()).toContain('aisle-guide-left');

    // Hiding the back wall changes no light; restoring everything brings every light back.
    lighting.setPartVisible('backWall', false);
    lighting.setPartVisible('ceiling', true);
    lighting.setPartVisible('rightWall', true);
    lighting.setPartVisible('backWall', true);
    expect(on()).toEqual(all);
    expect(lighting.key.color.getHex()).toBe(keyColour);
  });

  it('reallocates the shadow map at the new quality', () => {
    lighting.setShadowQuality(config.quality.economy.shadowMapSize, config.quality.economy.shadowRadius);
    expect(lighting.key.shadow.mapSize.x).toBe(config.quality.economy.shadowMapSize);
    expect(lighting.key.shadow.radius).toBe(config.quality.economy.shadowRadius);
    expect(lighting.key.shadow.map).toBeNull();
  });
});

describe('carpet texture', () => {
  it('is seeded, tiling colour data in a narrow near-white band', () => {
    const a = createCarpetTexture();
    const b = createCarpetTexture();
    const c = createCarpetTexture(7);
    try {
      expect(a.image.width).toBe(128);
      expect(a.colorSpace).toBe(SRGBColorSpace);
      expect([a.wrapS, a.wrapT]).toEqual([RepeatWrapping, RepeatWrapping]);
      const data = a.image.data as Uint8Array;
      expect(data).toEqual(b.image.data);
      expect(data).not.toEqual(c.image.data);
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBeGreaterThanOrEqual(228);
        expect(data[i + 3]).toBe(255);
      }
    } finally {
      for (const texture of [a, b, c]) texture.dispose();
    }
  });
});
