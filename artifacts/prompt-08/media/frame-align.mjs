// node frame-align.mjs <frames.thumbs.json>: monotonic alignment of candidate frames to source
// frames (dynamic programming over a band), then: repeated frames, source frames never shown,
// and the time offset (candidate time − source time of the frame it shows) along the film.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dec = (b64) => Buffer.from(b64, 'base64');
const S = data.source.map(dec);
const C = data.candidate.map(dec);
const diff = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
const FPS = 25;
const sourceTime = (k) => (k + 0.5) / FPS;
// Expected source index for candidate i, allowing any offset in [-1 s, +1 s] (the band).
const BAND = 30;
const n = C.length;
const m = S.length;
const INF = 1e18;
const cost = [];
const back = [];
for (let i = 0; i < n; i++) {
  const centre = Math.round(data.candidateTimes[i] * FPS - 0.5);
  const lo = Math.max(0, centre - BAND);
  const hi = Math.min(m - 1, centre + BAND);
  cost.push(new Map());
  back.push(new Map());
  for (let k = lo; k <= hi; k++) {
    const local = diff(C[i], S[k]);
    if (i === 0) {
      cost[0].set(k, local);
      continue;
    }
    let best = INF;
    let from = -1;
    // From the same source frame (a repeat) or 1–4 frames earlier (normal step or skips).
    for (let j = k - 4; j <= k; j++) {
      const c = cost[i - 1].get(j);
      if (c === undefined) continue;
      // A small penalty for repeats and skips, so ties in still shots resolve to normal steps.
      const penalty = j === k - 1 ? 0 : 0.05;
      if (c + penalty < best) (best = c + penalty), (from = j);
    }
    if (from >= 0) {
      cost[i].set(k, best + local);
      back[i].set(k, from);
    }
  }
}
let k = [...cost[n - 1].entries()].sort((a, b) => a[1] - b[1])[0][0];
const path = new Array(n);
for (let i = n - 1; i >= 0; i--) {
  path[i] = k;
  if (i > 0) k = back[i].get(k);
}
// Source frames that look the same as the next one (stills): a repeat or skip there is invisible.
const STILL = 0.35;
const sourceStill = S.map((s, k) => k + 1 < m && diff(s, S[k + 1]) < STILL);
let repeats = 0;
let visibleRepeats = 0;
const repeatAt = [];
let skipped = 0;
let visibleSkips = 0;
const skipAt = [];
for (let i = 1; i < n; i++) {
  const step = path[i] - path[i - 1];
  if (step === 0) {
    repeats++;
    if (!sourceStill[path[i]]) (visibleRepeats++, repeatAt.push(Number(data.candidateTimes[i].toFixed(2))));
  } else if (step > 1) {
    for (let s = path[i - 1] + 1; s < path[i]; s++) {
      skipped++;
      if (!sourceStill[s] && !sourceStill[s - 1]) (visibleSkips++, skipAt.push(Number(sourceTime(s).toFixed(2))));
    }
  }
}
const offsets = path.map((k, i) => data.candidateTimes[i] - sourceTime(k));
const segment = (from, to) => {
  const list = offsets.filter((_, i) => data.candidateTimes[i] >= from && data.candidateTimes[i] < to).sort((a, b) => a - b);
  return list.length ? Number(list[Math.floor(list.length / 2)].toFixed(3)) : null;
};
const matchDiff = path.map((k, i) => diff(C[i], S[k]));
console.log(
  JSON.stringify(
    {
      sourceFrames: m,
      candidateFrames: n,
      sourceStillPairs: sourceStill.filter(Boolean).length,
      meanMatchDiff: Number((matchDiff.reduce((a, b) => a + b, 0) / n).toFixed(2)),
      worstMatchDiff: Number(Math.max(...matchDiff).toFixed(2)),
      repeats,
      visibleRepeats,
      repeatAt: repeatAt.slice(0, 30),
      sourceFramesSkipped: skipped,
      visibleSkips,
      skipAt: skipAt.slice(0, 30),
      firstSourceFrameShown: path[0],
      lastSourceFrameShown: path[n - 1],
      medianOffsetSeconds: {
        '0-1s': segment(0, 1),
        '1-5s': segment(1, 5),
        '5-15s': segment(5, 15),
        '15-25s': segment(15, 25),
        '25-33s': segment(25, 34),
      },
    },
    null,
    1,
  ),
);
