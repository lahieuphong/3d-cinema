// Browser acceptance check for the /cinema page and the seat inspector (/cinema?inspect=seat).
//
// Starts the Vite dev server, opens the pages in a locally installed Chrome or Edge (driven by
// playwright-core, no browser download), exercises the camera presets on desktop, tablet and phones
// in portrait and landscape, the guided tour (path, stops, cancelling by drag/keys/wheel/touch/
// presets, hidden tab, reduced motion), explore mode (keys, drag-to-look, real touch events on the
// stick and canvas through CDP, collisions, stairs, focus/blur/pointercancel, slow frames),
// resize/orientation, visibility switches with their lights and shadows, both quality levels,
// context loss (also while moving), hot re-mount, the seat inspector (also opened from the page),
// seat selection (3D picking with mouse and real touch, the 2D map with keyboard, highlights,
// limits, seat views, occlusion, lifecycle across context restores), the film on the screen (real
// playback, controls, colour and aspect with generated clips, errors, refused play, slow network,
// hidden tab, inspector, quality, context loss, phones, 2D fallback, lifecycle, render rate), a
// simulated WebGL failure, and the page's chrome (Prompt 15: the room edge to edge with glass
// controls over it, the task bar Khám phá / Chọn ghế / Xem phim and "Cài đặt"; on a phone the round
// button's panel): layouts and measured canvas share per viewport, the seat sidebar, sheet and
// full-screen dialog, focus and keyboard,
// zoom 200 %, loading and failure states, end-to-end flows; and the landing page at / with the way
// in and out of /cinema (layouts, what it downloads, intent preloading, history, new tabs, keyboard,
// slow or failing code, many visits, reduced motion), then writes screenshots, videos and
// report.json to artifacts/<CAPTURE_DIR or prompt-09>/.
//
// Controls are reached the way a visitor would: choosing their task (the task bar, or on a phone the
// top of the round button's panel), opening "Cài đặt" (with its inspection tools) or the seat panel
// first (see `reveal`).
// CAPTURE_ONLY=section,section runs a subset (names in main()) while working on one area.
// When <output folder>/baseline/ exists (a run of the previous code with CAPTURE_DIR=prompt-NN/baseline),
// its renderer figures are copied into the report and its screenshots are paired with the new ones
// from the same cameras in compare-*.png.
//
//   yarn capture                       # uses the first browser found
//   BROWSER_PATH=/path/to/chrome yarn capture
//
// Exits non-zero if any check fails.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, normalizePath } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-10');

const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
];

// File numbers match earlier prompts' artifacts (1–4), so baseline pairs line up.
const PRESETS = [
  { id: 'overview', file: '1-overview' },
  { id: 'seats', file: '2-seats' },
  { id: 'side', file: '3-side' },
  { id: 'seatEye', file: '4-seat-eye' },
  { id: 'plan', file: '5-plan' },
];
const INSPECTION_PRESETS = new Set(['side', 'plan']);

const report = {
  generatedAt: new Date().toISOString(),
  browser: null,
  webgl: null,
  checks: [],
  console: [],
  screenshots: [],
  // renderer.info after the last frame of each desktop preset (1440×900, DPR 1).
  renderer: [],
  // The same views split into seats / interior fit-out / room shell (dev measureCost hook).
  rendererSplit: [],
  // Per-frame CPU submit and GPU time along a fixed 120-frame camera path (dev measureFrames hook).
  frameTiming: [],
  // The same view measured at both quality levels, and resources before/after repeated switching.
  quality: {},
  // Guided tour: samples along the real run, stop order, speeds, cancel checks.
  tour: {},
  explore: {},
  videos: [],
};

// ANGLE's D3D shader compiler reports float constant folding in three.js's packing code as
// warning X4122 in the program info log, which three.js prints as a warning after a successful
// link. It is a driver note, not a shader error.
const KNOWN_DRIVER_WARNING = /WebGLProgram: Program Info Log:[\s\S]*warning X4122/;

function check(name, passed, detail) {
  report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const nextFrames = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const state = (page) => page.evaluate(() => window.__cinema?.getState() ?? null);
const inspectorState = (page) => page.evaluate(() => window.__seatInspector?.getState() ?? null);

async function waitForStatus(page, timeout = 30_000) {
  await page.waitForFunction(
    () => ['ready', 'error'].includes(document.querySelector('.cinema-app')?.dataset.status ?? ''),
    null,
    { timeout },
  );
  return page.evaluate(() => document.querySelector('.cinema-app').dataset.status);
}

const currentTask = (page) => page.evaluate(() => document.querySelector('.cinema-app')?.dataset.task ?? null);
/** Phones (Prompt 13): the header leaves too and the control panel opens from a round button. */
const isImmersive = (page) => page.evaluate(() => document.querySelector('.cinema-app')?.dataset.layout === 'immersive');

/**
 * Switches to a task (Khám phá, Chọn ghế, Xem phim) with its button: the task bar over the room, or
 * on a phone the top of the round button's panel (opened for it, and closed again if it was closed).
 */
async function ensureTask(page, task) {
  if ((await currentTask(page)) === task) return;
  const phone = await isImmersive(page);
  const wasOpen = phone && (await page.getAttribute('.cinema-hub__toggle', 'aria-expanded')) === 'true';
  if (phone) {
    await openHubPanel(page);
    await hubView(page, 'task');
  }
  await page.click(`button[data-task="${task}"]`);
  await page.waitForFunction((t) => document.querySelector('.cinema-app').dataset.task === t, task);
  if (phone && !wasOpen) await closeMenus(page);
}

/** The button that opens the control panel: "Cài đặt", or the round button on a phone. */
const hubOpener = async (page) => ((await isImmersive(page)) ? '.cinema-hub__toggle' : 'button[data-action="settings"]');

/** Opens the control panel, if closed. */
async function openHubPanel(page) {
  const opener = await hubOpener(page);
  if ((await page.getAttribute(opener, 'aria-expanded')) !== 'true') await page.click(opener);
  await page.waitForSelector('#cinema-hub-panel:not([hidden])');
}

/** Closes the control panel, "Góc khác" and the film list with their own buttons, if open. */
async function closeMenus(page) {
  await page.evaluate(() => {
    for (const toggle of document.querySelectorAll('button[data-action="settings"][aria-expanded="true"], button[data-action="more-views"][aria-expanded="true"], button[data-action="inspector-options"][aria-expanded="true"], button[data-action="film-menu"][aria-expanded="true"], .cinema-hub__toggle[aria-expanded="true"]')) toggle.click();
  });
}

/**
 * Makes a control reachable the way a visitor would: its task (the task bar, or on a phone the task
 * switch inside the round button's panel), "Cài đặt" and the screen it is on (Công cụ nâng cao…; on
 * a phone through the panel's "Cài đặt" row), or the seat panel. Returns what had to be opened (''
 * if nothing; 'hub' when the control panel was opened for it).
 */
async function reveal(page, selector) {
  const where = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return 'missing';
    if (element.getClientRects().length > 0 && !element.closest('[inert]')) return '';
    const dock = element.closest('[data-dock]')?.dataset.dock;
    if (element.closest('.cinema-hub')) {
      if (dock) return `hub-task:${dock}`;
      return `hub-view:${element.closest('.cinema-hub__view')?.dataset.view ?? 'settings'}`;
    }
    if (element.closest('#cinema-more-views')) return dock && document.querySelector('.cinema-app').dataset.task !== dock ? dock : 'more';
    if (element.closest('#cinema-seat-panel')) return 'panel';
    if (element.closest('#cinema-inspector-options')) return 'inspector-options';
    return dock ?? 'other';
  }, selector);
  if (where.startsWith('hub')) {
    await openHubPanel(page);
    if (where.startsWith('hub-task:')) {
      const task = where.slice('hub-task:'.length);
      // Back from Cài đặt (or one of its screens) to the task screen first.
      await hubView(page, 'task');
      if ((await currentTask(page)) !== task) {
        await page.click(`button[data-task="${task}"]`);
        await page.waitForFunction((t) => document.querySelector('.cinema-app').dataset.task === t, task);
      }
    } else {
      await hubView(page, where.slice('hub-view:'.length));
    }
    await page.locator(selector).scrollIntoViewIfNeeded();
    return 'hub';
  } else if (where === 'more') {
    await ensureTask(page, 'explore');
    if (!(await page.isVisible(selector))) await page.click('button[data-action="more-views"]');
  } else if (where === 'panel') {
    await openSeatPanel(page);
  } else if (where === 'inspector-options') {
    await page.click('button[data-action="inspector-options"]');
  } else if (['explore', 'seats', 'watch'].includes(where)) {
    await ensureTask(page, where);
  }
  return where;
}

/** The rows of Cài đặt that open its sub-screens. */
const HUB_LINKS = { help: 'hub-help', about: 'hub-about', advanced: 'inspect-tools' };

/**
 * The open control panel moved to one of its screens the way a visitor gets there: from the task
 * screen (phones) the "Cài đặt" row, from Cài đặt a row of Khác, from a sub-screen "Quay lại".
 */
async function hubView(page, view) {
  for (let step = 0; step < 4; step++) {
    const current = await page.getAttribute('#cinema-hub-panel', 'data-view');
    if (current === view) return;
    if (current === 'task') await page.click('[data-action="hub-settings"]');
    else if (current === 'settings' && HUB_LINKS[view]) await page.click(`[data-action="${HUB_LINKS[view]}"]`);
    else await page.click('[data-action="hub-back"]');
  }
  throw new Error(`hub: could not reach the "${view}" screen`);
}

/** Clicks a control after revealing it; a settings menu (or the phone's hub) opened for it is closed again. */
async function clickUi(page, selector, options) {
  const opened = await reveal(page, selector);
  await page.click(selector, options);
  if (opened === 'hub' || opened === 'inspector-options') await closeMenus(page);
}

/**
 * Phones: a control of the round button's panel, the way a visitor reaches it: the panel opened, its
 * task chosen at the top (or its screen of Cài đặt reached), then a tap.
 */
async function hubTap(page, selector) {
  await reveal(page, selector);
  await page.tap(selector);
}

async function tapUi(page, selector) {
  const opened = await reveal(page, selector);
  await page.tap(selector);
  if (opened === 'hub') await closeMenus(page);
}

async function focusUi(page, selector) {
  await reveal(page, selector);
  await page.focus(selector);
}

async function setQuality(page, level) {
  await clickUi(page, `button[data-quality="${level}"]`);
}

async function openInspectTools(page) {
  await reveal(page, 'button[data-action="open-inspector"]');
}

async function togglePart(page, part) {
  await clickUi(page, `label:has(input[data-toggle="${part}"])`);
}

/**
 * Picks a camera view with its button: the visitor views are in Khám phá (the rarer ones under
 * "Góc khác" on narrow screens), the technical ones in "Cài đặt". Afterwards the page goes back to
 * the task it was in, as a visitor would (switching tasks never moves the camera).
 */
async function selectPreset(page, id, { keyboard = false } = {}) {
  const task = await currentTask(page);
  if (keyboard) {
    await focusUi(page, `button[data-preset="${id}"]`);
    await page.keyboard.press('Enter');
  } else {
    await clickUi(page, `button[data-preset="${id}"]`);
  }
  await page.waitForFunction(
    (preset) => {
      const app = document.querySelector('.cinema-app');
      return app?.dataset.preset === preset && app.dataset.transitioning === 'false' && app.dataset.camera !== 'transition';
    },
    id,
    { timeout: 10_000 },
  );
  await closeMenus(page);
  if (task && (await currentTask(page)) !== task) await ensureTask(page, task);
  await nextFrames(page);
}

// Orbit damping keeps the camera moving for a moment after input; wait until it stops.
async function waitForCameraToSettle(page) {
  let previous = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const current = (await state(page)).view.camera.position;
    if (previous && Math.hypot(...current.map((v, k) => v - previous[k])) < 1e-5) return;
    previous = current;
  }
}

/** Frames one of the inspector's fixed views (no buttons: visitors turn the seat; dev hook). */
async function selectInspectorView(page, id) {
  await page.evaluate((view) => window.__seatInspector.setView(view), id);
  await waitForInspectorIdle(page, id);
}

async function waitForInspectorIdle(page, view) {
  await page.waitForFunction(
    (expected) => {
      const app = document.querySelector('.cinema-app--inspector');
      return app && (!expected || app.dataset.view === expected) && app.dataset.transitioning === 'false';
    },
    view,
    { timeout: 10_000 },
  );
  await nextFrames(page);
}

async function screenshot(page, name, options = {}) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  report.screenshots.push(path.relative(root, file).replaceAll('\\', '/'));
}

async function layoutChecks(page, label, { minShare = 0.5 } = {}) {
  const result = await page.evaluate(() => {
    const viewport = document.querySelector('.cinema-viewport');
    const canvas = viewport?.querySelector('canvas');
    const rect = viewport?.getBoundingClientRect();
    return {
      canvasCount: document.querySelectorAll('canvas').length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      viewport: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      canvasClient: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
      drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
      devicePixelRatio: window.devicePixelRatio,
      window: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  const s = await state(page);
  check(`${label}: exactly one canvas`, result.canvasCount === 1, result.canvasCount);
  check(`${label}: no horizontal page overflow`, result.overflowX <= 0, result.overflowX);
  check(
    `${label}: canvas fills its container`,
    result.canvasClient &&
      Math.abs(result.canvasClient.width - result.viewport.width) <= 1 &&
      Math.abs(result.canvasClient.height - result.viewport.height) <= 1,
    { viewport: result.viewport, canvas: result.canvasClient },
  );
  const cap = s.view.quality === 'economy' ? 1.25 : 2;
  const ratio = Math.min(result.devicePixelRatio, cap);
  check(
    `${label}: drawing buffer = size × capped pixel ratio`,
    Math.abs(result.drawingBuffer.width - Math.floor(result.canvasClient.width * ratio)) <= 1 &&
      Math.abs(result.drawingBuffer.height - Math.floor(result.canvasClient.height * ratio)) <= 1,
    { drawingBuffer: result.drawingBuffer, ratio },
  );
  check(
    `${label}: camera aspect matches canvas`,
    Math.abs(s.view.camera.aspect - result.canvasClient.width / result.canvasClient.height) < 1e-3,
    s.view.camera.aspect,
  );
  const share = (result.viewport.width * result.viewport.height) / (result.window.width * result.window.height);
  check(`${label}: canvas uses ${minShare === 0.5 ? 'most' : `at least ${minShare * 100} %`} of the screen`, share > minShare, Number(share.toFixed(2)));
  return result;
}

function attachConsole(page, label) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      report.console.push({ page: label, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => report.console.push({ page: label, type: 'pageerror', text: String(error) }));
}

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('No Chrome/Edge found. Set BROWSER_PATH to a Chromium-based browser executable.');
  return found;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const executablePath = findBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  report.browser = { executablePath, version: browser.version(), baseUrl: base };

  // CAPTURE_ONLY=viewports,film-desktop,… runs only those sections (development; a full run is the record).
  const only = new Set((process.env.CAPTURE_ONLY ?? '').split(',').filter(Boolean));
  const run = (section) => only.size === 0 || only.has(section);
  try {
    // "/" is the landing page now (Prompt 07–08 redirected it to /cinema).
    if (run('viewports')) {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachConsole(page, 'root');
      await page.goto(base);
      await waitForLanding(page);
      const root = await landingState(page);
      check('"/" shows the landing page (no redirect, no canvas, a real link to /cinema)', root.path === '/' && root.landing && root.canvases === 0 && (await page.getAttribute('.hero a[data-cta]', 'href')) === '/cinema', root);
      await context.close();
    }

    for (const { name, ...options } of run('viewports') ? VIEWPORTS : []) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      attachConsole(page, name);
      await page.goto(`${base}cinema`);
      const status = await waitForStatus(page);
      check(`${name}: /cinema opens directly and reaches "ready"`, status === 'ready', status);
      if (status !== 'ready') {
        await screenshot(page, `${name}-error`);
        await context.close();
        continue;
      }

      if (!report.webgl) {
        report.webgl = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const info = gl?.getExtension('WEBGL_debug_renderer_info');
          return {
            version: gl?.getParameter(gl.VERSION) ?? null,
            renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null,
          };
        });
      }

      // Touch-first devices start at Economy, desktops at High, while nothing is stored yet.
      {
        const s = await state(page);
        const expected = options.hasTouch ? 'economy' : 'high';
        const pressed = await page.getAttribute(`button[data-quality="${expected}"]`, 'aria-pressed');
        check(`${name}: default quality is ${expected} (no stored choice)`, s.view.quality === expected && s.qualitySource === 'device' && pressed === 'true', {
          quality: s.view.quality,
          source: s.qualitySource,
        });
      }

      // The page opens in Khám phá with the seat panel out of the way (Prompt 07 opened it on wide
      // desktops). Preset shots are taken in Khám phá.
      {
        const s = await state(page);
        check(`${name}: opens in Khám phá, seat panel closed`, s.task === 'explore' && s.panel === 'closed' && !s.seats.panelOpen, { task: s.task, panel: s.panel });
        await nextFrames(page);
      }

      const stats = await page.textContent('.cinema-stats');
      check(`${name}: header shows rows and seat total`, /10 \(A–J\)/.test(stats) && /110/.test(stats), stats);
      await layoutChecks(page, name);

      for (const preset of PRESETS) {
        await selectPreset(page, preset.id);
        const s = await state(page);
        check(`${name}: preset ${preset.id} applied`, s.preset === preset.id && s.view.transitioning === false, s.view.camera);
        await screenshot(page, `${name}-${preset.file}`);
        if (name === 'desktop') {
          report.renderer.push({ preset: preset.id, ...s.view.render, ...s.view.memory });
          const split = await page.evaluate(() => window.__cinema.measureCost?.() ?? null);
          if (split) report.rendererSplit.push({ preset: preset.id, ...split });
        }
        if (preset.id === 'side') check(`${name}: side view hides the right wall`, s.visibility.rightWall === false);
        if (preset.id === 'seatEye') {
          check(`${name}: seat-eye restores the right wall after arriving`, s.visibility.rightWall === true);
          check(`${name}: seat-eye uses look-around mode`, s.view.mode === 'eye');
        }
        if (preset.id === 'plan') check(`${name}: plan view hides the ceiling`, s.visibility.ceiling === false);
        check(
          `${name}: ${preset.id} is ${INSPECTION_PRESETS.has(preset.id) ? 'an inspection view' : 'an experience view inside the room'}`,
          s.view.state === (INSPECTION_PRESETS.has(preset.id) ? 'inspection' : 'preset') &&
            (INSPECTION_PRESETS.has(preset.id) || (await clearPoints(page, [s.view.camera.position], 0.2, preset.id === 'seatEye' ? ['seats-F'] : []))[0]),
          { state: s.view.state, position: s.view.camera.position, fov: s.view.camera.fov },
        );
      }
      await selectPreset(page, 'overview');
      report.framing ??= {};
      report.framing[name] = {
        aspect: (await state(page)).view.camera.aspect,
        fov: (await state(page)).view.camera.fov,
        overview: (await state(page)).view.camera.position,
      };

      if (name === 'desktop') {
        await interiorShots(page);
        await materialShots(page);
        await seatViewShots(page);
        await lightingChecks(page);
        await measurePerformance(page, 'desktop high');
        await tourChecks(page);
        await exploreChecks(page);
        await qualityChecks(page);
        await seatChecks(page);
        await seatCloseUp(page);
        await desktopInteractions(page, server);
      }
      if (name === 'tablet') {
        // DPR 2: here the levels also differ in pixel ratio (2 vs 1.25), unlike the DPR-1 desktop.
        await measurePerformance(page, 'tablet economy');
        await setQuality(page, 'high');
        await nextFrames(page);
        await measurePerformance(page, 'tablet high');
      }
      if (name === 'mobile') {
        await touchChecks(page, context);
        await mobileSeatChecks(page, context);
      }
      await context.close();
    }

    const sections = [
      ['inspector', () => seatInspector(browser, base)],
      ['inspector-from-page', () => inspectorFromPage(browser, base)],
      ['reduced-motion', () => reducedMotion(browser, base)],
      ['context-loss', () => contextLoss(browser, base)],
      ['lifecycle', () => lifecycleChecks(browser, base)],
      ['webgl-failure', () => webglFailure(browser, base)],
      ['film-desktop', () => filmDesktop(browser, base)],
      ['film-fixtures', () => filmFixtures(browser, base)],
      ['film-mobile', () => filmMobile(browser, base)],
      ['film-choice', () => filmChoice(browser, base)],
      ['ui-layouts', () => uiLayouts(browser, base)],
      ['ui-focus', () => uiFocus(browser, base)],
      ['ui-states', () => uiStates(browser, base)],
      ['ui-flows', () => uiFlows(browser, base)],
      ['mobile-hub', () => mobileHub(browser, base)],
      ['ui-settings', () => uiSettings(browser, base)],
      ['ui-zoom', () => uiZoom(browser, base)],
      ['landing-layouts', () => landingLayouts(browser, base)],
      ['landing-network', () => landingNetwork(browser, base)],
      ['landing-flows', () => landingFlows(browser, base)],
      ['videos', () => videos(browser, base)],
      ['comparisons', async () => {
        await comparisons(browser);
        await uiComparisons(browser);
      }],
    ];
    report.ui ??= {};
    for (const [section, runSection] of sections) if (run(section)) await runSection();
  } finally {
    await browser.close();
    await server.close();
  }

  // The WebGL-disabled page logs its failure on purpose, as does the page whose 3D download is cut
  // (only those messages), and the X4122 driver note is harmless; anything else is unexpected.
  for (const entry of report.console) {
    entry.expected =
      entry.page === 'webgl-disabled' ||
      (entry.page === 'ui-3d-download-fails' && /Could not load the 3D part|Failed to fetch dynamically imported module|Failed to load resource/.test(entry.text)) ||
      (entry.page === 'landing-code-fails' && /Could not load the page|Failed to fetch dynamically imported module|Failed to load resource/.test(entry.text)) ||
      (entry.type === 'warning' && KNOWN_DRIVER_WARNING.test(entry.text));
  }
  const unexpected = report.console.filter((entry) => !entry.expected);
  check('no unexpected console warnings or errors', unexpected.length === 0, unexpected.length);

  const baselineReport = path.join(outDir, 'baseline', 'report.json');
  if (existsSync(baselineReport)) {
    report.rendererBaseline = JSON.parse(await readFile(baselineReport, 'utf8')).renderer;
  }

  report.summary = {
    passed: report.checks.filter((c) => c.passed).length,
    failed: report.checks.filter((c) => !c.passed).length,
    unexpectedConsole: unexpected.length,
    expectedConsole: report.console.length - unexpected.length,
  };
  await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.summary.passed} passed, ${report.summary.failed} failed`);
  for (const entry of report.console) {
    console.log(`  [${entry.page}] ${entry.expected ? 'expected ' : ''}${entry.type}: ${entry.text.split('\n')[0]}`);
  }
  console.log(`Report: ${path.relative(root, path.join(outDir, 'report.json'))}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

async function desktopInteractions(page, server) {
  // Experience view: zooming out and orbiting keep the camera inside the room, above the seats.
  await selectPreset(page, 'overview');
  const canvasBox = await page.locator('.cinema-canvas').boundingBox();
  const centre = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
  await page.mouse.down();
  await page.mouse.move(centre.x + 200, centre.y + 120, { steps: 8 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  let s = await state(page);
  check('desktop: orbiting the overview keeps the camera inside the room, clear of everything', (await clearPoints(page, [s.view.camera.position], 0.25))[0], s.view.camera.position);
  const freeCaption = await page.textContent('.cinema-caption');
  check('desktop: caption switches to free camera after manual orbit', freeCaption.startsWith('Camera tự do'), freeCaption);

  // Inspection: with ceiling and back wall hidden, the section view orbits freely, also outside.
  await selectPreset(page, 'side');
  await togglePart(page, 'ceiling');
  await togglePart(page, 'backWall');
  await nextFrames(page);
  s = await state(page);
  check('desktop: ceiling and back wall can be hidden', s.visibility.ceiling === false && s.visibility.backWall === false);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 260, centre.y + 60, { steps: 8 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  s = await state(page);
  // Outside the room's clear volume (12 m wide, 18 m long, centred), past a side or end wall. How far
  // a drag turns depends on the canvas height (the room fills the window since Prompt 15).
  check('desktop: inspection orbit may leave the room (cut-away)', s.view.state === 'inspection' && (Math.abs(s.view.camera.position[0]) > 6.5 || Math.abs(s.view.camera.position[2]) > 9.5), s.view.camera.position);
  await screenshot(page, 'desktop-6-cutaway-orbit');

  // Reset restores everything.
  await clickUi(page, 'button[data-action="reset"]');
  await page.waitForFunction(() => {
    const app = document.querySelector('.cinema-app');
    return app.dataset.preset === 'overview' && app.dataset.transitioning === 'false';
  });
  s = await state(page);
  check(
    'desktop: reset returns to the overview and shows every part',
    s.preset === 'overview' && Object.values(s.visibility).every(Boolean),
    s.visibility,
  );

  // Keyboard: focus a preset button and press Enter.
  await selectPreset(page, 'seats', { keyboard: true });
  s = await state(page);
  check('desktop: presets work from the keyboard', s.preset === 'seats');

  // Orbit drag, then switch preset while damping is still moving: the camera must settle on the
  // preset and stay there.
  await selectPreset(page, 'overview');
  const before = (await state(page)).view.camera.position;
  const box = await page.locator('.cinema-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 30, cy + i * 6);
  await page.mouse.up();
  const dragged = (await state(page)).view.camera.position;
  check('desktop: orbit drag moves the camera', distance(before, dragged) > 0.05, distance(before, dragged));
  await clickUi(page, 'button[data-preset=\"seats\"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.transitioning === 'false');
  await nextFrames(page);
  const settled = (await state(page)).view.camera;
  await page.waitForTimeout(700);
  const later = (await state(page)).view.camera;
  check(
    'desktop: no drift after a preset change (damping cleared)',
    distance(settled.position, later.position) < 1e-6 && distance(settled.target, later.target) < 1e-6,
    { settled: settled.position, later: later.position },
  );

  // Two presets in quick succession: one transition, ending on the last one.
  await clickUi(page, 'button[data-preset=\"seats\"]');
  await clickUi(page, 'button[data-preset=\"seatEye\"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.transitioning === 'false');
  s = await state(page);
  check('desktop: rapid preset clicks end on the last preset', s.preset === 'seatEye' && s.view.mode === 'eye');

  // Resize the same page from desktop to mobile.
  await selectPreset(page, 'overview');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cinema-canvas');
    return canvas && Math.abs(canvas.clientWidth - document.querySelector('.cinema-viewport').clientWidth) <= 1;
  });
  await nextFrames(page);
  await layoutChecks(page, 'desktop→mobile resize');
  await screenshot(page, 'desktop-resized-to-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
  await nextFrames(page);

  // Real hot update of the page module: main.ts disposes the old mount and mounts again.
  // The old canvas must leave the DOM and its GL context must be released.
  await page.evaluate(() => {
    window.__oldCanvas = document.querySelector('.cinema-canvas');
    window.__oldGl = window.__oldCanvas.getContext('webgl2');
  });
  const environment = server.environments.client;
  const [pageModule] = environment.moduleGraph.getModulesByFile(normalizePath(path.join(root, 'src/cinema/page.ts'))) ?? [];
  await environment.reloadModule(pageModule);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cinema-canvas');
    return canvas && canvas !== window.__oldCanvas && document.querySelector('.cinema-app')?.dataset.status === 'ready';
  });
  await nextFrames(page);
  const remount = await page.evaluate(() => ({
    canvasCount: document.querySelectorAll('canvas').length,
    oldCanvasAttached: window.__oldCanvas.isConnected,
    oldContextReleased: window.__oldGl.isContextLost(),
    appRoots: document.querySelectorAll('.cinema-app').length,
  }));
  check(
    'desktop: hot re-mount leaves one canvas and releases the old context',
    remount.canvasCount === 1 && remount.appRoots === 1 && !remount.oldCanvasAttached && remount.oldContextReleased,
    remount,
  );
  await selectPreset(page, 'seats');
  check('desktop: controls work after re-mount', (await state(page)).preset === 'seats');
}

// Close-ups of the interior fit-out from exact camera poses ('eye' mode keeps the camera where it is
// put; the orbit camera would lift itself above its target for upward views), then the overview with
// the ceiling hidden to show that beams and light slots go with it.
async function interiorShots(page) {
  const shots = [
    ['interior-1-door-wall', [2.6, 1.7, -3.4], [6.0, 1.8, -6.4]],
    ['interior-2-panels-speakers', [-1.5, 2.9, 4.6], [-6.0, 3.2, 0.6]],
    ['interior-3-ceiling-projector', [0, 3.2, -6.6], [0, 5.6, 6.0]],
    ['interior-4-curtain-screen', [3.2, 2.4, -5.6], [5.4, 2.4, -8.7]],
    ['interior-5-curtain-edge', [3.7, 1.3, -8.2], [5.9, 2.1, -8.72]],
    ['interior-6-handrail-stairs', [5.3, 1.75, -4.9], [5.9, 2.2, 3.0]],
  ];
  for (const [name, position, target] of shots) {
    await page.evaluate(
      ([p, t]) => window.__cinema.setCamera({ x: p[0], y: p[1], z: p[2] }, { x: t[0], y: t[1], z: t[2] }, 'eye'),
      [position, target],
    );
    await nextFrames(page);
    await screenshot(page, name);
  }

  await selectPreset(page, 'overview');
  await togglePart(page, 'ceiling');
  await nextFrames(page);
  const s = await state(page);
  check('desktop: hiding the ceiling hides its beams and light slots (fewer draw calls)', s.visibility.ceiling === false, s.view.render);
  await screenshot(page, 'interior-7-overview-ceiling-hidden');
  await togglePart(page, 'ceiling');
  await nextFrames(page);

  const overview = report.rendererSplit.find((entry) => entry.preset === 'overview');
  if (overview) {
    check('interior budget at the overview: ≤ 25 extra draw calls', overview.interior.calls <= 25, overview.interior);
    check('interior budget at the overview: ≤ 50k triangles', overview.interior.triangles <= 50_000, overview.interior);
  }
}

// Material close-ups from exact poses, at High: leather at an angle, graphite at a grazing angle,
// seat legs on the carpet (contact shadows), the curtain from the front, the exit sign and the
// handrail. Poses near the door and the rail are computed from the layout in the page.
async function materialShots(page) {
  const computed = await page.evaluate(async () => {
    const { layout } = window.__cinema;
    const { doorOpening } = await import('/src/cinema/interior.ts');
    const { stairPitchY } = await import('/src/cinema/layout.ts');
    const { interior, config } = layout;
    const opening = doorOpening(layout);
    const sign = config.interior.exitSign;
    const signY = opening.y.max + sign.gapAboveDoor + sign.height / 2;
    const railZ = layout.rows[3].treadZ.min;
    const railY = stairPitchY(layout, railZ) + config.interior.handrail.height;
    return {
      sign: [[interior.x.max - 1.5, signY - 0.35, opening.centerZ + 1.2], [interior.x.max, signY, opening.centerZ]],
      rail: [[interior.x.max - 0.9, railY + 0.25, railZ - 1.6], [interior.x.max + 0.06, railY - 0.1, railZ + 0.6]],
    };
  });
  const shots = [
    ['material-1-seat-leather', [1.6, 1.9, -0.9], [0.0, 0.8, 1.6]],
    ['material-2-graphite-grazing', [4.6, 0.9, -3.9], [3.6, 0.4, -2.6]],
    ['material-3-seat-legs-carpet', [4.4, 0.75, -3.7], [3.3, 0.05, -2.3]],
    ['material-4-curtain-front', [4.2, 2.3, -5.0], [5.4, 2.7, -8.7]],
    ['material-5-exit-sign', ...computed.sign],
    ['material-6-handrail', ...computed.rail],
  ];
  for (const [name, position, target] of shots) {
    await page.evaluate(
      ([p, t]) => window.__cinema.setCamera({ x: p[0], y: p[1], z: p[2] }, { x: t[0], y: t[1], z: t[2] }, 'eye'),
      [position, target],
    );
    await nextFrames(page);
    await screenshot(page, name);
  }
  await selectPreset(page, 'overview');
}

// Lights follow the parts they are fixed to, the shadow map is redrawn when (and only when) the
// scene changes, and the room stays lit for inspection with the ceiling or right wall hidden.
async function lightingChecks(page) {
  const toggle = async (part) => {
    await togglePart(page, part);
    await nextFrames(page);
    return state(page);
  };
  await selectPreset(page, 'overview');
  let s = await state(page);
  const allOn = Object.values(s.view.lights).every((light) => light.on);
  check('lighting: every light on in the default state', allOn && Object.keys(s.view.lights).length === 9, s.view.lights);
  const renders = s.view.shadow.renders;
  await selectPreset(page, 'seats');
  await selectPreset(page, 'overview');
  s = await state(page);
  check('lighting: camera moves do not redraw the shadow map', s.view.shadow.renders === renders, s.view.shadow);

  s = await toggle('ceiling');
  let lights = s.view.lights;
  check(
    'lighting: hiding the ceiling switches off its coves and curtain lights; the downlight becomes the inspection light',
    !lights['cove-left'].on && !lights['cove-right'].on && !lights['curtain-left'].on && !lights['curtain-right'].on &&
      lights['inspection-light']?.on && lights.base.on && lights.screen.on,
    lights,
  );
  check('lighting: hiding the ceiling redraws the shadow map', s.view.shadow.renders > renders, s.view.shadow);
  await screenshot(page, 'ui-state-1-ceiling-hidden');

  const rendersBefore = s.view.shadow.renders;
  s = await toggle('rightWall');
  lights = s.view.lights;
  check(
    'lighting: hiding the right wall switches off its aisle guide only',
    !lights['aisle-guide-right'].on && lights['aisle-guide-left'].on,
    lights,
  );
  check('lighting: hiding the right wall redraws the shadow map', s.view.shadow.renders > rendersBefore, s.view.shadow);
  await selectPreset(page, 'seatEye');
  await screenshot(page, 'ui-state-2-ceiling-hidden-seat-eye');
  await selectPreset(page, 'overview');

  s = await toggle('ceiling');
  if (!s.visibility.rightWall) s = await toggle('rightWall');
  check(
    'lighting: restoring the parts restores every light and the warm downlight',
    Object.values(s.view.lights).every((light) => light.on) && 'ceiling-downlight' in s.view.lights && s.visibility.ceiling && s.visibility.rightWall,
    s.view.lights,
  );
}

// Same cameras at both levels; switching keeps the camera and visibility, persists the choice,
// does not grow GPU resources, and the renderer goes idle again afterwards.
async function qualityChecks(page) {
  const switchTo = async (level) => {
    await setQuality(page, level);
    await nextFrames(page);
    return state(page);
  };
  const views = [
    ['overview', { preset: 'overview' }],
    ['seat-eye', { preset: 'seatEye' }],
    ['seat-leather', { pose: [[1.6, 1.9, -0.9], [0.0, 0.8, 1.6]] }],
    ['graphite-grazing', { pose: [[4.6, 0.9, -3.9], [3.6, 0.4, -2.6]] }],
  ];
  await switchTo('high');
  for (const [name, view] of views) {
    if (view.preset) await selectPreset(page, view.preset);
    else {
      await page.evaluate(
        ([p, t]) => window.__cinema.setCamera({ x: p[0], y: p[1], z: p[2] }, { x: t[0], y: t[1], z: t[2] }, 'eye'),
        view.pose,
      );
      await nextFrames(page);
    }
    const before = (await state(page)).view.camera;
    await screenshot(page, `quality-${name}-high`);
    const s = await switchTo('economy');
    await screenshot(page, `quality-${name}-economy`);
    check(
      `quality: switching at "${name}" keeps the camera exactly`,
      distance(before.position, s.view.camera.position) < 1e-9 && distance(before.target, s.view.camera.target) < 1e-9,
      { before: before.position, after: s.view.camera.position },
    );
    await switchTo('high');
  }

  await selectPreset(page, 'overview');
  const cost = {};
  for (const level of ['high', 'economy']) {
    await switchTo(level);
    cost[level] = await page.evaluate(() => window.__cinema.measureCost());
  }
  report.quality.overviewCost = cost;
  check(
    'quality: Economy draws at most half the seat triangles of High, with the same draw calls',
    cost.economy.seats.triangles <= cost.high.seats.triangles / 2 && cost.economy.total.calls === cost.high.total.calls,
    { high: cost.high.seats, economy: cost.economy.seats },
  );
  await measurePerformance(page, 'desktop economy');

  // Visibility and a free camera survive a switch; the choice is stored and saved for the next visit.
  await togglePart(page, 'backWall');
  await page.evaluate(() => window.__cinema.setCamera({ x: -3, y: 3.5, z: 9.5 }, { x: 1, y: 1.5, z: -4 }));
  await nextFrames(page);
  let s = await state(page);
  const kept = { visibility: s.visibility, camera: s.view.camera, preset: s.preset };
  s = await switchTo('high');
  check(
    'quality: switching keeps hidden parts, free camera and preset',
    JSON.stringify(s.visibility) === JSON.stringify(kept.visibility) && distance(s.view.camera.position, kept.camera.position) < 1e-9 &&
      s.preset === kept.preset && s.canvasCount === 1,
    { visibility: s.visibility, canvasCount: s.canvasCount },
  );
  const seatsAtHigh = (await page.evaluate(() => window.__cinema.measureCost())).seats;
  check('quality: seats are rebuilt at the High level after switching back', seatsAtHigh.triangles === cost.high.seats.triangles, seatsAtHigh);
  await togglePart(page, 'backWall');
  await nextFrames(page);

  // Resources: switch back and forth; geometries, textures and programs must come back to the same count.
  await selectPreset(page, 'overview');
  const memoryBefore = (await state(page)).view.memory;
  for (let i = 0; i < 6; i++) await switchTo(i % 2 === 0 ? 'economy' : 'high');
  const afterSwitching = await state(page);
  report.quality.memory = { before: memoryBefore, afterSixSwitches: afterSwitching.view.memory };
  check(
    'quality: six switches leave geometries, textures and shader programs unchanged',
    JSON.stringify(afterSwitching.view.memory) === JSON.stringify(memoryBefore) && afterSwitching.canvasCount === 1,
    report.quality.memory,
  );
  const framesAfterSwitch = afterSwitching.view.framesRendered;
  await page.waitForTimeout(1000);
  check('quality: no new frames once a switch has rendered', (await state(page)).view.framesRendered === framesAfterSwitch);

  // Persisted choice: reload at Economy, then go back to High for the rest of the run.
  await switchTo('economy');
  await page.reload();
  await waitForStatus(page);
  s = await state(page);
  const pressed = await page.getAttribute('button[data-quality="economy"]', 'aria-pressed');
  check('quality: the choice is stored and restored on reload', s.view.quality === 'economy' && s.qualitySource === 'stored' && pressed === 'true', {
    quality: s.view.quality,
    source: s.qualitySource,
  });
  await page.evaluate(() => localStorage.setItem('cinema3d.quality', 'ultra'));
  await page.reload();
  await waitForStatus(page);
  s = await state(page);
  check('quality: an invalid stored value falls back to the device default', s.view.quality === 'high' && s.qualitySource === 'device', {
    quality: s.view.quality,
    source: s.qualitySource,
  });
  await selectPreset(page, 'overview');
}

/** True for each point that is clear of the room's colliders, walls, floor and ceiling. */
function clearPoints(page, points, margin, ignore = []) {
  return page.evaluate(
    async ([pts, m, skip]) => {
      const { createCollisionWorld, pointClear } = await import('/src/cinema/collision.ts');
      const world = createCollisionWorld(window.__cinema.layout);
      return pts.map((p) => pointClear(world, { x: p[0], y: p[1], z: p[2] }, m, new Set(skip)));
    },
    [points, margin, ignore],
  );
}

/** True for each walker state where the body fits (inside walls, clear of seats, stage, curtains). */
function bodiesFit(page, walkers) {
  return page.evaluate(async (states) => {
    const { createCollisionWorld, bodyFits } = await import('/src/cinema/collision.ts');
    const { layout } = window.__cinema;
    const world = createCollisionWorld(layout);
    return states.map((w) => bodyFits(world, layout.config.camera.explore, w.x, w.z, w.floorY));
  }, walkers);
}

async function waitForIdleFrames(page, label, ms = 1000) {
  // Let a frame already requested by the last action land first.
  await nextFrames(page);
  const before = (await state(page)).view.framesRendered;
  await page.waitForTimeout(ms);
  const after = (await state(page)).view.framesRendered;
  check(`${label}: no new frames while nothing moves (${ms / 1000} s)`, after === before, { before, after });
}

/** Records state every `every` ms until `until(state)` or `timeout`. */
async function sampleUntil(page, until, { every = 120, timeout = 40_000 } = {}) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await state(page);
    samples.push({ t: (Date.now() - start) / 1000, ...s });
    if (until(s)) break;
    await page.waitForTimeout(every);
  }
  return samples;
}

async function startTour(page) {
  await clickUi(page, 'button[data-action="tour"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.tour !== 'off');
}

// The full tour on the real page: order of stops, roll, clearance of every sampled position, end
// state; then every way of stopping it.
async function tourChecks(page) {
  await selectPreset(page, 'overview');
  await startTour(page);
  const samples = await sampleUntil(page, (s) => !s.touring && s.view.state === 'preset');
  const positions = samples.map((s) => s.view.camera.position);
  const clear = await clearPoints(page, positions, 0.1);
  const stops = samples.filter((s) => s.view.tour).map((s) => s.view.tour.stopIndex);
  const order = stops.filter((stop, i) => stop !== stops[i - 1]);
  const maxRoll = Math.max(...samples.map((s) => Math.abs(s.view.camera.rollDeg)));
  const seconds = samples.at(-1).t;
  report.tour = { seconds, samples: samples.length, stopOrder: order, maxRollDeg: maxRoll, duration: samples.find((s) => s.view.tour)?.view.tour.duration };
  check('tour: runs through every stop in order and ends at the overview', JSON.stringify(order) === '[0,1,2,3,4]' && samples.at(-1).preset === 'overview', report.tour);
  check('tour: takes 20–32 s including the move to its start', seconds >= 20 && seconds <= 32, seconds);
  check('tour: the camera never rolls', maxRoll < 0.01, maxRoll);
  // One writer at a time: OrbitControls are off whenever the tour or a transition owns the camera.
  const owners = samples.map((s) => `${s.view.state}/${s.view.owner}/${s.view.controlsEnabled}`);
  const exclusive = samples.every((s) =>
    s.view.owner === 'controls' ? s.view.controlsEnabled : !s.view.controlsEnabled && (s.view.state !== 'tour' || ['driver', 'transition'].includes(s.view.owner)),
  );
  check('tour: exactly one camera writer at any time (controls off while the tour drives)', exclusive, [...new Set(owners)]);
  check('tour: every sampled position is clear of seats, stage, curtains and walls', clear.every(Boolean), clear.filter((c) => !c).length);
  check('tour: caption says it has finished', (await page.textContent('.cinema-caption')).startsWith('Tham quan kết thúc'));
  await waitForIdleFrames(page, 'tour: after the end');

  // Every way of stopping it: the camera stays where it was and the tour does not come back.
  const box = await page.locator('.cinema-canvas').boundingBox();
  const stoppers = {
    drag: async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 3 });
      await page.mouse.up();
    },
    'movement key': () => page.keyboard.press('KeyW'),
    wheel: async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 200);
    },
    'stop button': () => page.click('button[data-action="tour-stop"]'),
    preset: () => clickUi(page, 'button[data-preset=\"seatEye\"]'),
    reset: () => clickUi(page, 'button[data-action="reset"]'),
  };
  report.tour.cancel = {};
  for (const [how, stop] of Object.entries(stoppers)) {
    await selectPreset(page, 'overview');
    await startTour(page);
    await page.waitForTimeout(3500);
    const before = (await state(page)).view.camera.position;
    await stop();
    await nextFrames(page);
    const after = await state(page);
    const byCommand = how === 'preset' || how === 'reset';
    if (!byCommand) await waitForCameraToSettle(page);
    const settled = (await state(page)).view.camera.position;
    await page.waitForTimeout(600);
    const later = await state(page);
    report.tour.cancel[how] = { state: after.view.state, movedOnStop: distance(before, after.view.camera.position), drift: distance(settled, later.view.camera.position) };
    check(
      `tour: ${how} stops it at once${byCommand ? ' and the command takes over' : ', the camera stays and does not drift'}`,
      !after.touring && (await page.getAttribute('.cinema-app', 'data-tour')) === 'off' &&
        (byCommand ? ['transition', 'preset'].includes(after.view.state) : after.view.state === 'free' && distance(settled, later.view.camera.position) < 1e-6) &&
        later.view.tour === null,
      report.tour.cancel[how],
    );
  }

  // A hidden tab ends the tour (rule: it would otherwise finish unseen); coming back does not restart it.
  await selectPreset(page, 'overview');
  await startTour(page);
  await page.waitForTimeout(2000);
  const setHidden = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { value: h, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  const hiddenState = await state(page);
  await setHidden(false);
  await page.waitForTimeout(800);
  const back = await state(page);
  check('tour: a hidden tab stops it and returning does not restart it', !hiddenState.touring && !back.touring && back.view.tour === null, {
    caption: await page.textContent('.cinema-caption'),
  });
  await page.evaluate(() => delete document.hidden);

  // Quality switch mid-tour: the tour carries on.
  await selectPreset(page, 'overview');
  await startTour(page);
  await page.waitForTimeout(2500);
  await setQuality(page, 'economy');
  await page.waitForTimeout(800);
  const mid = await state(page);
  check('tour: switching quality during the tour keeps it running', mid.touring && mid.view.tour?.time > 2 && mid.view.quality === 'economy', mid.view.tour);
  await setQuality(page, 'high');
  await clickUi(page, 'button[data-action="tour"]');
  await selectPreset(page, 'overview');

  // Collider and tour path overlay (development view), from the plan view.
  await selectPreset(page, 'plan');
  await page.evaluate(() => window.__cinema.showPaths(true));
  await nextFrames(page);
  await screenshot(page, 'debug-tour-path-colliders');
  await page.evaluate(() => window.__cinema.showPaths(false));

  // Frame-by-frame review of the tour (deterministic poses every 1.5 s), as a contact sheet.
  const duration = report.tour.duration;
  const frames = [];
  for (let t = 0; t <= duration + 1e-6; t += 1.5) {
    await page.evaluate((time) => window.__cinema.tourFrame(time), t);
    await nextFrames(page);
    frames.push([`${t.toFixed(1)} s`, (await page.locator('.cinema-canvas').screenshot()).toString('base64')]);
  }
  report.tour.contactSheetFrames = frames.length;
  await contactSheet(page.context().browser(), 'tour-frames-contact-sheet', frames, 5);

  // Rendering cost along the whole tour path at both levels (same viewport, same poses).
  await selectPreset(page, 'overview');
  // Alternated twice, so warm-up and clock changes show up as a difference between runs of one level.
  for (const [run, level] of [[1, 'high'], [1, 'economy'], [2, 'high'], [2, 'economy']]) {
    await setQuality(page, level);
    await nextFrames(page);
    const timing = await page.evaluate(() => window.__cinema.measureTour(150));
    const s = await state(page);
    report.frameTiming.push({ label: `desktop tour ${level} (run ${run})`, pixelRatio: s.view.pixelRatio, drawingBuffer: s.view.drawingBuffer, ...timing });
  }
  await setQuality(page, 'high');
  await selectPreset(page, 'overview');
}

// Walking with the keyboard and mouse: start rules, collisions (also diagonal and with slow
// frames), stairs, focus rules, blur and pointercancel, quality switch, render stopping.
async function exploreChecks(page) {
  const walker = async () => (await state(page)).view.explore?.walker ?? null;
  const startExplore = async () => {
    await clickUi(page, 'button[data-action="explore"]');
    await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  };
  const hold = async (keys, ms, every = 100) => {
    for (const key of keys) await page.keyboard.down(key);
    const seen = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      seen.push(await walker());
      await page.waitForTimeout(every);
    }
    for (const key of keys) await page.keyboard.up(key);
    await nextFrames(page);
    seen.push(await walker());
    return seen;
  };
  const { layout } = await page.evaluate(() => ({ layout: { eye: window.__cinema.layout.config.camera.explore.eyeHeight, jBack: window.__cinema.layout.rows.at(-1).seatZ + window.__cinema.layout.config.seat.footprintDepth / 2 } }));

  await selectPreset(page, 'overview');
  await startExplore();
  const owned = await state(page);
  check('explore: the walker is the only camera writer (orbit controls off)', owned.view.owner === 'driver' && !owned.view.controlsEnabled, owned.view.owner);
  let w = await walker();
  check('explore: from the overview it starts right below the camera, at standing eye height', Math.abs(w.x) < 1e-6 && Math.abs(w.eyeY - w.floorY - layout.eye) < 1e-6, w);
  await screenshot(page, 'explore-1-desktop-start');

  const forward = await hold(['KeyW'], 2500);
  const fitsForward = await bodiesFit(page, forward);
  check('explore: walking into the last row stops at its seats', forward.at(-1).z >= layout.jBack + 0.25 - 1e-6 && forward.at(-1).z < w.z && fitsForward.every(Boolean), forward.at(-1));

  // Diagonal at 6× CPU slowdown (long frames): still never inside anything.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const diagonal = await hold(['KeyW', 'KeyA'], 3000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const fitsDiagonal = await bodiesFit(page, diagonal);
  report.explore.diagonalSlow = { samples: diagonal.length, last: diagonal.at(-1) };
  check('explore: diagonal walking with slow frames never enters a collider', fitsDiagonal.every(Boolean) && diagonal.at(-1).x < diagonal[0].x, report.explore.diagonalSlow);

  // Keys typed into a text field are not movement.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'probe-input';
    document.body.append(input);
    input.focus();
  });
  const beforeTyping = await walker();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  const typing = await state(page);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => document.getElementById('probe-input').remove());
  check('explore: WASD typed into a text field does not move', typing.view.explore.input.keys.length === 0 && distance([beforeTyping.x, 0, beforeTyping.z], [typing.view.explore.walker.x, 0, typing.view.explore.walker.z]) < 1e-9);

  // Blur while a key is held: nothing stays pressed.
  await page.locator('.cinema-canvas').focus().catch(() => {});
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const afterBlur = await walker();
  await page.waitForTimeout(500);
  const stillAfterBlur = await state(page);
  await page.keyboard.up('KeyS');
  check('explore: blur drops held keys, no "stuck" walking', stillAfterBlur.view.explore.input.keys.length === 0 && distance([afterBlur.x, 0, afterBlur.z], [stillAfterBlur.view.explore.walker.x, 0, stillAfterBlur.view.explore.walker.z]) < 1e-9);

  // Drag to look; pointercancel releases the look pointer.
  const box = await page.locator('.cinema-canvas').boundingBox();
  const yaw0 = (await walker()).yaw;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 - 40, { steps: 6 });
  const looking = await state(page);
  await page.evaluate(() => document.querySelector('.cinema-canvas').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
  const cancelled = await state(page);
  await page.mouse.up();
  check('explore: dragging turns the view; pointercancel releases it', looking.view.explore.walker.yaw < yaw0 && looking.view.explore.input.look && !cancelled.view.explore.input.look);
  await page.waitForTimeout(300);
  await waitForIdleFrames(page, 'explore: standing still');

  // Stairs: from seat F06 to the aisle (visible move), down to the front and back up.
  await selectPreset(page, 'seatEye');
  await startExplore();
  w = await walker();
  check('explore: from a seat it moves to the nearest aisle start, with a caption saying so', w.x > 4.5 && (await page.textContent('.cinema-caption')).startsWith('Đã đưa bạn tới'), w);
  await screenshot(page, 'explore-2-desktop-aisle');
  const down = await hold(['KeyW'], 4500);
  const up = await hold(['KeyS'], 6000);
  await page.waitForTimeout(600);
  up.push(await walker());
  const steps = [...down, ...up];
  const maxRise = Math.max(...steps.slice(1).map((s, i) => Math.abs(s.floorY - steps[i].floorY)));
  report.explore.stairs = { startFloor: w.floorY, bottomFloor: down.at(-1).floorY, topFloor: up.at(-1).floorY, maxRisePerSample: maxRise };
  check(
    'explore: walks down the aisle steps to the front floor and back up, one step at a time, eye at standing height',
    down.at(-1).floorY === 0 && up.at(-1).floorY > w.floorY && maxRise <= 0.25 + 1e-9 &&
      Math.abs(up.at(-1).eyeY - up.at(-1).floorY - layout.eye) < 0.02 && (await bodiesFit(page, steps)).every(Boolean),
    report.explore.stairs,
  );

  // Quality switch while exploring keeps the walker where it is.
  await page.waitForTimeout(800);
  const beforeSwitch = await walker();
  await setQuality(page, 'economy');
  await nextFrames(page);
  const afterSwitch = await state(page);
  check('explore: switching quality keeps exploring at the same spot', afterSwitch.view.state === 'explore' && JSON.stringify(afterSwitch.view.explore?.walker) === JSON.stringify(beforeSwitch), {
    state: afterSwitch.view.state,
    before: beforeSwitch,
    after: afterSwitch.view.explore?.walker,
  });
  await setQuality(page, 'high');

  await clickUi(page, 'button[data-action="explore"]');
  await nextFrames(page);
  const stopped = await state(page);
  check('explore: pressing Khám phá again stops where the camera is', stopped.view.state === 'free' && !stopped.exploring, stopped.view.state);
  await selectPreset(page, 'overview');
}

// Views from a sample of seats with the seat-view helper (Prompt 06 uses it for any seat).
async function seatViewShots(page) {
  for (const id of ['A01', 'A06', 'F06', 'J06', 'J11']) {
    const pose = await page.evaluate(async (seatId) => {
      const { seatViewPose } = await import('/src/cinema/seatView.ts');
      const { layout } = window.__cinema;
      return seatViewPose(layout, layout.seatById.get(seatId));
    }, id);
    await page.evaluate((p) => window.__cinema.setCamera(p.position, p.lookAt, 'eye'), pose);
    await nextFrames(page);
    await screenshot(page, `seat-view-${id}`);
  }
  await selectPreset(page, 'overview');
}

/** Real touch input through the browser's input pipeline (CDP), not synthetic DOM events. */
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
}

/**
 * A one-finger drag at a human pace, resting before lifting. (An instant synthetic swipe reads as
 * a fling, and Chrome then spends the next tap on stopping it.)
 */
async function touchDrag(cdp, page, [x, y], [dx, dy], steps = 6) {
  await touch(cdp, 'touchStart', [[x, y, 1]]);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', [[x + (dx * i) / steps, y + (dy * i) / steps, 1]]);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
  await touch(cdp, 'touchEnd', []);
}

// Phone: stop the tour with a finger, walk with the stick while looking with a second finger,
// touchcancel, and rotating the phone (portrait ↔ landscape) during a preset and while walking.
async function touchChecks(page, context) {
  const cdp = await context.newCDPSession(page);
  const canvas = await page.locator('.cinema-canvas').boundingBox();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  await startTour(page);
  await page.waitForTimeout(2500);
  await touchDrag(cdp, page, [cx, cy], [30, 0]);
  await nextFrames(page);
  const afterTouch = await state(page);
  check('mobile: a finger drag on the canvas stops the tour (real touch events)', !afterTouch.touring && afterTouch.view.state === 'free', afterTouch.view.state);

  await tapUi(page, 'button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  const stickVisible = await page.isVisible('.cinema-stick');
  check('mobile: exploring shows the stick', stickVisible);
  await screenshot(page, 'mobile-explore-ui');

  const stick = await page.locator('.cinema-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  const w0 = (await state(page)).view.explore.walker;
  // Thumb on the stick pushed forward, a second finger dragging on the canvas at the same time.
  await touch(cdp, 'touchStart', [[sx, sy, 1]]);
  await touch(cdp, 'touchMove', [[sx, sy - 45, 1]]);
  await touch(cdp, 'touchStart', [[sx, sy - 45, 1], [cx + 60, cy - 80, 2]]);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', [[sx, sy - 45, 1], [cx + 60 + i * 8, cy - 80, 2]]);
    await page.waitForTimeout(120);
  }
  const both = await state(page);
  await touch(cdp, 'touchEnd', [[sx, sy - 45, 1]]);
  await touch(cdp, 'touchCancel', []);
  await nextFrames(page);
  const released = await state(page);
  // The eye finishes easing onto the step it stopped on (< 1 s) before the idle check.
  await page.waitForTimeout(1000);
  const w1 = released.view.explore.walker;
  report.explore.touch = { from: w0, to: w1, inputWhileHolding: both.view.explore.input };
  check(
    'mobile: stick walks forward while a second finger looks around; touchend/touchcancel release both',
    both.view.explore.input.stick && both.view.explore.input.look && Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.3 && w1.yaw !== w0.yaw &&
      !released.view.explore.input.stick && !released.view.explore.input.look,
    report.explore.touch,
  );
  await waitForIdleFrames(page, 'mobile: exploring, fingers lifted');

  // Rotate while walking: position and heading stay, the frame fits the new shape.
  const beforeRotation = (await state(page)).view.explore.walker;
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  const rotated = await state(page);
  const r = await layoutChecks(page, 'mobile → landscape while exploring');
  check('mobile: rotating keeps the explorer where it was', JSON.stringify(rotated.view.explore.walker) === JSON.stringify(beforeRotation) && r.overflowX <= 0, {
    before: beforeRotation,
    after: rotated.view.explore.walker,
  });
  await screenshot(page, 'mobile-landscape-explore');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // Rotate at a preset: it is framed again for the new shape (the portrait overview stands over
  // the right aisle, the landscape one on the centre line).
  await tapUi(page, 'button[data-action="explore"]');
  await selectPreset(page, 'overview');
  const portrait = (await state(page)).view.camera.position;
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const landscape = await state(page);
  check('mobile: rotating at a preset reframes it', landscape.view.state === 'preset' && landscape.view.pristine && Math.abs(landscape.view.camera.position[0]) < 1e-6 && portrait[0] > 1, {
    portrait,
    landscape: landscape.view.camera.position,
  });
  await screenshot(page, 'mobile-rotated-to-landscape-overview');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
}

// The seat inspector opened from the page's inspection tools while a tour runs: the auditorium
// (tour, input, loop) is torn down; closing it brings back a fresh page, no tour.
async function inspectorFromPage(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  attachConsole(page, 'inspector-from-page');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  await startTour(page);
  await page.waitForTimeout(1500);
  await openInspectTools(page);
  await clickUi(page, 'button[data-action="open-inspector"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  const opened = await page.evaluate(() => ({
    url: location.pathname + location.search,
    auditorium: Boolean(window.__cinema),
    canvases: document.querySelectorAll('canvas').length,
  }));
  check('inspector: opens from the page, replacing the auditorium (no second loop or canvas)', opened.url === '/cinema?inspect=seat' && !opened.auditorium && opened.canvases === 1, opened);
  await waitForInspectorIdle(page);
  const frames = (await inspectorState(page)).inspector.framesRendered;
  await page.waitForTimeout(800);
  check('inspector: idle while nothing moves', (await inspectorState(page)).inspector.framesRendered === frames);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  await page.waitForTimeout(300);
  const back = await state(page);
  check('inspector: closing returns to a fresh auditorium at the overview, tour not resumed', back.preset === 'overview' && !back.touring && back.view.tour === null && back.canvasCount === 1, {
    preset: back.preset,
    state: back.view.state,
  });
  await context.close();
}

// Reduced motion from the start: presets cut, the tour steps between stops. Then turned on while a
// tour plays: it switches to steps at its current stop.
async function reducedMotion(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  attachConsole(page, 'reduced-motion');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  await clickUi(page, 'button[data-preset=\"seats\"]');
  const cut = await state(page);
  check('reduced motion: presets cut straight to the view (no transition)', cut.view.state === 'preset' && !cut.view.transitioning, cut.view.state);

  await clickUi(page, 'button[data-action="tour"]');
  await nextFrames(page);
  let s = await state(page);
  check('reduced motion: the tour steps between stops instead of moving', s.view.tour?.steps && (await page.getAttribute('.cinema-app', 'data-tour')) === 'steps' && s.view.state === 'tour');
  const visited = [s.view.tour.stopIndex];
  const framesAtStop = s.view.framesRendered;
  await page.waitForTimeout(800);
  check('reduced motion: nothing moves while at a stop', (await state(page)).view.framesRendered === framesAtStop);
  await screenshot(page, 'reduced-motion-tour-steps');
  for (let i = 0; i < 6; i++) {
    await page.click('button[data-action="tour-next"]');
    await nextFrames(page);
    s = await state(page);
    if (s.view.tour) visited.push(s.view.tour.stopIndex);
  }
  check('reduced motion: Tiếp walks the stops in order and the last one ends at the overview', JSON.stringify(visited) === '[0,1,2,3,4,5]' && s.view.tour === null && s.preset === 'overview', visited);

  // Turned on during a playing tour.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await clickUi(page, 'button[data-action="tour"]');
  await page.waitForTimeout(3000);
  const playing = await state(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nextFrames(page);
  s = await state(page);
  check('reduced motion: switching it on mid-tour turns the tour into steps at its current stop', !playing.view.tour.steps && s.view.tour?.steps && s.view.tour.stopIndex === playing.view.tour.stopIndex);
  await page.click('button[data-action="tour-stop"]');
  await context.close();
}

/** Lays out base64 PNG frames in a grid with labels and saves it as one screenshot. */
async function contactSheet(browser, name, frames, columns) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 400 } });
  const page = await context.newPage();
  await page.setContent(
    `<body style="margin:0;background:#0f1013;color:#e9eaee;font:13px system-ui;display:grid;grid-template-columns:repeat(${columns},1fr);gap:6px;padding:6px">${frames
      .map(([label, data]) => `<figure style="margin:0"><img style="width:100%;display:block" src="data:image/png;base64,${data}"><figcaption style="padding:2px 4px">${label}</figcaption></figure>`)
      .join('')}</body>`,
  );
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(path.relative(root, file).replaceAll('\\', '/'));
  await context.close();
}

/**
 * Records a page while `run` drives it: CDP screencast frames (the whole page, UI included, as the
 * browser paints them), re-timed and encoded to WebM in a helper page with MediaRecorder. This needs
 * no ffmpeg (playwright-core's own recorder wants a separate ffmpeg download).
 */
async function recordVideo(browser, page, name, run) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 960, maxHeight: 960, everyNthFrame: 2 });
  await run();
  await page.waitForTimeout(300);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  if (frames.length < 2) {
    check(`video ${name}: recorded`, false, frames.length);
    return;
  }

  const context = await browser.newContext();
  const encoder = await context.newPage();
  await encoder.setContent('<body style="margin:0"><canvas></canvas></body>');
  for (let i = 0; i < frames.length; i += 40) {
    await encoder.evaluate((batch) => (window.recorded ??= []).push(...batch), frames.slice(i, i + 40));
  }
  const webm = await encoder.evaluate(async () => {
    const list = window.recorded;
    const decode = (data) => createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
    const first = await decode(list[0].data);
    const canvas = document.querySelector('canvas');
    canvas.width = first.width;
    canvas.height = first.height;
    const context2d = canvas.getContext('2d');
    context2d.drawImage(first, 0, 0);
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(250);
    const start = performance.now();
    for (const frame of list) {
      const image = await decode(frame.data);
      const wait = (frame.t - list[0].t) * 1000 - (performance.now() - start);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      context2d.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  await context.close();
  const file = path.join(outDir, `${name}.webm`);
  await writeFile(file, Buffer.from(webm, 'base64'));
  const seconds = frames.at(-1).t - frames[0].t;
  report.videos.push({ file: path.relative(root, file).replaceAll('\\', '/'), frames: frames.length, seconds: Number(seconds.toFixed(1)) });
  check(`video ${name}: recorded and encoded`, webm.length > 10_000, { frames: frames.length, seconds });
}

// Short videos of the tour, of stopping it in different ways, and of walking with the stick on a phone.
async function videos(browser, base) {
  const open = async (label, options) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    attachConsole(page, label);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    return { context, page };
  };
  {
    const { context, page } = await open('video-tour', { viewport: { width: 960, height: 600 } });
    await recordVideo(browser, page, 'video-tour', async () => {
      await startTour(page);
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.tour === 'off', null, { timeout: 40_000 });
      await page.waitForTimeout(800);
    });
    await context.close();
  }
  {
    const { context, page } = await open('video-tour-cancel', { viewport: { width: 960, height: 600 } });
    const box = await page.locator('.cinema-canvas').boundingBox();
    const centre = [box.x + box.width / 2, box.y + box.height / 2];
    await recordVideo(browser, page, 'video-tour-cancel', async () => {
      await startTour(page);
      await page.waitForTimeout(5000);
      await page.mouse.move(...centre);
      await page.mouse.down();
      await page.mouse.move(centre[0] + 120, centre[1], { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(1500);
      await startTour(page);
      await page.waitForTimeout(4000);
      await page.keyboard.press('KeyW');
      await page.waitForTimeout(1500);
      await startTour(page);
      await page.waitForTimeout(3000);
      await clickUi(page, 'button[data-preset=\"seatEye\"]');
      await page.waitForTimeout(2000);
    });
    await context.close();
  }
  {
    const { context, page } = await open('video-select-3d-map-seat-view', { viewport: { width: 1280, height: 760 } });
    await recordVideo(browser, page, 'video-select-3d-map-seat-view', async () => {
      await page.waitForTimeout(600);
      await openSeatPanel(page);
      await page.waitForTimeout(400);
      for (const id of ['F05', 'F06', 'G08']) {
        const p = await seatPoint(page, id);
        if (!p.visible) continue;
        await page.mouse.move(p.x, p.y, { steps: 10 });
        await page.waitForTimeout(250);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(700);
      }
      await page.click('button[data-seat="F06"]');
      await page.click('button[data-seat="F06"]');
      await page.waitForTimeout(500);
      await clickUi(page, 'button[data-action="view-from-seat"]');
      await page.waitForFunction(() => window.__cinema.getState().view.state === 'seat', null, { timeout: 8000 });
      await page.waitForTimeout(1500);
      await page.click('button[data-action="return"]');
      await page.waitForTimeout(1600);
    });
    await context.close();
  }
  {
    const { context, page } = await open('video-drag-without-selecting', { viewport: { width: 1280, height: 760 } });
    let finalClick = null;
    await recordVideo(browser, page, 'video-drag-without-selecting', async () => {
      await page.waitForTimeout(500);
      for (const id of ['E05', 'H08']) {
        const p = await seatPoint(page, id);
        if (!p.visible) continue;
        await page.mouse.move(p.x, p.y, { steps: 8 });
        await page.mouse.down();
        await page.mouse.move(p.x + 160, p.y + 20, { steps: 20 });
        await page.mouse.up();
        await page.waitForTimeout(900);
      }
      // Wherever the drags left the camera: the first seat that can be clicked from there.
      await page.waitForTimeout(600);
      const target = await page.evaluate(() => {
        for (const seat of window.__cinema.layout.seats) {
          if (document.querySelector(`button[data-seat="${seat.id}"]`)?.getAttribute('aria-disabled') === 'true') continue;
          const point = window.__cinema.seatScreenPoint(seat.id);
          // In sight, and not under the glass controls over the room.
          if (point.visible && document.elementFromPoint(point.x, point.y)?.closest('.cinema-viewport')) return { id: seat.id, ...point };
        }
        return null;
      });
      if (target) {
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await page.mouse.click(target.x, target.y);
        finalClick = target.id;
      }
      await page.waitForTimeout(1200);
    });
    const selected = (await state(page)).seats.selected;
    check('video: dragging from seats selected nothing; the final click selected one seat', finalClick && JSON.stringify(selected) === JSON.stringify([finalClick]), { finalClick, selected });
    await context.close();
  }
  {
    const { context, page } = await open('video-mobile-explore', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const cdp = await context.newCDPSession(page);
    await recordVideo(browser, page, 'video-mobile-explore', async () => {
      await tapUi(page, 'button[data-action="explore"]');
      await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
      const stick = await page.locator('.cinema-stick').boundingBox();
      const [sx, sy] = [stick.x + stick.width / 2, stick.y + stick.height / 2];
      await touch(cdp, 'touchStart', [[sx, sy, 1]]);
      for (let i = 0; i < 30; i++) {
        await touch(cdp, 'touchMove', [[sx + (i > 15 ? 25 : 0), sy - 45, 1]]);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(150);
      await touch(cdp, 'touchEnd', []);
      await page.waitForTimeout(1000);
    });
    await context.close();
  }
}

// ---------------------------------------------------------------- Prompt 06: seat selection

const seatsState = async (page) => (await state(page)).seats;
const seatLook = (page, id) => page.evaluate((seatId) => window.__cinema.seatLook(seatId), id);
/**
 * Where seat `id` is on screen; `visible` only if a click there reaches the 3D view (Prompt 15: the
 * seat sidebar and the glass controls lie over the room, and a seat under them cannot be clicked).
 */
const seatPoint = (page, id) =>
  page.evaluate((seatId) => {
    const p = window.__cinema.seatScreenPoint(seatId);
    if (!p || !p.visible) return p;
    return { ...p, visible: Boolean(document.elementFromPoint(p.x, p.y)?.closest('.cinema-viewport')) };
  }, id);

/**
 * The first seat that can be picked from where the camera is (not reserved, not in `except`), and
 * its point; `avoid` (a box) is kept clear by 24 px (a touch that close is adjusted onto it).
 * Which seats are in sight depends on the view's shape (a phone's overview shows few), hence a search.
 */
const firstVisibleSeat = (page, except = [], avoid = null) =>
  page.evaluate(([skip, box]) => {
    for (const { id } of window.__cinema.layout.seats) {
      if (skip.includes(id) || document.querySelector(`button[data-seat="${id}"]`)?.getAttribute('aria-disabled') === 'true') continue;
      const point = window.__cinema.seatScreenPoint(id);
      if (box && point.x >= box.x - 24 && point.x <= box.x + box.w + 24 && point.y >= box.y - 24 && point.y <= box.y + box.h + 24) continue;
      if (point.visible) return { id, ...point };
    }
    return null;
  }, [except, avoid]);

/** Chọn ghế, then "Sơ đồ ghế" / "Mở sơ đồ" if the panel is not open yet. */
async function openSeatPanel(page) {
  const open = () => page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded');
  if ((await open()) !== 'true') {
    // Chọn ghế (beside the view it opens the sidebar by itself); on a phone, in the round button's
    // panel, where "Mở sơ đồ" opens the full-screen map.
    await reveal(page, 'button[data-action="seat-panel"]');
    if ((await open()) !== 'true') await page.click('button[data-action="seat-panel"]');
  }
  await page.waitForSelector('#cinema-seat-panel:not([hidden])');
}

/** The panel's own "Đóng" (or "Trở lại phòng 3D"), if it is open. */
async function closeSeatPanel(page) {
  if (await page.isVisible('#cinema-seat-panel')) await page.click('button[data-action="seat-panel-close"]');
  await page.waitForSelector('#cinema-seat-panel', { state: 'hidden' });
}

/** Clicks the first of `ids` that is visible in the 3D view; returns its id or null. */
async function clickFirstVisible(page, ids) {
  for (const id of ids) if (await clickSeat3d(page, id)) return id;
  return null;
}

/** Clicks seat `id` in the 3D view with the mouse, at a point where it is visible. */
async function clickSeat3d(page, id, options = {}) {
  const p = await seatPoint(page, id);
  if (!p.visible) return false;
  await page.mouse.click(p.x, p.y, options);
  await nextFrames(page);
  return true;
}

// Desktop: selecting in 3D and in the map, hover, drags and other non-taps, keyboard, the limit,
// removing, the active seat, the tour's first click, seat views, panel resize, quality, occlusion,
// idle rendering, resource stability, picking cost and the inspector round trip.
async function seatChecks(page) {
  report.seats = {};
  await selectPreset(page, 'overview');
  await openSeatPanel(page);
  await nextFrames(page);
  const reservedCount = (await seatsState(page)).reserved;

  // 3D → map: three seats clicked where nothing covers them (the sidebar is open over the room).
  const picked = [];
  for (const id of ['F06', 'B03', 'H08', 'C03', 'G05', 'E02', 'I02']) if (picked.length < 3 && (await clickSeat3d(page, id))) picked.push(id);
  let s = await seatsState(page);
  const pressed = await Promise.all(picked.map((id) => page.getAttribute(`button[data-seat="${id}"]`, 'aria-pressed')));
  const looks = await Promise.all(picked.map((id) => seatLook(page, id)));
  check(
    'seats: clicking seats in 3D selects them, presses them in the map and tags them in 3D',
    picked.length === 3 && JSON.stringify(s.selected) === JSON.stringify([...picked].sort()) && pressed.every((v) => v === 'true') && looks.every((l) => l.tag),
    { picked, selected: s.selected, pressed },
  );
  await screenshot(page, 'seats-1-auditorium-selected-reserved');

  // Reserved in 3D: refused, nothing changes, the reason is shown.
  await clickSeat3d(page, 'H04');
  s = await seatsState(page);
  const notice = await page.textContent('.cinema-notice');
  check('seats: a reserved seat cannot be selected from 3D (the notice says why)', s.selected.length === 3 && s.active === 'H04' && /đã được đặt/.test(notice), { notice });

  // Map → 3D.
  await page.click('button[data-seat="C02"]');
  await nextFrames(page);
  const c02 = await seatLook(page, 'C02');
  check('seats: selecting in the map tags and tints the seat in 3D', (await seatsState(page)).selected.includes('C02') && c02.tag && c02.tint[0] > 1.5, c02);
  await page.click('button[data-seat="C02"]');
  const c02off = await seatLook(page, 'C02');
  check('seats: deselecting in the map clears the 3D state', !(await seatsState(page)).selected.includes('C02') && !c02off.tag);

  // Hover follows the mouse and leaves with it.
  const hoverPoint = await seatPoint(page, 'D07');
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await nextFrames(page);
  const hovered = (await seatsState(page)).hovered;
  const cursor = await page.evaluate(() => document.querySelector('.cinema-canvas').style.cursor);
  await page.mouse.move(5, 5);
  await nextFrames(page);
  check('seats: hover marks the seat under the mouse and clears when the mouse leaves', hovered === 'D07' && cursor === 'pointer' && (await seatsState(page)).hovered === null, {
    hovered,
    cursor,
  });

  // Not taps: a drag starting on a seat, the right button, the wheel.
  const before = JSON.stringify((await seatsState(page)).selected);
  const dragFrom = await seatPoint(page, 'G05');
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x + 40, dragFrom.y + 6, { steps: 5 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  await selectPreset(page, 'overview');
  const right = await seatPoint(page, 'G05');
  await page.mouse.click(right.x, right.y, { button: 'right' });
  await page.mouse.move(right.x, right.y);
  await page.mouse.wheel(0, 120);
  await waitForCameraToSettle(page);
  check('seats: dragging from a seat, right-clicking and scrolling never select', JSON.stringify((await seatsState(page)).selected) === before);
  await selectPreset(page, 'overview');

  // Keyboard in the map: roving focus, arrows, Home/End, Enter/Space, reserved seats.
  await page.focus('button[data-seat][tabindex="0"]');
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.seat ?? null);
  await page.click('button[data-seat="E02"]');
  await page.click('button[data-seat="E02"]');
  const moves = [];
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'End', 'Home', 'Control+End', 'Control+Home']) {
    await page.keyboard.press(key);
    moves.push(await focused());
  }
  const tabStops = await page.$$eval('button[data-seat]', (buttons) => buttons.filter((b) => b.tabIndex === 0).length);
  check('seats: the map is one Tab stop; arrows, Home/End and Ctrl+Home/End move focus by row and column', JSON.stringify(moves) === '["E03","F03","F02","E02","E11","E01","J11","A01"]' && tabStops === 1, { moves, tabStops });
  await page.keyboard.press('Enter');
  const afterEnter = (await seatsState(page)).selected.includes('A01');
  await page.keyboard.press('Space');
  const afterSpace = (await seatsState(page)).selected.includes('A01');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const reservedFocus = await focused();
  await page.keyboard.press('Enter');
  const reservedLabel = await page.getAttribute('button[data-seat="A04"]', 'aria-label');
  const reservedDisabled = await page.getAttribute('button[data-seat="A04"]', 'aria-disabled');
  const live = await page.textContent('[data-seat-announcer]');
  check(
    'seats: Enter selects, Space deselects; a reserved seat is announced and cannot be toggled',
    afterEnter && !afterSpace && reservedFocus === 'A04' && !(await seatsState(page)).selected.includes('A04') &&
      /đã đặt/.test(reservedLabel) && reservedDisabled === 'true' && /A04 đã được đặt/.test(live),
    { reservedLabel, live },
  );
  await screenshot(page, 'seats-2-keyboard-focus');

  // Opening the map stops walking where the camera is, and keys pressed in the map never move the
  // camera. (Prompt 06 pressed them while walking; the map is no longer on screen while walking.)
  await closeSeatPanel(page);
  await clickUi(page, 'button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const walking = (await state(page)).view.camera.position;
  await openSeatPanel(page);
  const switched = await state(page);
  await focusUi(page, 'button[data-seat][tabindex="0"]');
  for (const key of ['ArrowUp', 'ArrowLeft', 'KeyW']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(250);
    await page.keyboard.up(key);
  }
  const keyed = await state(page);
  check('seats: opening the map stops walking where the camera is; keys in the map do not move the camera', !switched.exploring && switched.view.owner !== 'driver' && distance(walking, switched.view.camera.position) < 0.05 && JSON.stringify(switched.view.camera.position) === JSON.stringify(keyed.view.camera.position), {
    walking,
    switched: switched.view.camera.position,
    keyed: keyed.view.camera.position,
  });
  await selectPreset(page, 'overview');

  // The limit: 8 seats, the 9th is refused with a message, nothing is lost.
  await clickUi(page, 'button[data-action="clear-selection"]');
  const eight = ['A01', 'A02', 'A03', 'A06', 'A07', 'A08', 'A09', 'A10'];
  for (const id of eight) await page.click(`button[data-seat="${id}"]`);
  await page.click('button[data-seat="A11"]');
  s = await seatsState(page);
  const limitText = await page.textContent('.cinema-seats__limit');
  check('seats: the 9th seat is refused with a message and the 8 stay selected', JSON.stringify(s.selected) === JSON.stringify(eight) && /tối đa|Đã đủ 8/.test(limitText), { limitText });
  await page.evaluate(() => document.querySelector('.cinema-seats__limit').scrollIntoView({ block: 'nearest' }));
  await screenshot(page, 'seats-3-limit-reached');
  await page.click('button[data-remove-seat="A03"]');
  const afterRemove = (await seatsState(page)).selected;
  await clickUi(page, 'button[data-action="clear-selection"]');
  s = await seatsState(page);
  check('seats: removing one and clearing all work, reservations unchanged', !afterRemove.includes('A03') && afterRemove.length === 7 && s.selected.length === 0 && s.reserved === reservedCount);

  // Looking at a reserved seat makes it active without selecting it. (aria-disabled seats stay
  // clickable for users; Playwright treats them as disabled, hence `force`.)
  await page.click('button[data-seat="C08"]', { force: true });
  const infoStatus = await page.textContent('[data-seat-status]');
  s = await seatsState(page);
  check('seats: a reserved seat can be the active one (details, view) but is never selected', s.active === 'C08' && s.selected.length === 0 && /Đã đặt/.test(infoStatus), { infoStatus });

  // While the tour plays, the first click only stops it; the next one selects.
  await startTour(page);
  await page.waitForTimeout(1500);
  const duringTour = await seatPoint(page, 'G03');
  await page.mouse.click(duringTour.x, duringTour.y);
  await nextFrames(page);
  const firstClick = await state(page);
  await waitForCameraToSettle(page);
  const target = ['G03', 'G04', 'G05', 'H07', 'I05'];
  let selectedAfterSecond = null;
  for (const id of target) {
    if (await clickSeat3d(page, id)) {
      selectedAfterSecond = id;
      break;
    }
  }
  check('seats: the first click during the tour only stops it; the next click selects', !firstClick.touring && firstClick.seats.selected.length === 0 && selectedAfterSecond && (await seatsState(page)).selected.includes(selectedAfterSecond), {
    selectedAfterSecond,
  });
  await clickUi(page, 'button[data-action="clear-selection"]');
  await selectPreset(page, 'overview');

  // Seat views from the panel: pose from seatViewPose, caption with the ID, selection kept; back.
  await page.click('button[data-seat="D09"]');
  const keep = (await seatsState(page)).selected;
  report.seats.views = {};
  for (const id of ['A01', 'A06', 'F06', 'J06', 'J11']) {
    await page.focus(`button[data-seat="${id}"]`);
    await clickUi(page, 'button[data-action="view-from-seat"]');
    await page.waitForFunction(() => window.__cinema.getState().view.state === 'seat', null, { timeout: 8000 });
    await nextFrames(page);
    const view = (await state(page)).view;
    const pose = await page.evaluate(async (seatId) => {
      const { seatViewPose } = await import('/src/cinema/seatView.ts');
      const { layout } = window.__cinema;
      return seatViewPose(layout, layout.seatById.get(seatId));
    }, id);
    const caption = await page.textContent('.cinema-caption');
    report.seats.views[id] = { position: view.camera.position, caption };
    check(
      `seats: "Xem từ ghế này" at ${id}: eye at seatViewPose, caption names the seat, selection kept`,
      distance(view.camera.position, [pose.position.x, pose.position.y, pose.position.z]) < 1e-6 && caption.includes(`Ghế ${id}`) &&
        JSON.stringify((await seatsState(page)).selected) === JSON.stringify(keep) && view.seatView === id,
      { caption },
    );
    await screenshot(page, `seat-view-from-${id}`);
  }
  // Looking around keeps the eye where it is.
  const eye = (await state(page)).view.camera.position;
  const box = await page.locator('.cinema-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  const looked = await state(page);
  check('seats: dragging in a seat view turns the head; the eye stays within 5 cm and the state stays "seat"', distance(eye, looked.view.camera.position) < 0.06 && looked.view.state === 'seat', {
    moved: distance(eye, looked.view.camera.position),
  });
  await page.click('button[data-action="return"]');
  await page.waitForFunction(() => window.__cinema.getState().view.state === 'preset', null, { timeout: 8000 });
  const back = await state(page);
  check('seats: "Trở về" goes back to the view the seat view was opened from (overview), no tour', back.preset === 'overview' && !back.touring && (await page.isHidden('button[data-action="return"]')));

  // The sidebar opens over the room: the canvas keeps its size. A narrower window resizes it, and
  // picking follows the new rect.
  await clickUi(page, 'button[data-action="clear-selection"]');
  await closeSeatPanel(page);
  await page.waitForTimeout(300);
  const wide = (await state(page)).view.drawingBuffer.width;
  const pickedWide = await clickSeat3d(page, 'E09');
  await openSeatPanel(page);
  await page.waitForTimeout(300);
  const withPanel = (await state(page)).view.drawingBuffer.width;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1100, height: size.height });
  await page.waitForTimeout(400);
  const narrow = (await state(page)).view.drawingBuffer.width;
  const pickedNarrow = await clickFirstVisible(page, ['G04', 'G03', 'F02']);
  s = await seatsState(page);
  await page.setViewportSize(size);
  await page.waitForTimeout(400);
  check(
    'seats: the sidebar opens over the room without resizing the canvas; a narrower window resizes it and picking stays exact',
    pickedWide && pickedNarrow && withPanel === wide && wide > narrow && s.selected.includes('E09') && s.selected.includes(pickedNarrow),
    { wide, withPanel, narrow, pickedNarrow, selected: s.selected },
  );

  // Quality switch: same selection, same look, picking still maps to the right seats.
  await setQuality(page, 'economy');
  await nextFrames(page);
  const economyLook = await seatLook(page, 'E09');
  const pickedEconomy = await clickFirstVisible(page, ['F08', 'E05', 'D06', 'C06', 'G07']);
  s = await seatsState(page);
  check('seats: after switching to Economy the selection and its tags remain and picking maps correctly', economyLook.tag && pickedEconomy && s.selected.includes(pickedEconomy) && s.selected.length === 3, {
    pickedEconomy,
    selected: s.selected,
  });
  await setQuality(page, 'high');
  await nextFrames(page);

  // Occlusion: from the section view, a visible right wall blocks every seat; hidden, it does not.
  await selectPreset(page, 'side');
  await togglePart(page, 'rightWall');
  await nextFrames(page);
  // The helper finds no point that picks D11 (the wall is in front) and returns its projection.
  const blocked = await seatPoint(page, 'D11');
  const beforeWall = JSON.stringify((await seatsState(page)).selected);
  if (blocked.x && blocked.y) await page.mouse.click(blocked.x, blocked.y);
  await nextFrames(page);
  const throughWall = JSON.stringify((await seatsState(page)).selected) !== beforeWall;
  await togglePart(page, 'rightWall');
  await nextFrames(page);
  const pickedCut = await clickSeat3d(page, 'D11');
  check('seats: no picking through a visible wall; with the wall hidden the seat is picked', !blocked.visible && !throughWall && pickedCut && (await seatsState(page)).selected.includes('D11'), {
    blocked,
  });
  await selectPreset(page, 'overview');

  // Idle: selection changes render once, then nothing.
  await page.click('button[data-seat="B10"]');
  await waitForIdleFrames(page, 'seats: after a selection change');

  // Resources after many select/deselect rounds and quality switches.
  const memoryBefore = (await state(page)).view.memory;
  for (let round = 0; round < 15; round++) {
    await page.click('button[data-seat="B09"]');
    await page.click('button[data-seat="B09"]');
  }
  for (const level of ['economy', 'high', 'economy', 'high']) {
    await setQuality(page, level);
    await nextFrames(page);
  }
  const memoryAfter = (await state(page)).view.memory;
  report.seats.memory = { before: memoryBefore, after: memoryAfter };
  check('seats: 30 selection changes and 4 quality switches leave geometries, textures and programs unchanged', JSON.stringify(memoryBefore) === JSON.stringify(memoryAfter), report.seats.memory);

  // Rendering cost with seats selected (one extra draw call for the tags) and picking cost.
  report.seats.costWithSelection = await page.evaluate(() => window.__cinema.measureCost());
  report.seats.picking = await page.evaluate(() => window.__cinema.measurePicking(300));
  check('seats: picking stays under 2 ms (p95) per query', report.seats.picking.p95Ms < 2, report.seats.picking);

  // Seat inspector and back: the selection outlives the page; no duplicated subscriptions.
  const keepIds = (await seatsState(page)).selected;
  const listeners = (await seatsState(page)).listeners;
  await openInspectTools(page);
  await clickUi(page, 'button[data-action="open-inspector"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  await nextFrames(page);
  s = await seatsState(page);
  const keptLook = await seatLook(page, keepIds[0]);
  check('seats: selection survives opening and closing the seat inspector, painted again, same subscriber count', JSON.stringify(s.selected) === JSON.stringify(keepIds) && keptLook.tag && s.listeners === listeners, {
    selected: s.selected,
    listeners: s.listeners,
  });
  await clickUi(page, 'button[data-action="clear-selection"]');
  await closeSeatPanel(page);
}

// Phone (the control hub, Prompt 13): real taps on seats in the full-screen room, the full-screen map
// from the hub, two-finger and cancelled touches, the stick with a second finger, turning the phone
// with the map open, Escape returning focus to the hub's button.
async function mobileSeatChecks(page, context) {
  const cdp = await context.newCDPSession(page);
  await selectPreset(page, 'overview');
  await page.waitForTimeout(300);
  const tapAt = async (p) => {
    await touch(cdp, 'touchStart', [[p.x, p.y, 1]]);
    await page.waitForTimeout(60);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(100);
  };
  let p = await firstVisibleSeat(page);
  if (p) await tapAt(p);
  let s = await seatsState(page);
  check('mobile: a real tap on a seat in 3D selects it (the room in full view)', p && s.selected.includes(p.id), { p, selected: s.selected });
  const tapped = p?.id;
  await openSeatPanel(page);
  await page.tap('button[data-seat="B07"]');
  s = await seatsState(page);
  check('mobile: tapping a seat in the map selects it', s.selected.includes('B07'));
  const overflow = await page.evaluate(() => {
    const map = document.querySelector('.cinema-map');
    const seat = document.querySelector('.cinema-seat').getBoundingClientRect();
    return { scrolls: map.scrollWidth > map.clientWidth, seat: { width: seat.width, height: seat.height }, page: document.documentElement.scrollWidth - innerWidth };
  });
  check('mobile: seats stay ≥ 36 px; the map scrolls sideways instead of shrinking, the page does not', overflow.seat.width >= 36 && overflow.page <= 0, overflow);
  await screenshot(page, 'seats-4-mobile-map');
  await closeSeatPanel(page);

  const before = JSON.stringify((await seatsState(page)).selected);
  // Two fingers, one on a seat, lifted one after the other.
  p = await firstVisibleSeat(page, [tapped, 'B07']);
  await touch(cdp, 'touchStart', [[p.x, p.y, 1]]);
  await touch(cdp, 'touchStart', [[p.x, p.y, 1], [p.x + 80, p.y - 40, 2]]);
  await page.waitForTimeout(80);
  await touch(cdp, 'touchEnd', [[p.x, p.y, 1]]);
  await page.waitForTimeout(80);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(150);
  const twoFingers = JSON.stringify((await seatsState(page)).selected) === before;
  // A touch that is cancelled.
  await touch(cdp, 'touchStart', [[p.x, p.y, 1]]);
  await touch(cdp, 'touchCancel', []);
  await page.waitForTimeout(100);
  const cancelled = JSON.stringify((await seatsState(page)).selected) === before;
  // A drag that starts on a seat.
  await touchDrag(cdp, page, [p.x, p.y], [60, 10]);
  await waitForCameraToSettle(page);
  const dragged = JSON.stringify((await seatsState(page)).selected) === before;
  check('mobile: two-finger, cancelled and dragging touches never select', twoFingers && cancelled && dragged, { twoFingers, cancelled, dragged });
  await selectPreset(page, 'overview');

  // Exploring: a thumb on the stick and a second finger on a seat does not select.
  await tapUi(page, 'button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  const stick = await page.locator('.cinema-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  // A seat in reach from where walking starts (the view's shape decides which ones are on screen).
  const near = await page.evaluate(() => {
    for (const id of ['J07', 'J08', 'I07', 'I08', 'J09', 'H07', ...window.__cinema.layout.seats.map((seat) => seat.id).reverse()]) {
      const point = window.__cinema.seatScreenPoint(id);
      if (point.visible) return { id, ...point };
    }
    return null;
  });
  if (near) {
    await touch(cdp, 'touchStart', [[sx, sy, 1]]);
    await touch(cdp, 'touchStart', [[sx, sy, 1], [near.x, near.y, 2]]);
    await page.waitForTimeout(80);
    await touch(cdp, 'touchEnd', [[sx, sy, 1]]);
    await page.waitForTimeout(80);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(150);
  }
  check('mobile: stick + a finger on a seat (walk and look) does not select', near && JSON.stringify((await seatsState(page)).selected) === before, near);
  await tapUi(page, 'button[data-action="explore"]');
  await selectPreset(page, 'overview');

  // Turned with the map open: it stays the full-screen dialog (no half-map on a phone); closed, a
  // tap in the landscape room still picks the right seat.
  await openSeatPanel(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const rotated = await page.evaluate(() => ({ panel: document.querySelector('.cinema-app').dataset.panel, modal: document.querySelector('#cinema-seat-panel').getAttribute('aria-modal'), overflow: document.documentElement.scrollWidth - innerWidth }));
  await screenshot(page, 'seats-5-mobile-landscape');
  await closeSeatPanel(page);
  await page.waitForTimeout(300);
  const landscape = await layoutChecks(page, 'mobile landscape after the map', { minShare: 0.9 });
  const lp = await firstVisibleSeat(page, (await seatsState(page)).selected);
  if (lp) await tapAt(lp);
  check('mobile: turned to landscape with the map open it stays the full-screen dialog; closed, a tap in 3D still picks the right seat', rotated.panel === 'expanded' && rotated.modal === 'true' && rotated.overflow <= 0 && lp && (await seatsState(page)).selected.includes(lp.id) && landscape.overflowX <= 0, { rotated, lp });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // Escape in the full-screen map closes it and focus goes back to the hub's button.
  await openSeatPanel(page);
  await page.focus('button[data-seat][tabindex="0"]');
  await page.keyboard.press('Escape');
  const closed = await page.isHidden('#cinema-seat-panel');
  const focusBack = await page.evaluate(() => document.activeElement?.dataset?.action ?? null);
  check('mobile: Escape in the full-screen map closes it and returns focus to the control hub\'s button', closed && focusBack === 'hub', { focusBack });
  await openSeatPanel(page);
  await clickUi(page, 'button[data-action="clear-selection"]');
  await closeSeatPanel(page);
}

// Several context loss/restore cycles with seats selected: state kept and repainted, and nothing
// from the old contexts piling up: live three.js objects after GC, page listeners, renderer
// resources, JS heap. (CDP counts objects by prototype; it cannot see GPU memory.)
async function lifecycleChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  attachConsole(page, 'lifecycle');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const count = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const objects = {};
    for (const type of ['BufferGeometry', 'Material', 'Texture', 'Object3D', 'WebGLRenderTarget', 'MediaController', 'HTMLVideoElement']) {
      const { result: proto } = await cdp.send('Runtime.evaluate', { expression: `window.__cinema.types.${type}.prototype` });
      const { objects: list } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
      const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: list.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
      objects[type] = result.value;
      await cdp.send('Runtime.releaseObject', { objectId: list.objectId });
      await cdp.send('Runtime.releaseObject', { objectId: proto.objectId });
    }
    const listeners = {};
    for (const [name, expression] of [['window', 'window'], ['document', 'document'], ['canvas', "document.querySelector('.cinema-canvas')"]]) {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      listeners[name] = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    }
    const heap = await cdp.send('Runtime.getHeapUsage');
    const s = await state(page);
    return {
      objects,
      listeners,
      heapMiB: Number((heap.usedSize / 2 ** 20).toFixed(2)),
      memory: s.view.memory,
      subscribers: s.seats.listeners,
      pageTextureListeners: s.view.pageTextureListeners,
    };
  };
  await page.click('button[data-seat="C03"]').catch(async () => {
    await openSeatPanel(page);
    await page.click('button[data-seat="C03"]');
  });
  await openSeatPanel(page);
  for (const id of ['D05', 'H09']) await page.click(`button[data-seat="${id}"]`);
  // Warm up: every preset and both levels once, so later counts are steady state.
  for (const id of ['overview', 'seats', 'seatEye', 'overview']) await selectPreset(page, id);
  const cycle = async () => {
    await page.evaluate(() => {
      window.__lose = document.querySelector('.cinema-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
    await page.evaluate(() => window.__lose.restoreContext());
    await waitForStatus(page);
    await nextFrames(page);
  };
  await cycle();
  // Warm-up also covers a quality round trip: the first switch compiles 3 more shader variants
  // (after a restore only what is drawn is compiled); from then on the count stays put.
  await setQuality(page, 'economy');
  await nextFrames(page);
  await setQuality(page, 'high');
  await nextFrames(page);
  const first = await count();
  const selectedBefore = (await seatsState(page)).selected;
  for (let i = 0; i < 4; i++) {
    await cycle();
    await setQuality(page, 'economy');
    await nextFrames(page);
    await setQuality(page, 'high');
    await nextFrames(page);
  }
  const last = await count();
  const selectedAfter = (await seatsState(page)).selected;
  const look = await seatLook(page, 'D05');
  report.lifecycle = { afterFirstRestore: first, afterFiveRestores: last };
  check('lifecycle: selection survives 5 loss/restore cycles and is painted on the rebuilt seats', JSON.stringify(selectedBefore) === JSON.stringify(selectedAfter) && look.tag);
  await page.click('button[data-seat="D05"]');
  check('lifecycle: deselecting after the restores updates the new instances', !(await seatLook(page, 'D05')).tag);
  check('lifecycle: no growth in live geometries, materials, textures, objects or render targets after 4 more restores (GC)', JSON.stringify(first.objects) === JSON.stringify(last.objects), report.lifecycle);
  check('lifecycle: no growth in window/document/canvas listeners or selection subscribers', JSON.stringify(first.listeners) === JSON.stringify(last.listeners) && first.subscribers === last.subscribers, {
    first: first.listeners,
    last: last.listeners,
  });
  check('lifecycle: renderer resources steady after warm-up', JSON.stringify(first.memory) === JSON.stringify(last.memory), { first: first.memory, last: last.memory });
  check(
    'lifecycle: page-wide three.js textures keep one dispose listener (the live context), none from lost ones',
    last.pageTextureListeners.length >= 4 && last.pageTextureListeners.every((n) => n <= 1),
    last.pageTextureListeners,
  );
  check('lifecycle: JS heap after GC grows less than 1 MiB over 4 restores (it grew 0.37 MiB per restore before the fix)', last.heapMiB - first.heapMiB < 1, {
    first: first.heapMiB,
    last: last.heapMiB,
  });
  await waitForIdleFrames(page, 'lifecycle: after the restores');

  // Remounts (seat inspector and back) dispose the renderer: nothing of it may stay reachable.
  const go = async (url, selector) => {
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.status === 'ready', selector);
    await nextFrames(page);
  };
  await go('/cinema?inspect=seat', '.cinema-app--inspector');
  await go('/cinema', '.cinema-app');
  const beforeRemounts = await count();
  for (let i = 0; i < 6; i++) {
    await go('/cinema?inspect=seat', '.cinema-app--inspector');
    await go('/cinema', '.cinema-app');
  }
  const afterRemounts = await count();
  report.lifecycle.remounts = { before: beforeRemounts, afterSixRoundTrips: afterRemounts };
  check(
    'lifecycle: 6 inspector round trips leave live three.js objects, listeners and subscribers unchanged; heap +< 1 MiB',
    JSON.stringify(beforeRemounts.objects) === JSON.stringify(afterRemounts.objects) &&
      JSON.stringify(beforeRemounts.listeners) === JSON.stringify(afterRemounts.listeners) &&
      beforeRemounts.subscribers === afterRemounts.subscribers && afterRemounts.heapMiB - beforeRemounts.heapMiB < 1,
    report.lifecycle.remounts,
  );
  check('lifecycle: selection kept across the round trips', JSON.stringify((await seatsState(page)).selected) === JSON.stringify(selectedAfter.filter((id) => id !== 'D05')));
  await context.close();
}

// The on-demand loop must stop once the camera settles; then time a fixed camera path.
async function measurePerformance(page, label) {
  await selectPreset(page, 'overview');
  await page.waitForTimeout(300);
  const before = (await state(page)).view.framesRendered;
  await page.waitForTimeout(1000);
  const after = (await state(page)).view.framesRendered;
  check(`${label}: no new frames while the camera is idle (1 s)`, after === before, { before, after });
  const timing = await page.evaluate(() => window.__cinema.measureFrames(120));
  const s = await state(page);
  report.frameTiming.push({ label, pixelRatio: s.view.pixelRatio, drawingBuffer: s.view.drawingBuffer, ...timing });
  await selectPreset(page, 'overview');
}

// From the "seats" preset, zoom towards the front rows to see the detailed seats in place.
async function seatCloseUp(page) {
  await selectPreset(page, 'seats');
  const box = await page.locator('.cinema-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.72);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -250);
  await waitForCameraToSettle(page);
  await screenshot(page, 'desktop-7-seats-close-up');
}

async function seatInspector(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachConsole(page, 'seat-inspector');
  await page.goto(`${base}cinema?inspect=seat`);
  const status = await waitForStatus(page);
  check('inspector: /cinema?inspect=seat reaches "ready"', status === 'ready', status);
  if (status !== 'ready') {
    await screenshot(page, 'seat-error');
    await context.close();
    return;
  }
  await waitForInspectorIdle(page);
  let s = await inspectorState(page);
  const auditoriumMounted = await page.evaluate(() => Boolean(window.__cinema));
  check('inspector: one canvas and no auditorium renderer alongside it', s.canvasCount === 1 && !auditoriumMounted, {
    canvasCount: s.canvasCount,
    auditoriumMounted,
  });

  // The page keeps to its title, "Tùy chọn" and "Đóng"; the switches and the quality wait in one
  // panel (Escape closes it first, back on "Tùy chọn"); a hand over the view says it turns, words
  // only for screen readers, and leaves on the first drag.
  const page1 = await page.evaluate(() => {
    const header = document.querySelector('.cinema-app--inspector .cinema-header');
    const hint = document.querySelector('.cinema-gesture');
    return {
      headerButtons: [...header.querySelectorAll(':scope > .cinema-inspector__actions button')].map((b) => b.textContent.trim()),
      visibleControls: [...document.querySelectorAll('.cinema-app--inspector button, .cinema-app--inspector input')].filter((e) => e.checkVisibility()).length,
      viewButtons: document.querySelectorAll('button[data-view]').length,
      panelHidden: document.querySelector('#cinema-inspector-options').hidden,
      hint: Boolean(hint) && hint.checkVisibility({ opacityProperty: true }),
      words: document.querySelector('.cinema-app--inspector .visually-hidden')?.textContent.includes('Kéo để xoay') ?? false,
      caption: Boolean(document.querySelector('.cinema-app--inspector .cinema-caption')),
    };
  });
  check('inspector: header is the title, "Tùy chọn" and "Đóng" only (no view buttons); a turn hint over the view, its words kept for screen readers', JSON.stringify(page1.headerButtons) === JSON.stringify(['Tùy chọn', 'Đóng']) && page1.visibleControls === 2 && page1.viewButtons === 0 && page1.panelHidden && page1.hint && page1.words && !page1.caption, page1);
  await page.click('button[data-action="inspector-options"]');
  const panelOpen = await page.evaluate(() => ({
    expanded: document.querySelector('[data-action="inspector-options"]').getAttribute('aria-expanded'),
    rows: [...document.querySelectorAll('#cinema-inspector-options .cinema-hub__row')].filter((r) => r.checkVisibility()).map((r) => r.querySelector('.cinema-hub__label, .cinema-switch__label')?.textContent),
  }));
  await screenshot(page, 'seat-0-options');
  await page.keyboard.press('Escape');
  const afterEscape1 = await page.evaluate(() => ({ panelHidden: document.querySelector('#cinema-inspector-options').hidden, focus: document.activeElement?.dataset.action, stillOpen: Boolean(document.querySelector('.cinema-app--inspector')) }));
  check('inspector: "Tùy chọn" opens one panel (Chất lượng, 3 ghế, Footprint, Kích thước); Escape closes it first, focus back on "Tùy chọn"', panelOpen.expanded === 'true' && JSON.stringify(panelOpen.rows) === JSON.stringify(['Chất lượng', '3 ghế', 'Footprint', 'Kích thước']) && afterEscape1.panelHidden && afterEscape1.focus === 'inspector-options' && afterEscape1.stillOpen, { panelOpen, afterEscape1 });
  const viewBox = await page.locator('.cinema-viewport').boundingBox();
  await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewBox.x + viewBox.width / 2 + 160, viewBox.y + viewBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  check('inspector: the turn hint leaves on the first drag', !(await page.evaluate(() => Boolean(document.querySelector('.cinema-gesture')))));

  for (const [id, file] of [
    ['front', 'seat-1-front-34'],
    ['side', 'seat-2-side'],
    ['back', 'seat-3-back-34'],
    ['cup', 'seat-4-cup-holder'],
  ]) {
    await selectInspectorView(page, id);
    if (id === 'front') report.seatInspector = { renderer: { ...(await inspectorState(page)).inspector.render } };
    await screenshot(page, file);
  }

  const m = (await inspectorState(page)).inspector.measured;
  report.seatInspector.measured = m;

  // Both levels in the inspector, same view; the measured seat must not change.
  await selectInspectorView(page, 'front');
  const highState = (await inspectorState(page)).inspector;
  await setQuality(page, 'economy');
  await nextFrames(page);
  const economyState = (await inspectorState(page)).inspector;
  await screenshot(page, 'seat-7-front-economy');
  report.seatInspector.trianglesPerSeat = { high: highState.trianglesPerSeat, economy: economyState.trianglesPerSeat };
  const sizeDelta = Math.max(...['width', 'depth', 'height', 'seatHeight'].map((key) => Math.abs(economyState.measured[key] - highState.measured[key])));
  check(
    'inspector: Economy seat has ≤ half the triangles and measures within 1 cm of High',
    economyState.quality === 'economy' && economyState.trianglesPerSeat <= highState.trianglesPerSeat / 2 && sizeDelta <= 0.01 &&
      (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 1,
    { trianglesPerSeat: report.seatInspector.trianglesPerSeat, sizeDelta },
  );
  await setQuality(page, 'high');
  await selectInspectorView(page, 'side');
  check(
    'inspector: measured seat fits the brief (W 0.72–0.76, D ≤ 0.75, H 1.05–1.15, seat 0.43–0.47, cushion 0.48–0.52 m)',
    m.width >= 0.72 && m.width <= 0.76 && m.depth <= 0.75 && m.height >= 1.05 && m.height <= 1.15 &&
      m.seatHeight >= 0.43 && m.seatHeight <= 0.47 && m.cushionWidth >= 0.48 && m.cushionWidth <= 0.52,
    m,
  );
  check('inspector: gap to the neighbouring seat', m.gapToNeighbour >= 0.02, m.gapToNeighbour);

  await clickUi(page, 'label:has(input[data-toggle="cluster"])');
  await selectInspectorView(page, 'front');
  s = await inspectorState(page);
  check('inspector: cluster shows three seats', s.inspector.seats === 3, s.inspector.seats);
  await screenshot(page, 'seat-5-cluster-front');
  await clickUi(page, 'label:has(input[data-toggle="footprint"])');
  await clickUi(page, 'label:has(input[data-toggle="dimensions"])');
  await selectInspectorView(page, 'top');
  s = await inspectorState(page);
  const dimensionsShown = await page.isVisible('.cinema-dimensions');
  check('inspector: footprint and dimensions overlays', s.inspector.footprint && s.inspector.bounds && dimensionsShown);
  await screenshot(page, 'seat-6-cluster-top-footprint');

  // Close: back to the auditorium in the same page, with the inspector's renderer released.
  await page.evaluate(() => {
    window.__oldCanvas = document.querySelector('.cinema-canvas');
    window.__oldGl = window.__oldCanvas.getContext('webgl2');
  });
  await page.click('button[data-action="close"]');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  const closed = await page.evaluate(() => ({
    url: location.pathname + location.search,
    canvasCount: document.querySelectorAll('canvas').length,
    oldCanvasAttached: window.__oldCanvas.isConnected,
    oldContextReleased: window.__oldGl.isContextLost(),
    inspectorHook: Boolean(window.__seatInspector),
  }));
  check(
    'inspector: closing returns to /cinema and releases the inspector renderer',
    closed.url === '/cinema' && closed.canvasCount === 1 && !closed.oldCanvasAttached && closed.oldContextReleased && !closed.inspectorHook,
    closed,
  );

  // Browser back reopens the inspector; Escape closes it again.
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  const afterEscape = await page.evaluate(() => ({
    url: location.pathname + location.search,
    canvasCount: document.querySelectorAll('canvas').length,
  }));
  check(
    'inspector: back reopens it and Escape closes it, still one canvas',
    afterEscape.url === '/cinema' && afterEscape.canvasCount === 1,
    afterEscape,
  );
  await context.close();
}

// Runs on its own page: after a restore, three.js r186 still holds dispose listeners from the lost
// context, so unmounting later logs harmless "object does not belong to this context" warnings.
async function contextLoss(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const page = await context.newPage();
  attachConsole(page, 'context-loss');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  const lose = () =>
    page.evaluate(() => {
      window.__loseContext = document.querySelector('.cinema-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__loseContext.loseContext();
    });
  const restore = async () => {
    await page.evaluate(() => window.__loseContext.restoreContext());
    await waitForStatus(page);
    await nextFrames(page);
  };

  // While the tour plays: it stops (nothing moves unseen), and stays stopped after the restore.
  await startTour(page);
  await page.waitForTimeout(2000);
  await lose();
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  const lostDuringTour = await state(page);
  await restore();
  const afterTourRestore = await state(page);
  check('context loss during the tour stops it; the restore does not restart it', !lostDuringTour.touring && !afterTourRestore.touring && afterTourRestore.view.tour === null);

  // While walking with a key held: input is dropped, nothing moves after the restore.
  await clickUi(page, 'button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await lose();
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  await page.keyboard.up('KeyW');
  await restore();
  const restoredWalker = (await state(page)).view.explore.walker;
  await page.waitForTimeout(500);
  const laterWalker = (await state(page)).view.explore.walker;
  check('context loss while walking drops held input; after the restore nothing moves by itself', JSON.stringify(restoredWalker) === JSON.stringify(laterWalker));
  await clickUi(page, 'button[data-action="explore"]');
  // Resources from before the loss are rebuilt, so a quality switch now deletes nothing stale
  // (the console check at the end fails on any "does not belong to this context").
  await setQuality(page, 'economy');
  await setQuality(page, 'high');
  await nextFrames(page);

  // Lose the context after a quality change and a hidden ceiling: both must survive the restore.
  await setQuality(page, 'economy');
  await togglePart(page, 'ceiling');
  await nextFrames(page);
  const beforeLoss = await state(page);
  await page.evaluate(() => {
    const gl = document.querySelector('.cinema-canvas').getContext('webgl2');
    window.__loseContext = gl.getExtension('WEBGL_lose_context');
    window.__loseContext.loseContext();
  });
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  const lostMessage = await page.textContent('.cinema-status');
  check('context loss is reported to the user', /Mất ngữ cảnh WebGL/.test(lostMessage), lostMessage);
  await page.evaluate(() => window.__loseContext.restoreContext());
  const restored = await waitForStatus(page);
  await nextFrames(page);
  const afterRestore = await state(page);
  check(
    'context restore keeps Economy and the hidden ceiling, and redraws the shadow map',
    afterRestore.view.quality === 'economy' && afterRestore.visibility.ceiling === false &&
      afterRestore.view.shadow.renders > beforeLoss.view.shadow.renders && afterRestore.view.lights['inspection-light']?.on,
    { quality: afterRestore.view.quality, shadow: afterRestore.view.shadow, visibility: afterRestore.visibility },
  );
  await screenshot(page, 'context-restored-economy');
  await selectPreset(page, 'seats');
  check('rendering and presets resume after context restore', restored === 'ready', restored);
  // Unmounting after a restore (opening the inspector) used to log ~190 stale-handle warnings.
  await openInspectTools(page);
  await clickUi(page, 'button[data-action="open-inspector"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await context.close();

  // The seat inspector rebuilds its environment and shadows the same way.
  const inspectorContext = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const inspector = await inspectorContext.newPage();
  attachConsole(inspector, 'inspector-context-loss');
  await inspector.goto(`${base}cinema?inspect=seat`);
  await waitForStatus(inspector);
  await inspector.evaluate(() => {
    window.__loseContext = document.querySelector('.cinema-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    window.__loseContext.loseContext();
  });
  await inspector.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  await inspector.evaluate(() => window.__loseContext.restoreContext());
  const inspectorRestored = await waitForStatus(inspector);
  await selectInspectorView(inspector, 'side');
  check('inspector: renders again after context restore', inspectorRestored === 'ready', inspectorRestored);
  await screenshot(inspector, 'seat-8-after-context-restore');
  await inspectorContext.close();
}

async function webglFailure(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args);
    };
  });
  const page = await context.newPage();
  attachConsole(page, 'webgl-disabled');
  await page.goto(`${base}cinema`);
  const status = await waitForStatus(page, 10_000).catch(() => 'timeout');
  const message = await page.textContent('.cinema-status').catch(() => '');
  // Camera and display controls go (with the reason); seat selection becomes the task, its map stays.
  const disabled = await page.$$eval(
    '[data-dock="explore"] button, #cinema-hub-panel button[data-preset], #cinema-hub-panel button[data-quality], #cinema-hub-panel input[data-toggle]:not([data-toggle="glass"]), button[data-action="open-inspector"]',
    (controls) => controls.length > 8 && controls.every((b) => b.disabled),
  );
  const reason = await page.textContent('[data-dock="explore"] .cinema-dock__note');
  // "Giảm hiệu ứng kính" is about the page, not the scene: it stays usable.
  const glass = await page.isEnabled('input[data-toggle="glass"]');
  check('WebGL unavailable: shows an error instead of loading forever', status === 'error', { status, message });
  check('WebGL unavailable: camera, display and inspection controls are disabled, with the reason in Khám phá ("Giảm hiệu ứng kính" stays usable)', disabled && glass && /Không có cảnh 3D/.test(reason) && (await currentTask(page)) === 'seats', { reason, glass });
  const panelOpen = await page.isVisible('#cinema-seat-panel');
  await page.click('button[data-seat="F04"]');
  await page.click('button[data-seat="F05"]');
  const selected = await page.evaluate(() => window.__cinema.getState().seats.selected);
  const viewDisabled = await page.isDisabled('button[data-action="view-from-seat"]');
  const hint = await page.textContent('.cinema-seats__info .cinema-seats__muted:not([hidden]):last-child').catch(() => '');
  check('WebGL unavailable: the seat map is open and works; "Xem từ ghế này" is disabled with the reason', panelOpen && JSON.stringify(selected) === '["F04","F05"]' && viewDisabled && /3D không khả dụng/.test(hint), {
    selected,
    hint,
  });
  await screenshot(page, 'webgl-unavailable');

  // The film without 3D: the same element and controls, shown flat and labelled as 2D.
  const flat = await page.evaluate(() => {
    const video = document.querySelector('.cinema-video2d video');
    return {
      videos: document.querySelectorAll('video').length,
      label: document.querySelector('.cinema-video2d__label')?.textContent ?? '',
      visible: Boolean(video && video.getBoundingClientRect().height > 100),
      controls: video?.controls ?? null,
    };
  });
  await page.click('button[data-seat="F04"]');
  await closeSeatPanel(page);
  await clickUi(page, PRIMARY);
  await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'playing', null, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => window.__cinema.film());
  check('WebGL unavailable: the film plays in 2D (one element, labelled 2D mode, same controls), seat map still works', flat.videos === 1 && flat.visible && /chế độ 2D/.test(flat.label) && playing.snapshot.currentTime > 1 && playing.playback.decoded > 20 && playing.inDocument, {
    flat,
    currentTime: playing.snapshot.currentTime,
  });
  await screenshot(page, 'film-14-2d-fallback');
  await clickUi(page, PRIMARY);
  await context.close();
}

// Pairs of screenshots side by side: Prompt 03 baseline vs now (same cameras), and High vs Economy.
async function comparisons(browser) {
  const pairs = [];
  const baselineDir = path.join(outDir, 'baseline');
  for (const file of [
    'desktop-1-overview',
    'desktop-2-seats',
    'desktop-4-seat-eye',
    'tablet-1-overview',
    'tablet-2-seats',
    'mobile-1-overview',
    'mobile-2-seats',
    'mobile-4-seat-eye',
  ]) {
    const before = path.join(baselineDir, `${file}.png`);
    if (existsSync(before)) pairs.push([`compare-p08-p09-${file}`, [['Prompt 08 (baseline)', before], ['Prompt 09', path.join(outDir, `${file}.png`)]]]);
  }
  for (const name of ['overview', 'seat-eye', 'seat-leather', 'graphite-grazing']) {
    pairs.push([
      `compare-quality-${name}`,
      [
        ['Cao (High)', path.join(outDir, `quality-${name}-high.png`)],
        ['Tiết kiệm (Economy)', path.join(outDir, `quality-${name}-economy.png`)],
      ],
    ]);
  }
  const context = await browser.newContext({ viewport: { width: 1460, height: 520 } });
  const page = await context.newPage();
  for (const [name, panels] of pairs) {
    // Portrait screenshots side by side would be very tall: scale them to the same height.
    const images = await Promise.all(panels.map(async ([label, file]) => [label, (await readFile(file)).toString('base64')]));
    await page.setContent(
      `<body style="margin:0;background:#0f1013;color:#e9eaee;font:14px system-ui;display:flex;gap:20px;padding:0">${images
        .map(([label, data]) => `<figure style="margin:0;max-width:720px"><img style="max-width:720px;max-height:900px;display:block" src="data:image/png;base64,${data}"><figcaption style="padding:6px 8px">${label}</figcaption></figure>`)
        .join('')}</body>`,
    );
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    await screenshot(page, name, { fullPage: true });
  }
  await context.close();
}

// ---------------------------------------------------------------- Prompt 07: the film on the screen

const film = (page) => page.evaluate(() => window.__cinema.film());
const PLAYER = '.cinema-player';
const PRIMARY = 'button[data-action="media-primary"]';

async function waitForFilm(page, states, timeout = 15_000) {
  await page.waitForFunction((list) => list.includes(window.__cinema?.film().snapshot.state), states, { timeout });
  return film(page);
}

/** Renders and presented video frames per second over `ms`, with decoded/dropped frames. */
async function filmRates(page, ms = 2000) {
  const sample = () =>
    page.evaluate(() => {
      const view = window.__cinema.getState().view;
      const f = window.__cinema.film();
      return { renders: view.framesRendered, clock: view.film.clock.frames, playback: f.playback, time: f.snapshot.currentTime, at: performance.now() };
    });
  const a = await sample();
  await page.waitForTimeout(ms);
  const b = await sample();
  const seconds = (b.at - a.at) / 1000;
  const rate = (x) => Number((x / seconds).toFixed(1));
  return {
    seconds: Number(seconds.toFixed(2)),
    rendersPerSecond: rate(b.renders - a.renders),
    videoFramesPerSecond: rate(b.clock - a.clock),
    decoded: b.playback.decoded - a.playback.decoded,
    dropped: b.playback.dropped - a.playback.dropped,
    mediaSeconds: Number((b.time - a.time).toFixed(2)),
  };
}

/** Renders and browser animation frames in the same second (renders may never exceed frames). */
const rendersPerBrowserFrame = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let ticks = 0;
        const start = performance.now();
        const first = window.__cinema.getState().view.framesRendered;
        const loop = (t) => {
          ticks++;
          if (t - start < 1000) requestAnimationFrame(loop);
          else resolve({ ticks, renders: window.__cinema.getState().view.framesRendered - first });
        };
        requestAnimationFrame(loop);
      }),
  );

/** A camera square on to the screen, the whole picture in view. */
const faceScreen = (page) =>
  page.evaluate(() => {
    const { center } = window.__cinema.layout.screen;
    window.__cinema.setCamera({ x: center.x, y: center.y, z: center.z + 7.6 }, { x: center.x, y: center.y, z: center.z }, 'eye');
  });

/** Exact colours of the fixture pattern (scripts/make-media-fixtures.mjs) at picture points (u, v from the lower left). */
const PATTERN_POINTS = [
  ...[
    [255, 255, 255],
    [255, 255, 0],
    [0, 255, 255],
    [0, 255, 0],
    [255, 0, 255],
    [255, 0, 0],
    [0, 0, 255],
  ].map((rgb, i) => ({ name: `bar ${i + 1}`, uv: [(i + 0.5) / 7, 0.66], rgb })),
  ...[0, 64, 128, 192].map((v, i) => ({ name: `grey ${v}`, uv: [(i + 0.5) / 4, 0.31], rgb: [v, v, v] })),
  { name: 'top-left marker (orange)', uv: [0.03, 0.96], rgb: [255, 128, 0] },
];

async function playFilm(page) {
  await clickUi(page, PRIMARY);
  return waitForFilm(page, ['playing']);
}

async function pauseFilm(page) {
  await clickUi(page, PRIMARY);
  return waitForFilm(page, ['paused']);
}

/** The player sits outside the 3D view and the seat panel and covers neither. */
async function playerLayout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden || element.getClientRects().length === 0) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const overlap = (a, b) => Boolean(a && b && a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5);
    const player = rect('.cinema-player');
    const hubPanel = rect('#cinema-hub-panel');
    const stage = rect('.cinema-stage');
    const panel = rect('#cinema-seat-panel');
    const stick = rect('.cinema-stick');
    const back = rect('button[data-action="return"]');
    return {
      player,
      hubPanel,
      inPanel: Boolean(player && hubPanel && player.x >= hubPanel.x - 0.5 && player.right <= hubPanel.right + 0.5 && player.y >= hubPanel.y - 0.5),
      overlaps: { stage: overlap(player, stage), panel: overlap(player, panel), stick: overlap(player, stick), returnButton: overlap(player, back) },
      insideWindow: player ? player.x >= 0 && player.y >= 0 && player.right <= innerWidth + 0.5 && player.bottom <= innerHeight + 0.5 : false,
      playerShare: player ? Number(((player.width * player.height) / (innerWidth * innerHeight)).toFixed(3)) : null,
      stageShare: stage ? Number(((stage.width * stage.height) / (innerWidth * innerHeight)).toFixed(3)) : null,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

/**
 * The first frames the browser presents after `action`, as JPEG data (CDP screencast), each with
 * how varied the middle of the 3D view is: a cleared canvas is one flat colour (deviation ~0).
 */
async function framesAfter(page, action, count = 4) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames.push(data);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 1440 });
  await page.waitForTimeout(300);
  const skip = frames.length;
  await action();
  await page.waitForTimeout(700);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return page.evaluate(async (list) => {
    const stage = document.querySelector('.cinema-stage').getBoundingClientRect();
    const results = [];
    for (const data of list) {
      const image = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob());
      const scale = image.width / innerWidth;
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const x = Math.round((stage.x + stage.width * 0.3) * scale);
      const y = Math.round((stage.y + stage.height * 0.12) * scale);
      const w = Math.round(stage.width * 0.4 * scale);
      const h = Math.round(stage.height * 0.4 * scale);
      const pixels = context.getImageData(x, y, w, h).data;
      let sum = 0;
      let sq = 0;
      const n = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        const l = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        sum += l;
        sq += l * l;
      }
      const mean = sum / n;
      results.push({ mean: Math.round(mean), deviation: Number(Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1)) });
    }
    return results;
  }, frames.slice(skip, skip + count));
}

/** Live objects (after GC) and listeners, through the DevTools protocol. */
async function liveCounts(cdp, types) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const objects = {};
  for (const type of types) {
    const { result: proto } = await cdp.send('Runtime.evaluate', { expression: `(window.__cinema?.types ?? window.__filmTypes).${type}.prototype` });
    const { objects: list } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: list.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    objects[type] = result.value;
    await cdp.send('Runtime.releaseObject', { objectId: list.objectId });
    await cdp.send('Runtime.releaseObject', { objectId: proto.objectId });
  }
  const listeners = {};
  for (const [name, expression] of [['window', 'window'], ['document', 'document']]) {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    listeners[name] = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  const heap = await cdp.send('Runtime.getHeapUsage');
  return { objects, listeners, heapMiB: Number((heap.usedSize / 2 ** 20).toFixed(2)) };
}

// Desktop: waiting screen, no autoplay, play/pause, render rate, seek (paused, playing, while
// dragging), sound, ended/replay, seats and seat view while playing, quality switch, hidden tab,
// keyboard and pointer isolation, context loss, the inspector round trip and the metrics.
async function filmDesktop(browser, base) {
  report.film = { media: {}, metrics: {} };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachConsole(page, 'film-desktop');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  await closeSeatPanel(page);
  await selectPreset(page, 'overview');

  // Waiting screen: poster, nothing playing, nothing rendering.
  await page.waitForFunction(() => window.__cinema.film().view?.screen?.content === 'poster', null, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  let f = await film(page);
  const idle = await filmRates(page, 1500);
  check('film: no autoplay (paused at 0 s, "Phát" offered, 1.5 s after load)', f.paused && f.snapshot.currentTime === 0 && !f.snapshot.started && ['ready', 'loading'].includes(f.snapshot.state) && (await page.getAttribute(PRIMARY, 'aria-label')) === 'Phát', {
    state: f.snapshot.state,
    paused: f.paused,
    currentTime: f.snapshot.currentTime,
  });
  check('film: preload is metadata-only, plays inline, no loop, one element not in the page', await page.evaluate(() => {
    const v = window.__cinema.filmElement();
    return v.preload === 'metadata' && v.playsInline && !v.loop && !v.autoplay && !v.isConnected && document.querySelectorAll('video').length === 0;
  }));
  check('film: waiting screen is the poster; nothing renders while idle', f.view.screen.content === 'poster' && idle.rendersPerSecond === 0, { screen: f.view.screen, idle });
  report.film.media = {
    src: '/media/big-buck-bunny-trailer-720p.mp4',
    width: f.snapshot.videoWidth,
    height: f.snapshot.videoHeight,
    duration: f.snapshot.duration,
  };
  await reveal(page, PRIMARY);
  const layout = await playerLayout(page);
  check(
    'film: the player is the glass dock of Xem phim, bottom centre over the room, inside the window and clear of the way back; no sideways scroll',
    !layout.inPanel && layout.insideWindow && Math.abs(layout.player.x + layout.player.width / 2 - 720) < 24 && layout.player.y > 900 * 0.7 && !layout.overlaps.returnButton && layout.overflowX <= 0,
    layout,
  );
  await closeMenus(page);
  const a11y = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      region: q('.cinema-player').getAttribute('aria-label'),
      primary: q('button[data-action="media-primary"]').getAttribute('aria-label'),
      seek: q('input[data-action="media-seek"]').getAttribute('aria-label'),
      mute: [q('button[data-action="media-mute"]').getAttribute('aria-label'), q('button[data-action="media-mute"]').getAttribute('aria-pressed')],
      volume: q('input[data-action="media-volume"]').getAttribute('aria-label'),
      credit: q('.cinema-player__credit') !== null,
      live: q('[data-film-live]')?.getAttribute('aria-live') === 'polite',
    };
  });
  check('film: controls have names and states; no credit line in the player (the films are credited in Cài đặt › Thông tin)', a11y.primary === 'Phát' && a11y.seek && a11y.mute[1] === 'false' && a11y.volume && !a11y.credit && a11y.live, a11y);
  await screenshot(page, 'film-1-waiting-overview');
  const staticScene = await state(page);
  report.film.metrics.staticNotPlaying = { renders: idle.rendersPerSecond, ...staticScene.view.render, ...staticScene.view.memory };

  // Play: only the element's own events count. Real frames, real time, picture changes.
  await clickUi(page, PRIMARY);
  f = await waitForFilm(page, ['playing']);
  const startPixels = await page.evaluate(() => window.__cinema.screenPixels([[0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.5, 0.25], [0.5, 0.75]]));
  const rates = await filmRates(page, 2500);
  const endPixels = await page.evaluate(() => window.__cinema.screenPixels([[0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.5, 0.25], [0.5, 0.75]]));
  f = await film(page);
  const changed = startPixels.some((p, i) => p.screen.some((c, k) => Math.abs(c - endPixels[i].screen[k]) > 24));
  check('film: playing — media time advances, frames are decoded and presented, the screen picture changes', rates.mediaSeconds > 2 && rates.decoded > 30 && rates.videoFramesPerSecond > 15 && changed && f.view.screen.content === 'video', {
    rates,
    textureVersion: f.view.screen.textureVersion,
    changed,
  });
  check('film: UI shows "Tạm dừng" while playing', (await page.getAttribute(PRIMARY, 'aria-label')) === 'Tạm dừng' && (await page.getAttribute(PLAYER, 'data-state')) === 'playing');
  check('film: still camera renders at the film’s frame rate, not the display’s (≤ 1.25 × video fps, < 40/s)', rates.rendersPerSecond <= rates.videoFramesPerSecond * 1.25 + 1 && rates.rendersPerSecond < 40, rates);
  check('film: sound — an audio track is decoded, not muted, volume 1 (not verified by ear)', f.snapshot.hasAudio === true && f.audioDecodedBytes > 0 && !f.snapshot.muted && f.snapshot.volume === 1, {
    hasAudio: f.snapshot.hasAudio,
    audioDecodedBytes: f.audioDecodedBytes,
  });
  const playingStill = await state(page);
  report.film.metrics.playingStillCamera = { ...rates, ...playingStill.view.render, ...playingStill.view.memory };
  await screenshot(page, 'film-2-playing-overview');

  // Mute and volume, read back from the element (its volumechange events arrive a moment later).
  const muteButton = 'button[data-action="media-mute"]';
  await reveal(page, muteButton);
  await page.click(muteButton);
  await page.waitForFunction((b) => window.__cinema.filmElement().muted && document.querySelector(b).getAttribute('aria-pressed') === 'true', muteButton);
  const mutedAria = await page.getAttribute(muteButton, 'aria-pressed');
  await page.click(muteButton);
  await page.waitForFunction((b) => !window.__cinema.filmElement().muted && document.querySelector(b).getAttribute('aria-pressed') === 'false', muteButton);
  await focusUi(page, 'input[data-action="media-volume"]');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('input[data-action="media-volume"]').getAttribute('aria-valuetext') === '80 %', null, { timeout: 3000 }).catch(() => {});
  const sound = await page.evaluate(() => ({ volume: window.__cinema.filmElement().volume, muted: window.__cinema.filmElement().muted, text: document.querySelector('input[data-action="media-volume"]').getAttribute('aria-valuetext') }));
  check('film: mute toggles the element (aria-pressed follows); the volume slider sets the element’s volume', mutedAria === 'true' && Math.abs(sound.volume - 0.8) < 0.01 && !sound.muted, { mutedAria, ...sound });

  // Dragging the seek bar: playback time does not pull the thumb back; release seeks.
  await reveal(page, 'input[data-action="media-seek"]');
  const seekBox = await page.locator('input[data-action="media-seek"]').boundingBox();
  const target = 0.3;
  await page.mouse.move(seekBox.x + seekBox.width * target, seekBox.y + seekBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  const thumbWhileHeld = await page.evaluate(() => Number(document.querySelector('input[data-action="media-seek"]').value));
  const timeWhileHeld = (await film(page)).snapshot.currentTime;
  await page.mouse.up();
  await page.waitForTimeout(400);
  f = await film(page);
  const duration = f.snapshot.duration;
  check('film: while the seek bar is held, media time does not move the thumb; releasing seeks there (playing)', Math.abs(thumbWhileHeld - duration * target) < 1.2 && Math.abs(f.snapshot.currentTime - duration * target) < 1.5 && f.snapshot.state === 'playing', {
    thumbWhileHeld,
    timeWhileHeld,
    after: f.snapshot.currentTime,
  });
  // Arrow keys on the focused seek bar jump 5 s while playing.
  const beforeKey = (await film(page)).snapshot.currentTime;
  await focusUi(page, 'input[data-action="media-seek"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const afterKey = (await film(page)).snapshot.currentTime;
  check('film: → on the seek bar jumps about 5 s while playing', afterKey - beforeKey > 4 && afterKey - beforeKey < 6.5, { beforeKey, afterKey });

  // Pause: the last frame is drawn, then nothing renders.
  await clickUi(page, PRIMARY);
  f = await waitForFilm(page, ['paused']);
  await page.waitForTimeout(300);
  const pausedRates = await filmRates(page, 1200);
  check('film: pause — "Tiếp tục" offered, media time stops, no more renders', (await page.getAttribute(PRIMARY, 'aria-label')) === 'Tiếp tục' && pausedRates.rendersPerSecond === 0 && pausedRates.mediaSeconds === 0 && f.view.clock.pending === 0, {
    pausedRates,
    clock: f.view.clock,
  });
  report.film.metrics.pausedStill = { renders: pausedRates.rendersPerSecond };

  // Seek while paused: the new frame appears, then rendering stops again. The target is well away
  // from where it paused (that depends on timing above), so the two pictures always differ.
  const beforeSeek = await page.evaluate(() => ({ time: window.__cinema.film().snapshot.currentTime, pixels: window.__cinema.screenPixels([[0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.5, 0.25], [0.5, 0.75]]), version: window.__cinema.film().view.screen.textureVersion, rendered: window.__cinema.getState().view.framesRendered }));
  const seekTarget = beforeSeek.time > 10 ? 5 : 15;
  await focusUi(page, 'input[data-action="media-seek"]');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => window.__cinema.film().snapshot.currentTime < 0.5);
  for (let i = 0; i < seekTarget / 5; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction((t) => Math.abs(window.__cinema.film().snapshot.currentTime - t) < 0.6, seekTarget);
  await page.waitForTimeout(400);
  const afterSeek = await page.evaluate(() => ({ pixels: window.__cinema.screenPixels([[0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.5, 0.25], [0.5, 0.75]]), version: window.__cinema.film().view.screen.textureVersion, rendered: window.__cinema.getState().view.framesRendered }));
  const seekIdle = await filmRates(page, 1000);
  f = await film(page);
  const seekChanged = beforeSeek.pixels.some((p, i) => p.screen.some((c, k) => Math.abs(c - afterSeek.pixels[i].screen[k]) > 24));
  check('film: seek while paused shows the new frame (texture re-uploaded, picture changed), then rendering stops', f.snapshot.state === 'paused' && afterSeek.version > beforeSeek.version && afterSeek.rendered > beforeSeek.rendered && seekChanged && seekIdle.rendersPerSecond === 0, {
    time: [beforeSeek.time, f.snapshot.currentTime],
    versions: [beforeSeek.version, afterSeek.version],
    rendered: [beforeSeek.rendered, afterSeek.rendered],
    seekChanged,
    seekIdle,
  });
  await screenshot(page, 'film-3-paused-after-seek');

  // Pointer and keys on the player stay there: no seat, no camera turn, no walking, no page-wide Space.
  const camera0 = (await state(page)).view.camera;
  const seats0 = (await seatsState(page)).selected;
  await reveal(page, 'input[data-action="media-seek"]');
  await page.click('.cinema-player__title');
  const box = await page.locator('input[data-action="media-seek"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const camera1 = (await state(page)).view.camera;
  const seats1 = await seatsState(page);
  check('film: clicks and drags on the player never pick a seat or turn the camera', JSON.stringify(camera0.position) === JSON.stringify(camera1.position) && JSON.stringify(camera0.target) === JSON.stringify(camera1.target) && JSON.stringify(seats0) === JSON.stringify(seats1.selected) && seats1.hovered === null, {
    selected: seats1.selected,
  });
  await clickUi(page, PRIMARY); // play again (from where the drag left it)
  await waitForFilm(page, ['playing']);
  // Walking, then the player in the control panel: the panel is modal over the room, and arrow
  // keys on the player's controls never move the camera; the film plays on.
  await clickUi(page, 'button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  await page.waitForTimeout(300);
  await focusUi(page, PRIMARY);
  const backToWatch = await state(page);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await focusUi(page, 'input[data-action="media-seek"]');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  const keyed = await state(page);
  check('film: with the panel open while walking, arrow keys on the player’s controls do not move the camera', JSON.stringify(backToWatch.view.camera.position) === JSON.stringify(keyed.view.camera.position) && (await film(page)).snapshot.state === 'playing', {
    before: backToWatch.view.camera.position,
    after: keyed.view.camera.position,
  });
  await closeMenus(page);
  await page.evaluate(() => document.activeElement?.blur());
  const spaceBefore = (await film(page)).snapshot.state;
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check('film: Space with nothing focused does not play or pause (no page-wide shortcut)', (await film(page)).snapshot.state === spaceBefore, spaceBefore);

  // Seats and the seat view while playing: the same element keeps playing.
  await page.evaluate(() => (window.__filmElement = window.__cinema.filmElement()));
  await selectPreset(page, 'overview');
  const picked = await clickFirstVisible(page, ['G06', 'F05', 'E04', 'H07', 'D05']);
  const afterPick = await film(page);
  check('film: picking a seat in 3D while playing selects it; playback goes on', picked && (await seatsState(page)).selected.includes(picked) && afterPick.snapshot.state === 'playing', { picked });
  await openSeatPanel(page);
  await page.click('button[data-seat="F06"]');
  await clickUi(page, 'button[data-action="view-from-seat"]');
  // A camera move while playing: renders never exceed browser frames.
  const moving = await rendersPerBrowserFrame(page);
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
  await nextFrames(page);
  await closeSeatPanel(page);
  await page.waitForTimeout(400);
  f = await film(page);
  check('film: seat view from F06 while playing: still playing, same element, picture on screen', f.snapshot.state === 'playing' && f.view.screen.content === 'video' && (await page.evaluate(() => window.__filmElement === window.__cinema.filmElement())), {
    camera: (await state(page)).view.state,
  });
  check('film: camera moving while playing — at most one render per browser frame', moving.renders <= moving.ticks + 1 && moving.renders > 0, moving);
  report.film.metrics.playingMovingCamera = moving;
  await screenshot(page, 'film-4-playing-from-F06');

  // Quality switch while playing: time, playing, sound and element unchanged.
  const q0 = await film(page);
  // The pixel ratio changes too, which clears the canvas: no blank frame may reach the screen.
  const qualityFrames = await framesAfter(page, () => setQuality(page, 'economy'));
  await nextFrames(page);
  const q1 = await film(page);
  check('film: switching quality (drawing buffer resized) never presents a blank canvas frame', qualityFrames.length > 0 && qualityFrames.every((f) => f.deviation > 6), qualityFrames);
  check('film: switching to Economy while playing keeps playing, time, mute and volume, and the same element', q1.snapshot.state === 'playing' && q1.snapshot.currentTime > q0.snapshot.currentTime && q1.snapshot.muted === q0.snapshot.muted && q1.snapshot.volume === q0.snapshot.volume && q1.view.screen.content === 'video' && (await page.evaluate(() => window.__filmElement === window.__cinema.filmElement())), {
    before: q0.snapshot.currentTime,
    after: q1.snapshot.currentTime,
  });
  await setQuality(page, 'high');
  await nextFrames(page);
  // Drop the test's own reference, so the live-object counts below see only the page's.
  await page.evaluate(() => delete window.__filmElement);

  // Timing along the fixed camera path while the film plays (texture uploads included).
  const timingPlaying = await page.evaluate(() => window.__cinema.measureFrames(120));
  report.film.metrics.frameTimingWhilePlaying = timingPlaying;

  // Hidden tab: pauses with a notice; showing it again does not resume.
  const setHidden = (h) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, h);
  await setHidden(true);
  await page.waitForTimeout(200);
  const hidden = await film(page);
  await setHidden(false);
  await page.waitForTimeout(1200);
  const shown = await film(page);
  const shownRates = await filmRates(page, 800);
  check('film: hidden tab pauses (notice), frame callbacks cancelled; visible again stays paused, nothing renders', hidden.paused && hidden.snapshot.notice === 'hidden' && hidden.view.clock.pending === 0 && shown.paused && shown.snapshot.state === 'paused' && shownRates.rendersPerSecond === 0, {
    hidden: hidden.snapshot.state,
    shown: shown.snapshot.state,
    notice: shown.snapshot.notice,
  });

  // Ended, then replay.
  await clickUi(page, PRIMARY);
  await waitForFilm(page, ['playing']);
  await focusUi(page, 'input[data-action="media-seek"]');
  await page.keyboard.press('End');
  f = await waitForFilm(page, ['ended'], 10_000);
  await page.waitForTimeout(300);
  const endedRates = await filmRates(page, 1000);
  check('film: the end — "Phát lại" offered, nothing renders, no loop', (await page.getAttribute(PRIMARY, 'aria-label')) === 'Phát lại' && endedRates.rendersPerSecond === 0 && f.paused, endedRates);
  await screenshot(page, 'film-5-ended');
  await clickUi(page, PRIMARY);
  f = await waitForFilm(page, ['playing']);
  check('film: replay starts again from the beginning', f.snapshot.currentTime < 3, f.snapshot.currentTime);

  // Context loss while playing: paused, no frame callbacks, play disabled; after the restore the
  // current frame is back, camera and seats kept, nothing plays by itself, "Tiếp tục" offered.
  await page.waitForTimeout(800);
  const beforeLoss = await state(page);
  await page.evaluate(() => {
    window.__lose = document.querySelector('.cinema-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  const lost = await film(page);
  const lostDisabled = await page.isDisabled(PRIMARY);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__lose.restoreContext());
  await waitForStatus(page);
  await nextFrames(page);
  await page.waitForTimeout(1000);
  const restored = await film(page);
  const afterLoss = await state(page);
  check('film: context loss while playing pauses it (notice), stops frame callbacks, disables play', lost.paused && lost.snapshot.notice === 'context-lost' && lost.view.clock.pending === 0 && lostDisabled, {
    state: lost.snapshot.state,
    clock: lost.view.clock,
  });
  check('film: after the restore — current frame shown, camera and seats kept, still paused and not unmuted, "Tiếp tục" offered', restored.paused && restored.view.screen.content === 'video' && restored.snapshot.muted === lost.snapshot.muted && (await page.getAttribute(PRIMARY, 'aria-label')) === 'Tiếp tục' && !(await page.isDisabled(PRIMARY)) && JSON.stringify(afterLoss.view.camera.position) === JSON.stringify(beforeLoss.view.camera.position) && JSON.stringify(afterLoss.seats.selected) === JSON.stringify(beforeLoss.seats.selected), {
    screen: restored.view.screen,
    camera: afterLoss.view.state,
  });
  await screenshot(page, 'film-6-context-restored-paused');
  await clickUi(page, PRIMARY);
  f = await waitForFilm(page, ['playing']);
  await page.waitForTimeout(700);
  const resumedRates = await filmRates(page, 1000);
  check('film: playing again after the restore draws new frames', resumedRates.videoFramesPerSecond > 15 && resumedRates.rendersPerSecond > 15, resumedRates);
  // play() still pending when the context goes: it must not start once things settle.
  await clickUi(page, PRIMARY);
  await waitForFilm(page, ['paused']);
  await page.evaluate(() => {
    document.querySelector('button[data-action="media-primary"]').click();
    window.__lose.loseContext();
  });
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.status === 'context-lost');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__lose.restoreContext());
  await waitForStatus(page);
  await page.waitForTimeout(800);
  const pending = await film(page);
  check('film: play pressed just before a context loss does not start playing after the restore', pending.paused && pending.snapshot.state !== 'playing', pending.snapshot);

  // The seat inspector: the film stops and its element goes; back in the room it is paused where it was.
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await clickUi(page, PRIMARY);
  await waitForFilm(page, ['playing']);
  await page.waitForTimeout(1500);
  await openInspectTools(page);
  const leftAt = (await film(page)).snapshot;
  await clickUi(page, 'button[data-action="open-inspector"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await page.evaluate(() => (window.__filmTypes = { MediaController: null, HTMLVideoElement }));
  const inInspector = await liveCounts(cdp, ['HTMLVideoElement']);
  check('film: in the seat inspector no media element is alive (no audio playing on)', inInspector.objects.HTMLVideoElement === 0 && (await page.evaluate(() => document.querySelectorAll('video').length)) === 0, inInspector.objects);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  await page.waitForFunction(() => window.__cinema.film().snapshot.hasFrame, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  f = await film(page);
  check('film: back from the inspector — paused at the same time, same sound, picture shown', f.paused && f.snapshot.state === 'paused' && Math.abs(f.snapshot.currentTime - leftAt.currentTime) < 0.5 && f.snapshot.muted === leftAt.muted && Math.abs(f.snapshot.volume - leftAt.volume) < 1e-6 && f.view.screen.content === 'video', {
    leftAt: leftAt.currentTime,
    back: f.snapshot.currentTime,
  });

  // Play → pause → leave in quick succession: nothing restarts, nothing is left playing.
  await page.evaluate(() => {
    const button = document.querySelector('button[data-action="media-primary"]');
    button.click();
    button.click();
    history.pushState(null, '', '/cinema?inspect=seat');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await page.waitForTimeout(800);
  const afterLeave = await liveCounts(cdp, ['HTMLVideoElement']);
  check('film: play → pause → leave at once leaves no media element alive', afterLeave.objects.HTMLVideoElement === 0, afterLeave.objects);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  f = await film(page);
  check('film: and coming back it is paused', f.paused && f.snapshot.state !== 'playing', f.snapshot.state);

  // Many play/pause/seek rounds and inspector round trips: resources stay put.
  const types = ['MediaController', 'HTMLVideoElement', 'Texture', 'Material', 'BufferGeometry'];
  const round = async () => {
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(250);
    await focusUi(page, 'input[data-action="media-seek"]');
    // Back 5 s, so the rounds never run into the end.
    await page.keyboard.press('ArrowLeft');
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['paused']);
  };
  for (let i = 0; i < 2; i++) await round();
  const first = await liveCounts(cdp, types);
  const firstState = await film(page);
  const firstMemory = (await state(page)).view.memory;
  for (let i = 0; i < 8; i++) await round();
  for (let i = 0; i < 3; i++) {
    await openInspectTools(page);
    await clickUi(page, 'button[data-action="open-inspector"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
    await round();
  }
  const last = await liveCounts(cdp, types);
  const lastState = await film(page);
  const lastMemory = (await state(page)).view.memory;
  report.film.lifecycle = { first, last, firstMemory, lastMemory, subscribers: [firstState.subscribers, lastState.subscribers], clock: lastState.view.clock };
  check('film: after 13 play/pause/seek rounds and 3 inspector round trips — one controller and one element alive, subscribers and frame callbacks not piling up', last.objects.MediaController === 1 && last.objects.HTMLVideoElement === 1 && lastState.subscribers === firstState.subscribers && lastState.view.clock.pending === 0, report.film.lifecycle);
  check('film: …and live three.js objects, page listeners and renderer resources steady (heap +< 1 MiB)', JSON.stringify(first.objects) === JSON.stringify(last.objects) && JSON.stringify(first.listeners) === JSON.stringify(last.listeners) && JSON.stringify(firstMemory) === JSON.stringify(lastMemory) && last.heapMiB - first.heapMiB < 1, {
    objects: [first.objects, last.objects],
    listeners: [first.listeners, last.listeners],
    heap: [first.heapMiB, last.heapMiB],
  });

  // Opening the seat panel resizes the 3D view, which clears the canvas: it must be drawn again
  // before the browser presents the frame, never shown blank for a frame.
  await clickUi(page, 'button[data-action="reset"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.transitioning === 'false');
  await closeSeatPanel(page);
  await reveal(page, 'button[data-action="seat-panel"]');
  await page.waitForTimeout(500);
  const resizeFrames = await framesAfter(page, () => page.click('button[data-action="seat-panel"]'));
  check('film: opening the seat sidebar over the room never presents a blank canvas frame', resizeFrames.length > 0 && resizeFrames.every((f) => f.deviation > 6), resizeFrames);
  await closeSeatPanel(page);
  await page.waitForTimeout(300);

  // The flow on video: choose a seat, view from it, play, pause.
  await recordVideo(browser, page, 'video-film-seat-view-play-pause', async () => {
    await page.waitForTimeout(500);
    await openSeatPanel(page);
    await page.waitForTimeout(400);
    await page.click('button[data-seat="E08"]');
    await page.waitForTimeout(500);
    await clickUi(page, 'button[data-action="view-from-seat"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
    await page.waitForTimeout(500);
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(3500);
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['paused']);
    await page.waitForTimeout(800);
  });
  await context.close();
}

// Generated clips: colours against the browser's own frame, orientation, letterbox and pillarbox,
// no sound, unknown duration; bad files; a refused play(); slow network; no frame-callback API.
async function filmFixtures(browser, base) {
  report.film ??= { metrics: {} };
  const open = async (label, query, options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options.context });
    if (options.init) await context.addInitScript(options.init);
    const page = await context.newPage();
    attachConsole(page, label);
    if (options.before) await options.before(page, context);
    await page.goto(`${base}cinema${query}`);
    await waitForStatus(page);
    // The clips are checked as a viewer sees them: in Xem phim, where the film's status and retry show.
    await ensureTask(page, 'watch');
    await closeSeatPanel(page);
    return { context, page };
  };

  // Colour and orientation: the same paused frame read from the canvas and from the video.
  {
    const { context, page } = await open('film-color', '?film=pattern-16x9.mp4');
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await faceScreen(page);
    await playFilm(page);
    await page.waitForTimeout(1200);
    await pauseFilm(page);
    await page.waitForTimeout(300);
    const samples = await page.evaluate((points) => window.__cinema.screenPixels(points.map((p) => p.uv)), PATTERN_POINTS);
    const rows = PATTERN_POINTS.map((p, i) => ({
      name: p.name,
      expected: p.rgb,
      screen: samples[i].screen,
      video: samples[i].video,
      screenVsVideo: Math.max(...samples[i].screen.map((c, k) => Math.abs(c - samples[i].video[k]))),
      screenVsExpected: Math.max(...samples[i].screen.map((c, k) => Math.abs(c - p.rgb[k]))),
    }));
    report.film.color = rows;
    const worst = Math.max(...rows.map((r) => r.screenVsVideo));
    const worstExpected = Math.max(...rows.map((r) => r.screenVsExpected));
    check('film colour: screen pixels match the browser’s own decoding of the same frame (max channel difference ≤ 8 over bars, grey ramp, marker)', worst <= 8, { worst });
    check('film colour: grey 128 stays mid-grey on screen (no double gamma or tone mapping) and bars are within 16 of their sRGB values', rows.find((r) => r.name === 'grey 128').screen.every((c) => Math.abs(c - 128) <= 10) && worstExpected <= 16, {
      grey128: rows.find((r) => r.name === 'grey 128').screen,
      worstExpected,
    });
    const marker = rows.find((r) => r.name.startsWith('top-left'));
    check('film orientation: the top-left marker is top-left on the screen (no flip or mirror)', marker.screenVsExpected <= 24, marker);
    await screenshot(page, 'film-7-colour-check-16x9');
    await context.close();
  }

  // Other shapes: contain inside the 16:9 screen, black bars, nothing cropped or stretched.
  for (const [file, aspect, shot, bars] of [
    ['pattern-9x16.mp4', 9 / 16, 'film-8-pillarbox-9x16', [[0.08, 0.5], [0.92, 0.5]]],
    ['pattern-239.mp4', 860 / 360, 'film-9-letterbox-239', [[0.5, 0.04], [0.5, 0.96]]],
  ]) {
    const { context, page } = await open(`film-${file}`, `?film=${file}`);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await faceScreen(page);
    await playFilm(page);
    await page.waitForTimeout(1000);
    await pauseFilm(page);
    const f = await film(page);
    const { width, height, screen } = f.view.screen;
    const outside = await page.evaluate((points) => window.__cinema.screenPixels(points, 'screen'), bars);
    const inside = await page.evaluate(() => window.__cinema.screenPixels([[0.03, 0.96], [0.5, 0.66]]));
    const fits = Math.abs(width / height - aspect) < 0.01 && (Math.abs(width - screen.width) < 1e-6 || Math.abs(height - screen.height) < 1e-6) && width <= screen.width + 1e-6 && height <= screen.height + 1e-6;
    check(`film shape ${file}: contained in the 16:9 screen with its own aspect, bars black, corner marker in place`, fits && outside.every((p) => p.screen.every((c) => c <= 14)) && inside[0].screen[0] > 200 && inside[0].screen[2] < 80, {
      picture: { width, height },
      bars: outside.map((p) => p.screen),
      marker: inside[0].screen,
    });
    await screenshot(page, shot);
    await context.close();
  }

  // No sound: said so, mute disabled. Unknown duration: seeking disabled until it is known.
  {
    const { context, page } = await open('film-silent', '?film=pattern-silent.mp4');
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await playFilm(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.hasAudio !== null, null, { timeout: 8000 });
    const f = await film(page);
    const mute = await page.evaluate(() => {
      const b = document.querySelector('button[data-action="media-mute"]');
      return { disabled: b.disabled, label: b.getAttribute('aria-label') };
    });
    check('film without sound: detected; the mute button says so and is disabled', f.snapshot.hasAudio === false && mute.disabled && /không có âm thanh/.test(mute.label), { hasAudio: f.snapshot.hasAudio, mute });
    await context.close();
  }
  {
    const { context, page } = await open('film-no-duration', '?film=pattern-no-duration.webm');
    await page.waitForFunction(() => ['ready', 'loading'].includes(window.__cinema.film().snapshot.state));
    await page.waitForTimeout(500);
    const before = await film(page);
    const seekDisabled = await page.isDisabled('input[data-action="media-seek"]');
    const total = await page.textContent('.cinema-player__time');
    await playFilm(page);
    await waitForFilm(page, ['ended'], 15_000);
    const after = await film(page);
    check('film with unknown duration: seeking disabled and "--:--" shown, no guess; playback still works to the end', before.snapshot.duration === null && seekDisabled && /--:--/.test(total) && after.snapshot.state === 'ended', {
      before: before.snapshot.duration,
      total,
      after: after.snapshot.duration,
    });
    await context.close();
  }

  // Broken sources: a readable error, retry by hand only, never left "loading" (no shimmer).
  for (const [file, shot, play] of [
    ['not-a-video.mp4', 'film-10-error-not-a-video', false],
    ['missing-file.mp4', null, false],
    ['damaged-data.mp4', 'film-11-error-decode', true],
  ]) {
    const { context, page } = await open(`film-error-${file}`, `?film=${file}`);
    const requests = [];
    page.on('request', (request) => request.url().includes(file) && requests.push(request.url()));
    if (play) {
      await page.waitForFunction(() => ['ready', 'error'].includes(window.__cinema.film().snapshot.state), null, { timeout: 10_000 });
      if ((await film(page)).snapshot.state === 'ready') await clickUi(page, PRIMARY);
    }
    const f = await waitForFilm(page, ['error'], 10_000);
    await page.waitForTimeout(2500);
    const ui = await page.evaluate(() => ({
      status: document.querySelector('.cinema-player__status').textContent,
      busy: document.querySelector('.cinema-player__status').classList.contains('cinema-player__status--busy'),
      retry: !document.querySelector('button[data-action="media-retry"]').hidden,
      playDisabled: document.querySelector('button[data-action="media-primary"]').disabled,
    }));
    const requestsBeforeRetry = requests.length;
    check(`film error (${file}): "${f.snapshot.error?.code}" with a message and a retry button, not shown as loading, play disabled, no automatic retries`, ui.retry && !ui.busy && ui.playDisabled && ui.status.length > 10 && f.view.screen.content !== 'video', {
      error: f.snapshot.error,
      ui,
      requests: requestsBeforeRetry,
    });
    if (shot) await screenshot(page, shot);
    if (file === 'not-a-video.mp4') {
      await clickUi(page, 'button[data-action="media-retry"]');
      await waitForFilm(page, ['error'], 10_000);
      await page.waitForTimeout(1500);
      check('film error: "Thử lại" loads once more and ends in the same error (no loop)', (await film(page)).snapshot.state === 'error' && requests.length - requestsBeforeRetry <= 2, { requests: requests.length - requestsBeforeRetry });
    }
    await context.close();
  }

  // play() refused by the browser: a message, no fake "playing", trying again works.
  {
    const { context, page } = await open('film-blocked', '', {
      init: () => {
        const original = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (window.__allowPlay) return original.call(this);
          return Promise.reject(new DOMException('play() is not allowed here', 'NotAllowedError'));
        };
      },
    });
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await clickUi(page, PRIMARY);
    await page.waitForFunction(() => window.__cinema.film().snapshot.notice === 'blocked');
    await page.waitForTimeout(500);
    const f = await film(page);
    const text = await page.textContent('.cinema-player__status');
    check('film: a refused play() shows a message, stays "Phát" (not a fake "playing"), element paused', f.paused && f.snapshot.state !== 'playing' && (await page.getAttribute(PRIMARY, 'aria-label')) === 'Phát' && /chưa cho phát/.test(text), { state: f.snapshot.state, text });
    await screenshot(page, 'film-12-play-blocked');
    await page.evaluate(() => (window.__allowPlay = true));
    await clickUi(page, PRIMARY);
    const after = await waitForFilm(page, ['playing']);
    check('film: pressing Phát again once allowed plays and clears the message', after.snapshot.notice === null && (await page.textContent('.cinema-player__status')) === '', after.snapshot.state);
    await context.close();
  }

  // Slow network, simulated by the server: the first 256 KB (header and about a second of film) come
  // at once, later range requests are held back. Buffering shows, then the slow notice; nothing is
  // retried automatically; once data flows again, playback goes on by itself.
  {
    const file = await readFile(path.join(root, 'public', 'media', 'big-buck-bunny-trailer-720p.mp4'));
    let hold = true;
    let held = 0;
    const { context, page } = await open('film-slow', '', {
      before: (p) =>
        p.route('**/media/big-buck-bunny-trailer-720p.mp4', async (route) => {
          const match = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
          const start = match ? Number(match[1]) : 0;
          if (start > 0) {
            held++;
            while (hold) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const end = Math.min(match?.[2] ? Number(match[2]) : file.length - 1, start + 256 * 1024 - 1);
          await route
            .fulfill({
              status: 206,
              headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) },
              body: file.subarray(start, end + 1),
            })
            .catch(() => {});
        }),
    });
    await page.waitForFunction(() => ['ready', 'loading'].includes(window.__cinema.film().snapshot.state), null, { timeout: 20_000 });
    await clickUi(page, PRIMARY);
    const states = new Set();
    let slowSeen = false;
    let busyText = '';
    for (let i = 0; i < 100 && !slowSeen; i++) {
      const f = await film(page);
      states.add(f.snapshot.state);
      if (f.snapshot.state === 'buffering' && !busyText) busyText = await page.textContent('.cinema-player__status');
      slowSeen = f.snapshot.notice === 'slow';
      await page.waitForTimeout(250);
    }
    const retryVisible = await page.isVisible('button[data-action="media-retry"]');
    check('film on a slow network: "buffering" shown while waiting, then the slow notice with a "Tải lại" button (no automatic retry)', states.has('buffering') && /chờ dữ liệu/.test(busyText) && slowSeen && retryVisible, {
      states: [...states],
      busyText,
      heldRequests: held,
    });
    await screenshot(page, 'film-13-slow-network');
    hold = false;
    const recovered = await waitForFilm(page, ['playing'], 30_000).catch(() => null);
    check('film: once data flows again it plays by itself (the play request still stands) and the notice clears', recovered?.snapshot.notice === null, recovered?.snapshot.state ?? 'timeout');
    await context.close();
  }

  // Without requestVideoFrameCallback: a bounded timer while playing, nothing when paused.
  {
    const { context, page } = await open('film-no-rvfc', '?film=pattern-16x9.mp4', {
      init: () => {
        delete HTMLVideoElement.prototype.requestVideoFrameCallback;
        delete HTMLVideoElement.prototype.cancelVideoFrameCallback;
      },
    });
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await playFilm(page);
    await page.waitForTimeout(500);
    const playing = await filmRates(page, 2000);
    const f = await film(page);
    await pauseFilm(page);
    await page.waitForTimeout(300);
    const paused = await filmRates(page, 1000);
    check('film without requestVideoFrameCallback: renders at the fallback rate (≤ 31/s) while playing, none when paused', !f.view.clock.supported && playing.rendersPerSecond >= 20 && playing.rendersPerSecond <= 31 && paused.rendersPerSecond === 0, { playing, paused });
    report.film.metrics.fallbackClock = { playing, paused };
    await context.close();
  }
}

// Phones (the control hub, Prompt 13): the film plays from the hub over the room, which fills the
// screen; it keeps playing through the full-screen map, a seat view and walking; the way back, the
// stick, the hub's button and the film's notices never overlap; pausing stays one press away.
async function filmMobile(browser, base) {
  for (const [name, viewport] of [
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 390 }],
  ]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    attachConsole(page, `film-mobile-${name}`);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    const boxes = () =>
      page.evaluate(() => {
        const rect = (s) => {
          const e = document.querySelector(s);
          return e && e.getClientRects().length > 0 ? e.getBoundingClientRect() : null;
        };
        const overlap = (a, b) => Boolean(a && b && a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5);
        const toggle = rect('.cinema-hub__toggle');
        const back = rect('button[data-action="return"]');
        const chip = rect('.cinema-filmstatus');
        const stick = rect('.cinema-stick');
        const caption = rect('.cinema-caption');
        return {
          stick: Boolean(stick),
          overlaps: {
            backToggle: overlap(back, toggle),
            chipToggle: overlap(chip, toggle),
            chipBack: overlap(chip, back),
            stickToggle: overlap(stick, toggle),
            stickCaption: overlap(stick, caption),
            stickBack: overlap(stick, back),
          },
          pause: document.querySelector('.cinema-hub button[data-action="media-primary"]').getAttribute('aria-label'),
        };
      });
    await tapUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1500);
    const playing = await canvasShare(page);
    const chipShown = await page.isVisible('.cinema-filmstatus');
    check(`film mobile ${name}: plays from the control hub; the room fills the screen with nothing over it but the hub's button`, playing.areaShare > 0.98 && playing.overflowX <= 0 && playing.overflowY <= 0 && !chipShown, { playing, chipShown });
    await screenshot(page, `film-mobile-${name}-playing`);
    // The full-screen map while the film plays, then the view from a seat.
    await openSeatPanel(page);
    await page.click('button[data-seat="F06"]');
    await page.click('button[data-action="view-from-seat"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const seat = await boxes();
    check(`film mobile ${name}: seat view — the way back, the hub's button and any film notice do not overlap`, !seat.overlaps.backToggle && !seat.overlaps.chipToggle && !seat.overlaps.chipBack, seat);
    await screenshot(page, `film-mobile-${name}-seat-view`);
    await tapUi(page, 'button[data-action="explore"]');
    await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const explore = await boxes();
    check(`film mobile ${name}: walking — the stick overlaps neither the hub's button, the caption nor the way back; "Tạm dừng" is in the hub`, explore.stick && !explore.overlaps.stickToggle && !explore.overlaps.stickCaption && !explore.overlaps.stickBack && explore.pause === 'Tạm dừng', explore);
    await screenshot(page, `film-mobile-${name}-explore`);
    const f = await film(page);
    check(`film mobile ${name}: still playing through the map, the seat view and walking`, f.snapshot.state === 'playing', f.snapshot.state);
    await context.close();
  }
}

// Three films: the list over the room (desktop) and in the control hub (phone). Another film on the
// same element: the old one stops, the new one plays on if the last one was playing, else its
// poster shows; title and tick follow; the choice survives the inspector round trip.
async function filmChoice(browser, base) {
  const FILM_IDS = ['big-buck-bunny-trailer', 'daily-dweebs', 'caminandes-3'];
  const shown = (page) =>
    page.evaluate(() => {
      const f = window.__cinema.film();
      const menu = document.querySelector('.cinema-films__menu');
      const r = menu && menu.getClientRects().length > 0 ? menu.getBoundingClientRect() : null;
      return {
        id: f.id,
        src: window.__cinema.filmElement().getAttribute('src'),
        poster: f.poster,
        state: f.snapshot.state,
        started: f.snapshot.started,
        time: f.snapshot.currentTime,
        screen: f.view?.screen?.content ?? null,
        title: document.querySelector('.cinema-player__title')?.textContent ?? null,
        pressed: [...document.querySelectorAll('.cinema-film[aria-pressed="true"]')].map((b) => b.dataset.film),
        options: [...document.querySelectorAll('.cinema-film')].map((b) => b.dataset.film),
        expanded: document.querySelector('button[data-action="film-menu"]')?.getAttribute('aria-expanded') ?? null,
        menu: r ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null,
        live: document.querySelector('[data-film-live]')?.textContent ?? '',
        focus: document.activeElement?.dataset.action ?? document.activeElement?.dataset.film ?? null,
      };
    });

  // Desktop: the title is the way to the other films.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachConsole(page, 'film-choice');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  await ensureTask(page, 'watch');
  await page.waitForFunction(() => window.__cinema.film().view?.screen?.content === 'poster', null, { timeout: 10_000 });
  let s = await shown(page);
  check('film choice: three films offered under the title, the first one on and ticked, the list closed', JSON.stringify(s.options) === JSON.stringify(FILM_IDS) && s.id === FILM_IDS[0] && JSON.stringify(s.pressed) === JSON.stringify([FILM_IDS[0]]) && s.expanded === 'false' && s.menu === null && /Big Buck Bunny/.test(s.title), s);

  await page.click('button[data-action="film-menu"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.cinema-film__thumb')].every((i) => i.complete && i.naturalWidth > 0 && !('loading' in i.dataset)), null, { timeout: 10_000 });
  s = await shown(page);
  const player = await page.evaluate(() => document.querySelector('.cinema-taskbar .cinema-player').getBoundingClientRect().top);
  check('film choice: the list opens above the player, inside the window, each film with its still, length and studio', s.expanded === 'true' && s.menu && s.menu.x >= 0 && s.menu.right <= 1440 && s.menu.y >= 0 && s.menu.bottom <= player, { menu: s.menu, player });
  await screenshot(page, 'film-choice-menu');
  await page.keyboard.press('Escape');
  s = await shown(page);
  check('film choice: Escape closes the list and comes back to the title', s.expanded === 'false' && s.menu === null && s.focus === 'film-menu', s);
  await page.click('button[data-action="film-menu"]');
  await page.mouse.click(720, 200);
  s = await shown(page);
  check('film choice: a press anywhere else closes the list', s.expanded === 'false' && s.menu === null, { expanded: s.expanded });

  // Playing, then another film: it plays on, from its start, on the same element.
  const element = await page.evaluateHandle(() => window.__cinema.filmElement());
  await playFilm(page);
  await page.waitForFunction(() => window.__cinema.film().snapshot.currentTime > 1.5, null, { timeout: 20_000 });
  await page.click('button[data-action="film-menu"]');
  await page.click('.cinema-film[data-film="daily-dweebs"]');
  s = await shown(page);
  const switched = s;
  await page.waitForFunction(() => {
    const f = window.__cinema.film();
    return f.snapshot.state === 'playing' && f.snapshot.currentTime > 0.5 && f.view?.screen?.content === 'video';
  }, null, { timeout: 20_000 });
  s = await shown(page);
  const same = await page.evaluate((v) => v === window.__cinema.filmElement() && document.querySelectorAll('video').length === 0, element);
  check('film choice: chosen while playing, the next film plays on from its start (same element), title and tick follow, the list closes', switched.id === 'daily-dweebs' && switched.src === '/media/daily-dweebs-720p.mp4' && switched.time < 1 && switched.expanded === 'false' && s.state === 'playing' && s.screen === 'video' && same && s.title === 'The Daily Dweebs' && JSON.stringify(s.pressed) === '["daily-dweebs"]', { switched, now: s, same });
  check('film choice: screen readers hear the switch once ("Đang phát: …", not "Đang phát" again)', s.live === 'Đang phát: The Daily Dweebs', { live: s.live });

  // Paused, then another film: not started, its poster on the screen.
  await pauseFilm(page);
  await page.click('button[data-action="film-menu"]');
  await page.click('.cinema-film[data-film="caminandes-3"]');
  await page.waitForFunction(() => {
    const f = window.__cinema.film();
    return f.snapshot.state === 'ready' && f.view?.screen?.content === 'poster';
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  s = await shown(page);
  const poster = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/media/caminandes-3-llamigos-poster.jpg';
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  check('film choice: chosen while paused, the next film waits at its start, not started, its poster on the screen', s.id === 'caminandes-3' && !s.started && s.time === 0 && s.poster === '/media/caminandes-3-llamigos-poster.jpg' && s.screen === 'poster' && poster.width === 1280 && s.live === 'Đang chiếu: Caminandes 3: Llamigos' && (await page.getAttribute(PRIMARY, 'aria-label')) === 'Phát', { s, poster });
  await screenshot(page, 'film-choice-poster');

  // Through the inspector and back: the same film, paused.
  await openInspectTools(page);
  await clickUi(page, 'button[data-action="open-inspector"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app--inspector')?.dataset.status === 'ready');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(window.__cinema) && document.querySelector('.cinema-app')?.dataset.status === 'ready');
  await ensureTask(page, 'watch');
  s = await shown(page);
  check('film choice: the chosen film is still on after the inspector round trip (paused)', s.id === 'caminandes-3' && s.src === '/media/caminandes-3-llamigos-720p.mp4' && s.title === 'Caminandes 3: Llamigos' && s.state !== 'playing', s);
  await context.close();

  // Phone: the films are rows in the control hub's Xem phim, no menu to open.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const p = await phone.newPage();
  attachConsole(p, 'film-choice-mobile');
  await p.goto(`${base}cinema`);
  await waitForStatus(p);
  await openHubPanel(p);
  await hubView(p, 'task');
  await p.tap('#cinema-hub-panel button[data-task="watch"]');
  await p.waitForFunction(() => document.querySelector('.cinema-app').dataset.task === 'watch');
  const rows = await p.evaluate(() => ({
    toggle: document.querySelector('.cinema-hub button[data-action="film-menu"]')?.getClientRects().length ?? 0,
    rows: [...document.querySelectorAll('.cinema-hub .cinema-film')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.film, width: Math.round(r.width), height: Math.round(r.height), inside: r.x >= 0 && r.right <= innerWidth };
    }),
  }));
  check('film choice mobile: the three films are rows in the hub (no menu), each at least 44 px tall and inside the screen', rows.toggle === 0 && rows.rows.length === 3 && rows.rows.every((r) => r.height >= 44 && r.inside), rows);
  await p.tap('.cinema-hub .cinema-film[data-film="daily-dweebs"]');
  await p.waitForFunction(() => window.__cinema.film().id === 'daily-dweebs');
  s = await shown(p);
  check('film choice mobile: a tap puts the film on and ticks it; the hub stays open', s.src === '/media/daily-dweebs-720p.mp4' && JSON.stringify(s.pressed) === '["daily-dweebs"]' && (await p.getAttribute('.cinema-hub__toggle', 'aria-expanded')) === 'true', s);
  await screenshot(p, 'film-choice-mobile');
  await phone.close();
}

// ---------------------------------------------------------------- Prompt 08: tasks, layouts, flows

// Sizes checked (Chrome emulation, not real devices). Names match the Prompt 07 baseline metrics.
const UI_VIEWPORTS = [
  { name: 'desktop-1920x1080', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'laptop-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: 'tablet-portrait-820x1180', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'tablet-landscape-1180x820', viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-430x932', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-narrow-360x640', viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-landscape-844x390', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
];

/** The canvas' measured box against the viewport (what is on screen, not what CSS intends). */
const canvasShare = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas.cinema-canvas');
    const r = canvas && canvas.getClientRects().length > 0 ? canvas.getBoundingClientRect() : null;
    const visible = r ? Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) : 0;
    return {
      heightShare: r ? Number((r.height / innerHeight).toFixed(3)) : 0,
      areaShare: Number((visible / (innerWidth * innerHeight)).toFixed(3)),
      canvas: r ? { width: Math.round(r.width), height: Math.round(r.height) } : null,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      overflowY: document.documentElement.scrollHeight - innerHeight,
    };
  });

/** Heights of the chrome around the view and the canvas size, to see that nothing shifts. */
const chromeBox = (page) =>
  page.evaluate(() => {
    const h = (s) => {
      const e = document.querySelector(s);
      return e && e.getClientRects().length > 0 ? Math.round(e.getBoundingClientRect().height * 10) / 10 : 0;
    };
    const c = document.querySelector('canvas.cinema-canvas').getBoundingClientRect();
    return { header: h('.cinema-header'), canvas: `${Math.round(c.width)}x${Math.round(c.height)}` };
  });

/** Visible controls smaller than `min` CSS px in either direction (the dense seat map and chips excepted). */
const smallTargets = (page, min = 43.5) =>
  page.evaluate((limit) => {
    const selector = '.cinema-hub__toggle, .cinema-hub__panel button, .cinema-mini, button[data-action="settings"], .cinema-taskbar button, .cinema-seats__header button, .cinema-seats__info button, .cinema-return';
    return [...document.querySelectorAll(selector)]
      .filter((e) => e.getClientRects().length > 0 && !e.closest('[inert]'))
      .map((e) => ({ name: e.dataset.action ?? e.dataset.task ?? e.dataset.preset ?? e.textContent.trim().slice(0, 20), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((t) => t.w < limit || t.h < limit);
  }, min);

/**
 * How far the controls in a glass box (`items` inside the visible `selector`) sit from its rim, per
 * side, in CSS px; `words` says the leftmost of them is the seat summary's line. Null without one.
 */
const hugOf = (page, selector, items) =>
  page.evaluate(([selector, items]) => {
    const box = [...document.querySelectorAll(selector)].find((e) => e.getClientRects().length > 0);
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const inside = [...box.querySelectorAll(items)]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => ({ e, q: e.getBoundingClientRect() }))
      .filter(({ q }) => q.width > 0 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5);
    if (inside.length === 0) return null;
    const first = inside.reduce((a, b) => (b.q.left < a.q.left ? b : a));
    const f = (n) => Math.round(n * 10) / 10;
    return {
      left: f(Math.min(...inside.map(({ q }) => q.left)) - r.left),
      right: f(r.right - Math.max(...inside.map(({ q }) => q.right))),
      top: f(Math.min(...inside.map(({ q }) => q.top)) - r.top),
      bottom: f(r.bottom - Math.max(...inside.map(({ q }) => q.bottom))),
      words: first.e.matches('.cinema-summary__text'),
    };
  }, [selector, items]);

/** Presses Tab until `selector` has focus; returns the number of presses, or -1. */
async function tabTo(page, selector, max = 60, key = 'Tab') {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key);
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return i;
  }
  return -1;
}

const focusedName = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return 'body';
    if (e.dataset.task) return `task:${e.dataset.task}`;
    return e.dataset.seat ? `seat:${e.dataset.seat}` : (e.dataset.action ?? e.dataset.preset ?? (e.dataset.quality ? `quality:${e.dataset.quality}` : null) ?? e.tagName.toLowerCase());
  });

// Every viewport: the room, the seat map (beside it, the sheet, full screen), the film playing —
// measured canvas share, no overflow, steady chrome sizes, touch targets on touch screens.
async function uiLayouts(browser, base) {
  Object.assign(report.ui, { canvas: {}, chrome: {}, smallTargets: {}, hug: {} });
  for (const { name, ...options } of UI_VIEWPORTS) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    attachConsole(page, `ui-${name}`);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await waitForCameraToSettle(page);
    const touchScreen = Boolean(options.hasTouch);
    const portraitPhone = options.viewport.width < 600;
    // Phones (Prompt 13): the room fills the screen; controls are in the hub; the map opens full screen.
    const immersive = await isImmersive(page);
    const shares = {};
    const chrome = {};
    const small = {};
    const hug = {};
    const shot = async (stateName) => {
      shares[stateName] = await canvasShare(page);
      chrome[stateName] = await chromeBox(page);
      if (touchScreen) small[stateName] = await smallTargets(page);
      hug[stateName] = await hugOf(page, '.cinema-taskbar__tools > .cinema-dock__panel', 'button, input, .cinema-summary__text');
      await screenshot(page, `ui-${name}-${stateName}`);
    };

    // Khám phá: steady while the tour starts and stops.
    await shot('1-explore');
    await clickUi(page, 'button[data-action="tour"]');
    await page.waitForTimeout(800);
    const touring = await chromeBox(page);
    const tourHug = await hugOf(page, '.cinema-tourbar', '.cinema-tourbar__icon, button');
    await clickUi(page, 'button[data-action="tour"]');
    await page.waitForTimeout(300);
    const stopped = await chromeBox(page);
    await selectPreset(page, 'overview');

    // Chọn ghế: the summary (sheet closed), then the panel; the summary keeps its size from 0 to 8 seats.
    await ensureTask(page, 'seats');
    await page.waitForTimeout(300);
    if (await page.isVisible('#cinema-seat-panel')) await closeSeatPanel(page);
    await shot('2-seats');
    await openSeatPanel(page);
    const counts = [];
    for (const id of ['F05', 'F06', 'A01', 'A02', 'A03', 'A06', 'A07', 'A08']) {
      await page.click(`button[data-seat="${id}"]`);
      counts.push(await chromeBox(page));
    }
    await page.click('button[data-seat="F06"]');
    await shot('3-seats-open');
    if (immersive || (await page.isVisible('button[data-action="seat-panel-expand"]'))) {
      if (!immersive) {
        await page.click('button[data-action="seat-panel-expand"]');
        await page.waitForTimeout(200);
      }
      const dialog = await page.evaluate(() => {
        const panel = document.querySelector('#cinema-seat-panel');
        const r = panel.getBoundingClientRect();
        return {
          role: panel.getAttribute('role'),
          modal: panel.getAttribute('aria-modal'),
          inert: document.querySelector('.cinema-header').inert && document.querySelector('.cinema-screen').inert,
          coverage: Number(((r.width * r.height) / (innerWidth * innerHeight)).toFixed(3)),
          // The room stays behind the glass (blurred), out of reach: inert, and covered at the centre.
          canvasShown: document.querySelector('canvas').getClientRects().length > 0,
          centreInPanel: panel.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)),
          glass: getComputedStyle(panel).backdropFilter,
          focusInside: panel.contains(document.activeElement),
        };
      });
      check(`ui ${name}: ${immersive ? 'the map opens as' : '"Mở rộng" makes the sheet'} a full-screen dialog — the map is the page (glass over the room, which stays behind it out of reach), the rest inert`, dialog.role === 'dialog' && dialog.modal === 'true' && dialog.inert && dialog.coverage > 0.85 && dialog.centreInPanel && dialog.focusInside, dialog);
      await shot('4-seats-expanded');
      await page.click('button[data-action="seat-panel-close"]');
      await page.waitForSelector('#cinema-seat-panel', { state: 'hidden' });
      const back = await page.evaluate(() => ({ task: document.querySelector('.cinema-app').dataset.task, focus: document.activeElement?.dataset.action ?? null, inert: document.querySelector('.cinema-header').inert }));
      check(`ui ${name}: "Trở lại phòng 3D" closes it; focus returns to ${immersive ? 'the round button' : '"Mở sơ đồ" in the task bar'}, nothing left inert`, back.task === 'seats' && back.focus === (immersive ? 'hub' : 'seat-panel') && !back.inert, back);
    } else {
      await closeSeatPanel(page);
    }
    const summaryFull = await chromeBox(page);
    await shot('2b-seats-eight-selected');

    // The film: the room keeps its size through ready, playing and paused; the header through the mini control.
    await ensureTask(page, 'watch');
    const ready = await chromeBox(page);
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1200);
    await shot('5-watch');
    const playingBox = await chromeBox(page);
    await ensureTask(page, 'explore');
    const miniShown = await page.isVisible('button[data-action="media-mini"]');
    const exploreWithMini = await chromeBox(page);
    await ensureTask(page, 'watch');
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['paused']);
    const pausedBox = await chromeBox(page);

    report.ui.canvas[name] = shares;
    // The films' attribution: all three in Cài đặt › Thông tin (and on the landing page), none in the player.
    const credit = await page.evaluate(() => ({
      player: document.querySelector('.cinema-player__credit') !== null,
      about: [...document.querySelectorAll('#cinema-hub-about a[href]')].map((a) => a.textContent),
    }));
    check(
      `ui ${name}: the three films' attribution and licences are in Cài đặt › Thông tin; the player carries no credit line`,
      !credit.player && credit.about.length === 6 && ['www.bigbuckbunny.org', 'dailydweebs.com', 'caminandes.com'].every((t) => credit.about.some((x) => x.includes(t))) && ['CC BY 3.0', 'CC BY-SA 4.0', 'CC BY'].every((t) => credit.about.includes(t)),
      credit,
    );
    report.ui.chrome[name] = { explore: [chrome['1-explore'], touring, stopped], seats: [chrome['2-seats'], ...counts.slice(-1), summaryFull], watch: [ready, playingBox, pausedBox], exploreWithMini };
    const min = 0.55;
    check(`ui ${name}: Khám phá and Xem phim keep the 3D view ≥ ${Math.round(min * 100)} % of the viewport height (measured canvas)`, shares['1-explore'].heightShare >= min && shares['5-watch'].heightShare >= min, {
      explore: shares['1-explore'].heightShare,
      seats: shares['2-seats'].heightShare,
      watch: shares['5-watch'].heightShare,
    });
    check(`ui ${name}: no page overflow in any state`, Object.values(shares).every((s) => s.overflowX <= 0 && s.overflowY <= 0), Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, [v.overflowX, v.overflowY]])));
    const same = (list) => list.every((b) => JSON.stringify(b) === JSON.stringify(list[0]));
    check(`ui ${name}: chrome and canvas keep their size while the tour starts and stops`, same([chrome['1-explore'], touring, stopped]), [chrome['1-explore'], touring, stopped]);
    // The side panel shares the row with the view: picking seats in it never resizes anything.
    check(`ui ${name}: selecting 1→8 seats never resizes the chrome or the view`, same(counts) && (portraitPhone || options.viewport.width < 1025 ? same([chrome['2-seats'], summaryFull]) : true), { counts: counts.map((c) => c.canvas), summary: [chrome['2-seats'], summaryFull] });
    // Phones have no header: pausing is in the control hub.
    check(`ui ${name}: the room keeps its size through ready → playing → paused; the header's mini control (the round button on phones) never resizes the view`, same([ready, playingBox, pausedBox]) && (miniShown || immersive) && exploreWithMini.header === chrome['1-explore'].header && exploreWithMini.canvas === chrome['1-explore'].canvas, {
      watch: [ready, playingBox, pausedBox],
      exploreWithMini,
      explore: chrome['1-explore'],
    });
    // Even rims (the seat summary's words alone sit 10 px further in than the buttons).
    report.ui.hug[name] = { panes: hug, tour: tourHug };
    const even = (h) => !h || (Math.abs(h.top - h.bottom) <= 0.5 && Math.abs(h.right - h.top) <= 0.5 && Math.abs(h.left - (h.words ? h.top + 10 : h.top)) <= 0.5);
    check(`ui ${name}: each task's pane holds its controls as far from the rim on every side, and so does the tour card (its icon and "Dừng")`, Object.values(hug).every(even) && Boolean(tourHug) && Math.abs(tourHug.left - tourHug.right) <= 0.5 && Math.abs(tourHug.top - tourHug.bottom) <= 0.5, report.ui.hug[name]);
    if (touchScreen) {
      report.ui.smallTargets[name] = small;
      check(`ui ${name}: main touch controls are at least 44 × 44 CSS px`, Object.values(small).every((list) => list.length === 0), small);
    }
    // Tablets: walking puts the stick in the lower left corner, above the task bar, clear of it.
    if (touchScreen && !immersive) {
      await clickUi(page, 'button[data-action="explore"]');
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.explore === 'true');
      await page.waitForTimeout(600);
      const walking = await page.evaluate(() => {
        const box = (e) => {
          const r = e?.getBoundingClientRect();
          return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
        };
        return { stick: box(document.querySelector('.cinema-stick')), bar: [...document.querySelectorAll('.cinema-taskbar > *, .cinema-taskbar__tools > *')].map(box).filter(Boolean), inside: innerHeight };
      });
      await screenshot(page, `ui-${name}-6-walking`);
      await clickUi(page, 'button[data-action="explore"]');
      const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      check(`ui ${name}: walking on a tablet — the stick shows inside the screen and overlaps nothing of the task bar`, walking.stick && walking.stick.y >= 0 && walking.stick.y + walking.stick.h <= walking.inside && walking.bar.every((b) => !hit(walking.stick, b)), walking);
    }
    // Browser toolbars showing and hiding: the dynamic viewport height follows, the view is drawn at once.
    if (portraitPhone) {
      await ensureTask(page, 'explore');
      const tall = await canvasShare(page);
      const frames = await framesAfter(page, () => page.setViewportSize({ width: options.viewport.width, height: options.viewport.height - 70 }));
      const short = await canvasShare(page);
      await page.setViewportSize(options.viewport);
      check(`ui ${name}: a browser toolbar taking 70 px — the view shrinks with it, no overflow, never a blank frame`, short.canvas.height < tall.canvas.height && short.overflowY <= 0 && frames.every((f) => f.deviation > 6), { tall: tall.canvas, short: short.canvas, frames: frames.length });
    }
    await context.close();
  }
}

// Keyboard and focus: the Tab order, the control panel, the seat panel (non-modal beside the view,
// modal when full screen on a phone), Escape and focus return, nothing hidden in the Tab order, no stuck keys.
async function uiFocus(browser, base) {
  report.ui.focus = {};
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    attachConsole(page, 'ui-keyboard');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    await page.evaluate(() => document.activeElement?.blur());
    const order = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      order.push(await focusedName(page));
    }
    report.ui.focus.order = order;
    // Then the task bar: Khám phá's controls (the views, the tour, walking), then the three tasks.
    check(
      'keyboard: Tab goes brand link (home) → "Cài đặt" → Khám phá\'s controls → the task switch; nothing of the other tasks, the closed control panel or the seat map is reached',
      order.slice(0, 3).join() === 'home,settings,overview' && ['tour', 'explore', 'task:explore', 'task:seats', 'task:watch'].every((n) => order.includes(n)) && order.indexOf('explore') < order.indexOf('task:explore') && !order.some((n) => n.startsWith('seat:') || ['media-primary', 'seat-panel', 'quality:high'].includes(n)),
      order,
    );
    await page.focus('button[data-action="settings"]');
    await screenshot(page, 'focus-1-settings-button');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);

    // The control panel: Enter opens it (focus on its title), Tab stays inside, Escape closes it and returns focus.
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
    const opened = await page.evaluate(() => ({ expanded: document.querySelector('button[data-action="settings"]').getAttribute('aria-expanded'), onTitle: document.activeElement?.id === 'cinema-hub-title' }));
    const inside = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      inside.push(await page.evaluate(() => document.querySelector('#cinema-hub-panel').contains(document.activeElement)));
    }
    await page.keyboard.press('Escape');
    const menuClosed = await page.evaluate(() => ({ open: document.querySelector('.cinema-hub').dataset.open, focus: document.activeElement?.dataset.action, inert: document.querySelectorAll('[inert]').length }));
    check('keyboard: "Cài đặt" opens the control panel with Enter (focus on its title), Tab stays inside, Escape closes it and focus returns to its button', opened.expanded === 'true' && opened.onTitle && inside.every(Boolean) && menuClosed.open === 'false' && menuClosed.focus === 'settings' && menuClosed.inert === 0 && outline !== 'none', { opened, inside: inside.filter(Boolean).length, menuClosed, outline });

    // The seat map by keyboard: Chọn ghế in the task bar opens the sidebar, the map (one Tab stop),
    // select, view from the seat.
    await tabTo(page, 'button[data-task="seats"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cinema-seat-panel:not([hidden])');
    const toMap = await tabTo(page, 'button[data-seat][tabindex="0"]');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    const onSeat = await focusedName(page);
    await page.keyboard.press('Enter');
    await screenshot(page, 'focus-2-map-seat');
    const seatOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    const toView = await tabTo(page, 'button[data-action="view-from-seat"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
    const s = await state(page);
    check('keyboard: Chọn ghế → Tab into the map → arrows to F05 → Enter selects → Tab to "Xem từ ghế này" → Enter views from it', toMap > 0 && onSeat === 'seat:F05' && s.seats.selected.includes('F05') && toView > 0 && s.view.seatView === 'F05' && seatOutline !== 'none', { toMap, onSeat, toView, selected: s.seats.selected });

    // The film by keyboard: Xem phim in the task bar, then its player just before it (play, seek, mute, pause).
    await page.focus('button[data-task="watch"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.task === 'watch');
    const toPlay = await tabTo(page, PRIMARY, 60, 'Shift+Tab');
    await page.keyboard.press('Space');
    await waitForFilm(page, ['playing']);
    await screenshot(page, 'focus-3-player');
    await tabTo(page, 'input[data-action="media-seek"]');
    const t0 = (await film(page)).snapshot.currentTime;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const t1 = (await film(page)).snapshot.currentTime;
    await tabTo(page, 'button[data-action="media-mute"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__cinema.filmElement().muted);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__cinema.filmElement().muted);
    await tabTo(page, PRIMARY, 60, 'Shift+Tab');
    await page.keyboard.press('Enter');
    const paused = await waitForFilm(page, ['paused']);
    check('keyboard: Xem phim → Shift+Tab to Phát → Space plays → → seeks 5 s → mute on/off → Enter pauses', toPlay > 0 && t1 - t0 > 4 && paused.snapshot.state === 'paused' && !paused.snapshot.muted, { toPlay, t0, t1 });

    // Escape in the side panel closes it; focus goes to "Sơ đồ ghế" in the task bar (which opens it
    // again); closed parts are out of the Tab order.
    await openSeatPanel(page);
    await page.focus('button[data-action="settings"]');
    await tabTo(page, 'button[data-seat][tabindex="0"]');
    await page.keyboard.press('Escape');
    const escaped = await page.evaluate(() => ({ hidden: document.querySelector('#cinema-seat-panel').hidden, focus: document.activeElement?.dataset.action ?? null, role: document.querySelector('#cinema-seat-panel').getAttribute('role'), modal: document.querySelector('#cinema-seat-panel').hasAttribute('aria-modal') }));
    const reached = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => Boolean(document.activeElement?.closest('#cinema-seat-panel, #cinema-hub-panel, #cinema-more-views'))));
    }
    check('keyboard: the side panel is a non-modal region; Escape closes it, focus back on "Sơ đồ ghế", closed parts never get focus', escaped.hidden && escaped.focus === 'seat-panel' && escaped.role === 'region' && !escaped.modal && !reached.some(Boolean), escaped);

    // A key held while the map opens does not keep the walker going.
    await clickUi(page, 'button[data-action="explore"]');
    await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await openSeatPanel(page);
    await page.keyboard.up('KeyW');
    const left = (await state(page)).view.camera.position;
    await page.waitForTimeout(600);
    await closeSeatPanel(page);
    await page.waitForTimeout(600);
    const after = await state(page);
    check('keyboard: walking with W held, opening the map stops the walker; nothing moves afterwards', !after.exploring && after.view.owner !== 'driver' && distance(after.view.camera.position, left) < 1e-6, { left, after: after.view.camera.position });
    await context.close();
  }
  {
    // Phone (the control hub, Prompt 13): the map opens full screen from the hub, traps focus, takes
    // every press; Escape closes it (no half-open sheet on a phone) and focus returns to the hub's button.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    attachConsole(page, 'ui-sheet-focus');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await openSeatPanel(page);
    await page.waitForTimeout(200);
    const inside = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      inside.push(await page.evaluate(() => document.querySelector('#cinema-seat-panel').contains(document.activeElement)));
    }
    await page.focus('button[data-action="seat-panel-close"]');
    await page.keyboard.press('Shift+Tab');
    const wrapped = await page.evaluate(() => document.querySelector('#cinema-seat-panel').contains(document.activeElement));
    const behind = await page.evaluate(() => {
      const r = document.querySelector('#cinema-seat-panel').getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 10);
      return Boolean(hit && document.querySelector('#cinema-seat-panel').contains(hit));
    });
    check('map (phone): full screen traps focus (Tab and Shift+Tab stay inside) and takes every press', inside.every(Boolean) && wrapped && behind, { inside: inside.filter(Boolean).length, wrapped });
    await page.focus('button[data-seat="F05"]');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ hidden: document.querySelector('#cinema-seat-panel').hidden, focus: document.activeElement?.dataset.action ?? null, inert: document.querySelector('.cinema-screen').inert }));
    const sheetArea = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight - 120)?.closest('#cinema-seat-panel') !== null);
    check("map (phone): Escape closes it at once, focus goes to the control hub's button, the room is usable again and nothing of the map takes presses", closed.hidden && closed.focus === 'hub' && !closed.inert && !sheetArea, closed);
    await context.close();
  }
}

// Loading, failures and their retries: each says what it is, offers the right retry, and keeps
// what the user has (seats, the film's place).
async function uiStates(browser, base) {
  report.ui.states = {};
  // The 3D part arrives late: the page is usable at once (tasks, seat map), the room follows.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.route(/\/src\/cinema\/view\.ts/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    const page = await context.newPage();
    attachConsole(page, 'ui-slow-3d');
    const start = Date.now();
    await page.goto(`${base}cinema`);
    await page.waitForSelector('.cinema-app');
    const shell = Date.now() - start;
    const loading = await page.evaluate(() => ({
      status: document.querySelector('.cinema-app').dataset.status,
      text: document.querySelector('.cinema-status').textContent,
      tourDisabled: document.querySelector('button[data-action="tour"]').disabled,
      playDisabled: document.querySelector('button[data-action="media-primary"]').disabled,
    }));
    await openSeatPanel(page);
    await page.click('button[data-seat="F05"]');
    const selectedEarly = (await seatsState(page)).selected;
    await screenshot(page, 'ui-state-1-loading-3d-code');
    await waitForStatus(page, 20_000);
    const ready = Date.now() - start;
    await nextFrames(page);
    const look = await seatLook(page, 'F05');
    report.ui.states.slow3d = { shellMs: shell, readyMs: ready };
    check('loading: while the 3D part downloads the page says so, camera and play wait, and the seat map already works', loading.status === 'loading' && /phần 3D/.test(loading.text) && loading.tourDisabled && loading.playDisabled && JSON.stringify(selectedEarly) === '["F05"]', { loading, selectedEarly });
    check('loading: once the room is built the seat picked meanwhile is shown in 3D', look.tag && ready > 2500, { readyMs: ready, shellMs: shell });
    await context.close();
  }
  // Reduced motion: the loading skeleton (the room, its words on the screen) does not shimmer.
  {
    const context = await browser.newContext({ viewport: { width: 960, height: 600 }, reducedMotion: 'reduce' });
    await context.route(/\/src\/cinema\/view\.ts/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const page = await context.newPage();
    attachConsole(page, 'ui-reduced-motion-loading');
    await page.goto(`${base}cinema`);
    await page.waitForSelector('.cinema-status .room-skeleton');
    const loading = await page.evaluate(() => ({
      skeleton: getComputedStyle(document.querySelector('.cinema-status .skeleton')).animationName,
      words: getComputedStyle(document.querySelector('.cinema-status .shimmer-text')).animationName,
      text: document.querySelector('.cinema-status').textContent,
    }));
    await waitForStatus(page);
    check('reduced motion: the loading skeleton (room, words on its screen) stands still', loading.skeleton === 'none' && loading.words === 'none' && /Đang/.test(loading.text), loading);
    await context.close();
  }
  // The 3D part fails to download: the page says so, keeps the map and the flat film, offers "Thử lại".
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // Since Prompt 09 the app asks for the 3D part twice at once (an early start and the page's own
    // import); a single failed request is simply retried by the second. Both fail here.
    let failed = 0;
    await context.route(/\/src\/cinema\/view\.ts/, async (route) => {
      if (failed++ < 2) await route.abort('connectionreset');
      else await route.continue();
    });
    const page = await context.newPage();
    attachConsole(page, 'ui-3d-download-fails');
    await page.goto(`${base}cinema`);
    const status = await waitForStatus(page, 15_000);
    const error = await page.evaluate(() => ({
      text: document.querySelector('.cinema-status').textContent,
      retry: Boolean(document.querySelector('button[data-action="retry-scene"]')),
      skeleton: Boolean(document.querySelector('.cinema-status .skeleton')),
      video2d: Boolean(document.querySelector('.cinema-video2d video')),
      task: document.querySelector('.cinema-app').dataset.task,
    }));
    await page.click('button[data-seat="C05"]');
    await screenshot(page, 'ui-state-2-3d-download-failed');
    check('3D download fails: an error (no skeleton) with "Thử lại", the map and the 2D film stay usable', status === 'error' && /Không tải được phần 3D/.test(error.text) && error.retry && !error.skeleton && error.video2d && (await seatsState(page)).selected.includes('C05'), error);
    await page.click('button[data-action="retry-scene"]');
    const after = await page
      .waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.cinema-app').dataset.status) && !document.querySelector('.cinema-status .skeleton'), null, { timeout: 15_000 })
      .then(() => page.evaluate(() => document.querySelector('.cinema-app').dataset.status))
      .catch(() => 'timeout');
    const kept = (await seatsState(page)).selected;
    report.ui.states.downloadRetry = { after, requests: failed };
    // Browsers may remember a failed module for the page's life: then the retry fails again, honestly.
    check('3D download fails: "Thử lại" ends in a definite state (room built, or the error again — never a skeleton), seats kept', ['ready', 'error'].includes(after) && kept.includes('C05'), { after, requests: failed });
    if (after === 'ready') {
      const room = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, video2d: Boolean(document.querySelector('.cinema-video2d')), videos: document.querySelectorAll('video').length }));
      check('3D download fails: after a successful retry the room replaces the 2D film (one canvas, no video left in the page)', room.canvases === 1 && !room.video2d && room.videos === 0, room);
    }
    await context.close();
  }
  // A context the browser never gives back: after a few seconds "Dựng lại cảnh 3D" rebuilds only the
  // scene; seats, the camera's seat view, the film's element and place stay.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    attachConsole(page, 'ui-context-stuck');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await openSeatPanel(page);
    for (const id of ['E03', 'E04']) await page.click(`button[data-seat="${id}"]`);
    await page.click('button[data-action="view-from-seat"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__filmElement = window.__cinema.filmElement();
      window.__oldCanvas = document.querySelector('.cinema-canvas');
      document.querySelector('.cinema-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
    });
    await page.waitForSelector('button[data-action="retry-scene"]', { timeout: 9000 });
    const lostAt = (await film(page)).snapshot;
    await screenshot(page, 'ui-state-3-context-not-restored');
    await page.click('button[data-action="retry-scene"]');
    await waitForStatus(page);
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
    await nextFrames(page);
    const rebuilt = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      newCanvas: document.querySelector('.cinema-canvas') !== window.__oldCanvas,
      sameFilm: window.__filmElement === window.__cinema.filmElement(),
      seatView: window.__cinema.getState().view.seatView,
      selected: window.__cinema.getState().seats.selected,
    }));
    const f = await film(page);
    await page.evaluate(() => {
      delete window.__filmElement;
      delete window.__oldCanvas;
    });
    check('context not given back: "Dựng lại cảnh 3D" rebuilds the scene — one canvas, same seats and seat view, same film element, paused where it was', rebuilt.canvases === 1 && rebuilt.newCanvas && rebuilt.sameFilm && rebuilt.seatView === 'E04' && JSON.stringify(rebuilt.selected) === '["E03","E04"]' && f.paused && Math.abs(f.snapshot.currentTime - lostAt.currentTime) < 0.5 && f.view.screen.content === 'video', { rebuilt, time: [lostAt.currentTime, f.snapshot.currentTime] });
    await screenshot(page, 'ui-state-4-scene-rebuilt');
    await context.close();
  }
  // A film that cannot load, on a narrow phone: the long message stays in its chip, "Thử lại" reloads
  // the film only (same canvas, scene not rebuilt).
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    attachConsole(page, 'ui-media-error');
    await page.goto(`${base}cinema?film=missing.mp4`);
    await waitForStatus(page);
    // On a phone the chip shows over the room without the hub (no task to switch to).
    await ensureTask(page, 'watch');
    await waitForFilm(page, ['error']);
    const chip = await page.evaluate(() => {
      const c = document.querySelector('.cinema-filmstatus').getBoundingClientRect();
      const s = document.querySelector('.cinema-stage').getBoundingClientRect();
      window.__canvas = document.querySelector('.cinema-canvas');
      return { inside: c.x >= s.x && c.right <= s.right + 0.5 && c.bottom <= s.bottom + 0.5, share: Number(((c.width * c.height) / (s.width * s.height)).toFixed(3)), text: document.querySelector('.cinema-player__status').textContent };
    });
    await screenshot(page, 'ui-state-5-media-error-narrow');
    const frames = (await state(page)).view.framesRendered;
    await page.tap('button[data-action="media-retry"]');
    await waitForFilm(page, ['error']);
    const after = await page.evaluate(() => ({ sameCanvas: window.__canvas === document.querySelector('.cinema-canvas'), status: document.querySelector('.cinema-app').dataset.status, frames: window.__cinema.getState().view.framesRendered }));
    check('media error on a narrow phone: the message stays inside its chip over a corner of the room; "Thử lại" reloads only the film', chip.inside && chip.share < 0.5 && /Không mở được video/.test(chip.text) && after.sameCanvas && after.status === 'ready' && after.frames >= frames, { chip, after });
    await context.close();
  }
  // Empty and full selections on a phone.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    attachConsole(page, 'ui-seat-states');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    // The summary is in the control hub on a phone; the map opens full screen from it.
    await ensureTask(page, 'seats');
    const empty = await page.textContent('.cinema-summary__text');
    await openSeatPanel(page);
    for (const id of ['A01', 'A02', 'A03', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11']) await page.click(`button[data-seat="${id}"]`);
    const limit = await page.textContent('.cinema-seats__limit');
    await screenshot(page, 'ui-state-6-limit-reached-sheet');
    await closeSeatPanel(page);
    const full = await page.textContent('.cinema-summary__text');
    // The summary is shown in the hub on a phone (Chọn ghế).
    if (await isImmersive(page)) await reveal(page, '.cinema-summary__text');
    await screenshot(page, 'ui-state-7-summary-eight');
    await closeMenus(page);
    check('seats on a phone: the summary says when nothing is chosen and when the limit is reached; the 9th is refused with the reason; all labelled demo', /Chưa chọn ghế nào/.test(empty) && /Minh họa/.test(empty) && /Đã đủ 8 ghế/.test(limit) && /Đã đủ 8\/8/.test(full), { empty, limit, full });
    await context.close();
  }
}

// Phones (Prompt 13): the room fills the screen and one floating control (the hub) holds every
// control. Fills the viewport at 360/390/430 px and on its side, the renderer follows, menu and
// scrim, keyboard and focus, dragging the button (no camera move, no seat), the card of a seat
// tapped in the room, the full-screen map, sound, walking, the tour, quality, listeners, leaving
// while the film plays, and the problems that must stay in sight (no WebGL, a film that fails).
async function mobileHub(browser, base) {
  report.ui.hub = {};
  const PHONE = { deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const isOpen = async (page) => (await page.getAttribute('.cinema-hub__toggle', 'aria-expanded')) === 'true';
  const openHub = async (page) => {
    if (!(await isOpen(page))) await page.tap('.cinema-hub__toggle');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
  };
  const dismissHint = async (page) => {
    if (await page.isVisible('[data-action="hub-hint-close"]')) await page.tap('[data-action="hub-hint-close"]');
  };
  const geometry = (page) =>
    page.evaluate(() => {
      const box = (element) => {
        const r = element?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      };
      const canvas = document.querySelector('.cinema-canvas');
      const hub = document.querySelector('.cinema-hub');
      const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]');
      const s = window.__cinema?.getState();
      return {
        viewport: { w: innerWidth, h: innerHeight },
        layout: document.querySelector('.cinema-app').dataset.layout,
        canvas: box(canvas),
        buffer: canvas ? { w: canvas.width, h: canvas.height } : null,
        aspect: s?.view?.camera.aspect ?? null,
        overflow: { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight },
        toggle: box(hub.querySelector('.cinema-hub__toggle')),
        panel: box(hub.querySelector('.cinema-hub__panel')),
        // What can be pressed over the room outside the hub (nothing).
        outside: [...document.querySelectorAll('button, a[href], input')]
          .filter((e) => visible(e) && !hub.contains(e))
          .map((e) => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30)),
        // Buttons and stand-alone links in the panel.
        smallTargets: [...hub.querySelectorAll('.cinema-hub__panel button, .cinema-hub__panel a[href]')]
          .filter((e) => visible(e) && e.getBoundingClientRect().height < 44)
          .map((e) => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30)),
        caption: { fresh: document.querySelector('.cinema-caption').dataset.fresh, shown: visible(document.querySelector('.cinema-caption')) },
      };
    });
  const visibleSeat = firstVisibleSeat;
  const inside =(b, v, margin = 0) => b && b.x >= margin - 0.5 && b.y >= margin - 0.5 && b.x + b.w <= v.w - margin + 0.5 && b.y + b.h <= v.h - margin + 0.5;
  const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const fills = (g) => g.canvas && Math.abs(g.canvas.x) < 1 && Math.abs(g.canvas.y) < 1 && Math.abs(g.canvas.w - g.viewport.w) < 1 && Math.abs(g.canvas.h - g.viewport.h) < 1;
  const followsSize = (g) => g.buffer && Math.abs(g.buffer.w / g.buffer.h - g.viewport.w / g.viewport.h) < 0.01 && Math.abs(g.aspect - g.viewport.w / g.viewport.h) < 0.01;

  // A. Sizes: closed (the room and one button), open (a panel that fits, every control reachable).
  for (const [name, viewport] of [
    ['narrow-360x640', { width: 360, height: 640 }],
    ['phone-390x844', { width: 390, height: 844 }],
    ['large-430x932', { width: 430, height: 932 }],
    ['landscape-844x390', { width: 844, height: 390 }],
  ]) {
    const context = await browser.newContext({ viewport, ...PHONE });
    const page = await context.newPage();
    attachConsole(page, `hub-${name}`);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForTimeout(400);
    const hint = await page.isVisible('.cinema-hub__hint');
    await dismissHint(page);
    const closed = await geometry(page);
    await screenshot(page, `hub-${name}-1-closed`);
    await openHub(page);
    await page.waitForTimeout(200);
    const open = await geometry(page);
    await screenshot(page, `hub-${name}-2-open`);
    // The last control is reachable inside the panel (it scrolls, never past the screen), on its
    // Cài đặt screen.
    await page.tap('[data-action="hub-settings"]');
    const last = await page.evaluate(() => {
      const panel = document.querySelector('.cinema-hub__panel');
      const link = panel.querySelector('[data-action="hub-home"]');
      link.scrollIntoView({ block: 'nearest' });
      const p = panel.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      return { within: l.top >= p.top - 0.5 && l.bottom <= p.bottom + 0.5, scrolls: panel.querySelector('.cinema-hub__body').scrollHeight > panel.querySelector('.cinema-hub__body').clientHeight };
    });
    await screenshot(page, `hub-${name}-3-open-end`);
    report.ui.hub[name] = { hint, closed, open, last };
    check(
      `hub ${name}: the room fills the viewport (canvas = viewport, renderer buffer and camera aspect follow), no page scroll, one round button inside the screen`,
      closed.layout === 'immersive' && fills(closed) && followsSize(closed) && closed.overflow.x <= 0 && closed.overflow.y <= 0 && inside(closed.toggle, closed.viewport, 8) && closed.toggle.w >= 48 && closed.toggle.w <= 56,
      { canvas: closed.canvas, buffer: closed.buffer, aspect: closed.aspect, toggle: closed.toggle, overflow: closed.overflow },
    );
    check(`hub ${name}: closed, nothing else to press over the room`, closed.outside.length === 0, closed.outside);
    check(
      `hub ${name}: open, the panel fits the screen, leaves the button visible, scrolls inside to its last control; every control ≥ 44 px`,
      inside(open.panel, open.viewport) && !overlaps(open.panel, open.toggle) && last.within && open.smallTargets.length === 0,
      { panel: open.panel, toggle: open.toggle, last, small: open.smallTargets },
    );
    await context.close();
  }

  // B. One phone, the interactions.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...PHONE });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  attachConsole(page, 'hub-phone');
  await page.goto(`${base}cinema`);
  await waitForStatus(page);
  await page.waitForTimeout(300);
  const firstHint = await page.isVisible('.cinema-hub__hint');
  await dismissHint(page);
  await page.reload();
  await waitForStatus(page);
  await page.waitForTimeout(500);
  const hintAgain = await page.isVisible('.cinema-hub__hint');
  check('hub: the first-visit hint shows once, can be dismissed, and is not shown again on the next visit', firstHint && !hintAgain, { firstHint, hintAgain });
  await page.waitForTimeout(5300);
  const later = await geometry(page);
  check('hub: the caption shows for a moment, then leaves the room clear (it stays in the hub)', later.caption.fresh === 'false' && !later.caption.shown && /Tổng quan/.test((await page.textContent('.cinema-hub__now')) ?? ''), later.caption);

  // The card for a seat tapped in the room, then the view from it and the way back.
  const point = await visibleSeat(page);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForSelector('.cinema-seatcard:not([hidden])', { timeout: 3000 });
  const card = { seat: point.id, text: await page.textContent('.cinema-seatcard__text'), view: await page.isVisible('[data-action="card-view-seat"]'), selected: (await state(page)).seats.selected };
  const cardHug = await hugOf(page, '.cinema-seatcard', 'button');
  check('hub: the seat card holds its buttons as far from the rim on the left, the right and below', Boolean(cardHug) && Math.abs(cardHug.left - cardHug.right) <= 0.5 && Math.abs(cardHug.left - cardHug.bottom) <= 0.5, cardHug);
  await screenshot(page, 'hub-4-seat-card');
  await page.tap('[data-action="card-view-seat"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 8000 });
  const seatView = { cardHidden: await page.isHidden('.cinema-seatcard'), viewing: (await state(page)).view.state, back: await page.isVisible('[data-action="return"]') };
  await page.waitForTimeout(400);
  await screenshot(page, 'hub-5-seat-view');
  await page.tap('[data-action="return"]');
  await page.waitForFunction(() => window.__cinema.getState().view.state === 'preset', null, { timeout: 8000 });
  report.ui.hub.card = { card, seatView };
  check('hub: a seat tapped in the room picks the seat under the finger and shows a card with "Xem từ ghế này", which goes there and clears the card; "Trở về" comes back', (card.text ?? '').includes(card.seat) && card.view && card.selected.includes(card.seat) && seatView.cardHidden && seatView.viewing === 'seat' && seatView.back, report.ui.hub.card);
  await waitForCameraToSettle(page);

  // The scrim takes a press over the room: the panel closes, nothing in the room moves or is picked.
  const camera = async () => (await state(page)).view.camera.position;
  let before = { camera: await camera(), selected: (await state(page)).seats.selected };
  // Outside the panel, on a seat in sight if there is one, so a press that leaked through would pick it.
  await openHub(page);
  const panelBox = (await geometry(page)).panel;
  const free = (await visibleSeat(page, before.selected, panelBox)) ?? { id: null, x: 24, y: (await geometry(page)).viewport.h - 24 };
  await page.touchscreen.tap(free.x, free.y);
  await page.waitForTimeout(400);
  let after = { pressed: free, camera: await camera(), selected: (await state(page)).seats.selected, open: await isOpen(page) };
  check('hub: a press outside the panel closes it and goes no further (no seat picked, camera still)', !after.open && JSON.stringify(after.selected) === JSON.stringify(before.selected) && distance(after.camera, before.camera) < 1e-6, { before, after });

  // Dragging the button: it moves and snaps to the nearest side; no tap, no camera move, no seat.
  before = { camera: await camera(), selected: (await state(page)).seats.selected };
  const start = (await geometry(page)).toggle;
  await touchDrag(cdp, page, [start.x + start.w / 2, start.y + start.h / 2], [-(start.x - 40), -320], 10);
  // The snap is a 0.2 s slide: let frames run (headless Chrome only draws when asked).
  for (let i = 0; i < 4; i++) {
    await nextFrames(page);
    await page.waitForTimeout(100);
  }
  const dropped = await geometry(page);
  after = { camera: await camera(), selected: (await state(page)).seats.selected, open: await isOpen(page) };
  await screenshot(page, 'hub-6-dragged');
  check(
    'hub: dragging the button moves it to the left edge (snapped, inside the safe area) without opening the panel, turning the camera or picking a seat',
    dropped.toggle.x < 40 && inside(dropped.toggle, dropped.viewport, 8) && dropped.toggle.y < start.y - 200 && !after.open && distance(after.camera, before.camera) < 1e-6 && JSON.stringify(after.selected) === JSON.stringify(before.selected),
    { start, dropped: dropped.toggle, after },
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  const turned = await geometry(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const back = await geometry(page);
  report.ui.hub.drag = { start, dropped: dropped.toggle, landscape: turned.toggle, portrait: back.toggle };
  check('hub: after turning the phone (and back) the button stays on its side inside the screen; the room still fills it', inside(turned.toggle, turned.viewport, 8) && turned.toggle.x < 40 && fills(turned) && followsSize(turned) && inside(back.toggle, back.viewport, 8) && fills(back), report.ui.hub.drag);

  // The seat map from the hub: full screen, then "Xem từ ghế này"; Escape closes it to the button.
  await hubTap(page, '.cinema-hub button[data-action="seat-panel"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.panel === 'expanded');
  const map = { hubHidden: await page.isHidden('.cinema-hub__toggle'), focusInPanel: await page.evaluate(() => Boolean(document.activeElement?.closest('#cinema-seat-panel'))) };
  await page.tap('button[data-seat="E03"]');
  await screenshot(page, 'hub-7-map');
  await page.tap('#cinema-seat-panel button[data-action="view-from-seat"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 8000 });
  map.closedForView = (await page.getAttribute('.cinema-app', 'data-panel')) === 'closed';
  await hubTap(page, '.cinema-hub button[data-action="seat-panel"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.panel === 'expanded');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  map.escape = { panel: await page.getAttribute('.cinema-app', 'data-panel'), focus: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) };
  report.ui.hub.map = map;
  check('hub: "Mở sơ đồ" opens the full-screen map (the hub waits behind, focus in the map); "Xem từ ghế này" closes it on the view; Escape closes it with focus back on the button', map.hubHidden && map.focusInPanel && map.closedForView && map.escape.panel === 'closed' && map.escape.focus === 'Mở điều khiển rạp', map);
  await page.tap('[data-action="return"]');
  await waitForCameraToSettle(page);

  // Keyboard: Enter opens with focus inside, Tab stays inside, Escape closes to the button.
  await page.focus('.cinema-hub__toggle');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#cinema-hub-panel:not([hidden])');
  const keys = { focusAfterOpen: await page.evaluate(() => Boolean(document.activeElement?.closest('#cinema-hub-panel'))), expanded: await page.getAttribute('.cinema-hub__toggle', 'aria-expanded') };
  let escaped = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => Boolean(document.activeElement?.closest('#cinema-hub-panel'))))) escaped++;
  }
  keys.tabEscapes = escaped;
  keys.focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none');
  await page.keyboard.press('Escape');
  keys.afterEscape = { open: await isOpen(page), focus: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) };
  report.ui.hub.keys = keys;
  check('hub: keyboard — Enter opens it (aria-expanded, focus inside), 40 × Tab never leaves it, focus is visible, Escape closes it with focus on the button', keys.focusAfterOpen && keys.expanded === 'true' && keys.tabEscapes === 0 && keys.focusVisible && !keys.afterEscape.open && keys.afterEscape.focus === 'Mở điều khiển rạp', keys);

  // Quality, sound and play from the panel: it stays open; the film keeps playing when it closes.
  await openHub(page);
  const quality = await page.getAttribute('.cinema-app', 'data-quality');
  const other = quality === 'high' ? 'economy' : 'high';
  await hubTap(page, `.cinema-hub button[data-quality="${other}"]`);
  await waitForStatus(page);
  const film = { quality: [quality, await page.getAttribute('.cinema-app', 'data-quality')], openAfterQuality: await isOpen(page) };
  await hubTap(page, '.cinema-hub button[data-action="media-primary"]');
  await waitForFilm(page, ['playing']);
  // The element's own volume events report the change a moment later.
  const muted = (value) => page.waitForFunction((v) => document.querySelector('.cinema-player').dataset.muted === v, value, { timeout: 3000 }).then(() => true, () => false);
  await hubTap(page, '.cinema-hub button[data-action="media-mute"]');
  film.muted = await muted('true');
  await hubTap(page, '.cinema-hub button[data-action="media-mute"]');
  film.unmuted = await muted('false');
  film.openAfterSound = await isOpen(page);
  await screenshot(page, 'hub-8-playing-open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  film.playingAfterClose = (await state(page)) && (await page.evaluate(() => window.__cinema.film().snapshot.state));
  film.chipShown = await page.isVisible('.cinema-filmstatus');
  await screenshot(page, 'hub-9-playing-closed');
  await page.tap(`.cinema-hub__toggle`);
  await hubTap(page, `.cinema-hub button[data-quality="${quality}"]`);
  await hubTap(page, '.cinema-hub button[data-action="media-primary"]');
  await waitForFilm(page, ['paused']);
  await page.keyboard.press('Escape');
  report.ui.hub.film = film;
  check('hub: quality, play and sound work from the panel and keep it open; closing it does not pause the film; no film chip over the room while all is well', film.quality[1] === other && film.openAfterQuality && film.muted && film.unmuted && film.openAfterSound && film.playingAfterClose === 'playing' && !film.chipShown, film);

  // Walking and the tour start from the panel, which closes to show them; their controls fit.
  await openHub(page);
  await hubTap(page, '.cinema-hub button[data-action="explore"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.explore === 'true');
  await page.waitForTimeout(1500);
  const walk = await page.evaluate(() => {
    const stick = document.querySelector('.cinema-stick')?.getBoundingClientRect();
    const toggle = document.querySelector('.cinema-hub__toggle').getBoundingClientRect();
    return { stick: stick && stick.width ? { x: stick.x, y: stick.y, w: stick.width, h: stick.height } : null, toggle: { x: toggle.x, y: toggle.y, w: toggle.width, h: toggle.height }, open: document.querySelector('.cinema-hub__toggle').getAttribute('aria-expanded') };
  });
  await screenshot(page, 'hub-10-walking');
  await openHub(page);
  await hubTap(page, '.cinema-hub button[data-action="explore"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.explore === 'false');
  await openHub(page);
  await hubTap(page, '.cinema-hub button[data-action="tour"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.tour !== 'off');
  const tour = { open: await isOpen(page), bar: await page.evaluate(() => { const r = document.querySelector('.cinema-tourbar').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }) };
  await page.tap('[data-action="tour-stop"]');
  await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.tour === 'off');
  report.ui.hub.walkTour = { walk, tour };
  check('hub: "Đi bộ" and "Tham quan" close the panel; the stick shows inside the screen clear of the button; the tour bar fits at the top and stops the tour', walk.open === 'false' && walk.stick && inside(walk.stick, { w: 390, h: 844 }) && !overlaps(walk.stick, walk.toggle) && !tour.open && inside(tour.bar, { w: 390, h: 844 }), report.ui.hub.walkTour);
  // A view from the hub (the panel closes to show it).
  await openHub(page);
  await hubTap(page, '.cinema-hub button[data-preset="overview"]');
  await waitForCameraToSettle(page);

  // Open/close cycles add no listeners and no frames while nothing moves (film paused).
  const listenersBefore = (await liveCounts(cdp, [])).listeners;
  const framesBefore = (await state(page)).view.framesRendered;
  for (let i = 0; i < 6; i++) {
    await openHub(page);
    await page.waitForTimeout(150);
    await page.tap('[data-action="hub-close"]');
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  const framesIdle = (await state(page)).view.framesRendered;
  await page.waitForTimeout(1000);
  const listenersAfter = (await liveCounts(cdp, [])).listeners;
  const quiet = { listenersBefore, listenersAfter, framesDuringCycles: framesIdle - framesBefore, framesIdle: (await state(page)).view.framesRendered - framesIdle };
  report.ui.hub.quiet = quiet;
  check('hub: 6 open/close cycles leave window/document listeners unchanged and nothing renders while the room is still', JSON.stringify(listenersBefore) === JSON.stringify(listenersAfter) && quiet.framesIdle === 0, quiet);

  // Home from the hub while the film plays: nothing keeps playing, no video or canvas is left.
  await openHub(page);
  await hubTap(page, '.cinema-hub button[data-action="media-primary"]');
  await waitForFilm(page, ['playing']);
  await hubTap(page, '.cinema-hub [data-action="hub-home"]');
  await page.waitForSelector('[data-landing] .hero');
  await cdp.send('HeapProfiler.collectGarbage');
  const left = await page.evaluate(() => ({ route: document.documentElement.dataset.route, videos: document.querySelectorAll('video').length, canvases: document.querySelectorAll('canvas').length, fullscreen: document.fullscreenElement !== null }));
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: 'HTMLVideoElement.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  left.liveVideos = (await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true })).result.value;
  report.ui.hub.leave = left;
  check('hub: "Về trang chủ" while the film plays — on the landing page no video element is alive (after GC), no canvas', left.route === 'landing' && left.liveVideos === 0 && left.canvases === 0, left);
  await page.goBack();
  await waitForStatus(page);
  check('hub: Back returns to the room in the phone layout with one canvas and the button', (await page.getAttribute('.cinema-app', 'data-layout')) === 'immersive' && (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 1 && (await page.isVisible('.cinema-hub__toggle')));
  await context.close();

  // C. Problems stay in sight without opening the hub: no WebGL, then a film that cannot load.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...PHONE });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    const page = await context.newPage();
    attachConsole(page, 'webgl-disabled');
    await page.goto(`${base}cinema`);
    await waitForStatus(page, 10_000);
    const noWebgl = await page.evaluate(() => ({
      status: document.querySelector('.cinema-app').dataset.status,
      message: document.querySelector('.cinema-status')?.textContent,
      statusShown: document.querySelector('.cinema-status').getClientRects().length > 0,
      panel: document.querySelector('.cinema-app').dataset.panel,
      video2d: Boolean(document.querySelector('.cinema-video2d video')),
    }));
    await screenshot(page, 'hub-11-no-webgl');
    await openHub(page);
    await hubTap(page, '.cinema-hub button[data-action="media-primary"]');
    await waitForFilm(page, ['playing']);
    await hubTap(page, '.cinema-hub button[data-action="media-primary"]');
    await waitForFilm(page, ['paused']);
    await hubTap(page, '.cinema-hub button[data-action="seat-panel"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.panel === 'expanded');
    await page.tap('button[data-seat="F04"]');
    noWebgl.picked = await page.getAttribute('button[data-seat="F04"]', 'aria-pressed');
    report.ui.hub.noWebgl = noWebgl;
    check('hub, no WebGL: the reason stays on screen (not hidden in the menu), the 2D film plays and pauses from the hub, the map opens from it and picks a seat', noWebgl.status === 'error' && noWebgl.statusShown && /WebGL/.test(noWebgl.message ?? '') && noWebgl.panel === 'closed' && noWebgl.video2d && noWebgl.picked === 'true', noWebgl);
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...PHONE });
    const page = await context.newPage();
    attachConsole(page, 'hub-film-error');
    await page.goto(`${base}cinema?film=not-a-video.mp4`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'error', null, { timeout: 15_000 });
    // First visit: the hint goes above the error, not over it.
    await nextFrames(page);
    const firstVisit = await page.evaluate(() => {
      const box = (element) => {
        if (!element || element.getClientRects().length === 0) return null;
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return { hint: box(document.querySelector('.cinema-hub__hint')), chip: box(document.querySelector('.cinema-filmstatus')) };
    });
    await screenshot(page, 'hub-12-film-error-hint');
    report.ui.hub.hintOverError = firstVisit;
    check('hub: on a first visit with a film problem, the hint shows above the problem chip, not covering it', firstVisit.hint && firstVisit.chip && !overlaps(firstVisit.hint, firstVisit.chip), firstVisit);
    await dismissHint(page);
    const chip = await page.evaluate(() => {
      const element = document.querySelector('.cinema-filmstatus');
      const r = element.getBoundingClientRect();
      return { shown: element.getClientRects().length > 0, level: element.dataset.level, retry: document.querySelector('[data-action="media-retry"]').getClientRects().length > 0, box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    await screenshot(page, 'hub-12-film-error');
    report.ui.hub.filmError = chip;
    check('hub: a film that cannot be played shows its error and "Thử lại" over the room, without opening the hub', chip.shown && chip.level === 'error' && chip.retry && inside(chip.box, { w: 390, h: 844 }), chip);
    await context.close();
  }

  // D. (Prompt 14) Wherever the button is dragged it covers none of the room's controls or the film's
  // problems; closing by a press outside leaves the room drawing; a wide layout reached with the hub
  // or the map open leaves nothing modal behind; full screen follows the Fullscreen API; leaving for
  // the landing page leaves its listeners as they were.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...PHONE });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    attachConsole(page, 'hub-overlays');
    await page.goto(base);
    await waitForLanding(page);
    const landingListeners = (await liveCounts(cdp, [])).listeners;
    // In-app, so the landing page's document stays: a film that fails, to show its chip.
    await page.evaluate(() => {
      history.pushState(null, '', '/cinema?film=not-a-video.mp4');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'error', null, { timeout: 15_000 });
    await dismissHint(page);
    const rect = (selector) =>
      page.evaluate((s) => {
        const e = document.querySelector(s);
        if (!e || e.getClientRects().length === 0) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, selector);
    const dragTo = async ([tx, ty]) => {
      const t = await rect('.cinema-hub__toggle');
      await touchDrag(cdp, page, [t.x + t.w / 2, t.y + t.h / 2], [tx - (t.x + t.w / 2), ty - (t.y + t.h / 2)], 10);
      for (let i = 0; i < 4; i++) {
        await nextFrames(page);
        await page.waitForTimeout(80);
      }
    };
    const covers = {};
    await dragTo([370, 20]);
    covers.topRight = { toggle: await rect('.cinema-hub__toggle'), chip: await rect('.cinema-filmstatus') };
    await dragTo([20, 20]);
    await openHub(page);
    await hubTap(page, '.cinema-hub button[data-action="tour"]');
    await page.waitForTimeout(600);
    covers.topLeft = { toggle: await rect('.cinema-hub__toggle'), bar: await rect('.cinema-tourbar'), chip: await rect('.cinema-filmstatus') };
    await screenshot(page, 'hub-13-dragged-top-tour');
    await page.tap('[data-action="tour-stop"]');
    covers.tourStopped = (await page.getAttribute('.cinema-app', 'data-tour')) === 'off';
    await dragTo([20, 824]);
    await openHub(page);
    await hubTap(page, '.cinema-hub button[data-action="explore"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.explore === 'true');
    await page.waitForTimeout(1200);
    covers.bottomLeft = { toggle: await rect('.cinema-hub__toggle'), stick: await rect('.cinema-stick') };
    await screenshot(page, 'hub-14-dragged-walking');
    await openHub(page);
    await hubTap(page, '.cinema-hub button[data-action="explore"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.explore === 'false');
    report.ui.hub.covers = covers;
    check(
      'hub: dragged to a top corner or the bottom left, the button covers neither the tour bar, the film\'s problem chip nor the walking stick; "Dừng" stays pressable; the chip never meets the tour bar',
      !overlaps(covers.topRight.toggle, covers.topRight.chip) && !overlaps(covers.topLeft.toggle, covers.topLeft.bar) && !overlaps(covers.topLeft.bar, covers.topLeft.chip) && covers.tourStopped && !overlaps(covers.bottomLeft.toggle, covers.bottomLeft.stick),
      covers,
    );

    // Closed by a press outside, the room keeps drawing: a drag right after renders new frames.
    await openHub(page);
    const panel = await rect('.cinema-hub__panel');
    const outside = panel.y > 100 ? [200, 40] : [200, 820];
    await page.touchscreen.tap(...outside);
    await page.waitForTimeout(300);
    const drawing = { open: await isOpen(page), frames: (await state(page)).view.framesRendered };
    await touchDrag(cdp, page, [195, 420], [90, 0], 8);
    await page.waitForTimeout(400);
    drawing.framesAfter = (await state(page)).view.framesRendered;
    report.ui.hub.drawing = drawing;
    check('hub: after a press outside closes it, the room keeps drawing — a drag right after renders new frames', !drawing.open && drawing.framesAfter > drawing.frames, drawing);
    await waitForCameraToSettle(page);

    // A wide layout reached with the hub open, then with the map open: nothing modal stays behind.
    const modalState = () =>
      page.evaluate(() => ({
        layout: document.querySelector('.cinema-app').dataset.layout,
        panel: document.querySelector('.cinema-app').dataset.panel,
        inert: document.querySelectorAll('[inert]').length,
        scrim: document.querySelector('.cinema-hub__scrim').getClientRects().length > 0,
        hubOpen: document.querySelector('.cinema-hub__toggle').getAttribute('aria-expanded'),
        hubShown: document.querySelector('.cinema-hub__toggle').getClientRects().length > 0,
        header: document.querySelector('.cinema-header').getClientRects().length > 0,
        // The task switch and the tasks' controls move as they are: over the room, or into the hub.
        tasksIn: document.querySelector('.cinema-tasks').closest('.cinema-taskbar') ? 'taskbar' : document.querySelector('.cinema-tasks').closest('.cinema-hub') ? 'hub' : 'other',
        docksIn: [...new Set([...document.querySelectorAll('[data-dock]')].map((d) => (d.closest('.cinema-taskbar') ? 'taskbar' : d.closest('.cinema-hub') ? 'hub' : 'other')))].join(),
        modal: document.querySelector('#cinema-seat-panel').getAttribute('aria-modal'),
        overflow: document.documentElement.scrollWidth - innerWidth,
      }));
    await openHub(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);
    const wideFromHub = await modalState();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await openSeatPanel(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);
    const wideFromMap = await modalState();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const phoneAgain = await modalState();
    await closeSeatPanel(page);
    const phoneClosed = await modalState();
    report.ui.hub.breakpoints = { wideFromHub, wideFromMap, phoneAgain, phoneClosed };
    check(
      'hub: going wide with the hub open closes it (no scrim, nothing inert, the header with "Cài đặt" back, the tasks and their controls back in the task bar, no round button); with the map open it becomes the side panel (not modal, nothing inert); back on the phone the map is full screen again and, closed, the room and its button are usable with the tasks in the hub',
      wideFromHub.layout === 'standard' && wideFromHub.inert === 0 && !wideFromHub.scrim && wideFromHub.hubOpen === 'false' && !wideFromHub.hubShown && wideFromHub.header && wideFromHub.tasksIn === 'taskbar' && wideFromHub.docksIn === 'taskbar' &&
        phoneClosed.tasksIn === 'hub' && phoneClosed.docksIn === 'hub' &&
        wideFromMap.panel === 'open' && wideFromMap.modal === null && wideFromMap.inert === 0 &&
        phoneAgain.layout === 'immersive' && phoneAgain.panel === 'expanded' && phoneAgain.modal === 'true' &&
        phoneClosed.panel === 'closed' && phoneClosed.inert === 0 && phoneClosed.hubShown && phoneClosed.overflow <= 0,
      report.ui.hub.breakpoints,
    );

    // Full screen: offered as the API allows; on, then off; refused, it says so and the page carries on.
    // It is in Cài đặt › Hiển thị (on a phone through the panel's "Cài đặt" row).
    await openHub(page);
    await page.tap('[data-action="hub-settings"]');
    const fullscreen = {
      api: await page.evaluate(() => document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function'),
      shown: await page.isVisible('.cinema-hub [data-action="fullscreen"]'),
    };
    await hubTap(page, '.cinema-hub [data-action="fullscreen"]');
    await page.waitForTimeout(500);
    fullscreen.on = await page.evaluate(() => ({ element: document.fullscreenElement !== null, pressed: document.querySelector('[data-action="fullscreen"]').getAttribute('aria-pressed') }));
    if (fullscreen.on.element) {
      await hubTap(page, '.cinema-hub [data-action="fullscreen"]');
      await page.waitForTimeout(500);
    }
    fullscreen.off = await page.evaluate(() => document.fullscreenElement === null);
    await page.evaluate(() => (Element.prototype.requestFullscreen = () => Promise.reject(new Error('refused'))));
    await hubTap(page, '.cinema-hub [data-action="fullscreen"]');
    await page.waitForTimeout(300);
    fullscreen.refused = await page.evaluate(() => ({ note: document.querySelector('.cinema-hub__fullscreen + .cinema-hub__note').textContent, element: document.fullscreenElement !== null }));
    await page.tap('[data-action="hub-close"]');
    fullscreen.usable = (await page.isVisible('.cinema-hub__toggle')) && (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 1;
    report.ui.hub.fullscreen = fullscreen;
    check('hub: "Toàn màn hình" is offered because the Fullscreen API is there; it turns full screen on and off; when the browser refuses, it says so and the page stays usable', fullscreen.api && fullscreen.shown && fullscreen.on.element && fullscreen.on.pressed === 'true' && fullscreen.off && /không cho/.test(fullscreen.refused.note) && !fullscreen.refused.element && fullscreen.usable, fullscreen);

    // Home from the hub: the landing page's listeners are back to what they were before the room.
    await openHub(page);
    await hubTap(page, '.cinema-hub [data-action="hub-home"]');
    await page.waitForSelector('[data-landing] .hero');
    const after = await liveCounts(cdp, []);
    report.ui.hub.landingListeners = { before: landingListeners, after: after.listeners };
    check('hub: back on the landing page, window and document listeners are what they were before entering the room', JSON.stringify(after.listeners) === JSON.stringify(landingListeners), report.ui.hub.landingListeners);
    await context.close();
  }
  // Without the Fullscreen API (iPhone Safari, a frame that does not allow it), the button is not offered.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...PHONE });
    await context.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
    const page = await context.newPage();
    attachConsole(page, 'hub-no-fullscreen');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await dismissHint(page);
    await openHub(page);
    await page.tap('[data-action="hub-settings"]');
    const offered = await page.isVisible('.cinema-hub [data-action="fullscreen"]');
    check('hub: without the Fullscreen API the "Toàn màn hình" button is not offered (the rest of Hiển thị is)', !offered && (await page.isVisible('.cinema-hub button[data-quality="economy"]')), { offered });
    await context.close();
  }
}

// Cài đặt: one panel, one screen at a time (Cài đặt, Hướng dẫn nhanh, Thông tin, Công cụ nâng cao;
// on a phone the task screen first). Short rows, no help text on the main screen; the way back,
// Escape and × at every level; focus where it belongs; nothing of the room changes on the way.
async function uiSettings(browser, base) {
  report.ui.settings = {};
  /** What the panel shows now: its screen, title, accessible name, focus, and what can be reached. */
  const panelState = (page) =>
    page.evaluate(() => {
      const panel = document.querySelector('#cinema-hub-panel');
      const shown = (e) => Boolean(e) && e.getClientRects().length > 0 && !e.closest('[hidden]');
      const name = (e) => e?.dataset.action ?? e?.dataset.task ?? e?.dataset.quality ?? e?.dataset.preset ?? e?.dataset.toggle ?? (e?.id || e?.tagName.toLowerCase());
      const view = panel.querySelector(`.cinema-hub__view[data-view="${panel.dataset.view}"]`);
      const r = panel.getBoundingClientRect();
      const close = panel.querySelector('[data-action="hub-close"]').getBoundingClientRect();
      const body = panel.querySelector('.cinema-hub__body');
      return {
        open: !panel.hidden,
        view: panel.dataset.view,
        title: panel.querySelector('#cinema-hub-title').textContent,
        label: document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent ?? null,
        focus: panel.contains(document.activeElement) ? name(document.activeElement) : document.activeElement?.dataset.action ?? null,
        back: shown(panel.querySelector('[data-action="hub-back"]')) ? panel.querySelector('[data-action="hub-back"]').getAttribute('aria-label') : null,
        now: shown(panel.querySelector('.cinema-hub__now')),
        tasks: shown(panel.querySelector('.cinema-hub__tasks .cinema-tasks')),
        groups: view ? [...view.querySelectorAll('.cinema-hub__group-title')].filter(shown).map((e) => e.textContent) : [],
        rows: view ? [...view.querySelectorAll('.cinema-hub__row .cinema-hub__label, .cinema-hub__row.cinema-switch .cinema-switch__label, .cinema-hub__row[data-preset]')].filter(shown).map((e) => e.textContent.trim()) : [],
        text: view?.innerText ?? '',
        // Focusable things outside the screen shown (must be none: hidden screens are out of reach).
        hiddenFocusable: [...panel.querySelectorAll('a[href], button, input')].filter((e) => !shown(e) && e.closest('.cinema-hub__view') && !e.closest('.cinema-hub__view[hidden]') && e.closest('[hidden]') === null).length,
        box: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right },
        closeShown: close.width > 0 && close.top >= -0.5 && close.bottom <= innerHeight + 0.5,
        scrolls: body.scrollHeight > body.clientHeight + 1,
        overflowX: body.scrollWidth - body.clientWidth,
        viewport: { w: innerWidth, h: innerHeight },
      };
    });
  /** The room's state that no screen change may touch. */
  const roomState = async (page) => {
    const s = await state(page);
    return { task: s.task, panel: s.panel, preset: s.preset, seats: s.seats.selected, camera: s.view?.camera.position.map((v) => +v.toFixed(3)), film: await page.getAttribute('.cinema-player', 'data-state'), canvases: s.canvasCount };
  };
  const tabStops = async (page, presses = 16) => {
    const stops = [];
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const e = document.activeElement;
        return document.querySelector('#cinema-hub-panel').contains(e) && !e.closest('[hidden]') ? (e.dataset.action ?? e.dataset.quality ?? e.dataset.toggle ?? e.dataset.preset ?? e.id ?? e.tagName) : `outside:${e?.tagName}`;
      }));
    }
    return stops;
  };

  // A. Desktop, by keyboard: "Cài đặt" opens on its main screen; each sub-screen and back.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachConsole(page, 'settings-desktop');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await waitForCameraToSettle(page);
    // Chọn ghế with a seat chosen and the sidebar open: a press that went through would change them.
    await page.click('button[data-task="seats"]');
    await page.waitForSelector('#cinema-seat-panel:not([hidden])');
    await page.click('button[data-seat="F05"]');
    const before = await roomState(page);
    await page.focus('button[data-action="settings"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
    const main = await panelState(page);
    await screenshot(page, 'settings-desktop-1-main');
    const mainStops = await tabStops(page);
    check(
      'settings (desktop): "Cài đặt" opens its main screen — title and dialog name "Cài đặt", focus on the title; Hiển thị (Chất lượng, Giảm hiệu ứng kính, Toàn màn hình) and Khác (Hướng dẫn nhanh, Thông tin, Công cụ nâng cao), "Về trang chủ" at the foot; no camera line, task switch, help text or explanations',
      main.view === 'settings' && main.title === 'Cài đặt' && main.label === 'Cài đặt' && main.focus === 'cinema-hub-title' && main.back === null && !main.now && !main.tasks &&
        JSON.stringify(main.groups) === JSON.stringify(['Hiển thị', 'Khác']) &&
        JSON.stringify(main.rows) === JSON.stringify(['Chất lượng', 'Giảm hiệu ứng kính', 'Toàn màn hình', 'Hướng dẫn nhanh', 'Thông tin', 'Công cụ nâng cao']) &&
        /Về trang chủ\s*$/.test(main.text) && !/Điều hướng|Tổng quan|Kéo|WASD|Tiết kiệm:|Nền đặc/.test(main.text),
      { ...main, text: main.text.split('\n') },
    );
    check('settings (desktop): Tab stays inside the panel and only reaches the screen shown', mainStops.every((s) => !s.startsWith('outside')) && mainStops.includes('hub-help') && mainStops.includes('hub-home') && !mainStops.includes('hub-back') && main.hiddenFocusable === 0, mainStops);

    // Hướng dẫn nhanh: four lines; Escape goes back to Cài đặt, focus on its row.
    await page.focus('[data-action="hub-help"]');
    await page.keyboard.press('Enter');
    const help = await panelState(page);
    await screenshot(page, 'settings-desktop-2-help');
    const helpStops = await tabStops(page, 6);
    await page.keyboard.press('Escape');
    const helpBack = await panelState(page);
    check(
      'settings (desktop): "Hướng dẫn nhanh" replaces the screen in the same panel — title and dialog name follow, focus on the title, "Quay lại Cài đặt"; four lines for the mouse; Tab reaches only back and ×; Escape returns to Cài đặt with focus on its row',
      help.open && help.view === 'help' && help.title === 'Hướng dẫn nhanh' && help.label === 'Hướng dẫn nhanh' && help.focus === 'cinema-hub-title' && help.back === 'Quay lại Cài đặt' &&
        JSON.stringify(help.rows) === JSON.stringify(['Nhìn quanh', 'Chọn ghế', 'Đi bộ', 'Phát phim']) && /Kéo chuột/.test(help.text) && /WASD, phím mũi tên/.test(help.text) &&
        helpStops.every((s) => ['hub-back', 'hub-close'].includes(s)) &&
        helpBack.open && helpBack.view === 'settings' && helpBack.focus === 'hub-help',
      { help: { ...help, text: help.text.split('\n') }, helpStops, helpBack: { view: helpBack.view, focus: helpBack.focus } },
    );

    // Thông tin: the brand, the demo note, each film's credit and licence links; "Quay lại" returns to its row.
    await page.click('[data-action="hub-about"]');
    const about = await panelState(page);
    const links = await page.$$eval('#cinema-hub-about a[href]', (list) => list.map((a) => ({ text: a.textContent, href: a.href, target: a.target })));
    const groups = await page.$$eval('#cinema-hub-about .cinema-hub__group-title', (list) => list.map((h) => h.textContent));
    await screenshot(page, 'settings-desktop-3-about');
    await page.click('[data-action="hub-back"]');
    const aboutBack = await panelState(page);
    check(
      'settings (desktop): "Thông tin" shows Tân Phong Cinema, "Bản demo — không bán vé hoặc giữ chỗ." and, for each of the three films, its credit and licence links; "Quay lại" returns focus to its row (the player has no credit line)',
      about.view === 'about' && about.title === 'Thông tin' && /Tân Phong Cinema/.test(about.text) && about.text.includes('Bản demo — không bán vé hoặc giữ chỗ.') &&
        JSON.stringify(groups) === JSON.stringify(['Big Buck Bunny (trailer)', 'The Daily Dweebs', 'Caminandes 3: Llamigos']) && links.length === 6 &&
        links.some((l) => /Blender Foundation/.test(l.text) && l.href.startsWith('https://')) && links.some((l) => l.text === 'CC BY 3.0' && /creativecommons/.test(l.href)) && links.some((l) => l.text === 'CC BY-SA 4.0' && /creativecommons/.test(l.href)) && links.every((l) => l.target === '_blank') &&
        aboutBack.view === 'settings' && aboutBack.focus === 'hub-about' && (await page.$$('.cinema-player__credit')).length === 0,
      { about: about.text.split('\n'), groups, links, back: aboutBack.focus },
    );

    // Công cụ nâng cao: its two groups and the seat inspector; a switch keeps the screen; × closes all.
    await page.click('[data-action="inspect-tools"]');
    const advanced = await panelState(page);
    await screenshot(page, 'settings-desktop-4-advanced');
    await page.click('label:has(input[data-toggle="ceiling"])');
    const ceilingOff = { visible: (await state(page)).visibility.ceiling, checked: await page.isChecked('input[data-toggle="ceiling"]'), view: (await panelState(page)).view };
    await page.click('label:has(input[data-toggle="ceiling"])');
    const ceilingOn = (await state(page)).visibility.ceiling;
    await page.click('[data-action="hub-close"]');
    const closed = await panelState(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
    const reopened = await panelState(page);
    check(
      'settings (desktop): "Công cụ nâng cao" has Góc kiểm tra (Mặt cắt bên, Mặt bằng), Thành phần phòng (Trần, Vách sau, Vách phải) and "Kiểm tra ghế"; a part switch works and keeps the screen; × closes the whole panel (focus on "Cài đặt") and it opens again on Cài đặt',
      advanced.view === 'advanced' && advanced.title === 'Công cụ nâng cao' && JSON.stringify(advanced.groups) === JSON.stringify(['Góc kiểm tra', 'Thành phần phòng']) &&
        JSON.stringify(advanced.rows) === JSON.stringify(['Mặt cắt bên', 'Mặt bằng', 'Trần', 'Vách sau', 'Vách phải', 'Kiểm tra ghế']) &&
        ceilingOff.visible === false && !ceilingOff.checked && ceilingOff.view === 'advanced' && ceilingOn === true &&
        !closed.open && closed.focus === 'settings' && reopened.view === 'settings' && reopened.title === 'Cài đặt',
      { advanced: advanced.rows, groups: advanced.groups, ceilingOff, ceilingOn, closedFocus: closed.focus, reopened: reopened.view },
    );

    // Hiển thị: quality, less glass and full screen do what they say (and the labels follow).
    await page.click('button[data-quality="economy"]');
    const economy = await page.getAttribute('.cinema-app', 'data-quality');
    await page.click('button[data-quality="high"]');
    await page.click('label:has(input[data-toggle="glass"])');
    const glassOn = await page.evaluate(() => document.documentElement.dataset.glass ?? null);
    await page.click('label:has(input[data-toggle="glass"])');
    const glassOff = await page.evaluate(() => document.documentElement.dataset.glass ?? null);
    const fullscreen = { offered: await page.isVisible('[data-action="fullscreen"]') };
    await page.click('[data-action="fullscreen"]');
    await page.waitForTimeout(400);
    fullscreen.on = await page.evaluate(() => ({ element: document.fullscreenElement !== null, label: document.querySelector('[data-action="fullscreen"]').textContent, pressed: document.querySelector('[data-action="fullscreen"]').getAttribute('aria-pressed') }));
    if (fullscreen.on.element) {
      await page.click('[data-action="fullscreen"]');
      await page.waitForTimeout(400);
    }
    fullscreen.off = await page.evaluate(() => ({ element: document.fullscreenElement !== null, label: document.querySelector('[data-action="fullscreen"]').textContent }));
    check(
      'settings (desktop): Chất lượng switches the level, "Giảm hiệu ứng kính" turns solid panes on and off, "Toàn màn hình" turns full screen on (the row then reads "Thoát toàn màn hình") and off',
      economy === 'economy' && (await page.getAttribute('.cinema-app', 'data-quality')) === 'high' && glassOn === 'reduced' && glassOff === null &&
        fullscreen.offered && fullscreen.on.element && fullscreen.on.label === 'Thoát toàn màn hình' && fullscreen.on.pressed === 'true' && !fullscreen.off.element && fullscreen.off.label === 'Toàn màn hình',
      { economy, glassOn, glassOff, fullscreen },
    );

    // A press beside the panel only closes it: no seat, no camera move; nothing of the room changed.
    await page.mouse.click(300, 560);
    await page.waitForTimeout(400);
    const after = await roomState(page);
    const outside = await panelState(page);
    check('settings (desktop): a press on the room beside the panel only closes it; after every screen and setting, the task, seats, camera, film and canvas are as they were', !outside.open && JSON.stringify(after) === JSON.stringify(before), { before, after });

    // Escape on the main screen closes the panel and focus returns to "Cài đặt".
    await page.focus('button[data-action="settings"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
    await page.keyboard.press('Escape');
    const escaped = await panelState(page);
    check('settings (desktop): Escape on Cài đặt closes the panel; focus returns to "Cài đặt"', !escaped.open && escaped.focus === 'settings', escaped.focus);

    // Desktop → phone → desktop with a sub-screen open: the panel closes and opens again on the
    // first screen of each layout; the room keeps its task, seats and film. (Khám phá first: with
    // the seat sidebar open, a phone would show the full-screen map instead.)
    await page.click('button[data-task="explore"]');
    await page.click('button[data-action="settings"]');
    await page.click('[data-action="inspect-tools"]');
    const wideState = await roomState(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.layout === 'immersive');
    await page.waitForTimeout(300);
    const narrow = await panelState(page);
    await page.click('.cinema-hub__toggle');
    const narrowOpen = await panelState(page);
    await page.click('[data-action="hub-close"]');
    const phoneState = await roomState(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.layout === 'standard');
    await page.click('button[data-action="settings"]');
    const wideAgain = await panelState(page);
    await page.click('[data-action="hub-close"]');
    const keep = (s) => JSON.stringify([s.task, s.seats, s.film, s.canvases]);
    check(
      'settings (resize): a sub-screen open while the window turns into a phone closes the panel; the round button opens it on the task screen, "Cài đặt" (wide again) on Cài đặt; task, seats, film and canvas kept',
      !narrow.open && narrowOpen.view === 'task' && narrowOpen.title === 'Điều khiển rạp' && wideAgain.view === 'settings' && keep(wideState) === keep(phoneState) && keep(phoneState) === keep(await roomState(page)),
      { narrow: narrow.open, narrowOpen: narrowOpen.view, wideAgain: wideAgain.view, wideState, phoneState },
    );
    report.ui.settings.desktop = { main: main.rows, groups: main.groups, help: help.rows, advanced: advanced.rows, links };
    await context.close();
  }

  // B. Phone: the task screen first, then "Cài đặt"; back, Escape and × at every level; the task and
  // the room stay as they were.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await context.addInitScript(() => localStorage.setItem('tp-cinema-hub-hint', 'seen'));
    const page = await context.newPage();
    attachConsole(page, 'settings-phone');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await waitForCameraToSettle(page);
    await page.tap('.cinema-hub__toggle');
    await page.waitForSelector('#cinema-hub-panel:not([hidden])');
    await page.tap('.cinema-hub button[data-task="watch"]');
    await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.task === 'watch');
    const task = await panelState(page);
    const before = await roomState(page);
    await screenshot(page, 'settings-phone-1-task');
    await page.tap('[data-action="hub-settings"]');
    const settings = await panelState(page);
    await screenshot(page, 'settings-phone-2-settings');
    await page.tap('[data-action="hub-back"]');
    const backToTask = await panelState(page);
    check(
      'settings (phone): the panel opens on the task screen ("Điều khiển rạp", camera line, the three tasks, the task\'s controls, a "Cài đặt" row); "Cài đặt" changes the same panel to Cài đặt (no camera line or task switch, "Quay lại Điều khiển rạp"); back returns to the task in use, focus on the row',
      task.view === 'task' && task.title === 'Điều khiển rạp' && task.now && task.tasks && JSON.stringify(task.rows) === JSON.stringify(['Cài đặt']) &&
        settings.view === 'settings' && settings.title === 'Cài đặt' && settings.label === 'Cài đặt' && !settings.now && !settings.tasks && settings.back === 'Quay lại Điều khiển rạp' &&
        JSON.stringify(settings.groups) === JSON.stringify(['Hiển thị', 'Khác']) && settings.closeShown && settings.box.bottom <= settings.viewport.h + 0.5 &&
        backToTask.view === 'task' && backToTask.focus === 'hub-settings' && (await state(page)).task === 'watch',
      { task: { rows: task.rows, now: task.now }, settings: { rows: settings.rows, back: settings.back, box: settings.box }, backFocus: backToTask.focus },
    );

    // Sub-screens, then Escape step by step: help → Cài đặt → task → closed.
    await page.tap('[data-action="hub-settings"]');
    await page.tap('[data-action="hub-help"]');
    const help = await panelState(page);
    await screenshot(page, 'settings-phone-3-help');
    await page.keyboard.press('Escape');
    const esc1 = await panelState(page);
    await page.keyboard.press('Escape');
    const esc2 = await panelState(page);
    await page.keyboard.press('Escape');
    const esc3 = await panelState(page);
    check(
      'settings (phone): "Hướng dẫn nhanh" speaks of fingers (Kéo một ngón, Chạm ghế, Cần điều khiển); Escape goes back one screen at a time (Cài đặt, then the task), then closes with focus on the round button',
      help.view === 'help' && JSON.stringify(help.rows) === JSON.stringify(['Nhìn quanh', 'Chọn ghế', 'Đi bộ', 'Phát phim']) && /Kéo một ngón/.test(help.text) && /Chạm ghế hoặc mở sơ đồ/.test(help.text) && /Cần điều khiển/.test(help.text) &&
        esc1.open && esc1.view === 'settings' && esc1.focus === 'hub-help' && esc2.open && esc2.view === 'task' && esc2.focus === 'hub-settings' && !esc3.open && esc3.focus === 'hub',
      { help: help.text.split('\n'), steps: [esc1.view, esc2.view, esc3.open] },
    );

    // × from a sub-screen closes it all; the next opening is the task screen again, the task unchanged.
    await page.tap('.cinema-hub__toggle');
    await page.tap('[data-action="hub-settings"]');
    await page.tap('[data-action="inspect-tools"]');
    await screenshot(page, 'settings-phone-4-advanced');
    await page.tap('[data-action="hub-close"]');
    const closed = await panelState(page);
    await page.tap('.cinema-hub__toggle');
    const reopened = await panelState(page);
    await page.tap('[data-action="hub-settings"]');
    await page.tap('[data-action="hub-about"]');
    await screenshot(page, 'settings-phone-5-about');
    await page.tap('[data-action="hub-close"]');
    const after = await roomState(page);
    check(
      'settings (phone): × on a sub-screen closes the whole panel; it opens again on the task screen with the same task; task, seats, camera, film and canvas never changed',
      !closed.open && reopened.view === 'task' && reopened.title === 'Điều khiển rạp' && JSON.stringify(after) === JSON.stringify(before),
      { reopened: reopened.view, before, after },
    );
    report.ui.settings.phone = { task: task.rows, settings: settings.rows, help: help.rows };
    await context.close();
  }

  // C. Low screens and large text: the panel stays on screen, its head (×) in view, the rest scrolls.
  for (const { name, options, zoom } of [
    { name: 'landscape-844x390', options: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'desktop-1280x600-text-200', options: { viewport: { width: 1280, height: 600 } }, zoom: true },
  ]) {
    const context = await browser.newContext(options);
    await context.addInitScript(() => localStorage.setItem('tp-cinema-hub-hint', 'seen'));
    const page = await context.newPage();
    attachConsole(page, `settings-${name}`);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    // Large text: the page's text size doubled (every size is in rem).
    if (zoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await openHubPanel(page);
    await hubView(page, 'settings');
    const settings = await panelState(page);
    const wrap = await page.evaluate(() => {
      const label = document.querySelector('#cinema-quality-heading').getBoundingClientRect();
      const group = document.querySelector('.cinema-hub__row--quality .cinema-segmented').getBoundingClientRect();
      return { below: group.top >= label.bottom - 1, inside: group.right <= document.querySelector('.cinema-hub__body').getBoundingClientRect().right + 0.5 };
    });
    const last = await page.evaluate(() => {
      const panel = document.querySelector('#cinema-hub-panel');
      const link = panel.querySelector('[data-action="hub-home"]');
      link.scrollIntoView({ block: 'nearest' });
      const p = panel.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      return l.top >= p.top - 0.5 && l.bottom <= p.bottom + 0.5;
    });
    const stillShown = (await panelState(page)).closeShown;
    await screenshot(page, `settings-${name}`);
    await hubView(page, 'advanced');
    const advanced = await panelState(page);
    report.ui.settings[name] = { box: settings.box, scrolls: settings.scrolls, wrap, last };
    check(
      `settings (${name}): Cài đặt fits the screen (× in view while the body scrolls to "Về trang chủ"), no sideways scroll${zoom ? '; with text at 200 % Chất lượng goes under its label and stays inside' : ''}; Công cụ nâng cao fits too`,
      settings.box.y >= -0.5 && settings.box.bottom <= settings.viewport.h + 0.5 && settings.closeShown && stillShown && last && settings.overflowX <= 1 &&
        (!zoom || (wrap.below && wrap.inside)) && advanced.box.bottom <= advanced.viewport.h + 0.5 && advanced.closeShown && advanced.overflowX <= 1,
      { settings: settings.box, scrolls: settings.scrolls, wrap, last, overflowX: settings.overflowX, advanced: advanced.box },
    );
    await context.close();
  }
}

// End-to-end flows (Prompt 08 §12): desktop and phone on video, no WebGL, reduced motion, and
// resources after many task and panel switches.
async function uiFlows(browser, base) {
  report.ui.flows = {};
  // A. Desktop: tour → stop by dragging → pick in 3D → map → select/deselect → view from seat → play → pause → back.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachConsole(page, 'flow-desktop');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    const steps = {};
    await recordVideo(browser, page, 'video-p08-flow-desktop', async () => {
      await page.waitForTimeout(500);
      await clickUi(page, 'button[data-action="tour"]');
      await page.waitForTimeout(4000);
      const box = await page.locator('.cinema-canvas').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      steps.tourStopped = !(await state(page)).touring;
      await waitForCameraToSettle(page);
      await selectPreset(page, 'overview');
      await openSeatPanel(page);
      await page.waitForTimeout(400);
      steps.picked3d = await clickFirstVisible(page, ['G05', 'H06', 'E08', 'G07']);
      await page.waitForTimeout(500);
      await page.click('button[data-seat="F06"]');
      await page.click('button[data-seat="F07"]');
      await page.waitForTimeout(300);
      await page.click('button[data-seat="F07"]');
      // F06 becomes the seat being looked at again (focus shows its details).
      await page.focus('button[data-seat="F06"]');
      await page.waitForTimeout(300);
      steps.selected = (await seatsState(page)).selected;
      await page.click('button[data-action="view-from-seat"]');
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
      await page.waitForTimeout(600);
      await reveal(page, PRIMARY);
      await page.waitForTimeout(300);
      await page.click(PRIMARY);
      await waitForFilm(page, ['playing']);
      await page.waitForTimeout(3000);
      await page.click(PRIMARY);
      steps.paused = (await waitForFilm(page, ['paused'])).snapshot.state;
      await page.waitForTimeout(500);
      await closeMenus(page);
      await page.click('button[data-action="return"]');
      await page.waitForFunction(() => window.__cinema.getState().view.state === 'preset', null, { timeout: 8000 });
      await page.waitForTimeout(800);
    });
    const end = await state(page);
    report.ui.flows.desktop = { ...steps, end: { preset: end.preset, selected: end.seats.selected } };
    check('flow A (desktop): tour stopped by a drag, seat picked in 3D, map select/deselect, view from F06, play, pause, back to the overview — selection intact', steps.tourStopped && steps.picked3d && steps.selected.includes('F06') && steps.selected.includes(steps.picked3d) && !steps.selected.includes('F07') && steps.paused === 'paused' && end.preset === 'overview' && JSON.stringify(end.seats.selected) === JSON.stringify(steps.selected), report.ui.flows.desktop);
    await screenshot(page, 'flow-a-desktop-end');
    await context.close();
  }
  // B. Phone portrait: explore → map → select → view from seat → play → rotate → pause → back to the map, selection kept.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    attachConsole(page, 'flow-mobile');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    const steps = {};
    await recordVideo(browser, page, 'video-p08-flow-mobile', async () => {
      await page.waitForTimeout(500);
      // Every control is in the control hub on a phone (Prompt 13): the view, the map, the film.
      await selectPreset(page, 'seats');
      await page.waitForTimeout(600);
      await openSeatPanel(page);
      await page.waitForTimeout(300);
      for (const id of ['E03', 'E04']) {
        await page.tap(`button[data-seat="${id}"]`);
        await page.waitForTimeout(300);
      }
      await page.tap('button[data-action="view-from-seat"]');
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
      steps.sheetAfterView = await page.evaluate(() => document.querySelector('#cinema-seat-panel').dataset.state);
      steps.share = (await canvasShare(page)).heightShare;
      await page.waitForTimeout(600);
      await tapUi(page, PRIMARY);
      await waitForFilm(page, ['playing']);
      await page.waitForTimeout(2000);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(800);
      steps.landscape = await canvasShare(page);
      steps.hubInside = await page.evaluate(() => {
        const r = document.querySelector('.cinema-hub__toggle').getBoundingClientRect();
        return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0;
      });
      steps.playingAfterRotate = (await film(page)).snapshot.state;
      await tapUi(page, PRIMARY);
      steps.paused = (await waitForFilm(page, ['paused'])).snapshot.state;
      await page.waitForTimeout(400);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await openSeatPanel(page);
      await page.waitForTimeout(800);
    });
    const end = await state(page);
    const pressed = await page.evaluate(() => [...document.querySelectorAll('button[data-seat][aria-pressed="true"]')].map((b) => b.dataset.seat));
    report.ui.flows.mobile = { ...steps, end: { selected: end.seats.selected, pressed } };
    check('flow B (phone): from the control hub — full-screen map → select → "Xem từ ghế này" clears it away → play → rotate (still playing, the room fills the screen, the hub stays in it) → pause → back to the map with the seats kept', steps.sheetAfterView === 'closed' && steps.share > 0.55 && steps.playingAfterRotate === 'playing' && steps.landscape.areaShare > 0.98 && steps.landscape.overflowX <= 0 && steps.hubInside && steps.paused === 'paused' && JSON.stringify(end.seats.selected) === '["E03","E04"]' && JSON.stringify(pressed) === '["E03","E04"]', report.ui.flows.mobile);
    await screenshot(page, 'flow-b-mobile-end');
    await context.close();
  }
  // E. No WebGL: map → seat → 2D player → pause; Khám phá says why it cannot work; never two players.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    const page = await context.newPage();
    attachConsole(page, 'webgl-disabled');
    await page.goto(`${base}cinema`);
    await waitForStatus(page, 10_000);
    const start = await page.evaluate(() => ({
      task: document.querySelector('.cinema-app').dataset.task,
      panel: document.querySelector('.cinema-app').dataset.panel,
      canvases: document.querySelectorAll('canvas').length,
      statusShown: document.querySelector('.cinema-status').getClientRects().length > 0,
    }));
    // On a phone the map stays one press away in the hub, so the reason and the 2D film stay in sight.
    await openSeatPanel(page);
    await screenshot(page, 'flow-e-no-webgl-seats');
    await page.tap('button[data-seat="D04"]');
    await closeSeatPanel(page);
    await tapUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1200);
    const flat = await page.evaluate(() => {
      const stage = document.querySelector('.cinema-stage').getBoundingClientRect();
      const video = document.querySelector('.cinema-video2d video').getBoundingClientRect();
      const status = document.querySelector('.cinema-status').getBoundingClientRect();
      return { videos: document.querySelectorAll('video').length, videoShare: Number(((video.width * video.height) / (stage.width * stage.height)).toFixed(2)), statusShare: Number(((status.width * status.height) / (stage.width * stage.height)).toFixed(2)) };
    });
    await screenshot(page, 'flow-e-no-webgl-2d-player');
    await tapUi(page, PRIMARY);
    const paused = (await waitForFilm(page, ['paused'])).snapshot.state;
    // Khám phá's note is in the hub, with its disabled view controls.
    await reveal(page, '[data-dock="explore"] .cinema-dock__note');
    const reason = await page.textContent('[data-dock="explore"] .cinema-dock__note');
    await screenshot(page, 'flow-e-no-webgl-explore');
    await closeMenus(page);
    report.ui.flows.noWebgl = { start, flat, paused, reason };
    check('flow E (no WebGL, phone): starts in Chọn ghế with the reason on screen and the map one press away in the hub, seat picked, the one film element plays flat and pauses; the error is a line, not a big box; Khám phá says why', start.task === 'seats' && start.panel === 'closed' && start.statusShown && start.canvases === 0 && (await seatsState(page)).selected.includes('D04') && flat.videos === 1 && flat.videoShare > 0.5 && flat.statusShare < 0.3 && paused === 'paused' && /Không có cảnh 3D/.test(reason), report.ui.flows.noWebgl);
    await context.close();
  }
  // F. Reduced motion: the tour steps; preset changes and panels never animate.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    attachConsole(page, 'flow-reduced-motion');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await clickUi(page, 'button[data-action="tour"]');
    const tour = (await state(page)).view.tour;
    await page.click('button[data-action="tour-next"]');
    await nextFrames(page);
    const stepped = (await state(page)).view;
    await page.click('button[data-action="tour-stop"]');
    await selectPreset(page, 'seats');
    const instant = (await state(page)).view.transitioning;
    await openSeatPanel(page);
    const panelMotion = await page.evaluate(() => {
      const panel = document.querySelector('#cinema-seat-panel');
      const s = getComputedStyle(panel);
      const toggle = document.querySelector('.cinema-switch__track');
      return { transition: s.transitionDuration, animation: s.animationName, switchTransition: getComputedStyle(toggle).transitionDuration };
    });
    check('flow F (reduced motion): the tour shows stops one by one, views change without flying, panels and switches do not animate', tour?.steps && stepped.tour?.stopIndex === 1 && !stepped.transitioning && !instant && panelMotion.animation === 'none' && ['0s', ''].includes(panelMotion.transition) && panelMotion.switchTransition === '0s', { tour, panelMotion });
    await context.close();
  }
  // D. Many panel switches (control panel, seat map): one canvas, one film element, steady objects,
  // listeners and renderer resources; nothing renders once things settle with the film paused.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    attachConsole(page, 'flow-switching');
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    await page.waitForFunction(() => window.__cinema.film().snapshot.state === 'ready');
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    const types = ['MediaController', 'HTMLVideoElement', 'Texture', 'Material', 'BufferGeometry', 'Object3D'];
    const cycle = async () => {
      for (let i = 0; i < 2; i++) {
        await openSeatPanel(page);
        await closeSeatPanel(page);
      }
      await openHubPanel(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#cinema-hub-panel', { state: 'hidden' });
    };
    await cycle();
    await page.waitForTimeout(600);
    const first = await liveCounts(cdp, types);
    const firstMemory = (await state(page)).view.memory;
    const element = await page.evaluate(() => (window.__probeElement = window.__cinema.filmElement()) && true);
    for (let i = 0; i < 15; i++) await cycle();
    await page.waitForTimeout(500);
    const r0 = (await state(page)).view.framesRendered;
    await page.waitForTimeout(1500);
    const r1 = (await state(page)).view.framesRendered;
    const same = await page.evaluate(() => {
      const ok = window.__probeElement === window.__cinema.filmElement();
      delete window.__probeElement;
      return ok;
    });
    const last = await liveCounts(cdp, types);
    const lastMemory = (await state(page)).view.memory;
    const extra = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, listeners: window.__cinema.getState().seats.listeners, subscribers: window.__cinema.film().subscribers }));
    report.ui.flows.switching = { first, last, firstMemory, lastMemory, idleRenders: r1 - r0, ...extra };
    check('flow D: 64 task switches and 32 panel/menu toggles — one canvas, the same film element, no renders once settled (film paused)', element && same && extra.canvases === 1 && r1 - r0 === 0 && last.objects.HTMLVideoElement === 1 && last.objects.MediaController === 1, report.ui.flows.switching);
    check('flow D: …live three.js objects, page listeners and renderer resources unchanged (heap +< 1 MiB)', JSON.stringify(first.objects) === JSON.stringify(last.objects) && JSON.stringify(first.listeners) === JSON.stringify(last.listeners) && JSON.stringify(firstMemory) === JSON.stringify(lastMemory) && last.heapMiB - first.heapMiB < 1, {
      objects: [first.objects, last.objects],
      listeners: [first.listeners, last.listeners],
      heap: [first.heapMiB, last.heapMiB],
    });
    await context.close();
  }
}

// Zoom 200 %: a 1440 × 900 and a 1280 × 720 window at 200 % are 720 × 450 and 640 × 360 CSS px
// at a device pixel ratio of 2 (what the browser lays out).
async function uiZoom(browser, base) {
  report.ui.zoom = {};
  for (const [name, viewport] of [
    ['1440x900', { width: 720, height: 450 }],
    ['1280x720', { width: 640, height: 360 }],
  ]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    attachConsole(page, `zoom-${name}`);
    await page.goto(`${base}cinema`);
    await waitForStatus(page);
    const shares = {};
    shares.explore = await canvasShare(page);
    await screenshot(page, `zoom200-${name}-1-explore`);
    await openSeatPanel(page);
    await page.click('button[data-seat="F05"]');
    shares.seats = await canvasShare(page);
    const reach = await page.evaluate(() => {
      const r = document.querySelector('button[data-action="view-from-seat"]').getBoundingClientRect();
      return r.bottom <= innerHeight && r.right <= innerWidth && r.height > 0;
    });
    await screenshot(page, `zoom200-${name}-2-seats`);
    // At this size the page uses the phone layout (Prompt 13): the map is full screen; back to the room.
    const immersive = await isImmersive(page);
    if (immersive) await closeSeatPanel(page);
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    shares.watch = await canvasShare(page);
    await screenshot(page, `zoom200-${name}-3-watch`);
    await clickUi(page, PRIMARY);
    // Cài đặt › Công cụ nâng cao (through the round button's panel at this size).
    await reveal(page, 'button[data-action="inspect-tools"]');
    await page.click('button[data-action="inspect-tools"]');
    const menu = await page.evaluate(() => {
      const panel = document.querySelector('.cinema-hub__panel');
      const r = panel.getBoundingClientRect();
      return { inside: r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && r.x >= -0.5, scrolls: panel.scrollHeight > panel.clientHeight };
    });
    await screenshot(page, `zoom200-${name}-4-settings`);
    report.ui.zoom[name] = { immersive, shares, menu };
    check(`zoom 200 % (${name}): every task usable — no overflow, the view keeps ≥ 45 % of the height, seat actions and the settings (the control hub at this size) stay on screen`, Object.values(shares).every((s) => s.overflowX <= 0 && s.overflowY <= 0) && shares.explore.heightShare >= 0.45 && shares.watch.heightShare >= 0.45 && reach && menu.inside, report.ui.zoom[name]);
    await context.close();
  }
}

/** Prompt 07 (baseline, before) next to Prompt 08 (after): same viewport, comparable state. */
async function uiComparisons(browser) {
  const baselineDir = path.join(outDir, 'baseline', 'ui');
  if (!existsSync(baselineDir)) return;
  const context = await browser.newContext({ viewport: { width: 1460, height: 520 } });
  const page = await context.newPage();
  for (const { name } of UI_VIEWPORTS) {
    for (const [before, after, label] of [
      ['b-map-closed', '1-explore', 'explore'],
      ['c-map-open', '3-seats-open', 'map-open'],
      ['e-watching', '5-watch', 'watching'],
    ]) {
      const a = path.join(baselineDir, `${name}-${before}.png`);
      const b = path.join(outDir, `ui-${name}-${after}.png`);
      if (!existsSync(a) || !existsSync(b)) continue;
      const images = await Promise.all([a, b].map(async (file) => (await readFile(file)).toString('base64')));
      await page.setContent(
        `<body style="margin:0;background:#0f1013;color:#e9eaee;font:14px system-ui;display:flex;gap:20px">${images
          .map((data, i) => `<figure style="margin:0;max-width:720px"><img style="max-width:720px;max-height:900px;display:block" src="data:image/png;base64,${data}"><figcaption style="padding:6px 8px">${i === 0 ? 'Prompt 07 (trước)' : 'Prompt 08 (sau)'} · ${name} · ${label}</figcaption></figure>`)
          .join('')}</body>`,
      );
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, `compare-p07-p08-${name}-${label}`, { fullPage: true });
    }
  }
  await context.close();
}

// ---------------------------------------------------------------- Prompt 09: landing page and the way in

const LANDING_VIEWPORTS = [
  { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'laptop-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: 'tablet-portrait-820x1180', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'tablet-landscape-1180x820', viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-narrow-360x640', viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: 'mobile-landscape-844x390', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  // Zoom 200 % of the two desktop windows: what the browser lays out.
  { name: 'zoom200-1440x900', viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 },
  { name: 'zoom200-1280x720', viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 },
];

/** Counts WebGL contexts, animation frames, video elements and media requests from the first script on. */
const LANDING_PROBE = () => {
  window.__probe = { webgl: 0, frames: 0, videos: 0 };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (/webgl/.test(type)) window.__probe.webgl++;
    return getContext.call(this, type, ...args);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf((t) => {
    window.__probe.frames++;
    callback(t);
  });
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...args) {
    if (String(tag).toLowerCase() === 'video') window.__probe.videos++;
    return create.call(this, tag, ...args);
  };
};

const probe = (page) => page.evaluate(() => ({ ...window.__probe }));
const landingState = (page) =>
  page.evaluate(() => ({
    path: location.pathname + location.search,
    route: document.documentElement.dataset.route,
    title: document.title,
    canvases: document.querySelectorAll('canvas').length,
    cinema: document.querySelector('.cinema-app')?.dataset.status ?? null,
    landing: Boolean(document.querySelector('[data-landing]')),
    history: history.length,
    focus: document.activeElement === document.body ? 'body' : `${document.activeElement?.tagName.toLowerCase()}${document.activeElement?.id ? `#${document.activeElement.id}` : ''}${document.activeElement?.classList.contains('cinema-title') ? '.cinema-title' : ''}`,
  }));
const waitForCinema = (page, timeout = 30_000) => page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout });
const waitForLanding = (page) => page.waitForFunction(() => document.documentElement.dataset.route === 'landing' && Boolean(document.querySelector('[data-landing] .hero')), null, { timeout: 10_000 });

// Every size: the hero's words and the way in on the first screen, nothing overflowing, words clear
// of the screen in the picture, a short header, the right picture (16:9 or portrait).
async function landingLayouts(browser, base) {
  report.landing ??= {};
  report.landing.layouts = {};
  for (const { name, ...options } of LANDING_VIEWPORTS) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    attachConsole(page, `landing-${name}`);
    await page.goto(base);
    await waitForLanding(page);
    await page.waitForFunction(() => document.querySelector('.hero__image')?.complete && document.querySelector('.hero__image').naturalWidth > 0);
    await page.waitForTimeout(900);
    const layout = await page.evaluate(() => {
      const rect = (s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) } : null;
      };
      const image = document.querySelector('.hero__image');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        overflowX: document.documentElement.scrollWidth - innerWidth,
        header: rect('.site-header'),
        cta: rect('.hero a[data-cta]'),
        headerCta: rect('.site-header a[data-cta]'),
        title: rect('.hero h1'),
        content: rect('.hero__content'),
        media: rect('.hero__media'),
        picture: image.currentSrc.replace(location.origin, ''),
        // Where the words' lines actually end (not their boxes), and where the screen is drawn: the
        // render is drawn with object-fit: cover at the image's object-position; in both renders the
        // screen spans these fractions of the picture.
        text: (() => {
          let right = 0;
          let top = Infinity;
          for (const s of ['.hero h1', '.hero__lead', '.hero .eyebrow']) {
            const range = document.createRange();
            range.selectNodeContents(document.querySelector(s));
            for (const r of range.getClientRects()) {
              right = Math.max(right, r.right);
              top = Math.min(top, r.top);
            }
          }
          return { right: Math.round(right), top: Math.round(top) };
        })(),
        screenInPicture: (() => {
          const box = image.getBoundingClientRect();
          const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
          const w = image.naturalWidth * scale;
          const h = image.naturalHeight * scale;
          const [px, py] = getComputedStyle(image).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
          const x = box.x + (box.width - w) * px;
          const y = box.y + (box.height - h) * py;
          const portraitRender = image.naturalHeight > image.naturalWidth;
          const frac = portraitRender ? { left: 0.2, right: 0.9, top: 0.26, bottom: 0.54 } : { left: 0.47, right: 0.83, top: 0.2, bottom: 0.57 };
          return { left: Math.round(x + frac.left * w), right: Math.round(x + frac.right * w), top: Math.round(y + frac.top * h), bottom: Math.round(y + frac.bottom * h) };
        })(),
        h1Size: getComputedStyle(document.querySelector('.hero h1')).fontSize,
        smallTargets: [...document.querySelectorAll('.landing a, .landing button')]
          .filter((e) => e.getClientRects().length > 0 && !e.classList.contains('skip-link') && !e.closest('.site-footer') && !e.closest('.section__lead'))
          .map((e) => ({ text: e.textContent.trim().slice(0, 24), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))
          .filter((t) => t.h < 43.5),
        headings: [...document.querySelectorAll('.landing h1, .landing h2, .landing h3')].map((h) => h.tagName),
      };
    });
    const portrait = layout.viewport.width / layout.viewport.height <= 0.8;
    // Landscape layouts keep the words in the left part; the screen in the picture is right of centre.
    // The words never cover the screen in the picture: beside it on wide layouts, under it in portrait.
    const s = layout.screenInPicture;
    const clear = portrait ? layout.text.top >= s.bottom : layout.text.right <= s.left;
    report.landing.layouts[name] = layout;
    check(`landing ${name}: "Bước vào rạp" on the first screen, no horizontal overflow, header ≤ 80 px`, layout.cta.bottom <= layout.viewport.height && layout.overflowX <= 0 && layout.header.height <= 80, { cta: layout.cta, header: layout.header.height, overflowX: layout.overflowX });
    check(`landing ${name}: the words stay clear of the screen in the picture; the ${portrait ? 'portrait' : '16:9'} render is used`, clear && (portrait ? /hero-portrait/.test(layout.picture) : /\/hero-\d+/.test(layout.picture)), { text: layout.text, screen: layout.screenInPicture, picture: layout.picture });
    check(`landing ${name}: main links and buttons are at least 44 px tall; headings h1 → h2 → h3`, layout.smallTargets.length === 0 && layout.headings[0] === 'H1' && layout.headings.filter((h) => h === 'H1').length === 1, { small: layout.smallTargets, headings: layout.headings.join(' ') });
    await screenshot(page, `landing-${name}-1-top`);
    if (!name.startsWith('zoom')) await screenshot(page, `landing-${name}-2-page`, { fullPage: true });
    await context.close();
  }
  // The pictures on their own (desktop render and portrait render).
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    for (const [file, src] of [
      ['landing-hero-render-16x9', '/brand/hero-1920.webp'],
      ['landing-hero-render-portrait', '/brand/hero-portrait-1080.webp'],
      ['landing-share-card', '/brand/share-1200.jpg'],
    ]) {
      await page.setContent(`<body style="margin:0;background:#14110f"><img src="${base.replace(/\/$/, '')}${src}" style="display:block;max-width:1200px;max-height:900px"></body>`);
      await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
      await screenshot(page, file, { fullPage: true });
    }
    await context.close();
  }
}

// What the landing page costs before anyone asks for more, and what intent fetches (development
// server: modules arrive one by one; byte counts are in measure-build.mjs on the production build).
async function landingNetwork(browser, base) {
  report.landing ??= {};
  report.landing.network = {};
  const run = async (label, { saveData = false, hover = false } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(LANDING_PROBE);
    if (saveData) await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
    const page = await context.newPage();
    attachConsole(page, `landing-network-${label}`);
    const requests = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.goto(base);
    await waitForLanding(page);
    await page.waitForTimeout(1500);
    const idle = await probe(page);
    await page.waitForTimeout(2000);
    const idleAfter = await probe(page);
    const before = [...requests];
    if (hover) {
      await page.hover('.hero a[data-cta]');
      await page.waitForTimeout(2500);
    }
    const after = [...requests];
    const result = {
      before: { cinemaCode: before.filter((p) => p.startsWith('/src/cinema/')).length, three: before.filter((p) => /three/.test(p)).length, media: before.filter((p) => p.startsWith('/media/')).length, brand: before.filter((p) => p.startsWith('/brand/')) },
      idle: { framesIn2s: idleAfter.frames - idle.frames, webgl: idleAfter.webgl, videos: idleAfter.videos },
      after: { page: after.includes('/src/cinema/page.ts'), view: after.includes('/src/cinema/view.ts'), three: after.some((p) => /three/.test(p)), media: after.filter((p) => p.startsWith('/media/')).length, canvases: await page.evaluate(() => document.querySelectorAll('canvas').length), webgl: (await probe(page)).webgl, videos: (await probe(page)).videos },
    };
    report.landing.network[label] = result;
    await context.close();
    return result;
  };
  const cold = await run('opened');
  // The step pictures are loading="lazy"; Chrome still fetches lazy images within a distance of the
  // viewport, so they may come early. The film and the auditorium's code never do. The logo is one
  // small file (the size for this screen's pixel ratio), not a render.
  check('landing network: opening / fetches no auditorium code, no three.js, no film; pictures: one hero render, plus lazy step pictures and one logo size', cold.before.cinemaCode === 0 && cold.before.three === 0 && cold.before.media === 0 && cold.before.brand.filter((p) => /hero/.test(p)).length === 1 && cold.before.brand.filter((p) => /\/logo-/.test(p)).length === 1 && cold.before.brand.every((p) => /hero|step-|\/logo-\d+\.webp$/.test(p)), cold.before);
  check('landing idle: no WebGL context, no video element, no animation frames once the entrance animation is over', cold.idle.webgl === 0 && cold.idle.videos === 0 && cold.idle.framesIn2s === 0, cold.idle);
  const hover = await run('hover', { hover: true });
  check('landing intent: hovering "Bước vào rạp" fetches the auditorium code (page and 3D part) but builds nothing — no canvas, no WebGL, no video, no film request', hover.after.page && hover.after.view && hover.after.three && hover.after.canvases === 0 && hover.after.webgl === 0 && hover.after.videos === 0 && hover.after.media === 0, hover.after);
  const saving = await run('save-data', { saveData: true, hover: true });
  check('landing intent with Save-Data: hovering fetches nothing', !saving.after.page && !saving.after.view && !saving.after.three, saving.after);
}

// The way in and out: clicks, keys, history, new tabs, slow or failing downloads, going back too
// early, many visits, leaving while the film plays, no WebGL, reduced motion, the hero's motion.
async function landingFlows(browser, base) {
  report.landing ??= {};
  report.landing.flows = {};
  const open = async (label, options = {}, init = null) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...options });
    await context.addInitScript(LANDING_PROBE);
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    attachConsole(page, label);
    return { context, page };
  };

  // Click, history, refresh.
  {
    const { context, page } = await open('landing-click');
    await page.goto(base);
    await waitForLanding(page);
    const start = await landingState(page);
    await page.click('.hero a[data-cta]');
    const right = await landingState(page);
    const clickedAt = Date.now();
    await waitForCinema(page);
    const readyMs = Date.now() - clickedAt;
    const inside = await landingState(page);
    check('way in: one click → /cinema at once (opening screen right away, one history entry), the room ready, focus on the page heading', right.path === '/cinema' && right.route === 'cinema' && inside.cinema === 'ready' && inside.canvases === 1 && inside.history === start.history + 1 && inside.focus === 'h1.cinema-title' && inside.title.includes('Phòng chiếu 3D'), { start, right, inside, readyMs });
    report.landing.flows.clickToReadyMs = readyMs;
    await page.click('a[data-action="home"]');
    await waitForLanding(page);
    const home = await landingState(page);
    check('way out: the brand link in the auditorium leads home (no canvas left, focus on the main content, one more history entry)', home.path === '/' && home.canvases === 0 && home.focus === 'main#noi-dung' && home.history === inside.history + 1 && home.title.startsWith('Tân Phong Cinema'), home);
    await page.goBack();
    await waitForCinema(page);
    const back = await landingState(page);
    await page.goBack();
    await waitForLanding(page);
    const back2 = await landingState(page);
    await page.goForward();
    await waitForCinema(page);
    const forward = await landingState(page);
    check('history: Back and Forward move between the landing page and the auditorium, one canvas at most', back.path === '/cinema' && back.canvases === 1 && back2.path === '/' && back2.canvases === 0 && forward.path === '/cinema' && forward.canvases === 1, { back, back2, forward });
    await page.reload();
    await waitForCinema(page);
    const reloadCinema = await landingState(page);
    await page.goto(base);
    await waitForLanding(page);
    await page.reload();
    await waitForLanding(page);
    const reloadLanding = await landingState(page);
    check('refresh: /cinema stays in the auditorium, / stays on the landing page', reloadCinema.path === '/cinema' && reloadCinema.cinema === 'ready' && reloadLanding.path === '/' && reloadLanding.landing, { reloadCinema, reloadLanding });
    // In-page links do not re-render the page.
    await page.evaluate(() => (window.__landingMarker = document.querySelector('[data-landing]')));
    await page.click('.hero a[href="#cach-su-dung"]');
    await page.waitForTimeout(900);
    // The navigation floats over the page (Prompt 15): the guide lands just below it, not under it.
    const anchored = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.querySelector('#cach-su-dung').getBoundingClientRect().top), header: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom), same: window.__landingMarker === document.querySelector('[data-landing]') }));
    await page.goBack();
    await page.waitForTimeout(600);
    const anchorBack = await page.evaluate(() => ({ hash: location.hash, same: window.__landingMarker === document.querySelector('[data-landing]') }));
    check('in-page links: "Cách trải nghiệm" scrolls to the guide; Back returns without rebuilding the page', anchored.hash === '#cach-su-dung' && anchored.top >= anchored.header && anchored.top < anchored.header + 40 && anchored.same && anchorBack.hash === '' && anchorBack.same, { anchored, anchorBack });
    await context.close();
  }

  // Several fast clicks, then a new tab with Ctrl+click and a middle click.
  {
    const { context, page } = await open('landing-multi-click');
    await page.goto(base);
    await waitForLanding(page);
    const start = await landingState(page);
    await page.evaluate(() => {
      const link = document.querySelector('.hero a[data-cta]');
      for (let i = 0; i < 4; i++) link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitForCinema(page);
    await page.waitForTimeout(800);
    const after = await landingState(page);
    check('many clicks on "Bước vào rạp": one navigation, one history entry, one canvas', after.history === start.history + 1 && after.canvases === 1, { start: start.history, after });
    await page.goto(base);
    await waitForLanding(page);
    const [tab] = await Promise.all([context.waitForEvent('page'), page.click('.hero a[data-cta]', { modifiers: ['Control'] })]);
    await tab.waitForLoadState();
    await waitForCinema(tab);
    const original = await landingState(page);
    const [tab2] = await Promise.all([context.waitForEvent('page'), page.click('.site-header a[data-cta]', { button: 'middle' })]);
    await tab2.waitForLoadState();
    check('new tab: Ctrl+click and middle click open /cinema in a new tab (its own document, ready); this tab stays on the landing page', new URL(tab.url()).pathname === '/cinema' && new URL(tab2.url()).pathname === '/cinema' && original.path === '/' && original.landing && original.canvases === 0, { tab: tab.url(), tab2: tab2.url(), original });
    await context.close();
  }

  // Keyboard: skip link, into the room and back, focus visible.
  {
    const { context, page } = await open('landing-keyboard');
    await page.goto(base);
    await waitForLanding(page);
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => ({ text: document.activeElement?.textContent, visible: document.activeElement?.getBoundingClientRect().top >= 0 }));
    await screenshot(page, 'landing-focus-1-skip-link');
    await page.keyboard.press('Enter');
    const skipped = await landingState(page);
    const order = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.textContent.trim().slice(0, 24) || document.activeElement?.getAttribute('aria-label')));
    }
    await page.focus('.hero a[data-cta]');
    await screenshot(page, 'landing-focus-2-cta');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    await page.keyboard.press('Enter');
    await waitForCinema(page);
    const inside = await landingState(page);
    await page.keyboard.press('Tab');
    const firstInside = await page.evaluate(() => document.activeElement?.dataset.action ?? document.activeElement?.tagName);
    await page.keyboard.press('Enter');
    await waitForLanding(page);
    const back = await landingState(page);
    check('keyboard: Tab reaches "Bỏ qua, tới nội dung chính" first; Enter jumps to the content; the hero links come next; Enter on "Bước vào rạp" enters; the brand link is the first stop inside and Enter leads home', /Bỏ qua/.test(skip.text) && skip.visible && skipped.focus === 'main#noi-dung' && order.includes('Bước vào rạp') && outline !== 'none' && inside.cinema === 'ready' && firstInside === 'home' && back.path === '/' && back.focus === 'main#noi-dung', { skip, order, inside: inside.focus, firstInside, back: back.focus });
    await context.close();
  }

  // Slow code, failing code and retry, going back before the code arrives.
  {
    const { context, page } = await open('landing-slow');
    let delay = 2500;
    await context.route(/\/src\/cinema\/page\.ts/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      await route.continue();
    });
    await page.goto(base);
    await waitForLanding(page);
    await page.click('.hero a[data-cta]');
    await page.waitForTimeout(400);
    const opening = await page.evaluate(() => ({ text: document.querySelector('.route-status')?.textContent ?? '', home: Boolean(document.querySelector('.route-status a[href="/"]')), role: document.querySelector('.route-status [role]')?.getAttribute('role'), skeleton: Boolean(document.querySelector('.route-status .page-skeleton .room-skeleton__screen [role="status"]')) }));
    await screenshot(page, 'landing-way-in-1-opening');
    await waitForCinema(page);
    check('slow network: the opening screen is a skeleton of the room that says what is happening at once ("Đang mở phòng chiếu…", a way home, on its screen), then the room', /Đang mở phòng chiếu/.test(opening.text) && opening.home && opening.role === 'status' && opening.skeleton, opening);
    await context.close();
  }
  {
    const { context, page } = await open('landing-code-fails');
    let failures = 0;
    await context.route(/\/src\/cinema\/page\.ts/, async (route) => {
      if (failures++ === 0) await route.abort('connectionreset');
      else await route.continue();
    });
    await page.goto(base);
    await waitForLanding(page);
    await page.click('.hero a[data-cta]');
    await page.waitForSelector('button[data-action="retry-page"]', { timeout: 10_000 });
    const error = await page.evaluate(() => ({ text: document.querySelector('.route-status')?.textContent ?? '', skeleton: Boolean(document.querySelector('.route-status .skeleton')), focus: document.activeElement?.tagName }));
    await screenshot(page, 'landing-way-in-2-failed');
    await page.click('button[data-action="retry-page"]');
    await waitForCinema(page);
    const after = await landingState(page);
    check('code fails to download: an error (no skeleton) with "Thử lại" and "Về trang chủ"; "Thử lại" fetches it again and the room opens', /Không mở được phòng chiếu/.test(error.text) && !error.skeleton && error.focus === 'H1' && after.cinema === 'ready' && after.canvases === 1, { error, after });
    await context.close();
  }
  {
    const { context, page } = await open('landing-back-early');
    await context.route(/\/src\/cinema\/page\.ts/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    await page.goto(base);
    await waitForLanding(page);
    await page.click('.hero a[data-cta]');
    await page.waitForTimeout(300);
    await page.goBack();
    await waitForLanding(page);
    await page.waitForTimeout(3800);
    const stayed = await landingState(page);
    const probeEarly = await probe(page);
    await page.click('.hero a[data-cta]');
    await waitForCinema(page);
    const after = await landingState(page);
    check('Back before the code arrives: the landing page stays (the late code mounts nothing, no WebGL), "Bước vào rạp" again opens one room', stayed.path === '/' && stayed.landing && stayed.canvases === 0 && !stayed.cinema && probeEarly.webgl === 0 && after.cinema === 'ready' && after.canvases === 1, { stayed, probeEarly, after });
    await context.close();
  }

  // Many visits; the seat choice and the quality survive; leaving while the film plays.
  {
    const { context, page } = await open('landing-cycles');
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await page.goto(`${base}cinema`);
    await waitForCinema(page);
    await openSeatPanel(page);
    await page.click('button[data-seat="F05"]');
    await setQuality(page, 'economy');
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1500);
    const playingAt = (await film(page)).snapshot.currentTime;
    // Leave while it plays.
    await page.click('a[data-action="home"]');
    await waitForLanding(page);
    await page.waitForTimeout(400);
    const counts = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      const objects = {};
      for (const [name, expression] of [
        ['HTMLVideoElement', 'HTMLVideoElement.prototype'],
        ['HTMLCanvasElement', 'HTMLCanvasElement.prototype'],
        ['WebGL2RenderingContext', 'WebGL2RenderingContext.prototype'],
      ]) {
        const { result: proto } = await cdp.send('Runtime.evaluate', { expression });
        const { objects: list } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
        const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: list.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
        objects[name] = result.value;
        await cdp.send('Runtime.releaseObject', { objectId: list.objectId });
      }
      const listeners = {};
      for (const target of ['window', 'document']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression: target });
        listeners[target] = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
      }
      const heap = await cdp.send('Runtime.getHeapUsage');
      return { objects, listeners, heapMiB: Number((heap.usedSize / 2 ** 20).toFixed(2)) };
    };
    const left = await counts();
    const sound = await page.evaluate(() => [...document.querySelectorAll('video, audio')].filter((m) => !m.paused).length);
    check('leaving while the film plays: back on the landing page no video element is alive (after GC), nothing plays, no canvas', left.objects.HTMLVideoElement === 0 && sound === 0 && (await landingState(page)).canvases === 0, left);
    const cycles = [];
    for (let i = 0; i < 6; i++) {
      await page.click('.hero a[data-cta]');
      await waitForCinema(page);
      await page.waitForTimeout(300);
      await page.click('a[data-action="home"]');
      await waitForLanding(page);
      if (i === 0 || i === 5) cycles.push(await counts());
    }
    await page.click('.hero a[data-cta]');
    await waitForCinema(page);
    await page.waitForFunction(() => window.__cinema?.film().snapshot.hasFrame, null, { timeout: 10_000 });
    const back = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      selected: window.__cinema.getState().seats.selected,
      quality: window.__cinema.getState().view.quality,
      preset: window.__cinema.getState().preset,
      touring: window.__cinema.getState().touring,
      film: { state: window.__cinema.film().snapshot.state, time: window.__cinema.film().snapshot.currentTime, paused: window.__cinema.film().paused },
    }));
    report.landing.flows.cycles = { left, first: cycles[0], last: cycles[1], back, playingAt };
    check('6 more visits: on the landing page each time 0 canvases, 0 video elements and 0 WebGL contexts alive after GC; page listeners and heap steady', cycles.every((c) => c.objects.HTMLVideoElement === 0 && c.objects.HTMLCanvasElement === 0) && JSON.stringify(cycles[0].listeners) === JSON.stringify(cycles[1].listeners) && cycles[1].heapMiB - cycles[0].heapMiB < 1, report.landing.flows.cycles);
    check('coming back: one canvas; the chosen seat and Tiết kiệm kept; the film paused where it was left, not playing; camera at Tổng quan, no tour', back.canvases === 1 && back.selected.includes('F05') && back.quality === 'economy' && back.film.paused && back.film.state === 'paused' && Math.abs(back.film.time - playingAt) < 1.5 && back.preset === 'overview' && !back.touring, back);
    await context.close();
  }

  // No WebGL: the landing page, then the auditorium's flat fallback.
  {
    const { context, page } = await open('webgl-disabled', {}, () => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : original.call(this, type, ...args);
      };
    });
    await page.goto(base);
    await waitForLanding(page);
    await page.click('.hero a[data-cta]');
    await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'error', null, { timeout: 15_000 });
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['playing']);
    await page.waitForTimeout(1000);
    await clickUi(page, PRIMARY);
    await waitForFilm(page, ['paused']);
    const flat = await page.evaluate(() => ({ videos: document.querySelectorAll('video').length, video2d: Boolean(document.querySelector('.cinema-video2d video')), state: window.__cinema.film().snapshot.state }));
    await screenshot(page, 'landing-way-in-3-no-webgl');
    check('no WebGL: landing page → "Bước vào rạp" → the 2D film plays and pauses (one element)', flat.videos === 1 && flat.video2d && flat.state === 'paused', flat);
    await context.close();
  }

  // Reduced motion: nothing moves, everything is there at once.
  {
    const { context, page } = await open('landing-reduced-motion', { reducedMotion: 'reduce' });
    await page.goto(base);
    await waitForLanding(page);
    const motion = await page.evaluate(() => ({
      flag: document.querySelector('.hero').dataset.motion,
      animations: document.getAnimations().length,
      opacity: getComputedStyle(document.querySelector('.hero h1')).opacity,
    }));
    await page.mouse.move(200, 200);
    await page.mouse.move(900, 500, { steps: 8 });
    await page.waitForTimeout(400);
    const transform = await page.evaluate(() => document.querySelector('.hero__media').style.transform);
    await screenshot(page, 'landing-reduced-motion');
    check('reduced motion: no entrance animation, no parallax (the picture stays put under the mouse), words at full opacity at once', motion.flag === 'off' && motion.animations === 0 && motion.opacity === '1' && transform === '', { motion, transform });
    await context.close();
  }

  // The hero's depth with a mouse: it follows a little, then stops asking for frames; off when out of view.
  {
    const { context, page } = await open('landing-motion');
    await page.goto(base);
    await waitForLanding(page);
    await page.waitForTimeout(1800);
    await page.mouse.move(300, 300);
    await page.mouse.move(1100, 600, { steps: 10 });
    await page.waitForTimeout(1500);
    const moved = await page.evaluate(() => document.querySelector('.hero__media').style.transform);
    const f0 = (await probe(page)).frames;
    await page.waitForTimeout(1000);
    const f1 = (await probe(page)).frames;
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#cach-su-dung').offsetTop));
    await page.waitForTimeout(800);
    const f2 = (await probe(page)).frames;
    await page.mouse.move(200, 200, { steps: 10 });
    await page.waitForTimeout(800);
    const f3 = (await probe(page)).frames;
    const shift = (moved.match(/-?[\d.]+/g) ?? []).map(Number);
    check('hero depth: the picture drifts a few px with the mouse (≤ 10 px), then no more frames; out of view, mouse moves cost no frames', shift.length >= 2 && Math.abs(shift[0]) > 1 && Math.abs(shift[0]) <= 10.5 && f1 === f0 && f3 === f2, { moved, frames: [f0, f1, f2, f3] });
    await context.close();
  }

  // The way in and out on video.
  {
    const { context, page } = await open('landing-video', { viewport: { width: 1280, height: 720 } });
    await page.goto(base);
    await waitForLanding(page);
    await page.waitForTimeout(1200);
    await recordVideo(browser, page, 'video-landing-cinema-landing', async () => {
      await page.mouse.move(400, 300);
      await page.mouse.move(900, 450, { steps: 12 });
      await page.waitForTimeout(600);
      await page.hover('.hero a[data-cta]');
      await page.waitForTimeout(500);
      await page.click('.hero a[data-cta]');
      await waitForCinema(page);
      await page.waitForTimeout(1500);
      await page.click('a[data-action="home"]');
      await waitForLanding(page);
      await page.waitForTimeout(1500);
    });
    await context.close();
  }
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
