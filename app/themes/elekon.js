// Elekon hall board (ODJEZDY): black frame, wide grey heading, "CÍLOVÁ STANICE", blue bands of three rows with a
// red tick, kind of train, operator, number, destination in white, time, platform and delay. Imitates the look only.
const { pageAt, pageCount } = require('./_util');
const { fields, emptyText } = require('./_station');
const K = { bg: [6, 6, 8], band: [14, 44, 120], white: [244, 244, 246], grey: [180, 182, 190], red: [236, 28, 36], dimw: [210, 214, 232] };
const F = { head: 'FiraSans-SemiBold', bold: 'FiraSans-SemiBold', reg: 'FiraSans-Regular', cond: 'BarlowCondensed-SemiBold' };
module.exports = {
  id: 'elekon', name: 'Elekon (hala, modré pásy)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: [255, 110, 100], 5: K.white, 10: K.white },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.bold,
  renderNative(c, t, api) {
    const { state } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    T('O D J E Z D Y', W / 2 / s, 82, 62, K.grey, F.head, { align: 'center' });
    const X = { tick: 40, kind: 62, op: 150, num: 232, dest: 330, time: 930, plat: 1030, delay: 1226 };
    T('CÍLOVÁ STANICE', X.dest + 4, 136, 26, K.grey, F.reg); T('ZPOŽ.', X.delay, 132, 22, K.grey, F.reg, { align: 'right' });
    const deps = api.upcoming(), top = 150, rowH = 64, gap = 22, groupH = 3 * rowH + gap;
    const groups = Math.max(1, Math.floor((H / s - top) / groupH)), per = groups * 3;
    if (!deps.length) T(emptyText(state), W / 2 / s, top + 150, 56, K.white, F.bold, { align: 'center' });
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
    const rows = deps.slice(pg * per, pg * per + per);
    for (let g = 0; g * 3 < rows.length; g++) c.rect(30 * s, (top + g * groupH) * s, W - 60 * s, 3 * rowH * s, K.band);
    rows.forEach((d, i) => {
      const f = fields(d, api), g = Math.floor(i / 3), y = top + g * groupH + (i % 3) * rowH + 44;
      const col = f.cancelled ? [255, 140, 130] : K.white;
      if (f.rail && /^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx|Sp)$/.test(f.kind)) c.rect(X.tick * s, (y - 36) * s, 6 * s, 48 * s, K.red);
      T(f.kind, X.kind, y, 38, col, F.bold);
      T(f.op, X.op, y - 4, 22, K.dimw, F.reg, { maxW: 70 * s });
      T(f.num, X.num + 70, y - 4, 22, K.dimw, F.reg, { align: 'right' });
      T(f.cancelled ? f.dest.toUpperCase() + '  – ZRUŠEN' : f.dest.toUpperCase(), X.dest, y, 44, col, F.cond, { maxW: (X.time - X.dest - 20) * s });
      T(f.time, X.time, y, 46, col, F.cond);
      T(f.plat || (f.rail ? '' : ''), X.plat, y, 40, col, F.cond);
      if (f.delay) T(f.delay, X.delay, y, 42, col, F.cond, { align: 'right' });
    });
    if (pages > 1) T(`${pg + 1}/${pages}`, W / s - 40, H / s - 12, 16, K.grey, F.reg, { align: 'right' });
  },
};
