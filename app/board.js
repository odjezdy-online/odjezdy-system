#!/usr/bin/env node
// Odjezdy OS — departure board that draws LED dots straight into the Linux framebuffer.
// No X, no browser: data from app.odjezdy.online -> LED matrix -> /dev/fb0.
//
//   node board.js                 run on the framebuffer (needs /dev/fb0)
//   node board.js --png out.png   render one frame to a PNG (for testing on any OS)
//
// Keys (on the console): S/Enter = choose stop, Esc = back, 1-9 = favourite slots, Q = quit to shell.

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const updater = require('./updater');

// An accepted update lives in /var/lib/odjezdy/app; if it is newer than this copy, run that one instead.
if (!process.argv.includes('--png') && !process.env.ODJEZDY_NO_UPDATE) {
  const alt = updater.pick(__dirname, (s) => { try { fs.appendFileSync('/tmp/odjezdy.log', `[${new Date().toISOString()}] ${s}\n`); } catch {} });
  if (alt) { require(path.join(alt, 'board.js')); return; }
}
const APP_VERSION = updater.versionOf(__dirname);

const API = process.env.ODJEZDY_API || 'https://app.odjezdy.online';
// Worldwide GTFS/GTFS-RT via Transitous (MOTIS 2). Open-source & non-commercial use only; requires a
// User-Agent with contact and visible attribution to https://transitous.org/sources/ (shown in the status line).
const TRANSITOUS = process.env.ODJEZDY_TRANSITOUS || 'https://api.transitous.org';
const USER_AGENT = `OdjezdyOS/${APP_VERSION} (+https://github.com/odjezdy-online/odjezdy-system)`;
const APP_DIR = __dirname;
const CONFIG_FILE = process.env.ODJEZDY_CONFIG || '/etc/odjezdy/config.json';
const args = process.argv.slice(2);
const PNG_OUT = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;

// ---------------------------------------------------------------- fonts
// BUSE panel faces (small/normal/big/line) + extra families in app/fonts/<id>.json (tools/fontgen.js),
// registered as "<id>-small", "<id>-normal", "<id>-big". A theme picks a family with `fonts: '<id>'`.
const FONTS = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'font.json'), 'utf8'));
try {
  for (const f of fs.readdirSync(path.join(APP_DIR, 'fonts')).filter((n) => n.endsWith('.json'))) {
    const fam = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'fonts', f), 'utf8'));
    for (const size of ['small', 'normal', 'big']) if (fam[size]) FONTS[`${f.replace(/\.json$/, '')}-${size}`] = fam[size];
  }
} catch {}
for (const f of Object.values(FONTS)) {
  for (const [ch, [w, rows]] of Object.entries(f.glyphs)) {
    f.glyphs[ch] = { w, bits: rows.map((h) => (h === '0' ? 0n : BigInt('0x' + h))) };
  }
}
const FONT_FAMILIES = [...new Set(Object.keys(FONTS).filter((k) => /-(small|normal|big)$/.test(k)).map((k) => k.replace(/-(small|normal|big)$/, '')))];
const FONT_NAMES = {};
try { for (const id of FONT_FAMILIES) FONT_NAMES[id] = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'fonts', id + '.json'), 'utf8')).family; } catch {}
// face lookup honouring the current theme's font family ('line' always stays BUSE)
let faceFamily = null;
function face(size) {
  // a theme sets `fonts: 'inter'` (all sizes) or per size `fonts: { normal: 'dotgothic', big: 'dotgothic' }`
  const fam = faceFamily && typeof faceFamily === 'object' ? faceFamily[size] : faceFamily;
  return (fam && size !== 'line' && FONTS[`${fam}-${size}`]) || FONTS[size] || FONTS.normal;
}
// what themes see as api.FONTS: same keys, resolved through the theme family
const FONT_VIEW = new Proxy({}, { get: (_, k) => face(String(k)) });
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
// characters the BUSE faces lack (international data from Transitous, typographic dashes/quotes);
// '?' itself is a pictogram in BUSE, so unknown characters fall back to a space-ish dot instead
const TRANSLIT = {
  '–': '-', '—': '-', '‐': '-', '’': "'", '‘': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '«': '"', '»': '"', '›': '>', '‹': '<',
  'ø': 'o', 'Ø': 'O', 'æ': 'e', 'Æ': 'E', 'œ': 'o', 'Œ': 'O', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ß': 's',
  '×': 'x', '•': '·', '→': '>', '←': '<', '…': '…',
};
function glyphOf(font, ch) {
  return font.glyphs[ch] || font.glyphs[TRANSLIT[ch]] || font.glyphs[stripAccents(ch)] || font.glyphs['.'] || font.glyphs['?'];
}
function textWidth(str, size) {
  const f = face(size);
  let w = 0;
  for (const ch of str) w += glyphOf(f, ch).w + f.spacing;
  return Math.max(0, w - f.spacing);
}
function fitText(str, size, maxW) {
  if (textWidth(str, size) <= maxW) return str;
  let s = str;
  while (s.length > 1 && textWidth(s + '…', size) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

// ---------------------------------------------------------------- LED matrix
const COLORS = {
  amber: [255, 136, 0], dim: [110, 52, 0], red: [254, 30, 20], green: [1, 230, 60], white: [255, 240, 220], blue: [1, 208, 255],
};
class Matrix {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.buf = new Uint8Array(cols * rows); }
  clear() { this.buf.fill(0); }
  set(x, y, c = 1) { if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.buf[y * this.cols + x] = c; }
  hline(x0, x1, y, c = 2) { for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  text(str, x, y, size = 'normal', c = 1, clipX0 = 0, clipX1 = this.cols - 1) {
    const f = face(size);
    for (const ch of str) {
      const g = glyphOf(f, ch);
      if (x > clipX1) break;
      for (let yy = 0; yy < f.rows; yy++) {
        const row = g.bits[yy];
        if (!row) continue;
        for (let xx = 0; xx < g.w; xx++) {
          if ((row >> BigInt(g.w - 1 - xx)) & 1n) {
            const px = x + xx;
            if (px >= clipX0 && px <= clipX1) this.set(px, y + yy, c);
          }
        }
      }
      x += g.w + f.spacing;
    }
    return x;
  }
  textRight(str, right, y, size, c) { return this.text(str, right - textWidth(str, size) + 1, y, size, c); }
  textCenter(str, y, size, c) { return this.text(str, Math.floor((this.cols - textWidth(str, size)) / 2), y, size, c); }
}
// colour slots; each theme maps them to real colours (themes/*.js)
const C = { AMBER: 1, DIM: 2, RED: 3, GREEN: 4, WHITE: 5, BLUE: 6, YELLOW: 7, ORANGE: 8, GREY: 9, ACCENT: 10 };
const DEFAULT_COLORS = {
  1: COLORS.amber, 2: COLORS.dim, 3: COLORS.red, 4: COLORS.green, 5: COLORS.white, 6: COLORS.blue,
  7: [255, 214, 0], 8: [255, 110, 0], 9: [120, 120, 120], 10: [196, 18, 48],
};

// ---------------------------------------------------------------- themes (panel styles)
// built-in themes, then system-wide and per-user ones (same id = override). See docs/THEMES.md.
const THEME_DIRS = [
  path.join(APP_DIR, 'themes'),
  '/etc/odjezdy/themes',
  path.join(os.homedir(), '.config', 'odjezdy', 'themes'),
];
// themes outside app/ can still `require('./_util')`
{
  const Module = require('module');
  const resolve = Module._resolveFilename;
  const util = path.join(APP_DIR, 'themes', '_util.js');
  Module._resolveFilename = function (req, parent, ...rest) {
    if (req === './_util' && parent?.filename && path.dirname(parent.filename) !== path.dirname(util)) return util;
    return resolve.call(this, req, parent, ...rest);
  };
}
const THEMES = [];
for (const dir of THEME_DIRS) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => n.endsWith('.js') && !n.startsWith('_')).sort(); } catch { continue; }
  for (const f of files) {
    try {
      const th = require(path.join(dir, f));
      if (!th.id || typeof th.render !== 'function') throw new Error('missing id or render()');
      th.palette = [null];
      for (let i = 1; i <= 10; i++) th.palette[i] = (th.colors && th.colors[i]) || DEFAULT_COLORS[i];
      th.background ||= [0, 0, 0];
      th.unlit ||= th.background;
      const i = THEMES.findIndex((x) => x.id === th.id);
      if (i >= 0) THEMES[i] = th; else THEMES.push(th);
    } catch (e) { console.error(`theme ${path.join(dir, f)}: ${e.message}`); }
  }
}
// BUSE first, the rest alphabetically
THEMES.sort((a, b) => (a.id === 'buse' ? -1 : b.id === 'buse' ? 1 : a.name.localeCompare(b.name)));
// user customisation on top of the theme (settings screen): LED colour, dot style, brightness
const LED_TINTS = {
  amber: [255, 136, 0], green: [1, 255, 1], blue: [1, 208, 255], red: [254, 20, 10], white: [255, 255, 255], yellow: [255, 214, 0],
};
const TINT_NAMES = { theme: 'podle vzhledu', amber: 'jantarová', green: 'zelená', blue: 'modrá', red: 'červená', white: 'bílá', yellow: 'žlutá' };
let lookCache = { key: null };
function currentLook() {
  const th = currentTheme();
  const c = state.cfg?.custom || {};
  const key = [th.id, c.tint, c.style, c.brightness].join('|');
  if (lookCache.key === key) return lookCache;
  const k = (c.brightness ?? 100) / 100;
  const dim = (rgb) => rgb && rgb.map((v) => Math.round(v * k));
  const palette = th.palette.map((p, i) => {
    if (!p) return p;
    if (c.tint && c.tint !== 'theme' && (i === 1 || i === 2)) {
      const t = LED_TINTS[c.tint] || p;
      return dim(i === 2 ? t.map((v) => Math.round(v * 0.43)) : t);
    }
    return dim(p);
  });
  lookCache = {
    key, theme: th, palette,
    style: c.style && c.style !== 'theme' ? c.style : th.style,
    background: th.background,
    unlit: dim(th.unlit),
  };
  return lookCache;
}

function currentTheme() {
  return THEMES.find((th) => th.id === state.cfg?.theme) || THEMES[0];
}

// ---------------------------------------------------------------- native (vector) rendering for LCD themes
let vector = null;
try { vector = require('./vector.js'); } catch (e) { log('vector renderer unavailable: ' + e.message); }

// ---------------------------------------------------------------- mouse pointer (evdev)
// 12x19 arrow: '#' white, '.' black outline, ' ' transparent
const CURSOR = [
  '.           ', '..          ', '.#.         ', '.##.        ', '.###.       ', '.####.      ', '.#####.     ',
  '.######.    ', '.#######.   ', '.########.  ', '.#########. ', '.######.....', '.###.##.    ', '.##. .##.   ',
  '.#.  .##.   ', '..    .##.  ', '.     .##.  ', '       ..   ', '            ',
];
const pointer = { x: 0, y: 0, visible: false, last: 0, enabled: true };
const hits = []; // clickable rows registered by the menus each frame: { x0, y0, x1, y1, hover, click }

function startMouse() {
  // Only pointing devices (mice, tablets, touchscreens): /proc/bus/input/devices lists a "mouseN"
  // handler for them. Keyboards stay on the TTY.
  let devs = [];
  try {
    devs = fs.readFileSync('/proc/bus/input/devices', 'utf8').split(/\n\s*\n/)
      .filter((b) => /H: Handlers=.*\bmouse\d/.test(b) || /N: Name=.*touch/i.test(b))
      .map((b) => (b.match(/\b(event\d+)\b/) || [])[1]).filter(Boolean);
  } catch { return; }
  // Non-blocking reads polled from a timer: a blocking read per device would occupy one of the
  // 4 libuv threadpool threads forever, starving DNS lookups (getaddrinfo) and other fs work.
  const buf = Buffer.alloc(24 * 64);
  for (const n of devs) {
    let fd;
    try { fd = fs.openSync('/dev/input/' + n, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); } catch (e) { log(`input ${n}: ${e.code}`); continue; }
    log(`input ${n}: listening`);
    const absMax = { x: 32767, y: 32767 };
    setInterval(() => {
      for (;;) {
        let len;
        try { len = fs.readSync(fd, buf, 0, buf.length, null); } catch (e) { if (e.code !== 'EAGAIN') log(`input ${n}: ${e.code}`); return; }
        if (!len) return;
        for (let o = 0; o + 24 <= len; o += 24) {
          onInput(buf.readUInt16LE(o + 16), buf.readUInt16LE(o + 18), buf.readInt32LE(o + 20), absMax);
        }
      }
    }, 15);
  }
}

function onInput(type, code, value, absMax) {
  if (!pointer.enabled || !screen) return;
  const EV_KEY = 1, EV_REL = 2, EV_ABS = 3;
  if (type === EV_REL && (code === 0 || code === 1)) {
    if (code === 0) pointer.x = Math.max(0, Math.min(screen.w - 1, pointer.x + value * 1.5));
    else pointer.y = Math.max(0, Math.min(screen.h - 1, pointer.y + value * 1.5));
    moved();
  } else if (type === EV_REL && code === 8) { // wheel
    onKey(value > 0 ? '\u001b[A' : '\u001b[B');
  } else if (type === EV_ABS && (code === 0 || code === 1)) { // tablets / QEMU usb-tablet / touch
    const axis = code === 0 ? 'x' : 'y';
    if (value > absMax[axis]) absMax[axis] = value > 32767 ? 65535 : value;
    pointer[axis] = (value / absMax[axis]) * (axis === 'x' ? screen.w : screen.h);
    moved();
  } else if (type === EV_KEY && value === 1 && (code === 0x110 || code === 0x14a)) { // BTN_LEFT / BTN_TOUCH
    pointer.visible = true; pointer.last = Date.now();
    click();
  } else if (type === EV_KEY && value === 1 && code === 0x111) { // BTN_RIGHT = back
    onKey('\u001b');
  }
}

function moved() {
  pointer.visible = true;
  pointer.last = Date.now();
  const h = hitAt();
  if (h?.hover) h.hover();
}
function hitAt() {
  if (!screen) return null;
  const mx = (pointer.x - screen.offX) / screen.pitch, my = (pointer.y - screen.offY) / screen.pitch;
  return hits.find((h) => mx >= h.x0 && mx <= h.x1 && my >= h.y0 && my <= h.y1) || null;
}
function click() {
  const h = hitAt();
  if (h) h.click();
  else if (state.mode === 'board') openStart(false);
}

// ---------------------------------------------------------------- output: framebuffer or PNG
function fbInfo() {
  const base = '/sys/class/graphics/fb0';
  const [w, h] = fs.readFileSync(`${base}/virtual_size`, 'utf8').trim().split(',').map(Number);
  const bpp = Number(fs.readFileSync(`${base}/bits_per_pixel`, 'utf8').trim());
  let stride = w * (bpp / 8);
  try { stride = Number(fs.readFileSync(`${base}/stride`, 'utf8').trim()) || stride; } catch {}
  return { w, h, bpp, stride };
}

class Screen {
  constructor() {
    if (PNG_OUT) {
      this.w = Number(process.env.W) || 1280; this.h = Number(process.env.H) || 720; this.bpp = 32; this.stride = this.w * 4; this.fd = null;
    } else {
      const i = fbInfo();
      Object.assign(this, i);
      this.fd = fs.openSync('/dev/fb0', 'r+');
      fbSig = fbSignature(); // what we opened, so a later driver swap is noticed (checkFb)
    }
    // ~256 LED columns regardless of resolution
    this.pitch = Math.max(3, Math.floor(this.w / 256));
    this.dot = Math.max(2, this.pitch - 1);
    this.cols = Math.floor(this.w / this.pitch);
    this.rows = Math.floor(this.h / this.pitch);
    this.offX = Math.floor((this.w - this.cols * this.pitch) / 2);
    this.offY = Math.floor((this.h - this.rows * this.pitch) / 2);
    this.frame = Buffer.alloc(this.stride * this.h);
    this.prev = null;
    this.frames = 0;
  }
  // paint matrix into the pixel buffer; dark "unlit" dots are drawn very faintly like a real panel
  draw(m) {
    // full repaint every ~2 s in case kernel/console text was printed over the framebuffer;
    // every frame during the first ~5 s (boot messages, fbcon handover)
    if (++this.frames % 30 === 0 || this.frames < 75) this.prev = null;
    const th = currentLook();
    if (th !== this.look) { this.look = th; this.prev = null; this.frame.fill(0); }
    const { frame, stride, pitch, offX, offY, bpp } = this;
    // LED: round-ish dots with dark gaps; LCD: solid cells without gaps (DB/SBB-style screens)
    const dot = th.style === 'lcd' ? pitch : this.dot;
    const bytes = bpp / 8;
    const bg = th.background, unlit = th.unlit, pal = th.palette;
    const put = (o, col) => {
      if (bytes === 4) { frame[o] = col[2]; frame[o + 1] = col[1]; frame[o + 2] = col[0]; frame[o + 3] = 255; }
      else if (bytes === 2) frame.writeUInt16LE(((col[0] >> 3) << 11) | ((col[1] >> 2) << 5) | (col[2] >> 3), o);
      else if (bytes === 3) { frame[o] = col[2]; frame[o + 1] = col[1]; frame[o + 2] = col[0]; }
    };
    if (!this.prev) { // fresh frame: whole screen in the theme background (gaps between dots, margins)
      for (let o = 0; o + bytes <= frame.length; o += bytes) put(o, bg);
    }
    for (let y = 0; y < m.rows; y++) {
      for (let x = 0; x < m.cols; x++) {
        const v = m.buf[y * m.cols + x];
        if (this.prev && this.prev[y * m.cols + x] === v) continue;
        const col = v ? pal[v] || pal[1] : unlit;
        const px0 = offX + x * pitch, py0 = offY + y * pitch;
        for (let dy = 0; dy < dot; dy++) {
          let o = (py0 + dy) * stride + px0 * bytes;
          for (let dx = 0; dx < dot; dx++, o += bytes) put(o, col);
        }
      }
    }
    this.prev = Uint8Array.from(m.buf);
    const under = pointer.visible ? this.drawCursor(put, bytes) : null;
    if (this.fd !== null && ownVtActive(true)) fs.writeSync(this.fd, frame, 0, frame.length, 0); // re-check right before writing: after Alt+F2 fbcon has just redrawn tty2
    if (under) { under.data.copy(frame, 0, 0, 0); this.restoreCursor(under, bytes); }
  }
  // native mode: copy an RGB canvas (vector theme) into the framebuffer format
  drawCanvas(cv) {
    const { frame, stride, bpp } = this;
    const bytes = bpp / 8, rgb = cv.rgb;
    for (let y = 0; y < this.h; y++) {
      let o = y * stride, i = y * this.w * 3;
      for (let x = 0; x < this.w; x++, o += bytes, i += 3) {
        if (bytes === 4) { frame[o] = rgb[i + 2]; frame[o + 1] = rgb[i + 1]; frame[o + 2] = rgb[i]; frame[o + 3] = 255; }
        else if (bytes === 2) frame.writeUInt16LE(((rgb[i] >> 3) << 11) | ((rgb[i + 1] >> 2) << 5) | (rgb[i + 2] >> 3), o);
        else { frame[o] = rgb[i + 2]; frame[o + 1] = rgb[i + 1]; frame[o + 2] = rgb[i]; }
      }
    }
    this.prev = null; // the LED path must repaint everything next time
    this.look = null;
    const put = (o, col) => { frame[o] = col[2]; frame[o + 1] = col[1]; frame[o + 2] = col[0]; if (bytes === 4) frame[o + 3] = 255; };
    const under = pointer.visible ? this.drawCursor(put, bytes) : null;
    if (this.fd !== null && ownVtActive(true)) fs.writeSync(this.fd, frame, 0, frame.length, 0); // re-check right before writing: after Alt+F2 fbcon has just redrawn tty2
    if (under) this.restoreCursor(under, bytes);
  }
  // arrow sprite drawn on top of the frame, the pixels below are restored after the write
  drawCursor(put, bytes) {
    const scale = Math.max(1, Math.round(this.w / 900)); // 2x from ~1280 px wide
    const W = CURSOR[0].length * scale, H = CURSOR.length * scale;
    const x0 = Math.round(pointer.x), y0 = Math.round(pointer.y);
    const saved = [];
    for (let y = 0; y < H; y++) {
      const py = y0 + y;
      if (py < 0 || py >= this.h) continue;
      const row = CURSOR[Math.floor(y / scale)];
      for (let x = 0; x < W; x++) {
        const px = x0 + x, ch = row[Math.floor(x / scale)];
        if (px < 0 || px >= this.w || ch === ' ') continue;
        const o = py * this.stride + px * bytes;
        saved.push([o, Buffer.from(this.frame.subarray(o, o + bytes))]);
        put(o, ch === '#' ? [255, 255, 255] : [0, 0, 0]);
      }
    }
    return { data: Buffer.alloc(0), saved };
  }
  restoreCursor(under) {
    for (const [o, b] of under.saved) b.copy(this.frame, o);
  }
  savePng(file) {
    const bytes = this.bpp / 8;
    const under = pointer.visible
      ? this.drawCursor((o, col) => { this.frame[o] = col[2]; this.frame[o + 1] = col[1]; this.frame[o + 2] = col[0]; }, bytes)
      : null;
    this.encodePng(file);
    if (under) this.restoreCursor(under);
  }
  encodePng(file) {
    const { w, h, frame } = this;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const s = y * this.stride + x * 4, d = y * (w * 3 + 1) + 1 + x * 3;
        raw[d] = frame[s + 2]; raw[d + 1] = frame[s + 1]; raw[d + 2] = frame[s];
      }
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  }
}

// ---------------------------------------------------------------- stop index (bundled)
const norm = (s) => stripAccents(s).toLowerCase().replace(/\./g, '').replace(/[,()/-]+/g, ' ').replace(/\s+/g, ' ').trim();
const ABBR = [[/hl\.\s*n(ádr)?\./gi, 'hlavní nádraží '], [/žel\.\s*st\./gi, 'železniční stanice '], [/aut\.\s*st\./gi, 'autobusové stanoviště '],
  [/nádr\./gi, 'nádraží '], [/rozc\./gi, 'rozcestí '], [/nám\./gi, 'náměstí '], [/sídl\./gi, 'sídliště '], [/n\.\s*L\./g, 'nad Labem ']];
let STOPS = null;
function loadStops() {
  if (STOPS) return STOPS;
  try {
    STOPS = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(APP_DIR, 'stops.json.gz'))).toString('utf8'));
    for (const s of STOPS) { const n = norm(s.name), nx = norm(ABBR.reduce((t, [re, r]) => t.replace(re, r), s.name)); s.n = nx === n ? n : n + ' | ' + nx; }
  } catch (e) { STOPS = []; log('stop index missing: ' + e.message); }
  return STOPS;
}
function searchStops(q, limit = 6) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const words = nq.split(' ');
  const out = [];
  for (const s of loadStops()) {
    if (!words.every((w) => s.n.includes(w))) continue;
    let score = (s.n === nq ? 100 : 0) + (s.n.startsWith(nq) ? 50 : 0) + Math.min(s.ids.length, 8) - s.n.length / 20;
    out.push([score, s]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

// ---------------------------------------------------------------- config
const pickStop = (s) => ({ name: s.name, ids: s.ids, city: s.city, ...(s.source ? { source: s.source, country: s.country } : {}) });
// "Hlavní nádraží" exists in many towns -> show the town unless the name already says it
function stopLabel(s) {
  if (!s) return '';
  if (s.source === 'transitous') return s.city && !s.name.includes(s.city) ? `${s.name} (${s.city})` : s.name;
  const dupes = loadStops().filter((x) => x.name === s.name).length;
  return dupes > 1 && s.city && !norm(s.name).includes(norm(s.city).split(' ')[0]) ? `${s.name} (${s.city})` : s.name;
}
// boot-menu presets: [exact stop name, town]
const PRESETS = [
  ['Florenc', 'Praha'], ['Hlavní nádraží', 'Praha'], ['Anděl', 'Praha'], ['Náměstí Republiky', 'Praha'],
  ['Hlavní nádraží', 'Brno'], ['Hlavní nádraží', 'Olomouc'], ['Hlavní nádraží', 'Pardubice'],
  ['Plzeň hl.n.', null], ['Ústí nad Labem,,hl.nádr.', null],
];
function presetStops() {
  const out = [];
  for (const [name, city] of PRESETS) {
    const hit = loadStops().filter((s) => s.name === name && (!city || s.city === city)).sort((a, b) => b.ids.length - a.ids.length)[0];
    if (hit) out.push(pickStop(hit));
  }
  return out;
}

const DEFAULT_CONFIG = { stop: { name: 'Florenc', ids: [] }, favorites: [], brightness: 1 };
function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  for (const f of [path.join(APP_DIR, 'config.json'), CONFIG_FILE]) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch {}
  }
  // kernel cmdline override: odjezdy.stop=Hlavni_nadrazi
  try {
    const m = fs.readFileSync('/proc/cmdline', 'utf8').match(/odjezdy\.stop=(\S+)/);
    if (m) { cfg.stop = { name: decodeURIComponent(m[1]).replace(/_/g, ' '), ids: [] }; cfg.forced = true; }
    const th = fs.readFileSync('/proc/cmdline', 'utf8').match(/odjezdy\.theme=(\S+)/);
    if (th) cfg.theme = th[1];
  } catch {}
  if (!cfg.stop.ids?.length) {
    const hit = searchStops(cfg.stop.name, 1)[0];
    if (hit) cfg.stop = pickStop(hit);
  }
  return cfg;
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    // persist across reboots when Alpine lbu has somewhere to save to
    require('child_process').exec('command -v lbu >/dev/null && lbu commit 2>/dev/null');
  } catch (e) { log('save config failed: ' + e.message); }
}

// ---------------------------------------------------------------- data
const state = {
  cfg: null, deps: [], alerts: [], lastOk: 0, error: null, net: 'čekám na síť', ip: null,
  mode: 'board', query: '', results: [], sel: 0, msg: null, msgUntil: 0,
};
function log(s) { try { fs.appendFileSync('/tmp/odjezdy.log', `[${new Date().toISOString()}] ${s}\n`); } catch {} }

async function getJson(p, timeout = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const url = /^https?:/.test(p) ? p : API + p;
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const depTime = (d) => new Date(d.expectedTime || d.plannedTime).getTime();
// MOTIS mode -> our vehicle types
const MOTIS_TYPE = {
  TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro', BUS: 'bus', COACH: 'bus', TROLLEYBUS: 'trolleybus', FERRY: 'ferry',
  RAIL: 'train', REGIONAL_RAIL: 'train', REGIONAL_FAST_RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train', SUBURBAN: 'train', FUNICULAR: 'funicular', AERIAL_LIFT: 'cablecar',
};
const isTransitous = () => state.cfg.stop?.source === 'transitous';

// Offline mode: the last good board is kept on disk, so after a reboot without network (or an API outage)
// the board still shows the timetable it last knew; past departures drop off on their own (upcoming()).
const CACHE_FILE = process.env.ODJEZDY_CACHE || (PNG_OUT ? null : '/var/lib/odjezdy/board-cache.json');
const CACHE_MAX_AGE = 12 * 3600 * 1000;
const cacheKey = () => `${state.cfg.stop.source || 'odjezdy'}:${(state.cfg.stop.ids || []).join(',')}`;
let cacheSavedAt = 0;
function saveCache() {
  if (!CACHE_FILE || Date.now() - cacheSavedAt < 120000) return; // at most every 2 min (SD cards)
  cacheSavedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ key: cacheKey(), lastOk: state.lastOk, deps: state.deps.slice(0, 80), alerts: state.alerts }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) { log('cache save: ' + e.message); }
}
function loadCache() {
  if (!CACHE_FILE) return false;
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (c.key !== cacheKey() || !(Date.now() - c.lastOk < CACHE_MAX_AGE)) return false;
    state.deps = c.deps || []; state.alerts = c.alerts || []; state.lastOk = c.lastOk; state.fromCache = true;
    log(`offline cache: ${state.deps.length} departures from ${new Date(c.lastOk).toISOString()}`);
    return true;
  } catch { return false; }
}

async function refreshTransitous(id = state.cfg.stop.ids[0], radius = 0) {
  const j = await getJson(`${TRANSITOUS}/api/v1/stoptimes?stopId=${encodeURIComponent(id)}&n=60${radius ? '&radius=' + radius : ''}`);
  const now = Date.now(), alerts = new Map(), byLine = new Map();
  const text = (a) => (a.headerText || a.descriptionText || '').replace(/\s+/g, ' ').trim();
  state.deps = (j.stopTimes || []).map((x) => {
    const p = x.place || {};
    const planned = p.scheduledDeparture || p.departure, expected = p.departure || planned;
    // route "U28 (Os 28018)" -> line "U28", train "Os 28018"
    const route = String(x.routeShortName || x.displayName || '');
    const line = route.replace(/\s*\(.*\)\s*$/, '') || route;
    let train = x.tripShortName && x.tripShortName !== line ? x.tripShortName : '';
    if (/^\d+$/.test(train)) train = `${line} ${Number(train)}`.trim(); // "000384" + "RJ" -> "RJ 384"
    const notes = [...(p.alerts || []), ...(x.alerts || [])].map(text).filter(Boolean);
    for (const n of notes) { alerts.set(n, true); if (!byLine.has(line)) byLine.set(line, n); }
    return {
      line, train, destination: x.headsign || '', platform: p.track || p.scheduledTrack || '',
      plannedTime: planned, expectedTime: expected,
      delayMinutes: x.realTime ? Math.round((new Date(expected) - new Date(planned)) / 60000) : null,
      type: MOTIS_TYPE[x.mode] || 'bus', provider: x.agencyName || '', cancelled: !!(x.cancelled || p.cancelled),
      source: 'transitous',
    };
  }).filter((d) => depTime(d) >= now - 60000).sort((a, b) => depTime(a) - depTime(b));
  state.alerts = [...alerts.keys()].slice(0, 6);
  state.lineAlerts = byLine;
  state.lastOk = now;
  state.error = null;
  state.fromCache = false;
  saveCache();
}

// odjezdy.online /api/v2: all platforms of a stop in one request (stopIds=a,b,…, merged and deduped by
// the server, alerts included). Older servers without it fall back to one /api/board/:id call per id.
let apiV2 = null, apiV2At = 0;
async function hasApiV2() {
  if (apiV2 === null || Date.now() - apiV2At > 3600000) {
    try { apiV2 = (await getJson('/api/v2/health', 8000)).apiVersion >= 2; }
    catch (e) { if (!/^HTTP /.test(e.message)) throw e; apiV2 = false; } // network down: decide next time
    apiV2At = Date.now();
    log('odjezdy.online api v2: ' + apiV2);
  }
  return apiV2;
}
async function fetchBoardRows(ids) {
  if (await hasApiV2()) {
    try {
      const j = await getJson(`/api/v2/departures?stopIds=${ids.map(encodeURIComponent).join(',')}&limit=120`);
      const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
      state.v2Alerts = (j.alerts || []).map((a) => clean(a.title)).filter(Boolean);
      return j.data || [];
    } catch (e) {
      if (!/^HTTP (404|400)/.test(e.message)) throw e;
      apiV2 = false; apiV2At = Date.now(); // endpoint gone or rejects the ids: use the old API
    }
  }
  state.v2Alerts = [];
  const res = await Promise.allSettled(ids.map((id) => getJson('/api/board/' + encodeURIComponent(id))));
  const ok = res.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason;
  return ok.flatMap((r) => r.value.data || []);
}

// Fallback when odjezdy.online is down: the same stop on Transitous (Czech PID/JDF/ČD feeds are there too),
// found by name near the stop's coordinates from the local index. Remembered per stop for this run.
const transitousIds = new Map();
async function transitousStopFor(stop) {
  const key = stop.ids?.[0];
  if (!key) return null;
  if (transitousIds.has(key)) return transitousIds.get(key);
  const s = loadStops().find((x) => x.ids.includes(key));
  if (!s?.lat) return null;
  const text = s.name.replace(/,+/g, ' ').replace(/\s+/g, ' ').trim();
  const j = await getJson(`${TRANSITOUS}/api/v1/geocode?text=${encodeURIComponent(text)}&type=STOP&place=${s.lat},${s.lng}`, 15000);
  const km = (x) => Math.hypot((x.lat - s.lat) * 111.2, (x.lon - s.lng) * 111.2 * Math.cos((s.lat * Math.PI) / 180));
  const hit = (j || []).find((x) => km(x) < 0.6); // best text match that is really this place
  transitousIds.set(key, hit?.id || null);
  log(`transitous fallback stop for ${s.name}: ${hit ? hit.id + ' ' + hit.name : 'none'}`);
  return hit?.id || null;
}

async function refreshBoard() {
  if (isTransitous()) return refreshTransitous();
  const ids = state.cfg.stop.ids.slice(0, 8);
  if (!ids.length) return;
  let rows;
  try { rows = await fetchBoardRows(ids); }
  catch (e) {
    if (state.cfg.custom?.fallback === false) throw e;
    const tid = await transitousStopFor(state.cfg.stop).catch(() => null);
    if (!tid) throw e;
    try { await refreshTransitous(tid, 100); } catch { throw e; } // both down: report the primary error
    state.fallback = e.name === 'AbortError' ? 'časový limit' : (e.cause?.code || e.message);
    return;
  }
  state.fallback = null;
  const now = Date.now(), seen = new Set(), all = [];
  for (const d of rows) {
    if (!d.expectedTime) d.expectedTime = d.plannedTime;
    if (depTime(d) < now - 60000) continue;
    // richer fields from the odjezdy.online rewrite backend (absent on the old API -> no change)
    if (d.terminatesHere) continue; // the train ends here: an arrival, not a departure
    if (d.trainNumber && !d.train) d.train = `${d.category || d.line || ''} ${d.trainNumber}`.trim();
    if (d.destinationConfident === false) d.destination = ''; // "Neznámá stanice" placeholder: better blank
    d.via = Array.isArray(d.viaStops) ? d.viaStops : [];
    const k = `${d.line}|${d.destination}|${d.plannedTime}`;
    if (seen.has(k)) continue;
    seen.add(k); all.push(d);
  }
  all.sort((a, b) => depTime(a) - depTime(b));
  state.deps = all;
  if (state.v2Alerts?.length) state.alerts = [...new Set([...state.alerts, ...state.v2Alerts])].slice(0, 6);
  state.lastOk = now;
  state.error = null;
  state.fromCache = false;
  saveCache();
}
async function refreshAlerts() {
  if (isTransitous()) return; // alerts arrive together with the stop times
  const list = await getJson('/api/alerts');
  const name = norm(state.cfg.stop.name);
  const lines = new Set(state.deps.map((d) => String(d.line)));
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  // stop-level notices -> footer marquee
  state.alerts = list.filter((a) =>
    (a.stops || []).some((s) => norm(s) === name || name.includes(norm(s))) ||
    (a.provider === 'PID' && (a.lines || []).some((l) => lines.has(String(l))))
  ).map((a) => clean(a.title));
  state.alerts = [...new Set([...state.alerts, ...(state.v2Alerts || [])])].slice(0, 6); // + alerts from /api/v2
  // line-level notices -> second (small-font) row under that departure.
  // Matched via a.lines, or by the line being named in the title — only for codes like "X12"
  // (letter+digit), plain numbers/letters would give false hits ("nástupiště B", "do 18. 10.").
  const providers = new Set(state.deps.map((d) => d.provider));
  const byLine = new Map();
  for (const a of list) {
    if (!providers.has(a.provider)) continue;
    const now = Date.now();
    if (a.validFrom && new Date(a.validFrom).getTime() > now) continue;
    if (a.validTo && new Date(a.validTo).getTime() < now) continue;
    for (const l of lines) {
      const named = /[A-Z]/i.test(l) && /\d/.test(l) && new RegExp(`(^|[^\\w])${l.replace(/[^\w]/g, '')}([^\\w]|$)`).test(a.title);
      if (!byLine.has(l) && ((a.lines || []).map(String).includes(l) || named)) byLine.set(l, alertNotice(a));
    }
  }
  state.lineAlerts = byLine;
}

// What a line alert says on the board: "<kind>: <text>". The kind comes from the alert type (a DÚK
// "Omezení provozu" is not a "výluka"); the text is the server's short summary when it has one, else the
// title, and when the title is cut ("…"/"...") its place and the description's first sentences.
function alertKind(a) {
  const t = String(a.type || '').toLowerCase();
  if (/výluk/.test(t)) return 'výluka';
  if (/náhradní/.test(t)) return 'náhradní doprava';
  if (/odklon|přetras/.test(t)) return 'odklon';
  if (/omezení|zrušen/.test(t)) return 'omezení';
  const txt = `${a.title || ''} ${a.description || ''}`.toLowerCase(); // untyped alert: guess from its text
  if (/výluk/.test(txt)) return 'výluka';
  if (/odklon|objížď|přetras/.test(txt)) return 'odklon';
  if (/omezen|zrušen|neobsluh/.test(txt)) return 'omezení';
  return 'upozornění';
}
function alertNotice(a) {
  const clean = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  const kind = alertKind(a);
  if (a.summary) return { kind, text: clean(a.summary) };
  let title = clean(a.title);
  const cut = /(\.\.\.|…)$/.test(title);
  title = title.replace(/\s*(\.\.\.|…)$/, '');
  let text = title;
  if ((cut || title.length < 60) && a.description) { // cut or terse title ("Telnice - Rallye Miriquidi"): add the why
    // first two sentences of the description, at most ~220 characters
    const sentences = clean(a.description).match(/[^.!?]+[.!?]+(\s|$)/g) || [clean(a.description)];
    let d = '';
    for (const x of sentences) { if ((d + x).length > 220 && d) break; d += x; }
    text = `${title} – ${d.trim()}`;
  }
  return { kind, text };
}

// second-row notice under the destination (BUSE "zastávka" row, face 1): disruption / replacement service
const hasDelay = (d) => Number.isFinite(d.delayMinutes) && d.delayMinutes !== 0;
const delayLabel = (d) => `${d.delayMinutes > 0 ? '+' : '-'}${Math.abs(d.delayMinutes)} min`;
const delayColor = (d) => (d.delayMinutes >= 5 ? C.RED : d.delayMinutes < 0 ? C.GREEN : C.AMBER);

function depNotice(d) {
  const parts = [];
  let color = C.AMBER;
  if (d.cancelled) { parts.push('spoj odpadá'); color = C.RED; }
  const alert = state.lineAlerts?.get(String(d.line));
  if (alert) parts.push(typeof alert === 'string' ? 'upozornění: ' + alert : `${alert.kind}: ${alert.text}`);
  else if (d.provider === 'PID' && /^X/i.test(String(d.line))) parts.push('náhradní doprava');
  return parts.length ? { text: parts.join(' · '), color } : null;
}

// every glyph present in that face (no accent-stripping / '?' fallback)
const faceCovers = (size, str) => [...str].every((ch) => face(size).glyphs[ch]);

function localIp() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

// ---------------------------------------------------------------- rendering
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// layout metrics come from the BUSE font (normal/small 10 rows, big 19 rows)
function layout(m) {
  const big = face('big').rows, nor = face('normal').rows, sm = face('small').rows;
  const headerLine = big + 2;
  const colHead = headerLine + 2;
  const top = colHead + sm + 3;
  const rowH = nor + 2;
  const footerH = nor + 4;
  const nRows = Math.max(1, Math.floor((m.rows - top - footerH - 1) / rowH));
  return { big, nor, sm, headerLine, colHead, top, rowH, footerH, nRows };
}

// LCD themes with renderNative() draw at full resolution with anti-aliased TrueType text
let nativeCanvas = null, lastNative = 0;
function renderNativeBoard(t) {
  const th = currentTheme();
  if (!vector || typeof th.renderNative !== 'function' || state.cfg.custom?.style === 'led') return false;
  if (state.cfg.custom?.font && state.cfg.custom.font !== 'theme') return false; // user forced an LED font
  // 5 fps is plenty for a static board (clock seconds, marquee); the cursor still moves at tick rate
  if (Date.now() - lastNative < 180 && !pointer.visible) return true;
  lastNative = Date.now();
  if (!nativeCanvas || nativeCanvas.w !== screen.w || nativeCanvas.h !== screen.h) nativeCanvas = new vector.Canvas(screen.w, screen.h);
  try {
    th.renderNative(nativeCanvas, t, themeApi);
    if (state.cfg.custom?.disruptions !== false) nativeDisruption(nativeCanvas, t, th);
    if (state.toast && Date.now() < state.toast.until) {
      const c = nativeCanvas, s = c.h / 720, w = c.measure(state.toast.text, 'FiraSans-Bold', 28 * s) + 60 * s;
      c.roundRect((c.w - w) / 2, c.h / 2 - 32 * s, w, 64 * s, 10 * s, [255, 255, 255]);
      c.text(state.toast.text, c.w / 2, c.h / 2 + 10 * s, { font: 'FiraSans-Bold', size: 28 * s, color: [20, 20, 40], align: 'center' });
    }
  } catch (e) { log('native render: ' + e.stack); return false; }
  screen.drawCanvas(nativeCanvas);
  return true;
}
function nativeDisruption(c, t, th) {
  const list = currentDisruptions();
  if (!list.length) return;
  const PERIOD = 40000, SHOW = 9000, phase = t % PERIOD;
  if (phase > SHOW) return;
  const text = list[Math.floor(t / PERIOD) % list.length];
  if (typeof th.renderAlertNative === 'function') return th.renderAlertNative(c, t, themeApi, text);
  const s = c.h / 720, font = th.nativeFont || 'FiraSans-Bold';
  const words = String(text).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const n = cur ? cur + ' ' + w : w;
    if (c.measure(n, font, 30 * s) > c.w - 160 * s && cur) { lines.push(cur); cur = w; } else cur = n;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 5), h = 110 * s + shown.length * 42 * s;
  const y0 = (c.h - h) / 2;
  c.roundRect(60 * s, y0, c.w - 120 * s, h, 14 * s, [255, 255, 255]);
  c.rect(60 * s, y0, 14 * s, h, [236, 0, 22]);
  c.text('Mimořádnost', 110 * s, y0 + 62 * s, { font, size: 40 * s, color: [236, 0, 22] });
  shown.forEach((l, i) => c.text(l, 110 * s, y0 + 112 * s + i * 42 * s, { font: font.replace('Bold', 'Regular'), size: 30 * s, color: [20, 20, 40] }));
}

function renderBoard(m, t) {
  currentTheme().render(m, t, themeApi);
  if (state.cfg.custom?.disruptions !== false) renderDisruption(m, t);
}

// what a theme gets to draw with (see themes/buse.js for the reference implementation)
const minutesTo = (d) => Math.round((depTime(d) - Date.now()) / 60000);
const platformOf = (d) => {
  if (!d.platform || /^(N\/A|Neznámé|unknown)$/i.test(d.platform)) return '';
  // rail data says "Nástupiště 3" / "kolej 5"; boards only show the number
  return String(d.platform).replace(/^(nástupiště|nást\.?|kolej|k\.)\s*/i, '').trim();
};
const upcoming = () => state.deps.filter((d) => depTime(d) > Date.now() - 30000);
function statusText() {
  const src = isTransitous() ? 'data Transitous · transitous.org/sources'
    : state.fallback ? `záložní data Transitous (odjezdy.online: ${state.fallback}) · transitous.org/sources` : 'data odjezdy.online';
  // offline with older data: say clearly how old the shown timetable is
  if ((state.error || state.fromCache) && state.lastOk && !(state.fallback && !state.error)) return `BEZ SPOJENÍ · poslední data ${hhmm(new Date(state.lastOk))}${state.error ? ' (' + state.error + ')' : ''} · ${src}`;
  if (state.error) return `bez spojení (${state.error}) · ${src}`;
  return state.lastOk ? `aktualizováno ${hhmm(new Date(state.lastOk))} · ${src}` : state.net;
}

// word-wrap for the disruption screen
function wrapText(str, face, maxW, maxLines = 4) {
  const lines = [];
  let cur = '';
  for (const w of String(str).split(/\s+/)) {
    const next = cur ? cur + ' ' + w : w;
    if (textWidth(next, face) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = textWidth(w, face) > maxW ? fitText(w, face, maxW) : w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && textWidth(lines.join(' '), face) < textWidth(str, face) - 4) lines[maxLines - 1] = fitText(lines[maxLines - 1] + ' …', face, maxW);
  return lines;
}

// ---------------------------------------------------------------- disruption screen
// Real boards interrupt the departure list with a full-width notice; every 40 s we show each current
// disruption (stop alerts, cancelled trips) for 9 s. A theme may override it with renderAlert(m, t, api, text).
function currentDisruptions() {
  const list = [...state.alerts];
  for (const d of upcoming().slice(0, 12)) {
    if (d.cancelled) list.push(`Spoj ${d.train || d.line} → ${d.destination} (${hhmm(new Date(d.plannedTime))}) dnes odpadá.`);
  }
  return [...new Set(list)];
}
function renderDisruption(m, t) {
  const list = currentDisruptions();
  if (!list.length) return false;
  const PERIOD = 40000, SHOW = 9000;
  const phase = t % PERIOD;
  if (phase > SHOW) return false;
  const text = list[Math.floor(t / PERIOD) % list.length];
  const th = currentTheme();
  if (typeof th.renderAlert === 'function') { th.renderAlert(m, t, themeApi, text); return true; }
  const W = m.cols, big = face('big').rows, nor = face('normal').rows;
  const lines = wrapText(text, 'normal', W - 16, Math.max(2, Math.floor((m.rows - big - 30) / (nor + 3))));
  const h = big + 10 + lines.length * (nor + 3) + 6;
  const y0 = Math.max(0, Math.floor((m.rows - h) / 2));
  for (let y = y0; y < y0 + h; y++) for (let x = 0; x < W; x++) m.set(x, y, 0);
  m.hline(0, W - 1, y0, C.RED);
  m.hline(0, W - 1, y0 + h - 1, C.RED);
  // blinking warning title, like "Störung" / "Mimořádnost" screens
  if (Math.floor(t / 700) % 2 === 0 || phase > 2800) m.textCenter('Mimořádnost', y0 + 4, 'big', C.RED);
  lines.forEach((l, i) => m.textCenter(l, y0 + big + 8 + i * (nor + 3), 'normal', C.WHITE));
  if (list.length > 1) m.textRight(`${(Math.floor(t / PERIOD) % list.length) + 1}/${list.length}`, W - 3, y0 + 4, 'small', C.DIM);
  return true;
}
const themeApi = {
  vector: () => vector,
  state, C, FONTS: FONT_VIEW, textWidth, fitText, faceCovers, wrapText, stopLabel, hhmm, pad2,
  depTime, minutesTo, platformOf, upcoming, depNotice, hasDelay, delayLabel, delayColor, layout, statusText,
};

function cycleTheme(step = 1) {
  const i = THEMES.indexOf(currentTheme());
  state.cfg.theme = THEMES[(i + step + THEMES.length) % THEMES.length].id;
  saveConfig(state.cfg);
  state.toast = { text: 'Vzhled: ' + currentTheme().name, until: Date.now() + 2500 };
}

function setupMaxResults(m) {
  const L = layout(m);
  return Math.max(1, Math.floor((m.rows - (L.headerLine + 4 + L.rowH * 2) - L.footerH) / L.rowH));
}

function renderSetup(m, t) {
  const W = m.cols;
  const L = layout(m);
  m.text('Výběr zastávky', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  const qy = L.headerLine + 4;
  const cursor = Math.floor(t / 500) % 2 ? '_' : ' ';
  m.text('Hledat:', 2, qy, 'normal', C.DIM);
  m.text(state.query + cursor, 4 + textWidth('Hledat:', 'normal'), qy, 'normal', C.WHITE);
  const ry = qy + L.rowH + 4;
  if (state.query.length < 2) m.text('Napiš aspoň 2 písmena', 2, ry, 'small', C.DIM);
  else if (!state.results.length) m.text('Nic nenalezeno', 2, ry, 'normal', C.RED);
  state.results.slice(0, setupMaxResults(m)).forEach((s, i) => {
    const y = ry + i * L.rowH;
    const c = i === state.sel ? C.WHITE : C.AMBER;
    if (i === state.sel) m.text('>', 2, y, 'normal', C.WHITE);
    const info = (s.city ? s.city + ' · ' : '') + `${s.ids.length} nást.`;
    m.text(fitText(s.name, 'normal', W - textWidth(info, 'small') - 16), 9, y, 'normal', c);
    m.textRight(info, W - 2, y, 'small', C.DIM);
  });
  m.text('Šipky výběr · Enter potvrdit · Esc zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}

function renderSplash(m, t) {
  const cy = Math.floor(m.rows / 2);
  m.textCenter('Odjezdy OS', cy - face('big').rows - 2, 'big', C.AMBER);
  m.textCenter(state.net, cy + 3, 'normal', C.DIM);
  m.textCenter('.'.repeat(1 + (Math.floor(t / 400) % 3)), cy + 3 + face('normal').rows + 3, 'normal', C.AMBER);
}

// ---------------------------------------------------------------- start menu (shown after every boot)
const START_TIMEOUT = 20000;
function openStart(withCountdown) {
  const seen = new Set();
  const items = [];
  const push = (stop, label) => {
    if (!stop?.ids?.length || seen.has(stop.ids[0])) return;
    seen.add(stop.ids[0]);
    items.push({ stop, label: label || stopLabel(stop) });
  };
  push(state.cfg.stop, 'Pokračovat: ' + stopLabel(state.cfg.stop));
  (state.cfg.favorites || []).forEach((f) => push(f));
  presetStops().forEach((s) => push(s));
  items.push({ browse: true, label: 'Vybrat podle kraje, okresu a obce…' });
  items.push({ search: true, label: 'Hledat jinou zastávku…' });
  items.push({ world: true, label: 'Hledat ve světě (Transitous)…' });
  items.push({ theme: true, label: 'Vzhled tabule: ' + currentTheme().name });
  items.push({ settings: true, label: 'Nastavení vzhledu (barva, styl, jas, kurzor)…' });
  items.push({ update: true, label: state.update?.info ? `Aktualizovat na verzi ${state.update.info.version}…` : `Aktualizace (verze ${APP_VERSION})…` });
  state.start = { items, sel: 0, until: withCountdown ? Date.now() + START_TIMEOUT : 0 };
  state.mode = 'start';
}

function chooseStop(stop) {
  const changed = stop.ids[0] !== state.cfg.stop.ids?.[0];
  state.cfg.stop = pickStop(stop);
  state.cfg.favorites = [pickStop(stop), ...(state.cfg.favorites || []).filter((f) => f.ids?.[0] !== stop.ids[0])].slice(0, 9);
  saveConfig(state.cfg);
  state.mode = 'board';
  if (changed) { state.deps = []; state.lastOk = 0; state.alerts = []; state.fromCache = false; state.fallback = null; loadCache(); kick(); }
}

function startVisible(m) {
  const L = layout(m);
  return Math.max(1, Math.floor((m.rows - (L.headerLine + 6) - L.sm - 4) / L.rowH));
}

// ---------------------------------------------------------------- browse by region: kraj -> okres -> obec -> zastávka
let REGIONS = null;
function loadRegions() {
  if (REGIONS) return REGIONS;
  try { REGIONS = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(APP_DIR, 'regions.json.gz'))).toString('utf8')); }
  catch (e) { REGIONS = []; log('regions missing: ' + e.message); }
  return REGIONS;
}
const LEVELS = ['Kraj', 'Okres', 'Obec', 'Zastávka'];

// children of the current path; levels with a single child are skipped automatically (Praha -> Praha -> Praha)
function browseItems(pathArr) {
  const [kraj, okres, obec] = pathArr;
  if (!kraj) return loadRegions().map((k) => ({ label: k.name, info: `${k.okresy.length} okr.`, node: k }));
  if (!okres) return kraj.okresy.map((o) => ({ label: o.name, info: `${o.obce.length} obcí`, node: o }));
  if (!obec) return okres.obce.map((c) => ({ label: c.name, info: `${c.stops} zast.`, node: c }));
  return loadStops().filter((s) => s.o === obec.code)
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
    .map((s) => ({ label: shortName(s.name, obec.name), info: `${s.ids.length} nást.`, stop: s }));
}

// inside a municipality, "Ústí nad Labem,,hl.nádr." reads better as "hl.nádr."
function shortName(name, obec) {
  if (!norm(name).startsWith(norm(obec) + ' ') && !name.startsWith(obec + ',')) return name;
  const rest = name.slice(obec.length).replace(/^[\s,]+/, '');
  return rest || name;
}

function openBrowse() {
  state.browse = { path: [], sel: 0, filter: '' };
  state.mode = 'browse';
  descendSingles();
}
function descendSingles() {
  const b = state.browse;
  while (b.path.length < 3) {
    const items = browseItems(b.path);
    if (items.length !== 1) break;
    b.path.push(items[0].node);
  }
}
function browseVisible() {
  const b = state.browse;
  const items = browseItems(b.path);
  if (!b.filter) return items;
  const f = norm(b.filter);
  return items.filter((it) => norm(it.label).includes(f));
}
function browseMaxRows(m) {
  const L = layout(m);
  return Math.max(1, Math.floor((m.rows - (L.headerLine + 6 + L.sm + 4 + L.rowH) - L.sm - 4) / L.rowH));
}

function renderBrowse(m, t) {
  const W = m.cols, L = layout(m), b = state.browse;
  const level = LEVELS[b.path.length];
  m.text(`Vyber: ${level}`, 1, 1, 'big', C.AMBER);
  m.textRight(hhmm(new Date()), W - 2, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  // breadcrumb
  const crumb = b.path.map((n) => n.name).join(' / ') || 'Česko';
  m.text(fitText(crumb, 'small', W - 4), 2, L.headerLine + 3, 'small', C.DIM);
  // filter line
  const fy = L.headerLine + 3 + L.sm + 3;
  const cursor = Math.floor(t / 500) % 2 ? '_' : ' ';
  m.text('Filtr:', 2, fy, 'normal', C.DIM);
  m.text(b.filter + cursor, 4 + textWidth('Filtr:', 'normal') + 4, fy, 'normal', C.WHITE);

  const items = browseVisible();
  const rows = browseMaxRows(m);
  b.sel = Math.max(0, Math.min(b.sel, items.length - 1));
  const first = Math.min(Math.max(0, b.sel - rows + 1), Math.max(0, items.length - rows));
  const y0 = fy + L.rowH + 2;
  if (!items.length) m.text('Nic neodpovídá filtru', 9, y0, 'normal', C.RED);
  items.slice(first, first + rows).forEach((it, i) => {
    const idx = first + i, y = y0 + i * L.rowH, on = idx === b.sel;
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH - 2, hover: () => { b.sel = idx; }, click: () => { b.sel = idx; browsePick(it); } });
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    const infoW = textWidth(it.info, 'small');
    m.text(fitText(it.label, 'normal', W - infoW - 18), 9, y, 'normal', on ? C.WHITE : C.AMBER);
    m.textRight(it.info, W - 2, y, 'small', C.DIM);
  });
  b.rowsShown = { first, y0, rowH: L.rowH, count: Math.min(rows, items.length - first) };
  if (items.length > rows) m.textRight(`${b.sel + 1}/${items.length}`, W - 2, fy, 'small', C.DIM);
  m.text('Šipky, Enter · piš pro filtr · Esc zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}

function browsePick(it) {
  const b = state.browse;
  if (!it) return;
  if (it.stop) return chooseStop(it.stop);
  b.path.push(it.node);
  b.sel = 0; b.filter = '';
  descendSingles();
}
function browseBack() {
  const b = state.browse;
  if (b.filter) { b.filter = ''; b.sel = 0; return; }
  // go up to the previous level the user actually saw (skip auto-descended single-child levels)
  const p = b.path.slice();
  while (p.length) { p.pop(); if (browseItems(p).length > 1) break; }
  if (p.length === b.path.length || browseItems(p).length <= 1) { openStart(false); return; }
  b.path = p;
  b.sel = 0;
}

function browseKey(k) {
  const b = state.browse;
  const items = browseVisible();
  if (k === '\u001b[A') b.sel = Math.max(0, b.sel - 1);
  else if (k === '\u001b[B') b.sel = Math.min(items.length - 1, b.sel + 1);
  else if (k === '\u001b[5~') b.sel = Math.max(0, b.sel - browseMaxRows(m));
  else if (k === '\u001b[6~') b.sel = Math.min(items.length - 1, b.sel + browseMaxRows(m));
  else if (k === '\r') browsePick(items[b.sel]);
  else if (k === '\u001b') browseBack();
  else if (k === '\u007f' || k === '\b') { if (b.filter) { b.filter = b.filter.slice(0, -1); b.sel = 0; } else browseBack(); }
  else if (k.length === 1 && k >= ' ') { b.filter += k; b.sel = 0; }
}

// ---------------------------------------------------------------- settings: customise the look
const SETTINGS = [
  { key: 'theme', label: 'Vzhled', values: () => THEMES.map((x) => x.id), show: (v) => (THEMES.find((x) => x.id === v) || THEMES[0]).name },
  { key: 'font', label: 'Písmo', values: () => ['theme', 'buse', ...FONT_FAMILIES], show: (v) => (!v || v === 'theme' ? 'podle vzhledu' : v === 'buse' ? 'BUSE' : FONT_NAMES[v] || v) },
  { key: 'tint', label: 'Barva textu', values: () => Object.keys(TINT_NAMES), show: (v) => TINT_NAMES[v || 'theme'] },
  { key: 'style', label: 'Styl bodů', values: () => ['theme', 'led', 'lcd'], show: (v) => ({ theme: 'podle vzhledu', led: 'LED body', lcd: 'LCD plné' })[v || 'theme'] },
  { key: 'brightness', label: 'Jas (procenta)', values: () => [100, 85, 70, 55, 40], show: (v) => String(v ?? 100) }, // '%' is a BUSE pictogram
  { key: 'disruptions', label: 'Oznámení mimořádností', values: () => [true, false], show: (v) => (v === false ? 'vypnutá' : 'zapnutá') },
  { key: 'updates', label: 'Aktualizace', values: () => ['ask', 'auto', 'off'], show: (v) => ({ ask: 'zeptat se', auto: 'automaticky', off: 'vypnuté' })[v || 'ask'] },
  { key: 'fallback', label: 'Záloha Transitous při výpadku', values: () => [true, false], show: (v) => (v === false ? 'vypnutá' : 'zapnutá') },
  { key: 'cursor', label: 'Kurzor myši', values: () => [true, false], show: (v) => (v === false ? 'vypnutý' : 'zapnutý') },
];
function settingValue(it) {
  return it.key === 'theme' ? currentTheme().id : (state.cfg.custom || {})[it.key];
}
function changeSetting(it, step) {
  const vals = it.values();
  const cur = settingValue(it);
  let i = vals.indexOf(cur ?? vals[0]);
  if (i < 0) i = 0;
  const next = vals[(i + step + vals.length) % vals.length];
  if (it.key === 'theme') state.cfg.theme = next;
  else state.cfg.custom = { ...(state.cfg.custom || {}), [it.key]: next };
  pointer.enabled = state.cfg.custom?.cursor !== false;
  if (!pointer.enabled) pointer.visible = false;
  saveConfig(state.cfg);
}
function renderSettings(m, t) {
  const W = m.cols, L = layout(m);
  m.text('Nastavení vzhledu', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  // spacing adapts to the theme font size so the list never runs into the hint line
  const step = Math.min(L.rowH + 2, Math.floor((m.rows - (L.headerLine + 6) - L.sm - 6) / (SETTINGS.length + 1)));
  SETTINGS.forEach((it, i) => {
    const y = L.headerLine + 6 + i * step, on = i === state.setSel;
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    m.text(it.label, 9, y, 'normal', on ? C.WHITE : C.AMBER);
    const val = '< ' + it.show(settingValue(it)) + ' >';
    m.textRight(val.replace('< ', '').replace(' >', ''), W - 2, y, 'normal', on ? C.WHITE : C.DIM);
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH, hover: () => { state.setSel = i; }, click: () => { state.setSel = i; changeSetting(it, 1); } });
  });
  // live preview strip of the palette
  const py = L.headerLine + 6 + SETTINGS.length * step + 2;
  if (py + L.sm < m.rows - L.sm - 4) { // live preview of the palette, when there is room
    m.text('Ukázka:', 9, py, 'small', C.DIM);
    let x = 9 + textWidth('Ukázka: ', 'small');
    for (const [txt, c] of [['22 Nádraží Hostivař', C.AMBER], ['+3 min', C.RED], ['včas', C.GREEN], ['nást. A', C.DIM]]) {
      x = m.text(txt, x, py, 'small', c) + 8;
    }
  }
  m.text('Šipky nahoru/dolů · vlevo/vpravo nebo Enter mění · Esc zpět · klik mění', 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function settingsKey(k) {
  const it = SETTINGS[state.setSel];
  if (k === '\u001b[A') state.setSel = Math.max(0, state.setSel - 1);
  else if (k === '\u001b[B') state.setSel = Math.min(SETTINGS.length - 1, state.setSel + 1);
  else if (k === '\u001b[C' || k === '\r' || k === ' ') changeSetting(it, 1);
  else if (k === '\u001b[D') changeSetting(it, -1);
  else if (k === '\u001b' || k === 'q') openStart(false);
}

// ---------------------------------------------------------------- worldwide stop search (Transitous)
let worldTimer = null;
function worldSearch() {
  clearTimeout(worldTimer);
  const w = state.world;
  if (w.query.trim().length < 3) { w.results = []; return; }
  worldTimer = setTimeout(async () => {
    const q = w.query;
    w.busy = true;
    try {
      const j = await getJson(`${TRANSITOUS}/api/v1/geocode?text=${encodeURIComponent(q)}&type=STOP`, 15000);
      if (state.world !== w || w.query !== q) return;
      w.results = (j || []).slice(0, 12).map((x) => ({
        name: x.name, ids: [x.id], source: 'transitous',
        // the geocoder flags the meaningful place ("Wien") as default; fall back to the municipality level
        city: ((x.areas || []).find((a) => a.default) || (x.areas || []).filter((a) => a.adminLevel <= 8).slice(-1)[0] || {}).name || '',
        country: x.country || '',
      }));
      w.sel = 0; w.err = null;
    } catch (e) { w.err = e.message; }
    w.busy = false;
  }, 600); // debounce: keep Transitous load light
}
function renderWorld(m, t) {
  const W = m.cols, L = layout(m), w = state.world;
  m.text('Svět · Transitous', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  const qy = L.headerLine + 4;
  const cursor = Math.floor(t / 500) % 2 ? '_' : ' ';
  m.text('Hledat:', 2, qy, 'normal', C.DIM);
  m.text(w.query + cursor, 4 + textWidth('Hledat:', 'normal'), qy, 'normal', C.WHITE);
  const ry = qy + L.rowH + 4;
  if (w.err) m.text(fitText('Chyba: ' + w.err, 'small', W - 4), 2, ry, 'small', C.RED);
  else if (w.busy) m.text('Hledám…', 2, ry, 'small', C.DIM);
  else if (w.query.length < 3) m.text('Napiš aspoň 3 písmena (např. Wien Hbf, London Bridge, Zürich)', 2, ry, 'small', C.DIM);
  const rows = Math.max(1, Math.floor((m.rows - ry - L.sm - 6) / L.rowH));
  w.results.slice(0, rows).forEach((s, i) => {
    const y = ry + (w.busy || w.err ? L.rowH : 0) + i * L.rowH, on = i === w.sel;
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    const info = [s.city, s.country].filter(Boolean).join(' · ');
    m.text(fitText(s.name, 'normal', W - Math.min(textWidth(info, 'small'), Math.floor(W * 0.4)) - 18), 9, y, 'normal', on ? C.WHITE : C.AMBER);
    m.textRight(fitText(info, 'small', Math.floor(W * 0.4)), W - 2, y, 'small', C.DIM);
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH - 2, hover: () => { w.sel = i; }, click: () => chooseStop(s) });
  });
  m.text('Data: transitous.org/sources · Šipky, Enter · Esc zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function worldKey(k) {
  const w = state.world;
  if (k === '\u001b') return openStart(false);
  if (k === '\u001b[A') { w.sel = Math.max(0, w.sel - 1); return; }
  if (k === '\u001b[B') { w.sel = Math.min(w.results.length - 1, w.sel + 1); return; }
  if (k === '\r') { const s = w.results[w.sel]; if (s) chooseStop(s); return; }
  if (k === '\u007f' || k === '\b') w.query = w.query.slice(0, -1);
  else if (k.length === 1 && k >= ' ') w.query += k;
  else return;
  worldSearch();
}

function renderStart(m, t) {
  const W = m.cols, L = layout(m), st = state.start;
  m.text('Kam to dnes bude', 1, 1, 'big', C.AMBER); // no '?': it is a pictogram in the BUSE face
  const now = new Date();
  m.textRight(hhmm(now), W - 2, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  const vis = startVisible(m);
  const first = Math.min(Math.max(0, st.sel - vis + 1), Math.max(0, st.items.length - vis));
  st.items.slice(first, first + vis).forEach((it, i) => {
    const idx = first + i, y = L.headerLine + 5 + i * L.rowH, on = idx === st.sel;
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH - 2, hover: () => { st.sel = idx; st.until = 0; }, click: () => { st.sel = idx; pickStart(it); } });
    m.text(fitText(it.label, 'normal', W - 14), 9, y, 'normal', on ? C.WHITE : (it.search || it.theme || it.browse || it.settings || it.world || it.update ? C.DIM : C.AMBER));
    if (idx > 0 && idx <= 9 && !it.search && !it.theme && !it.browse && !it.settings && !it.world && !it.update) m.textRight(String(idx), W - 2, y, 'small', C.DIM);
  });
  const left = st.until ? Math.max(0, Math.ceil((st.until - Date.now()) / 1000)) : 0;
  const hint = (left ? `Spustím za ${left} s · ` : '') + 'šipky, Enter, číslo nebo piš';
  m.text(fitText(hint, 'small', W - 4), 2, m.rows - L.sm - 1, 'small', C.DIM);
}

function startKey(k) {
  const st = state.start;
  st.until = 0; // any key stops the countdown
  if (k === '\u001b[A') st.sel = Math.max(0, st.sel - 1);
  else if (k === '\u001b[B') st.sel = Math.min(st.items.length - 1, st.sel + 1);
  else if (k === '\r') pickStart(st.items[st.sel]);
  else if (k === '\u001b') pickStart(st.items[0]);
  else if (/^[1-9]$/.test(k) && st.items[+k] && !st.items[+k].search && !st.items[+k].theme && !st.items[+k].browse && !st.items[+k].settings && !st.items[+k].world && !st.items[+k].update) pickStart(st.items[+k]);
  else if (k === 't' || k === 'T') {
    cycleTheme(1);
    const it = st.items.find((x) => x.theme);
    if (it) it.label = 'Vzhled tabule: ' + currentTheme().name;
  }
  else if (k.length === 1 && k > ' ' && k !== '\u007f') { state.mode = 'setup'; state.query = k; state.results = searchStops(k, setupMaxResults(m)); state.sel = 0; }
}
function pickStart(it) {
  if (!it) return;
  if (it.browse) { openBrowse(); return; }
  if (it.world) { state.mode = 'world'; state.world = { query: '', results: [], sel: 0, busy: false, err: null }; return; }
  if (it.settings) { state.mode = 'settings'; state.setSel = 0; return; }
  if (it.update) { openUpdate(true); return; }
  if (it.theme) { cycleTheme(1); it.label = 'Vzhled tabule: ' + currentTheme().name; return; }
  if (it.search) { state.mode = 'setup'; state.query = ''; state.results = []; state.sel = 0; }
  else chooseStop(it.stop);
}

// ---------------------------------------------------------------- self-update (GitHub Releases)
// Setting "Aktualizace": ask (default) shows this screen when a new release appears, auto installs it,
// off never checks. The screen falls back to the board after 2 minutes without an answer.
const UPDATE_EVERY = 6 * 3600 * 1000;
async function updateLoop() {
  const mode = state.cfg.custom?.updates || 'ask';
  if (mode !== 'off' && !state.update?.busy) {
    try {
      const info = await updater.check(APP_VERSION, USER_AGENT);
      if (info) {
        log('update available: ' + info.version);
        state.update = { ...(state.update || {}), info };
        if (mode === 'auto') runUpdate();
        else if (state.cfg.skipVersion !== info.version && state.mode === 'board') openUpdate(false);
      }
    } catch (e) { log('update check: ' + e.message); }
  }
  setTimeout(updateLoop, UPDATE_EVERY);
}
function openUpdate(manual) {
  const u = state.update = { ...(state.update || {}), sel: 0, until: manual ? 0 : Date.now() + 120000, err: null };
  if (!u.busy) u.msg = null;
  state.mode = 'update';
  if (manual && !u.info && !u.busy) { // menu item: check right now
    u.msg = 'Hledám novou verzi…';
    updater.check(APP_VERSION, USER_AGENT).then((info) => {
      u.info = info; u.msg = info ? null : `Máš nejnovější verzi (${APP_VERSION}).`;
    }).catch((e) => { u.msg = null; u.err = 'Nelze zjistit: ' + (e.cause?.code || e.message); });
  }
}
const UPDATE_CHOICES = [
  { label: 'Aktualizovat', act: () => runUpdate() },
  { label: 'Později', act: () => { state.mode = 'board'; } },
  { label: 'Tuto verzi přeskočit', act: () => { state.cfg.skipVersion = state.update.info?.version; saveConfig(state.cfg); state.mode = 'board'; } },
];
async function runUpdate() {
  const u = state.update;
  if (!u?.info || u.busy) return;
  u.busy = true; u.err = null; u.until = 0;
  try {
    const v = await updater.install(u.info, USER_AGENT, (s) => { u.msg = s; });
    u.msg = `Verze ${v} nainstalována, restartuji tabuli…`;
    log('update installed: ' + v);
    setTimeout(() => shutdown(75), 2500); // non-zero: init (inittab respawn / systemd Restart=on-failure) starts it again
  } catch (e) {
    u.busy = false; u.msg = null;
    u.err = 'Aktualizace selhala: ' + (e.cause?.code || e.message);
    log('update failed: ' + (e.stack || e.message));
  }
}
function renderUpdate(m, t) {
  const W = m.cols, L = layout(m), u = state.update || {};
  if (u.until && Date.now() > u.until) { state.mode = 'board'; return renderBoard(m, t); }
  m.text('Aktualizace', 1, 1, 'big', C.AMBER);
  m.textRight('nyní verze ' + APP_VERSION, W - 2, 3, 'small', C.DIM);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  let y = L.headerLine + 5;
  if (u.info) {
    m.text(fitText(`Je k dispozici nová verze ${u.info.version}`, 'normal', W - 4), 2, y, 'normal', C.WHITE);
    y += L.rowH + 2;
    const notes = u.info.notes.split('\n').map((l) => l.replace(/^[#*\-\s]+/, '').trim()).filter(Boolean);
    const room = Math.max(0, Math.floor((m.rows - y - (L.rowH + 6) * 2 - L.sm - 6) / (L.sm + 2)));
    for (const l of notes.slice(0, room)) { m.text(fitText('· ' + l, 'small', W - 6), 4, y, 'small', C.DIM); y += L.sm + 2; }
  }
  y = Math.max(y + 4, m.rows - (L.rowH + 4) * 2 - L.sm - 6);
  if (u.err) m.text(fitText(u.err, 'small', W - 4), 2, y, 'small', C.RED);
  else if (u.msg) m.text(fitText(u.msg, 'normal', W - 4), 2, y, 'normal', C.GREEN);
  y += L.rowH + 4;
  if (u.info && !u.busy) {
    let x = 2;
    UPDATE_CHOICES.forEach((c, i) => {
      const on = i === u.sel, w = textWidth(c.label, 'normal') + 8;
      if (x + w > W) return;
      if (on) { m.hline(x, x + w - 1, y - 2, C.WHITE); m.hline(x, x + w - 1, y + L.rowH - 3, C.WHITE); }
      m.text(c.label, x + 4, y, 'normal', on ? C.WHITE : C.AMBER);
      const x0 = x;
      hits.push({ x0, y0: y - 2, x1: x0 + w, y1: y + L.rowH, hover: () => { u.sel = i; u.until = 0; }, click: () => c.act() });
      x += w + 6;
    });
  }
  const left = u.until ? Math.max(0, Math.ceil((u.until - Date.now()) / 1000)) : 0;
  m.text(fitText((left ? `Zpět na tabuli za ${left} s · ` : '') + 'Šipky, Enter · Esc později', 'small', W - 4), 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function updateKey(k) {
  const u = state.update || {};
  u.until = 0;
  if (u.busy) return;
  if (k === '\u001b' || k === 'q') { state.mode = 'board'; return; }
  if (!u.info) return;
  if (k === '\u001b[C' || k === '\u001b[B') u.sel = Math.min(UPDATE_CHOICES.length - 1, u.sel + 1);
  else if (k === '\u001b[D' || k === '\u001b[A') u.sel = Math.max(0, u.sel - 1);
  else if (k === '\r' || k === ' ') UPDATE_CHOICES[u.sel].act();
}

// ---------------------------------------------------------------- input
function onKey(k) {
  if (state.mode === 'start') return startKey(k);
  if (state.mode === 'browse') return browseKey(k);
  if (state.mode === 'settings') return settingsKey(k);
  if (state.mode === 'world') return worldKey(k);
  if (state.mode === 'update') return updateKey(k);
  if (state.mode === 'board') {
    if (k === 's' || k === 'S' || k === '\r' || k === ' ') openStart(false);
    else if (k === 't' || k === 'T') cycleTheme(1);
    else if (k === 'q' || k === 'Q' || k === '\u0003') shutdown(10);
    else if (/^[1-9]$/.test(k) && state.cfg.favorites?.[+k - 1]) chooseStop(state.cfg.favorites[+k - 1]);
    return;
  }
  // setup (search) mode
  if (k === '\u001b') { openStart(false); return; }
  if (k === '\u001b[A') { state.sel = Math.max(0, state.sel - 1); return; }
  if (k === '\u001b[B') { state.sel = Math.min(state.results.length - 1, state.sel + 1); return; }
  if (k === '\r') {
    const s = state.results[state.sel];
    if (s) chooseStop(s);
    return;
  }
  if (k === '\u007f' || k === '\b') state.query = state.query.slice(0, -1);
  else if (k.length === 1 && k >= ' ') state.query += k;
  else return;
  state.results = searchStops(state.query, setupMaxResults(m));
  state.sel = 0;
}

// ---------------------------------------------------------------- main loop
let boardTimer = null;
function kick() {
  clearTimeout(boardTimer);
  const loop = async () => {
    try {
      await refreshBoard();
      state.net = 'online';
    } catch (e) {
      state.error = e.name === 'AbortError' ? 'časový limit' : (e.cause?.code || e.message);
      log('board: ' + state.error);
    }
    boardTimer = setTimeout(loop, state.error ? 10000 : 30000);
  };
  loop();
}

let screen, m, t0 = Date.now();
// The framebuffer is shared by all virtual consoles: after Alt+F2 the board must stop painting,
// otherwise it would draw over the service console. Our console is the one we started on (tty1).
let vtCheckAt = 0, vtActive = true;
// ODJEZDY_VT wins; otherwise the first stdio fd that is a real ttyN. Under systemd stdin can be
// /dev/console, /dev/tty0 or /dev/null, which never equals the active VT name -> fall back to tty1.
const OWN_VT = (() => {
  if (/^tty\d+$/.test(process.env.ODJEZDY_VT || '')) return process.env.ODJEZDY_VT;
  for (const fd of [0, 1, 2]) {
    try { const n = fs.readlinkSync(`/proc/self/fd/${fd}`).replace('/dev/', ''); if (/^tty[1-9]\d*$/.test(n)) return n; } catch {}
  }
  return 'tty1';
})();
function ownVtActive(force = false) {
  if (PNG_OUT) return true;
  if (force || Date.now() - vtCheckAt > 300) {
    vtCheckAt = Date.now();
    let now = vtActive;
    try { now = fs.readFileSync('/sys/class/tty/tty0/active', 'utf8').trim() === OWN_VT; } catch {} // unreadable: keep last state
    if (now && !vtActive && screen) { screen.prev = null; screen.look = null; lastNative = 0; } // repaint on return
    vtActive = now;
    if (now && !force) checkFb(); // not from inside Screen.draw: it may replace the screen
  }
  return vtActive;
}
// When the real DRM driver (bochs, virtio-gpu, i915 …) takes over from simplefb/efifb during boot,
// /dev/fb0 is replaced: our old fd then writes into a dead buffer while the screen keeps the GRUB/boot
// text. Detect the swap (name/size change) and reopen; also force full repaints for the first seconds.
let fbSig = null, fbCheckAt = 0;
function fbSignature() {
  try { const b = '/sys/class/graphics/fb0'; return ['name', 'virtual_size', 'bits_per_pixel', 'stride'].map((f) => { try { return fs.readFileSync(`${b}/${f}`, 'utf8').trim(); } catch { return ''; } }).join('|'); } catch { return null; }
}
function checkFb() {
  if (PNG_OUT || !screen || Date.now() - fbCheckAt < 1500) return;
  fbCheckAt = Date.now();
  const sig = fbSignature();
  if (sig === fbSig) return;
  log(`framebuffer changed (${fbSig} -> ${sig}), reopening /dev/fb0`);
  try {
    const old = screen;
    screen = new Screen();
    try { fs.closeSync(old.fd); } catch {}
    m = new Matrix(screen.cols, screen.rows);
    nativeCanvas = null; lastNative = 0;
    pointer.x = Math.min(pointer.x, screen.w - 1); pointer.y = Math.min(pointer.y, screen.h - 1);
  } catch (e) { log(`fb reopen failed: ${e.message}`); }
}

function tick() {
  if (!ownVtActive()) return;
  const t = Date.now() - t0;
  m.clear();
  hits.length = 0;
  const userFont = state.cfg.custom?.font;
  faceFamily = userFont && userFont !== 'theme' ? (userFont === 'buse' ? null : userFont) : currentTheme().fonts || null;
  if (pointer.visible && Date.now() - pointer.last > 5000) pointer.visible = false;
  if (state.mode === 'start' && state.start.until && Date.now() > state.start.until) pickStart(state.start.items[0]);
  if (state.mode === 'start') renderStart(m, t);
  else if (state.mode === 'browse') renderBrowse(m, t);
  else if (state.mode === 'settings') renderSettings(m, t);
  else if (state.mode === 'world') renderWorld(m, t);
  else if (state.mode === 'update') renderUpdate(m, t);
  else if (state.mode === 'setup') renderSetup(m, t);
  else if (!state.lastOk && !state.error && !state.deps.length && t < 4000) renderSplash(m, t);
  else if (renderNativeBoard(t)) return;
  else renderBoard(m, t);
  if (state.toast && Date.now() < state.toast.until) { // short confirmation box (theme switch)
    const w = textWidth(state.toast.text, 'normal') + 8, x0 = Math.floor((m.cols - w) / 2), y0 = Math.floor(m.rows / 2) - 8;
    for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + w; x++) m.set(x, y, 0);
    m.hline(x0, x0 + w - 1, y0, C.WHITE);
    m.hline(x0, x0 + w - 1, y0 + 15, C.WHITE);
    m.text(state.toast.text, x0 + 4, y0 + 3, 'normal', C.WHITE);
  }
  screen.draw(m);
}

function shutdown(code = 0) {
  if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} }
  process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  process.exit(code);
}

async function main() {
  state.cfg = loadConfig();
  screen = new Screen();
  m = new Matrix(screen.cols, screen.rows);
  state.ip = localIp();

  if (PNG_OUT) {
    loadCache();
    try { await refreshBoard(); } catch (e) { state.error = e.cause?.code || e.message; }
    try { await refreshAlerts(); } catch {}
    t0 = Date.now() - 10000;
    if (args.includes('--setup')) { state.mode = 'setup'; state.query = 'hlavni nadr'; state.results = searchStops(state.query, setupMaxResults(m)); }
    if (args.includes('--browse')) { // e.g. --browse "ustecky/usti" walks the region picker for a screenshot
      openBrowse();
      for (const k of (args[args.indexOf('--browse') + 1] || '').split('/').filter(Boolean)) {
        state.browse.filter = k;
        if (k.endsWith('!')) { state.browse.filter = k.slice(0, -1); break; }
        browsePick(browseVisible()[0]);
      }
    }
    if (args.includes('--alert')) { state.alerts = [args[args.indexOf('--alert') + 1]]; t0 = Date.now() - 4000; }
    if (args.includes('--update')) { state.update = { info: { version: '9.9.9', notes: '- Nové vzhledy tabulí\n- Opravy kreslení na konzoli', size: 4200000 } }; openUpdate(false); }
    if (args.includes('--settings')) { state.mode = 'settings'; state.setSel = 1; }
    if (args.includes('--cursor')) { pointer.visible = true; pointer.last = Date.now(); pointer.x = screen.w * 0.42; pointer.y = screen.h * 0.47; }
    if (args.includes('--theme')) state.cfg.theme = args[args.indexOf('--theme') + 1];
    if (args.includes('--start')) { openStart(true); state.start.until = Date.now() + 14500; }
    tick();
    screen.savePng(PNG_OUT);
    console.log(`wrote ${PNG_OUT} (${screen.w}x${screen.h}, ${m.cols}x${m.rows} LEDs, ${state.deps.length} departures)`);
    return;
  }

  process.stdout.write('\x1b[?25l\x1b[2J'); // hide console cursor
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { for (const k of d.match(/\u001b\[[A-D]|\u001b\[[0-9]~|[\s\S]/gu) || []) onKey(k); });
  }
  process.on('SIGTERM', () => shutdown(0));

  // boot menu once per boot (not after a crash/respawn), unless the stop was fixed on the kernel cmdline
  const marker = '/tmp/odjezdy.booted';
  if (!state.cfg.forced && !fs.existsSync(marker) && !args.includes('--no-menu')) openStart(true);
  try { fs.writeFileSync(marker, ''); } catch {}

  loadCache();
  kick();
  const alertsLoop = async () => { try { await refreshAlerts(); } catch (e) { log('alerts: ' + e.message); } setTimeout(alertsLoop, 120000); };
  setTimeout(alertsLoop, 3000);
  setInterval(() => { state.ip = localIp(); if (!state.ip) state.net = 'čekám na síť (DHCP)…'; }, 5000);
  pointer.enabled = state.cfg.custom?.cursor !== false;
  pointer.x = screen.w / 2; pointer.y = screen.h / 2;
  startMouse();
  setInterval(tick, 66);
  setTimeout(updateLoop, 45000); // first check once the network is surely up
  if (__dirname === updater.UPDATE_DIR) setTimeout(() => updater.confirm(__dirname), 20000); // new version runs fine
}

main().catch((e) => { log('fatal: ' + e.stack); console.error(e); process.exit(1); });
