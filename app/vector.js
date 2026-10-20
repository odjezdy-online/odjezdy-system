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

// ---------------------------------------------------------------- SVG icons
// Minimal SVG support for icons made of <path> elements (M L H V C S Q T Z and arcs, absolute and relative),
// each with its own fill. Enough for flat icon sets such as PID's; no strokes, gradients or transforms.
function arcToCubics(x0, y0, rx, ry, rot, large, sweep, x, y) {
  if (!rx || !ry) return [{ type: 'L', x, y }];
  const phi = (rot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (x0 + x) / 2, cy = sp * cxp + cp * cyp + (y0 + y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI; else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2))), step = dth / n, out = [];
  const t = (4 / 3) * Math.tan(step / 4);
  const pt = (a) => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp];
  const dpt = (a) => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp];
  for (let i = 0; i < n; i++) {
    const a0 = th1 + i * step, a1 = a0 + step, p0 = pt(a0), p1 = pt(a1), d0 = dpt(a0), d1 = dpt(a1);
    out.push({ type: 'C', x1: p0[0] + t * d0[0], y1: p0[1] + t * d0[1], x2: p1[0] - t * d1[0], y2: p1[1] - t * d1[1], x: p1[0], y: p1[1] });
  }
  return out;
}
function parsePathData(d) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const cmds = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '', lastC2 = null;
  const num = () => parseFloat(tok[i++]);
  const isNum = () => i < tok.length && !/^[a-zA-Z]$/.test(tok[i]);
  while (i < tok.length) {
    if (/^[a-zA-Z]$/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { cmds.push({ type: 'Z' }); cx = sx; cy = sy; lastC2 = null; continue; }
    do {
      const ox = rel ? cx : 0, oy = rel ? cy : 0; // relative to the current point of THIS segment (implicit repeats)
      if (C === 'M') { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; cmds.push({ type: 'M', x: cx, y: cy }); cmd = rel ? 'l' : 'L'; lastC2 = null; break; }
      if (C === 'L') { cx = ox + num(); cy = oy + num(); cmds.push({ type: 'L', x: cx, y: cy }); lastC2 = null; }
      else if (C === 'H') { cx = (rel ? cx : 0) + num(); cmds.push({ type: 'L', x: cx, y: cy }); lastC2 = null; }
      else if (C === 'V') { cy = (rel ? cy : 0) + num(); cmds.push({ type: 'L', x: cx, y: cy }); lastC2 = null; }
      else if (C === 'C' || C === 'S') {
        let x1, y1;
        if (C === 'C') { x1 = ox + num(); y1 = oy + num(); } else { x1 = lastC2 ? 2 * cx - lastC2[0] : cx; y1 = lastC2 ? 2 * cy - lastC2[1] : cy; }
        const x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
        cmds.push({ type: 'C', x1, y1, x2, y2, x, y }); lastC2 = [x2, y2]; cx = x; cy = y;
      } else if (C === 'Q') {
        const x1 = ox + num(), y1 = oy + num(), x = ox + num(), y = oy + num();
        cmds.push({ type: 'Q', x1, y1, x, y }); cx = x; cy = y; lastC2 = null;
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), x = ox + num(), y = oy + num();
        cmds.push(...arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)); cx = x; cy = y; lastC2 = null;
      } else { i = tok.length; break; } // unsupported command: stop here
    } while (isNum());
  }
  return cmds;
}
const svgCache = new Map();
function parseSvg(text) {
  let s = svgCache.get(text);
  if (s) return s;
  const vb = (text.match(/viewBox="([^"]+)"/) || [])[1];
  const [vx, vy, vw, vh] = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, 100, 100];
  const paths = [...text.matchAll(/<path\b([^>]*)>/g)].map((m) => {
    const d = (m[1].match(/\bd="([^"]+)"/) || [])[1];
    const fill = (m[1].match(/\bfill="([^"]+)"/) || m[1].match(/fill:\s*([^;"]+)/) || [])[1];
    let rgb = null;
    const h = (fill || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (h) { const x = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1]; rgb = [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16)); }
    return { cmds: d ? parsePathData(d) : [], rgb };
  }).filter((p) => p.cmds.length);
  s = { id: svgCache.size + 1, vx, vy, vw, vh, paths };
  svgCache.set(text, s);
  return s;
}
const svgMasks = new Map();
// alpha mask of one SVG path scaled to w x h pixels (cached)
function svgMask(svg, pi, w, h) {
  const key = svg.id + '|' + pi + '|' + Math.ceil(w) + 'x' + Math.ceil(h);
  let m = svgMasks.get(key);
  if (m) return m;
  const k = Math.min(w / svg.vw, h / svg.vh), ox = (w - svg.vw * k) / 2, oy = (h - svg.vh * k) / 2;
  const tx = (cmd) => {
    const o = { ...cmd };
    for (const f of ['x', 'x1', 'x2']) if (f in o) o[f] = (o[f] - svg.vx) * k + ox;
    for (const f of ['y', 'y1', 'y2']) if (f in o) o[f] = (o[f] - svg.vy) * k + oy;
    return o;
  };
  m = rasterise(flatten(svg.paths[pi].cmds.map(tx), SS), Math.ceil(w), Math.ceil(h));
  svgMasks.set(key, m);
  if (svgMasks.size > 200) svgMasks.delete(svgMasks.keys().next().value);
  return m;
}

// ---------------------------------------------------------------- canvas
const TRAIN = '\uE000';
// train front view, 24x24 (own drawing); the windows and lights are counter-wound holes (nonzero fill)
const TRAIN_SVG = '<svg viewBox="0 0 24 24"><path d="M6 2H18A2 2 0 0 1 20 4V16A3 3 0 0 1 17 19L19.5 22H17.5L15 19H9L6.5 22H4.5L7 19A3 3 0 0 1 4 16V4A2 2 0 0 1 6 2Z M7 5V11H17V5Z M8 14V16H10V14Z M14 14V16H16V14Z"/></svg>';
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.rgb = new Uint8Array(w * h * 3);
  }
  clear(col) { // memset-style: fill the first pixel, then double the filled area with copyWithin
    const rgb = this.rgb, n = rgb.length;
    if (col[0] === col[1] && col[1] === col[2]) { rgb.fill(col[0]); return; }
    rgb[0] = col[0]; rgb[1] = col[1]; rgb[2] = col[2];
    for (let have = 3; have < n; have *= 2) rgb.copyWithin(have, 0, Math.min(have, n - have));
  }
  blend(x, y, col, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const o = (y * this.w + x) * 3;
    if (a >= 255) { this.rgb[o] = col[0]; this.rgb[o + 1] = col[1]; this.rgb[o + 2] = col[2]; return; }
    const k = a / 255;
    this.rgb[o] += (col[0] - this.rgb[o]) * k; this.rgb[o + 1] += (col[1] - this.rgb[o + 1]) * k; this.rgb[o + 2] += (col[2] - this.rgb[o + 2]) * k;
  }
  rect(x, y, w, h, col) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const x0 = Math.max(0, x), x1 = Math.min(this.w, x + w), rgb = this.rgb, r = col[0], g = col[1], b = col[2];
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) { // opaque fill: straight stores, no per-pixel call
      let o = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) { rgb[o++] = r; rgb[o++] = g; rgb[o++] = b; }
    }
  }
  // rounded rectangle with anti-aliased corners (r = radius in px)
  roundRect(x, y, w, h, r, col) {
    r = Math.min(r, h / 2, w / 2);
    const x0 = Math.floor(x), x1 = Math.ceil(x + w), y0 = Math.floor(y), y1 = Math.ceil(y + h);
    const cov = (dx, dy) => { const d = Math.hypot(dx, dy) - r; return d <= -0.5 ? 255 : d >= 0.5 ? 0 : Math.round((0.5 - d) * 255); };
    const midL = Math.ceil(x + r), midR = Math.floor(x + w - r); // columns whose centres lie in the straight band
    for (let yy = y0; yy < y1; yy++) {
      const py = yy + 0.5, dy = Math.max(y + r - py, 0, py - (y + h - r));
      for (let xx = x0; xx < Math.min(x1, midL); xx++) { const a = cov(x + r - (xx + 0.5), dy); if (a) this.blend(xx, yy, col, a); } // left corner / edge
      if (midR > midL) { // straight middle: one coverage value for the whole span
        const a = cov(0, dy);
        if (a >= 255) this.rect(midL, yy, midR - midL, 1, col);
        else if (a) for (let xx = midL; xx < midR; xx++) this.blend(xx, yy, col, a);
      }
      for (let xx = Math.max(midL, midR, x0); xx < x1; xx++) { const a = cov(Math.max(0, (xx + 0.5) - (x + w - r)), dy); if (a) this.blend(xx, yy, col, a); } // right corner / edge
    }
  }
  hline(x0, x1, y, col, thick = 1) { this.rect(x0, y, x1 - x0, thick, col); }
  // "LED screen" filter: the vector image is averaged per pitch×pitch cell and redrawn as round dots
  // (brightness kept, so glyph edges stay smooth like browser-rendered text, just made of LEDs).
  dotScreen(pitch, { bg = [0, 0, 0], off = [16, 10, 4], radius = 0.42, region = null } = {}) {
    const { w, h, rgb } = this;
    // region {x, y, w, h}: only that rectangle becomes LEDs (printed labels around it stay crisp)
    const rx = region ? Math.max(0, Math.round(region.x)) : 0, ry = region ? Math.max(0, Math.round(region.y)) : 0;
    const rw = region ? Math.min(w - rx, Math.round(region.w)) : w, rh = region ? Math.min(h - ry, Math.round(region.h)) : h;
    const cols = Math.floor(rw / pitch), rows = Math.floor(rh / pitch);
    const avg = new Float32Array(cols * rows * 3);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let r = 0, g = 0, b = 0;
      for (let y = cy * pitch; y < cy * pitch + pitch; y++) for (let x = cx * pitch; x < cx * pitch + pitch; x++) {
        const o = ((ry + y) * w + rx + x) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
      }
      const n = pitch * pitch, i = (cy * cols + cx) * 3;
      avg[i] = r / n; avg[i + 1] = g / n; avg[i + 2] = b / n;
    }
    if (region) this.rect(rx, ry, cols * pitch, rows * pitch, bg); else this.clear(bg);
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
        let o = ((ry + cy * pitch + y) * w + rx + cx * pitch) * 3;
        for (let x = 0; x < pitch; x++, o += 3) {
          const a = mask[y * pitch + x];
          if (!a) continue;
          rgb[o] = bg[0] + (r - bg[0]) * a + 0.5; rgb[o + 1] = bg[1] + (g - bg[1]) * a + 0.5; rgb[o + 2] = bg[2] + (b - bg[2]) * a + 0.5;
        }
      }
    }
  }
  // draw an icon made of SVG <path>s into the box (x, y, w, h), fitted and centred; color overrides the paths' own fills
  svg(text, x, y, w, h, { color = null } = {}) {
    const sv = parseSvg(text);
    sv.paths.forEach((p, i) => {
      const col = color || p.rgb || [255, 255, 255], mk = svgMask(sv, i, w, h), mw = Math.ceil(w);
      const bx = Math.round(x), by = Math.round(y);
      for (let yy = 0; yy < Math.ceil(h); yy++) for (let xx = 0; xx < mw; xx++) {
        const a = mk[yy * mw + xx];
        if (a) this.blend(bx + xx, by + yy, col, a);
      }
    });
  }
  measure(str, font, size) {
    if (String(str).includes(TRAIN)) return String(str).split(TRAIN).reduce((w, part, i) => w + (i ? size * 0.95 : 0) + this.measure(part, font, size), 0);
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
  text(str, x, y, { font, size, color, align = 'left', maxW = 0, alpha = 1 }) {
    if (String(str).includes(TRAIN)) { // train symbol among the text: drawn as a vector icon
      const parts = String(str).split(TRAIN), gw = size * 0.95, total = this.measure(str, font, size);
      let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
      parts.forEach((part, i) => {
        if (i) { this.svg(TRAIN_SVG, cx, y - size * 0.8, size * 0.85, size * 0.85, { color }); cx += gw; }
        if (part) cx += this.text(part, cx, y, { font, size, color, alpha });
      });
      return total;
    }
    str = this.fit(str, font, size, maxW);
    if (!str) return 0;
    const m = textMask(font, size, str);
    if (!m) return 0;
    let x0 = x;
    if (align === 'right') x0 = x - m.adv;
    else if (align === 'center') x0 = x - m.adv / 2;
    const bx = Math.round(x0) + m.ox, by = Math.round(y) + m.oy;
    for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) {
      const a = alpha === 1 ? m.alpha[yy * m.w + xx] : m.alpha[yy * m.w + xx] * alpha; // alpha < 1: glow / faded text
      if (a) this.blend(bx + xx, by + yy, color, a);
    }
    return m.adv;
  }
}

// One line of text rendered once into an offscreen strip (for scrollers that move it without re-rendering the theme)
const stripCache = new Map();
function makeStrip(text, font, size, color, bg, h, baseline) {
  const key = [text, font, Math.round(size), color.join(), bg.join(), h, baseline].join('|');
  let st = stripCache.get(key);
  if (st) return st;
  const cv = new Canvas(Math.max(1, Math.ceil(new Canvas(1, 1).measure(text, font, size)) + 4), Math.max(1, Math.ceil(h)));
  cv.clear(bg);
  cv.text(text, 0, baseline, { font, size, color });
  st = { w: cv.w, h: cv.h, rgb: cv.rgb };
  stripCache.set(key, st);
  if (stripCache.size > 20) stripCache.delete(stripCache.keys().next().value);
  return st;
}
// copy a window of the looping strip (offset in px, gap between repeats) into the canvas at x,y of size w x h
function paintStrip(cv, strip, x, y, w, h, offset, gap, bg) {
  gap = Math.round(gap); // integer: a fractional gap gave fractional source indexes and shifted the colour channels
  const total = strip.w + gap, off = ((Math.floor(offset) % total) + total) % total;
  for (let r = 0; r < Math.min(h, strip.h); r++) {
    const dy = y + r;
    if (dy < 0 || dy >= cv.h) continue;
    let o = (dy * cv.w + x) * 3;
    for (let i = 0; i < w; i++, o += 3) {
      const sx = (i + off) % total;
      if (sx < strip.w) { const q = (r * strip.w + sx) * 3; cv.rgb[o] = strip.rgb[q]; cv.rgb[o + 1] = strip.rgb[q + 1]; cv.rgb[o + 2] = strip.rgb[q + 2]; }
      else { cv.rgb[o] = bg[0]; cv.rgb[o + 1] = bg[1]; cv.rgb[o + 2] = bg[2]; }
    }
  }
}

module.exports = { Canvas, makeStrip, paintStrip, findFont, available: () => !!opentype };
