/**
 * What is drawn: a ladder from the best looking to the cheapest (config.quality holds what each
 * step sets). "Ưu tiên đẹp" and "Tiết kiệm" pin a step; "Tự động" moves along the ladder from what
 * it measures in this session (qualityGovernor.ts).
 */
export type QualityLevel = 'high' | 'balanced' | 'economy' | 'minimal';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['high', 'balanced', 'economy', 'minimal'];

/** How a step is named where the page says which one "Tự động" is on. */
export const QUALITY_LEVEL_LABELS: Record<QualityLevel, string> = { high: 'đẹp nhất', balanced: 'cân bằng', economy: 'tiết kiệm', minimal: 'tối giản' };

/** The user's choice in Cài đặt › Hiển thị; the only thing stored. */
export type QualityChoice = 'auto' | 'high' | 'economy';

export const QUALITY_CHOICES: readonly QualityChoice[] = ['auto', 'high', 'economy'];

export const QUALITY_LABELS: Record<QualityChoice, string> = { auto: 'Tự động', high: 'Ưu tiên đẹp', economy: 'Tiết kiệm' };

const STORAGE_KEY = 'cinema3d.quality';

export function isQualityChoice(value: unknown): value is QualityChoice {
  return value === 'auto' || value === 'high' || value === 'economy';
}

/** The step a pinned choice draws at; "Tự động" has none of its own. */
export function pinnedLevel(choice: QualityChoice): QualityLevel | null {
  return choice === 'auto' ? null : choice;
}

/** Capability hints the browser exposes; none of them come from the user-agent string. */
export interface DeviceHints {
  /** Primary input is touch (`(pointer: coarse)`). */
  coarsePointer: boolean;
  logicalCores?: number;
  /** `navigator.deviceMemory` (GiB, rounded by the browser; Chromium only). */
  deviceMemoryGiB?: number;
}

/**
 * What draws the room, from the renderer's name: a GPU of its own (discrete), one shared with the
 * processor (integrated: a real GPU too, just a smaller one), a software rasteriser on the CPU, or
 * unknown (the browser hides the name).
 */
export type GpuClass = 'discrete' | 'integrated' | 'software' | 'unknown';

export function classifyGpu(renderer: string | null | undefined): GpuClass {
  if (!renderer) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(renderer)) return 'software';
  if (/arc\(tm\) a\d|arc a\d/i.test(renderer)) return 'discrete';
  if (/intel|apple|adreno|mali|powervr|videocore|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|qualcomm|immortalis/i.test(renderer)) return 'integrated';
  if (/nvidia|geforce|quadro|rtx|radeon|amd/i.test(renderer)) return 'discrete';
  return 'unknown';
}

/**
 * Where "Tự động" starts, moderate so the room comes up quickly; it moves from there on what it
 * measures. Software rendering starts at the cheapest step; touch-first devices and ones that
 * report at most 4 cores or 4 GiB at "tiết kiệm"; everything else at "cân bằng".
 */
export function autoStartLevel(hints: DeviceHints, gpu: GpuClass): QualityLevel {
  if (gpu === 'software') return 'minimal';
  if (hints.coarsePointer) return 'economy';
  if (hints.logicalCores !== undefined && hints.logicalCores <= 4) return 'economy';
  if (hints.deviceMemoryGiB !== undefined && hints.deviceMemoryGiB <= 4) return 'economy';
  return 'balanced';
}

export function readDeviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    logicalCores: nav.hardwareConcurrency || undefined,
    deviceMemoryGiB: nav.deviceMemory,
  };
}

/** The stored choice if it is valid ("Cao" from earlier visits is "Ưu tiên đẹp"), else "Tự động". Storage may be unavailable. */
export function loadQuality(): { choice: QualityChoice; source: 'stored' | 'default' } {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isQualityChoice(stored)) return { choice: stored, source: 'stored' };
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return { choice: 'auto', source: 'default' };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function saveQuality(choice: QualityChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisted; the choice still applies to this visit.
  }
}
