// Renders the landing page's pictures from the auditorium itself and writes them to public/brand/:
// hero (16:9 and a portrait cut), three step pictures, the share card and the icons.
//
// The screen shows a slate drawn here (fixtures/brand/screen-slate.png, the working wordmark on
// dark), passed in with the development-only `?poster=` override, so no frame of the demo film ends
// up in an image without its credit. The auditorium's own film and poster are untouched.
// Starts its own Vite dev server and a locally installed Chrome/Edge with a fresh profile
// (playwright-core, no browser download). WebP and JPEG are encoded by the browser's canvas.
//
//   node scripts/capture-brand-assets.mjs
//   BRAND_ONLY=step-2,step-3 node scripts/capture-brand-assets.mjs   # only those pictures
//
// Picture names for BRAND_ONLY: hero, hero-portrait, step-1, step-2, step-3, icon.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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

const COLORS = { charcoal: '#14110f', wine: '#7d2232', champagne: '#d9c08c' };

/** Only the 3D view, filling the window (development page, styles injected by this script). */
const VIEW_ONLY =
  '.cinema-header,.cinema-hub,.cinema-overlay,.cinema-filmstatus,.cinema-notice,.cinema-caption,.cinema-return,.cinema-tourbar{display:none!important}' +
  '.cinema-main{padding:0!important}.cinema-screen{gap:0!important}.cinema-stage{border:0!important;border-radius:0!important}';

// Camera poses (metres, room coordinates; the screen is at z = −8.7): the hero sees the room from the
// back right so the screen sits right of centre and the left stays calm for the words.
const POSES = {
  hero: { position: [3.5, 3.6, 7.5], target: [-3.5, 1.6, -8.0] },
  heroPortrait: { position: [0.8, 4.2, 8.4], target: [-0.6, 1.4, -8.7] },
  aisle: { position: [5.15, 2.95, 4.2], target: [1.2, 2.2, -8.7] },
};

/** Draws the slate the screen shows in these pictures. */
async function drawSlate(page) {
  return page.evaluate(({ charcoal, wine, champagne }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const g = canvas.getContext('2d');
    const glow = g.createRadialGradient(960, 520, 80, 960, 540, 1100);
    glow.addColorStop(0, '#2a211c');
    glow.addColorStop(1, charcoal);
    g.fillStyle = glow;
    g.fillRect(0, 0, 1920, 1080);
    // The mark, 6× its 32-unit drawing, centred above the name.
    g.save();
    g.translate(960 - 96, 300);
    g.scale(6, 6);
    g.strokeStyle = champagne;
    g.lineWidth = 2.4;
    g.beginPath();
    g.roundRect(3.2, 6.5, 25.6, 14.4, 2.4);
    g.stroke();
    g.globalAlpha = 0.22;
    g.fillStyle = champagne;
    g.fillRect(7.5, 10.4, 17, 6.6);
    g.globalAlpha = 1;
    g.strokeStyle = wine;
    g.lineWidth = 3.2;
    g.lineCap = 'round';
    for (const [a, b] of [[7, 11.6], [13.7, 18.3], [20.4, 25]]) {
      g.beginPath();
      g.moveTo(a, 26.2);
      g.lineTo(b, 26.2);
      g.stroke();
    }
    g.restore();
    g.textAlign = 'center';
    g.fillStyle = '#f3ede5';
    g.font = '700 132px system-ui, "Segoe UI", sans-serif';
    g.fillText('Tân Phong', 960, 700);
    g.fillStyle = champagne;
    g.font = '600 52px system-ui, "Segoe UI", sans-serif';
    g.letterSpacing = '22px';
    g.fillText('CINEMA', 960 + 11, 790);
    return canvas.toDataURL('image/png').split(',')[1];
  }, COLORS);
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
    await writeFile(path.join(slateDir, 'screen-slate.png'), Buffer.from(await drawSlate(tool), 'base64'));
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
      // Step 2: the real page — "Mở sơ đồ" from "Cài đặt", the map beside the room, two seats selected (3:2).
      page = await openRoom(browser, base, { width: 1200, height: 800 }, 1.6);
      await page.click('button[data-action="settings"]');
      await page.waitForSelector('#cinema-hub-panel:not([hidden])');
      await page.click('.cinema-hub button[data-action="seat-panel"]');
      await page.waitForSelector('#cinema-seat-panel:not([hidden])');
      for (const id of ['F05', 'F06']) await page.click(`button[data-seat="${id}"]`);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(700);
      if (wanted('step-2')) {
        const seats = (await page.screenshot({ type: 'png' })).toString('base64');
        console.log('step 2');
        await encode(tool, seats, 'step-2', [640, 960], { jpegWidths: [960] });
      }

      // Step 3: from seat F06 — the screen (slate) and, from "Cài đặt", the film's player (3:2).
      await page.click('button[data-action="view-from-seat"]');
      await page.waitForFunction(() => document.querySelector('.cinema-app').dataset.camera === 'seat', null, { timeout: 10_000 });
      await page.click('button[data-action="seat-panel-close"]');
      await page.waitForSelector('#cinema-seat-panel', { state: 'hidden' });
      await page.click('button[data-action="settings"]');
      await page.waitForSelector('#cinema-hub-panel:not([hidden])');
      // The film's section at the top of the panel.
      await page.evaluate(() => {
        const body = document.querySelector('.cinema-hub__body');
        const film = body.querySelector('[data-section="film"]');
        body.scrollTop = film.offsetTop - body.offsetTop;
      });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(900);
      if (wanted('step-3')) {
        const watch = (await page.screenshot({ type: 'png' })).toString('base64');
        console.log('step 3');
        await encode(tool, watch, 'step-3', [640, 960], { jpegWidths: [960] });
      }
      await page.close();
    }

    if (!wanted('icon')) return;
    // Icons: the mark on warm charcoal (the browser tab may be light).
    const icon = await tool.evaluate(({ charcoal, wine, champagne }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 180;
      const g = canvas.getContext('2d');
      g.fillStyle = charcoal;
      g.fillRect(0, 0, 180, 180);
      g.translate(18, 18);
      g.scale(4.5, 4.5);
      g.strokeStyle = champagne;
      g.lineWidth = 2.4;
      g.beginPath();
      g.roundRect(3.2, 6.5, 25.6, 14.4, 2.4);
      g.stroke();
      g.globalAlpha = 0.22;
      g.fillStyle = champagne;
      g.fillRect(7.5, 10.4, 17, 6.6);
      g.globalAlpha = 1;
      g.strokeStyle = wine;
      g.lineWidth = 3.2;
      g.lineCap = 'round';
      for (const [a, b] of [[7, 11.6], [13.7, 18.3], [20.4, 25]]) {
        g.beginPath();
        g.moveTo(a, 26.2);
        g.lineTo(b, 26.2);
        g.stroke();
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, COLORS);
    await writeFile(path.join(root, 'public', 'apple-touch-icon.png'), Buffer.from(icon, 'base64'));
    console.log('icon: public/apple-touch-icon.png');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
