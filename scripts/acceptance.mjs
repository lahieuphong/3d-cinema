// Acceptance flows on the production build (Prompt 10 §9): the paths a visitor takes, through the
// page's own controls only (the build has no development hooks), in a locally installed Chrome
// with a fresh temporary profile (playwright-core, no browser download).
//
// - Default: `vite preview` of dist/ (run `npm run build` first).
// - A deployment: BASE_URL=https://… node scripts/acceptance.mjs. Adds the hosting checks (status
//   codes, types, cache headers, missing files, ranges, canonical) and whether the deployment serves
//   the same build as the local dist/ (same hashed file names). A protected Vercel preview needs
//   the project's automation bypass secret in VERCEL_PROTECTION_BYPASS (or
//   VERCEL_AUTOMATION_BYPASS_SECRET, as the Vercel CLI calls it), sent as a request header and
//   never written out. ACCEPTANCE_ONLY=hosting skips the browser flows.
//
// Writes artifacts/<CAPTURE_DIR or prompt-10>/acceptance/report.json and a few screenshots.
//
//   npm run build && npm run acceptance

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-10', 'acceptance');
const FILM = '/media/big-buck-bunny-trailer-720p.mp4';
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const bypass = process.env.VERCEL_PROTECTION_BYPASS ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// Sent with every request (fetch, and the browser's extraHTTPHeaders), so no bypass cookie is needed;
// asking for one (x-vercel-set-bypass-cookie) makes Vercel answer with a redirect first.
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
// As in capture-views.mjs: ANGLE's D3D shader compiler notes float constant folding (X4122), which
// three.js prints as a warning after a successful link. A driver note, not a shader error.
const KNOWN_DRIVER_WARNING = /WebGLProgram: Program Info Log:[\s\S]*warning X4122/;

const report = { generatedAt: new Date().toISOString(), base: null, deployed: false, browser: null, checks: [], flows: {}, hosting: null, console: [] };
function check(name, passed, detail) {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const ready = (page, timeout = 60_000) => page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout });
const appState = (page) => page.evaluate(() => ({ ...(document.querySelector('.cinema-app')?.dataset ?? {}) }));
const waitApp = (page, key, values, timeout = 15_000) =>
  page.waitForFunction(([k, v]) => v.includes(document.querySelector('.cinema-app')?.dataset[k]), [key, values], { timeout });
const waitPlayer = (page, states, timeout = 30_000) =>
  page.waitForFunction((s) => s.includes(document.querySelector('.cinema-player')?.dataset.state), states, { timeout });
const playerState = (page) => page.getAttribute('.cinema-player', 'data-state');
const canvases = (page) => page.evaluate(() => document.querySelectorAll('canvas').length);
const pressed = (page, id) => page.getAttribute(`button[data-seat="${id}"]`, 'aria-pressed');
const overflows = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const route = (page) => page.evaluate(() => document.documentElement.dataset.route);
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
/** Phones (Prompt 13): the controls are in the control hub; this opens it. */
const openHub = async (page) => {
  if ((await page.getAttribute('.cinema-hub__toggle', 'aria-expanded')) !== 'true') await page.tap('.cinema-hub__toggle');
  await page.waitForSelector('#cinema-hub-panel:not([hidden])');
};
/** Phones: a task chosen at the top of the hub's panel (opened for it). */
const hubTask = async (page, task) => {
  await openHub(page);
  if ((await page.getAttribute(`.cinema-hub button[data-task="${task}"]`, 'aria-pressed')) !== 'true') await page.tap(`.cinema-hub button[data-task="${task}"]`);
  await waitApp(page, 'task', [task]);
};
/** Desktop: a task from the task bar over the room (Khám phá, Chọn ghế, Xem phim). */
const useTask = async (page, task) => {
  if ((await page.getAttribute(`.cinema-taskbar button[data-task="${task}"]`, 'aria-pressed')) !== 'true') await page.click(`.cinema-taskbar button[data-task="${task}"]`);
  await waitApp(page, 'task', [task]);
};
/** Desktop: the player's controls, in Xem phim. */
const PLAY = '.cinema-taskbar button[data-action="media-primary"]';
const MUTE = '.cinema-taskbar button[data-action="media-mute"]';
/** Desktop: "Cài đặt" (display, help, the way home). */
const openPanel = async (page) => {
  if ((await page.getAttribute('button[data-action="settings"]', 'aria-expanded')) !== 'true') await page.click('button[data-action="settings"]');
  await page.waitForSelector('#cinema-hub-panel:not([hidden])');
};
const closePanel = async (page) => {
  if (await page.isHidden('#cinema-hub-panel')) return;
  await page.keyboard.press('Escape');
  await page.waitForSelector('#cinema-hub-panel', { state: 'hidden' });
};
/** Desktop: Chọn ghế opens the map beside the room ("Sơ đồ ghế" if it was closed). */
const openSeatMap = async (page) => {
  await useTask(page, 'seats');
  if ((await page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded')) !== 'true') await page.click('.cinema-taskbar button[data-action="seat-panel"]');
  await page.waitForSelector('#cinema-seat-panel:not([hidden])');
};
/** Desktop: a control of Khám phá (a camera move, the tour, walking…). */
const exploreAction = async (page, selector) => {
  await useTask(page, 'explore');
  await page.click(`.cinema-taskbar ${selector}`);
};

async function newPage(browser, flow, options = {}, expected = []) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: headers, ...options });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    const known = message.type() === 'warning' && KNOWN_DRIVER_WARNING.test(text);
    report.console.push({ flow, type: message.type(), text, expected: known || expected.some((pattern) => pattern.test(text)) });
  });
  page.on('pageerror', (error) => report.console.push({ flow, type: 'pageerror', text: String(error), expected: false }));
  return { context, page };
}

/** Live instances of a constructor after a full GC (Chrome DevTools Protocol), and the JS heap. */
async function live(page, names) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const counts = {};
  for (const name of names) {
    const { result: proto } = await cdp.send('Runtime.evaluate', { expression: `${name}.prototype` });
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    counts[name] = result.value;
  }
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return { ...counts, heapMiB: +(usedSize / 2 ** 20).toFixed(2) };
}

/** The first "Bước vào rạp" of the hero. */
const HERO_CTA = '.hero a[data-cta="cinema"]';

async function flows(browser, base) {
  // A. Landing → cinema → pick a seat → seat view → play / pause → back.
  {
    const { context, page } = await newPage(browser, 'landing-to-film');
    await page.goto(`${base}/`);
    await page.waitForSelector('[data-landing] .hero');
    const early = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname).filter((p) => /\/assets\/(page|ui|cameraPresets|view|seats)-|\/media\//.test(p)),
    );
    const historyBefore = await page.evaluate(() => history.length);
    await page.hover(HERO_CTA);
    await page.click(HERO_CTA);
    await ready(page);
    const entered = { path: new URL(page.url()).pathname, historyAdded: (await page.evaluate(() => history.length)) - historyBefore, canvases: await canvases(page) };
    await openSeatMap(page);
    await page.click('button[data-seat="F06"]');
    const picked = await pressed(page, 'F06');
    await page.click('button[data-action="view-from-seat"]');
    await waitApp(page, 'camera', ['seat']);
    await useTask(page, 'watch');
    await page.click(PLAY);
    await waitPlayer(page, ['playing']);
    await page.waitForTimeout(2500);
    const time = await page.textContent('.cinema-player__time');
    await page.click(PLAY);
    await waitPlayer(page, ['paused']);
    await shot(page, 'a-seat-view-paused');
    await page.click('button[data-action="return"]');
    await waitApp(page, 'camera', ['preset']);
    const end = await appState(page);
    report.flows.landingToFilm = { early, entered, picked, time, end: { camera: end.camera, preset: end.preset } };
    check('A. landing fetches no auditorium code or film; "Bước vào rạp" opens /cinema with one history entry and one canvas', early.length === 0 && entered.path === '/cinema' && entered.historyAdded === 1 && entered.canvases === 1, { early, entered });
    check('A. F06 picked on the map, seen from its seat, the film plays and pauses; "Trở về" back to a preset with F06 kept', picked === 'true' && !/^0:00/.test(time ?? '') && end.camera === 'preset' && (await pressed(page, 'F06')) === 'true', report.flows.landingToFilm);
    await context.close();
  }

  // O. A seat picked in the 3D view (not the map), then the film's sound off and on. The build has no
  // hook for seat positions, so the click tries a few points over the rows until one picks a seat.
  {
    const { context, page } = await newPage(browser, 'pick-3d-and-mute');
    await page.goto(`${base}/cinema`);
    await ready(page);
    await openSeatMap(page);
    await page.waitForTimeout(800);
    const chosen = () => page.$$eval('button[data-seat][aria-pressed="true"]', (seats) => seats.map((s) => s.dataset.seat));
    const box = await page.locator('canvas').boundingBox();
    const panel = await page.locator('#cinema-seat-panel').boundingBox();
    const right = panel && panel.x > box.x ? panel.x : box.x + box.width;
    let picked = null;
    let tries = 0;
    for (const fy of [0.72, 0.8, 0.64, 0.88]) {
      for (const fx of [0.5, 0.38, 0.62, 0.3]) {
        if (picked) break;
        tries++;
        const before = await chosen();
        await page.mouse.click(box.x + (right - box.x) * fx, box.y + box.height * fy);
        await page.waitForTimeout(250);
        picked = (await chosen()).find((id) => !before.includes(id)) ?? null;
      }
    }
    await useTask(page, 'watch');
    await page.click(PLAY);
    await waitPlayer(page, ['playing']);
    const muted = [];
    for (let i = 0; i < 2; i++) {
      await page.click(MUTE);
      await page.waitForTimeout(200);
      muted.push(await page.getAttribute('.cinema-player', 'data-muted'));
    }
    const still = await playerState(page);
    await page.click(PLAY);
    await waitPlayer(page, ['paused']);
    report.flows.pick3dAndMute = { picked, tries, muted, playingWhileMuting: still };
    check('O. a seat picked by clicking it in the 3D view is selected on the map too; the film\'s sound goes off and on while it plays', Boolean(picked) && muted[0] === 'true' && muted[1] === 'false' && still === 'playing', report.flows.pick3dAndMute);
    await context.close();
  }

  // B. Tour → stop → walk (explore) → open the map.
  {
    const { context, page } = await newPage(browser, 'tour-explore-map');
    await page.goto(`${base}/cinema`);
    await ready(page);
    await exploreAction(page, 'button[data-action="tour"]');
    await waitApp(page, 'tour', ['playing']);
    await page.waitForTimeout(1500);
    if (await page.isVisible('button[data-action="tour-stop"]')) await page.click('button[data-action="tour-stop"]');
    else await page.keyboard.press('KeyW');
    await waitApp(page, 'tour', ['off']);
    await exploreAction(page, 'button[data-action="explore"]');
    await waitApp(page, 'camera', ['explore']);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    const walking = await appState(page);
    await openSeatMap(page);
    const map = await appState(page);
    await shot(page, 'b-explore-then-map');
    report.flows.tourExploreMap = { walking: { camera: walking.camera, tour: walking.tour }, map: { task: map.task, panel: map.panel, canvases: await canvases(page) } };
    check('B. the tour stops on request, "Đi bộ" walks, then Chọn ghế opens the map; one canvas', walking.tour === 'off' && walking.camera === 'explore' && map.task === 'seats' && map.panel !== 'closed' && (await canvases(page)) === 1, report.flows.tourExploreMap);
    await context.close();
  }

  // C. Phone portrait → landscape; D. the full-screen map on a phone: Escape and focus.
  {
    const { context, page } = await newPage(browser, 'phone', PHONE);
    await page.goto(`${base}/cinema`);
    await ready(page);
    const fit = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const a = canvas.getBoundingClientRect();
        const b = canvas.parentElement.getBoundingClientRect();
        return { canvases: document.querySelectorAll('canvas').length, fills: Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2, buffer: canvas.width > 0 && Math.abs(canvas.width / canvas.height - a.width / a.height) < 0.02 };
      });
    const portrait = { ...(await fit()), overflow: await overflows(page) };
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(800);
    const landscape = { ...(await fit()), overflow: await overflows(page), status: (await appState(page)).status };
    await shot(page, 'c-phone-landscape');
    report.flows.rotate = { portrait, landscape };
    check('C. phone portrait → landscape: one canvas that fills its place, drawing buffer follows, no sideways scroll', [portrait, landscape].every((s) => s.canvases === 1 && s.fills && s.buffer && !s.overflow) && landscape.status === 'ready', report.flows.rotate);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    // Chọn ghế in the control hub, then "Mở sơ đồ": on a phone it opens the full-screen map.
    await hubTask(page, 'seats');
    await page.tap('.cinema-hub button[data-action="seat-panel"]');
    await waitApp(page, 'panel', ['expanded']);
    const modal = await page.evaluate(() => ({ inert: document.querySelectorAll('[inert]').length, focusInside: Boolean(document.activeElement?.closest('#cinema-seat-panel')) }));
    await shot(page, 'd-phone-map-full-screen');
    const steps = [];
    for (let i = 0; i < 3 && (await appState(page)).panel !== 'closed'; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      steps.push((await appState(page)).panel);
    }
    const after = await page.evaluate(() => ({ focus: document.activeElement?.dataset.action ?? document.activeElement?.tagName, inert: document.querySelectorAll('[inert]').length }));
    report.flows.phoneMap = { modal, steps, after };
    check('D. phone: Chọn ghế → "Mở sơ đồ" in the control hub opens the full-screen map, modal (rest inert, focus inside); Escape closes it, focus returns to the hub\'s button, nothing left inert', modal.inert > 0 && modal.focusInside && steps.at(-1) === 'closed' && after.focus === 'hub' && after.inert === 0, report.flows.phoneMap);
    await context.close();
  }

  // E. Quality; F. context loss and restore; G. the inspector and back.
  {
    const { context, page } = await newPage(browser, 'quality-context-inspector', {}, [/WebGL: CONTEXT_LOST_WEBGL/i]);
    await page.goto(`${base}/cinema`);
    await ready(page);
    await openSeatMap(page);
    await page.click('button[data-seat="F05"]');
    await openPanel(page);
    await page.click('button[data-quality="economy"]');
    await ready(page);
    const economy = await page.getAttribute('button[data-quality="economy"]', 'aria-pressed');
    await closePanel(page);
    check('E. switching to Tiết kiệm applies at once, scene ready, one canvas', economy === 'true' && (await canvases(page)) === 1, { economy });

    await page.evaluate(() => {
      window.__lose = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await waitApp(page, 'status', ['context-lost']);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__lose.restoreContext());
    await ready(page, 20_000);
    const restored = { canvases: await canvases(page), seat: await pressed(page, 'F05'), economy: await page.getAttribute('button[data-quality="economy"]', 'aria-pressed') };
    report.flows.contextRestore = restored;
    check('F. context lost is reported, then restored: ready, one canvas, F05 and Tiết kiệm kept', restored.canvases === 1 && restored.seat === 'true' && restored.economy === 'true', restored);

    await openPanel(page);
    if (!(await page.isVisible('button[data-action="open-inspector"]'))) await page.click('button[data-action="inspect-tools"]');
    await page.click('button[data-action="open-inspector"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready', null, { timeout: 60_000 });
    const inspector = { url: new URL(page.url()).search, canvases: await canvases(page) };
    await shot(page, 'g-inspector');
    await page.goBack();
    await ready(page);
    const back = { canvases: await canvases(page), seat: await pressed(page, 'F05') };
    report.flows.inspector = { inspector, back };
    check('G. the seat inspector opens (?inspect=seat, one canvas) and Back returns to the room with F05 kept', inspector.url === '?inspect=seat' && inspector.canvases === 1 && back.canvases === 1 && back.seat === 'true', report.flows.inspector);
    await context.close();
  }

  // H. Leaving while the film plays; I. Back / Forward between landing and room, several times.
  {
    const { context, page } = await newPage(browser, 'leave-and-return');
    await page.goto(`${base}/`);
    await page.click(HERO_CTA);
    await ready(page);
    await useTask(page, 'watch');
    await page.click(PLAY);
    await waitPlayer(page, ['playing']);
    await page.waitForTimeout(1500);
    await page.click('a.cinema-brand');
    await page.waitForSelector('[data-landing] .hero');
    const left = { route: await route(page), canvases: await canvases(page), ...(await live(page, ['HTMLVideoElement', 'HTMLCanvasElement', 'WebGL2RenderingContext'])) };
    check('H. leaving the room while the film plays: on the landing page no video, canvas or WebGL context is alive (after GC)', left.route === 'landing' && left.HTMLVideoElement === 0 && left.HTMLCanvasElement === 0 && left.WebGL2RenderingContext === 0, left);

    // The brand link added an entry: Back returns to the room, Forward to the landing page.
    const rounds = [];
    for (let i = 0; i < 4; i++) {
      await page.goBack();
      await ready(page);
      const room = { canvases: await canvases(page), film: await playerState(page) };
      await page.goForward();
      await page.waitForSelector('[data-landing] .hero');
      rounds.push({ room, landing: await live(page, ['HTMLVideoElement', 'HTMLCanvasElement', 'WebGL2RenderingContext']) });
    }
    report.flows.leaveAndReturn = { left, rounds };
    const growth = rounds.at(-1).landing.heapMiB - rounds[0].landing.heapMiB;
    check('I. 4 × Back/Forward: the room has one canvas and the film is not playing; the landing page keeps nothing alive; heap after GC grows < 1 MiB', rounds.every((r) => r.room.canvases === 1 && r.room.film !== 'playing' && r.landing.HTMLVideoElement === 0 && r.landing.HTMLCanvasElement === 0 && r.landing.WebGL2RenderingContext === 0) && growth < 1, { growthMiB: +growth.toFixed(2), rounds });
    await context.close();
  }

  // J. Reduced motion.
  {
    const { context, page } = await newPage(browser, 'reduced-motion', { reducedMotion: 'reduce' });
    await page.goto(`${base}/`);
    await page.waitForSelector('[data-landing] .hero');
    const motion = await page.getAttribute('.hero', 'data-motion');
    await page.click(HERO_CTA);
    await ready(page);
    await exploreAction(page, 'button[data-action="tour"]');
    await waitApp(page, 'tour', ['steps', 'playing']);
    const tour = (await appState(page)).tour;
    report.flows.reducedMotion = { landingMotion: motion, tour };
    check('J. reduced motion: no parallax on the landing page; the tour goes stop by stop', motion === 'off' && tour === 'steps', report.flows.reducedMotion);
    await context.close();
  }

  // K. The landing page without JavaScript.
  {
    const { context, page } = await newPage(browser, 'no-javascript', { javaScriptEnabled: false });
    await page.goto(`${base}/`);
    const content = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim(),
      ctas: [...document.querySelectorAll('a[data-cta]')].map((a) => a.getAttribute('href')),
      steps: document.querySelectorAll('#cach-su-dung h3').length,
      heroImage: Boolean(document.querySelector('.hero img')?.currentSrc || document.querySelector('.hero img')?.src),
    }));
    await shot(page, 'k-landing-no-javascript');
    report.flows.noJavaScript = content;
    check('K. without JavaScript the landing page has its heading, three links to /cinema, the three steps and the hero picture', /Bước vào rạp/.test(content.h1 ?? '') && content.ctas.length === 3 && content.ctas.every((href) => href === '/cinema') && content.steps === 3 && content.heroImage, content);
    await context.close();
  }

  // L. No WebGL: the map and the film in 2D.
  {
    const { context, page } = await newPage(browser, 'no-webgl', PHONE, [/Error creating WebGL context/, /Could not start the 3D view/]);
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    await page.goto(`${base}/cinema`);
    await waitApp(page, 'status', ['error'], 30_000);
    const task = (await appState(page)).task;
    // The reason stays on screen; the map and the player are in the control hub (Chọn ghế already).
    const reason = await page.isVisible('.cinema-status');
    await hubTask(page, 'seats');
    await page.tap('.cinema-hub button[data-action="seat-panel"]');
    await waitApp(page, 'panel', ['expanded']);
    await page.tap('button[data-seat="F04"]');
    const seat = await pressed(page, 'F04');
    await page.tap('button[data-action="seat-panel-close"]');
    await waitApp(page, 'panel', ['closed']);
    await hubTask(page, 'watch');
    await page.tap('.cinema-hub button[data-action="media-primary"]');
    await waitPlayer(page, ['playing']);
    await page.waitForTimeout(1500);
    await page.tap('.cinema-hub button[data-action="media-primary"]');
    await waitPlayer(page, ['paused']);
    await shot(page, 'l-no-webgl-film-2d');
    report.flows.noWebgl = { task, reason, seat, canvases: await canvases(page) };
    check('L. no WebGL (phone): the reason stays on screen; from the control hub F04 is picked on the map and the film plays flat and pauses', task === 'seats' && reason && seat === 'true', report.flows.noWebgl);
    await context.close();
  }

  // M. The film cannot be loaded (404).
  {
    const { context, page } = await newPage(browser, 'film-error', {}, [/Failed to load resource.*404/]);
    await page.route(`**${FILM}`, (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto(`${base}/cinema`);
    await ready(page);
    await waitPlayer(page, ['error'], 30_000);
    const retry = await page.isVisible('button[data-action="media-retry"]');
    await useTask(page, 'watch');
    const primaryDisabled = await page.isDisabled(PLAY);
    await shot(page, 'm-film-error');
    report.flows.filmError = { retry, primaryDisabled };
    check('M. a film that cannot load: error state with "Thử lại", Play disabled, the room still ready', retry && primaryDisabled && (await appState(page)).status === 'ready', report.flows.filmError);
    await context.close();
  }

  // N. The auditorium code fails to download once: the error screen, then "Thử lại".
  {
    const { context, page } = await newPage(browser, 'code-fails', {}, [/Failed to load resource/, /Could not load the page/, /Failed to fetch dynamically imported module/]);
    // Every request fails until the error screen shows (the hover's preload may or may not share
    // the click's request); then the network is back and "Thử lại" asks again.
    let aborted = 0;
    let offline = true;
    await page.route(/\/assets\/page-[^/]+\.js$/, (r) => (offline ? (aborted++, r.abort('connectionreset')) : r.continue()));
    await page.goto(`${base}/`);
    await page.click(HERO_CTA);
    await page.waitForSelector('.route-status[data-state="error"]', { timeout: 30_000 });
    const message = await page.textContent('.route-status h1');
    await shot(page, 'n-code-failed');
    offline = false;
    await page.click('button[data-action="retry-page"]');
    await ready(page);
    report.flows.codeFails = { aborted, message, canvases: await canvases(page) };
    check('N. the room\'s code fails to download: "Không mở được phòng chiếu" with "Thử lại", which then opens the room (one canvas)', /Không mở được phòng chiếu/.test(message ?? '') && (await canvases(page)) === 1, report.flows.codeFails);
    await context.close();
  }
}

/** A deployment: what the server answers (a few single requests, no loops). */
async function hosting(base) {
  const get = async (pathname, extra = {}, method = 'GET') => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { ...headers, ...extra }, redirect: 'manual' });
    const body = method === 'GET' && /html/.test(response.headers.get('content-type') ?? '') ? await response.text() : (await response.arrayBuffer(), '');
    return {
      method,
      status: response.status,
      type: response.headers.get('content-type'),
      cache: response.headers.get('cache-control'),
      range: response.headers.get('content-range'),
      robots: response.headers.get('x-robots-tag'),
      edge: response.headers.get('x-vercel-cache'),
      title: /<title>([^<]*)/.exec(body)?.[1] ?? null,
      canonical: /<link rel="canonical" href="([^"]*)"/.exec(body)?.[1] ?? null,
      ogUrl: /<meta property="og:url" content="([^"]*)"/.exec(body)?.[1] ?? null,
      assets: [...body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).sort(),
    };
  };
  const pages = {};
  for (const p of ['/', '/cinema', '/cinema/', '/cinema?inspect=seat', '/?utm_source=test', '/khong-co-trang-nay']) pages[p] = await get(p);
  if ([401, 403].includes(pages['/'].status) || (pages['/'].status >= 300 && pages['/'].status < 400)) {
    check('hosting: the deployment answers without a login (protected? set VERCEL_PROTECTION_BYPASS)', false, { status: pages['/'].status });
    return { pages };
  }
  // Names no one has asked for before (no cached answer), each asked GET, HEAD, then GET again.
  const unique = `khong-co-${Date.now().toString(36)}`;
  const missing = {};
  for (const p of [`/assets/${unique}.js`, `/brand/${unique}.webp`, `/media/${unique}.mp4`, `/${unique}-favicon.ico`]) {
    missing[p] = [await get(p), await get(p, {}, 'HEAD'), await get(p)];
  }
  const longCache = (cache) => /immutable|max-age=[1-9]/.test(cache ?? '');
  const entry = pages['/'].assets.find((a) => a.endsWith('.js'));
  const files = { entry: await get(entry), brand: await get('/brand/hero-960.webp'), poster: await get('/media/big-buck-bunny-trailer-poster.jpg') };
  const ranges = { start: await get(FILM, { Range: 'bytes=0-1023' }), seek: await get(FILM, { Range: 'bytes=8000000-8000999' }) };
  const result = { pages, missing, files, ranges };
  // PAGE_TITLES in src/brand.ts: "<name> — <tagline>" and "Phòng chiếu 3D · <name>".
  const isLanding = (r) => r.status === 200 && / — /.test(r.title ?? '');
  const isCinema = (r) => r.status === 200 && /^Phòng chiếu 3D/.test(r.title ?? '');
  check('hosting: / (also with a query) is the landing HTML, /cinema, /cinema/ and ?inspect=seat the cinema HTML, an unknown page falls back to the landing HTML', isLanding(pages['/']) && isLanding(pages['/?utm_source=test']) && isCinema(pages['/cinema']) && isCinema(pages['/cinema/']) && isCinema(pages['/cinema?inspect=seat']) && isLanding(pages['/khong-co-trang-nay']), Object.fromEntries(Object.entries(pages).map(([p, r]) => [p, [r.status, r.title]])));
  check('hosting: missing files answer 404 to GET, HEAD and a repeated GET, never the landing page', Object.values(missing).flat().every((r) => r.status === 404 && r.title === null), Object.fromEntries(Object.entries(missing).map(([p, rs]) => [p, rs.map((r) => `${r.method} ${r.status} ${r.type}`)])));
  check('hosting: a 404 is never cached long (no immutable, no max-age) — /assets included', Object.values(missing).flat().every((r) => !longCache(r.cache)), Object.fromEntries(Object.entries(missing).map(([p, rs]) => [p, rs.map((r) => `${r.method} ${r.cache} ${r.edge ?? ''}`.trim())])));
  check('hosting: HTML no-cache; hashed assets immutable with a JS type; brand and media pictures revalidated (not immutable)', [pages['/'], pages['/cinema']].every((r) => /no-cache/.test(r.cache ?? '')) && /immutable/.test(files.entry.cache ?? '') && /javascript/.test(files.entry.type ?? '') && files.brand.type === 'image/webp' && !/immutable/.test(files.brand.cache ?? '') && files.poster.type === 'image/jpeg' && !/immutable/.test(files.poster.cache ?? ''), { landing: pages['/'].cache, cinema: pages['/cinema'].cache, entry: [files.entry.type, files.entry.cache], brand: [files.brand.type, files.brand.cache], poster: [files.poster.type, files.poster.cache] });
  check('hosting: the film is video/mp4 and answers range requests at the start and further in (seek)', [ranges.start, ranges.seek].every((r) => r.status === 206 && r.type === 'video/mp4') && /^bytes 0-1023\//.test(ranges.start.range ?? '') && /^bytes 8000000-8000999\//.test(ranges.seek.range ?? '') && !/immutable/.test(ranges.start.cache ?? ''), { start: [ranges.start.status, ranges.start.range, ranges.start.cache], seek: [ranges.seek.status, ranges.seek.range] });
  check('hosting: each document has one canonical (/ and /cinema) on one origin, equal to og:url', pages['/'].canonical?.endsWith('/') && pages['/cinema'].canonical?.endsWith('/cinema') && new URL(pages['/'].canonical).origin === new URL(pages['/cinema'].canonical).origin && pages['/'].canonical === pages['/'].ogUrl && pages['/cinema'].canonical === pages['/cinema'].ogUrl, { landing: pages['/'].canonical, cinema: pages['/cinema'].canonical });
  if (existsSync(path.join(dist, 'cinema.html'))) {
    const local = [...(await readFile(path.join(dist, 'cinema.html'), 'utf8')).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).sort();
    result.sameBuild = { deployed: pages['/cinema'].assets, local };
    check('hosting: the deployment serves the same build as the local dist/ (same hashed file names in cinema.html)', JSON.stringify(local) === JSON.stringify(pages['/cinema'].assets), result.sameBuild);
  }
  return result;
}

async function main() {
  const deployed = Boolean(process.env.BASE_URL);
  if (!deployed && !existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first.');
  await mkdir(outDir, { recursive: true });
  const server = deployed ? null : await preview({ root, logLevel: 'warn', preview: { port: 4318, strictPort: false } });
  const base = (process.env.BASE_URL ?? server.resolvedUrls.local[0]).replace(/\/$/, '');
  report.base = deployed ? new URL(base).origin : 'vite preview (dist/)';
  report.deployed = deployed;
  const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({ executablePath, headless: true });
  report.browser = { version: browser.version() };
  try {
    if (deployed) report.hosting = await hosting(base);
    // ACCEPTANCE_ONLY=hosting: the server's answers only (about 20 requests), no browser flows.
    if (process.env.ACCEPTANCE_ONLY !== 'hosting') await flows(browser, base);
  } finally {
    await browser.close();
    await server?.close();
  }
  const unexpected = report.console.filter((entry) => !entry.expected);
  check('no unexpected console errors or warnings', unexpected.length === 0, unexpected);
  const failed = report.checks.filter((c) => !c.passed).length;
  report.summary = { passed: report.checks.length - failed, failed };
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.summary.passed} passed, ${failed} failed  (${path.relative(root, path.join(outDir, 'report.json'))})`);
  if (failed) process.exitCode = 1;
}

await main();
