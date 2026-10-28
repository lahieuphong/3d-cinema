export type QualityLevel = 'high' | 'economy';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['high', 'economy'];

export const QUALITY_LABELS: Record<QualityLevel, string> = { high: 'Cao', economy: 'Tiết kiệm' };

const STORAGE_KEY = 'cinema3d.quality';

export function isQualityLevel(value: unknown): value is QualityLevel {
  return value === 'high' || value === 'economy';
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
 * Conservative default: Economy for touch-first devices or ones that report at most 4 cores or
 * 4 GiB of memory; High otherwise. The user's own choice, once made, always wins.
 */
export function defaultQuality(hints: DeviceHints): QualityLevel {
  if (hints.coarsePointer) return 'economy';
  if (hints.logicalCores !== undefined && hints.logicalCores <= 4) return 'economy';
  if (hints.deviceMemoryGiB !== undefined && hints.deviceMemoryGiB <= 4) return 'economy';
  return 'high';
}

export function readDeviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    logicalCores: nav.hardwareConcurrency || undefined,
    deviceMemoryGiB: nav.deviceMemory,
  };
}

/** The stored choice if it is valid, otherwise the device default. Storage may be unavailable. */
export function loadQuality(): { level: QualityLevel; source: 'stored' | 'device' } {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isQualityLevel(stored)) return { level: stored, source: 'stored' };
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return { level: defaultQuality(readDeviceHints()), source: 'device' };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function saveQuality(level: QualityLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Not persisted; the choice still applies to this visit.
  }
}
