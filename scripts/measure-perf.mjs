// Loading, frame cost and stability of the auditorium on a production build, before/after
// comparable. Serves a dist/ folder the way vercel.json does (HTML no-cache, /assets immutable,
// gzip/brotli, byte ranges for the films), and drives a locally installed Chrome (playwright-core,
// no browser download) on each GPU this machine offers:
//   rtx  — the discrete GPU (ANGLE D3D11, the default adapter),
//   uhd  — the integrated GPU (ANGLE D3D11, --force_low_power_gpu),
//   sw   — software rendering (SwiftShader),
// plus a browser without WebGL. Headless Chrome on a desktop: phone and tablet sizes are emulated
// viewports on this machine's GPU and CPU (optionally CPU-throttled), never a phone's own numbers.
//
// What the page is measured with is injected before it runs (no hook in the app, so any build can
// be measured the same way): draw calls and triangles per WebGL draw, an estimate of texture and
// renderbuffer memory from the sizes given to WebGL, the CPU time of each animation-frame callback
// that draws, the GPU time of the same callback (EXT_disjoint_timer_query_webgl2, when the GPU
// offers it; frame time is never reported as GPU time), frame intervals, long tasks, layout shifts,
// paints, event timing for inputs, and the page's own status changes.
//
// Sections (PERF_ONLY=load,runtime,interact,lifecycle,fallback,shots; all by default):
//   load      — /cinema cold and warm, fast and throttled (network + 4× CPU), desktop and phone:
//               first paint, the page usable, the first 3D frame (status "ready"), bytes by type,
//               long tasks, layout shift.
//   runtime   — per GPU × viewport × quality: still, tour, orbit drag, walking, film playing.
//   interact  — event timing of task switches, seat picks on the map and in the room, tour start,
//               play and seek.
//   lifecycle — /cinema ↔ / eight times: heap after GC, DOM nodes, listeners, live contexts,
//               texture memory.
//   fallback  — no WebGL; a lost context that comes back; one that does not ("Dựng lại cảnh 3D").
//   shots     — the same camera views for side-by-side comparison (overview, seats, the screen
//               from F06, the glass panes over the room), still and during a move.
//
//   yarn build && node scripts/measure-perf.mjs
//   PERF_DIST=<dir> PERF_OUT=<name> PERF_RUNS=3 PERF_GPUS=rtx,uhd,sw PERF_QUALITY=high,economy node scripts/measure-perf.mjs
//
// Writes artifacts/<PERF_OUT or perf>/perf.json (+ screenshots) and prints a summary.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.env.PERF_DIST ?? path.join(root, 'dist'));
const outDir = path.join(root, 'artifacts', process.env.PERF_OUT ?? 'perf');
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const ONLY = new Set((process.env.PERF_ONLY ?? '').split(',').filter(Boolean));
const run = (section) => ONLY.size === 0 || ONLY.has(section);
const GPUS = (process.env.PERF_GPUS ?? 'rtx,uhd,sw').split(',').filter(Boolean);
const QUALITIES = (process.env.PERF_QUALITY ?? 'high,economy').split(',').filter(Boolean);
const QUALITY_KEY = 'cinema3d.quality';
const BROWSERS = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome found; set BROWSER_PATH.');

const GPU_ARGS = {
  rtx: ['--use-angle=d3d11', '--force_high_performance_gpu'],
  uhd: ['--use-angle=d3d11', '--force_low_power_gpu'],
  sw: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  none: ['--disable-webgl'],
};
const VIEWPORTS = {
  'desktop-1440': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  'desktop-1920': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  'laptop-hidpi': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  'tablet-portrait': { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  'tablet-landscape': { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  'phone-390': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  'phone-430': { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
// The same profile as measure-build.mjs; CPU 4× slower on top for "slow".
const SLOW = { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8, cpu: 4 };

const report = { generatedAt: new Date().toISOString(), dist: path.relative(root, dist), runs: RUNS, environment: {}, load: [], runtime: [], interact: [], lifecycle: [], fallback: [], levers: [], notes: [] };
const log = (...args) => console.log(...args);

// ------------------------------------------------------------------ static server (vercel.json)

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const compressed = new Map();
function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = decodeURIComponent(url.pathname);
    const asset = /^\/(assets|media|brand)\//.test(file);
    if (/^\/cinema\/?$/.test(file)) file = '/cinema.html';
    else if (file === '/' || (!asset && !/\.[^/]+$/.test(file))) file = '/index.html';
    const full = path.join(dist, file);
    if (!full.startsWith(dist) || !existsSync(full) || statSync(full).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const ext = path.extname(full);
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
    headers['cache-control'] = file.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : asset ? 'public, max-age=0, must-revalidate' : 'no-cache';
    const size = statSync(full).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && ext === '.mp4') {
      const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
      const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(full, { start, end }).pipe(res);
      return;
    }
    const text = /^(text|application\/json|image\/svg)/.test(headers['content-type']);
    const accept = String(req.headers['accept-encoding'] ?? '');
    if (text && /\b(br|gzip)\b/.test(accept)) {
      const encoding = /\bbr\b/.test(accept) ? 'br' : 'gzip';
      const key = `${full}|${encoding}`;
      if (!compressed.has(key)) {
        const data = await readFile(full);
        compressed.set(key, encoding === 'br' ? brotliCompressSync(data) : gzipSync(data, { level: 9 }));
      }
      const body = compressed.get(key);
      res.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': body.length, vary: 'accept-encoding' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------ in-page instrumentation

/* Runs before the page's own scripts. Everything it records lives on window.__perf. */
function instrument() {
  const perf = (window.__perf = {
    t0: performance.timeOrigin,
    status: [],
    marks: {},
    longTasks: [],
    shifts: 0,
    events: [],
    paints: {},
    frames: [],
    levels: [],
    window: null,
    // Weak references only, so the measuring never keeps a closed page's context or textures alive.
    contexts: [],
  });
  const state = new WeakMap();
  const stateOf = (ctx) => {
    let s = state.get(ctx);
    if (!s) state.set(ctx, (s = { bound: new Map(), unit: 0, rb: null, textures: new Map(), renderbuffers: new Map() }));
    return s;
  };
  Object.defineProperty(perf, 'gl', { get: () => perf.glRef?.deref() ?? null });
  const now = () => performance.now();
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) perf.shifts += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.paints[e.name] = e.startTime;
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.paints.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.events.push({ name: e.name, start: e.startTime, duration: e.duration, processing: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime, target: e.target?.dataset?.action ?? e.target?.dataset?.task ?? e.target?.dataset?.seat ?? e.target?.tagName ?? null });
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}

  // The page's states: the app mounted, each status (loading: code / scene, ready, error, …).
  const seen = new Set();
  const watch = () => {
    const app = document.querySelector('.cinema-app');
    if (app && !seen.has('app')) {
      seen.add('app');
      perf.marks.app = now();
    }
    const status = app?.dataset.status ?? null;
    const caption = document.querySelector('.cinema-status__caption')?.textContent ?? null;
    const last = perf.status.at(-1);
    if (status && (!last || last.status !== status || last.caption !== caption)) perf.status.push({ t: now(), status, caption });
    // The level drawn ("Tự động" moves it): every change, to see that it settles.
    const level = app?.dataset.quality ?? null;
    if (level && perf.levels.at(-1)?.level !== level) perf.levels.push({ t: Math.round(now()), level, reason: app.dataset.qualityReason ?? null });
    if (document.querySelector('.cinema-video2d') && !seen.has('video2d')) {
      seen.add('video2d');
      perf.marks.video2d = now();
    }
  };
  new MutationObserver(watch).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status', 'class', 'data-quality', 'data-quality-reason'] });

  // The film's element is not in the document (it feeds the screen's texture): catch it on play().
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    perf.video = this;
    return play.apply(this, args);
  };

  // WebGL: contexts, draws, texture memory (an estimate from the sizes given to WebGL).
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (ctx && (type === 'webgl2' || type === 'webgl') && !state.has(ctx)) {
      stateOf(ctx);
      perf.contexts.push(new WeakRef(ctx));
      perf.glRef = new WeakRef(ctx);
      perf.timer = ctx.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
      perf.marks.context ??= now();
    }
    return ctx;
  };
  const P = window.WebGL2RenderingContext?.prototype;
  if (P) {
    let calls = 0;
    let triangles = 0;
    perf.counter = () => ({ calls, triangles });
    const tri = (mode, count) => (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
    const wrap = (name, fn) => {
      const original = P[name];
      P[name] = function (...args) {
        fn.apply(this, args);
        return original.apply(this, args);
      };
    };
    wrap('drawElements', (mode, count) => { calls++; triangles += tri(mode, count); });
    wrap('drawArrays', (mode, first, count) => { calls++; triangles += tri(mode, count); });
    wrap('drawElementsInstanced', (mode, count, type, offset, n) => { calls++; triangles += tri(mode, count) * n; });
    wrap('drawArraysInstanced', (mode, first, count, n) => { calls++; triangles += tri(mode, count) * n; });
    const BPP = { 0x8058: 4, 0x1908: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x822f: 4, 0x8230: 8, 0x822d: 2, 0x822e: 4, 0x8229: 1, 0x1903: 1, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x1902: 4, 0x8051: 3, 0x1907: 3, 0x8c41: 3, 0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8c3a: 4, 0x8c3d: 4, 0x881b: 6, 0x8815: 12 };
    const bpp = (format) => BPP[format] ?? 4;
    wrap('activeTexture', function (unit) { stateOf(this).unit = unit; });
    wrap('bindTexture', function (target, texture) { const s = stateOf(this); s.bound.set(`${s.unit}:${target}`, texture); });
    const boundTexture = (ctx, target) => {
      const key = target >= 0x8515 && target <= 0x851a ? 0x8513 : target; // cube faces → the cube map
      const s = stateOf(ctx);
      return s.bound.get(`${s.unit}:${key}`) ?? null;
    };
    const size = (source) => [source?.videoWidth || source?.naturalWidth || source?.width || 0, source?.videoHeight || source?.naturalHeight || source?.height || 0];
    const record = (ctx, texture, key, bytes) => {
      if (!texture) return;
      const { textures } = stateOf(ctx);
      const levels = textures.get(texture) ?? new Map();
      levels.set(key, bytes);
      textures.set(texture, levels);
    };
    wrap('texImage2D', function (target, level, internalformat, ...rest) {
      let w;
      let h;
      if (rest.length >= 6) [w, h] = rest;
      else [w, h] = size(rest.at(-1));
      record(this, boundTexture(this, target), `${target}:${level}`, w * h * bpp(internalformat));
    });
    wrap('texStorage2D', function (target, levels, internalformat, w, h) {
      let bytes = 0;
      for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(internalformat);
      record(this, boundTexture(this, target), `${target}:storage`, bytes * (target === 0x8513 ? 6 : 1));
    });
    wrap('texImage3D', function (target, level, internalformat, w, h, d) {
      record(this, boundTexture(this, target), `${target}:${level}`, w * h * d * bpp(internalformat));
    });
    wrap('texStorage3D', function (target, levels, internalformat, w, h, d) {
      let bytes = 0;
      for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpp(internalformat);
      record(this, boundTexture(this, target), `${target}:storage`, bytes);
    });
    wrap('deleteTexture', function (texture) { stateOf(this).textures.delete(texture); });
    // Shader programs: how many, and the main-thread time spent where WebGL waits for compile/link
    // (status queries and first use; ANGLE compiles lazily, so the wait lands on whichever comes first).
    perf.shaders = { programs: 0, blockedMs: 0 };
    const timed = (name) => {
      const original = P[name];
      P[name] = function (...args) {
        const s = performance.now();
        const r = original.apply(this, args);
        perf.shaders.blockedMs += performance.now() - s;
        return r;
      };
    };
    for (const name of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'useProgram']) timed(name);
    wrap('createProgram', () => { perf.shaders.programs++; });
    wrap('bindRenderbuffer', function (target, rb) { stateOf(this).rb = rb; });
    wrap('renderbufferStorage', function (target, format, w, h) { const s = stateOf(this); if (s.rb) s.renderbuffers.set(s.rb, w * h * bpp(format)); });
    wrap('renderbufferStorageMultisample', function (target, samples, format, w, h) { const s = stateOf(this); if (s.rb) s.renderbuffers.set(s.rb, w * h * bpp(format) * Math.max(1, samples)); });
    wrap('deleteRenderbuffer', function (rb) { stateOf(this).renderbuffers.delete(rb); });
    // Live contexts only: a lost (closed) context's memory is gone with it.
    perf.memory = () => {
      const all = perf.contexts.map((r) => r.deref()).filter(Boolean);
      const live = all.filter((c) => !c.isContextLost());
      let textures = 0;
      let count = 0;
      let renderbuffers = 0;
      for (const c of live) {
        const s = stateOf(c);
        for (const levels of s.textures.values()) {
          count++;
          for (const b of levels.values()) textures += b;
        }
        for (const b of s.renderbuffers.values()) renderbuffers += b;
      }
      // Drop what a lost context held, so nothing here keeps its objects alive.
      for (const c of all.filter((c) => c.isContextLost())) {
        const s = state.get(c);
        s?.textures.clear();
        s?.renderbuffers.clear();
        s?.bound.clear();
      }
      // The canvas' own buffers: colour and depth/stencil, ×4 with antialiasing.
      const canvas = live.map((c) => {
        const a = c.getContextAttributes();
        const samples = a?.antialias ? 4 : 1;
        return c.drawingBufferWidth * c.drawingBufferHeight * (4 + 4) * samples + c.drawingBufferWidth * c.drawingBufferHeight * 4;
      }).reduce((a, b) => a + b, 0);
      return { liveContexts: live.length, contexts: perf.contexts.length, textureCount: count, textureMiB: textures / 2 ** 20, renderbufferMiB: renderbuffers / 2 ** 20, canvasMiB: canvas / 2 ** 20 };
    };
  }

  // Each animation-frame callback that draws: its CPU time, draws, triangles and (when the GPU
  // offers timer queries) GPU time. Frame intervals come from a probe loop during a window.
  const raf = window.requestAnimationFrame.bind(window);
  const pending = [];
  const poll = () => {
    const gl = perf.gl;
    if (!gl || !perf.timer) return;
    const disjoint = gl.getParameter(perf.timer.GPU_DISJOINT_EXT);
    for (let i = pending.length - 1; i >= 0; i--) {
      const { query, frame } = pending[i];
      if (gl.isContextLost()) {
        pending.splice(i, 1);
        continue;
      }
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint) frame.gpu = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      pending.splice(i, 1);
    }
  };
  // A page that times its own frames (TIME_ELAPSED queries cannot nest): its results are used
  // instead — the same quantity, the GPU time of the frame's draws.
  const P2 = window.WebGL2RenderingContext?.prototype;
  const appQueries = new WeakMap();
  if (P2) {
    const beginQuery = P2.beginQuery;
    const endQuery = P2.endQuery;
    const getQueryParameter = P2.getQueryParameter;
    P2.beginQuery = function (target, query) {
      if (perf.timer && target === perf.timer.TIME_ELAPSED_EXT && query !== perf.ownQuery) {
        perf.appTimer = true;
        if (perf.ownQuery) {
          endQuery.call(this, target);
          this.deleteQuery(perf.ownQuery);
          perf.ownQuery = null;
        }
        if (perf.currentFrame) appQueries.set(query, perf.currentFrame);
      }
      return beginQuery.call(this, target, query);
    };
    P2.getQueryParameter = function (query, pname) {
      const value = getQueryParameter.call(this, query, pname);
      if (pname === this.QUERY_RESULT && appQueries.has(query)) appQueries.get(query).gpu = value / 1e6;
      return value;
    };
  }
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      poll();
      const gl = perf.gl && !perf.gl.isContextLost() ? perf.gl : null;
      const before = perf.counter?.() ?? { calls: 0, triangles: 0 };
      let query = null;
      if (gl && perf.timer && !perf.appTimer && pending.length < 30) {
        query = gl.createQuery();
        perf.ownQuery = query;
        gl.beginQuery(perf.timer.TIME_ELAPSED_EXT, query);
      }
      const frame = { t: 0, cpu: 0, calls: 0, triangles: 0, gpu: null };
      perf.currentFrame = frame;
      const start = performance.now();
      try {
        callback(time);
      } finally {
        const cpu = performance.now() - start;
        perf.currentFrame = null;
        // Ended early if the page began its own timer query meanwhile.
        if (query && perf.ownQuery === query) gl.endQuery(perf.timer.TIME_ELAPSED_EXT);
        else query = null;
        perf.ownQuery = null;
        const after = perf.counter?.() ?? before;
        const calls = after.calls - before.calls;
        if (calls > 0) {
          Object.assign(frame, { t: start, cpu, calls, triangles: after.triangles - before.triangles });
          perf.frames.push(frame);
          if (perf.frames.length > 4000) perf.frames.splice(0, 2000);
          perf.marks.firstFrame ??= start + cpu;
          if (perf.window) perf.window.frames.push(frame);
          if (query) pending.push({ query, frame });
        } else if (query) gl.deleteQuery(query);
      }
    });

  perf.begin = () => {
    perf.window = { start: now(), frames: [], ticks: [], longTasks: perf.longTasks.length, events: perf.events.length };
    const w = perf.window;
    const tick = (t) => {
      if (perf.window !== w) return;
      w.ticks.push(t);
      raf(tick);
    };
    raf(tick);
  };
  perf.end = async () => {
    const w = perf.window;
    perf.window = null;
    // Let pending GPU timings come back.
    for (let i = 0; i < 12 && pending.length > 0; i++) {
      await new Promise((r) => raf(r));
      poll();
    }
    const seconds = (now() - w.start) / 1000;
    const q = (list, p) => {
      if (list.length === 0) return null;
      const s = [...list].sort((a, b) => a - b);
      return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100;
    };
    const intervals = w.ticks.slice(1).map((t, i) => t - w.ticks[i]);
    const cpu = w.frames.map((f) => f.cpu);
    const gpu = w.frames.map((f) => f.gpu).filter((g) => g !== null);
    const long = perf.longTasks.slice(w.longTasks);
    return {
      seconds: Math.round(seconds * 100) / 100,
      renders: w.frames.length,
      rendersPerSecond: Math.round((w.frames.length / seconds) * 10) / 10,
      interval: { p50: q(intervals, 0.5), p95: q(intervals, 0.95), max: q(intervals, 1), over25: intervals.filter((d) => d > 25).length, over50: intervals.filter((d) => d > 50).length, count: intervals.length },
      cpu: { p50: q(cpu, 0.5), p95: q(cpu, 0.95), max: q(cpu, 1) },
      gpu: gpu.length ? { p50: q(gpu, 0.5), p95: q(gpu, 0.95), max: q(gpu, 1), samples: gpu.length } : null,
      calls: q(w.frames.map((f) => f.calls), 0.5),
      triangles: q(w.frames.map((f) => f.triangles), 0.5),
      longTasks: { count: long.length, total: Math.round(long.reduce((a, b) => a + b.duration, 0)) },
    };
  };
}

// ------------------------------------------------------------------ helpers

async function launch(gpu) {
  const browser = await chromium.launch({ executablePath, headless: true, args: GPU_ARGS[gpu] });
  return browser;
}

async function newPage(browser, viewportName, { quality, glass, reducedMotion } = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[viewportName], reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await context.addInitScript(instrument);
  await context.addInitScript(
    ([key, quality, glass]) => {
      try {
        if (quality) localStorage.setItem(key, quality);
        if (glass) localStorage.setItem('tp-glass', glass);
        // Phones: the first-visit hint would sit over the room; it is dismissed for every run alike.
        localStorage.setItem('tp-cinema-hub-hint', 'seen');
      } catch {}
    },
    [QUALITY_KEY, quality ?? null, glass ?? null],
  );
  const page = await context.newPage();
  return { context, page };
}

const waitReady = (page, timeout = 120_000) => page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout, polling: 50 });
const median = (list) => {
  const s = list.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const spread = (list) => {
  const s = list.filter((v) => typeof v === 'number');
  return s.length ? { min: Math.min(...s), max: Math.max(...s) } : null;
};
const round = (v, d = 1) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : v);
const immersive = (page) => page.evaluate(() => document.querySelector('.cinema-app')?.dataset.layout === 'immersive');

/** Clicks a control like a user: on phones the tasks and their controls are in the hub. */
async function press(page, selector) {
  if (await immersive(page)) {
    if (!(await page.isVisible(selector))) {
      if ((await page.getAttribute('.cinema-hub__toggle', 'aria-expanded')) !== 'true') await page.click('.cinema-hub__toggle');
      await page.waitForTimeout(250);
    }
    const inHub = `#cinema-hub-panel ${selector}`;
    await page.click((await page.isVisible(inHub)) ? inHub : selector);
    return;
  }
  await page.click(selector);
}
async function closeHub(page) {
  if (await page.isVisible('button[data-action="hub-close"]')) await page.click('button[data-action="hub-close"]');
  await page.waitForTimeout(300);
}
async function task(page, id) {
  const sel = `button[data-task="${id}"]`;
  if (await immersive(page)) {
    await press(page, sel);
    return;
  }
  if ((await page.getAttribute(sel, 'aria-pressed')) !== 'true') await page.click(sel);
}
async function preset(page, id) {
  await task(page, 'explore');
  const sel = `button[data-preset="${id}"]`;
  if (!(await immersive(page)) && !(await page.isVisible(sel))) await page.click('.cinema-more__toggle').catch(() => {});
  const before = await page.evaluate(() => window.__perf.frames.length);
  await press(page, sel);
  if (await immersive(page)) await closeHub(page);
  // The move starts on the next frames: wait for it to begin (or a moment, if the camera was already
  // there), then for it to end.
  await page.waitForFunction((n) => window.__perf.frames.length > n, before, { timeout: 1500, polling: 50 }).catch(() => {});
  await settle(page);
}
/** Waits until the page has drawn nothing for 600 ms (on-demand rendering at rest). */
async function settle(page, timeout = 15_000) {
  await page.waitForFunction(
    () => {
      const f = window.__perf.frames.at(-1);
      return !f || performance.now() - f.t > 600;
    },
    null,
    { timeout, polling: 100 },
  ).catch(() => {});
}
async function windowed(page, ms, during) {
  await page.evaluate(() => window.__perf.begin());
  const work = during ? during() : page.waitForTimeout(ms);
  await Promise.all([work, during ? Promise.resolve() : null]);
  if (during) await page.waitForTimeout(Math.max(0, ms));
  return page.evaluate(() => window.__perf.end());
}
async function memory(page) {
  return page.evaluate(() => window.__perf.memory?.() ?? null);
}
async function gpuName(page) {
  return page.evaluate(() => {
    const gl = window.__perf.gl ?? document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL 2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
}
async function settings(page) {
  return page.evaluate(() => {
    const gl = window.__perf.gl;
    const canvas = document.querySelector('canvas.cinema-canvas');
    return {
      drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
      css: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      dpr: devicePixelRatio,
      quality: document.querySelector('.cinema-app')?.dataset.quality ?? null,
    };
  });
}

// ------------------------------------------------------------------ load

async function loadOnce(browser, base, viewportName, { slow, warm, quality }) {
  const { context, page } = await newPage(browser, viewportName, { quality });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const bytes = {};
  const requests = [];
  cdp.on('Network.responseReceived', (e) => requests.push({ id: e.requestId, type: e.type, url: e.response.url, status: e.response.status, fromCache: e.response.fromDiskCache || e.response.fromServiceWorker }));
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.find((x) => x.id === e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });
  if (warm) {
    await page.goto(`${base}cinema`);
    await waitReady(page);
    await page.waitForTimeout(500);
    requests.length = 0;
  }
  if (slow) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: SLOW.latency, downloadThroughput: SLOW.downloadThroughput, uploadThroughput: SLOW.uploadThroughput });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW.cpu });
  }
  const t = Date.now();
  if (warm) await page.reload();
  else await page.goto(`${base}cinema`);
  await waitReady(page, slow ? 240_000 : 90_000);
  const wall = Date.now() - t;
  await page.waitForTimeout(400);
  const perf = await page.evaluate(() => {
    const p = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0];
    const statusAt = (s) => p.status.find((x) => x.status === s)?.t ?? null;
    const sceneStep = p.status.find((x) => x.status === 'loading' && /dựng/i.test(x.caption ?? ''))?.t ?? null;
    const codeStep = p.status.find((x) => x.status === 'loading' && /tải/i.test(x.caption ?? ''))?.t ?? null;
    return {
      ttfb: nav?.responseStart ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      fcp: p.paints['first-contentful-paint'] ?? null,
      lcp: p.paints.lcp ?? null,
      app: p.marks.app ?? null,
      codeStep,
      sceneStep,
      context: p.marks.context ?? null,
      firstFrame: p.marks.firstFrame ?? null,
      ready: statusAt('ready'),
      cls: p.shifts,
      longTasks: p.longTasks.map((l) => ({ start: Math.round(l.start), duration: Math.round(l.duration) })),
      firstFrameCpu: p.frames[0]?.cpu ?? null,
      shaders: p.shaders ? { programs: p.shaders.programs, blockedMs: Math.round(p.shaders.blockedMs) } : null,
      firstFrameGpu: p.frames[0]?.gpu ?? null,
      status: p.status.map((s) => ({ t: Math.round(s.t), status: s.status, caption: s.caption })),
      // The app's own User Timing measures (cinema:build, cinema:compile, …), when the build has them.
      measures: performance.getEntriesByType('measure').filter((m) => m.name.startsWith('cinema:')).map((m) => ({ name: m.name.slice(7), start: Math.round(m.startTime), duration: Math.round(m.duration) })),
    };
  });
  for (const r of requests) {
    const key = r.url.includes('/media/') ? 'media' : r.type;
    bytes[key] = (bytes[key] ?? 0) + (r.bytes ?? 0);
  }
  if (slow) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const mem = await memory(page);
  await context.close();
  return { wall, ...perf, bytes, requests: requests.length, cached: requests.filter((r) => r.fromCache).length, memory: mem };
}

async function loadSection(base) {
  for (const viewportName of ['desktop-1440', 'phone-390']) {
    for (const slow of [false, true]) {
      for (const warm of [false, true]) {
        const runs = [];
        // Cold: a new browser each time — empty HTTP cache and empty GPU shader cache, as on a first
        // visit. Warm: a reload in the same browser (both caches filled by the first load).
        for (let i = 0; i < RUNS; i++) {
          const browser = await launch(process.env.PERF_LOAD_GPU ?? 'rtx');
          runs.push(await loadOnce(browser, base, viewportName, { slow, warm }));
          await browser.close();
        }
        const pick = (k) => runs.map((r) => r[k]);
        const longest = runs.map((r) => Math.max(0, ...r.longTasks.map((l) => l.duration)));
        const tbt = runs.map((r) => r.longTasks.filter((l) => l.start > (r.fcp ?? 0)).reduce((a, l) => a + Math.max(0, l.duration - 50), 0));
        const row = {
          viewport: viewportName,
          network: slow ? 'slow (150 ms RTT, 1.6 Mbit/s, CPU 4×)' : 'local',
          cache: warm ? 'warm' : 'cold',
          shaders: { programs: median(runs.map((r) => r.shaders?.programs)), blockedMs: median(runs.map((r) => r.shaders?.blockedMs)) },
          median: { fcp: round(median(pick('fcp'))), app: round(median(pick('app'))), sceneStep: round(median(pick('sceneStep'))), firstFrame: round(median(pick('firstFrame'))), ready: round(median(pick('ready'))), longestTask: median(longest), tbt: round(median(tbt)), cls: round(median(pick('cls')), 4), firstFrameCpu: round(median(pick('firstFrameCpu'))) },
          spread: { fcp: spread(pick('fcp').map((v) => round(v))), ready: spread(pick('ready').map((v) => round(v))), firstFrame: spread(pick('firstFrame').map((v) => round(v))), longestTask: spread(longest) },
          bytes: runs[0].bytes,
          requests: runs[0].requests,
          cached: runs[0].cached,
          runs,
        };
        report.load.push(row);
        log(`load ${viewportName} ${row.network} ${row.cache}: fcp ${row.median.fcp} app ${row.median.app} frame ${row.median.firstFrame} ready ${row.median.ready} longest ${row.median.longestTask} tbt ${row.median.tbt} cls ${row.median.cls} first-frame cpu ${row.median.firstFrameCpu} shaders ${JSON.stringify(row.shaders)} | ready ${JSON.stringify(row.spread.ready)}`);
      }
    }
  }
}

// ------------------------------------------------------------------ runtime

async function scenario(page, name, fn) {
  // PERF_SCENARIOS=film,still measures only those (the page still goes through the same steps).
  if (process.env.PERF_SCENARIOS && !process.env.PERF_SCENARIOS.split(',').includes(name)) return { name, skipped: true };
  try {
    return { name, ...(await fn()) };
  } catch (error) {
    return { name, error: String(error).slice(0, 200) };
  }
}

async function runtimeOnce(browser, base, viewportName, quality, gpu) {
  const { context, page } = await newPage(browser, viewportName, { quality });
  await page.goto(`${base}cinema`);
  await waitReady(page);
  await page.waitForTimeout(800);
  await settle(page);
  const phone = await immersive(page);
  const results = { gpu: await gpuName(page), settings: await settings(page), memory: await memory(page), scenarios: [] };
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas.cinema-canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // Still: nothing moves, so nothing should be drawn.
  results.scenarios.push(await scenario(page, 'still', () => windowed(page, 2000)));
  // The guided tour: continuous camera movement through the room.
  results.scenarios.push(
    await scenario(page, 'tour', async () => {
      await task(page, 'explore');
      await press(page, 'button[data-action="tour"]');
      if (phone) await closeHub(page);
      await page.waitForTimeout(2500);
      const r = await windowed(page, gpu === 'sw' ? 4000 : 6000);
      await press(page, 'button[data-action="tour"]').catch(() => {});
      if (phone) await closeHub(page);
      return r;
    }),
  );
  await preset(page, 'overview');
  if (!phone) {
    // Orbit: a mouse drag at a human pace (3 s).
    results.scenarios.push(
      await scenario(page, 'orbit', async () => {
        const cx = box.x + box.w * 0.5;
        const cy = box.y + box.h * 0.45;
        return windowed(page, 300, async () => {
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          for (let i = 0; i < 90; i++) {
            await page.mouse.move(cx + Math.sin(i / 14) * box.w * 0.18, cy + Math.cos(i / 20) * 20);
            await page.waitForTimeout(33);
          }
          await page.mouse.up();
        });
      }),
    );
    await settle(page);
    // Walking: "Đi bộ", then W held for 3 s.
    results.scenarios.push(
      await scenario(page, 'walk', async () => {
        await page.click('button[data-action="explore"]');
        await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.explore === 'true');
        await page.waitForTimeout(2500);
        await page.locator('canvas.cinema-canvas').focus().catch(() => {});
        const r = await windowed(page, 0, async () => {
          await page.keyboard.down('w');
          await page.waitForTimeout(1500);
          await page.keyboard.down('d');
          await page.waitForTimeout(1500);
          await page.keyboard.up('d');
          await page.keyboard.up('w');
        });
        await page.click('button[data-action="explore"]');
        return r;
      }),
    );
    await preset(page, 'overview');
  }
  // The film playing on the screen (one render per video frame).
  results.scenarios.push(
    await scenario(page, 'film', async () => {
      await task(page, 'watch');
      await press(page, 'button[data-action="media-primary"]');
      if (phone) await closeHub(page);
      await page.waitForFunction(() => {
        const v = window.__perf.video;
        return v && !v.paused && v.currentTime > 0.5;
      }, null, { timeout: 20_000 });
      const quality = () => page.evaluate(() => {
        const q = window.__perf.video.getVideoPlaybackQuality();
        return { totalVideoFrames: q.totalVideoFrames, droppedVideoFrames: q.droppedVideoFrames };
      });
      const before = await quality();
      const r = await windowed(page, 5000);
      const after = await quality();
      await press(page, 'button[data-action="media-primary"]');
      if (phone) await closeHub(page);
      return { ...r, video: { decoded: after.totalVideoFrames - before.totalVideoFrames, dropped: after.droppedVideoFrames - before.droppedVideoFrames } };
    }),
  );
  results.memoryAfter = await memory(page);
  results.settingsAfter = await settings(page);
  results.levels = await page.evaluate(() => window.__perf.levels);
  await context.close();
  return results;
}

async function runtimeSection(base) {
  const plan = [];
  for (const gpu of GPUS) {
    const all = gpu === 'sw' ? ['desktop-1440', 'phone-390'] : gpu === 'uhd' ? ['desktop-1440', 'desktop-1920', 'laptop-hidpi', 'tablet-portrait', 'phone-390'] : Object.keys(VIEWPORTS);
    const viewports = process.env.PERF_VIEWPORTS ? all.filter((v) => process.env.PERF_VIEWPORTS.split(',').includes(v)) : all;
    for (const viewportName of viewports) for (const quality of QUALITIES) plan.push({ gpu, viewportName, quality });
  }
  for (const gpu of GPUS) {
    const browser = await launch(gpu);
    for (const { viewportName, quality } of plan.filter((p) => p.gpu === gpu)) {
      const runs = [];
      const n = gpu === 'sw' ? Math.min(RUNS, 2) : RUNS;
      for (let i = 0; i < n; i++) runs.push(await runtimeOnce(browser, base, viewportName, quality, gpu));
      const names = [...new Set(runs.flatMap((r) => r.scenarios.map((s) => s.name)))];
      const summary = {};
      for (const name of names) {
        const list = runs.map((r) => r.scenarios.find((s) => s.name === name)).filter((s) => s && !s.error && !s.skipped);
        if (list.length === 0) continue;
        const m = (f) => round(median(list.map(f)), 2);
        const sp = (f) => spread(list.map(f).map((v) => round(v, 2)));
        summary[name] = {
          renders: m((s) => s.renders),
          rendersPerSecond: m((s) => s.rendersPerSecond),
          intervalP50: m((s) => s.interval.p50),
          intervalP95: m((s) => s.interval.p95),
          over25: m((s) => s.interval.over25),
          over50: m((s) => s.interval.over50),
          cpuP50: m((s) => s.cpu.p50),
          cpuP95: m((s) => s.cpu.p95),
          gpuP50: m((s) => s.gpu?.p50),
          gpuP95: m((s) => s.gpu?.p95),
          calls: m((s) => s.calls),
          triangles: m((s) => s.triangles),
          longTasks: m((s) => s.longTasks.count),
          spread: { gpuP50: sp((s) => s.gpu?.p50), cpuP50: sp((s) => s.cpu.p50), intervalP95: sp((s) => s.interval.p95) },
          video: list[0]?.video ?? null,
          errors: runs.map((r) => r.scenarios.find((s) => s.name === name)?.error).filter(Boolean),
        };
      }
      const row = { gpu, gpuName: runs[0].gpu, viewport: viewportName, quality, settings: runs[0].settings, settingsAfter: runs[0].settingsAfter, memory: runs[0].memory, levels: runs.map((r) => r.levels), summary, runs };
      report.runtime.push(row);
      const t = summary.tour ?? {};
      const f = summary.film ?? {};
      if (quality === 'auto') log(`  auto levels: ${row.levels.map((l) => l.map((x) => `${x.level}@${x.t}${x.reason ? ` (${x.reason})` : ''}`).join(' → ')).join(' | ')}`);
      log(`runtime ${gpu} ${viewportName} ${quality} buf ${JSON.stringify(row.settings.drawingBuffer)}→${JSON.stringify(row.settingsAfter?.drawingBuffer)}: tour fps ${t.rendersPerSecond} int95 ${t.intervalP95} cpu ${t.cpuP50}/${t.cpuP95} gpu ${t.gpuP50}/${t.gpuP95} calls ${t.calls} tris ${t.triangles} | film gpu ${f.gpuP50} dropped ${f.video?.dropped} | still renders ${summary.still?.renders} | tex ${round(row.memory?.textureMiB)} MiB`);
    }
    await browser.close();
  }
}

// ------------------------------------------------------------------ interactions

async function interactSection(base) {
  const browser = await launch('rtx');
  for (const viewportName of ['desktop-1440', 'phone-390']) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const { context, page } = await newPage(browser, viewportName, {});
      await page.goto(`${base}cinema`);
      await waitReady(page);
      await settle(page);
      const phone = await immersive(page);
      const mark = () => page.evaluate(() => window.__perf.events.length);
      const since = (n, names) => page.evaluate(([n, names]) => window.__perf.events.slice(n).filter((e) => names.includes(e.name)), [n, names]);
      const timed = async (label, act) => {
        const n = await mark();
        const t = Date.now();
        await act();
        await page.waitForTimeout(300);
        const events = await since(n, ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup']);
        const worst = events.reduce((a, e) => Math.max(a, e.duration), 0);
        return { label, worstEventMs: worst, events: events.length, wallMs: Date.now() - t };
      };
      const out = [];
      out.push(await timed('task: Chọn ghế', () => task(page, 'seats')));
      if (phone) await closeHub(page);
      out.push(await timed('task: Xem phim', () => task(page, 'watch')));
      if (phone) await closeHub(page);
      out.push(await timed('task: Khám phá', () => task(page, 'explore')));
      if (phone) await closeHub(page);
      // A seat picked on the map (the panel opens beside the view / as a sheet).
      await task(page, 'seats');
      if (!(await page.isVisible('#cinema-seat-panel'))) await press(page, 'button[data-action="seat-panel"]');
      await page.waitForSelector('#cinema-seat-panel:not([hidden])');
      out.push(await timed('seat on the map', () => page.locator('#cinema-seat-panel button.cinema-seat[data-status="available"]').nth(3).click()));
      if (await page.isVisible('button[data-action="seat-panel-close"]')) await page.click('button[data-action="seat-panel-close"]');
      await settle(page);
      // A seat clicked in the room (the middle of the lower third usually holds seats).
      const box = await page.evaluate(() => {
        const r = document.querySelector('canvas.cinema-canvas').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height * 0.72 };
      });
      out.push(await timed('click in the room', () => (phone ? page.touchscreen.tap(box.x, box.y) : page.mouse.click(box.x, box.y))));
      await page.evaluate(() => document.querySelector('[data-action="card-close"]')?.click());
      await task(page, 'explore');
      out.push(await timed('tour start', () => press(page, 'button[data-action="tour"]')));
      await page.waitForTimeout(1500);
      out.push(await timed('tour stop', () => press(page, 'button[data-action="tour"]')));
      if (phone) await closeHub(page);
      await settle(page);
      await task(page, 'watch');
      const playing = Date.now();
      out.push(await timed('play', () => press(page, 'button[data-action="media-primary"]')));
      await page.waitForFunction(() => window.__perf.video && !window.__perf.video.paused && window.__perf.video.currentTime > 0, null, { timeout: 20_000 });
      out.push({ label: 'play → picture moving', wallMs: Date.now() - playing });
      if (phone) await closeHub(page);
      // Seek: set the bar 30 % in (as a drag ending there would).
      const seekStart = Date.now();
      await page.evaluate(() => {
        const seek = document.querySelector('input[data-action="media-seek"]');
        seek.value = String(Number(seek.max) * 0.3);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        seek.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => !window.__perf.video.seeking, null, { timeout: 10_000 });
      out.push({ label: 'seek → frame', wallMs: Date.now() - seekStart });
      await press(page, 'button[data-action="media-primary"]');
      runs.push(out);
      await context.close();
    }
    const labels = runs[0].map((r) => r.label);
    const rows = labels.map((label) => {
      const list = runs.map((r) => r.find((x) => x.label === label));
      return { label, worstEventMs: median(list.map((x) => x?.worstEventMs)), wallMs: median(list.map((x) => x?.wallMs)), spread: spread(list.map((x) => x?.worstEventMs ?? x?.wallMs)) };
    });
    report.interact.push({ viewport: viewportName, rows, runs });
    for (const r of rows) log(`interact ${viewportName} ${r.label}: event ${r.worstEventMs} ms, wall ${r.wallMs} ms ${JSON.stringify(r.spread)}`);
  }
  await browser.close();
}

// ------------------------------------------------------------------ lifecycle

async function lifecycleSection(base) {
  const browser = await launch('rtx');
  const { context, page } = await newPage(browser, 'desktop-1440', {});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async (label) => {
    await memory(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(200);
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const gl = await memory(page);
    return { label, heapMiB: round(m.JSHeapUsedSize / 2 ** 20, 2), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, ...gl, canvases: await page.evaluate(() => document.querySelectorAll('canvas').length) };
  };
  const go = async (url, ready) => {
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
    await ready();
  };
  await page.goto(`${base}cinema`);
  await waitReady(page);
  await settle(page);
  const samples = [await sample('first mount')];
  for (let i = 1; i <= 8; i++) {
    await go('/', () => page.waitForFunction(() => document.documentElement.dataset.route === 'landing' && !document.querySelector('canvas')));
    await page.waitForTimeout(200);
    if (i === 1) samples.push(await sample('landing after 1 mount'));
    await go('/cinema', () => waitReady(page));
    await settle(page);
    samples.push(await sample(`mount ${i + 1}`));
  }
  await go('/', () => page.waitForFunction(() => document.documentElement.dataset.route === 'landing'));
  await page.waitForTimeout(200);
  samples.push(await sample('landing after 9 mounts'));
  report.lifecycle = samples;
  for (const s of samples) log(`lifecycle ${s.label}: heap ${s.heapMiB} MiB nodes ${s.nodes} listeners ${s.listeners} contexts ${s.liveContexts}/${s.contexts} tex ${round(s.textureMiB)} MiB (${s.textureCount}) canvases ${s.canvases}`);
  await context.close();
  await browser.close();
}

// ------------------------------------------------------------------ fallbacks

async function fallbackSection(base) {
  {
    const browser = await launch('none');
    const { context, page } = await newPage(browser, 'desktop-1440', {});
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const t = Date.now();
    await page.goto(`${base}cinema`);
    await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'error', null, { timeout: 30_000 });
    const state = await page.evaluate(() => ({
      status: document.querySelector('.cinema-app').dataset.status,
      video2d: Boolean(document.querySelector('.cinema-video2d video')),
      seatPanel: !document.querySelector('#cinema-seat-panel')?.hidden,
      app: window.__perf.marks.app,
      retry: Boolean(document.querySelector('[data-action="retry-scene"]')),
    }));
    await page.screenshot({ path: path.join(outDir, 'fallback-no-webgl.png') });
    report.fallback.push({ case: 'no WebGL', wallMs: Date.now() - t, ...state, consoleErrors: errors.length });
    log(`fallback no WebGL: ${JSON.stringify(report.fallback.at(-1))}`);
    await context.close();
    await browser.close();
  }
  const browser = await launch('rtx');
  for (const restore of [true, false]) {
    const { context, page } = await newPage(browser, 'desktop-1440', {});
    await page.goto(`${base}cinema`);
    await waitReady(page);
    await settle(page);
    await task(page, 'seats');
    if (!(await page.isVisible('#cinema-seat-panel'))) await page.click('button[data-action="seat-panel"]');
    await page.locator('#cinema-seat-panel button.cinema-seat[data-status="available"]').nth(5).click();
    const picked = await page.evaluate(() => [...document.querySelectorAll('#cinema-seat-panel button.cinema-seat[aria-pressed="true"]')].map((b) => b.dataset.seat));
    const t = Date.now();
    await page.evaluate(() => {
      window.__lose = window.__perf.gl.getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost', null, { timeout: 5000 });
    const lostAfter = Date.now() - t;
    let back;
    if (restore) {
      await page.waitForTimeout(500);
      const r = Date.now();
      await page.evaluate(() => window.__lose.restoreContext());
      await waitReady(page, 20_000);
      back = { restoredMs: Date.now() - r };
    } else {
      await page.waitForSelector('[data-action="retry-scene"]', { timeout: 15_000 });
      const shownAfter = Date.now() - t;
      await page.screenshot({ path: path.join(outDir, 'fallback-context-stuck.png') });
      const r = Date.now();
      await page.click('[data-action="retry-scene"]');
      await waitReady(page, 30_000);
      back = { retryShownMs: shownAfter, rebuiltMs: Date.now() - r };
    }
    const after = await page.evaluate(() => [...document.querySelectorAll('#cinema-seat-panel button.cinema-seat[aria-pressed="true"]')].map((b) => b.dataset.seat));
    const mem = await memory(page);
    report.fallback.push({ case: restore ? 'context lost, restored' : 'context lost, not restored', lostAfterMs: lostAfter, ...back, seatsKept: JSON.stringify(after) === JSON.stringify(picked), liveContexts: mem?.liveContexts, canvases: await page.evaluate(() => document.querySelectorAll('canvas').length) });
    log(`fallback ${JSON.stringify(report.fallback.at(-1))}`);
    await context.close();
  }
  await browser.close();
}

// ------------------------------------------------------------------ screenshots

async function shotsSection(base) {
  const browser = await launch('rtx');
  for (const viewportName of ['desktop-1440', 'phone-390']) {
    for (const quality of QUALITIES) {
      const { context, page } = await newPage(browser, viewportName, { quality });
      await page.goto(`${base}cinema`);
      await waitReady(page);
      await settle(page);
      const name = (view) => path.join(outDir, `shot-${viewportName}-${quality}-${view}.png`);
      await page.screenshot({ path: name('overview') });
      await preset(page, 'seats');
      await page.screenshot({ path: name('seats') });
      await preset(page, 'seatEye');
      await page.screenshot({ path: name('screen') });
      await preset(page, 'overview');
      if (!(await immersive(page))) {
        // Moving: halfway through a drag.
        const box = await page.evaluate(() => {
          const r = document.querySelector('canvas.cinema-canvas').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height * 0.45 };
        });
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        for (let i = 0; i < 12; i++) {
          await page.mouse.move(box.x + i * 14, box.y);
          await page.waitForTimeout(16);
        }
        await page.screenshot({ path: name('moving') });
        await page.mouse.up();
        await settle(page);
        await task(page, 'watch');
        await page.waitForTimeout(500);
        await page.screenshot({ path: name('glass-watch') });
      }
      await context.close();
    }
  }
  await browser.close();
}

// ------------------------------------------------------------------ levers (dev server only)

/**
 * What each drawing level and the glass cost on each GPU (development server, PERF_BASE pointing at
 * it: it pins levels through the page's dev hook). The tour, then the film, per level × glass.
 */
async function leversSection(base) {
  for (const gpu of GPUS) {
    const browser = await launch(gpu);
    const viewports = gpu === 'sw' ? ['desktop-1440'] : ['desktop-1920', 'laptop-hidpi', 'phone-390'];
    for (const viewportName of viewports) {
      for (const glass of ['full', 'reduced']) {
        const { context, page } = await newPage(browser, viewportName, { quality: 'high', glass: glass === 'reduced' ? 'reduced' : null });
        await page.goto(`${base}cinema`);
        await waitReady(page);
        await settle(page);
        const phone = await immersive(page);
        for (const level of ['high', 'balanced', 'economy', 'minimal']) {
          await page.evaluate((l) => window.__cinema.setQualityLevel(l), level);
          await page.waitForTimeout(300);
          await settle(page);
          const runs = [];
          for (let i = 0; i < (gpu === 'sw' ? 1 : RUNS); i++) {
            await task(page, 'explore');
            await press(page, 'button[data-action="tour"]');
            if (phone) await closeHub(page);
            await page.waitForTimeout(2000);
            runs.push(await windowed(page, gpu === 'sw' ? 3000 : 4000));
            await press(page, 'button[data-action="tour"]').catch(() => {});
            if (phone) await closeHub(page);
            await preset(page, 'overview');
          }
          const s = await settings(page);
          const row = {
            gpu,
            viewport: viewportName,
            glass,
            level,
            drawingBuffer: s.drawingBuffer,
            gpuP50: median(runs.map((r) => r.gpu?.p50)),
            gpuP95: median(runs.map((r) => r.gpu?.p95)),
            intervalP50: median(runs.map((r) => r.interval.p50)),
            intervalP95: median(runs.map((r) => r.interval.p95)),
            fps: median(runs.map((r) => r.rendersPerSecond)),
            triangles: median(runs.map((r) => r.triangles)),
            spread: spread(runs.map((r) => r.gpu?.p50)),
          };
          report.levers.push(row);
          log(`levers ${gpu} ${viewportName} glass ${glass} ${level} buf ${JSON.stringify(row.drawingBuffer)}: gpu ${row.gpuP50}/${row.gpuP95} interval ${row.intervalP50}/${row.intervalP95} fps ${row.fps} tris ${row.triangles} ${JSON.stringify(row.spread)}`);
        }
        await context.close();
      }
    }
    await browser.close();
  }
}

// ------------------------------------------------------------------ compare two reports

/** PERF_COMPARE=perf/baseline,perf/after: markdown tables (medians) of two reports, side by side. */
async function compare([beforeName, afterName]) {
  const read = async (name) => JSON.parse(await readFile(path.join(root, 'artifacts', name, 'perf.json'), 'utf8'));
  const [a, b] = await Promise.all([read(beforeName), read(afterName)]);
  const cell = (x, y, digits = 0) => {
    if (typeof x !== 'number' && typeof y !== 'number') return '–';
    const f = (v) => (typeof v === 'number' ? v.toFixed(digits) : '–');
    return `${f(x)} → ${f(y)}`;
  };
  const out = [];
  out.push('### Tải trang (trung vị, ms)', '', '| Kích thước | Mạng | Cache | Giao diện dùng được | Khung 3D đầu tiên | Long task dài nhất | TBT | CLS |', '|---|---|---|---|---|---|---|---|');
  for (const row of b.load) {
    const base = a.load.find((r) => r.viewport === row.viewport && r.network === row.network && r.cache === row.cache);
    out.push(`| ${row.viewport} | ${row.network.startsWith('slow') ? 'chậm + CPU 4×' : 'cục bộ'} | ${row.cache === 'cold' ? 'lạnh' : 'ấm'} | ${cell(base?.median.app, row.median.app)} | ${cell(base?.median.ready, row.median.ready)} | ${cell(base?.median.longestTask, row.median.longestTask)} | ${cell(base?.median.tbt, row.median.tbt)} | ${cell(base?.median.cls, row.median.cls, 3)} |`);
  }
  out.push('', '### Khung hình (trung vị của các lượt; GPU = timer query, ms)', '', '| GPU | Kích thước | Chất lượng | Tour fps | Tour GPU p50/p95 | Khung > 25 ms (tour) | Phim GPU p50 | Phim rớt khung | Đứng yên: khung vẽ |', '|---|---|---|---|---|---|---|---|---|');
  for (const row of b.runtime) {
    const base = a.runtime.find((r) => r.gpu === row.gpu && r.viewport === row.viewport && r.quality === row.quality);
    const t = row.summary.tour ?? {};
    const bt = base?.summary.tour ?? {};
    const f = row.summary.film ?? {};
    const bf = base?.summary.film ?? {};
    out.push(`| ${row.gpu} | ${row.viewport} | ${row.quality} | ${cell(bt.rendersPerSecond, t.rendersPerSecond, 1)} | ${base ? `${bt.gpuP50 ?? '–'}/${bt.gpuP95 ?? '–'} → ` : ''}${t.gpuP50 ?? '–'}/${t.gpuP95 ?? '–'} | ${cell(bt.over25, t.over25)} | ${cell(bf.gpuP50, f.gpuP50, 2)} | ${cell(bf.video?.dropped, f.video?.dropped)} | ${cell(base?.summary.still?.renders, row.summary.still?.renders)} |`);
  }
  out.push('', '### Thao tác (event timing, ms)', '', '| Kích thước | Thao tác | Trước | Sau |', '|---|---|---|---|');
  for (const view of b.interact) {
    const base = a.interact.find((x) => x.viewport === view.viewport);
    for (const r of view.rows) {
      const br = base?.rows.find((x) => x.label === r.label);
      out.push(`| ${view.viewport} | ${r.label} | ${br?.worstEventMs ?? br?.wallMs ?? '–'} | ${r.worstEventMs ?? r.wallMs ?? '–'} |`);
    }
  }
  out.push('', '### Vòng đời (sau GC)', '', '| Mốc | Heap MiB | Node DOM | Listener | Context sống | Texture MiB |', '|---|---|---|---|---|---|');
  for (const s of b.lifecycle) {
    const base = a.lifecycle.find((x) => x.label === s.label);
    out.push(`| ${s.label} | ${cell(base?.heapMiB, s.heapMiB, 2)} | ${cell(base?.nodes, s.nodes)} | ${cell(base?.listeners, s.listeners)} | ${cell(base?.liveContexts, s.liveContexts)} | ${cell(base?.textureMiB, s.textureMiB, 1)} |`);
  }
  log(out.join('\n'));
}

// ------------------------------------------------------------------ main

if (process.env.PERF_COMPARE) {
  await compare(process.env.PERF_COMPARE.split(','));
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
// PERF_BASE: measure a server that is already running (the dev server for `levers`) instead.
const server = process.env.PERF_BASE ? null : await serve();
const base = process.env.PERF_BASE ?? `http://127.0.0.1:${server.address().port}/`;
report.environment = {
  machine: 'Windows 11, Intel Core i9-12900K (16 cores), 128 GiB; GPUs: NVIDIA GeForce RTX 3090 (discrete), Intel UHD Graphics 770 (integrated)',
  browser: `${executablePath} (headless)`,
  server: 'node static server mirroring vercel.json (HTML no-cache, /assets immutable, br/gzip, byte ranges), 127.0.0.1',
  note: 'Phone and tablet sizes are emulated viewports on this desktop; they are not measurements of a phone or tablet.',
};
if (process.env.PERF_SERVE) {
  // Development: only the server, for probing a build by hand.
  log(`serving ${path.relative(root, dist)} at ${base}`);
  await new Promise(() => {});
}
try {
  if (run('load')) await loadSection(base);
  if (run('runtime')) await runtimeSection(base);
  if (run('interact')) await interactSection(base);
  if (run('lifecycle')) await lifecycleSection(base);
  if (run('fallback')) await fallbackSection(base);
  if (run('shots')) await shotsSection(base);
  if (ONLY.has('levers')) await leversSection(base);
} finally {
  server?.close();
  await writeFile(path.join(outDir, 'perf.json'), JSON.stringify(report, null, 2));
  log(`→ ${path.relative(root, path.join(outDir, 'perf.json'))}`);
}
