// node frame-compare.mjs <source.mov> <candidate.mp4> [out.json]
// Decodes every frame of both files in Chrome (seeking to the middle of each frame's display
// interval, from the container's own timestamps), keeps a 64x36 grey thumbnail of each, then
// matches each candidate frame to the source frame it shows:
// - duplicated: two consecutive candidate frames show the same source frame (while the source moved);
// - missing: a source frame no candidate frame shows (and it differs from its neighbours);
// - static source runs (identical source frames) are reported separately, they are not defects.
import { chromium } from 'file:///E:/Phong_Nho_IT/3d-cinema/node_modules/playwright-core/index.mjs';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { readSamples } from './mp4samples.mjs';

const [sourceFile, candidateFile, outFile] = process.argv.slice(2);
const W = 64;
const H = 36;

function frameTimes(file, cfrFallback) {
  const video = readSamples(file).find((t) => t.handler === 'vide');
  if (cfrFallback) {
    // Source: constant rate (stts all equal); use sample index times.
    return Array.from({ length: video.samples }, (_, i) => (i + 0.5) / cfrFallback);
  }
  const pts = video.pts;
  return pts.map((t, i) => (i + 1 < pts.length ? (t + pts[i + 1]) / 2 : t + 0.02));
}

const files = { '/source': sourceFile, '/candidate': candidateFile };
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><body></body>');
    return;
  }
  const file = files[req.url];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  const type = file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
    createReadStream(file).pipe(res);
  }
});
await new Promise((resolve) => server.listen(5377, resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function thumbnails(url, times) {
  // A fresh page per file; frames in batches so no single evaluation runs for minutes.
  const page = await browser.newPage();
  await page.goto('http://localhost:5377/');
  await page.evaluate(async (src) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = src;
    document.body.append(video);
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error(`cannot load ${src}`));
    });
    window.__video = video;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    window.__context = canvas.getContext('2d', { willReadFrequently: true });
  }, url);
  const thumbs = [];
  for (let i = 0; i < times.length; i += 50) {
    const batch = await page.evaluate(async (list) => {
      const video = window.__video;
      const context = window.__context;
      const out = [];
      for (const t of list) {
        await new Promise((resolve) => {
          video.addEventListener('seeked', resolve, { once: true });
          video.currentTime = t;
        });
        context.drawImage(video, 0, 0, 64, 36);
        const data = context.getImageData(0, 0, 64, 36).data;
        let text = '';
        for (let k = 0; k < 64 * 36; k++) text += String.fromCharCode(Math.round(0.299 * data[k * 4] + 0.587 * data[k * 4 + 1] + 0.114 * data[k * 4 + 2]));
        out.push(btoa(text));
      }
      return out;
    }, times.slice(i, i + 50));
    for (const b64 of batch) thumbs.push([...Buffer.from(b64, 'base64')]);
  }
  const info = await page.evaluate(() => ({ duration: window.__video.duration, width: window.__video.videoWidth, height: window.__video.videoHeight }));
  await page.close();
  return { thumbs, ...info };
}

const sourceTimes = frameTimes(sourceFile, 25);
const candidateTimes = frameTimes(candidateFile, null);
const source = await thumbnails('/source', sourceTimes);
const candidate = await thumbnails('/candidate', candidateTimes);
if (outFile) writeFileSync(outFile.replace(/\.json$/, '.thumbs.json'), JSON.stringify({ sourceTimes, candidateTimes, source: source.thumbs.map((t) => Buffer.from(t).toString('base64')), candidate: candidate.thumbs.map((t) => Buffer.from(t).toString('base64')) }));
await browser.close();
server.close();

const diff = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
// Neighbouring source frames that are visually the same (still shots, black, title cards).
const STATIC = 0.6;
const sourceStill = source.thumbs.map((t, i) => (i > 0 ? diff(t, source.thumbs[i - 1]) < STATIC : false));
// Each candidate frame → best source frame, searching near the expected position (time-based).
const matches = candidate.thumbs.map((thumb, i) => {
  const expected = Math.round(candidateTimes[i] * 25 - 0.5);
  let best = -1;
  let bestDiff = Infinity;
  for (let k = Math.max(0, expected - 12); k <= Math.min(source.thumbs.length - 1, expected + 12); k++) {
    const d = diff(thumb, source.thumbs[k]);
    if (d < bestDiff) {
      bestDiff = d;
      best = k;
    }
  }
  return { index: best, diff: Number(bestDiff.toFixed(2)) };
});
// Resolve ties in still runs: a match inside a run of identical source frames counts as the run.
const runStart = [];
for (let k = 0; k < source.thumbs.length; k++) runStart[k] = sourceStill[k] ? runStart[k - 1] : k;
let duplicated = 0;
let duplicatedInMotion = 0;
for (let i = 1; i < matches.length; i++) {
  if (runStart[matches[i].index] === runStart[matches[i - 1].index]) {
    duplicated++;
    if (runStart[matches[i].index] === matches[i].index && !sourceStill[matches[i].index + 1]) duplicatedInMotion++;
  }
}
const shown = new Set(matches.map((m) => runStart[m.index]));
const missing = [];
for (let k = 0; k < source.thumbs.length; k++) if (runStart[k] === k && !shown.has(k)) missing.push(k);
const sourceStillFrames = sourceStill.filter(Boolean).length;
const result = {
  source: { file: sourceFile, frames: source.thumbs.length, fps: 25, stillFramesIdenticalToPrevious: sourceStillFrames, duration: source.duration },
  candidate: { file: candidateFile, frames: candidate.thumbs.length, duration: candidate.duration },
  matching: {
    meanDiff: Number((matches.reduce((s, m) => s + m.diff, 0) / matches.length).toFixed(2)),
    worstDiff: Math.max(...matches.map((m) => m.diff)),
    consecutiveSameSourceFrame: duplicated,
    duplicatedWhileSourceMoves: duplicatedInMotion,
    sourceFramesNeverShown: missing.length,
    missingAt: missing.slice(0, 40),
  },
};
console.log(JSON.stringify(result, null, 1));
if (outFile) writeFileSync(outFile, `${JSON.stringify({ ...result, matches }, null, 1)}\n`);
