// Native-resolution drawing for LCD-style themes: anti-aliased TrueType text (like a normal GUI),
// filled/rounded rectangles, lines. No native deps: fonts are parsed by vendor/opentype.js (MIT) and
// rasterised here with 4x4 supersampling (nonzero winding). Rendered text runs are cached as alpha masks.
'use strict';
const fs = require('fs');
const path = require('path');
const opentype = require('./vendor/opentype.js');

const FONT_DIRS = [path.join(__dirname, 'fonts', 'ttf'), '/usr/share/fonts', '/usr/local/share/fonts'];
const fonts = new Map(); // name -> opentype.Font

function findFont(name) {
  if (fonts.has(name)) return fonts.get(name);
  const want = name.toLowerCase().replace(/\s+/g, '');
  const walk = (dir, depth = 0) => {
    let out = null;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) out = out || walk(p, depth + 1);
        else if (/\.(ttf|otf)$/i.test(e.name) && e.name.toLowerCase().replace(/\.(ttf|otf)$/i, '').replace(/[\s_]+/g, '') === want) out = out || p;
      }
    } catch {}
    return out;
  };
  let file = null;
  for (const d of FONT_DIRS) if ((file = walk(d))) break;
  const f = file ? opentype.loadSync(file) : null;
  fonts.set(name, f);
  return f;
}

// ---------------------------------------------------------------- path -> alpha mask
const SS = 4;
function flatten(commands, scale) {
  // returns polylines (closed contours) in supersampled pixel space
  const contours = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const pt = (x, y) => cur.push(x * scale, y * scale);
  for (const c of commands) {
    if (c.type === 'M') { cur = []; contours.push(cur); cx = sx = c.x; cy = sy = c.y; pt(cx, cy); }
    else if (c.type === 'L') { cx = c.x; cy = c.y; pt(cx, cy); }
    else if (c.type === 'Q') {
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
        pt(a * cx + b * c.x1 + d * c.x, a * cy + b * c.y1 + d * c.y);
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'C') {
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pt(u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
      }
      cx = c.x; cy = c.y;
    } else if (c.type === 'Z') { if (cur) pt(sx, sy); cx = sx; cy = sy; }
  }
  return contours;
}

function rasterise(contours, w, h) {
  // w, h in final pixels; contours in supersampled coords (already offset to the mask origin)
  const W = w * SS, H = h * SS;
  const cover = new Uint16Array(w * h);
  const edges = [];
  for (const c of contours) {
    for (let i = 0; i + 3 < c.length; i += 2) {
      const x0 = c[i], y0 = c[i + 1], x1 = c[i + 2], y1 = c[i + 3];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
    }
  }
  const xs = [];
  for (let sy = 0; sy < H; sy++) {
    const y = sy + 0.5;
    xs.length = 0;
    for (const e of edges) {
      if (y < e[1] || y >= e[3]) continue;
      xs.push([e[0] + ((y - e[1]) / (e[3] - e[1])) * (e[2] - e[0]), e[4]]);
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    const row = Math.floor(sy / SS) * w;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (!wind) continue;
      const a = Math.max(0, Math.round(xs[i][0])), b = Math.min(W, Math.round(xs[i + 1][0]));
      for (let sx = a; sx < b; sx++) cover[row + (sx >> 2)]++;
    }
  }
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(255, Math.round((cover[i] * 255) / (SS * SS)));
  return alpha;
}

const maskCache = new Map();
function textMask(fontName, size, str) {
  const key = fontName + '|' + size + '|' + str;
  let m = maskCache.get(key);
  if (m) { maskCache.delete(key); maskCache.set(key, m); return m; } // LRU touch
  const font = findFont(fontName);
  if (!font) return null;
  const p = font.getPath(str, 0, 0, size, { kerning: true });
  const bb = p.getBoundingBox();
  const ox = Math.floor(bb.x1) - 1, oy = Math.floor(bb.y1) - 1;
  const w = Math.max(1, Math.ceil(bb.x2) - ox + 2), h = Math.max(1, Math.ceil(bb.y2) - oy + 2);
  const shifted = p.commands.map((c) => {
    const o = { ...c };
    for (const k of ['x', 'x1', 'x2']) if (k in o) o[k] -= ox;
    for (const k of ['y', 'y1', 'y2']) if (k in o) o[k] -= oy;
    return o;
  });
  m = { w, h, ox, oy, alpha: rasterise(flatten(shifted, SS), w, h), adv: font.getAdvanceWidth(str, size, { kerning: true }) };
  maskCache.set(key, m);
  if (maskCache.size > 600) maskCache.delete(maskCache.keys().next().value);
  return m;
}

// ---------------------------------------------------------------- canvas
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.rgb = new Uint8Array(w * h * 3);
  }
  clear(col) { for (let i = 0; i < this.w * this.h; i++) { this.rgb[i * 3] = col[0]; this.rgb[i * 3 + 1] = col[1]; this.rgb[i * 3 + 2] = col[2]; } }
  blend(x, y, col, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const o = (y * this.w + x) * 3;
    if (a >= 255) { this.rgb[o] = col[0]; this.rgb[o + 1] = col[1]; this.rgb[o + 2] = col[2]; return; }
    const k = a / 255;
    this.rgb[o] += (col[0] - this.rgb[o]) * k; this.rgb[o + 1] += (col[1] - this.rgb[o + 1]) * k; this.rgb[o + 2] += (col[2] - this.rgb[o + 2]) * k;
  }
  rect(x, y, w, h, col) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.blend(xx, yy, col, 255);
  }
  // rounded rectangle with anti-aliased corners (r = radius in px)
  roundRect(x, y, w, h, r, col) {
    r = Math.min(r, h / 2, w / 2);
    for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) {
      for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) {
        const px = xx + 0.5, py = yy + 0.5;
        const dx = Math.max(x + r - px, 0, px - (x + w - r)), dy = Math.max(y + r - py, 0, py - (y + h - r));
        const d = Math.hypot(dx, dy) - r;
        const a = d <= -0.5 ? 255 : d >= 0.5 ? 0 : Math.round((0.5 - d) * 255);
        if (a) this.blend(xx, yy, col, a);
      }
    }
  }
  hline(x0, x1, y, col, thick = 1) { this.rect(x0, y, x1 - x0, thick, col); }
  // "LED screen" filter: the vector image is averaged per pitch×pitch cell and redrawn as round dots
  // (brightness kept, so glyph edges stay smooth like browser-rendered text, just made of LEDs).
  dotScreen(pitch, { bg = [0, 0, 0], off = [16, 10, 4], radius = 0.42 } = {}) {
    const { w, h, rgb } = this;
    const cols = Math.floor(w / pitch), rows = Math.floor(h / pitch);
    const avg = new Float32Array(cols * rows * 3);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let r = 0, g = 0, b = 0;
      for (let y = cy * pitch; y < cy * pitch + pitch; y++) for (let x = cx * pitch; x < cx * pitch + pitch; x++) {
        const o = (y * w + x) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
      }
      const n = pitch * pitch, i = (cy * cols + cx) * 3;
      avg[i] = r / n; avg[i + 1] = g / n; avg[i + 2] = b / n;
    }
    this.clear(bg);
    const rad = pitch * radius, c0 = (pitch - 1) / 2;
    // precomputed anti-aliased dot mask
    const mask = new Float32Array(pitch * pitch);
    for (let y = 0; y < pitch; y++) for (let x = 0; x < pitch; x++) {
      const d = Math.hypot(x - c0, y - c0) - rad;
      mask[y * pitch + x] = d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
    }
    // hot loop (every frame of the UK theme): no allocations, writes straight into rgb over the bg
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const i = (cy * cols + cx) * 3;
      // lit dots take the cell colour (boosted so a half-covered cell still glows), dark ones the "off" tint
      const lum = Math.max(avg[i] - bg[0], avg[i + 1] - bg[1], avg[i + 2] - bg[2]) / 255;
      const k = Math.min(1, lum * 1.6), boost = k > 0 ? 1 / Math.max(lum, 0.35) : 0;
      const r = off[0] + (Math.min(255, avg[i] * boost) - off[0]) * k;
      const g = off[1] + (Math.min(255, avg[i + 1] * boost) - off[1]) * k;
      const b = off[2] + (Math.min(255, avg[i + 2] * boost) - off[2]) * k;
      for (let y = 0; y < pitch; y++) {
        let o = ((cy * pitch + y) * w + cx * pitch) * 3;
        for (let x = 0; x < pitch; x++, o += 3) {
          const a = mask[y * pitch + x];
          if (!a) continue;
          rgb[o] = bg[0] + (r - bg[0]) * a + 0.5; rgb[o + 1] = bg[1] + (g - bg[1]) * a + 0.5; rgb[o + 2] = bg[2] + (b - bg[2]) * a + 0.5;
        }
      }
    }
  }
  measure(str, font, size) {
    const f = findFont(font);
    return f ? f.getAdvanceWidth(String(str), size, { kerning: true }) : String(str).length * size * 0.55;
  }
  // shorten with "…" to fit maxW
  fit(str, font, size, maxW) {
    str = String(str ?? '');
    if (!maxW || this.measure(str, font, size) <= maxW) return str;
    while (str.length > 1 && this.measure(str + '…', font, size) > maxW) str = str.slice(0, -1);
    return str.trimEnd() + '…';
  }
  // y is the BASELINE; align 'left' | 'right' | 'center'; returns the advance width
  text(str, x, y, { font, size, color, align = 'left', maxW = 0 }) {
    str = this.fit(str, font, size, maxW);
    if (!str) return 0;
    const m = textMask(font, size, str);
    if (!m) return 0;
    let x0 = x;
    if (align === 'right') x0 = x - m.adv;
    else if (align === 'center') x0 = x - m.adv / 2;
    const bx = Math.round(x0) + m.ox, by = Math.round(y) + m.oy;
    for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) {
      const a = m.alpha[yy * m.w + xx];
      if (a) this.blend(bx + xx, by + yy, color, a);
    }
    return m.adv;
  }
}

module.exports = { Canvas, findFont, available: () => !!opentype };
