// Rewrites a fragmented MP4 (as Chrome's MediaRecorder writes it: moov without sample tables,
// then moof/mdat pairs, no duration anywhere) as a regular "fast start" MP4: one moov with the
// full sample tables and the duration, before one mdat. The coded video and audio samples are
// copied byte for byte (no decoding, no re-encoding); timestamps, durations and keyframes come
// from the fragments. Browsers then know the duration and where every sample is from the first
// bytes, instead of reading through the file to find them.
//
//   node scripts/remux-mp4.mjs <in.mp4> <out.mp4>
//
// Prints per-track sample counts and the SHA-256 of each track's sample bytes in and out (they
// must match). Handles what MediaRecorder writes (one trun per traf, default-base-is-moof or an
// explicit base offset, 32-bit offsets); refuses anything else rather than guess.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/remux-mp4.mjs <in.mp4> <out.mp4>');
  process.exit(2);
}
const buf = readFileSync(input);

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf', 'udta']);

function parse(start, end) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    }
    if (size === 0) size = end - off;
    if (size < header || off + size > end) throw new Error(`bad box ${type} at ${off}`);
    const box = { type, start: off, body: off + header, end: off + size };
    if (CONTAINERS.has(type)) box.children = parse(box.body, box.end);
    out.push(box);
    off += size;
  }
  return out;
}
const find = (list, type) => list.find((b) => b.type === type);

const top = parse(0, buf.length);
const ftyp = find(top, 'ftyp');
const moov = find(top, 'moov');
if (!ftyp || !moov) throw new Error('not an MP4 (ftyp/moov missing)');
const mvex = find(moov.children, 'mvex');
if (!mvex) throw new Error('not fragmented (no mvex): nothing to do');

// Track defaults.
const trex = new Map();
for (const b of mvex.children.filter((x) => x.type === 'trex')) {
  trex.set(buf.readUInt32BE(b.body + 4), {
    duration: buf.readUInt32BE(b.body + 12),
    size: buf.readUInt32BE(b.body + 16),
    flags: buf.readUInt32BE(b.body + 20),
  });
}
const trackId = (trak) => {
  const tkhd = find(trak.children, 'tkhd');
  return buf.readUInt32BE(tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12));
};
const traks = moov.children.filter((b) => b.type === 'trak');
const tracks = new Map(traks.map((trak) => [trackId(trak), { trak, samples: [], chunks: [], nextDts: null, adjusted: [] }]));

// Samples from the fragments, in file order; each trun is one contiguous run of data (a chunk).
const order = [];
for (const moof of top.filter((b) => b.type === 'moof')) {
  for (const traf of moof.children.filter((b) => b.type === 'traf')) {
    const tfhd = find(traf.children, 'tfhd');
    const flags = buf.readUInt32BE(tfhd.body) & 0xffffff;
    const id = buf.readUInt32BE(tfhd.body + 4);
    const track = tracks.get(id);
    if (!track) throw new Error(`fragment for unknown track ${id}`);
    let p = tfhd.body + 8;
    const defaults = { ...trex.get(id) };
    let base = moof.start;
    if (flags & 0x1) {
      base = Number(buf.readBigUInt64BE(p));
      p += 8;
    } else if (!(flags & 0x20000) && moof.children.filter((b) => b.type === 'traf').length > 1) {
      throw new Error('several trafs without default-base-is-moof: not supported');
    }
    if (flags & 0x2) p += 4;
    if (flags & 0x8) (defaults.duration = buf.readUInt32BE(p)), (p += 4);
    if (flags & 0x10) (defaults.size = buf.readUInt32BE(p)), (p += 4);
    if (flags & 0x20) (defaults.flags = buf.readUInt32BE(p)), (p += 4);
    const tfdt = find(traf.children, 'tfdt');
    let dts = tfdt ? (buf[tfdt.body] === 1 ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4)) : (track.nextDts ?? 0);
    // A fragment may start a little after (or before) where the previous one ended. Sample tables
    // have no gaps, so the previous sample lasts that much longer (or shorter): every sample keeps
    // the decode time its fragment gave it, and the tracks stay in sync.
    if (track.nextDts !== null && dts !== track.nextDts) {
      const last = track.samples.at(-1);
      if (last.duration + dts - track.nextDts <= 0) throw new Error(`track ${id}: fragments overlap by more than a sample (${track.nextDts} → ${dts})`);
      last.duration += dts - track.nextDts;
      track.adjusted.push(dts - track.nextDts);
    }
    const truns = traf.children.filter((b) => b.type === 'trun');
    if (truns.length !== 1) throw new Error(`track ${id}: ${truns.length} truns in one traf: not supported`);
    const trun = truns[0];
    const version = buf[trun.body];
    const tf = buf.readUInt32BE(trun.body) & 0xffffff;
    const count = buf.readUInt32BE(trun.body + 4);
    let q = trun.body + 8;
    let offset = base;
    if (tf & 0x1) (offset = base + buf.readInt32BE(q)), (q += 4);
    let firstFlags = null;
    if (tf & 0x4) (firstFlags = buf.readUInt32BE(q)), (q += 4);
    const chunk = { source: offset, size: 0, samples: count, track: id };
    for (let i = 0; i < count; i++) {
      let duration = defaults.duration;
      let size = defaults.size;
      let sflags = defaults.flags;
      let cts = 0;
      if (tf & 0x100) (duration = buf.readUInt32BE(q)), (q += 4);
      if (tf & 0x200) (size = buf.readUInt32BE(q)), (q += 4);
      if (tf & 0x400) (sflags = buf.readUInt32BE(q)), (q += 4);
      if (tf & 0x800) (cts = version === 1 ? buf.readInt32BE(q) : buf.readUInt32BE(q)), (q += 4);
      if (i === 0 && firstFlags !== null) sflags = firstFlags;
      track.samples.push({ offset, size, duration, cts, sync: !(sflags & 0x10000) });
      offset += size;
      chunk.size += size;
      dts += duration;
    }
    if (chunk.source + chunk.size > buf.length) throw new Error(`track ${id}: sample data past the end of the file`);
    track.nextDts = dts;
    track.chunks.push(chunk);
    order.push(chunk);
  }
}

// ---------------------------------------------------------------- writing
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
};
const i32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};
const fullBox = (type, version, flags, ...parts) => box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const raw = (b) => buf.subarray(b.start, b.end);
const runLength = (values) => {
  const runs = [];
  for (const v of values) {
    if (runs.length && runs.at(-1)[1] === v) runs.at(-1)[0]++;
    else runs.push([1, v]);
  }
  return runs;
};

const mvhd = find(moov.children, 'mvhd');
const movieScale = buf.readUInt32BE(mvhd.body + (buf[mvhd.body] === 1 ? 20 : 12));

function sampleTables(track, chunkOffsets) {
  const stsd = find(find(find(find(track.trak.children, 'mdia').children, 'minf').children, 'stbl').children, 'stsd');
  const s = track.samples;
  const stts = runLength(s.map((x) => x.duration));
  const parts = [raw(stsd), fullBox('stts', 0, 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)]))];
  if (s.some((x) => x.cts !== 0)) {
    const negative = s.some((x) => x.cts < 0);
    const ctts = runLength(s.map((x) => x.cts));
    parts.push(fullBox('ctts', negative ? 1 : 0, 0, u32(ctts.length), ...ctts.flatMap(([n, c]) => [u32(n), negative ? i32(c) : u32(c)])));
  }
  if (!s.every((x) => x.sync)) {
    const sync = s.map((x, i) => (x.sync ? i + 1 : 0)).filter(Boolean);
    parts.push(fullBox('stss', 0, 0, u32(sync.length), ...sync.map(u32)));
  }
  const stsc = [];
  track.chunks.forEach((chunk, i) => {
    if (!stsc.length || stsc.at(-1)[1] !== chunk.samples) stsc.push([i + 1, chunk.samples]);
  });
  parts.push(fullBox('stsc', 0, 0, u32(stsc.length), ...stsc.flatMap(([first, n]) => [u32(first), u32(n), u32(1)])));
  parts.push(fullBox('stsz', 0, 0, u32(0), u32(s.length), ...s.map((x) => u32(x.size))));
  parts.push(fullBox('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(u32)));
  return box('stbl', ...parts);
}

/** A copy of `b` with its duration field set (mvhd, tkhd, mdhd; versions 0 and 1). */
function withDuration(b, duration) {
  const copy = Buffer.from(raw(b));
  const v = copy[b.body - b.start];
  const at = b.body - b.start + { mvhd: v === 1 ? 24 : 16, mdhd: v === 1 ? 24 : 16, tkhd: v === 1 ? 28 : 20 }[b.type];
  if (v === 1) copy.writeBigUInt64BE(BigInt(duration), at);
  else copy.writeUInt32BE(duration, at);
  return copy;
}

function buildMoov(offsets) {
  let movieDuration = 0;
  const trakBoxes = [];
  for (const [id, track] of tracks) {
    const mdia = find(track.trak.children, 'mdia');
    const mdhd = find(mdia.children, 'mdhd');
    const scale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12));
    const mediaDuration = track.samples.reduce((sum, x) => sum + x.duration, 0);
    const trackDuration = Math.round((mediaDuration * movieScale) / scale);
    movieDuration = Math.max(movieDuration, trackDuration);
    const minf = find(mdia.children, 'minf');
    const minfParts = minf.children.map((b) => (b.type === 'stbl' ? sampleTables(track, offsets.get(id)) : raw(b)));
    const mdiaParts = mdia.children.map((b) => (b.type === 'mdhd' ? withDuration(b, mediaDuration) : b.type === 'minf' ? box('minf', ...minfParts) : raw(b)));
    const trakParts = track.trak.children.map((b) => (b.type === 'tkhd' ? withDuration(b, trackDuration) : b.type === 'mdia' ? box('mdia', ...mdiaParts) : raw(b)));
    trakBoxes.push(box('trak', ...trakParts));
  }
  const parts = moov.children
    .filter((b) => b.type !== 'mvex')
    .map((b) => (b.type === 'mvhd' ? withDuration(b, movieDuration) : b.type === 'trak' ? null : raw(b)))
    .filter(Boolean);
  return { moov: box('moov', parts[0], ...trakBoxes, ...parts.slice(1)), movieDuration };
}

// Pass 1 sizes the moov (offsets do not change its size); pass 2 writes the real offsets.
const zero = new Map([...tracks].map(([id, t]) => [id, t.chunks.map(() => 0)]));
const ftypBytes = raw(ftyp);
const first = buildMoov(zero);
const mdatSize = order.reduce((sum, c) => sum + c.size, 0);
let cursor = ftypBytes.length + first.moov.length + 8;
for (const chunk of order) {
  chunk.target = cursor;
  cursor += chunk.size;
}
if (cursor > 0xffffffff) throw new Error('output over 4 GiB: would need co64');
const offsets = new Map([...tracks].map(([id, t]) => [id, t.chunks.map((c) => c.target)]));
const { moov: moovBytes, movieDuration } = buildMoov(offsets);
const mdatHeader = Buffer.concat([u32(mdatSize + 8), Buffer.from('mdat', 'latin1')]);
const out = Buffer.concat([ftypBytes, moovBytes, mdatHeader, ...order.map((c) => buf.subarray(c.source, c.source + c.size))]);
writeFileSync(output, out);

// The coded samples must be the same bytes, in the same order, per track.
const digest = (data, samples) => {
  const hash = createHash('sha256');
  for (const s of samples) hash.update(data.subarray(s.offset, s.offset + s.size));
  return hash.digest('hex');
};
let ok = true;
for (const [id, track] of tracks) {
  let k = 0;
  const outSamples = [];
  for (const chunk of track.chunks) {
    let at = chunk.target;
    for (let i = 0; i < chunk.samples; i++) {
      const size = track.samples[k++].size;
      outSamples.push({ offset: at, size });
      at += size;
    }
  }
  const before = digest(buf, track.samples);
  const after = digest(out, outSamples);
  ok &&= before === after;
  const handler = find(find(track.trak.children, 'mdia').children, 'hdlr');
  const mdhd = find(find(track.trak.children, 'mdia').children, 'mdhd');
  const scale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12));
  const joins = track.adjusted.length ? `, ${track.adjusted.length} fragment joins evened out (${track.adjusted.map((d) => `${((d / scale) * 1000).toFixed(1)} ms`).join(', ')})` : '';
  console.log(`track ${id} (${buf.toString('latin1', handler.body + 8, handler.body + 12)}): ${track.samples.length} samples, ${track.chunks.length} chunks, keyframes ${track.samples.filter((s) => s.sync).length}${joins}, sample bytes sha256 ${before.slice(0, 16)}… → ${after.slice(0, 16)}… ${before === after ? 'identical' : 'DIFFERENT'}`);
}
console.log(`duration ${(movieDuration / movieScale).toFixed(3)} s; ${buf.length} → ${out.length} bytes; moov ${moovBytes.length} bytes at the start`);
if (!ok) {
  console.error('sample data changed: output is wrong');
  process.exit(1);
}
