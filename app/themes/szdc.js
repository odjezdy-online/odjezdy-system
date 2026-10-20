// SŽDC platform board: dark frame, analog clock and the logo mark on the left, a light-grey display with the column titles
// ("Cílová stanice – Směr", "Druh vlaku / Číslo vlaku", "Pravidelný odjezd", "Zpoždění min") and a blue band with the
// train, on the right the big platform number and "KOLEJ". One panel per departure. Imitates the look only.
const { fields, emptyText } = require('./_station');
const { clockSvg } = require('./_szboard');
const K = { bg: [18, 20, 24], frame: [34, 36, 42], lcd: [206, 210, 216], band: [34, 70, 170], ink: [28, 32, 44], white: [244, 246, 252], grey: [92, 98, 112], red: [200, 30, 30] };
const F = { bold: 'FiraSans-Bold', reg: 'FiraSans-Regular', led: 'BarlowCondensed-Medium', big: 'BarlowCondensed-SemiBold' };
module.exports = {
  id: 'szdc', name: 'SŽDC (nástupiště, hodiny)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: K.red, 5: K.white, 10: K.white },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezd' }); },
  nativeFont: F.big,
  renderNative(c, t, api) {
    const { state } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h, now = new Date();
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    const deps = api.upcoming(), panelH = 220, gap = 14, per = Math.max(1, Math.floor((H / s - 20 + gap) / (panelH + gap)));
    if (!deps.length) T(emptyText(state), W / 2 / s, H / 2 / s, 56, K.white, F.bold, { align: 'center' });
    deps.slice(0, per).forEach((d, i) => {
      const f = fields(d, api), y0 = 10 + i * (panelH + gap), x0 = 20, x1 = W / s - 20, boxW = 230;
      c.rect(x0 * s, y0 * s, (x1 - x0) * s, panelH * s, K.frame);
      c.svg(clockSvg(now), (x0 + 22) * s, (y0 + 28) * s, 150 * s, 150 * s, { color: K.white });
      T('SŽDC', x0 + 97, y0 + 204, 22, K.grey, F.bold, { align: 'center' });
      const lx = x0 + 200, lw = x1 - x0 - 200 - boxW - 20;
      c.rect(lx * s, (y0 + 16) * s, lw * s, (panelH - 32) * s, K.lcd);
      T('CÍLOVÁ STANICE - Směr', lx + 20, y0 + 44, 20, K.ink, F.reg); T('Druh vlaku', lx + 20, y0 + 150, 16, K.ink, F.reg); T('Číslo vlaku', lx + 120, y0 + 150, 16, K.ink, F.reg);
      T('Pravidelný odjezd', lx + lw - 330, y0 + 150, 16, K.ink, F.reg); T('Zpoždění', lx + lw - 90, y0 + 150, 16, K.ink, F.reg); T('min', lx + lw - 90, y0 + 168, 16, K.ink, F.reg);
      c.rect((lx + 14) * s, (y0 + 56) * s, (lw - 28) * s, 80 * s, K.band);
      const via = f.cancelled ? 'ZRUŠEN' : f.notice || f.dir;
      T(f.dest.toUpperCase() + (via ? '-' : ''), lx + 28, y0 + 112, 54, K.white, F.led, { maxW: (lw - 60) * s });
      const dw = c.measure(f.dest.toUpperCase() + (via ? '-' : ''), F.led, 54 * s) / s;
      if (via) T(via, lx + 28 + dw, y0 + 112, 54, [210, 224, 255], F.led, { maxW: Math.max(40, lw - 60 - dw) * s });
      T(f.kind, lx + 28, y0 + 196, 40, K.ink, F.led); T(f.num, lx + 120, y0 + 196, 40, K.ink, F.led);
      T(f.time, lx + lw - 330, y0 + 196, 48, K.ink, F.led);
      if (f.delay) T(f.delay, lx + lw - 24, y0 + 196, 40, K.red, F.led, { align: 'right' });
      // platform: big number and "KOLEJ" on a light box
      const bx = x1 - boxW - 8;
      c.rect(bx * s, (y0 + 16) * s, boxW * s, (panelH - 32) * s, K.lcd);
      T(f.track || f.plat || (f.rail ? '' : ''), bx + boxW / 2 - 10, y0 + 130, 130, K.ink, F.big, { align: 'center', maxW: (boxW - 30) * s });
      T('KOLEJ', bx + boxW / 2, y0 + 184, 28, K.ink, F.bold, { align: 'center' });
    });
  },
};
