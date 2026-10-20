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
const system = require('./system');
const themeUtil = require('./themes/_util');
const displays = require('./displays');

// An accepted update lives in /var/lib/odjezdy/app; if it is newer than this copy, run that one instead.
if (!process.argv.includes('--png') && !process.env.ODJEZDY_NO_UPDATE) {
  const alt = updater.pick(__dirname, (s) => { try { fs.appendFileSync('/tmp/odjezdy.log', `[${new Date().toISOString()}] ${s}\n`); } catch {} });
  if (alt) { require(path.join(alt, 'board.js')); return; }
}
const APP_VERSION = updater.versionOf(__dirname);
const admin = require('./admin');

const API = process.env.ODJEZDY_API || 'https://app.odjezdy.online';
// Worldwide GTFS/GTFS-RT via Transitous (MOTIS 2). Open-source & non-commercial use only; requires a
// User-Agent with contact and visible attribution to https://transitous.org/sources/ (shown in the status line).
const TRANSITOUS = process.env.ODJEZDY_TRANSITOUS || 'https://api.transitous.org';
const USER_AGENT = `OdjezdyOS/${APP_VERSION} (+https://github.com/odjezdy-online/odjezdy-system)`;
const APP_DIR = __dirname;
const CONFIG_FILE = process.env.ODJEZDY_CONFIG || '/etc/odjezdy/config.json';
const args = process.argv.slice(2);
const PNG_OUT = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
// multi-display: children run "--display N --output fbN|kms:N" with their own ODJEZDY_CONFIG (displays.js)
const DISPLAY = args.includes('--display') ? Number(args[args.indexOf('--display') + 1]) : 0;
const IS_CHILD = DISPLAY > 0;
let OUTPUT = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'fb0';

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
// LED train symbol (front view, 9x7 dots, doubled in the big faces) as the glyph U+E000 of every face
const TRAIN_ROWS = [0xFE, 0x17D, 0x17D, 0x1FF, 0x145, 0xFE, 0x183];
for (const f of Object.values(FONTS)) {
  const k = f.rows >= 14 ? 2 : 1, w = 9 * k, top = Math.max(0, Math.floor((f.rows - 7 * k) / 2));
  const bits = new Array(f.rows).fill(0n);
  TRAIN_ROWS.forEach((r, i) => {
    let v = 0n;
    for (let x = 0; x < 9; x++) if ((r >> (8 - x)) & 1) for (let q = 0; q < k; q++) v |= 1n << BigInt(w - 1 - (x * k + q));
    for (let q = 0; q < k; q++) if (top + i * k + q < f.rows) bits[top + i * k + q] = v;
  });
  f.glyphs['\uE000'] = { w, bits };
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

// Performance counters (written to /tmp/odjezdy.log every 10 s, shown with the V key): how long a whole frame
// takes (render, conversion, writing to the framebuffer), how often, and how late timers fire (event-loop lag).
const perf = { frames: 0, render: 0, convert: 0, write: 0, bytes: 0, lagMax: 0, since: Date.now(), last: null };
function perfSummary() {
  const dt = Math.max(1, Date.now() - perf.since) / 1000, f = Math.max(1, perf.frames);
  return `${(perf.frames / dt).toFixed(1)} fps | render ${(perf.render / f).toFixed(0)} ms | conv ${(perf.convert / f).toFixed(0)} ms | write ${(perf.write / dt * 1000 / Math.max(1, perf.frames)).toFixed(0)} ms/frame, ${(perf.bytes / dt / 1024).toFixed(0)} KB/s | lag max ${perf.lagMax} ms | scale 1/${qualityFactor} | ${memInfo()}`;
}
// memory for the V overlay / log: this process (RSS) and what the system still has free, plus uptime of the board (a frozen board
// keeps its last frame, so the last numbers show what happened)
function memInfo() {
  let avail = '?';
  try { avail = Math.round(Number(/MemAvailable:s+(d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024) + ' MB'; } catch {}
  return `RSS ${Math.round(process.memoryUsage().rss / 1048576)} MB | free ${avail} | up ${Math.round((Date.now() - bootAt) / 60000)} min`;
}
function perfTick() {
  perf.last = perfSummary();
  log('perf: ' + perf.last);
  Object.assign(perf, { frames: 0, render: 0, convert: 0, write: 0, bytes: 0, lagMax: 0, since: Date.now() });
}
let lagAt = Date.now();
let qualityFactor = 1, slowFrames = 0, fastFrames = 0; const bootAt = Date.now(); // the native canvas is rendered at 1/qualityFactor of the screen size and enlarged (VMs)
const mice = new Map(); // eventN -> { fd, absMax }
function startMouse() {
  // Only pointing devices (mice, tablets, touchscreens): /proc/bus/input/devices lists a "mouseN"
  // handler for them. Keyboards stay on the TTY. Rescanned every 3 s: in VirtualBox/QEMU the USB tablet
  // often appears after the board has started, and mice get plugged in later on real machines.
  const scan = () => {
    let devs = [];
    try {
      devs = fs.readFileSync('/proc/bus/input/devices', 'utf8').split(/\n\s*\n/)
        .filter((b) => /H: Handlers=.*\bmouse\d/.test(b) || /N: Name=.*touch/i.test(b))
        .map((b) => (b.match(/\b(event\d+)\b/) || [])[1]).filter(Boolean);
    } catch { return; }
    for (const n of devs) {
      if (mice.has(n)) continue;
      try { mice.set(n, { fd: fs.openSync('/dev/input/' + n, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK), absMax: { x: 32767, y: 32767 } }); log(`input ${n}: listening`); }
      catch (e) { log(`input ${n}: ${e.code}`); mice.set(n, { fd: null }); } // don't retry a device we may not open
    }
  };
  scan();
  setInterval(scan, 3000);
  // Non-blocking reads polled from a timer: a blocking read per device would occupy one of the
  // 4 libuv threadpool threads forever, starving DNS lookups (getaddrinfo) and other fs work.
  const buf = Buffer.alloc(24 * 64);
  setInterval(() => {
    for (const [n, dev] of mice) {
      if (dev.fd === null) continue;
      for (;;) {
        let len;
        try { len = fs.readSync(dev.fd, buf, 0, buf.length, null); }
        catch (e) {
          if (e.code !== 'EAGAIN') { log(`input ${n}: ${e.code}, dropped`); try { fs.closeSync(dev.fd); } catch {} mice.delete(n); } // unplugged
          break;
        }
        if (!len) break;
        for (let o = 0; o + 24 <= len; o += 24) onInput(buf.readUInt16LE(o + 16), buf.readUInt16LE(o + 18), buf.readInt32LE(o + 20), dev.absMax);
      }
    }
  }, 15);
}

// Keyboard for a board without a terminal (kiosk under a Wayland compositor): evdev, US layout, enough for the menus
const KEYMAP = (() => {
  const m = {}, rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], starts = [16, 30, 44];
  rows.forEach((r, i) => [...r].forEach((ch, j) => { m[starts[i] + j] = [ch, ch.toUpperCase()]; }));
  '1234567890'.split('').forEach((d, i) => { m[2 + i] = [d, '!@#$%^&*()'[i]]; });
  Object.assign(m, { 57: [' ', ' '], 28: ['\r', '\r'], 1: ['\u001b', '\u001b'], 14: ['\u007f', '\u007f'], 15: ['\t', '\t'], 12: ['-', '_'], 52: ['.', '>'], 51: [',', '<'], 53: ['/', '?'],
    103: ['\u001b[A', '\u001b[A'], 108: ['\u001b[B', '\u001b[B'], 106: ['\u001b[C', '\u001b[C'], 105: ['\u001b[D', '\u001b[D'], 104: ['\u001b[5~', '\u001b[5~'], 109: ['\u001b[6~', '\u001b[6~'], 96: ['\r', '\r'] });
  return m;
})();
function startKeyboard() {
  const kbds = new Map();
  let shift = false;
  const scan = () => {
    let devs = [];
    try {
      devs = fs.readFileSync('/proc/bus/input/devices', 'utf8').split(/\n\s*\n/).filter((b) => /H: Handlers=.*\bkbd\b/.test(b) && /EV=1[2-9a-f]/i.test(b))
        .map((b) => (b.match(/\b(event\d+)\b/) || [])[1]).filter(Boolean);
    } catch { return; }
    for (const n of devs) {
      if (kbds.has(n)) continue;
      try { kbds.set(n, fs.openSync('/dev/input/' + n, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); log('keyboard ' + n + ': listening'); } catch (e) { kbds.set(n, null); log('keyboard ' + n + ': ' + e.code); }
    }
  };
  scan(); setInterval(scan, 3000);
  const buf = Buffer.alloc(24 * 32);
  setInterval(() => {
    for (const [n, fd] of kbds) {
      if (fd === null) continue;
      for (;;) {
        let len;
        try { len = fs.readSync(fd, buf, 0, buf.length, null); } catch (e) { if (e.code !== 'EAGAIN') { try { fs.closeSync(fd); } catch {} kbds.delete(n); } break; }
        if (!len) break;
        for (let o = 0; o + 24 <= len; o += 24) {
          const type = buf.readUInt16LE(o + 16), code = buf.readUInt16LE(o + 18), value = buf.readInt32LE(o + 20);
          if (type !== 1) continue;
          if (code === 42 || code === 54) { shift = value !== 0; continue; }
          if (value === 0) continue; // key up
          const k = KEYMAP[code];
          if (k) onKey(shift ? k[1] : k[0]);
        }
      }
    }
  }, 15);
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
  } else if (type === EV_KEY && value === 1 && code === 0x111) { // BTN_RIGHT = back; on the board: open the menu
    if (state.mode === 'board') openStart(false); else onKey('\u001b');
  }
}

// first visible row of a scrolling menu: moves only when the selection leaves the window (a window computed from the
// selection alone jumped on every mouse move: the row under the pointer changed, which moved the selection again)
function scrollFirst(o, sel, rows, total) {
  let f = o.scrollFirst || 0;
  if (sel < f) f = sel; else if (sel >= f + rows) f = sel - rows + 1;
  return (o.scrollFirst = Math.min(Math.max(0, f), Math.max(0, total - rows)));
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
  if (h) h.click(); // a plain left click on the departure board does nothing (right click opens the menu)
}

// ---------------------------------------------------------------- output: framebuffer or PNG
function fbInfo(dev = 'fb0') {
  const base = `/sys/class/graphics/${dev}`;
  const [w, h] = fs.readFileSync(`${base}/virtual_size`, 'utf8').trim().split(',').map(Number);
  const bpp = Number(fs.readFileSync(`${base}/bits_per_pixel`, 'utf8').trim());
  let stride = w * (bpp / 8);
  try { stride = Number(fs.readFileSync(`${base}/stride`, 'utf8').trim()) || stride; } catch {}
  return { w, h, bpp, stride };
}

class Screen {
  // kms: { w, h, stride, sock } from displays.kmsConnect (frames go to odjezdy-kms instead of /dev/fbN)
  constructor(kms = null) {
    this.sock = null;
    if (PNG_OUT) {
      this.w = Number(process.env.W) || 1280; this.h = Number(process.env.H) || 720; this.bpp = 32; this.stride = this.w * 4; this.fd = null;
    } else if (kms) {
      Object.assign(this, { w: kms.w, h: kms.h, stride: kms.stride, bpp: 32, sock: kms.sock });
      this.fd = -1; // not a file: flush() streams to the socket
    } else {
      const i = fbInfo(OUTPUT);
      Object.assign(this, i);
      this.fd = fs.openSync('/dev/' + OUTPUT, 'r+');
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
    this.shown = null; this.flushes = 0; // what is on the framebuffer now (flush)
  }
  // paint matrix into the pixel buffer; dark "unlit" dots are drawn very faintly like a real panel
  draw(m) {
    // full repaint every ~2 s in case kernel/console text was printed over the framebuffer;
    // every frame during the first ~5 s (boot messages, fbcon handover)
    if (++this.frames <= 2 || Date.now() - (this.lastFull || 0) > 15000) { this.prev = null; this.lastFull = Date.now(); } // full repaint: at start and every 15 s (was every 2 s: a visible hiccup in VMs)
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
    if (this.fd !== null && ownVtActive(true)) this.flush(); // re-check right before writing: after Alt+F2 fbcon has just redrawn tty2
    if (under) { under.data.copy(frame, 0, 0, 0); this.restoreCursor(under, bytes); }
  }
  // native mode: copy an RGB canvas (vector theme) into the framebuffer format
  // convert=false: the frame still holds the converted canvas (only the cursor moved), skip the conversion
  // regions: [{x, y, w, h}] = only these rectangles changed (scrollers), convert just them
  drawCanvas(cv, convert = true, regions = null) {
    const { frame, stride, bpp } = this;
    const bytes = bpp / 8, rgb = cv.rgb, f = this.qf || 1; // f: the canvas is f times smaller than the screen
    const fast = bytes === 4 && stride === this.w * 4 && frame.byteOffset % 4 === 0;
    if (!convert) { /* frame is current */ }
    else if (f > 1 && fast) { // enlarge by f: convert each source row once, then copy it f - 1 times
      const out = new Uint32Array(frame.buffer, frame.byteOffset, frame.length >> 2), W = this.w, H = this.h;
      const box = regions || [{ x: 0, y: 0, w: cv.w, h: cv.h }];
      for (const r of box) {
        for (let sy = Math.max(0, r.y); sy < Math.min(cv.h, r.y + r.h); sy++) {
          const dy = sy * f, x0 = r.x * f, x1 = Math.min(W, (r.x + r.w) * f);
          if (dy >= H) break;
          let i = (sy * cv.w + r.x) * 3, o = dy * W + x0;
          for (let sx = 0; sx < r.w && o < dy * W + x1; sx++, i += 3) {
            const px = 0xff000000 | (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
            for (let k = 0; k < f && x0 + sx * f + k < x1; k++) out[o++] = px;
          }
          for (let j = 1; j < f && dy + j < H; j++) frame.copy(frame, (dy + j) * stride + x0 * 4, dy * stride + x0 * 4, dy * stride + x1 * 4);
        }
      }
    } else if (f > 1) { // other pixel formats: plain nearest-neighbour loop
      for (let y = 0; y < this.h; y++) {
        let o = y * stride; const sy = Math.min(cv.h - 1, Math.floor(y / f));
        for (let x = 0; x < this.w; x++, o += bytes) {
          const i = (sy * cv.w + Math.min(cv.w - 1, Math.floor(x / f))) * 3;
          if (bytes === 2) frame.writeUInt16LE(((rgb[i] >> 3) << 11) | ((rgb[i + 1] >> 2) << 5) | (rgb[i + 2] >> 3), o);
          else { frame[o] = rgb[i + 2]; frame[o + 1] = rgb[i + 1]; frame[o + 2] = rgb[i]; if (bytes === 4) frame[o + 3] = 255; }
        }
      }
    } else if (regions && fast) {
      const out = new Uint32Array(frame.buffer, frame.byteOffset, frame.length >> 2);
      for (const r of regions) {
        for (let y = Math.max(0, r.y); y < Math.min(this.h, r.y + r.h); y++) {
          let p = y * this.w + r.x, i = p * 3;
          for (let x = 0; x < r.w; x++, p++, i += 3) out[p] = 0xff000000 | (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
        }
      }
    } else if (bytes === 4 && stride === this.w * 4 && frame.byteOffset % 4 === 0) {
      // fast path: one 32-bit store per pixel (little endian: B G R A)
      const out = new Uint32Array(frame.buffer, frame.byteOffset, frame.length >> 2), n = this.w * this.h;
      for (let p = 0, i = 0; p < n; p++, i += 3) out[p] = 0xff000000 | (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    } else {
      for (let y = 0; y < this.h; y++) {
        let o = y * stride, i = y * this.w * 3;
        for (let x = 0; x < this.w; x++, o += bytes, i += 3) {
          if (bytes === 4) { frame[o] = rgb[i + 2]; frame[o + 1] = rgb[i + 1]; frame[o + 2] = rgb[i]; frame[o + 3] = 255; }
          else if (bytes === 2) frame.writeUInt16LE(((rgb[i] >> 3) << 11) | ((rgb[i + 1] >> 2) << 5) | (rgb[i + 2] >> 3), o);
          else { frame[o] = rgb[i + 2]; frame[o + 1] = rgb[i + 1]; frame[o + 2] = rgb[i]; }
        }
      }
    }
    this.prev = null; // the LED path must repaint everything next time
    this.look = null;
    const put = (o, col) => { frame[o] = col[2]; frame[o + 1] = col[1]; frame[o + 2] = col[0]; if (bytes === 4) frame[o + 3] = 255; };
    const under = pointer.visible ? this.drawCursor(put, bytes) : null;
    if (this.fd !== null && ownVtActive(true)) this.flush(); // re-check right before writing: after Alt+F2 fbcon has just redrawn tty2
    if (under) this.restoreCursor(under, bytes);
  }
  // Write only the rows that differ from what is already on screen: a full 1280x800x4 frame per tick is
  // ~4 MB, which is slow on emulated VGA (VirtualBox, QEMU TCG). Every ~2 s and after a VT switch the whole
  // frame goes out anyway, in case console text was printed over the framebuffer.
  flush() {
    const { stride } = this;
    let frame = this.frame;
    const gain = this.gain ?? 1;
    if (gain < 0.995 && this.bpp === 32) { // brightness from the schedule / "off": scale the colour bytes into a second buffer
      const d = this.dimBuf && this.dimBuf.length === frame.length ? this.dimBuf : (this.dimBuf = Buffer.alloc(frame.length));
      for (let i = 0; i < frame.length; i += 4) { d[i] = frame[i] * gain; d[i + 1] = frame[i + 1] * gain; d[i + 2] = frame[i + 2] * gain; d[i + 3] = 255; }
      frame = d;
    }
    if (this.sock) { // odjezdy-kms takes whole frames; drop this one if the previous is still on its way
      if (this.sock.writableLength === 0 && !this.sock.destroyed) this.sock.write(Buffer.from(frame));
      return;
    }
    if (!this.shown || ++this.flushes <= 3 || Date.now() - (this.lastFullWrite || 0) > 15000) { // whole frame: at start, every 15 s
      const w0 = Date.now();
      fs.writeSync(this.fd, frame, 0, frame.length, 0);
      perf.write += Date.now() - w0; perf.bytes += frame.length;
      this.lastFullWrite = Date.now();
      this.shown = Buffer.from(frame);
      return;
    }
    let y0 = -1;
    const out = (a, b) => { const o = a * stride, n = (b - a) * stride, w0 = Date.now(); fs.writeSync(this.fd, frame, o, n, o); perf.write += Date.now() - w0; perf.bytes += n; frame.copy(this.shown, o, o, o + n); };
    for (let y = 0; y < this.h; y++) {
      const o = y * stride;
      const same = frame.compare(this.shown, o, o + stride, o, o + stride) === 0;
      if (!same && y0 < 0) y0 = y;
      else if (same && y0 >= 0) { out(y0, y); y0 = -1; }
    }
    if (y0 >= 0) out(y0, this.h);
  }
  // arrow sprite drawn on top of the frame, the pixels below are restored after the write
  drawCursor(put, bytes) {
    const scale = Math.max(1, Math.round(this.w / 640)); // 2x at 1280 px wide, 3x at 1920
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
// source names have stray commas and missing spaces: "Teplice,,Hlavní nádraží", "Dubí,lázně", "Ústí n.L.hl.n."
const tidyName = (n) => (typeof n === 'string' ? n.replace(/,+(?=\S)/g, ', ').replace(/\.(?=\p{Ll}{2})/gu, '. ') : n);
function stopLabel(s) {
  if (!s) return '';
  s = { ...s, name: tidyName(s.name) };
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
function log(s) {
  const line = `[${new Date().toISOString()}] ${s}\n`;
  try { fs.appendFileSync('/tmp/odjezdy.log', line); } catch {}
  if (!PNG_OUT && !process.stdout.isTTY) { try { process.stderr.write(line); } catch {} } // under a Wayland compositor / systemd: into the journal
}
if (!PNG_OUT) {
  process.on('exit', (c) => log('board exiting, code ' + c + ', up ' + Math.round(process.uptime()) + ' s'));
  process.on('SIGTERM', () => log('SIGTERM received'));
  process.on('SIGHUP', () => log('SIGHUP received'));
}

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

// Real departure time: the expected time when the source gives one. Some sources (ČD trains) send a delay but no
// expected time, or one that is not shifted by it: then it is planned time + delay, so a delayed train stays on the
// board until it really leaves instead of vanishing at its planned time.
function depTime(d) {
  const p = new Date(d.plannedTime).getTime();
  let e = d.expectedTime ? new Date(d.expectedTime).getTime() : p;
  const delay = Number.isFinite(d.delayMinutes) ? d.delayMinutes * 60000 : Number.isFinite(d.delaySeconds) ? d.delaySeconds * 1000 : 0;
  if (delay >= 60000 && e < p + delay - 30000) e = p + delay;
  return e;
}
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
  const stopKey = cacheKey();
  const j = await getJson(`${TRANSITOUS}/api/v1/stoptimes?stopId=${encodeURIComponent(id)}&n=60${radius ? '&radius=' + radius : ''}`);
  if (cacheKey() !== stopKey) return; // stop changed while waiting
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
// A stop-level alert as one line of text for the marquee/notice, remembering its details and validity
// (state.alertInfo, keyed by that text) for the full-screen notice: summary = headline, details = the specifics.
const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const fmtDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}. ${d.getMonth() + 1}.`; };
function validityText(a) {
  const from = a.validFrom ? fmtDay(a.validFrom) : '', to = a.validTo && new Date(a.validTo).getTime() - Date.now() < 366 * 86400000 ? fmtDay(a.validTo) : '';
  if (from && to && from === to) { // one day: with the hours when it is not the whole day
    const f = new Date(a.validFrom), t = new Date(a.validTo), hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `Platí ${from}` + (hm(f) !== '0:00' || hm(t) !== '23:59' ? ` ${hm(f)}–${hm(t)}` : '');
  }
  if (from && to) return `Platí od ${from} do ${to}`;
  return to ? `Platí do ${to}` : from ? `Platí od ${from}` : '';
}
// An alert is shown at a stop only while it is valid or starts within 36 hours (a diversion planned for 31 October
// is not a "Mimořádnost" on the 18th), and not after it ended.
function alertActive(a) {
  const now = Date.now();
  if (a.validTo && new Date(a.validTo).getTime() < now) return false;
  if (a.validFrom && new Date(a.validFrom).getTime() > now + 36 * 3600000) return false;
  return true;
}
// Alerts the server relates to this stop only through a line (the closure itself is elsewhere, e.g. R15 replaced by buses
// near Kadaň while the board is Praha): at most 3, only matches by line, and the text says which lines it is about, so
// it does not read as if it concerned the whole stop. Matches by the stop's name in the text are not shown (unreliable).
function scopedRelated(j) {
  const here = new Set((j.data || []).map((d) => String(d.line)));
  return (j.relatedAlerts || []).filter((a) => a.match === 'line').slice(0, 3).map((a) => {
    const ls = (a.lines || []).map(String), mine = ls.filter((l) => here.has(l)), show = (mine.length ? mine : ls).slice(0, 4);
    const head = cleanText(a.summary || a.title);
    if (!show.length || !head) return a;
    return { ...a, summary: `${show.length > 1 ? 'Linky' : 'Linka'} ${show.join(', ')}${show.length < (mine.length || ls.length) ? '…' : ''}: ${head}` };
  });
}
function noteAlert(a) {
  const text = cleanText(a.summary || a.title);
  if (!text) return '';
  // details from the server; without them, a title the source cut off ("přetrasování ...") is completed from the
  // full description (the source's own text, e.g. DÚK), so notices are not cut off
  let details = cleanText(a.details);
  if (!details && /(\.\.\.|…)$/.test(text) && (a.description || a.text)) details = cleanText(a.description || a.text).slice(0, 420);
  // the source's own wording (DÚK / SŽ / ČD / PID …), unchanged, shown under the summary when there is room
  let original = cleanText(a.originalText || a.text || a.description);
  const ot = cleanText(a.originalTitle || a.title);
  if (ot && !original.startsWith(ot.replace(/\s*(\.\.\.|…)$/, ''))) original = ot + (original ? ': ' + original : '');
  if (original && original === details) original = '';
  // links the source gave (the page of the notice, attached PDFs): shown as short text, nobody can click on a board
  const host = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : ''); } catch { return ''; } };
  const names = [...new Set((a.attachments || []).map((t) => cleanText(t.name).replace(/\.pdf$/i, '')).filter(Boolean))].slice(0, 4);
  const links = [a.sourceUrl && 'Více: ' + host(a.sourceUrl), names.length && 'Přílohy: ' + names.join(', ')].filter(Boolean).join(' · ');
  (state.alertInfo ||= new Map()).set(text, { details, valid: validityText(a), kind: a.kind || '', original: original.slice(0, 600), source: a.sourceName || '', links });
  return text;
}
// small print under a notice: the source's own wording and the links it gave
function noticeFootnote(info) {
  return [info.original && 'Původní znění' + (info.source ? ' (' + info.source + ')' : '') + ': ' + info.original, info.links].filter(Boolean).join('  ');
}
// the notice as one line for marquees: headline and details together (details repeating the headline are not doubled)
function fullAlertText(text) {
  const d = state.alertInfo?.get(text)?.details;
  if (!d) return text;
  const head = text.replace(/\s*(\.\.\.|…)$/, '').trim(), lower = (x) => x.toLowerCase();
  return lower(d).startsWith(lower(head).slice(0, 24)) ? d : `${head}: ${d}`;
}
async function fetchBoardRows(ids) {
  if (await hasApiV2()) {
    try {
      const j = await getJson(`/api/v2/departures?stopIds=${ids.map(encodeURIComponent).join(',')}&limit=120`);
      // PID notices from the departure board itself (infotexts: inline strip / full-screen) plus our alerts
      state.v2Alerts = [...(j.infotexts || []).map((i) => cleanText(i.text)), ...[...(j.alerts || []), ...scopedRelated(j)].filter(alertActive).filter((al) => {
        // an alert that names no stops and was matched by line number only belongs to this stop only when a departure
        // of the alert's own operator runs here (a DÚK alert about U1/R15 must not follow ČD's R15 to Praha)
        const provs = new Set((j.data || []).map((d) => d.provider));
        return !al.provider || (al.stops && al.stops.length) || provs.has(al.provider);
      }).map(noteAlert)].filter(Boolean);
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

// destination reduced to a comparable key: "Nymburk hl.n." and "Nymburk hlavní nádraží" are the same place
const railDestKey = (n) => stripAccents(String(n || '').toLowerCase()).replace(/hlavni nadrazi|hl\.? ?n\.?/g, '').replace(/[^a-z]/g, '').slice(0, 8);
async function refreshBoard() {
  if (isTransitous()) return refreshTransitous();
  const ids = state.cfg.stop.ids.slice(0, 8);
  if (!ids.length) return;
  const stopKey = cacheKey(); // the stop this request is for: a late answer must not overwrite another stop's board
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
  if (cacheKey() !== stopKey) return; // stop changed while waiting
  state.fallback = null;
  const now = Date.now(), seen = new Map(), all = [];
  for (const d of rows) {
    if (!d.expectedTime || new Date(d.expectedTime).getTime() !== depTime(d)) d.expectedTime = new Date(depTime(d)).toISOString(); // shown as the new time by themes
    if (depTime(d) < now - 60000) continue;
    // richer fields from the odjezdy.online rewrite backend (absent on the old API -> no change)
    if (d.terminatesHere) continue; // the train ends here: an arrival, not a departure
    if (d.trainNumber && !d.train) d.train = `${d.category || d.line || ''} ${d.trainNumber}`.trim();
    // "Neznámá stanice" from the server is a placeholder, not a destination (LE trains, some RJ): say so plainly
    if (d.destinationConfident === false || /^Neznámá stanice$/i.test(d.destination || '')) { d.destination = 'cíl neuveden'; d.noDest = true; }
    d.via = Array.isArray(d.viaStops) ? d.viaStops : [];
    // the same train often comes from several sources at a station (ČD + DÚK + PID): one row per train
    // number and minute, keeping the copy that knows more (destination, platform, delay)
    const minute = Math.floor(new Date(d.plannedTime).getTime() / 60000);
    const k = d.trainNumber ? `T|${String(d.trainNumber).replace(/\D/g, '')}|${minute}` : `${d.line}|${d.destination}|${minute}`;
    // PID rows (line S7, no train number) and ČD rows (Os 9972) of the same train have no number in common: same minute,
    // same destination and another provider = the same train
    const rail = d.type === 'train' || d.type === 'rail';
    const rk = rail ? `R|${minute}|${railDestKey(d.destination)}` : '';
    let prev = seen.get(k);
    if (!prev && rk) { const q = seen.get(rk); if (q && q.provider !== d.provider) prev = q; }
    if (prev) {
      const score = (x) => (x.destination ? 4 : 0) + (x.platform && !/^(N[/]A|Neznámé|unknown)$/i.test(x.platform) ? 2 : 0) + (Number.isFinite(x.delayMinutes) ? 1 : 0) + (x.trainNumber ? 1 : 0);
      const win = score(d) > score(prev) ? d : prev, lose = win === d ? prev : d;
      for (const f of ['platform', 'trainNumber', 'category', 'operator', 'delayMinutes', 'delaySeconds', 'expectedTime']) { // fill what the better copy lacks
        const empty = (v) => v == null || v === '' || /^(N[/]A|Neznámé|unknown)$/i.test(String(v));
        if (empty(win[f]) && !empty(lose[f])) win[f] = lose[f];
      }
      const numbered = (l) => /^[SRU]\d+$/i.test(String(l || '')); // the PID line (S7, R15) is the better label than the bare category "Os"
      if (!numbered(win.line) && numbered(lose.line)) win.line = lose.line;
      if (win.trainNumber && !win.train) win.train = `${win.category || win.line || ''} ${win.trainNumber}`.trim();
      if (win !== prev) { all[all.indexOf(prev)] = win; }
      seen.set(k, win); if (rk) seen.set(rk, win);
      continue;
    }
    seen.set(k, d); if (rk) seen.set(rk, d); all.push(d);
  }
  all.sort((a, b) => depTime(a) - depTime(b));
  for (const d of all) { d.destination = tidyName(d.destination); if (d.via) d.via = d.via.map(tidyName); }
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
  state.alerts = list.filter(alertActive).filter((a) =>
    (a.stops || []).some((s) => norm(s) === name || name.includes(norm(s))) ||
    (a.provider === 'PID' && (a.lines || []).some((l) => lines.has(String(l))))
  ).map(noteAlert);
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
let nativeCanvas = null, lastNative = 0, lastCursorDraw = 0, nativeCost = 0;
// Scrollers: a marquee that moves between theme frames. The theme registers it while rendering (api.scroller); the
// text is rendered once into a strip and a small window of it is copied into the canvas and the screen every ~33 ms,
// so scrolling stays smooth even when the whole theme can only be re-rendered a few times a second (VMs, 1080p).
const scrollers = [];
let lastScroll = 0, overlayRect = null; // where the full-screen notice covers the canvas (scrollers must not paint there)
function scrollerPaint(cv, sc, now) {
  vector.paintStrip(cv, sc.strip, sc.x, sc.y, sc.w, sc.h, ((now - sc.t0) / 1000) * sc.speed, sc.gap, sc.bg);
}
const scrollPhase = new Map(); // text -> start time, so the movement continues when the theme is re-rendered
function scrollerRegister(cv, o) {
  const strip = vector.makeStrip(o.text, o.font, o.size, o.color, o.bg, o.h, o.baseline);
  const key = o.text.slice(0, 200) + '|' + Math.round(o.w);
  if (!scrollPhase.has(key)) { if (scrollPhase.size > 20) scrollPhase.clear(); scrollPhase.set(key, Date.now()); }
  const sc = { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h), strip, speed: o.speed || 90, gap: Math.round(o.gap || 120), bg: o.bg, t0: scrollPhase.get(key) };
  if (strip.w <= sc.w) { scrollerPaint(cv, { ...sc, speed: 0, gap: sc.w }, sc.t0); return; } // gap = box width: one copy only, no repeat // fits: static, nothing to animate
  scrollers.push(sc);
  scrollerPaint(cv, sc, Date.now()); // paint where the text is NOW (painting at the start made it jump back at every theme re-render)
}
// called every ~33 ms: move the scrollers, convert only their rectangles, write only the changed rows
function scrollTick() {
  if (!scrollers.length || !nativeCanvas || !screen || state.mode !== 'board' || PNG_OUT) return;
  if (!ownVtActive()) return;
  const now = Date.now(), notice = state.cfg.custom?.disruptions !== false && disruptionSlot(now - t0);
  // while a notice is on screen the scrollers keep running, except those that would paint over the notice
  const r = notice ? (overlayRect || { x: 0, y: 0, w: 1e9, h: 1e9 }) : null;
  const live = r ? scrollers.filter((sc) => !(sc.x < r.x + r.w && sc.x + sc.w > r.x && sc.y < r.y + r.h && sc.y + sc.h > r.y)) : scrollers;
  if (!live.length) return;
  for (const sc of live) scrollerPaint(nativeCanvas, sc, now);
  screen.drawCanvas(nativeCanvas, true, live);
}
function renderNativeBoard(t) {
  const th = currentTheme();
  if (!vector || typeof th.renderNative !== 'function' || state.cfg.custom?.style === 'led') return false;
  if (state.cfg.custom?.font && state.cfg.custom.font !== 'theme') return false; // user forced an LED font
  // Theme frames at ~5 fps (clock seconds, marquee), slower when a frame is expensive (emulated GPUs in VMs,
  // slow CPUs): the interval follows 4x the measured cost, at most 1 fps. Between theme frames only the cursor
  // moves: the last canvas is reused, no re-render and no re-conversion.
  const gap = Math.min(1000, Math.max(180, nativeCost * 4));
  if (Date.now() - lastNative < gap) {
    if (nativeCanvas && pointer.visible && (pointer.x !== pointer.drawnX || pointer.y !== pointer.drawnY) && Date.now() - lastCursorDraw > 30) {
      pointer.drawnX = pointer.x; pointer.drawnY = pointer.y; lastCursorDraw = Date.now();
      screen.drawCanvas(nativeCanvas, false);
    }
    return true;
  }
  const t1 = Date.now();
  lastNative = t1;
  pointer.drawnX = pointer.x; pointer.drawnY = pointer.y;
  // Quality: "auto" lowers the render size (x1/2, x1/3) when frames take too long (slow CPU / emulated graphics);
  // the setting can force a factor. Everything the themes lay out scales with the canvas size, so they just get smaller.
  const qs = state.cfg.custom?.quality ?? 'auto';
  if (qs !== 'auto' && Number(qs) !== qualityFactor) { qualityFactor = Math.max(1, Math.min(4, Number(qs) || 1)); nativeCanvas = null; }
  const cw = Math.ceil(screen.w / qualityFactor), ch = Math.ceil(screen.h / qualityFactor);
  if (!nativeCanvas || nativeCanvas.w !== cw || nativeCanvas.h !== ch) { nativeCanvas = new vector.Canvas(cw, ch); screen.qf = qualityFactor; screen.shown = null; }
  scrollers.length = 0; overlayRect = null;
  try {
    th.renderNative(nativeCanvas, t, themeApi);
    if (state.cfg.custom?.disruptions !== false) nativeDisruption(nativeCanvas, t, th);
    if (state.toast && Date.now() < state.toast.until) {
      const c = nativeCanvas, s = c.h / 720, w = c.measure(state.toast.text, 'FiraSans-Bold', 28 * s) + 60 * s;
      c.roundRect((c.w - w) / 2, c.h / 2 - 32 * s, w, 64 * s, 10 * s, [255, 255, 255]);
      c.text(state.toast.text, c.w / 2, c.h / 2 + 10 * s, { font: 'FiraSans-Bold', size: 28 * s, color: [20, 20, 40], align: 'center' });
    }
    if (state.perfShow) { // V key: the performance numbers on the screen
      const c = nativeCanvas, s = Math.max(0.5, c.h / 720), txt = perf.last || perfSummary();
      c.rect(0, 0, c.w, 28 * s, [0, 0, 0]);
      c.text(txt, 8 * s, 20 * s, { font: 'FiraSans-Regular', size: 17 * s, color: [255, 255, 80], maxW: c.w - 16 * s });
    }
  } catch (e) { log('native render: ' + e.stack); return false; }
  const t2 = Date.now(), w0 = perf.write;
  screen.drawCanvas(nativeCanvas);
  const t3 = Date.now(), writeMs = perf.write - w0;
  perf.frames++; perf.render += t2 - t1; perf.convert += t3 - t2 - writeMs;
  nativeCost = nativeCost * 0.7 + (t3 - t1) * 0.3; // render + convert + write to the screen
  // auto quality: a few slow frames in a row while the time goes into rendering/conversion (not into writing,
  // which a smaller canvas does not speed up) -> render smaller; at most half size (1/3 only by the setting)
  if (qs === 'auto') {
    if (Date.now() - bootAt > 10000 && t3 - t1 > 160 && writeMs < (t3 - t1) * 0.45 && qualityFactor < 2) { if (++slowFrames >= 8) { qualityFactor++; slowFrames = 0; nativeCanvas = null; nativeCost = 0; log(`quality: frames too slow (${t3 - t1} ms), rendering at 1/${qualityFactor}`); } }
    else {
      slowFrames = 0;
      // back to full quality once the smaller canvas shows frames are cheap (cost at full size ~ cost x f^2)
      if (qualityFactor > 1 && nativeCost * qualityFactor * qualityFactor < 100) { if (++fastFrames >= 40) { qualityFactor--; fastFrames = 0; nativeCanvas = null; nativeCost = 0; log('quality: frames fast again, rendering at 1/' + qualityFactor); } }
      else fastFrames = 0;
    }
  }
  return true;
}
function nativeDisruption(c, t, th) {
  const slot = disruptionSlot(t);
  if (!slot) return;
  const text = slot.text;
  if (typeof th.renderAlertNative === 'function') { overlayRect = { x: 0, y: 0, w: c.w, h: c.h }; return th.renderAlertNative(c, t, themeApi, text); }
  const s = c.h / 720, font = th.nativeFont || 'FiraSans-Bold';
  const words = String(text).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const n = cur ? cur + ' ' + w : w;
    if (c.measure(n, font, 30 * s) > c.w - 240 * s && cur) { lines.push(cur); cur = w; } else cur = n;
  }
  if (cur) lines.push(cur);
  // body text in the regular cut of the theme font; not every family has one (Barlow Condensed: Medium)
  const body = [font.replace(/-(Semi)?Bold$/, '-Regular'), font.replace(/-(Semi)?Bold$/, '-Medium'), font].find((f) => vector.findFont(f));
  // headline (the summary), then the details and the validity when the server provides them
  const info = state.alertInfo?.get(text) || {};
  const detailLines = [];
  let dcur = '';
  for (const w of String(info.details || '').split(/\s+/).filter(Boolean)) {
    const n = dcur ? dcur + ' ' + w : w;
    if (c.measure(n, body, 24 * s) > c.w - 240 * s && dcur) { detailLines.push(dcur); dcur = w; } else dcur = n;
  }
  if (dcur) detailLines.push(dcur);
  const shown = lines.slice(0, 5), det = detailLines.slice(0, Math.max(5, Math.floor((c.h - 110 * s - shown.length * 42 * s - 100 * s) / (34 * s))));
  let h = 110 * s + shown.length * 42 * s + (det.length ? 12 * s + det.length * 34 * s : 0) + (info.valid ? 40 * s : 0);
  // the source's original wording, small, in whatever room is left
  const orig = [];
  if (info.original || info.links) {
    let ocur = '';
    for (const w of noticeFootnote(info).split(/\s+/)) {
      const n = ocur ? ocur + ' ' + w : w;
      if (c.measure(n, body, 20 * s) > c.w - 240 * s && ocur) { orig.push(ocur); ocur = w; } else ocur = n;
    }
    if (ocur) orig.push(ocur);
    orig.splice(Math.max(0, Math.min(5, Math.floor((c.h * 0.94 - h - 10 * s) / (27 * s)))));
    if (orig.length) h += 10 * s + orig.length * 27 * s;
  }
  // The notice takes the place of the departures, in the colours and the lettering of the theme (a theme can set alertStyle
  // { bg, ink, accent, dim, dots }; otherwise they come from its background and colour slots)
  const al = th.alertStyle || {}, pick = (n, d) => (Array.isArray(th.colors?.[n]) ? th.colors[n] : d);
  const bg = al.bg || th.background || [0, 0, 0], light = bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11 > 150;
  const ink = al.ink || (light ? [20, 24, 36] : pick(1, [255, 255, 255])), accent = al.accent || (pick(3, null) && !light ? pick(3, [236, 0, 22]) : [220, 20, 30]);
  const dim = al.dim || (light ? [90, 96, 112] : pick(2, [170, 170, 170]));
  const y0 = Math.max(10 * s, (c.h - h) / 2), x0 = 90 * s;
  overlayRect = { x: 0, y: 0, w: c.w, h: c.h };
  c.clear(bg);
  c.rect(60 * s, y0, 10 * s, h, accent);
  c.text('Mimořádnost', x0, y0 + 62 * s, { font, size: 40 * s, color: accent });
  let yy = y0 + 112 * s;
  shown.forEach((l) => { c.text(l, x0, yy, { font, size: 30 * s, color: ink }); yy += 42 * s; });
  if (det.length) { yy += 12 * s - 6 * s; det.forEach((l) => { c.text(l, x0, yy, { font: body, size: 24 * s, color: ink, alpha: 0.85 }); yy += 34 * s; }); }
  if (info.valid) { c.text(info.valid, x0, yy + 8 * s, { font, size: 24 * s, color: accent }); yy += 40 * s; }
  if (orig.length) { yy += 6 * s; orig.forEach((l) => { c.text(l, x0, yy, { font: body, size: 20 * s, color: dim }); yy += 27 * s; }); }
  if (al.dots) c.dotScreen(Math.max(2, Math.round(c.w / al.dots)), { bg, off: al.off || [12, 10, 6] });
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
  return String(d.platform).replace(/^(nástupiště|nást\.?|kolej|kol\.?|k\.)\s*/i, '').replace(/\s*\/.*$/, '').trim(); // "Kol. 12" -> "12", "3 / kolej 2" -> "3"
};
const upcoming = () => state.deps.filter((d) => depTime(d) > Date.now() - 30000);
function statusText() {
  const pid = state.deps.some((d) => d.provider === 'PID') ? ' · data PID (Golemio)' : ''; // attribution for PID data
  const src = (isTransitous() ? 'data Transitous · transitous.org/sources'
    : state.fallback ? `záložní data Transitous (odjezdy.online: ${state.fallback}) · transitous.org/sources` : 'data odjezdy.online') + pid;
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
// When the full-screen notice is up: once per period (setting: 2 min default, 5 min, off), all current
// disruptions back to back, 9 s each. Returns { text, i, n, phase } or null.
function disruptionSlot(t) {
  const list = currentDisruptions();
  const set = state.cfg.custom?.disruptions;
  if (!list.length || set === false) return null;
  const PERIOD = set === 5 ? 300000 : 120000, SHOW = 9000;
  const phase = (t + PERIOD - 20000) % PERIOD; // first one ~20 s after start, not immediately
  const i = Math.floor(phase / SHOW);
  if (i >= list.length) return null;
  return { text: list[i], i, n: list.length, phase: phase - i * SHOW };
}
function currentDisruptions() {
  const list = [...state.alerts];
  for (const d of upcoming().slice(0, 12)) {
    if (d.cancelled) list.push(`Spoj ${d.train || d.line} → ${d.destination} (${hhmm(new Date(d.plannedTime))}) dnes odpadá.`);
  }
  return [...new Set(list)];
}
function renderDisruption(m, t) {
  const slot = disruptionSlot(t);
  if (!slot) return false;
  const { text, phase } = slot, list = { length: slot.n };
  const th = currentTheme();
  if (typeof th.renderAlert === 'function') { th.renderAlert(m, t, themeApi, text); return true; }
  const W = m.cols, big = face('big').rows, nor = face('normal').rows;
  const info = state.alertInfo?.get(text) || {}, sm = face('small').rows;
  const lines = wrapText(text, 'normal', W - 16, Math.max(2, Math.min(5, Math.floor((m.rows - big - 30) / (nor + 3)) - 2)));
  const room = Math.max(0, Math.floor((m.rows - big - 8 - lines.length * (nor + 3) - (info.valid ? sm + 4 : 0)) / (sm + 2)));
  const det = info.details ? wrapText(info.details, 'small', W - 16, Math.min(8, room)) : [];
  let h = big + 10 + lines.length * (nor + 3) + (det.length ? 4 + det.length * (sm + 2) : 0) + (info.valid ? sm + 4 : 0) + 6;
  const orig = info.original || info.links ? wrapText(noticeFootnote(info), 'small', W - 16, Math.max(0, Math.min(4, Math.floor((m.rows - h - 8) / (sm + 2))))) : [];
  if (orig.length && Math.floor((m.rows - h - 8) / (sm + 2)) > 0) h += 4 + orig.length * (sm + 2); else orig.length = 0;
  const y0 = Math.max(0, Math.floor((m.rows - h) / 2));
  for (let y = y0; y < y0 + h; y++) for (let x = 0; x < W; x++) m.set(x, y, 0);
  m.hline(0, W - 1, y0, C.RED);
  m.hline(0, W - 1, y0 + h - 1, C.RED);
  // blinking warning title, like "Störung" / "Mimořádnost" screens
  if (Math.floor(t / 700) % 2 === 0 || phase > 2800) m.textCenter('Mimořádnost', y0 + 4, 'big', C.RED);
  let yy = y0 + big + 8;
  lines.forEach((l) => { m.textCenter(l, yy, 'normal', C.WHITE); yy += nor + 3; });
  yy += det.length ? 4 : 0;
  det.forEach((l) => { m.textCenter(l, yy, 'small', C.AMBER); yy += sm + 2; });
  if (info.valid) m.textCenter(info.valid, yy + 2, 'small', C.RED);
  if (orig.length) { yy += info.valid ? sm + 6 : 2; orig.forEach((l) => { m.textCenter(l, yy, 'small', C.DIM); yy += sm + 2; }); }
  if (list.length > 1) m.textRight(`${slot.i + 1}/${list.length}`, W - 3, y0 + 4, 'small', C.DIM);
  return true;
}
// short operator label for themes: the server's provider code is a data source (JDF = the national timetable
// data, DUK = Ústecký kraj), not always something a passenger knows, so JDF is not shown
const PROVIDER_LABEL = { JDF: '', DUK: 'DÚK' };
const providerLabel = (d) => (d.provider in PROVIDER_LABEL ? PROVIDER_LABEL[d.provider] : d.provider || '');
// a train row without a platform gets a small train symbol (private-use glyph U+E000, drawn by the LED fonts and the vector canvas)
const TRAIN = '\uE000';
const isRailRow = (d) => d.type === 'train' || d.type === 'rail';
const platMark = (d) => platformOf(d) || (isRailRow(d) ? TRAIN : '');
// train number as small print: "Os 6920" when the line is only a category, "č. 244" next to a numbered line (U3, R15)
const trainTag = (d) => (isRailRow(d) && d.trainNumber ? (/^[A-Za-z]{1,3}$/.test(String(d.line || '').trim()) ? `${String(d.line).trim()} ${d.trainNumber}` : /^[A-Za-z]{1,3}$/.test(String(d.category || '').trim()) ? `${String(d.category).trim()} ${d.trainNumber}` : `č. ${d.trainNumber}`) : '');
const platLabel = (d, prefix = '') => { const p = platformOf(d); return p ? prefix + p : isRailRow(d) ? TRAIN : ''; };
const themeApi = {
  platMark, platLabel, trainTag,
  providerLabel,
  vector: () => vector,
  state, C, FONTS: FONT_VIEW, textWidth, fitText, faceCovers, wrapText, stopLabel, hhmm, pad2,
  depTime, minutesTo, platformOf, upcoming, depNotice, hasDelay, delayLabel, delayColor, layout, statusText,
  paging: () => state.cfg.custom?.paging !== false,
  tickCount: () => state.tickN || 0, // counts display ticks: LED marquees move exactly one dot per tick
  scroller: (cv, o) => scrollerRegister(cv, o), // marquee that keeps moving between theme frames (see scrollers)
  alertLines: () => state.alerts.map(fullAlertText), // stop notices with their details, for marquees
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
  items.push({ theme: true, label: 'Vzhled tabule: ' + currentTheme().name + ' (vybrat ze seznamu)…' });
  items.push({ settings: true, label: 'Nastavení vzhledu (barva, styl, jas, kurzor)…' });
  if (state.displays.length > 1) items.push({ displays: true, label: `Displeje (${state.displays.length})…` });
  if (system.wifi.available()) items.push({ wifi: true, label: 'Wi-Fi a síť…' });
  if ((LIVE || process.env.ODJEZDY_INSTALL_CMD) && system.installer.available()) items.push({ install: true, label: 'Nainstalovat do počítače…' });
  if (admin) items.push({ admin: true, label: 'Správa na dálku (web)…' });
  items.push({ update: true, label: state.update?.info ? `Aktualizovat na verzi ${state.update.info.version}…` : `Aktualizace (verze ${APP_VERSION})…` });
  state.start = { items, sel: 0, until: withCountdown ? Date.now() + START_TIMEOUT : 0 };
  state.mode = 'start';
}

function chooseStop(stop) {
  if (state.editDisplay > 0) { // picked from the Displeje screen for a child display
    const n = state.editDisplay;
    state.editDisplay = 0;
    displayCfgSet(n, { stop: pickStop(stop) });
    state.mode = 'displays';
    return;
  }
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
  const first = scrollFirst(b, b.sel, rows, items.length);
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
  { key: 'disruptions', label: 'Oznámení mimořádností', values: () => [true, 5, false], show: (v) => (v === false ? 'vypnutá' : v === 5 ? 'každých 5 min' : 'každé 2 min') },
  { key: 'updates', label: 'Aktualizace', values: () => ['ask', 'auto', 'off'], show: (v) => ({ ask: 'zeptat se', auto: 'automaticky', off: 'vypnuté' })[v || 'ask'] },
  { key: 'fallback', label: 'Záloha Transitous při výpadku', values: () => [true, false], show: (v) => (v === false ? 'vypnutá' : 'zapnutá') },
  { key: 'quality', label: 'Kvalita obrazu', values: () => ['auto', 1, 2, 3], show: (v) => ({ auto: 'automatická', 1: 'plná', 2: 'úsporná (poloviční)', 3: 'velmi úsporná (třetinová)' })[v ?? 'auto'] },
  { key: 'paging', label: 'Stránkování', values: () => [true, false], show: (v) => (v === false ? 'jen první stránka' : 'střídat stránky') },
  { key: 'cursor', label: 'Kurzor myši', values: () => [true, 'always', false], show: (v) => (v === false ? 'vypnutý' : v === 'always' ? 'vždy viditelný' : 'při pohybu myši') },
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
  const first = scrollFirst(st, st.sel, vis, st.items.length);
  st.items.slice(first, first + vis).forEach((it, i) => {
    const idx = first + i, y = L.headerLine + 5 + i * L.rowH, on = idx === st.sel;
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH - 2, hover: () => { st.sel = idx; st.until = 0; }, click: () => { st.sel = idx; pickStart(it); } });
    m.text(fitText(it.label, 'normal', W - 14), 9, y, 'normal', on ? C.WHITE : (!it.stop ? C.DIM : C.AMBER));
    if (idx > 0 && idx <= 9 && it.stop) m.textRight(String(idx), W - 2, y, 'small', C.DIM);
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
  else if (k === '\u001b' && state.editDisplay > 0) { state.editDisplay = 0; state.mode = 'displays'; } // cancel picking for another display
  else if (k === '\u001b') pickStart(st.items[0]);
  else if (/^[1-9]$/.test(k) && st.items[+k]?.stop) pickStart(st.items[+k]);
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
  if (it.admin) { state.mode = 'admin'; state.adminMsg = ''; return; }
  if (it.wifi) { openWifi(); return; }
  if (it.displays) { state.mode = 'displays'; state.dispSel = 0; return; }
  if (it.install) { openInstall(); return; }
  if (it.theme) { openThemes(); return; }
  if (it.search) { state.mode = 'setup'; state.query = ''; state.results = []; state.sel = 0; }
  else chooseStop(it.stop);
}

// ---------------------------------------------------------------- self-update (GitHub Releases)
// Setting "Aktualizace": ask (default) shows this screen when a new release appears, auto installs it,
// off never checks. The screen falls back to the board after 2 minutes without an answer.
const UPDATE_EVERY = 6 * 3600 * 1000;
// Live medium (Alpine diskless, archiso): / lives in RAM, so an installed update is gone after a reboot and the
// board would ask again on every boot. There the new version is only offered in the menu, not popped up.
const LIVE = !PNG_OUT && system.isLive();
async function updateLoop() {
  const mode = state.cfg.custom?.updates || 'ask';
  if (mode !== 'off' && !state.update?.busy) {
    try {
      const info = await updater.check(APP_VERSION, USER_AGENT);
      if (info) {
        log('update available: ' + info.version);
        state.update = { ...(state.update || {}), info };
        if (mode === 'auto' && !LIVE) runUpdate();
        else if (!LIVE && state.cfg.skipVersion !== info.version && state.mode === 'board') openUpdate(false);
      }
    } catch (e) { log('update check: ' + e.message); }
  }
  setTimeout(updateLoop, UPDATE_EVERY);
}
// ---------------------------------------------------------------- remote administration (app/admin.js)
const ADMIN_PORT = process.env.ODJEZDY_ADMIN_PORT !== undefined ? +process.env.ODJEZDY_ADMIN_PORT : 8080;
function renderAdmin(m, t) {
  const W = m.cols, L = layout(m);
  m.text('Správa na dálku', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  let y = L.headerLine + 6;
  if (!ADMIN_PORT) { m.text('Vypnuto (ODJEZDY_ADMIN_PORT=0).', 2, y, 'normal', C.DIM); return; }
  m.text('V prohlížeči v téže síti otevři:', 2, y, 'normal', C.DIM); y += L.rowH + 2;
  const addrs = admin.addresses(ADMIN_PORT);
  (addrs.length ? addrs : ['(žádná síť)']).slice(0, 3).forEach((a) => { m.text(a, 2, y, 'normal', C.WHITE); y += L.rowH + 2; });
  y += 4;
  m.text('Heslo:', 2, y, 'normal', C.DIM); y += L.rowH + 2;
  m.text(admin.readToken(), 2, y, 'big', C.AMBER); y += face('big').rows + 8;
  m.text('N = nové heslo   Esc = zpět', 2, m.rows - L.sm - 4, 'small', C.DIM);
  if (state.adminMsg) m.text(state.adminMsg, 2, m.rows - 2 * L.sm - 8, 'small', C.GREEN);
}
function adminKey(k) {
  if (k === '\u001b' || k === 'q') { state.mode = 'start'; return; }
  if (k === 'n' || k === 'N') { admin.newToken(); state.adminMsg = 'Nové heslo vytvořeno.'; }
}
// what the admin page may read and change
function adminApi() {
  const freeMb = () => { try { return Math.round(Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024) + ' MB'; } catch { return '?'; } };
  const temp = () => { try { return (Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000).toFixed(0) + ' °C'; } catch { return null; } };
  const up = (s) => (s < 3600 ? Math.round(s / 60) + ' min' : s < 172800 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 86400) + ' dní');
  return {
    log,
    status: () => ({
      version: APP_VERSION, uptime: up(process.uptime()), stop: stopLabel(state.cfg.stop), theme: currentTheme().name, themeId: currentTheme().id,
      themes: THEMES.map((th) => ({ id: th.id, name: th.name })), memory: Math.round(process.memoryUsage().rss / 1048576) + ' MB', free: freeMb(),
      load: os.loadavg().map((x) => x.toFixed(2)).join(' '), temp: temp(), lastOk: state.lastOk ? new Date(state.lastOk).toLocaleTimeString('cs-CZ') : null,
      gain: Math.round((screen?.gain ?? 1) * 100), displays: (state.displays?.length || 1) + '×', brightness: state.cfg.custom?.brightness ?? 100, schedule: state.cfg.schedule || [],
    }),
    searchStops: (q) => searchStops(q, 8).map(pickStop),
    logTail: () => { try { const b = fs.readFileSync('/tmp/odjezdy.log'); return b.slice(Math.max(0, b.length - 12000)).toString('utf8'); } catch { return ''; } },
    applyConfig: (b) => {
      if (b.stop) {
        if (!b.stop.name || !Array.isArray(b.stop.ids) || !b.stop.ids.length || b.stop.ids.some((x) => typeof x !== 'string' || x.length > 64)) throw new Error('bad stop');
        chooseStop(pickStop(b.stop));
      }
      if (b.theme) { if (!THEMES.some((th) => th.id === b.theme)) throw new Error('unknown theme'); state.cfg.theme = b.theme; }
      if (b.custom && typeof b.custom === 'object') {
        const br = Number(b.custom.brightness);
        if (Number.isFinite(br)) state.cfg.custom = { ...(state.cfg.custom || {}), brightness: Math.max(10, Math.min(100, Math.round(br))) };
      }
      if (b.schedule) {
        if (!Array.isArray(b.schedule) || b.schedule.length > 20) throw new Error('bad schedule');
        state.cfg.schedule = b.schedule.map((x) => ({ days: (x.days || []).filter((d) => d >= 1 && d <= 7), from: String(x.from), to: String(x.to), brightness: Math.max(0, Math.min(100, Number(x.brightness) || 0)) }));
        applySchedule();
      }
      saveConfig(state.cfg);
    },
    action: (a) => {
      log('admin action: ' + a);
      if (a === 'restart') process.exit(0);
      if (a === 'reboot') require('child_process').execFile('reboot', [], () => {});
      if (a === 'poweroff') require('child_process').execFile('poweroff', [], () => {});
      if (a === 'clear-cache') { try { if (CACHE_FILE) fs.unlinkSync(CACHE_FILE); } catch {} state.deps = []; state.lastOk = 0; kick(); }
      if (a === 'update' && !LIVE) updater.check(APP_VERSION, USER_AGENT).then((info) => info && updater.install(info, USER_AGENT, () => {}).then(() => process.exit(0))).catch((e) => log('admin update: ' + e.message));
    },
  };
}
// the schedule decides the brightness of the whole screen (0 = dark); checked every 15 s
function applySchedule() {
  if (!screen) return;
  const g = admin.scheduledBrightness(state.cfg.schedule) / 100;
  if (Math.abs((screen.gain ?? 1) - g) > 0.001) { screen.gain = g; screen.shown = null; log('schedule: brightness ' + Math.round(g * 100) + ' %'); }
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
// release notes as bullet lines: GitHub's auto text ("What's Changed", "… by @user in https://…", "Full
// Changelog") and links are dropped, markdown decoration stripped
function cleanNotes(text) {
  const out = [];
  for (let l of String(text || '').split('\n')) {
    l = l.replace(/https?:\/\/\S+/g, '').replace(/\s+by\s+@?\S+\s+in\s*$/i, '').replace(/^[#*\-\s]+/, '').replace(/\*+/g, '').trim();
    if (!l || /^(what'?s changed|full changelog|new contributors)/i.test(l) || /^\S+ made their first contribution/i.test(l)) continue;
    out.push(l);
  }
  return [...new Set(out)];
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
    if (LIVE) { // RAM-only system: say so, the lasting fix is the new ISO
      for (const l of wrapText('Běží z živého média: aktualizace vydrží jen do restartu. Trvale pomůže jen nové ISO z GitHub Releases.', 'small', W - 4, 2)) { m.text(l, 2, y, 'small', C.YELLOW); y += L.sm + 2; }
      y += 2;
    }
    const notes = cleanNotes(u.info.notes);
    let room = Math.max(0, Math.floor((m.rows - y - (L.rowH + 6) * 2 - L.sm - 6) / (L.sm + 2)));
    for (const l of notes) {
      for (const [k, part] of wrapText(l, 'small', W - 12, 2).entries()) {
        if (room-- <= 0) break;
        m.text((k ? '  ' : '· ') + part, 4, y, 'small', C.DIM); y += L.sm + 2;
      }
    }
    if (!notes.length) m.text('Poznámky k vydání nejsou k dispozici.', 4, y, 'small', C.DIM);
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

// ---------------------------------------------------------------- installer (arch/: odjezdy-install --json)
// Guided like archinstall: language -> keyboard -> time zone -> computer name -> disk -> summary + ANO ->
// progress -> done (reboot). Boot entry "Nainstalovat do počítače" passes odjezdy.install=1, which opens it
// right away. The keyboard layout is applied immediately (loadkeys), since everything typed later
// (ANO, Wi-Fi password) goes through the console keymap.
const GB = (b) => (b >= 1e12 ? (b / 1e12).toFixed(1) + ' TB' : Math.round(b / 1e9) + ' GB');
const STAGES = { partition: 'Rozděluji disk', format: 'Formátuji', pacstrap: 'Kopíruji systém', bootloader: 'Instaluji zavaděč', config: 'Nastavuji systém', done: 'Hotovo' };
const INSTALL_STEPS = ['locale', 'keymap', 'timezone', 'hostname', 'disks', 'confirm'];
const STEP_TITLE = { locale: 'Jazyk systému', keymap: 'Rozložení klávesnice', timezone: 'Časové pásmo', hostname: 'Název počítače', disks: 'Disk pro instalaci', confirm: 'Shrnutí' };
function openInstall() {
  const st = state.inst = {
    step: 'locale', opts: system.installer.defaultOptions(), sel: 0, filter: '', typed: '', ev: null, err: null, disks: null,
    choice: { locale: 'cs_CZ.UTF-8', keymap: 'cz-qwertz', timezone: 'Europe/Prague', hostname: 'odjezdy', disk: null },
  };
  state.mode = 'install';
  system.installer.options().then((o) => { if (o) st.opts = o; }).catch(() => {});
  system.installer.disks().then((d) => {
    st.disks = d;
    const i = d.findIndex((x) => !x.is_live_medium);
    if (i >= 0) st.choice.disk = d[i].name;
  }).catch((e) => { st.diskErr = 'Nelze zjistit disky: ' + e.message; });
  installGo('locale');
}
// list for a list step, filtered by what was typed (time zones are many)
function installList(st) {
  const f = norm(st.filter || '');
  if (st.step === 'locale') return st.opts.locales.map((x) => ({ id: x.id, label: x.name, note: x.id }));
  if (st.step === 'keymap') return st.opts.keymaps.map((x) => ({ id: x.id, label: x.name, note: x.id }));
  if (st.step === 'timezone') return st.opts.timezones.filter((z) => !f || norm(z).includes(f)).map((z) => ({ id: z, label: z.replace(/_/g, ' ') }));
  if (st.step === 'disks') return (st.disks || []).map((d) => ({
    id: d.name, label: `${d.name.replace('/dev/', '')}  ${GB(d.size_bytes)}  ${d.model || ''}`.trim(), disabled: d.is_live_medium,
    note: d.is_live_medium ? 'instalační médium' : d.has_os ? 'obsahuje systém' : d.has_partitions ? 'obsahuje data' : d.removable ? 'vyměnitelný' : 'prázdný',
    warn: d.has_os || d.has_partitions,
  }));
  return [];
}
function installGo(step) {
  const st = state.inst;
  st.step = step; st.filter = ''; st.err = null;
  const list = installList(st), cur = st.choice[step === 'disks' ? 'disk' : step];
  st.sel = Math.max(0, list.findIndex((x) => x.id === cur));
  if (step === 'hostname') st.typed = st.choice.hostname;
  if (step === 'confirm') st.typed = '';
}
function installNext(dir = 1) {
  const st = state.inst, i = INSTALL_STEPS.indexOf(st.step);
  if (dir < 0) return i <= 0 ? openStart(false) : installGo(INSTALL_STEPS[i - 1]);
  if (st.step === 'locale' || st.step === 'keymap' || st.step === 'timezone' || st.step === 'disks') {
    const it = installList(st)[st.sel];
    if (!it || it.disabled) return;
    st.choice[st.step === 'disks' ? 'disk' : st.step] = it.id;
    if (st.step === 'keymap') system.setKeymap(it.id); // type the rest in the chosen layout
  }
  if (st.step === 'hostname') {
    const h = st.typed.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h)) { st.err = 'Jen malá písmena bez diakritiky, číslice a pomlčka.'; return; }
    st.choice.hostname = h;
  }
  if (st.step === 'confirm') {
    if (st.typed.trim().toUpperCase() !== 'ANO') { st.typed = ''; st.err = 'Napiš ANO (velkými nebo malými písmeny).'; return; }
    return installStart();
  }
  installGo(INSTALL_STEPS[i + 1]);
}
function installStart() {
  const st = state.inst, c = st.choice;
  st.step = 'progress'; st.ev = { stage: 'partition', progress: 0, message: 'Začínám…' }; st.t0 = Date.now();
  log(`install to ${c.disk} (${c.locale}, ${c.keymap}, ${c.timezone}, ${c.hostname})`);
  // random root password for the service console, shown once at the end. Letters only, without y/z (swapped
  // on QWERTZ) and look-alikes, so it types the same on any of the offered layouts. No SSH is installed.
  const abc = 'abcdefghjkmnprstuvwx'; // no q either: it looks like a 4 in the BUSE face
  st.rootPass = [...require('crypto').randomBytes(10)].map((b) => abc[b % abc.length]).join('');
  system.installer.run(c.disk, (ev) => { st.ev = ev; }, ['--locale', c.locale, '--keymap', c.keymap, '--timezone', c.timezone, '--hostname', c.hostname, '--root-password', st.rootPass])
    .then(() => { st.step = 'done'; st.until = Date.now() + 120000; log('install done'); })
    .catch((e) => { st.step = 'error'; st.err = e.message; log('install failed: ' + e.message); });
}
// last lines of /var/log/odjezdy-install.log (raw output of pacstrap, grub …), re-read once a second
let logTail = { at: 0, lines: [] };
function installLogTail(n) {
  if (Date.now() - logTail.at > 1000) {
    logTail.at = Date.now();
    try {
      const f = process.env.ODJEZDY_INSTALL_LOG || '/var/log/odjezdy-install.log', fd = fs.openSync(f, 'r'), size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 6000));
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      fs.closeSync(fd);
      logTail.lines = buf.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/).map((l) => l.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    } catch { logTail.lines = []; }
  }
  return logTail.lines.slice(-n);
}
function bar(m, x0, y, w, h, frac, c) {
  m.hline(x0, x0 + w - 1, y, C.DIM); m.hline(x0, x0 + w - 1, y + h - 1, C.DIM);
  for (let yy = y + 1; yy < y + h - 1; yy++) { m.set(x0, yy, C.DIM); m.set(x0 + w - 1, yy, C.DIM); }
  const fill = Math.round((w - 4) * Math.max(0, Math.min(1, frac)));
  for (let yy = y + 2; yy < y + h - 2; yy++) for (let x = x0 + 2; x < x0 + 2 + fill; x++) m.set(x, yy, c);
}
function renderInstall(m, t) {
  const W = m.cols, L = layout(m), st = state.inst;
  const si = INSTALL_STEPS.indexOf(st.step);
  m.text(si >= 0 ? STEP_TITLE[st.step] : 'Instalace do počítače', 1, 1, 'big', C.AMBER);
  if (si >= 0) m.textRight(`krok ${si + 1} z ${INSTALL_STEPS.length}`, W - 2, 3, 'small', C.DIM);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  let y = L.headerLine + 5;
  const hint = (txt) => m.text(fitText(txt, 'small', W - 4), 2, m.rows - L.sm - 1, 'small', C.DIM);
  const cursor = Math.floor(t / 500) % 2 ? '_' : ' ';
  const err = () => { if (st.err) { m.text(fitText(st.err, 'small', W - 4), 2, m.rows - L.sm * 2 - 5, 'small', C.RED); } };

  if (['locale', 'keymap', 'timezone', 'disks'].includes(st.step)) {
    if (st.step === 'disks') {
      for (const l of wrapText('Odjezdy OS se nainstaluje na vybraný disk. Vše, co na něm je, bude smazáno.', 'small', W - 4, 2)) { m.text(l, 2, y, 'small', C.DIM); y += L.sm + 2; }
      y += 3;
      if (st.diskErr) m.text(fitText(st.diskErr, 'small', W - 4), 2, y, 'small', C.RED);
      else if (!st.disks) m.text('Hledám disky…', 2, y, 'normal', C.DIM);
      else if (!st.disks.length) m.text('Nenašel jsem žádný disk.', 2, y, 'normal', C.RED);
    }
    if (st.step === 'timezone') { m.text('Hledat:', 2, y, 'small', C.DIM); m.text(st.filter + cursor, 4 + textWidth('Hledat:', 'small'), y, 'small', C.WHITE); y += L.sm + 5; }
    if (st.step === 'keymap') { m.text(fitText('Zkus si psát: ' + (st.filter || '…') + cursor, 'small', W - 4), 2, y, 'small', C.DIM); y += L.sm + 5; }
    const list = installList(st);
    const rows = Math.max(1, Math.floor((m.rows - y - L.sm * 2 - 10) / L.rowH));
    const first = scrollFirst(st, st.sel, rows, list.length);
    list.slice(first, first + rows).forEach((it, k) => {
      const i = first + k, yy = y + k * L.rowH, on = i === st.sel;
      if (on) m.text('>', 2, yy, 'normal', C.WHITE);
      m.text(fitText(it.label, 'normal', W * 0.62), 9, yy, 'normal', it.disabled ? C.DIM : on ? C.WHITE : C.AMBER);
      if (it.note) m.textRight(it.note, W - 2, yy, 'small', it.warn ? C.RED : C.DIM);
      if (!it.disabled) hits.push({ x0: 0, y0: yy - 1, x1: W, y1: yy + L.rowH - 2, hover: () => { st.sel = i; }, click: () => { st.sel = i; installNext(); } });
    });
    err();
    hint(st.step === 'timezone' ? 'Piš pro hledání · šipky, Enter = další · Esc = zpět' : 'Šipky, Enter = další · Esc = zpět');
  } else if (st.step === 'hostname') {
    for (const l of wrapText('Jméno, pod kterým bude počítač vidět v síti.', 'small', W - 4, 2)) { m.text(l, 2, y, 'small', C.DIM); y += L.sm + 2; }
    y += 6;
    m.text(st.typed + cursor, 9, y, 'normal', C.WHITE);
    err();
    hint('Enter = další · Esc = zpět');
  } else if (st.step === 'confirm') {
    const c = st.choice, d = (st.disks || []).find((x) => x.name === c.disk);
    const rowsI = [['Jazyk', (st.opts.locales.find((x) => x.id === c.locale) || {}).name || c.locale], ['Klávesnice', (st.opts.keymaps.find((x) => x.id === c.keymap) || {}).name || c.keymap],
      ['Časové pásmo', c.timezone], ['Název počítače', c.hostname], ['Disk', d ? `${d.name} · ${GB(d.size_bytes)} ${d.model || ''}` : c.disk]];
    const lw = textWidth('Název počítače  ', 'small');
    for (const [k, v] of rowsI) { m.text(k, 2, y + 1, 'small', C.DIM); m.text(fitText(v, 'normal', W - lw - 6), 2 + lw, y, 'normal', C.AMBER); y += L.rowH; }
    y += 2;
    for (const l of wrapText('Disk bude celý smazán, včetně všech dat a systémů na něm. Pro potvrzení napiš ANO a stiskni Enter:', 'small', W - 4, 2)) { m.text(l, 2, y, 'small', C.RED); y += L.sm + 2; }
    y += 3;
    m.text(st.typed + cursor, 9, y, 'normal', C.WHITE);
    err();
    hint('Esc = zpět a změnit');
  } else if (st.step === 'progress') {
    const ev = st.ev || {};
    m.text(STAGES[ev.stage] || 'Instaluji', 2, y, 'normal', C.WHITE);
    m.textRight(Math.round((ev.progress || 0) * 100) + ' z 100', W - 2, y, 'normal', C.AMBER); // '%' is a BUSE pictogram
    y += L.rowH + 4;
    bar(m, 2, y, W - 4, 12, ev.progress || 0, C.AMBER);
    y += 18;
    if (ev.message) m.text(fitText(ev.message, 'small', W - 4), 2, y, 'small', C.DIM);
    y += L.sm + 8;
    // checklist of the stages, like a normal installer, plus elapsed time
    const order = ['partition', 'format', 'pacstrap', 'bootloader', 'config'];
    const cur = Math.max(0, order.indexOf(ev.stage));
    order.forEach((sg, i) => {
      const yy = y + i * (L.sm + 3), done = i < cur, now = i === cur;
      m.text(done ? '+' : now ? '>' : '-', 2, yy, 'small', done ? C.GREEN : now ? C.WHITE : C.DIM);
      m.text(STAGES[sg], 10, yy, 'small', done ? C.GREEN : now ? C.WHITE : C.DIM);
    });
    const secs = Math.floor((Date.now() - (st.t0 || Date.now())) / 1000);
    m.textRight(`Uplynulo ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W - 2, y, 'small', C.DIM);
    if (ev.stage === 'pacstrap' && secs > 45 && (ev.progress || 0) < 0.2) m.textRight('Stahování závisí na rychlosti internetu', W - 2, y + L.sm + 3, 'small', C.DIM);
    y += order.length * (L.sm + 3) + 6;
    // the last lines of the real install log: what is happening right now
    m.hline(0, W - 1, y - 2, C.DIM);
    const room = Math.max(0, Math.floor((m.rows - L.sm - 4 - y) / (L.sm + 1)));
    for (const [k, l] of installLogTail(room).entries()) m.text(fitText(l, 'small', W - 4), 2, y + k * (L.sm + 1), 'small', C.DIM);
    hint('Nevypínej počítač. Celý log: /var/log/odjezdy-install.log');
  } else if (st.step === 'done') {
    m.text('Hotovo, Odjezdy OS je nainstalovaný.', 2, y, 'normal', C.GREEN);
    y += L.rowH + 4;
    if (st.rootPass) { // shown only here, once: the installed system has no other way to learn it
      m.text('Servisní konzole (Alt+F2): uživatel root, heslo', 2, y, 'small', C.DIM);
      m.text(st.rootPass, 2, y + L.sm + 3, 'normal', C.WHITE);
      m.text('Opiš si ho, víckrát se neukáže.', 2, y + L.sm + L.rowH + 5, 'small', C.DIM);
      y += L.sm + L.rowH + L.sm + 12;
    }
    m.text('Vyjmi instalační médium a stiskni Enter pro restart.', 2, y, 'small', C.AMBER);
    const left = Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
    m.text(`Restart sám za ${left} s`, 2, y + L.sm + 4, 'small', C.DIM);
    if (!left && !st.rebooting) { st.rebooting = true; system.reboot(); }
    hits.push({ x0: 0, y0: L.headerLine, x1: W, y1: m.rows, click: () => { st.rebooting = true; system.reboot(); } });
    hint('Enter = restartovat');
  } else { // error
    m.text('Instalace se nepovedla', 2, y, 'normal', C.RED);
    y += L.rowH + 2;
    for (const l of wrapText(st.err || '', 'small', W - 4, 3)) { m.text(l, 2, y, 'small', C.AMBER); y += L.sm + 2; }
    // what the installer printed last: the actual reason is usually right here (and not readable otherwise)
    y += 4;
    m.text('Poslední řádky logu:', 2, y, 'small', C.DIM);
    y += L.sm + 3;
    logTail.at = 0; // fresh read
    const room = Math.max(0, Math.floor((m.rows - L.sm - 4 - y) / (L.sm + 1)));
    for (const [k, l] of installLogTail(room).entries()) m.text(fitText(l, 'small', W - 4), 2, y + k * (L.sm + 1), 'small', C.WHITE);
    hint('Enter = zkusit znovu · Esc = zpět · celý log: /var/log/odjezdy-install.log (Alt+F2)');
  }
}
function installKey(k) {
  const st = state.inst;
  if (st.step === 'progress') return; // no way out while writing the disk
  if (st.step === 'done') { if (k === '\r') { st.rebooting = true; system.reboot(); } return; }
  if (st.step === 'error') { if (k === '\r') { st.step = 'confirm'; st.typed = ''; st.err = null; } else if (k === '\u001b') openStart(false); return; }
  const back = k === '\u001b', del = k === '\u007f' || k === '\b', ch = k.length === 1 && k >= ' ' ? k : '';
  if (back) return installNext(-1);
  if (k === '\r') return installNext();
  if (st.step === 'hostname' || st.step === 'confirm') {
    if (del) st.typed = st.typed.slice(0, -1); else if (ch && st.typed.length < 63) st.typed += ch;
    st.err = null;
    return;
  }
  const list = installList(st);
  const move = (d) => { for (let i = st.sel + d; i >= 0 && i < list.length; i += d) if (!list[i].disabled) { st.sel = i; return; } };
  if (k === '\u001b[A') move(-1);
  else if (k === '\u001b[B') move(1);
  if (st.step === 'keymap' && (k === '\u001b[A' || k === '\u001b[B')) system.setKeymap(list[st.sel].id);
  else if ((st.step === 'timezone' || st.step === 'keymap') && (ch || del)) {
    st.filter = del ? st.filter.slice(0, -1) : (st.filter + ch).slice(-40);
    if (st.step === 'timezone') st.sel = 0;
  }
}

// ---------------------------------------------------------------- Wi-Fi (arch/: odjezdy-wifi --json)
function openWifi() {
  state.wifi = { step: 'list', nets: null, sel: 0, pass: '', show: false, status: null, err: null, msg: null };
  state.mode = 'wifi';
  wifiRefresh();
}
function wifiRefresh() {
  const w = state.wifi;
  system.wifi.status().then((st) => { w.status = st; }).catch(() => {});
  w.scanning = true;
  system.wifi.scan().then((n) => { w.nets = n; w.sel = Math.min(w.sel, Math.max(0, n.length - 1)); })
    .catch((e) => { w.err = 'Hledání sítí selhalo: ' + e.message; })
    .finally(() => { w.scanning = false; });
}
function wifiConnect(net, pass) {
  const w = state.wifi;
  w.step = 'connecting'; w.err = null; w.msg = `Připojuji k ${net.ssid}…`;
  system.wifi.connect(net.ssid, pass).then((r) => {
    if (r.ok) {
      w.msg = `Připojeno k ${net.ssid}`; w.step = 'list'; w.pass = ''; wifiRefresh(); kick();
      if (w.wizard) setTimeout(() => { if (state.mode === 'wifi') openStart(false); }, 2000); // wizard: on to the stop
    }
    else { w.err = 'Nepřipojeno: ' + (r.error || 'neznámá chyba'); w.step = net.security === 'open' ? 'list' : 'pass'; w.msg = null; }
  }).catch((e) => { w.err = 'Nepřipojeno: ' + e.message; w.step = 'list'; w.msg = null; });
}
function signalBars(m, x, y, sig, c) {
  for (let i = 0; i < 4; i++) {
    const h = 3 + i * 2, lit = sig >= 15 + i * 25;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < 2; xx++) m.set(x + i * 3 + xx, y + 9 - yy, lit ? c : C.DIM);
  }
}
function renderWifi(m, t) {
  const W = m.cols, L = layout(m), w = state.wifi;
  m.text(w.wizard ? 'Vítej · připoj se k síti' : 'Wi-Fi a síť', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  let y = L.headerLine + 4;
  const st = w.status;
  const line = !st ? 'Zjišťuji stav…' : st.device === null ? 'Wi-Fi karta nenalezena (kabel funguje sám)' : st.connected ? `Připojeno: ${st.ssid}${st.ip ? ' · IP ' + st.ip : ''}` : 'Nepřipojeno';
  m.text(fitText(line, 'small', W - 4), 2, y, 'small', st?.connected ? C.GREEN : C.DIM);
  y += L.sm + 5;
  if (w.step === 'pass') {
    const net = w.nets[w.sel];
    m.text(fitText(`Heslo k síti ${net.ssid}:`, 'normal', W - 4), 2, y, 'normal', C.AMBER);
    y += L.rowH + 2;
    const shown = w.show ? w.pass : '*'.repeat(w.pass.length);
    m.text(fitText(shown + (Math.floor(t / 500) % 2 ? '_' : ' '), 'normal', W - 12), 9, y, 'normal', C.WHITE);
    if (w.err) m.text(fitText(w.err, 'small', W - 4), 2, y + L.rowH + 2, 'small', C.RED);
    m.text('Enter = připojit · Tab = ukázat heslo · Esc = zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
    return;
  }
  if (w.msg) { m.text(fitText(w.msg, 'normal', W - 4), 2, y, 'normal', w.step === 'connecting' ? C.AMBER : C.GREEN); y += L.rowH + 2; }
  if (w.err) { m.text(fitText(w.err, 'small', W - 4), 2, y, 'small', C.RED); y += L.sm + 4; }
  if (!w.nets) m.text(w.scanning ? 'Hledám sítě…' : '', 2, y, 'normal', C.DIM);
  else if (!w.nets.length) m.text('Žádná síť v dosahu', 2, y, 'normal', C.DIM);
  const rows = Math.max(1, Math.floor((m.rows - y - L.sm - 6) / L.rowH));
  const first = scrollFirst(w, w.sel, rows, w.nets?.length || 0);
  (w.nets || []).slice(first, first + rows).forEach((n, k) => {
    const i = first + k, yy = y + k * L.rowH, on = i === w.sel;
    if (on) m.text('>', 2, yy, 'normal', C.WHITE);
    signalBars(m, 9, yy, n.signal, on ? C.WHITE : C.AMBER);
    m.text(fitText(n.ssid || '(skrytá síť)', 'normal', W * 0.6), 24, yy, 'normal', on ? C.WHITE : C.AMBER);
    const note = n.connected ? 'připojeno' : n.known ? 'uloženo' : n.security === 'open' ? 'otevřená' : n.security === '8021x' ? 'podniková' : 'heslo';
    m.textRight(note, W - 2, yy, 'small', n.connected ? C.GREEN : C.DIM);
    hits.push({ x0: 0, y0: yy - 1, x1: W, y1: yy + L.rowH - 2, hover: () => { w.sel = i; }, click: () => { w.sel = i; wifiPick(); } });
  });
  m.text('Šipky, Enter = připojit · R = hledat znovu · Esc = zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function wifiPick() {
  const w = state.wifi, n = w.nets?.[w.sel];
  if (!n || w.step === 'connecting') return;
  if (n.security === '8021x') { w.err = 'Podnikové sítě (802.1X) zatím nejde nastavit tady, použij servisní konzoli.'; return; }
  if (n.security === 'open' || n.known) wifiConnect(n, null);
  else { w.step = 'pass'; w.pass = ''; w.err = null; }
}
function wifiKey(k) {
  const w = state.wifi;
  if (w.step === 'connecting') return;
  if (w.step === 'pass') {
    if (k === '\u001b') { w.step = 'list'; w.err = null; return; }
    if (k === '\r') { if (w.pass) wifiConnect(w.nets[w.sel], w.pass); return; }
    if (k === '\t') { w.show = !w.show; return; }
    if (k === '\u007f' || k === '\b') w.pass = w.pass.slice(0, -1);
    else if (k.length === 1 && k >= ' ' && w.pass.length < 63) w.pass += k;
    return;
  }
  if (k === '\u001b') return openStart(false);
  if (k === '\u001b[A') w.sel = Math.max(0, w.sel - 1);
  else if (k === '\u001b[B') w.sel = Math.min((w.nets?.length || 1) - 1, w.sel + 1);
  else if (k === '\r') wifiPick();
  else if (k === 'r' || k === 'R') wifiRefresh();
}

// ---------------------------------------------------------------- theme picker
// All themes in a list; moving the selection applies the theme at once (the list is drawn in it), Enter or
// a click keeps it, Esc goes back to the theme that was active before.
function openThemes() {
  state.mode = 'themes';
  state.themeBackup = state.cfg.theme;
  state.themeSel = Math.max(0, THEMES.indexOf(currentTheme()));
}
function themePreview(i) {
  state.themeSel = i;
  state.cfg.theme = THEMES[i].id; // not saved until confirmed
}
function themesConfirm() {
  saveConfig(state.cfg);
  state.toast = { text: 'Vzhled: ' + currentTheme().name, until: Date.now() + 2000 };
  state.mode = 'board';
}
function renderThemes(m, t) {
  const W = m.cols, L = layout(m);
  m.text('Vzhled tabule', 1, 1, 'big', C.AMBER);
  m.textRight(`${state.themeSel + 1} z ${THEMES.length}`, W - 2, 3, 'small', C.DIM);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  const y0 = L.headerLine + 4, rows = Math.max(1, Math.floor((m.rows - y0 - L.sm - 6) / L.rowH));
  const first = scrollFirst(state, state.themeSel, rows, THEMES.length);
  THEMES.slice(first, first + rows).forEach((th, k) => {
    const i = first + k, y = y0 + k * L.rowH, on = i === state.themeSel;
    if (on) m.text('>', 2, y, 'normal', C.WHITE);
    m.text(fitText(th.name, 'normal', W * 0.66), 9, y, 'normal', on ? C.WHITE : C.AMBER);
    m.textRight(typeof th.renderNative === 'function' ? 'vektorový' : 'LED body', W - 2, y, 'small', C.DIM);
    hits.push({ x0: 0, y0: y - 1, x1: W, y1: y + L.rowH - 2, hover: () => { if (state.themeSel !== i) themePreview(i); }, click: () => { themePreview(i); themesConfirm(); } });
  });
  m.text('Šipky = náhled · Enter = použít · Esc = zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function themesKey(k) {
  if (k === '\u001b') { state.cfg.theme = state.themeBackup; return openStart(false); }
  if (k === '\u001b[A') themePreview((state.themeSel + THEMES.length - 1) % THEMES.length);
  else if (k === '\u001b[B') themePreview((state.themeSel + 1) % THEMES.length);
  else if (k === '\r' || k === ' ') themesConfirm();
}

// ---------------------------------------------------------------- displays (several monitors)
function displayCfg(n) {
  if (n === 0) return state.cfg;
  try { return JSON.parse(fs.readFileSync(displays.displayConfig(n), 'utf8')); } catch { return { stop: state.cfg.stop, theme: state.cfg.theme }; }
}
function displayCfgSet(n, patch) {
  if (n === 0) { Object.assign(state.cfg, patch); saveConfig(state.cfg); return; }
  const c = { ...displayCfg(n), ...patch };
  try {
    fs.mkdirSync(path.dirname(displays.displayConfig(n)), { recursive: true });
    fs.writeFileSync(displays.displayConfig(n), JSON.stringify(c, null, 2));
    require('child_process').exec('command -v lbu >/dev/null && lbu commit 2>/dev/null');
  } catch (e) { log('display config: ' + e.message); }
  displays.reloadChild(n);
}
function renderDisplays(m, t) {
  const W = m.cols, L = layout(m);
  m.text('Displeje', 1, 1, 'big', C.AMBER);
  m.hline(0, W - 1, L.headerLine, C.DIM);
  let y = L.headerLine + 5;
  state.displays.forEach((d, i) => {
    const c = displayCfg(i), on = i === state.dispSel, yy = y + i * (L.rowH + L.sm + 4);
    if (on) m.text('>', 2, yy, 'normal', C.WHITE);
    m.text(fitText(`${i + 1}. ${stopLabel(c.stop || {})}`, 'normal', W * 0.6), 9, yy, 'normal', on ? C.WHITE : C.AMBER);
    m.textRight((THEMES.find((x) => x.id === c.theme) || THEMES[0]).name, W - 2, yy, 'small', C.DIM);
    m.text(`${d.name}${d.w ? ` · ${d.w}×${d.h}` : ''}${i === 0 ? ' · hlavní (klávesnice, myš)' : ''}`, 9, yy + L.rowH, 'small', C.DIM);
    hits.push({ x0: 0, y0: yy - 1, x1: W, y1: yy + L.rowH + L.sm, hover: () => { state.dispSel = i; }, click: () => { state.dispSel = i; displaysKey('\r'); } });
  });
  m.text('Enter = zastávka · T nebo šipky vlevo/vpravo = vzhled · Esc = zpět', 2, m.rows - L.sm - 1, 'small', C.DIM);
}
function displaysKey(k) {
  const n = state.dispSel;
  if (k === '\u001b') return openStart(false);
  if (k === '\u001b[A') state.dispSel = Math.max(0, n - 1);
  else if (k === '\u001b[B') state.dispSel = Math.min(state.displays.length - 1, n + 1);
  else if (k === '\r') { state.editDisplay = n; openStart(false); } // the stop pickers end in chooseStop
  else if (k === 't' || k === 'T' || k === '\u001b[C' || k === '\u001b[D') {
    const ids = THEMES.map((x) => x.id), cur = ids.indexOf(displayCfg(n).theme), step = k === '\u001b[D' ? -1 : 1;
    displayCfgSet(n, { theme: ids[((cur < 0 ? 0 : cur) + step + ids.length) % ids.length] });
  }
}

// ---------------------------------------------------------------- input
function onKey(k) {
  if (state.mode === 'start') return startKey(k);
  if (state.mode === 'browse') return browseKey(k);
  if (state.mode === 'settings') return settingsKey(k);
  if (state.mode === 'world') return worldKey(k);
  if (state.mode === 'update') return updateKey(k);
  if (state.mode === 'admin') return adminKey(k);
  if (state.mode === 'install') return installKey(k);
  if (state.mode === 'wifi') return wifiKey(k);
  if (state.mode === 'displays') return displaysKey(k);
  if (state.mode === 'themes') return themesKey(k);
  if (state.mode === 'board') {
    if (k === 's' || k === 'S' || k === '\r' || k === ' ') openStart(false);
    else if (k === 't' || k === 'T') cycleTheme(1);
    else if (k === 'v' || k === 'V') state.perfShow = !state.perfShow; // performance numbers on/off
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
let boardTimer = null, boardGen = 0;
function kick() {
  clearTimeout(boardTimer);
  const gen = ++boardGen; // a stop change starts a new loop; the old one (maybe mid-request) stops itself
  const loop = async () => {
    if (gen !== boardGen) return;
    try {
      await refreshBoard();
      if (gen !== boardGen) return;
      state.net = 'online';
    } catch (e) {
      if (gen !== boardGen) return;
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
    if (now && !vtActive && screen) { screen.prev = null; screen.look = null; screen.shown = null; lastNative = 0; } // repaint on return
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
  try { const b = `/sys/class/graphics/${OUTPUT}`; return ['name', 'virtual_size', 'bits_per_pixel', 'stride'].map((f) => { try { return fs.readFileSync(`${b}/${f}`, 'utf8').trim(); } catch { return ''; } }).join('|'); } catch { return null; }
}
function checkFb() {
  if (PNG_OUT || !screen || screen.sock || Date.now() - fbCheckAt < 1500) return;
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
  state.tickN = (state.tickN || 0) + 1;
  const t = Date.now() - t0;
  m.clear();
  hits.length = 0;
  themeUtil.setPaging(state.cfg.custom?.paging);
  const userFont = state.cfg.custom?.font;
  faceFamily = userFont && userFont !== 'theme' ? (userFont === 'buse' ? null : userFont) : currentTheme().fonts || null;
  if (pointer.visible && state.cfg.custom?.cursor !== 'always' && Date.now() - pointer.last > 5000) pointer.visible = false;
  if (state.cfg.custom?.cursor === 'always' && pointer.enabled) pointer.visible = true;
  if (state.mode === 'start' && state.start.until && Date.now() > state.start.until) pickStart(state.start.items[0]);
  if (state.mode === 'start') renderStart(m, t);
  else if (state.mode === 'browse') renderBrowse(m, t);
  else if (state.mode === 'settings') renderSettings(m, t);
  else if (state.mode === 'world') renderWorld(m, t);
  else if (state.mode === 'update') renderUpdate(m, t);
  else if (state.mode === 'admin') renderAdmin(m, t);
  else if (state.mode === 'install') renderInstall(m, t);
  else if (state.mode === 'wifi') renderWifi(m, t);
  else if (state.mode === 'displays') renderDisplays(m, t);
  else if (state.mode === 'themes') renderThemes(m, t);
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
  if (state.perfShow) m.text(fitText(perf.last || perfSummary(), 'small', m.cols - 4), 2, 1, 'small', C.YELLOW);
  const d0 = Date.now(), w0 = perf.write;
  screen.draw(m);
  const dt = Date.now() - d0, wr = perf.write - w0;
  perf.frames++; perf.render += dt - wr; perf.convert += 0; // LED path: dot painting; the write part is counted in perf.write
}

function shutdown(code = 0) {
  if (!IS_CHILD) { displays.stopChildren(); try { kmsProc?.kill('SIGTERM'); } catch {} }
  if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} }
  process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  process.exit(code);
}

let kmsProc = null;
state.displays = []; // primary: [{ index, type, name, w, h }]
async function setupOutputs() {
  if (PNG_OUT) return null;
  if (IS_CHILD) return OUTPUT.startsWith('kms:') ? displays.kmsConnect(Number(OUTPUT.slice(4))) : OUTPUT.startsWith('wl:') ? displays.wlConnect(Number(OUTPUT.slice(3))) : null;
  const d = displays.detect();
  log(`displays: ${d.mode}${d.connectors ? ' (' + d.connectors.join(', ') + ')' : ''}${d.resize ? ', mode change ' + d.resize : ''}`);
  if (d.mode === 'fb') {
    state.displays = d.outputs.map((o, i) => ({ ...o, index: i }));
    OUTPUT = state.displays[0].dev;
  } else if (d.mode === 'kms') {
    try {
      const k = await displays.startKms();
      kmsProc = k.proc;
      state.displays = k.outputs.map((o, i) => ({ ...o, index: i }));
      displays.startChildren(state.displays, __filename, log);
      return displays.kmsConnect(0);
    } catch (e) { log('odjezdy-kms: ' + e.message + ', single display'); state.displays = []; }
  }
  if (d.mode === 'wl') {
    try {
      const outs = await displays.wlList();
      state.displays = outs.map((o, i) => ({ ...o, index: i }));
      displays.startChildren(state.displays, __filename, log);
      return displays.wlConnect(0);
    } catch (e) { log('odjezdy-wl: ' + e.message + ', single display'); state.displays = []; }
  }
  if (state.displays.length > 1) displays.startChildren(state.displays, __filename, log);
  return null;
}
// The Wayland helper closes the connection when its window changes size or goes away: reconnect to the same output; when the
// size is different, exit so the supervisor (cage / systemd) starts the board again with the new size.
function watchWl(conn) {
  const n = conn.n;
  const again = async (tries) => {
    try {
      const c = await displays.wlConnect(n);
      if (c.w !== screen.w || c.h !== screen.h || c.stride !== screen.stride) {
        // the window got another size (the compositor settles after the start): continue with a new screen of that size
        // instead of exiting, which made the supervisor restart the board in a loop
        log(`wayland output ${n} resized to ${c.w}x${c.h}`);
        const old = screen;
        screen = new Screen(c);
        screen.gain = old.gain; lastNative = 0; nativeCanvas = null;
        c.sock.on('close', () => again(0));
        return;
      }
      screen.sock = c.sock; screen.shown = null; c.sock.on('close', () => again(0));
    } catch (e) {
      if (tries > 20) { log('wayland output lost: ' + e.message); process.exit(0); }
      setTimeout(() => again(tries + 1), 500);
    }
  };
  conn.sock.on('close', () => again(0));
}

async function main() {
  state.cfg = loadConfig();
  const outConn = await setupOutputs();
  screen = new Screen(outConn);
  if (outConn?.type === 'wl') watchWl(outConn);
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
    if (args.includes('--alert')) { const tx = args[args.indexOf('--alert') + 1]; state.alerts = [tx]; if (args.includes('--details')) state.alertInfo = new Map([[tx, { details: args[args.indexOf('--details') + 1], valid: 'Platí od 19. 10. do 31. 10.', original: args.includes('--original') ? args[args.indexOf('--original') + 1] : '', source: 'DÚK', links: args.includes('--links') ? args[args.indexOf('--links') + 1] : '' }]]); t0 = Date.now() - 22000; }
    if (args.includes('--update')) { state.update = { info: { version: '9.9.9', notes: "## What's Changed\n* Arch installer json by @VlastikYoutubeKo in https://github.com/x/y/pull/7\n* Dopravce a zastávky přes u spojů\n* Volba Stránkování: jen první stránka, bez přepínání\n**Full Changelog**: https://github.com/a/b/compare/v1...v2", size: 4200000 } }; openUpdate(false); }
    if (args.includes('--install')) { openInstall(); await new Promise((r) => setTimeout(r, 1500)); const step = args[args.indexOf('--install') + 1]; if (step && step !== 'progress' && step !== 'done') { installGo(step); if (step === 'confirm') state.inst.typed = 'AN'; if (step === 'timezone') state.inst.filter = 'eu'; } if (step === 'progress') { state.inst.t0 = Date.now() - 83000; state.inst.step = 'progress'; state.inst.ev = { stage: 'pacstrap', progress: 0.47, message: 'Instaluji balíčky (182 z 391)' }; } if (step === 'done') { state.inst.step = 'done'; state.inst.until = Date.now() + 102000; state.inst.rebooting = true; state.inst.rootPass = 'kbmtrwshec'; } }
    if (args.includes('--wifi')) { openWifi(); await new Promise((r) => setTimeout(r, 1500)); if (args[args.indexOf('--wifi') + 1] === 'pass') { state.wifi.sel = 1; state.wifi.step = 'pass'; state.wifi.pass = 'tajne12'; } }
    if (args.includes('--themes')) { openThemes(); themePreview(Number(args[args.indexOf('--themes') + 1]) || 4); }
    if (args.includes('--settings')) { state.mode = 'settings'; state.setSel = 1; }
    if (args.includes('--cursor')) { pointer.visible = true; pointer.last = Date.now(); pointer.x = screen.w * 0.42; pointer.y = screen.h * 0.47; }
    if (args.includes('--theme')) state.cfg.theme = args[args.indexOf('--theme') + 1];
    if (args.includes('--start')) { openStart(true); state.start.until = Date.now() + 14500; }
    tick();
    if (process.env.ODJEZDY_BENCH) { // ODJEZDY_BENCH=20: average ms per frame (render + fb conversion)
      const n = +process.env.ODJEZDY_BENCH, b0 = process.hrtime.bigint();
      for (let i = 0; i < n; i++) { lastNative = 0; t0 -= 1000; tick(); }
      console.log(`bench: ${(Number(process.hrtime.bigint() - b0) / 1e6 / n).toFixed(1)} ms/frame`);
    }
    screen.savePng(PNG_OUT);
    console.log(`wrote ${PNG_OUT} (${screen.w}x${screen.h}, ${m.cols}x${m.rows} LEDs, ${state.deps.length} departures)`);
    return;
  }

  if (IS_CHILD) {
    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGHUP', () => { const was = state.cfg.stop?.ids?.[0]; state.cfg = loadConfig(); if (state.cfg.stop?.ids?.[0] !== was) { state.deps = []; state.lastOk = 0; kick(); } });
    loadCache();
    kick();
    const alertsLoop = async () => { try { await refreshAlerts(); } catch {} setTimeout(alertsLoop, 120000); };
    setTimeout(alertsLoop, 3000);
    pointer.enabled = false;
    setInterval(tick, 50);
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
  if (/(^|\s)odjezdy\.install=1(\s|$)/.test(system.cmdline()) && system.installer.available()) openInstall();
  else if (!state.cfg.forced && !fs.existsSync(marker) && !args.includes('--no-menu')) openStart(true);
  // first run (nothing saved yet) without network but with a Wi-Fi card: Wi-Fi first, then the stop menu
  if (!fs.existsSync(CONFIG_FILE) && state.mode === 'start' && system.wifi.available()) {
    setTimeout(() => system.wifi.status().then((st) => {
      if (st.device && !st.connected && !localIp() && state.mode === 'start') { openWifi(); state.wifi.wizard = true; }
    }).catch(() => {}), 4000); // give DHCP on a cable a moment first
  }
  try { fs.writeFileSync(marker, ''); } catch {}

  loadCache();
  kick();
  const alertsLoop = async () => { try { await refreshAlerts(); } catch (e) { log('alerts: ' + e.message); } setTimeout(alertsLoop, 120000); };
  setTimeout(alertsLoop, 3000);
  setInterval(() => { state.ip = localIp(); if (!state.ip) state.net = 'čekám na síť (DHCP)…'; }, 5000);
  pointer.enabled = state.cfg.custom?.cursor !== false;
  pointer.x = screen.w / 2; pointer.y = screen.h / 2;
  startMouse();
  if (!process.stdin.isTTY) startKeyboard(); // kiosk under a Wayland compositor: no terminal, the keys come from evdev
  setInterval(tick, 50);
  setInterval(scrollTick, 33);
  setInterval(() => { const n = Date.now(); perf.lagMax = Math.max(perf.lagMax, n - lagAt - 100); lagAt = n; }, 100); // how late a 100 ms timer fires
  setInterval(perfTick, 10000);
  setTimeout(updateLoop, 45000); // first check once the network is surely up
  if (!IS_CHILD && !PNG_OUT) {
    const pref0 = displays.preferredMode(), upAt = Date.now();
    if (pref0) setInterval(() => {
      if (Date.now() - upAt < 15000) return;
      const p = displays.preferredMode();
      if (p && p !== pref0) { log(`preferred display mode changed (${pref0} -> ${p}), restarting the board`); shutdown(0); }
    }, 2000);
  }
  if (!IS_CHILD && !PNG_OUT) { try { admin.start(adminApi()); } catch (e) { log('admin start failed: ' + e.message); }
    setInterval(() => { try { applySchedule(); } catch (e) { log('schedule: ' + e.message); } }, 15000); try { applySchedule(); } catch {} }
  if (__dirname === updater.UPDATE_DIR) setTimeout(() => updater.confirm(__dirname), 20000); // new version runs fine
}

main().catch((e) => { log('fatal: ' + e.stack); console.error(e); process.exit(1); });
