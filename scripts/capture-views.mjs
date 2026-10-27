// Browser acceptance check for the /cinema page and the seat inspector (/cinema?inspect=seat).
//
// Starts the Vite dev server, opens the pages in a locally installed Chrome or Edge (driven by
// playwright-core, no browser download), exercises the camera presets, visibility switches and the
// lights and shadows that follow them, both quality levels (same views, switching, persistence,
// resource stability, frame timing), resize, keyboard use, context loss, hot re-mount, the seat
// inspector's views and lifecycle and a simulated WebGL failure, then writes screenshots and
// report.json to artifacts/<CAPTURE_DIR or prompt-04>/.
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
const outDir = path.join(root, 'artifacts', process.env.CAPTURE_DIR ?? 'prompt-04');

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
];

const PRESETS = [
  { id: 'overview', file: 'overview' },
  { id: 'seats', file: 'seats' },
  { id: 'side', file: 'side' },
  { id: 'seatEye', file: 'seat-eye' },
];

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

async function selectPreset(page, id, { keyboard = false } = {}) {
  if (keyboard) {
    await page.focus(`button[data-preset="${id}"]`);
    await page.keyboard.press('Enter');
  } else {
    await page.click(`button[data-preset="${id}"]`);
  }
  await page.waitForFunction(
    (preset) => {
      const app = document.querySelector('.cinema-app');
      return app?.dataset.preset === preset && app.dataset.transitioning === 'false';
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

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(path.relative(root, file).replaceAll('\\', '/'));
}

async function layoutChecks(page, label) {
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
  check(`${label}: canvas uses most of the screen`, share > 0.5, Number(share.toFixed(2)));
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

      const stats = await page.textContent('.cinema-stats');
      check(`${name}: header shows rows and seat total`, /10 \(A–J\)/.test(stats) && /110/.test(stats), stats);
      await layoutChecks(page, name);

      for (const [index, preset] of PRESETS.entries()) {
        await selectPreset(page, preset.id);
        const s = await state(page);
        check(`${name}: preset ${preset.id} applied`, s.preset === preset.id && s.view.transitioning === false, s.view.camera);
        await screenshot(page, `${name}-${index + 1}-${preset.file}`);
        if (name === 'desktop') {
          report.renderer.push({ preset: preset.id, ...s.view.render, ...s.view.memory });
          const split = await page.evaluate(() => window.__cinema.measureCost?.() ?? null);
          if (split) report.rendererSplit.push({ preset: preset.id, ...split });
        }
        if (preset.id === 'side') check(`${name}: side view hides the right wall`, s.visibility.rightWall === false);
        if (preset.id === 'seatEye') {
          check(`${name}: seat-eye restores the right wall`, s.visibility.rightWall === true);
          check(`${name}: seat-eye uses look-around mode`, s.view.mode === 'eye');
        }
      }

      if (name === 'desktop') {
        await interiorShots(page);
        await materialShots(page);
        await lightingChecks(page);
        await measurePerformance(page, 'desktop high');
        await qualityChecks(page);
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
      await context.close();
    }

    await seatInspector(browser, base);
    await contextLoss(browser, base);
    await webglFailure(browser, base);
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
  // Visibility switches: hide ceiling and back wall, look from the overview.
  await selectPreset(page, 'overview');
  await page.click('label:has(input[data-toggle="ceiling"])');
  await page.click('label:has(input[data-toggle="backWall"])');
  await nextFrames(page);
  let s = await state(page);
  check('desktop: ceiling and back wall can be hidden', s.visibility.ceiling === false && s.visibility.backWall === false);
  // Zoom out through the (hidden) back wall and orbit upwards so the cut-away is actually visible.
  const canvasBox = await page.locator('.cinema-canvas').boundingBox();
  const centre = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y + 30, { steps: 6 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  s = await state(page);
  check('desktop: zoom takes the camera outside the hidden back wall', s.view.camera.position[2] > 9.3, s.view.camera.position);
  const freeCaption = await page.textContent('.cinema-caption');
  check('desktop: caption switches to free camera after manual orbit', freeCaption.startsWith('Camera tự do'), freeCaption);
  await screenshot(page, 'desktop-5-ceiling-back-hidden');

  // Keep orbiting up to a plan view: checks symmetry, aisles and the seat block from above.
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y + 260, { steps: 10 });
  await page.mouse.up();
  await waitForCameraToSettle(page);
  await screenshot(page, 'desktop-6-plan-from-above');

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
  await page.click('button[data-preset="side"]');
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
  await page.click('label:has(input[data-toggle="ceiling"])');
  await nextFrames(page);
  const s = await state(page);
  check('desktop: hiding the ceiling hides its beams and light slots (fewer draw calls)', s.visibility.ceiling === false, s.view.render);
  await screenshot(page, 'interior-7-overview-ceiling-hidden');
  await page.click('label:has(input[data-toggle="ceiling"])');
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
    await page.click(`label:has(input[data-toggle="${part}"])`);
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
  await page.click('label:has(input[data-toggle="backWall"])');
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
  await page.click('label:has(input[data-toggle="backWall"])');
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
  // Lose the context after a quality change and a hidden ceiling: both must survive the restore.
  await page.click('button[data-quality="economy"]');
  await page.click('label:has(input[data-toggle="ceiling"])');
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
  const disabled = await page.$$eval('button', (buttons) => buttons.every((b) => b.disabled));
  check('WebGL unavailable: shows an error instead of loading forever', status === 'error', { status, message });
  check('WebGL unavailable: controls are disabled', disabled);
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
    'desktop-3-side',
    'desktop-4-seat-eye',
    'interior-1-door-wall',
    'interior-4-curtain-screen',
    'interior-6-handrail-stairs',
    'mobile-1-overview',
  ]) {
    const before = path.join(baselineDir, `${file}.png`);
    if (existsSync(before)) pairs.push([`compare-p03-p04-${file}`, [['Prompt 03 (baseline)', before], ['Prompt 04', path.join(outDir, `${file}.png`)]]]);
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
    const images = await Promise.all(panels.map(async ([label, file]) => [label, (await readFile(file)).toString('base64')]));
    await page.setContent(
      `<body style="margin:0;background:#0f1013;color:#e9eaee;font:14px system-ui;display:flex;gap:20px;padding:0">${images
        .map(([label, data]) => `<figure style="margin:0;width:720px"><img style="width:720px;display:block" src="data:image/png;base64,${data}"><figcaption style="padding:6px 8px">${label}</figcaption></figure>`)
        .join('')}</body>`,
    );
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    await screenshot(page, name);
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
