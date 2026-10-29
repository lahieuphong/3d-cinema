/**
 * "Tự động": moves between drawing levels from how this session's frames actually go, never from
 * the user-agent or the GPU's name alone (those only choose where it starts).
 *
 * It only learns from frames drawn back to back (the camera moving, the tour, walking): a still
 * room draws nothing, and a film frame now and then says nothing about the frame rate. Loading,
 * a hidden tab, a resize and its own changes clear what it measured. It steps down when frames
 * stay slow (or the GPU stays busy) over a window, and up only after a much longer calm stretch,
 * one level at a time, with a cooldown after each change. A level it had to leave is not tried
 * again this session, so it settles instead of swinging. Nothing it concludes is stored.
 *
 * GPU time, when the browser can measure it (EXT_disjoint_timer_query_webgl2), decides both ways
 * and predicts whether the next level up fits. Without it only frame intervals are known: those
 * show overload, but not how much room is left, so a step up is a trial that is undone (and not
 * tried again) if frames then slow down. Frame time is never taken for GPU time.
 *
 * A step down has to pay for itself: if the next window is not clearly faster (GPU time, else the
 * frame interval), the step only made the room look worse, so the level before comes back at the
 * next rest and nothing lower is tried again this session (a GPU that is slow at every level
 * keeps the better looking one: a steady 30 fps beats a worse picture at the same 30 fps).
 */

export interface GovernorSettings {
  /** Frame time aimed for (ms): about 60 fps. */
  targetMs: number;
  /** Median interval above this over a window (ms) means overloaded (≈ 45 fps). */
  slowMs: number;
  /** GPU time above this (75th percentile, ms) means overloaded: about 60 fps no longer fits. */
  gpuBusyMs: number;
  /** The next level up must be predicted under this GPU time (90th percentile × its cost, ms). */
  gpuFitMs: number;
  /** Back-to-back frames needed before stepping down. */
  downFrames: number;
  /** Back-to-back frames needed (since the last change) before stepping up. */
  upFrames: number;
  /** Nothing changes for this long after a change (ms). */
  cooldownMs: number;
  /** Intervals longer than this (ms) are pauses, not frames. */
  maxIntervalMs: number;
  /** A step down must be predicted, then measured, to cut the GPU time (else the frame interval) by this fraction. */
  minGain: number;
}

export const GOVERNOR_DEFAULTS: GovernorSettings = {
  targetMs: 1000 / 60,
  slowMs: 22,
  gpuBusyMs: 16,
  gpuFitMs: 11,
  downFrames: 90,
  upFrames: 300,
  cooldownMs: 2500,
  maxIntervalMs: 250,
  minGain: 0.12,
};

export interface GovernorDecision {
  /** Index into the levels (0 = the best looking). */
  level: number;
  reason: string;
}

/**
 * Levels are a ladder from the best looking (index 0) to the cheapest (`count - 1`); `cost(level)`
 * is a level's GPU cost relative to the others (what it draws: pixels, detail), used to predict
 * whether the next level up fits. `start` is where this session begins.
 */
export class QualityGovernor {
  private readonly settings: GovernorSettings;
  private readonly cost: (level: number) => number;
  private current: number;
  private readonly intervals: number[] = [];
  private readonly gpu: number[] = [];
  /** Frames counted since the last change (for the long calm stretch a step up needs). */
  private calm = 0;
  private cooldownUntil = 0;
  /** Levels left because they were too heavy: never tried again this session. */
  private readonly failed = new Set<number>();
  /** Nothing below this is tried (a step down that did not help sets it). */
  private floor: number;
  /** The last step down, until the next window shows whether it helped. */
  private probation: { from: number; gpu: number | null; interval: number } | null = null;
  /** A step down that did not help: the level to go back to at the next rest. */
  private revertTo: number | null = null;

  constructor(count: number, start: number, cost: (level: number) => number, settings: GovernorSettings = GOVERNOR_DEFAULTS) {
    this.cost = cost;
    this.current = Math.max(0, Math.min(count - 1, start));
    this.floor = count - 1;
    this.settings = settings;
  }

  get level(): number {
    return this.current;
  }

  /** A frame drawn right after the previous one: the interval since it and, if known, its GPU time. */
  frame(intervalMs: number, gpuMs: number | null): void {
    if (!(intervalMs > 0) || intervalMs > this.settings.maxIntervalMs) return;
    push(this.intervals, intervalMs, 240);
    if (gpuMs !== null && gpuMs >= 0) push(this.gpu, gpuMs, 240);
    this.calm++;
  }

  /** A GPU time that arrived late (timer results come back a few frames after the frame). */
  gpuTime(gpuMs: number): void {
    if (gpuMs >= 0) push(this.gpu, gpuMs, 240);
  }

  /** Forget what was measured (loading, tab hidden, resized, a change made elsewhere). */
  reset(now: number, cooldown = true): void {
    this.intervals.length = 0;
    this.gpu.length = 0;
    this.calm = 0;
    if (cooldown) this.cooldownUntil = Math.max(this.cooldownUntil, now + this.settings.cooldownMs);
  }

  /**
   * The level to move to now, or null. `atRest` (nothing moving, no input) allows a step up: a
   * better level is never switched in under the user's hands. A step down may come at any time.
   */
  decide(now: number, atRest: boolean): GovernorDecision | null {
    const s = this.settings;
    // A step down that did not help is undone at the next rest, cooldown or not.
    if (this.revertTo !== null) {
      if (!atRest) return null;
      const level = this.revertTo;
      this.revertTo = null;
      return this.change(level, now, 'the step down did not help');
    }
    if (now < this.cooldownUntil) return null;
    const recentIntervals = this.intervals.slice(-s.downFrames);
    const recentGpu = this.gpu.slice(-s.downFrames);
    const enough = recentIntervals.length >= s.downFrames;
    const gpuKnown = recentGpu.length >= s.downFrames / 2;
    const intervalP50 = enough ? quantile(recentIntervals, 0.5) : 0;
    const gpuP50 = gpuKnown ? quantile(recentGpu, 0.5) : null;
    // The window after a step down: did it pay for itself? Nothing else is decided until it is known.
    if (this.probation) {
      const { from, gpu, interval } = this.probation;
      const byGpu = gpu !== null && gpuP50 !== null;
      if (!byGpu && !enough) return null;
      this.probation = null;
      const gained = byGpu ? 1 - gpuP50 / gpu : 1 - intervalP50 / interval;
      if (gained < s.minGain) {
        this.floor = from;
        this.failed.delete(from);
        this.revertTo = from;
        this.reset(now);
        return null;
      }
    }
    const slow = enough && intervalP50 > s.slowMs;
    const busy = gpuKnown && quantile(recentGpu, 0.75) > s.gpuBusyMs;
    if (slow || busy) {
      // Down to the next level that is clearly cheaper here: on a 1× screen, levels that differ only
      // in pixel density above 1 draw the same thing, and the rest saves little on a GPU that is
      // slow per pixel. If none is, the room keeps its look (and its frame rate).
      const enoughCheaper = (level: number) => this.cost(level) <= this.cost(this.current) * (1 - s.minGain);
      let target = this.current + 1;
      while (target < this.floor && !enoughCheaper(target)) target++;
      if (target > this.floor || !enoughCheaper(target)) return null;
      const from = this.current;
      for (let level = from; level < target; level++) this.failed.add(level);
      const decision = this.change(target, now, slow ? 'frames slow' : 'GPU busy');
      this.probation = { from, gpu: gpuP50, interval: intervalP50 };
      return decision;
    }
    if (!atRest || this.current === 0 || this.calm < s.upFrames) return null;
    const next = this.current - 1;
    if (this.failed.has(next)) return null;
    const intervals = this.intervals;
    const smooth = quantile(intervals, 0.95) <= s.targetMs * 1.2;
    if (!smooth) return null;
    if (this.gpu.length >= s.upFrames / 2) {
      const predicted = quantile(this.gpu, 0.9) * (this.cost(next) / this.cost(this.current));
      if (predicted > s.gpuFitMs) return null;
      return this.change(next, now, `GPU room (${predicted.toFixed(1)} ms predicted)`);
    }
    // No GPU timing: a trial; if frames then slow down it steps back, and that level is not tried again.
    return this.change(next, now, 'frames smooth (trial)');
  }

  private change(level: number, now: number, reason: string): GovernorDecision {
    this.current = level;
    this.reset(now);
    return { level, reason };
  }
}

function push(list: number[], value: number, max: number): void {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

/** The q-quantile (0–1) of `values` (nearest rank). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
