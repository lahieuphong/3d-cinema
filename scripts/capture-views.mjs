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
// limits, seat views, occlusion, lifecycle across context restores) and a simulated WebGL failure,
// then writes screenshots, videos and report.json to artifacts/<CAPTURE_DIR or prompt-06>/.
// When <output folder>/baseline/ exists (a run of the previous code with CAPTURE_DIR=prompt-NN/baseline),
// its renderer figures are copied into the report and its screenshots are paired with the new ones
// from the same cameras in compare-*.png.
//
//   npm run capture                       # uses the first browser found
//   BROWSER_PATH=/path/to/chrome npm run capture
//
// Exits non-zero if any check fails.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, normalizePath } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-06');

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

async function openInspectTools(page) {
  if ((await page.getAttribute('button[data-action="inspect-tools"]', 'aria-expanded')) !== 'true') {
    await page.click('button[data-action="inspect-tools"]');
  }
}

async function togglePart(page, part) {
  await openInspectTools(page);
  await page.click(`label:has(input[data-toggle="${part}"])`);
}

async function selectPreset(page, id, { keyboard = false } = {}) {
  if (INSPECTION_PRESETS.has(id)) await openInspectTools(page);
  if (keyboard) {
    await page.focus(`button[data-preset="${id}"]`);
    await page.keyboard.press('Enter');
  } else {
    await page.click(`button[data-preset="${id}"]`);
  }
  await page.waitForFunction(
    (preset) => {
      const app = document.querySelector('.cinema-app');
      return app?.dataset.preset === preset && app.dataset.transitioning === 'false' && app.dataset.camera !== 'transition';
    },
    id,
    { timeout: 10_000 },
  );
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

async function selectInspectorView(page, id) {
  await page.click(`button[data-view="${id}"]`);
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

  try {
    // "/" lands on /cinema.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      attachConsole(page, 'root-redirect');
      await page.goto(base);
      await waitForStatus(page);
      check('"/" redirects to /cinema', new URL(page.url()).pathname === '/cinema', page.url());
      await context.close();
    }

    for (const { name, ...options } of VIEWPORTS) {
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

      // Seat panel: open by default on wide desktops, closed on phones and tablets. Closed for the
      // preset shots, so they stay comparable with the baseline's framing.
      {
        const open = (await page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded')) === 'true';
        const expected = name === 'desktop';
        check(`${name}: seat panel ${expected ? 'open' : 'closed'} by default`, open === expected, open);
        if (open) await page.click('button[data-action="seat-panel"]');
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
        await page.click('button[data-quality="high"]');
        await nextFrames(page);
        await measurePerformance(page, 'tablet high');
      }
      if (name === 'mobile') {
        await touchChecks(page, context);
        await mobileSeatChecks(page, context);
      }
      await context.close();
    }

    await seatInspector(browser, base);
    await inspectorFromPage(browser, base);
    await reducedMotion(browser, base);
    await contextLoss(browser, base);
    await lifecycleChecks(browser, base);
    await webglFailure(browser, base);
    await videos(browser, base);
    await comparisons(browser);
  } finally {
    await browser.close();
    await server.close();
  }

  // The WebGL-disabled page logs its failure on purpose, and the X4122 driver note is harmless;
  // anything else is unexpected.
  for (const entry of report.console) {
    entry.expected = entry.page === 'webgl-disabled' || (entry.type === 'warning' && KNOWN_DRIVER_WARNING.test(entry.text));
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
  check('desktop: inspection orbit may leave the room (cut-away)', s.view.state === 'inspection' && Math.abs(s.view.camera.position[0]) > 6.5, s.view.camera.position);
  await screenshot(page, 'desktop-6-cutaway-orbit');

  // Reset restores everything.
  await page.click('button[data-action="reset"]');
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
  await page.click('button[data-preset="seats"]');
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
  await page.click('button[data-preset="seats"]');
  await page.click('button[data-preset="seatEye"]');
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
  await screenshot(page, 'state-1-ceiling-hidden');

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
  await screenshot(page, 'state-2-ceiling-hidden-seat-eye');
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
  const setQuality = async (level) => {
    await page.click(`button[data-quality="${level}"]`);
    await nextFrames(page);
    return state(page);
  };
  const views = [
    ['overview', { preset: 'overview' }],
    ['seat-eye', { preset: 'seatEye' }],
    ['seat-leather', { pose: [[1.6, 1.9, -0.9], [0.0, 0.8, 1.6]] }],
    ['graphite-grazing', { pose: [[4.6, 0.9, -3.9], [3.6, 0.4, -2.6]] }],
  ];
  await setQuality('high');
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
    const s = await setQuality('economy');
    await screenshot(page, `quality-${name}-economy`);
    check(
      `quality: switching at "${name}" keeps the camera exactly`,
      distance(before.position, s.view.camera.position) < 1e-9 && distance(before.target, s.view.camera.target) < 1e-9,
      { before: before.position, after: s.view.camera.position },
    );
    await setQuality('high');
  }

  await selectPreset(page, 'overview');
  const cost = {};
  for (const level of ['high', 'economy']) {
    await setQuality(level);
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
  s = await setQuality('high');
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
  for (let i = 0; i < 6; i++) await setQuality(i % 2 === 0 ? 'economy' : 'high');
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
  await setQuality('economy');
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
  await page.click('button[data-action="tour"]');
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
    preset: () => page.click('button[data-preset="seatEye"]'),
    reset: () => page.click('button[data-action="reset"]'),
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
  await page.click('button[data-quality="economy"]');
  await page.waitForTimeout(800);
  const mid = await state(page);
  check('tour: switching quality during the tour keeps it running', mid.touring && mid.view.tour?.time > 2 && mid.view.quality === 'economy', mid.view.tour);
  await page.click('button[data-quality="high"]');
  await page.click('button[data-action="tour"]');
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
    await page.click(`button[data-quality="${level}"]`);
    await nextFrames(page);
    const timing = await page.evaluate(() => window.__cinema.measureTour(150));
    const s = await state(page);
    report.frameTiming.push({ label: `desktop tour ${level} (run ${run})`, pixelRatio: s.view.pixelRatio, drawingBuffer: s.view.drawingBuffer, ...timing });
  }
  await page.click('button[data-quality="high"]');
  await selectPreset(page, 'overview');
}

// Walking with the keyboard and mouse: start rules, collisions (also diagonal and with slow
// frames), stairs, focus rules, blur and pointercancel, quality switch, render stopping.
async function exploreChecks(page) {
  const walker = async () => (await state(page)).view.explore?.walker ?? null;
  const startExplore = async () => {
    await page.click('button[data-action="explore"]');
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
  await page.click('button[data-quality="economy"]');
  await nextFrames(page);
  const afterSwitch = await state(page);
  check('explore: switching quality keeps exploring at the same spot', afterSwitch.view.state === 'explore' && JSON.stringify(afterSwitch.view.explore?.walker) === JSON.stringify(beforeSwitch), {
    state: afterSwitch.view.state,
    before: beforeSwitch,
    after: afterSwitch.view.explore?.walker,
  });
  await page.click('button[data-quality="high"]');

  await page.click('button[data-action="explore"]');
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

  await page.tap('button[data-action="explore"]');
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
  await page.tap('button[data-action="explore"]');
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
  await page.click('button[data-action="open-inspector"]');
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
  await page.click('button[data-preset="seats"]');
  const cut = await state(page);
  check('reduced motion: presets cut straight to the view (no transition)', cut.view.state === 'preset' && !cut.view.transitioning, cut.view.state);

  await page.click('button[data-action="tour"]');
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
  await page.click('button[data-action="tour"]');
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
      await page.click('button[data-preset="seatEye"]');
      await page.waitForTimeout(2000);
    });
    await context.close();
  }
  {
    const { context, page } = await open('video-select-3d-map-seat-view', { viewport: { width: 1280, height: 760 } });
    await recordVideo(browser, page, 'video-select-3d-map-seat-view', async () => {
      await page.waitForTimeout(600);
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
      await page.click('button[data-action="view-from-seat"]');
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
          if (point.visible) return { id: seat.id, ...point };
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
      await page.tap('button[data-action="explore"]');
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
const seatPoint = (page, id) => page.evaluate((seatId) => window.__cinema.seatScreenPoint(seatId), id);

async function openSeatPanel(page) {
  if ((await page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded')) !== 'true') {
    await page.click('button[data-action="seat-panel"]');
  }
  await page.waitForSelector('#cinema-seat-panel:not([hidden])');
}

async function closeSeatPanel(page) {
  if ((await page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded')) === 'true') {
    await page.click('button[data-action="seat-panel"]');
  }
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

  // 3D → map.
  const picked = [];
  for (const id of ['F06', 'B03', 'H08']) if (await clickSeat3d(page, id)) picked.push(id);
  let s = await seatsState(page);
  const pressed = await Promise.all(picked.map((id) => page.getAttribute(`button[data-seat="${id}"]`, 'aria-pressed')));
  const looks = await Promise.all(picked.map((id) => seatLook(page, id)));
  check(
    'seats: clicking seats in 3D selects them, presses them in the map and tags them in 3D',
    picked.length === 3 && JSON.stringify(s.selected) === JSON.stringify(['B03', 'F06', 'H08']) && pressed.every((v) => v === 'true') && looks.every((l) => l.tag),
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

  // Arrow keys in the map never move the camera, even while exploring.
  await page.click('button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  const walkerBefore = (await state(page)).view.explore.walker;
  await page.focus('button[data-seat][tabindex="0"]');
  for (const key of ['ArrowUp', 'ArrowLeft', 'KeyW']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(250);
    await page.keyboard.up(key);
  }
  const walkerAfter = (await state(page)).view.explore.walker;
  check('seats: keys pressed in the map do not move the explorer', JSON.stringify(walkerBefore) === JSON.stringify(walkerAfter));
  await page.click('button[data-action="explore"]');
  await selectPreset(page, 'overview');

  // The limit: 8 seats, the 9th is refused with a message, nothing is lost.
  await page.click('button[data-action="clear-selection"]');
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
  await page.click('button[data-action="clear-selection"]');
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
  await page.click('button[data-action="clear-selection"]');
  await selectPreset(page, 'overview');

  // Seat views from the panel: pose from seatViewPose, caption with the ID, selection kept; back.
  await page.click('button[data-seat="D09"]');
  const keep = (await seatsState(page)).selected;
  report.seats.views = {};
  for (const id of ['A01', 'A06', 'F06', 'J06', 'J11']) {
    await page.focus(`button[data-seat="${id}"]`);
    await page.click('button[data-action="view-from-seat"]');
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

  // Closing and opening the panel resizes the canvas; picking follows the new rect.
  await page.click('button[data-action="clear-selection"]');
  await closeSeatPanel(page);
  await page.waitForTimeout(300);
  const wide = (await state(page)).view.drawingBuffer.width;
  const pickedWide = await clickSeat3d(page, 'E09');
  await openSeatPanel(page);
  await page.waitForTimeout(300);
  const narrow = (await state(page)).view.drawingBuffer.width;
  const pickedNarrow = await clickSeat3d(page, 'G04');
  s = await seatsState(page);
  check('seats: picking stays exact after the panel resizes the canvas', pickedWide && pickedNarrow && wide > narrow && s.selected.includes('E09') && s.selected.includes('G04'), { wide, narrow, selected: s.selected });

  // Quality switch: same selection, same look, picking still maps to the right seats.
  await page.click('button[data-quality="economy"]');
  await nextFrames(page);
  const economyLook = await seatLook(page, 'E09');
  const pickedEconomy = await clickFirstVisible(page, ['F08', 'E05', 'D06', 'C06', 'G07']);
  s = await seatsState(page);
  check('seats: after switching to Economy the selection and its tags remain and picking maps correctly', economyLook.tag && pickedEconomy && s.selected.includes(pickedEconomy) && s.selected.length === 3, {
    pickedEconomy,
    selected: s.selected,
  });
  await page.click('button[data-quality="high"]');
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
    await page.click(`button[data-quality="${level}"]`);
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
  await page.click('button[data-action="open-inspector"]');
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
  await page.click('button[data-action="clear-selection"]');
  await closeSeatPanel(page);
}

// Phone: the bottom sheet, real taps in 3D and in the map, two-finger and cancelled touches,
// the stick with a second finger, rotation with the sheet open, Escape/close returning focus.
async function mobileSeatChecks(page, context) {
  const cdp = await context.newCDPSession(page);
  await selectPreset(page, 'overview');
  // The inspection row is still open from the preset checks; a visitor would not have it open.
  if ((await page.getAttribute('button[data-action="inspect-tools"]', 'aria-expanded')) === 'true') {
    await page.click('button[data-action="inspect-tools"]');
  }
  await page.tap('button[data-action="seat-panel"]');
  await page.waitForSelector('#cinema-seat-panel:not([hidden])');
  await page.waitForTimeout(300);
  const tapAt = async (p) => {
    await touch(cdp, 'touchStart', [[p.x, p.y, 1]]);
    await page.waitForTimeout(60);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(100);
  };
  let p = await seatPoint(page, 'F05');
  await tapAt(p);
  let s = await seatsState(page);
  check('mobile: a real tap on a seat in 3D selects it', p.visible && s.selected.includes('F05'), { p, selected: s.selected });
  await page.tap('button[data-seat="B07"]');
  s = await seatsState(page);
  check('mobile: tapping a seat in the map selects it', s.selected.includes('B07'));
  const overflow = await page.evaluate(() => {
    const map = document.querySelector('.cinema-map');
    const seat = document.querySelector('.cinema-seat').getBoundingClientRect();
    return { scrolls: map.scrollWidth > map.clientWidth, seat: { width: seat.width, height: seat.height }, page: document.documentElement.scrollWidth - innerWidth };
  });
  check('mobile: seats stay ≥ 36 px; the map scrolls sideways instead of shrinking, the page does not', overflow.seat.width >= 36 && overflow.page <= 0, overflow);
  await screenshot(page, 'seats-4-mobile-sheet');

  const before = JSON.stringify((await seatsState(page)).selected);
  // Two fingers, one on a seat, lifted one after the other.
  p = await seatPoint(page, 'G06');
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
  await page.tap('button[data-action="explore"]');
  await page.waitForFunction(() => window.__cinema.getState().view.owner === 'driver', null, { timeout: 8000 });
  const stick = await page.locator('.cinema-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  const near = await page.evaluate(() => {
    for (const id of ['J07', 'J08', 'I07', 'I08', 'J09', 'H07']) {
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
  await page.tap('button[data-action="explore"]');
  await selectPreset(page, 'overview');

  // Rotate with the sheet open: it becomes a side panel; selection and picking still right.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  // With the panel open beside it, the view has less room by design.
  const landscape = await layoutChecks(page, 'mobile landscape with the seat panel', { minShare: 0.35 });
  const lp = await seatPoint(page, 'E10');
  if (lp.visible) await tapAt(lp);
  check('mobile: in landscape with the panel beside the view, tapping still picks the right seat', lp.visible && (await seatsState(page)).selected.includes('E10') && landscape.overflowX <= 0, lp);
  await screenshot(page, 'seats-5-mobile-landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // Escape inside the sheet closes it and focus goes back to its button.
  await page.focus('button[data-seat][tabindex="0"]');
  await page.keyboard.press('Escape');
  const closed = await page.isHidden('#cinema-seat-panel');
  const focusBack = await page.evaluate(() => document.activeElement?.dataset?.action ?? null);
  check('mobile: Escape in the sheet closes it and returns focus to "Sơ đồ ghế" (non-modal, no trap)', closed && focusBack === 'seat-panel', { focusBack });
  await page.tap('button[data-action="seat-panel"]');
  await page.click('button[data-action="clear-selection"]');
  await page.tap('button[data-action="seat-panel"]');
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
    for (const type of ['BufferGeometry', 'Material', 'Texture', 'Object3D', 'WebGLRenderTarget']) {
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
  await page.click('button[data-quality="economy"]');
  await nextFrames(page);
  await page.click('button[data-quality="high"]');
  await nextFrames(page);
  const first = await count();
  const selectedBefore = (await seatsState(page)).selected;
  for (let i = 0; i < 4; i++) {
    await cycle();
    await page.click('button[data-quality="economy"]');
    await nextFrames(page);
    await page.click('button[data-quality="high"]');
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
  await page.click('button[data-quality="economy"]');
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
  await page.click('button[data-quality="high"]');
  await selectInspectorView(page, 'side');
  check(
    'inspector: measured seat fits the brief (W 0.72–0.76, D ≤ 0.75, H 1.05–1.15, seat 0.43–0.47, cushion 0.48–0.52 m)',
    m.width >= 0.72 && m.width <= 0.76 && m.depth <= 0.75 && m.height >= 1.05 && m.height <= 1.15 &&
      m.seatHeight >= 0.43 && m.seatHeight <= 0.47 && m.cushionWidth >= 0.48 && m.cushionWidth <= 0.52,
    m,
  );
  check('inspector: gap to the neighbouring seat', m.gapToNeighbour >= 0.02, m.gapToNeighbour);

  await page.click('label:has(input[data-toggle="cluster"])');
  await selectInspectorView(page, 'front');
  s = await inspectorState(page);
  check('inspector: cluster shows three seats', s.inspector.seats === 3, s.inspector.seats);
  await screenshot(page, 'seat-5-cluster-front');
  await page.click('label:has(input[data-toggle="footprint"])');
  await page.click('label:has(input[data-toggle="dimensions"])');
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
  await page.click('button[data-action="explore"]');
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
  await page.click('button[data-action="explore"]');
  // Resources from before the loss are rebuilt, so a quality switch now deletes nothing stale
  // (the console check at the end fails on any "does not belong to this context").
  await page.click('button[data-quality="economy"]');
  await page.click('button[data-quality="high"]');
  await nextFrames(page);

  // Lose the context after a quality change and a hidden ceiling: both must survive the restore.
  await page.click('button[data-quality="economy"]');
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
  await page.click('button[data-action="open-inspector"]');
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
  // Camera and display controls go; the seat panel and its map stay.
  const disabled = await page.$$eval('.cinema-toolbar button:not([data-action="seat-panel"])', (buttons) => buttons.every((b) => b.disabled));
  check('WebGL unavailable: shows an error instead of loading forever', status === 'error', { status, message });
  check('WebGL unavailable: camera and display controls are disabled', disabled);
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
    if (existsSync(before)) pairs.push([`compare-p05-p06-${file}`, [['Prompt 05 (baseline)', before], ['Prompt 06', path.join(outDir, `${file}.png`)]]]);
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

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
