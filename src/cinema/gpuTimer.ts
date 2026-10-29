interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * The GPU time of each drawn frame, where the browser can measure it (EXT_disjoint_timer_query_webgl2:
 * Chrome and Edge on most GPUs; not Safari or Firefox). A query brackets the frame's draws; its
 * result comes back a few frames later and is only ever polled, never waited for. A disjoint
 * operation (e.g. the GPU changed clocks or was switched) throws the pending results away.
 */
export class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: TimerQueryExtension | null;
  private active: { query: WebGLQuery; tag: boolean } | null = null;
  private readonly pending: Array<{ query: WebGLQuery; tag: boolean }> = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  /** Starts timing a frame; `tag` comes back with its result. At most a few frames are in flight. */
  begin(tag: boolean): void {
    if (!this.ext || this.active || this.pending.length >= 6) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, tag };
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Hands over the results that have come back, oldest first: milliseconds and the frame's tag. */
  collect(onResult: (ms: number, tag: boolean) => void): void {
    if (!this.ext || this.pending.length === 0) return;
    const { gl } = this;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const { query, tag } = this.pending[0];
      if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) onResult((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6, tag);
      gl.deleteQuery(query);
    }
  }

  /** The context was lost: its queries are gone with it. */
  lost(): void {
    this.active = null;
    this.pending.length = 0;
  }

  /** The context is back: extensions have to be asked for again. */
  restored(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.lost();
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  }

  dispose(): void {
    if (!this.gl.isContextLost()) for (const { query } of this.pending) this.gl.deleteQuery(query);
    this.lost();
  }
}
