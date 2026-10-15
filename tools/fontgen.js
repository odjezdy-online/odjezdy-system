// Rasterises free (OFL) Google Fonts into LED bitmap faces for the non-BUSE themes.
// The browser does the font rendering (canvas + threshold), this server saves the result.
//
//   node tools/fontgen.js        then open http://localhost:4322 in a browser; it writes app/fonts/<family>.json
//
// Each family gets faces small / normal / big with the same row counts as the BUSE faces use in layouts,
// sized automatically so capitals with háček/čárka and descenders fit.
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'app', 'fonts');

// id -> CSS family, weight, Google Fonts query, [rows small, normal, big]
const FAMILIES = {
  inter: { css: 'Inter', weight: 700, gf: 'Inter:wght@600;700', rows: [11, 15, 22], note: 'DB-like LCD (free stand-in for DB Sans)' },
  sourcesans: { css: 'Source Sans 3', weight: 700, gf: 'Source+Sans+3:wght@600;700', rows: [11, 15, 22], note: 'SBB-like (free stand-in for Frutiger)' },
  barlowc: { css: 'Barlow Condensed', weight: 600, gf: 'Barlow+Condensed:wght@600', rows: [12, 16, 24], note: 'RATP SIEL-like (free stand-in for Parisine)' },
  dotgothic: { css: 'DotGothic16', weight: 400, gf: 'DotGothic16', rows: [12, 16, 22], note: 'Japanese dot-matrix LED' },
};

const PAGE = `<!doctype html><meta charset="utf-8"><title>fontgen</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${Object.values(FAMILIES).map((f) => 'family=' + f.gf).join('&')}&display=block">
<body style="background:#111;color:#ccc;font:14px sans-serif"><pre id="log">rendering…</pre><canvas id="pv"></canvas>
<script>
const FAMILIES = ${JSON.stringify(FAMILIES)};
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') +
  'ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýžÄÖÜäöüßĹĽŔĺľŕÀÂÇÈÊËÎÏÔÙÛàâçèêëîïôùûÅåØøÆæŁłŃńŚśŹźŻżĄąĘęŐőŰű–—…·’„“”€°';
const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
const log = (s) => document.getElementById('log').textContent += '\\n' + s;

function fit(css, weight, rows) {
  // largest px size where accented capitals + descenders fit into rows
  for (let px = rows * 1.6; px > 4; px -= 0.25) {
    x.font = weight + ' ' + px + 'px "' + css + '"';
    const up = x.measureText('ÉŠŽĚŮÁ').actualBoundingBoxAscent;
    const down = x.measureText('gjpqyŞ').actualBoundingBoxDescent;
    if (Math.ceil(up) + Math.ceil(down) <= rows) return { px, base: Math.ceil(up) };
  }
  return { px: rows, base: rows - 2 };
}
// supersampled rasterisation: draw SSx larger, light an LED when >= 45 % of its area is covered
const SS = 4;
function glyph(ch, rows, px, family, weight, base) {
  const font = weight + ' ' + (px * SS) + 'px "' + family + '"';
  x.font = font;
  const w = Math.max(1, Math.ceil(x.measureText(ch).width / SS) + 3);
  c.width = w * SS; c.height = rows * SS; x.font = font;
  x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
  x.fillText(ch, SS, base * SS);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const bits = [];
  for (let y = 0; y < rows; y++) {
    let r = "";
    for (let i = 0; i < w; i++) {
      let sum = 0;
      for (let yy = 0; yy < SS; yy++) for (let xx = 0; xx < SS; xx++) sum += d[((y * SS + yy) * c.width + i * SS + xx) * 4];
      r += sum / (SS * SS * 255) >= 0.45 ? "1" : "0";
    }
    bits.push(r);
  }
  if (ch === " ") return { w: Math.max(2, Math.round(rows / 3.5)), rows: bits.map(() => "") };
  const col = (i) => bits.some((r) => r[i] === "1");
  let l = 0, r = w - 1;
  while (l < w && !col(l)) l++;
  while (r > l && !col(r)) r--;
  if (l > r) return { w: 2, rows: bits.map(() => "") };
  return { w: r - l + 1, rows: bits.map((s) => s.slice(l, r + 1)) };
}
(async () => {
  await document.fonts.ready;
  for (const [id, f] of Object.entries(FAMILIES)) {
    await document.fonts.load(f.weight + ' 16px "' + f.css + '"', 'ÁČŽ');
    const out = { family: f.css, note: f.note, license: 'SIL Open Font License 1.1 (Google Fonts)' };
    ['small', 'normal', 'big'].forEach((size, i) => {
      const rows = f.rows[i];
      const { px, base } = fit(f.css, f.weight, rows);
      const font = f.weight + ' ' + px + 'px "' + f.css + '"';
      const g = {};
      for (const ch of CHARS) {
        const r = glyph(ch, rows, px, f.css, f.weight, base);
        g[ch] = [r.w, r.rows.map((s) => (s && s.includes('1') ? BigInt('0b' + s.padEnd(r.w, '0')).toString(16) : '0'))];
      }
      out[size] = { rows, spacing: 1, px, glyphs: g };
    });
    const r = await fetch('/save?id=' + id, { method: 'POST', body: JSON.stringify(out) });
    log(id + ': ' + (await r.text()));
  }
  log('done');
})();
</script>`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    const id = (url.searchParams.get('id') || '').replace(/[^a-z0-9-]/g, '');
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, id + '.json'), b);
      res.end(`${id}.json ${b.length} B`);
      console.log('saved', id, b.length);
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(4322, () => console.log('fontgen: open http://localhost:4322'));
