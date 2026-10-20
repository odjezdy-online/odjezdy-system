// Combined bus + train board (two display units side by side, as on some bus-station façades): left "ODJEZDY AUTOBUSŮ /
// BUS DEPARTURES" (line, destination, departure, stand), right "ODJEZDY VLAKŮ / TRAIN DEPARTURES" with a clock (kind and
// number of train, destination, departure, platform, delay). Dark-blue LCD cells in groups of three. Imitates the look only.
const { fields, emptyText } = require('./_station');
const { pageAt, pageCount } = require('./_util');
const K = { bg: [214, 216, 220], panel: [14, 20, 32], cell: [46, 58, 84], white: [236, 240, 250], grey: [160, 170, 190], green: [120, 220, 120], red: [255, 120, 110], clock: [88, 100, 128] };
const F = { head: 'FiraSans-Bold', reg: 'FiraSans-Regular', led: 'BarlowCondensed-Medium' };
module.exports = {
  id: 'busvlak', name: 'Autobusy + vlaky (dvě tabule)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: K.red, 5: K.white, 10: K.white },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.head,
  renderNative(c, t, api) {
    const { state, hhmm } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    const all = api.upcoming().map((d) => ({ d, f: fields(d, api) }));
    const buses = all.filter((x) => !x.f.rail), trains = all.filter((x) => x.f.rail);
    const pw = (W / s - 60) / 2, top = 16, ph = H / s - 32;
    const per = Math.max(3, Math.floor((ph - 150) / 60 / 3) * 3), rowH = 60;
    const pages = pageCount(Math.max(1, Math.ceil(Math.max(buses.length, trains.length, 1) / per))), pg = pageAt(t, 8000, Math.min(4, pages));
    const unit = (x0, title, sub, cols, rows, empty) => {
      c.rect(x0 * s, top * s, pw * s, ph * s, [250, 250, 252]); c.rect((x0 + 8) * s, (top + 8) * s, (pw - 16) * s, (ph - 16) * s, K.panel);
      T(title, x0 + pw / 2 - 40, top + 50, 30, K.white, F.head, { align: 'center' }); T(sub, x0 + pw / 2 - 40, top + 78, 22, K.white, F.reg, { align: 'center' });
      for (const [lab, x, al] of cols) T(lab, x0 + x, top + 112, 15, K.grey, F.reg, { align: al || 'left' });
      const shown = rows.slice(pg * per, pg * per + per);
      for (let g = 0; g * 3 < Math.max(shown.length, 3); g++) c.rect((x0 + 20) * s, (top + 126 + g * (3 * rowH + 14)) * s, (pw - 40) * s, 3 * rowH * s, K.cell);
      if (!shown.length) T(empty, x0 + 36, top + 126 + 3 * rowH - 24, 24, K.green, F.reg);
      return shown;
    };
    // clock of the train unit
    const bx = 20, tx = bx + pw + 20;
    const bs = unit(bx, 'ODJEZDY AUTOBUSŮ', 'BUS DEPARTURES', [['Linka', 38], ['Cílová stanice', 130], ['Odjezd', pw - 150, 'right'], ['Stán.', pw - 44, 'right']], buses, 'Dnes autobusy nejedou.');
    bs.forEach(({ f }, i) => {
      const y = top + 126 + Math.floor(i / 3) * (3 * rowH + 14) + (i % 3) * rowH + 40, col = f.cancelled ? K.red : K.white;
      T(f.line, bx + 70, y, 36, col, F.led, { align: 'right' }); T(f.dest, bx + 110, y, 36, col, F.led, { maxW: (pw - 110 - 200) * s });
      T(f.time, bx + pw - 150, y, 36, col, F.led, { align: 'right' }); T(f.plat, bx + pw - 44, y, 34, col, F.led, { align: 'right' });
    });
    const ts = unit(tx, 'ODJEZDY VLAKŮ', 'TRAIN DEPARTURES', [['Druh', 30], ['Číslo', 128, 'right'], ['Cílová stanice', 150], ['Odjezd', pw - 150, 'right'], ['Kolej', pw - 90, 'right'], ['Zpož.', pw - 30, 'right']], trains, state.lastOk ? 'Dnes vlaky nejedou.' : emptyText(state));
    c.rect((tx + pw - 120) * s, (top + 14) * s, 96 * s, 36 * s, K.clock);
    T(hhmm(new Date()), tx + pw - 72, top + 42, 26, K.white, F.led, { align: 'center' });
    ts.forEach(({ f }, i) => {
      const y = top + 126 + Math.floor(i / 3) * (3 * rowH + 14) + (i % 3) * rowH + 40, col = f.cancelled ? K.red : K.white;
      T(f.kind, tx + 34, y, 34, col, F.led); T(f.num, tx + 128, y, 28, K.grey, F.led, { align: 'right' }); T(f.dest, tx + 150, y, 34, col, F.led, { maxW: (pw - 150 - 180) * s });
      T(f.time, tx + pw - 150, y, 34, col, F.led, { align: 'right' }); T(f.track || f.plat || (f.rail ? '' : ''), tx + pw - 90, y, 34, col, F.led, { align: 'right' });
      if (f.delay) T(f.delay, tx + pw - 30, y, 34, col, F.led, { align: 'right' });
    });
  },
};
