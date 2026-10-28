// node mp4boxes.mjs <file>: prints the top-level box tree (and moov children) of an MP4.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf', 'mfra']);
function walk(start, end, depth, limit = Infinity) {
  let off = start, n = 0;
  while (off < end && n < limit) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); header = 16; }
    if (size === 0) size = end - off;
    let extra = '';
    if (type === 'mvhd' || type === 'mdhd') {
      const v = buf[off + header];
      const ts = v === 1 ? buf.readUInt32BE(off + header + 20) : buf.readUInt32BE(off + header + 12);
      const dur = v === 1 ? Number(buf.readBigUInt64BE(off + header + 24)) : buf.readUInt32BE(off + header + 16);
      extra = ` timescale=${ts} duration=${dur} (${(dur / ts).toFixed(3)} s)`;
    }
    if (type === 'tkhd') {
      const v = buf[off + header];
      const dur = v === 1 ? Number(buf.readBigUInt64BE(off + header + 28)) : buf.readUInt32BE(off + header + 20);
      extra = ` duration=${dur}`;
    }
    if (type === 'hdlr') extra = ` ${buf.toString('latin1', off + header + 8, off + header + 12)}`;
    if (type === 'stsd') extra = ` ${buf.toString('latin1', off + header + 12, off + header + 16)}`;
    if (depth === 0 || CONTAINERS.has(type) || depth < 6) console.log(`${'  '.repeat(depth)}${type} @${off} size=${size}${extra}`);
    if (CONTAINERS.has(type)) walk(off + header, off + size, depth + 1, type === 'moof' ? 3 : Infinity);
    off += size; n++;
  }
}
// Top level: print first 8 and last 4 boxes, count moofs.
let off = 0; const top = [];
while (off < buf.length) { let size = buf.readUInt32BE(off); if (size === 1) size = Number(buf.readBigUInt64BE(off + 8)); if (size === 0) size = buf.length - off; top.push([buf.toString('latin1', off + 4, off + 8), off, size]); off += size; }
console.log('top-level boxes', top.length, 'moof', top.filter((b) => b[0] === 'moof').length);
for (const [type, o, size] of [...top.slice(0, 4), ...top.slice(-3)]) { console.log(type, o, size); if (type === 'moov') walk(o + 8, o + size, 1); }
