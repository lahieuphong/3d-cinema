import { type PerspectiveCamera, type Scene, Vector3, type WebGLRenderer } from 'three';
import type { Vec3 } from './layout.ts';

export interface TimingStats {
  median: number;
  p95: number;
  mean: number;
  max: number;
}

export interface FrameTiming {
  frames: number;
  /** JavaScript time spent in renderer.render() per frame: scene traversal and WebGL command submission. */
  cpuSubmitMs: TimingStats;
  /** GPU execution time per frame from timer queries, when the browser exposes them. */
  gpuMs: TimingStats | null;
  gpuTimer: 'EXT_disjoint_timer_query_webgl2' | 'unavailable';
  /** True if the GPU reported a disjoint event (results may be unreliable). */
  disjoint: boolean;
}

/**
 * Development: renders `frames` frames synchronously while moving the camera along `keyframes`
 * (linear in position and look-at), timing each frame on the CPU and, if available, on the GPU.
 * The caller restores its own camera afterwards. Results only compare runs on the same machine,
 * viewport and pixel ratio; they say nothing about other GPUs.
 */
export async function measureCameraPath(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  keyframes: ReadonlyArray<{ position: Vec3; lookAt: Vec3 }>,
  frames: number,
): Promise<FrameTiming> {
  const from = new Vector3();
  const to = new Vector3();
  const target = new Vector3();
  return measurePlacedFrames(renderer, scene, camera, frames, (i) => {
    const s = (i / Math.max(1, frames - 1)) * (keyframes.length - 1);
    const k = Math.min(Math.floor(s), keyframes.length - 2);
    const t = s - k;
    camera.position.lerpVectors(from.copy(keyframes[k].position), to.copy(keyframes[k + 1].position), t);
    target.lerpVectors(from.copy(keyframes[k].lookAt), to.copy(keyframes[k + 1].lookAt), t);
    camera.lookAt(target);
  });
}

/** Like measureCameraPath, with `place(i)` putting the camera for frame i (e.g. along the tour). */
export async function measurePlacedFrames(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  frames: number,
  place: (frame: number) => void,
): Promise<FrameTiming> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const cpu: number[] = [];
  const queries: WebGLQuery[] = [];

  for (let i = 0; i < frames; i++) {
    place(i);
    const query = timer ? gl.createQuery() : null;
    if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const start = performance.now();
    renderer.render(scene, camera);
    cpu.push(performance.now() - start);
    if (timer && query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      queries.push(query);
    }
  }

  let gpu: number[] | null = null;
  let disjoint = false;
  if (timer) {
    gpu = [];
    for (const query of queries) {
      for (let tries = 0; !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && tries < 120; tries++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      disjoint ||= Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT));
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
  }

  return {
    frames,
    cpuSubmitMs: stats(cpu),
    gpuMs: gpu && gpu.length > 0 ? stats(gpu) : null,
    gpuTimer: timer ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable',
    disjoint,
  };
}

function stats(values: number[]): TimingStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    median: round(at(0.5)),
    p95: round(at(0.95)),
    mean: round(values.reduce((sum, v) => sum + v, 0) / values.length),
    max: round(sorted[sorted.length - 1]),
  };
}
