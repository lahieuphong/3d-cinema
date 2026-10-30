// Measures the production build (dist/, run `yarn build` first) served by `vite preview`, in a
// locally installed Chrome with a fresh temporary profile (playwright-core, no browser download):
// - the landing page `/`: what it downloads before any interaction (no auditorium code, no three.js,
//   no film), first and largest paint, layout shift, what hovering "Bước vào rạp" fetches, the time
//   from the click to a ready room (after a hover, and straight away), cold and warm cache, the page
//   without JavaScript, and the metadata of both HTML documents;
// - bundle: every file in dist/assets with raw, gzip and brotli sizes, and which ones the first
//   screen needs (the entry) versus the 3D part (loaded right after);
// - hosting: vercel.json read the way Vercel applies it, against dist/ (pages, missing files, cache
//   headers); a configuration check only, the deployment itself is checked by hand;
// - routes: /cinema opened directly and refreshed, /, the seat inspector, an unknown path, asset
//   and media MIME types, range requests on the film, dev-only fixtures absent and ignored;
// - time to a usable page (tasks and seat map on screen) and to a ready 3D scene, with the bytes
//   transferred by then, on the local machine and with a throttled connection;
// - the film's requests and bytes before Play (and that reading stops while idle), 4 s after Play
//   and after the end.
// Writes artifacts/<CAPTURE_DIR or prompt-10>/build-metrics.json and prints a summary.
//
//   yarn build && node scripts/measure-build.mjs

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-10');
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

const result = { generatedAt: new Date().toISOString(), checks: [], bundle: null, routes: {}, landing: { cold: [], warm: null, noScript: null, metadata: null }, timing: [], network: null };
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
    // The three films, their posters and the film list's stills.
    media: await Promise.all((await readdir(path.join(dist, 'media'))).sort().map(async (name) => ({ name, bytes: (await stat(path.join(dist, 'media', name))).size }))),
    fixturesInDist: existsSync(path.join(dist, 'fixtures')),
  };
}

/**
 * vercel.json against dist/, in the phases of Vercel's routing (Build Output API): routes before
 * `{ handle: 'filesystem' }` run on every request, 404s included; a file that exists is served and
 * the `hit` routes run; otherwise the routes after `filesystem` may rewrite to a file; else 404 (and
 * the `error` routes). `headers` and `rewrites` compile the way `vercel build` shows: headers before
 * the filesystem, rewrites after it. Says nothing about the deployment itself.
 */
async function hostingRules() {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const routes = config.routes ?? [
    ...(config.headers ?? []).map((rule) => ({ src: `^${rule.source}$`, headers: Object.fromEntries(rule.headers.map((h) => [h.key, h.value])), continue: true })),
    { handle: 'filesystem' },
    ...(config.rewrites ?? []).map((rule) => ({ src: `^${rule.source}$`, dest: rule.destination })),
  ];
  const phases = { before: [] };
  let phase = 'before';
  for (const route of routes) {
    if (route.handle) phases[(phase = route.handle)] ??= [];
    else phases[phase].push(route);
  }
  const isFile = (pathname) => statSync(path.join(dist, pathname), { throwIfNoEntry: false })?.isFile() ?? false;
  const headersOf = (list = [], pathname) => Object.assign({}, ...list.filter((r) => r.headers && new RegExp(r.src).test(pathname)).map((r) => r.headers));
  const serve = (pathname) => {
    const own = pathname === '/' ? '/index.html' : pathname;
    const file = isFile(own) ? own : (phases.filesystem ?? []).find((r) => r.dest && new RegExp(r.src).test(pathname))?.dest;
    const found = Boolean(file && isFile(file));
    const headers = { ...headersOf(phases.before, pathname), ...headersOf(found ? phases.hit : phases.error, pathname) };
    return { status: found ? 200 : 404, file: found ? file : null, cache: Object.entries(headers).find(([key]) => key.toLowerCase() === 'cache-control')?.[1] ?? 'default' };
  };
  const entry = /<script type="module"[^>]*src="(\/assets\/[^"]+)"/.exec(await readFile(path.join(dist, 'index.html'), 'utf8'))?.[1];
  const table = (paths) => Object.fromEntries(paths.map((p) => [p, serve(p).status === 200 ? serve(p).file : 404]));
  const caches = (paths) => Object.fromEntries(paths.map((p) => [p, serve(p).cache]));
  const missing = ['/assets/khong-co.js', '/brand/khong-co.webp', '/media/khong-co.mp4', '/favicon.ico', '/robots.txt'];
  return {
    pages: table(['/', '/cinema', '/cinema/', '/khong-co-trang-nay', '/cinema/khong-co']),
    missing: table(missing),
    files: table([entry, FILM, '/brand/portal-hero-960.webp', '/favicon.png', '/cinema.html', '/index.html']),
    destinationsExist: routes.filter((r) => r.dest).every((r) => isFile(r.dest)),
    redirects: (config.redirects ?? []).length + routes.filter((r) => r.status >= 300 && r.status < 400).length,
    cache: {
      immutable: caches([entry]),
      noCache: caches(['/', '/cinema', '/cinema/', '/index.html', '/cinema.html', '/favicon.png']),
      revalidated: caches([FILM, '/media/big-buck-bunny-trailer-poster.jpg', '/brand/portal-hero-960.webp']),
      missing: caches(missing),
    },
  };
}

// Marks when the page's own controls exist (usable) and when the scene is ready.
/** Landing page: paints, layout shift, and when the first "Bước vào rạp" click happened. */
const LANDING_MARKS = () => {
  window.__landing = { fcp: null, lcp: null, lcpElement: null, cls: 0, clickAt: null };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') window.__landing.fcp = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1);
    window.__landing.lcp = last.startTime;
    window.__landing.lcpElement = last.element ? `${last.element.tagName.toLowerCase()}.${last.element.className}` : null;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__landing.cls += entry.value;
  }).observe({ type: 'layout-shift', buffered: true });
  document.addEventListener('click', (event) => {
    if (window.__landing.clickAt === null && event.target.closest?.('a[data-cta]')) window.__landing.clickAt = performance.now();
  }, true);
};

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
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing: run `yarn build` first.');
  await mkdir(outDir, { recursive: true });
  result.bundle = await bundle();
  check('bundle: dev fixtures are not in dist/', !result.bundle.fixturesInDist);
  const hosting = (result.hosting = await hostingRules());
  const all = (table, test) => Object.entries(table).every(([p, value]) => test(value, p));
  check('hosting (vercel.json, config only): /, /cinema, /cinema/ and unknown pages get their HTML document', hosting.pages['/'] === '/index.html' && hosting.pages['/cinema'] === '/cinema.html' && hosting.pages['/cinema/'] === '/cinema.html' && hosting.pages['/khong-co-trang-nay'] === '/index.html' && hosting.pages['/cinema/khong-co'] === '/index.html', hosting.pages);
  check('hosting (vercel.json, config only): a missing asset, image, video or file is a 404, not the landing page', all(hosting.missing, (v) => v === 404), hosting.missing);
  check('hosting (vercel.json, config only): existing files are served as they are; rewrites point at files; no redirects', all(hosting.files, (v, p) => v === p) && hosting.destinationsExist && hosting.redirects === 0, { files: hosting.files, destinationsExist: hosting.destinationsExist, redirects: hosting.redirects });
  check('hosting (vercel.json, config only): hashed assets immutable, HTML no-cache, media and brand images revalidated (Vercel default)', all(hosting.cache.immutable, (v) => /immutable/.test(v)) && all(hosting.cache.noCache, (v) => v === 'no-cache') && all(hosting.cache.revalidated, (v) => v === 'default'), hosting.cache);
  check('hosting (vercel.json, config only): a 404 is never cached long (no immutable on missing files, /assets included)', all(hosting.cache.missing, (v) => !/immutable|max-age=[1-9]/.test(v)), hosting.cache.missing);

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
      await page.waitForSelector('[data-landing] .hero');
      check('routes: / is the landing page (no redirect)', new URL(page.url()).pathname === '/' && (await page.evaluate(() => document.documentElement.dataset.route)) === 'landing', page.url());
      await page.goto(`${base}/cinema/`);
      await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
      check('routes: /cinema/ (trailing slash) opens the auditorium too', (await page.title()).includes('Phòng chiếu 3D'), page.url());
      await page.goto(`${base}/cinema?inspect=seat`);
      await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready', null, { timeout: 60_000 });
      check('routes: the seat inspector loads in production', true);
      await page.goto(`${base}/khong-co-trang-nay`);
      check('routes: an unknown path shows the not-found page', (await page.textContent('h1')) === 'Không tìm thấy trang');
      result.routes = { assets: types, film: filmHead, fixture };
      await context.close();
    }

    // The landing page, cold (cache off): first paint, largest paint, layout shift, what it fetches
    // before any interaction; then a hover (intent preload) and the click, to a ready room.
    const typeOf = (name) => (/\.js$/.test(name) ? 'js' : /\.css$/.test(name) ? 'css' : /\.(webp|jpg|png|svg)$/.test(name) ? 'image' : /\.mp4$/.test(name) ? 'media' : 'other');
    for (const throttle of [null, THROTTLED]) {
      for (const way of ['hover then click', 'click at once']) {
        for (let run = 0; run < 2; run++) {
          const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
          await context.addInitScript(LANDING_MARKS);
          await context.addInitScript(MARKS);
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          if (throttle) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: throttle.latency, downloadThroughput: throttle.down, uploadThroughput: throttle.up });
          await page.goto(`${base}/`, { waitUntil: 'load' });
          await page.waitForTimeout(throttle ? 4000 : 1500);
          const resources = () =>
            page.evaluate(() => {
              const nav = performance.getEntriesByType('navigation')[0];
              return [{ name: '/', transfer: nav.transferSize, end: nav.responseEnd }, ...performance.getEntriesByType('resource').map((r) => ({ name: new URL(r.name).pathname, transfer: r.transferSize, end: r.responseEnd }))];
            });
          const before = await resources();
          const paints = await page.evaluate(() => ({ ...window.__landing }));
          if (way === 'hover then click') {
            await page.hover('.hero a[data-cta]');
            await page.waitForFunction(() => performance.getEntriesByType('resource').some((r) => /\/assets\/seats-/.test(r.name) && r.responseEnd > 0), null, { timeout: 60_000 });
            await page.waitForTimeout(300);
            await page.click('.hero a[data-cta]');
          } else {
            // A click with no hover, focus or press first (keyboard-less, pointer-less): no intent preload.
            await page.evaluate(() => document.querySelector('.hero a[data-cta]').click());
          }
          await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 120_000 });
          const after = await resources();
          const marks = await page.evaluate(() => ({ clickAt: window.__landing.clickAt, ready: window.__marks.ready }));
          const sum = (list, filter = () => true) => list.filter(filter).reduce((n, r) => n + r.transfer, 0);
          const byType = (list) => Object.fromEntries(['js', 'css', 'image', 'media', 'other'].map((t) => [t, sum(list, (r) => typeOf(r.name) === t)]));
          const hoverAdded = after.filter((r) => !before.some((b) => b.name === r.name));
          result.landing.cold.push({
            network: throttle?.name ?? 'máy cục bộ, không giới hạn',
            way,
            run,
            fcpMs: Math.round(paints.fcp),
            lcpMs: Math.round(paints.lcp),
            lcpElement: paints.lcpElement,
            cls: Number(paints.cls.toFixed(4)),
            beforeInteraction: { total: sum(before), ...byType(before), files: before.map((r) => `${r.name} ${r.transfer}`) },
            clickToReadyMs: Math.round(marks.ready - marks.clickAt),
            addedByEntering: { total: sum(hoverAdded), files: hoverAdded.map((r) => `${r.name} ${r.transfer}`) },
          });
          await context.close();
        }
      }
    }
    {
      const cold = result.landing.cold;
      const leaks = cold.flatMap((c) => c.beforeInteraction.files).filter((f) => /\/assets\/(seats|view|page|ui|cameraPresets|seatInspector)-|\/media\//.test(f));
      check('landing (production): nothing of the auditorium, three.js or the film is downloaded before an interaction', leaks.length === 0, leaks);
      // Chrome does not count an image larger than the viewport (a backdrop) as the largest paint, so
      // the hero's heading is the expected one.
      check('landing (production): layout shift ≤ 0.02 while loading; the largest paint is the hero heading, within 2.5 s even on the throttled link', cold.every((c) => c.cls <= 0.02) && cold.every((c) => /^h1|hero/.test(c.lcpElement ?? '') && c.lcpMs <= 2500), cold.map((c) => ({ cls: c.cls, lcp: c.lcpElement, ms: c.lcpMs })));
    }

    // Warm cache: a second visit to each page in the same browser profile.
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const visit = async (url, ready) => {
        await page.goto(`${base}${url}`);
        await page.waitForFunction(ready, null, { timeout: 60_000 });
        await page.waitForTimeout(800);
        return page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const list = performance.getEntriesByType('resource');
          return { total: nav.transferSize + list.reduce((n, r) => n + r.transferSize, 0), fromCache: list.filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length, files: list.length };
        });
      };
      const landingReady = () => Boolean(document.querySelector('[data-landing] .hero'));
      const cinemaReady = () => document.querySelector('.cinema-app')?.dataset.status === 'ready';
      result.landing.warm = {
        landingCold: await visit('/', landingReady),
        landingWarm: await visit('/', landingReady),
        cinemaAfterLanding: await visit('/cinema', cinemaReady),
        cinemaWarm: await visit('/cinema', cinemaReady),
      };
      await context.close();
    }

    // Without JavaScript: the landing page still reads and links; /cinema says what it needs.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`${base}/`);
      await page.waitForLoadState('load');
      const landing = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent,
        cta: [...document.querySelectorAll('a[data-cta]')].map((a) => a.getAttribute('href')),
        sections: [...document.querySelectorAll('section h2')].map((h) => h.textContent),
        note: document.querySelector('.noscript-note') !== null || /cần JavaScript/.test(document.body.innerText),
        image: document.querySelector('.hero__image')?.naturalWidth > 0,
        styled: getComputedStyle(document.querySelector('.hero h1')).fontWeight >= 600 && parseFloat(getComputedStyle(document.querySelector('.hero h1')).fontSize) >= 28,
      }));
      await page.screenshot({ path: path.join(outDir, 'landing-no-javascript.png'), fullPage: false });
      await page.goto(`${base}/cinema`);
      const cinema = await page.evaluate(() => ({ text: document.body.innerText, home: Boolean(document.querySelector('a[href="/"]')) }));
      result.landing.noScript = { landing, cinema: { home: cinema.home, mentionsJs: /JavaScript/.test(cinema.text) } };
      check('without JavaScript: / shows the hero, "Trải nghiệm" and the invitation (their headings), real links to /cinema, styled, with a note; /cinema says it needs JavaScript and links back', landing.h1?.includes('Một chỗ ngồi') && landing.cta.length === 3 && landing.cta.every((h) => h === '/cinema') && landing.sections.length === 2 && landing.note && landing.image && landing.styled && cinema.home && /JavaScript/.test(cinema.text), result.landing.noScript);
      await context.close();
    }

    // Metadata in the HTML documents themselves (what crawlers that run no script read).
    {
      const read = async (file) => {
        const html = await readFile(path.join(dist, file), 'utf8');
        const meta = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1] ?? null;
        return {
          title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
          description: meta('name', 'description'),
          canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null,
          ogTitle: meta('property', 'og:title'),
          ogImage: meta('property', 'og:image'),
          lang: /<html lang="([^"]*)"/.exec(html)?.[1] ?? null,
          icon: /<link rel="icon" href="([^"]*)"/.exec(html)?.[1] ?? null,
        };
      };
      const index = await read('index.html');
      const cinema = await read('cinema.html');
      const imageFile = index.ogImage ? path.join(dist, new URL(index.ogImage).pathname) : '';
      result.landing.metadata = { index, cinema, shareImageInDist: existsSync(imageFile) };
      check('metadata: / and /cinema have their own title, description, canonical and share data in the HTML; lang vi; icon and share image shipped', index.title !== cinema.title && index.description && cinema.description && index.canonical?.endsWith('/') && cinema.canonical?.endsWith('/cinema') && index.ogImage && index.lang === 'vi' && cinema.lang === 'vi' && existsSync(path.join(dist, 'favicon.png')) && result.landing.metadata.shareImageInDist, result.landing.metadata);
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
      // Left alone for 5 s more: the read-ahead has stopped (preload="metadata", not "auto").
      await page.waitForTimeout(5000);
      const idle = snapshot();
      const metadata = await page.evaluate(() => document.querySelector('.cinema-player__time')?.textContent);
      await page.click('button[data-task="watch"]');
      await page.click('button[data-action="media-primary"]');
      await page.waitForFunction(() => document.querySelector('.cinema-player')?.dataset.state === 'playing', null, { timeout: 30_000 });
      await page.waitForTimeout(4000);
      const playing = snapshot();
      await page.waitForFunction(() => document.querySelector('.cinema-player')?.dataset.state === 'ended', null, { timeout: 60_000 });
      const ended = snapshot();
      const fileBytes = (await stat(path.join(dist, FILM))).size;
      result.network = { fileBytes, durationShownBeforePlay: metadata, beforePlay: sum(before), idleBeforePlay: sum(idle), afterPlay4s: sum(playing), afterEnd: sum(ended), requests: { before, playing, ended } };
      // preload="metadata": Chrome still reads a fixed stretch from the start of the file, then stops.
      // Measured 0.96–1.84 MB (11–22 %) over 9 cold runs in Prompts 08–10 (Chrome 156, local preview,
      // cache off), 1–2 requests; see docs/release-audit-prompt-10.md. 25 % keeps the
      // regressions this guards against in view: the fragmented MP4 of Prompt 07 (7–10 requests,
      // 40–50 %) and preload="auto" (reading on); the second check catches reading that does not stop.
      check('film: before Play only the poster and the start of the film are fetched (≤ 2 requests, ≤ 25 % of the file)', result.network.beforePlay.requests <= 2 && result.network.beforePlay.bytes <= fileBytes * 0.25 && result.network.beforePlay.poster === 1, result.network.beforePlay);
      const others = idle.filter((r) => r.path !== FILM && r.path !== '/media/big-buck-bunny-trailer-poster.jpg').map((r) => r.path);
      check('film: the other two films (files, posters, stills of the film list) are not fetched before they are chosen', others.length === 0, others);
      check('film: before Play, reading stops (no more bytes over 5 s left alone)', result.network.idleBeforePlay.bytes === result.network.beforePlay.bytes && result.network.idleBeforePlay.requests === result.network.beforePlay.requests, { at3s: result.network.beforePlay, at8s: result.network.idleBeforePlay });
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
  console.log('Landing:', JSON.stringify(result.landing.cold.map((c) => ({ network: c.network.slice(0, 12), way: c.way, fcp: c.fcpMs, lcp: c.lcpMs, cls: c.cls, before: c.beforeInteraction.total, js: c.beforeInteraction.js, image: c.beforeInteraction.image, clickToReady: c.clickToReadyMs, added: c.addedByEntering.total })), null, 1));
  console.log('Warm cache:', JSON.stringify(result.landing.warm));
  console.log('Film:', JSON.stringify({ before: result.network.beforePlay, after4s: result.network.afterPlay4s, end: result.network.afterEnd, file: result.network.fileBytes }));
  const failed = result.checks.filter((c) => !c.passed).length;
  console.log(`\n${result.checks.length - failed} passed, ${failed} failed → ${path.relative(root, path.join(outDir, 'build-metrics.json'))}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
