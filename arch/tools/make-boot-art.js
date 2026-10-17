#!/usr/bin/env node
'use strict';
/*
 * Draws the boot menu backgrounds in the look of the board: a black panel, an
 * amber LED dot matrix with the project name in the board's own dot font
 * (app/font.json). No dependencies; writes plain PNGs.
 *
 *   node arch/tools/make-boot-art.js          # rewrites the two PNGs below
 *
 * The output is committed (arch/profile/grub/themes/odjezdy/background.png and
 * arch/profile/syslinux/splash.png) so building the ISO needs no Node.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const FONT = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'font.json'), 'utf8'));

const BG = [10, 10, 10];
const OFF = [30, 22, 6];      // an unlit LED
const ON = [255, 176, 0];     // amber

// rows of 0/1 for a text in one of the board's bitmap fonts
function textBitmap(text, size) {
  const f = FONT[size];
  const cols = [];
  for (const ch of text) {
    const g = f.glyphs[ch] || f.glyphs['?'];
    const [w, rows] = g;
    for (let x = 0; x < w; x++) {
      cols.push(rows.map(r => (parseInt(r, 16) >> (w - 1 - x)) & 1));
    }
    for (let s = 0; s < f.spacing; s++) cols.push(new Array(f.rows).fill(0));
  }
  return { cols, rows: f.rows };
}

function makeCanvas(w, h) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[3 * i] = BG[0]; px[3 * i + 1] = BG[1]; px[3 * i + 2] = BG[2]; }
  return { w, h, px };
}

function blend(c, i, rgb, a) {
  for (let k = 0; k < 3; k++) c.px[3 * i + k] = Math.round(c.px[3 * i + k] * (1 - a) + rgb[k] * a);
}

// one LED at (cx, cy): a disc with a soft edge, lit ones get a faint glow around them
function led(c, cx, cy, r, lit) {
  const reach = lit ? r * 2.2 : r + 1;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(c.h - 1, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(c.w - 1, Math.ceil(cx + reach)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const i = y * c.w + x;
      if (d <= r + 0.5) {
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        blend(c, i, lit ? ON : OFF, a);
      } else if (lit && d < reach) {
        blend(c, i, ON, 0.10 * (1 - (d - r) / (reach - r)));
      }
    }
  }
}

// draw a dot-matrix text with its top-left corner at (x0, y0); pitch = distance between LEDs
function drawText(c, text, size, x0, y0, pitch, { unlit = true } = {}) {
  const { cols, rows } = textBitmap(text, size);
  const r = pitch * 0.38;
  for (let x = 0; x < cols.length; x++) {
    for (let y = 0; y < rows; y++) {
      const lit = cols[x][y] === 1;
      if (!lit && !unlit) continue;
      led(c, x0 + x * pitch + pitch / 2, y0 + y * pitch + pitch / 2, r, lit);
    }
  }
  return { width: cols.length * pitch, height: rows * pitch };
}

function widthOf(text, size, pitch) { return textBitmap(text, size).cols.length * pitch; }

// 8-bit palette PNG: syslinux's vesamenu is picky, and the art only spans the black -> amber axis anyway
function pngIndexed({ w, h, px }) {
  const pal = Array.from({ length: 256 }, (_, i) => BG.map((b, k) => Math.round(b + (ON[k] - b) * i / 255)));
  const axis = ON.map((v, k) => v - BG[k]);
  const norm = axis.reduce((a, v) => a + v * v, 0);
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const t = [0, 1, 2].reduce((a, k) => a + (px[i + k] - BG[k]) * axis[k], 0) / norm;
      raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }
  }
  const plte = Buffer.from(pal.flat());
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('PLTE', plte), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function pngChunk(type, data) {
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

function png({ w, h, px }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = pngChunk;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// w x h panel: title in the upper part, tagline under it, room for the menu below
function panel(w, h, { titlePitch, tagPitch, top }) {
  const c = makeCanvas(w, h);
  const title = 'ODJEZDY OS';
  const tw = widthOf(title, 'big', titlePitch);
  drawText(c, title, 'big', Math.round((w - tw) / 2), top, titlePitch);
  const tag = 'odjezdy.online';
  const gw = widthOf(tag, 'normal', tagPitch);
  drawText(c, tag, 'normal', Math.round((w - gw) / 2), top + 19 * titlePitch + titlePitch * 2, tagPitch, { unlit: false });
  return c;
}

function write(rel, canvas, encode = png) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encode(canvas));
  console.log(rel, fs.statSync(file).size, 'bytes');
}

if (require.main === module) {
  // GRUB: 1920x1080 (scaled to whatever the firmware gives)
  write('arch/profile/grub/themes/odjezdy/background.png', panel(1920, 1080, { titlePitch: 12, tagPitch: 7, top: 90 }));
  // syslinux vesamenu: 640x480
  write('arch/profile/syslinux/splash.png', panel(640, 480, { titlePitch: 4, tagPitch: 3, top: 36 }), pngIndexed);
}

module.exports = { textBitmap, panel, png, pngIndexed };
