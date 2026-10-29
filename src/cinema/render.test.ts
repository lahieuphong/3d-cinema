import { type Light, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditoriumLayout } from './layout.ts';
import { createRoomLighting } from './lighting.ts';
import { createCarpetTexture } from './materials.ts';
import { autoStartLevel, classifyGpu, isQualityChoice, loadQuality, pinnedLevel, QUALITY_CHOICES, QUALITY_LEVELS, saveQuality } from './quality.ts';

const layout = createAuditoriumLayout();
const { config, structure } = layout;

describe('quality', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers three choices: Tự động, Ưu tiên đẹp, Tiết kiệm', () => {
    expect(QUALITY_CHOICES).toEqual(['auto', 'high', 'economy']);
    expect(QUALITY_CHOICES.every(isQualityChoice)).toBe(true);
    for (const value of ['ultra', '', 'HIGH', 'balanced', 'minimal', null, undefined, 1]) expect(isQualityChoice(value)).toBe(false);
    expect([pinnedLevel('auto'), pinnedLevel('high'), pinnedLevel('economy')]).toEqual([null, 'high', 'economy']);
  });

  it('starts "Tự động" moderately, from capability hints and the kind of GPU, not the user agent', () => {
    expect(autoStartLevel({ coarsePointer: false, logicalCores: 16, deviceMemoryGiB: 8 }, 'discrete')).toBe('balanced');
    expect(autoStartLevel({ coarsePointer: false }, 'integrated')).toBe('balanced');
    expect(autoStartLevel({ coarsePointer: false }, 'unknown')).toBe('balanced');
    expect(autoStartLevel({ coarsePointer: true, logicalCores: 16, deviceMemoryGiB: 8 }, 'integrated')).toBe('economy');
    expect(autoStartLevel({ coarsePointer: false, logicalCores: 4 }, 'discrete')).toBe('economy');
    expect(autoStartLevel({ coarsePointer: false, logicalCores: 8, deviceMemoryGiB: 4 }, 'discrete')).toBe('economy');
    expect(autoStartLevel({ coarsePointer: false, logicalCores: 16 }, 'software')).toBe('minimal');
  });

  it('tells a discrete GPU, an integrated one (still a GPU) and software rendering apart', () => {
    const cases: Array<[string | null, string]> = [
      ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
      ['ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
      ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
      ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
      ['ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
      ['Apple GPU', 'integrated'],
      ['Adreno (TM) 740', 'integrated'],
      ['Mali-G78 MC14', 'integrated'],
      ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
      ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
      ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software'],
      ['WebKit WebGL', 'unknown'],
      [null, 'unknown'],
    ];
    for (const [name, expected] of cases) expect(classifyGpu(name), String(name)).toBe(expected);
  });

  function stubBrowser(storage: Pick<Storage, 'getItem' | 'setItem'>, coarse = false) {
    vi.stubGlobal('window', { localStorage: storage, matchMedia: () => ({ matches: coarse }) });
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  }

  it('stores only the choice: keeps a valid one ("Cao" from before is "Ưu tiên đẹp"), ignores an invalid one, survives blocked storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    stubBrowser(storage, true);
    expect(loadQuality()).toEqual({ choice: 'auto', source: 'default' });
    saveQuality('high');
    expect(loadQuality()).toEqual({ choice: 'high', source: 'stored' });
    saveQuality('auto');
    expect(loadQuality()).toEqual({ choice: 'auto', source: 'stored' });
    // A level "Tự động" was on is never what gets stored, and a stray one is ignored.
    values.set([...values.keys()][0], 'balanced');
    expect(loadQuality()).toEqual({ choice: 'auto', source: 'default' });
    values.set([...values.keys()][0], 'ultra');
    expect(loadQuality()).toEqual({ choice: 'auto', source: 'default' });

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    stubBrowser(blocked);
    expect(loadQuality()).toEqual({ choice: 'auto', source: 'default' });
    expect(() => saveQuality('economy')).not.toThrow();
  });

  it('makes each level down no dearer than the one above on every setting, and cheaper on one', () => {
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const above = config.quality[QUALITY_LEVELS[i - 1]];
      const level = config.quality[QUALITY_LEVELS[i]];
      const name = QUALITY_LEVELS[i];
      expect(level.maxPixelRatio, name).toBeLessThanOrEqual(above.maxPixelRatio);
      expect(level.maxPixelRatio, name).toBeGreaterThanOrEqual(1);
      expect(level.shadowMapSize, name).toBeLessThanOrEqual(above.shadowMapSize);
      expect(Math.log2(level.shadowMapSize) % 1, name).toBe(0);
      let cheaper = level.maxPixelRatio < above.maxPixelRatio || level.shadowMapSize < above.shadowMapSize;
      for (const key of Object.keys(above.seat) as Array<keyof typeof above.seat>) {
        expect(level.seat[key], `${name} ${key}`).toBeLessThanOrEqual(above.seat[key]);
        expect(level.seat[key], `${name} ${key}`).toBeGreaterThanOrEqual(1);
        cheaper ||= level.seat[key] < above.seat[key];
      }
      expect(cheaper, name).toBe(true);
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
