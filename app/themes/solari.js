// Solari split-flap board (the classic clattering station board, fictional colours): every character sits
// on its own flap tile with a split line; on each page change the tiles flip through random letters and
// settle column by column, like the real mechanics.
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const S = { bg: [16, 16, 18], tile: [40, 40, 44], tileHi: [52, 52, 57], split: [10, 10, 12], white: [240, 240, 232], yellow: [255, 206, 60], dim: [130, 130, 136], red: [255, 90, 70] };
const FONT = 'BarlowCondensed-SemiBold';
const FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const COLS = { time: 5, line: 4, dest: 18, plat: 2 };

module.exports = {
  id: 'solari',
  name: 'Solari (překlápěcí tabule)',
  style: 'lcd',
  background: S.bg,
  unlit: S.bg,
  colors: { 1: S.white, 2: S.dim, 3: S.red, 5: S.white, 10: S.yellow },
  render(m, t, api) { simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: FONT,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, stopLabel, depNotice } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, x0 = 26 * s, x1 = W - 26 * s;
    c.clear(S.bg);
    // tile size from the width: time + line + destination + platform columns plus gaps
    const cells = COLS.time + COLS.line + COLS.dest + COLS.plat, gaps = 3;
    const tw = Math.floor((x1 - x0 - gaps * 18 * s) / cells), th = Math.round(tw * 1.42), pad = Math.max(1, Math.round(2 * s));
    const flap = (str, n, x, y, color, settleAt = 0, flipT = 1e9) => {
      const chars = String(str || '').toUpperCase().normalize('NFC').padEnd(n).slice(0, n);
      for (let i = 0; i < n; i++) {
        const cx = x + i * tw;
        c.roundRect(cx + pad, y, tw - pad * 2, th, 3 * s, S.tile);
        c.rect(cx + pad, y, tw - pad * 2, th / 2, S.tileHi);
        let ch = chars[i];
        // flipping: random letters until this column's settle time
        if (flipT < settleAt + i * 35) ch = FLAP[(Math.floor(flipT / 60) * 7 + i * 13 + Math.floor(y)) % FLAP.length];
        if (ch !== ' ') c.text(ch, cx + tw / 2, y + th * 0.78, { font: FONT, size: th * 0.86, color, align: 'center' });
        c.rect(cx + pad, y + th / 2 - pad / 2, tw - pad * 2, Math.max(1, pad), S.split);
      }
      return x + n * tw;
    };
    // header
    c.text('ODJEZDY  ·  DEPARTURES', x0, 58 * s, { font: FONT, size: 42 * s, color: S.yellow });
    c.text(stopLabel(state.cfg.stop), x0, 92 * s, { font: FONT, size: 26 * s, color: S.dim, maxW: W * 0.6 });
    const now = new Date();
    flap(hhmm(now), 5, x1 - 5 * tw, 30 * s, S.white);
    const top = 128 * s;
    const colT = x0, colL = colT + COLS.time * tw + 18 * s, colD = colL + COLS.line * tw + 18 * s, colP = colD + COLS.dest * tw + 18 * s;
    [['ČAS', colT], ['LINKA', colL], ['SMĚR', colD], ['NÁST.', colP]].forEach(([l, x]) => c.text(l, x + pad, top, { font: FONT, size: 20 * s, color: S.dim }));
    const deps = api.upcoming();
    const rowH = th + 14 * s, first = top + 14 * s;
    if (!deps.length) {
      flap(state.lastOk ? 'ŽÁDNÉ ODJEZDY' : state.error ? 'BEZ SPOJENÍ' : 'NAČÍTÁM', COLS.dest, colD, first, S.white);
      c.text(api.statusText(), x0, c.h - 14 * s, { font: FONT, size: 20 * s, color: S.dim, maxW: x1 - x0 });
      return;
    }
    const per = Math.max(1, Math.floor((c.h - first - 40 * s) / rowH));
    const PAGE = 10000, pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 3) / per))), pg = pageAt(t, PAGE, pages);
    const flipT = t % PAGE; // ms since this page appeared
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = first + i * rowH, mins = minutesTo(d), late = d.delayMinutes >= 5 || d.cancelled;
      flap(hhmm(new Date(d.plannedTime || depTime(d))), COLS.time, colT, y, S.white, 0 + i * 90, flipT);
      flap(d.line, COLS.line, colL, y, S.yellow, 150 + i * 90, flipT);
      const n = depNotice(d);
      // destination flap; delays/notices alternate with it every 4 s like a real board's remark column
      const alt = (late || n) && Math.floor(t / 4000) % 2 === 1;
      const destText = alt ? (d.cancelled ? 'ODPADÁ' : n ? n.text : `ZPOŽDĚNÍ ${d.delayMinutes} MIN`) : d.destination;
      flap(destText, COLS.dest, colD, y, alt ? S.red : mins <= 0 ? S.yellow : S.white, 300 + i * 90, flipT);
      flap(api.platMark(d), COLS.plat, colP, y, S.white, 500 + i * 90, flipT);
    });
    if (pages > 1) c.text(`${pg + 1}/${pages}`, x1, c.h - 14 * s, { font: FONT, size: 20 * s, color: S.dim, align: 'right' });
    c.text(api.statusText(), x0, c.h - 14 * s, { font: FONT, size: 20 * s, color: S.dim, maxW: x1 - x0 - 80 * s });
  },
};
