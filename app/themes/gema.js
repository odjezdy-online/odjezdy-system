// Gema hall board (Odjezdy – Abfahrt): black frame, white heading, printed column titles, yellow LED text on
// dark-green bands of three rows; red category for "R". Imitates the look of the board in Ústí nad Labem hl.n.
const { pageAt, pageCount } = require('./_util');
const { fields, emptyText } = require('./_station');
const K = { bg: [10, 10, 10], band: [12, 62, 28], white: [236, 236, 236], grey: [190, 190, 190], led: [255, 226, 0], red: [255, 62, 40], orange: [255, 160, 20] };
const F = { head: 'FiraSans-Bold', lab: 'FiraSans-SemiBold', led: 'BarlowCondensed-SemiBold' };
module.exports = {
  id: 'gema', name: 'Gema (hala, žluté LED)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.led, 2: K.grey, 3: K.red, 5: K.led, 10: K.led },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.led,
  renderNative(c, t, api) {
    const { state } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    T('Odjezdy - Abfahrt', 640, 76, 58, K.white, F.head, { align: 'center' });
    const X = { kind: 52, num: 150, dest: 262, dir: 640, time: 960, plat: 1118, delay: 1226 };
    const lab = (a, b, x, al = 'left') => { T(a, x, 142, 17, K.white, F.lab, { align: al }); if (b) T(b, x, 160, 17, K.white, F.lab, { align: al }); };
    lab('Druh', 'vlaku', X.kind - 8); lab('Číslo', 'vlaku', X.num - 4); T('Cílová stanice', X.dest, 158, 20, K.white, F.lab);
    T('Směr jízdy', X.dir, 158, 20, K.white, F.lab); lab('Pravidelný', 'odjezd', X.time - 2); T('Nástup.', X.plat - 6, 158, 17, K.white, F.lab); T('Zpoždění', X.delay - 28, 142, 17, K.white, F.lab);
    const deps = api.upcoming(), top = 176, rowH = 66, groupH = 3 * rowH + 22;
    const groups = Math.max(1, Math.floor((H / s - top) / groupH)), per = groups * 3;
    if (!deps.length) T(emptyText(state), W / 2 / s, top + 150, 56, K.led, F.led, { align: 'center' });
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
    const rows = deps.slice(pg * per, pg * per + per);
    for (let g = 0; g * 3 < rows.length; g++) c.rect(30 * s, (top + g * groupH) * s, W - 60 * s, 3 * rowH * s, K.band);
    rows.forEach((d, i) => {
      const f = fields(d, api), g = Math.floor(i / 3), y = top + g * groupH + (i % 3) * rowH + 46;
      const col = f.cancelled ? K.red : K.led;
      T(f.kind, X.kind, y, 44, /^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx)$/.test(f.kind) ? K.red : K.orange, F.led);
      T(f.num, X.num, y, 44, col, F.led);
      T(f.dest.toUpperCase(), X.dest, y, 46, col, F.led, { maxW: (X.dir - X.dest - 20) * s });
      T(f.cancelled ? 'ZRUŠEN' : f.notice || f.dir, X.dir, y, 44, f.notice ? K.orange : col, F.led, { maxW: (X.time - X.dir - 20) * s });
      T(f.time, X.time, y, 48, col, F.led);
      T(f.plat || (f.rail ? '' : ''), X.plat, y, 44, col, F.led);
      if (f.delay) T(f.delay, X.delay, y, 44, col, F.led, { align: 'right' });
    });
    if (pages > 1) T(`${pg + 1}/${pages}`, W / s - 40, H / s - 12, 16, K.grey, F.lab, { align: 'right' });
  },
};
