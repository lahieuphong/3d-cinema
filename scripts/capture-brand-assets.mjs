// Renders the landing page's pictures from the auditorium itself and writes them to public/brand/:
// hero (16:9 and a portrait cut), three step pictures, the share card; and every size of the logo.
//
// The logo comes from one file, fixtures/brand/logo-source.png (the gold film reel, as supplied):
// faint stray pixels dropped, trimmed and centred on a transparent square, then written as the
// page's mark (public/brand/logo-{64,128,256}.webp), the tab icon (public/favicon.png) and the home
// screen icon (public/apple-touch-icon.png, on charcoal: iOS fills transparency with black).
//
// The screen shows a slate drawn here (fixtures/brand/screen-slate.png, the logo and the working
// wordmark on dark), passed in with the development-only `?poster=` override, so no frame of the
// demo film ends up in an image without its credit. The auditorium's own film and poster are untouched.
// Starts its own Vite dev server and a locally installed Chrome/Edge with a fresh profile
// (playwright-core, no browser download). WebP and JPEG are encoded by the browser's canvas.
//
//   node scripts/capture-brand-assets.mjs
//   BRAND_ONLY=step-2,step-3 node scripts/capture-brand-assets.mjs   # only those pictures
//
// Picture names for BRAND_ONLY: logo, hero, hero-portrait, step-1, step-2, step-3. (The logo comes
// first: the step pictures show the page's header, which shows the mark.)

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'brand');
const slateDir = path.join(root, 'fixtures', 'brand');
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const only = new Set((process.env.BRAND_ONLY ?? '').split(',').filter(Boolean));
const wanted = (name) => only.size === 0 || only.has(name);

const COLORS = { charcoal: '#14110f', champagne: '#d9c08c' };

/** Only the 3D view, filling the window (development page, styles injected by this script). */
const VIEW_ONLY =
  '.cinema-header,.cinema-hub,.cinema-taskbar,.cinema-overlay,.cinema-filmstatus,.cinema-notice,.cinema-caption,.cinema-return,.cinema-tourbar{display:none!important}' +
  '.cinema-main{padding:0!important}.cinema-screen{gap:0!important}.cinema-stage{border:0!important;border-radius:0!important}';

// Camera poses (metres, room coordinates; the screen is at z = −8.7): the hero sees the room from the
// back right so the screen sits right of centre and the left stays calm for the words.
const POSES = {
  hero: { position: [3.5, 3.6, 7.5], target: [-3.5, 1.6, -8.0] },
  heroPortrait: { position: [0.8, 4.2, 8.4], target: [-0.6, 1.4, -8.7] },
  aisle: { position: [5.15, 2.95, 4.2], target: [1.2, 2.2, -8.7] },
};

/**
 * The logo as one transparent square (PNG, base64): pixels at alpha ≤ 16 (invisible noise around
 * the drawing) cleared, the drawing trimmed and centred with a 3 % margin on each side.
 */
async function squareLogo(page) {
  const source = `data:image/png;base64,${(await readFile(path.join(slateDir, 'logo-source.png'))).toString('base64')}`;
  return page.evaluate(async (source) => {
    const image = await createImageBitmap(await (await fetch(source)).blob());
    const { width, height } = image;
    const work = new OffscreenCanvas(width, height);
    const g = work.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    const pixels = g.getImageData(0, 0, width, height);
    const d = pixels.data;
    let [x0, y0, x1, y1] = [width, height, -1, -1];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = (y * width + x) * 4 + 3;
        if (d[a] <= 16) {
          d[a] = 0;
          continue;
        }
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    g.putImageData(pixels, 0, 0);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const side = Math.round(Math.max(w, h) * 1.06);
    const square = new OffscreenCanvas(side, side);
    square.getContext('2d').drawImage(work, x0, y0, w, h, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
    const bytes = new Uint8Array(await (await square.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }, source);
}

/**
 * The square logo at `size` px (halved step by step, then drawn at size, so fine detail survives
 * the scale), optionally inset on a solid `background`. Returns base64 of `type`.
 */
async function logoAt(page, logoBase64, size, { type = 'image/png', quality = 0.9, background = null, inset = 0 } = {}) {
  return page.evaluate(
    async ({ logoBase64, size, type, quality, background, inset }) => {
      let current = await createImageBitmap(await (await fetch(`data:image/png;base64,${logoBase64}`)).blob());
      const drawn = Math.round(size * (1 - 2 * inset));
      while (current.width / 2 >= drawn) {
        const half = new OffscreenCanvas(Math.round(current.width / 2), Math.round(current.height / 2));
        const g = half.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(current, 0, 0, half.width, half.height);
        current = half;
      }
      const canvas = new OffscreenCanvas(size, size);
      const g = canvas.getContext('2d');
      if (background) {
        g.fillStyle = background;
        g.fillRect(0, 0, size, size);
      }
      g.imageSmoothingQuality = 'high';
      const offset = Math.round((size - drawn) / 2);
      g.drawImage(current, offset, offset, drawn, drawn);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { logoBase64, size, type, quality, background, inset },
  );
}

/** Draws the slate the screen shows in these pictures: the logo above the wordmark. */
async function drawSlate(page, logoBase64) {
  return page.evaluate(
    async ({ charcoal, champagne, logoBase64 }) => {
      const logo = await createImageBitmap(await (await fetch(`data:image/png;base64,${logoBase64}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const g = canvas.getContext('2d');
      const glow = g.createRadialGradient(960, 520, 80, 960, 540, 1100);
      glow.addColorStop(0, '#2a211c');
      glow.addColorStop(1, charcoal);
      g.fillStyle = glow;
      g.fillRect(0, 0, 1920, 1080);
      // The logo, 330 px square, centred above the name.
      g.imageSmoothingQuality = 'high';
      g.drawImage(logo, 960 - 165, 215, 330, 330);
      g.textAlign = 'center';
      g.fillStyle = '#f3ede5';
      g.font = '700 132px system-ui, "Segoe UI", sans-serif';
      g.fillText('Tân Phong', 960, 700);
      g.fillStyle = champagne;
      g.font = '600 52px system-ui, "Segoe UI", sans-serif';
      g.letterSpacing = '22px';
      g.fillText('CINEMA', 960 + 11, 790);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { ...COLORS, logoBase64 },
  );
}

/** Encodes `pngBase64` at each width (height follows the aspect, or `crop` = target aspect) as WebP and JPEG. */
async function encode(page, pngBase64, name, widths, { jpegWidths = [], crop = null, quality = 0.82 } = {}) {
  const files = await page.evaluate(
    async ({ pngBase64, widths, jpegWidths, crop, quality }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${pngBase64}`)).blob());
      let sx = 0;
      let sy = 0;
      let sw = image.width;
      let sh = image.height;
      if (crop) {
        // Centre crop to the target aspect.
        if (sw / sh > crop) {
          sw = Math.round(sh * crop);
          sx = Math.round((image.width - sw) / 2);
        } else {
          sh = Math.round(sw / crop);
          sy = Math.round((image.height - sh) / 2);
        }
      }
      const outputs = [];
      for (const [width, type] of [...widths.map((w) => [w, 'image/webp']), ...jpegWidths.map((w) => [w, 'image/jpeg'])]) {
        const height = Math.round((width * sh) / sw);
        const canvas = new OffscreenCanvas(width, height);
        const g = canvas.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type, quality });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        outputs.push({ width, height, type, data: btoa(text) });
      }
      return outputs;
    },
    { pngBase64, widths, jpegWidths, crop, quality },
  );
  for (const file of files) {
    const ext = file.type === 'image/webp' ? 'webp' : 'jpg';
    const target = path.join(outDir, `${name}-${file.width}.${ext}`);
    await writeFile(target, Buffer.from(file.data, 'base64'));
    console.log(`  ${path.relative(root, target)}  ${file.width}×${file.height}  ${(Buffer.from(file.data, 'base64').length / 1000).toFixed(1)} kB`);
  }
}

async function openRoom(browser, base, viewport, deviceScaleFactor, query = '?poster=screen-slate.png') {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  await page.goto(`${base}cinema${query}`);
  await page.waitForFunction(() => document.querySelector('.cinema-app')?.dataset.status === 'ready', null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__cinema.film().view?.screen?.content === 'poster', null, { timeout: 20_000 });
  return page;
}

async function renderView(page, pose) {
  await page.addStyleTag({ content: VIEW_ONLY });
  await page.waitForTimeout(400);
  await page.evaluate(({ position: p, target: t }) => window.__cinema.setCamera({ x: p[0], y: p[1], z: p[2] }, { x: t[0], y: t[1], z: t[2] }, 'eye'), pose);
  await page.waitForTimeout(600);
  return (await page.locator('canvas.cinema-canvas').screenshot({ type: 'png' })).toString('base64');
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(slateDir, { recursive: true });
  const server = await createServer({ root, logLevel: 'warn', server: { port: 5299, strictPort: false } });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
  // A fresh, temporary profile: never the user's running browser.
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const tool = await browser.newPage();
    const logo = await squareLogo(tool);
    if (wanted('logo')) {
      const write = async (file, base64) => {
        await writeFile(path.join(root, 'public', file), Buffer.from(base64, 'base64'));
        console.log(`  public/${file}  ${(Buffer.from(base64, 'base64').length / 1000).toFixed(1)} kB`);
      };
      console.log('logo');
      // The page's mark (shown at 26–40 px, so 64/128/256 cover 1×–3× screens).
      for (const size of [64, 128, 256]) await write(`brand/logo-${size}.webp`, await logoAt(tool, logo, size, { type: 'image/webp' }));
      // Tab icon: the reel itself, transparent (gold reads on light and dark tabs).
      await write('favicon.png', await logoAt(tool, logo, 64));
      // Home screen icon: on warm charcoal, with room around it for the system's rounded corners.
      await write('apple-touch-icon.png', await logoAt(tool, logo, 180, { background: COLORS.charcoal, inset: 0.1 }));
    }
    await writeFile(path.join(slateDir, 'screen-slate.png'), Buffer.from(await drawSlate(tool, logo), 'base64'));
    console.log('slate: fixtures/brand/screen-slate.png');

    let page;
    if (wanted('hero')) {
      // Hero, 16:9: 2560 × 1440 render (High quality, pixel ratio 2).
      page = await openRoom(browser, base, { width: 1280, height: 720 }, 2);
      const hero = await renderView(page, POSES.hero);
      await page.close();
      console.log('hero');
      await encode(tool, hero, 'hero', [960, 1440, 1920, 2560], { jpegWidths: [1920] });
      // Share card, 1200 × 630, from the same render.
      await encode(tool, hero, 'share', [], { jpegWidths: [1200], crop: 1200 / 630, quality: 0.86 });
    }

    if (wanted('hero-portrait')) {
      // Hero, portrait (2:3): 1440 × 2160 render.
      page = await openRoom(browser, base, { width: 720, height: 1080 }, 2);
      const portrait = await renderView(page, POSES.heroPortrait);
      await page.close();
      console.log('hero portrait');
      await encode(tool, portrait, 'hero-portrait', [720, 1080, 1440], { jpegWidths: [1080] });
    }

    if (wanted('step-1')) {
      // Step 1: walking — the right aisle from standing eye height (3:2).
      page = await openRoom(browser, base, { width: 960, height: 640 }, 2);
      const aisle = await renderView(page, POSES.aisle);
      await page.close();
      console.log('step 1');
      await encode(tool, aisle, 'step-1', [640, 960], { jpegWidths: [960] });
    }

    if (wanted('step-2') || wanted('step-3')) {
      // Step 2: the real page — Chọn ghế in the task bar, the map beside the room, two seats selected (3:2).
      page = await openRoom(browser, base, { width: 1200, height: 800 }, 1.6);
      await page.click('.cinema-taskbar button[data-task="seats"]');
      if ((await page.getAttribute('button[data-action="seat-panel"]', 'aria-expanded')) !== 'true') await page.click('.cinema-taskbar button[data-action="seat-panel"]');
      await page.waitForSelector('#cinema-seat-panel:not([hidden])');
      for (const id of ['F05', 'F06']) await page.click(`button[data-seat="${id}"]`);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(700);
      if (wanted('step-2')) {
        const seats = (await page.screenshot({ type: 'png' })).toString('base64');
        console.log('step 2');
        await encode(tool, seats, 'step-2', [640, 960], { jpegWidths: [960] });
      }

      // Step 3: from seat F06 — the screen (slate) and, in Xem phim, the player over the room (3:2).
      await page.click('button[data-action="view-from-seat"]');
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
      await page.click('.cinema-taskbar button[data-task="watch"]');
      await page.waitForSelector('#cinema-seat-panel', { state: 'hidden' });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(900);
      if (wanted('step-3')) {
        const watch = (await page.screenshot({ type: 'png' })).toString('base64');
        console.log('step 3');
        await encode(tool, watch, 'step-3', [640, 960], { jpegWidths: [960] });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
