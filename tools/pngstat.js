// Tiny PNG inspector for VM screenshots: counts pixels of a colour class.
//   node tools/pngstat.js shot.png [white|amber]
const fs = require('fs');
const zlib = require('zlib');
const [file, what = 'amber'] = process.argv.slice(2);
const b = fs.readFileSync(file);
const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
let o = 8;
const idat = [];
while (o < b.length) {
  const l = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8);
  if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + l));
  o += 12 + l;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
let n = 0, sx = 0, sy = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * (w * 3 + 1) + 1 + x * 3, r = raw[i], g = raw[i + 1], bl = raw[i + 2];
  const hit = what === 'white' ? r === 255 && g === 255 && bl === 255 : r > 200 && g > 90 && g < 180 && bl < 60;
  if (hit) { n++; sx += x; sy += y; }
}
console.log(JSON.stringify({ w, h, [what]: n, at: n ? [Math.round(sx / n), Math.round(sy / n)] : null }));
