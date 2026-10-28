// Measures the production build (dist/, run `npm run build` first) served by `vite preview`, in a
// locally installed Chrome (playwright-core, no browser download):
// - bundle: every file in dist/assets with raw, gzip and brotli sizes, and which ones the first
//   screen needs (the entry) versus the 3D part (loaded right after);
// - routes: /cinema opened directly and refreshed, /, the seat inspector, an unknown path, asset
//   and media MIME types, range requests on the film, dev-only fixtures absent and ignored;
// - time to a usable page (tasks and seat map on screen) and to a ready 3D scene, with the bytes
//   transferred by then, on the local machine and with a throttled connection;
// - the film's requests and bytes before Play, 4 s after Play and after the end.
// Writes artifacts/<CAPTURE_DIR or prompt-08>/build-metrics.json and prints a summary.
//
//   npm run build && node scripts/measure-build.mjs

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-08');
const FILM = '/media/big-buck-bunny-trailer-720p.mp4';
const THROTTLED = { name: '1,6 Mbit/s xuống, 0,75 Mbit/s lên, RTT 150 ms (giả lập CDP)', down: 1.6e6 / 8, up: 0.75e6 / 8, latency: 150 };
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const result = { generatedAt: new Date().toISOString(), checks: [], bundle: null, routes: {}, timing: [], network: null };
function check(name, passed, detail) {
  result.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

async function bundle() {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8');
  const entry = /<script type="module"[^>]*src="\/assets\/([^"]+)"/.exec(html)?.[1];
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const files = [];
  for (const name of await readdir(path.join(dist, 'assets'))) {
    const data = await readFile(path.join(dist, 'assets', name));
    files.push({ name, raw: data.length, gzip: gzipSync(data, { level: 9 }).length, brotli: brotliCompressSync(data).length });
  }
  const sum = (list, key) => list.reduce((n, f) => n + f[key], 0);
  const initial = files.filter((f) => f.name === entry || css.includes(f.name) || preloaded.includes(f.name));
  const js = files.filter((f) => f.name.endsWith('.js'));
  const inspector = files.filter((f) => f.name.startsWith('seatInspector'));
  const htmlBytes = Buffer.byteLength(html);
  return {
    files,
    entry,
    css,
    html: { raw: htmlBytes, gzip: gzipSync(html).length },
    initial: { files: initial.map((f) => f.name), raw: sum(initial, 'raw') + htmlBytes, gzip: sum(initial, 'gzip') + gzipSync(html).length },
    // Everything a visit to /cinema downloads before the scene is ready (all JS except the seat inspector).
    toScene: { raw: sum(files, 'raw') - sum(inspector, 'raw') + htmlBytes, gzip: sum(files, 'gzip') - sum(inspector, 'gzip') + gzipSync(html).length },
    jsTotal: { raw: sum(js, 'raw'), gzip: sum(js, 'gzip') },
    media: await Promise.all(['big-buck-bunny-trailer-720p.mp4', 'big-buck-bunny-trailer-poster.jpg'].map(async (name) => ({ name, bytes: (await stat(path.join(dist, 'media', name))).size }))),
    fixturesInDist: existsSync(path.join(dist, 'fixtures')),
  };
}

// Marks when the page's own controls exist (usable) and when the scene is ready.
const MARKS = () => {
  window.__marks = {};
  const observer = new MutationObserver(() => {
    const app = document.querySelector('.cinema-app');
    if (app && document.querySelector('button[data-task="seats"]') && window.__marks.usable === undefined) window.__marks.usable = performance.now();
    if (app?.dataset.status === 'ready' && window.__marks.ready === undefined) window.__marks.ready = performance.now();
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] });
};

async function main() {
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first.');
  await mkdir(outDir, { recursive: true });
  result.bundle = await bundle();
  check('bundle: dev fixtures are not in dist/', !result.bundle.fixturesInDist);

  const server = await preview({ root, logLevel: 'warn', preview: { port: 4317, strictPort: false } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({ executablePath, headless: true });
  result.browser = { executablePath, version: browser.version(), server: 'vite preview (gzip/brotli on)' };
  try {
    // Routes, MIME types and ranges.
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const failed = [];
      page.on('response', (response) => {
        if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      const direct = await page.goto(`${base}/cinema`);
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      const assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname));
      check('routes: /cinema opens directly and after a refresh; no failed request', direct.status() === 200 && failed.length === 0, { status: direct.status(), failed });
      const types = {};
      for (const asset of assets.filter((a) => a.startsWith('/assets/'))) types[asset] = (await page.request.get(`${base}${asset}`)).headers()['content-type'];
      check('routes: assets load from /assets/ with JS and CSS types', Object.keys(types).length >= 3 && Object.entries(types).every(([name, type]) => (name.endsWith('.js') ? /javascript/.test(type) : name.endsWith('.css') ? /css/.test(type) : true)), types);
      const ranged = await page.request.get(`${base}${FILM}`, { headers: { Range: 'bytes=1000-1999' } });
      const filmHead = { status: ranged.status(), type: ranged.headers()['content-type'], range: ranged.headers()['content-range'], length: (await ranged.body()).length };
      check('routes: the film is video/mp4 and answers range requests (206)', filmHead.status === 206 && filmHead.type === 'video/mp4' && /^bytes 1000-1999\//.test(filmHead.range) && filmHead.length === 1000, filmHead);
      await page.goto(`${base}/cinema?film=pattern-16x9.mp4`);
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      const fixture = await page.evaluate(() => ({ title: document.querySelector('.cinema-player__title')?.textContent, hook: Boolean(window.__cinema) }));
      const fixtureFile = await page.request.get(`${base}/fixtures/media/pattern-16x9.mp4`);
      check('routes: ?film= is ignored in production (demo film shown, no dev hook, fixture not served as video)', /Big Buck Bunny/.test(fixture.title ?? '') && !fixture.hook && fixtureFile.headers()['content-type'] !== 'video/mp4', { ...fixture, fixture: [fixtureFile.status(), fixtureFile.headers()['content-type']] });
      await page.goto(`${base}/`);
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      check('routes: / lands on /cinema', new URL(page.url()).pathname === '/cinema', page.url());
      await page.goto(`${base}/cinema?inspect=seat`);
      await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready', null, { timeout: 60_000 });
      check('routes: the seat inspector loads in production', true);
      await page.goto(`${base}/khong-co-trang-nay`);
      check('routes: an unknown path shows the not-found page', (await page.textContent('h1')) === 'Không tìm thấy trang');
      result.routes = { assets: types, film: filmHead, fixture };
      await context.close();
    }

    // Time to a usable page and to the scene, and bytes transferred by then.
    for (const throttle of [null, THROTTLED]) {
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await context.addInitScript(MARKS);
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (throttle) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: throttle.latency, downloadThroughput: throttle.down, uploadThroughput: throttle.up });
        await page.goto(`${base}/cinema`, { waitUntil: 'commit' });
        await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 120_000 });
        const t = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          const until = (ms) => nav.transferSize + resources.filter((r) => r.responseEnd <= ms).reduce((sum, r) => sum + r.transferSize, 0);
          return {
            usableMs: Math.round(window.__marks.usable),
            sceneReadyMs: Math.round(window.__marks.ready),
            bytesToUsable: until(window.__marks.usable),
            bytesToReady: until(window.__marks.ready),
            requestsToReady: resources.filter((r) => r.responseEnd <= window.__marks.ready).map((r) => `${new URL(r.name).pathname} ${r.transferSize}`),
          };
        });
        result.timing.push({ network: throttle?.name ?? 'máy cục bộ, không giới hạn', run, ...t });
        await context.close();
      }
    }

    // The film: requests and bytes before Play, 4 s after Play, after the end.
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const requests = new Map();
      cdp.on('Network.requestWillBeSent', (e) => {
        const url = new URL(e.request.url);
        if (url.pathname.startsWith('/media/')) requests.set(e.requestId, { path: url.pathname, range: e.request.headers.Range ?? e.request.headers.range ?? null, status: null, enc: 0, data: 0, state: 'open' });
      });
      cdp.on('Network.responseReceived', (e) => {
        const r = requests.get(e.requestId);
        if (r) r.status = e.response.status;
      });
      // Bytes arrive as encoded or decoded lengths depending on the event; the larger of the two sums counts.
      cdp.on('Network.dataReceived', (e) => {
        const r = requests.get(e.requestId);
        if (r) (r.enc += e.encodedDataLength), (r.data += e.dataLength);
      });
      cdp.on('Network.loadingFinished', (e) => {
        const r = requests.get(e.requestId);
        if (r) r.state = 'finished';
      });
      cdp.on('Network.loadingFailed', (e) => {
        const r = requests.get(e.requestId);
        if (r) r.state = e.canceled ? 'cancelled' : 'failed';
      });
      const snapshot = () => [...requests.values()].map((r) => ({ path: r.path, range: r.range, status: r.status, bytes: Math.max(r.enc, r.data), state: r.state }));
      const sum = (list) => ({ requests: list.filter((r) => r.path === FILM).length, bytes: list.filter((r) => r.path === FILM).reduce((n, r) => n + r.bytes, 0), poster: list.filter((r) => r.path.endsWith('.jpg')).length });
      await page.goto(`${base}/cinema`);
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      await page.waitForTimeout(3000);
      const before = snapshot();
      const metadata = await page.evaluate(() => document.querySelector('.cinema-player__time')?.textContent);
      await page.click('button[data-task="watch"]');
      await page.click('button[data-action="media-primary"]');
      await page.waitForFunction(() => document.querySelector('.cinema-player')?.dataset.state === 'playing', null, { timeout: 30_000 });
      await page.waitForTimeout(4000);
      const playing = snapshot();
      await page.waitForFunction(() => document.querySelector('.cinema-player')?.dataset.state === 'ended', null, { timeout: 60_000 });
      const ended = snapshot();
      const fileBytes = (await stat(path.join(dist, FILM))).size;
      result.network = { fileBytes, durationShownBeforePlay: metadata, beforePlay: sum(before), afterPlay4s: sum(playing), afterEnd: sum(ended), requests: { before, playing, ended } };
      // preload="metadata": Chrome still reads ahead about 1–1.4 MB from the start of the file.
      check('film: before Play only the poster and the start of the film are fetched (≤ 2 requests, ≤ 20 % of the file)', result.network.beforePlay.requests <= 2 && result.network.beforePlay.bytes <= fileBytes * 0.2 && result.network.beforePlay.poster === 1, result.network.beforePlay);
      check('film: its duration is known before Play', /\/ 0:3\d/.test(metadata ?? ''), metadata);
      check('film: watching to the end downloads the file about once (≤ 1,2 × its size)', result.network.afterEnd.bytes <= fileBytes * 1.2, { ...result.network.afterEnd, fileBytes });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
  result.summary = {};
  for (const network of [...new Set(result.timing.map((t) => t.network))]) {
    const runs = result.timing.filter((t) => t.network === network);
    result.summary[network] = {
      usableMs: median(runs.map((t) => t.usableMs)),
      sceneReadyMs: median(runs.map((t) => t.sceneReadyMs)),
      bytesToUsable: median(runs.map((t) => t.bytesToUsable)),
      bytesToReady: median(runs.map((t) => t.bytesToReady)),
    };
  }
  await writeFile(path.join(outDir, 'build-metrics.json'), `${JSON.stringify(result, null, 2)}\n`);
  const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
  console.log('\nBundle (raw / gzip / brotli):');
  for (const f of result.bundle.files) console.log(`  ${f.name.padEnd(32)} ${kB(f.raw).padStart(10)} ${kB(f.gzip).padStart(10)} ${kB(f.brotli).padStart(10)}`);
  console.log(`  first screen (html + entry + css): ${kB(result.bundle.initial.raw)} / ${kB(result.bundle.initial.gzip)} gzip`);
  console.log(`  everything to the scene:           ${kB(result.bundle.toScene.raw)} / ${kB(result.bundle.toScene.gzip)} gzip`);
  console.log('Timing (median of 3):', JSON.stringify(result.summary, null, 1));
  console.log('Film:', JSON.stringify({ before: result.network.beforePlay, after4s: result.network.afterPlay4s, end: result.network.afterEnd, file: result.network.fileBytes }));
  const failed = result.checks.filter((c) => !c.passed).length;
  console.log(`\n${result.checks.length - failed} passed, ${failed} failed → ${path.relative(root, path.join(outDir, 'build-metrics.json'))}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
