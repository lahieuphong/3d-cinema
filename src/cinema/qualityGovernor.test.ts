import { describe, expect, it } from 'vitest';
import { GOVERNOR_DEFAULTS, quantile, QualityGovernor } from './qualityGovernor.ts';

// Four levels: 0 (best) … 3 (cheapest); each costs about 60 % of the one above.
const cost = (level: number) => 0.6 ** level;
const frames = (g: QualityGovernor, n: number, interval: number, gpu: number | null = null) => {
  for (let i = 0; i < n; i++) g.frame(interval, gpu);
};

describe('quality governor ("Tự động")', () => {
  it('steps down after a sustained slow stretch, not after a few slow frames', () => {
    const g = new QualityGovernor(4, 1, cost);
    frames(g, 30, 40);
    expect(g.decide(10_000, false)).toBeNull();
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(g.decide(10_000, false)).toMatchObject({ level: 2 });
    expect(g.level).toBe(2);
  });

  it('steps down when the GPU stays over a 60 fps budget, but not when it only has less room', () => {
    const g = new QualityGovernor(4, 0, cost);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 16.7, 18);
    expect(g.decide(10_000, false)).toMatchObject({ level: 1, reason: 'GPU busy' });
    // 13 ms still makes 60 fps: nothing to give up.
    const fits = new QualityGovernor(4, 0, cost);
    frames(fits, GOVERNOR_DEFAULTS.downFrames, 16.7, 13);
    expect(fits.decide(10_000, false)).toBeNull();
  });

  it('judges a step down before taking another one', () => {
    const g = new QualityGovernor(4, 0, cost);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(g.decide(10_000, false)?.level).toBe(1);
    // Not enough frames yet to judge it (no GPU timing): no further step, however slow.
    frames(g, GOVERNOR_DEFAULTS.downFrames - 1, 60);
    expect(g.decide(20_000, false)).toBeNull();
    expect(g.level).toBe(1);
  });

  it('waits out the cooldown after a change, and keeps stepping down while each step helps', () => {
    const g = new QualityGovernor(4, 0, cost);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(g.decide(10_000, false)?.level).toBe(1);
    // Faster (30 ms) but still slow: nothing until the cooldown is over and a new window is in.
    frames(g, GOVERNOR_DEFAULTS.downFrames, 30);
    expect(g.decide(10_000 + GOVERNOR_DEFAULTS.cooldownMs - 1, false)).toBeNull();
    expect(g.decide(10_000 + GOVERNOR_DEFAULTS.cooldownMs, false)?.level).toBe(2);
  });

  it('undoes a step down that did not help, at the next rest, and tries nothing lower (no worse picture for nothing)', () => {
    const g = new QualityGovernor(4, 0, cost);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40, 30);
    expect(g.decide(10_000, false)?.level).toBe(1);
    // As slow at the cheaper level: the GPU is busy whatever this level saves.
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40, 29);
    expect(g.decide(20_000, false)).toBeNull();
    expect(g.decide(20_000, false)).toBeNull();
    expect(g.decide(20_000, true)).toMatchObject({ level: 0, reason: 'the step down did not help' });
    frames(g, GOVERNOR_DEFAULTS.downFrames * 2, 40, 30);
    expect(g.decide(40_000, false)).toBeNull();
    expect(g.level).toBe(0);
  });

  it('holds at the cheapest level when nothing is left to reduce', () => {
    const g = new QualityGovernor(4, 3, cost);
    frames(g, 200, 40);
    expect(g.decide(10_000, false)).toBeNull();
    expect(g.level).toBe(3);
  });

  it('steps up only at rest, after a long calm stretch, when the GPU predicts room', () => {
    const g = new QualityGovernor(4, 2, cost);
    frames(g, GOVERNOR_DEFAULTS.upFrames - 1, 16.7, 4);
    expect(g.decide(10_000, true)).toBeNull();
    g.frame(16.7, 4);
    expect(g.decide(10_000, false)).toBeNull();
    // 4 ms now → 4 / 0.6 ≈ 6.7 ms one level up: it fits.
    expect(g.decide(10_000, true)).toMatchObject({ level: 1 });
  });

  it('does not step up when the next level would not fit the GPU budget', () => {
    const g = new QualityGovernor(4, 2, cost);
    frames(g, GOVERNOR_DEFAULTS.upFrames, 16.7, 9);
    // 9 / 0.6 = 15 ms predicted > the 11 ms allowed.
    expect(g.decide(10_000, true)).toBeNull();
  });

  it('never retries a level it had to leave (no swinging back and forth)', () => {
    const g = new QualityGovernor(4, 1, cost);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(g.decide(10_000, false)?.level).toBe(2);
    frames(g, GOVERNOR_DEFAULTS.upFrames, 16.7, 2);
    expect(g.decide(20_000, true)).toBeNull();
    expect(g.level).toBe(2);
  });

  it('without GPU timing a step up is a trial, undone for good if frames then slow down', () => {
    const g = new QualityGovernor(4, 2, cost);
    frames(g, GOVERNOR_DEFAULTS.upFrames, 16.7);
    expect(g.decide(10_000, true)).toMatchObject({ level: 1, reason: 'frames smooth (trial)' });
    frames(g, GOVERNOR_DEFAULTS.downFrames, 35);
    expect(g.decide(20_000, false)?.level).toBe(2);
    frames(g, GOVERNOR_DEFAULTS.upFrames, 16.7);
    expect(g.decide(30_000, true)).toBeNull();
  });

  it('steps past levels that cost the same here (no wasted step) and holds when none is cheaper', () => {
    // Levels 0 and 1 draw the same on this screen; 2 is cheaper.
    const flat = (level: number) => (level <= 1 ? 1 : 0.5);
    const g = new QualityGovernor(3, 0, flat);
    frames(g, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(g.decide(10_000, false)?.level).toBe(2);
    const same = new QualityGovernor(2, 0, () => 1);
    frames(same, GOVERNOR_DEFAULTS.downFrames, 40);
    expect(same.decide(10_000, false)).toBeNull();
  });

  it('ignores pauses and clears its measurements on reset', () => {
    const g = new QualityGovernor(4, 0, cost);
    frames(g, 200, 400);
    expect(g.decide(10_000, false)).toBeNull();
    frames(g, GOVERNOR_DEFAULTS.downFrames - 10, 40);
    g.reset(10_000, false);
    frames(g, 10, 40);
    expect(g.decide(10_000, false)).toBeNull();
  });

  it('quantile picks by nearest rank', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(quantile([], 0.5)).toBe(0);
  });
});
