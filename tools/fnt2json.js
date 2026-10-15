// Converts the BUSE .fnt panel font used by app.odjezdy.online (/cedulomat/font.fnt,
// format from OMSI BUSE TOOL, parser ported from odjezdy's led-display.js) into app/font.json.
//   node tools/fnt2json.js [font.fnt]   (default: downloads it from app.odjezdy.online)
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'alpine', 'cache', 'font.fnt');
const OUT = path.join(__dirname, '..', 'app', 'font.json');

// Kamenický (CP895) code -> character, as in odjezdy's kamenicky table
const KAMENICKY = {
  'Á': 143, 'Ä': 142, 'Č': 128, 'Ď': 133, 'É': 144, 'Ě': 137, 'Í': 139, 'Ĺ': 138, 'Ľ': 156, 'Ň': 165, 'Ó': 149, 'Ô': 167,
  'Ö': 153, 'Ŕ': 171, 'Ř': 158, 'Š': 155, 'Ú': 151, 'Ů': 166, 'Ü': 154, 'Ý': 157, 'Ž': 146, 'á': 160, 'ä': 132, 'č': 135,
  'ď': 131, 'é': 130, 'ě': 136, 'í': 161, 'ĺ': 141, 'ľ': 140, 'ň': 164, 'ó': 162, 'ô': 147, 'ö': 148, 'ŕ': 170, 'ř': 169,
  'š': 168, 'ť': 159, 'ú': 163, 'ů': 150, 'ü': 129, 'ý': 152, 'ž': 145, 'Ť': 134,
};
const CODE2CH = Object.fromEntries(Object.entries(KAMENICKY).map(([c, n]) => [n, c]));

const bytesYFor = (h) => (h > 24 ? 4 : h > 16 ? 3 : h > 8 ? 2 : 1);
const rev = (v) => { let o = 0; for (let i = 0; i < 8; i++) if (v & (1 << i)) o |= 1 << (7 - i); return o; };

function parse(buf) {
  const faces = {};
  let pos = 0;
  while (pos < buf.length) {
    const id = buf[pos++] - 0xe0;
    if (id < 0 || id > 15 || pos + 2 > buf.length) break;
    const len = buf.readUInt16BE(pos); pos += 2;
    const end = Math.min(pos + len, buf.length);
    const glyphs = new Map();
    while (pos < end) {
      const code = buf[pos++];
      if (pos >= end) break;
      const n = buf[pos++];
      if (n === 0) { glyphs.set(code, null); continue; }
      const height = buf[pos++];
      glyphs.set(code, { height, bytesY: bytesYFor(height), data: buf.subarray(pos, pos + n) });
      pos += n;
    }
    faces[id] = glyphs;
  }
  return faces;
}

function toFont(glyphs, spacing) {
  let rows = 0;
  for (const g of glyphs.values()) if (g && g.height > rows) rows = g.height;
  const out = {};
  for (const [code, g] of glyphs) {
    const ch = code < 128 ? String.fromCharCode(code) : CODE2CH[code];
    if (!ch) continue;
    if (!g) { out[ch] = [Math.max(2, Math.round(rows / 4)), Array(rows).fill('0')]; continue; }
    const w = g.data.length / g.bytesY;
    const grid = Array.from({ length: rows }, () => new Array(w).fill(0));
    for (let j = 0; j < g.data.length; j++) {
      const col = Math.floor(j / g.bytesY), yOff = 8 * (j % g.bytesY), bits = rev(g.data[j]);
      for (let i = 0; i < 8; i++) if (bits & (1 << i) && yOff + i < rows) grid[yOff + i][col] = 1;
    }
    out[ch] = [w, grid.map((r) => (r.includes(1) ? BigInt('0b' + r.join('')).toString(16) : '0'))];
  }
  // space is often missing or zero-width in BUSE faces
  if (!out[' '] || out[' '][0] === 0) out[' '] = [Math.max(2, Math.round(rows / 4)), Array(rows).fill('0')];
  // synthesize '·' (at the height of '-') and '…' (three '.') when the face lacks them
  const dash = out['-'], dot = out['.'];
  if (!out['·'] && dash) {
    const midRows = dash[1].map((h) => h !== '0');
    out['·'] = [2, dash[1].map((h, i) => (midRows[i] ? '3' : '0'))];
  }
  if (!out['…'] && dot) {
    const [w, r] = dot;
    out['…'] = [w * 3 + 2, r.map((h) => {
      if (h === '0') return '0';
      const b = BigInt('0x' + h);
      return ((b << BigInt(2 * w + 2)) | (b << BigInt(w + 1)) | b).toString(16);
    })];
  }
  return { rows, spacing, glyphs: out };
}

const faces = parse(fs.readFileSync(SRC));
const font = {
  small: toFont(faces[1], 1),
  normal: toFont(faces[3], 1),
  big: toFont(faces[5], 1),
  line: toFont(faces[8], 2),
};
fs.writeFileSync(OUT, JSON.stringify(font));
for (const [k, f] of Object.entries(font)) console.log(k, 'rows', f.rows, 'glyphs', Object.keys(f.glyphs).length);
console.log('→', OUT);
