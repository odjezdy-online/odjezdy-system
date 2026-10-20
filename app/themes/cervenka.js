// Elektročas hall board as seen in Červenka: black frame, small "DEPARTURE", wide "O D J E Z D", "ABFAHRT" and the time with
// seconds on top, column titles (Druh vlaku, Cílová stanice – Směr jízdy, Pravidelný odjezd, Nást., Kolej, Zpoždění),
// purple-blue bands of two rows with light lettering. "DESTINATION-via" on one line. Imitates the look only.
const { pageAt, pageCount } = require('./_util');
const { fields, emptyText } = require('./_station');
const K = { bg: [8, 8, 12], band: [52, 40, 168], white: [238, 238, 250], grey: [170, 172, 190], red: [226, 40, 40] };
const F = { head: 'BarlowCondensed-SemiBold', led: 'BarlowCondensed-Medium', lab: 'FiraSans-Regular' };
module.exports = {
  id: 'cervenka', name: 'Elektročas (hala Odjezd/Abfahrt)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: [255, 110, 100], 5: K.white, 10: K.white },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezd' }); },
  nativeFont: F.led,
  renderNative(c, t, api) {
    const { state, hhmm } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h, now = new Date();
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    T('DEPARTURE', 70, 62, 20, K.white, F.lab); T('O D J E Z D', 640, 74, 58, K.white, F.head, { align: 'center' }); T('ABFAHRT', 880, 62, 20, K.white, F.lab);
    T(`${hhmm(now)} ${api.pad2(now.getSeconds())}`, W / s - 40, 74, 54, K.white, F.head, { align: 'right' });
    const X = { kind: 52, dest: 190, time: 880, plat: 1010, track: 1090, delay: 1210 };
    T('Druh', 52, 118, 15, K.white, F.lab); T('vlaku', 52, 134, 15, K.white, F.lab);
    T('CÍLOVÁ STANICE  -  Směr jízdy', X.dest, 132, 24, K.white, F.lab);
    T('Pravidelný', X.time, 118, 15, K.white, F.lab); T('odjezd', X.time, 134, 15, K.white, F.lab);
    T('Nást.', X.plat, 132, 15, K.white, F.lab); T('Kolej', X.track, 132, 15, K.white, F.lab); T('Zpoždění', X.delay - 20, 118, 15, K.white, F.lab); T('min', X.delay - 20, 134, 15, K.white, F.lab);
    const deps = api.upcoming(), top = 150, rowH = 66, gap = 20, groupH = 2 * rowH + gap;
    const groups = Math.max(1, Math.floor((H / s - top) / groupH)), per = groups * 2;
    if (!deps.length) T(emptyText(state), W / 2 / s, top + 150, 56, K.white, F.head, { align: 'center' });
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
    const rows = deps.slice(pg * per, pg * per + per);
    for (let g = 0; g * 2 < rows.length; g++) c.rect(34 * s, (top + g * groupH) * s, W - 68 * s, 2 * rowH * s, K.band);
    rows.forEach((d, i) => {
      const f = fields(d, api), g = Math.floor(i / 2), y = top + g * groupH + (i % 2) * rowH + 46;
      const col = f.cancelled ? [255, 150, 140] : K.white;
      if (f.rail && /^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx|Sp)$/.test(f.kind)) c.rect(36 * s, (y - 38) * s, 8 * s, 50 * s, K.red);
      T(f.kind, X.kind, y, 44, col, F.led);
      const via = f.cancelled ? 'ZRUŠEN' : f.notice || f.dir;
      T(f.dest.toUpperCase() + (via ? '-' : ''), X.dest, y, 46, col, F.led, { maxW: (X.time - X.dest - 20) * s });
      const dw = c.measure(f.dest.toUpperCase() + (via ? '-' : ''), F.led, 46 * s) / s;
      if (via) T(via, X.dest + dw, y, 46, col, F.led, { maxW: Math.max(40, X.time - X.dest - dw - 20) * s });
      T(f.time, X.time, y, 48, col, F.led);
      T(f.plat || (f.rail ? '' : ''), X.plat, y, 44, col, F.led);
      T(f.track, X.track, y, 44, col, F.led);
      if (f.delay) T(f.delay, X.delay + 30, y, 44, col, F.led, { align: 'right' });
    });
    if (pages > 1) T(`${pg + 1}/${pages}`, W / s - 40, H / s - 12, 16, K.grey, F.lab, { align: 'right' });
  },
};
