// node mp4samples.mjs <file>: per-track sample timing of an MP4/MOV (fragmented or not), as JSON.
// Reads trex/tfhd/tfdt/trun for fragmented files and stts/ctts/stsz/stss for regular ones.
import { readFileSync } from 'node:fs';

export function readSamples(file) {
  const buf = readFileSync(file);
  const boxes = (start, end) => {
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
      out.push({ type, start: off, body: off + header, end: off + size });
      off += size;
    }
    return out;
  };
  const child = (box, type) => boxes(box.body, box.end).find((b) => b.type === type);
  const top = boxes(0, buf.length);
  const moov = top.find((b) => b.type === 'moov');
  const tracks = new Map();
  for (const trak of boxes(moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = child(trak, 'tkhd');
    const v = buf[tkhd.body];
    const id = buf.readUInt32BE(tkhd.body + (v === 1 ? 20 : 12));
    const mdia = child(trak, 'mdia');
    const mdhd = child(mdia, 'mdhd');
    const mv = buf[mdhd.body];
    const timescale = buf.readUInt32BE(mdhd.body + (mv === 1 ? 20 : 12));
    const handler = buf.toString('latin1', child(mdia, 'hdlr').body + 8, child(mdia, 'hdlr').body + 12);
    const stbl = child(child(mdia, 'minf'), 'stbl');
    const track = { id, handler, timescale, samples: [] };
    // Regular sample tables.
    const stts = child(stbl, 'stts');
    if (stts) {
      const n = buf.readUInt32BE(stts.body + 4);
      let t = 0;
      for (let i = 0; i < n; i++) {
        const count = buf.readUInt32BE(stts.body + 8 + i * 8);
        const delta = buf.readUInt32BE(stts.body + 12 + i * 8);
        for (let k = 0; k < count; k++) {
          track.samples.push({ dts: t, duration: delta, cts: 0, sync: true });
          t += delta;
        }
      }
      const ctts = child(stbl, 'ctts');
      if (ctts) {
        const cv = buf[ctts.body];
        const n2 = buf.readUInt32BE(ctts.body + 4);
        let s = 0;
        for (let i = 0; i < n2; i++) {
          const count = buf.readUInt32BE(ctts.body + 8 + i * 8);
          const offset = cv === 1 ? buf.readInt32BE(ctts.body + 12 + i * 8) : buf.readUInt32BE(ctts.body + 12 + i * 8);
          for (let k = 0; k < count; k++) track.samples[s++].cts = offset;
        }
      }
      const stss = child(stbl, 'stss');
      if (stss) {
        for (const sample of track.samples) sample.sync = false;
        const n3 = buf.readUInt32BE(stss.body + 4);
        for (let i = 0; i < n3; i++) {
          const index = buf.readUInt32BE(stss.body + 8 + i * 4) - 1;
          if (track.samples[index]) track.samples[index].sync = true;
        }
      }
    }
    tracks.set(id, track);
  }
  // Fragments.
  const mvex = child(moov, 'mvex');
  const trex = new Map();
  if (mvex) {
    for (const b of boxes(mvex.body, mvex.end).filter((x) => x.type === 'trex')) {
      const id = buf.readUInt32BE(b.body + 4);
      trex.set(id, { duration: buf.readUInt32BE(b.body + 12), size: buf.readUInt32BE(b.body + 16), flags: buf.readUInt32BE(b.body + 20) });
    }
  }
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(traf, 'tfhd');
      const flags = buf.readUInt32BE(tfhd.body) & 0xffffff;
      const id = buf.readUInt32BE(tfhd.body + 4);
      let p = tfhd.body + 8;
      const defaults = { ...trex.get(id) };
      if (flags & 0x1) p += 8;
      if (flags & 0x2) p += 4;
      if (flags & 0x8) (defaults.duration = buf.readUInt32BE(p)), (p += 4);
      if (flags & 0x10) (defaults.size = buf.readUInt32BE(p)), (p += 4);
      if (flags & 0x20) (defaults.flags = buf.readUInt32BE(p)), (p += 4);
      const tfdt = child(traf, 'tfdt');
      let t = tfdt ? (buf[tfdt.body] === 1 ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4)) : 0;
      for (const trun of boxes(traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const version = buf[trun.body];
        const tf = buf.readUInt32BE(trun.body) & 0xffffff;
        const count = buf.readUInt32BE(trun.body + 4);
        let q = trun.body + 8;
        if (tf & 0x1) q += 4;
        let firstFlags = null;
        if (tf & 0x4) (firstFlags = buf.readUInt32BE(q)), (q += 4);
        for (let i = 0; i < count; i++) {
          let duration = defaults.duration;
          let sflags = defaults.flags;
          let cts = 0;
          if (tf & 0x100) (duration = buf.readUInt32BE(q)), (q += 4);
          if (tf & 0x200) q += 4;
          if (tf & 0x400) (sflags = buf.readUInt32BE(q)), (q += 4);
          if (tf & 0x800) (cts = version === 1 ? buf.readInt32BE(q) : buf.readUInt32BE(q)), (q += 4);
          if (i === 0 && firstFlags !== null) sflags = firstFlags;
          tracks.get(id).samples.push({ dts: t, duration, cts, sync: !(sflags & 0x10000) });
          t += duration;
        }
      }
    }
  }
  return [...tracks.values()].map((track) => {
    const pts = track.samples.map((s) => (s.dts + s.cts) / track.timescale).sort((a, b) => a - b);
    const deltas = pts.slice(1).map((v, i) => Math.round((v - pts[i]) * 1000 * 10) / 10);
    const histogram = {};
    for (const d of deltas) histogram[d] = (histogram[d] ?? 0) + 1;
    const end = track.samples.reduce((m, s) => Math.max(m, (s.dts + s.duration) / track.timescale), 0);
    return {
      id: track.id,
      handler: track.handler,
      timescale: track.timescale,
      samples: track.samples.length,
      seconds: Number(end.toFixed(3)),
      firstPts: pts[0],
      sync: track.samples.filter((s) => s.sync).length,
      intervalMsHistogram: track.handler === 'vide' ? histogram : undefined,
      pts: track.handler === 'vide' ? pts : undefined,
    };
  });
}

if (process.argv[1]?.endsWith('mp4samples.mjs') && process.argv[2]) {
  const result = readSamples(process.argv[2]);
  console.log(JSON.stringify(result.map((t) => ({ ...t, pts: t.pts ? `${t.pts.length} values` : undefined })), null, 1));
}
