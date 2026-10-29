/**
 * Times `work` as a User Timing measure named `cinema:<name>`, so the scene's start-up steps show
 * in the browser's performance panel and in `scripts/measure-perf.mjs`. Costs a clock read and one
 * entry, the latest per name (a remount replaces them); never throws because of the measuring.
 */
export function timed<T>(name: string, work: () => T): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    measure(name, start);
  }
}

/** Records `cinema:<name>` from `start` (a `performance.now()` reading) to now. */
export function measure(name: string, start: number): void {
  try {
    performance.clearMeasures(`cinema:${name}`);
    performance.measure(`cinema:${name}`, { start, end: performance.now() });
  } catch {
    // Old browsers without measure options: nothing to record.
  }
}
