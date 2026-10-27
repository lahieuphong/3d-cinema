// Generates the small test videos used by `npm run capture` into fixtures/media/ (development only;
// nothing here is shipped: Vite serves the folder in dev, the build never copies it).
//
// Every picture and sound is made by code in a locally installed Chrome (canvas + Web Audio,
// recorded with MediaRecorder); no tool is downloaded and no outside footage is used.
//
//   node scripts/make-media-fixtures.mjs
//
// The pattern: seven 100 % colour bars, a grey ramp, an orange "TL" marker in the top-left corner
// (shows flips and mirroring), a white border on the picture's edge (shows cropping and the
// letterbox), a running frame number and a white bar sweeping left to right (the picture changes
// every frame). Colours are written in sRGB, so pixels on the 3D screen can be compared with them.

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'fixtures', 'media');
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const MP4 = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
const MP4_VIDEO = 'video/mp4;codecs=avc1.42E01E';
const WEBM = 'video/webm;codecs=vp9,opus';

const FIXTURES = [
  { file: 'pattern-16x9.mp4', width: 640, height: 360, seconds: 8, audio: true, type: MP4 },
  { file: 'pattern-9x16.mp4', width: 360, height: 640, seconds: 4, audio: true, type: MP4 },
  { file: 'pattern-239.mp4', width: 860, height: 360, seconds: 4, audio: true, type: MP4 },
  { file: 'pattern-silent.mp4', width: 640, height: 360, seconds: 4, audio: false, type: MP4_VIDEO },
  // MediaRecorder WebM has no duration in its header: the browser reports Infinity.
  { file: 'pattern-no-duration.webm', width: 640, height: 360, seconds: 4, audio: true, type: WEBM },
];

/** Exact sRGB colours of the bars, left to right, as drawn (the capture compares against these). */
export const BARS = [
  [255, 255, 255],
  [255, 255, 0],
  [0, 255, 255],
  [0, 255, 0],
  [255, 0, 255],
  [255, 0, 0],
  [0, 0, 255],
];

const saved = new Map();
const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>fixtures</title>');
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    saved.set(decodeURIComponent(req.url.slice(1)), Buffer.concat(chunks));
    res.writeHead(200).end();
  });
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No Chrome or Edge found; set BROWSER_PATH.');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(url);
await mkdir(outDir, { recursive: true });

for (const fixture of FIXTURES) {
  const info = await page.evaluate(
    async ({ fixture, bars }) => {
      const { width: w, height: h, seconds, audio, type, file } = fixture;
      if (!MediaRecorder.isTypeSupported(type)) throw new Error(`MediaRecorder cannot write ${type}`);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const fps = 30;
      const draw = (frame) => {
        const t = frame / fps;
        ctx.fillStyle = 'rgb(128,128,128)';
        ctx.fillRect(0, 0, w, h);
        const barsHeight = Math.round(h * 0.58);
        const barWidth = w / bars.length;
        bars.forEach(([r, g, b], i) => {
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(Math.round(i * barWidth), 0, Math.ceil(barWidth), barsHeight);
        });
        // Grey ramp: black, 25 %, 50 %, 75 % (sRGB code values).
        const ramp = [0, 64, 128, 192];
        const rampTop = barsHeight;
        const rampHeight = Math.round(h * 0.22);
        ramp.forEach((v, i) => {
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(Math.round((i * w) / ramp.length), rampTop, Math.ceil(w / ramp.length), rampHeight);
        });
        // Bottom band: black with the frame number and a sweeping bar.
        const bandTop = rampTop + rampHeight;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, bandTop, w, h - bandTop);
        const sweep = ((t / seconds) * (w - 24)) | 0;
        ctx.fillStyle = '#fff';
        ctx.fillRect(sweep, bandTop + 4, 24, h - bandTop - 8);
        ctx.font = `bold ${Math.round(Math.min(w, h) * 0.08)}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd200';
        ctx.fillText(`${t.toFixed(2)} s · #${frame}`, w * 0.04, bandTop + (h - bandTop) / 2);
        // Orientation marker in the top-left corner.
        const marker = Math.round(Math.min(w, h) * 0.16);
        ctx.fillStyle = 'rgb(255,128,0)';
        ctx.fillRect(0, 0, marker, marker);
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.round(marker * 0.42)}px sans-serif`;
        ctx.fillText('TL', marker * 0.16, marker * 0.52);
        // Picture edge.
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, w - 4, h - 4);
      };
      draw(0);
      const stream = canvas.captureStream(fps);
      let audioContext = null;
      if (audio) {
        audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        oscillator.frequency.value = 440;
        const gain = audioContext.createGain();
        gain.gain.value = 0.2;
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      }
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start(500);
      const start = performance.now();
      let frame = 0;
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          const due = Math.floor(((performance.now() - start) / 1000) * fps);
          if (due >= seconds * fps) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (due !== frame) {
            frame = due;
            draw(frame);
          }
        }, 1000 / fps / 2);
      });
      recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      await audioContext?.close();
      const blob = new Blob(chunks, { type });
      await fetch(`/${encodeURIComponent(file)}`, { method: 'POST', body: blob });
      return { file, bytes: blob.size };
    },
    { fixture, bars: BARS },
  );
  await writeFile(path.join(outDir, fixture.file), saved.get(fixture.file));
  console.log(`${info.file}: ${info.bytes} bytes`);
}

// Not a video at all: the browser must report an unsupported source, not spin forever.
await writeFile(path.join(outDir, 'not-a-video.mp4'), Buffer.from('This file is plain text, not an MP4 container.\n'.repeat(64)));
// A valid header with the picture data overwritten: playback starts, then the decoder fails.
const valid = saved.get('pattern-16x9.mp4');
const damaged = Buffer.from(valid);
const mdat = damaged.indexOf('mdat');
for (let i = mdat + 4 + Math.floor((damaged.length - mdat) * 0.3); i < damaged.length; i++) damaged[i] = (i * 2654435761) >>> 24;
await writeFile(path.join(outDir, 'damaged-data.mp4'), damaged);
console.log('not-a-video.mp4, damaged-data.mp4 written');

await browser.close();
server.close();
