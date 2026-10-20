// UK National Rail style: amber dot-matrix (Infotec "menu" boards).
// "1st 19:42 Destination ... On time", scrolling "Calling at" line under the first train,
// following trains below, big clock bottom centre.
const { paginate, emptyMessage, clockText, marquee, boardKind, pageAt, pageCount } = require('./_util');

// London "Countdown" bus-stop sign: "1  Edgware   2 min", stop name on top, "due" when arriving.
function countdownBoard(m, t, api, deps, clockY) {
  const { C, state, textWidth, fitText, minutesTo, stopLabel, depNotice } = api;
  const W = m.cols, nor = api.FONTS.normal.rows;
  m.text(fitText(stopLabel(state.cfg.stop), 'normal', W - 4), 2, 2, 'normal', C.AMBER);
  m.hline(0, W - 1, nor + 4, C.DIM);
  const top = nor + 8, rowH = nor + 4;
  const lineW = textWidth('888', 'normal') + 4, minW = textWidth('88 min', 'normal');
  const per = Math.max(1, Math.floor((clockY - 4 - top) / rowH));
  const pg = paginate(deps.slice(0, per * 3), per, t, 6000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    const mins = minutesTo(d);
    m.text(fitText(String(d.line), 'normal', lineW), 2, y, 'normal', C.AMBER);
    m.text(fitText(d.destination || '', 'normal', W - lineW - minW - 10), 2 + lineW + 4, y, 'normal', C.AMBER);
    m.textRight(mins <= 0 ? 'due' : mins < 60 ? `${mins} min` : api.hhmm(new Date(api.depTime(d))), W - 2, y, 'normal', mins <= 0 ? C.WHITE : C.AMBER);
  });
  const n = deps.map(depNotice).find(Boolean);
  if (n || state.alerts.length) marquee(m, api, [...api.alertLines(), n?.text].filter(Boolean).join('   ·   '), 2, W - 2, clockY - nor - 2, 'small', C.DIM, t);
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 2, clockY + 4, 'small', C.DIM);
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

module.exports = {
  id: 'uk',
  name: 'UK National Rail',
  // Barlow Condensed (OFL) for the dot-matrix text; small labels stay in the BUSE small face
  fonts: { normal: 'barlowc', big: 'barlowc' },
  style: 'led',
  background: [0, 0, 0],
  unlit: [22, 14, 0],
  colors: { 1: [255, 176, 0], 2: [140, 92, 0], 5: [255, 210, 90] },
  alertStyle: { bg: [0, 0, 0], ink: [255, 176, 0], accent: [255, 96, 30], dim: [150, 100, 0], dots: 420, off: [16, 10, 4] }, // the notice replaces the departures, as LEDs
  render(m, t, api) {
    const { C, state, textWidth, fitText, hhmm, depTime, platformOf, minutesTo, depNotice, stopLabel } = api;
    const W = m.cols, nor = api.FONTS.normal.rows, big = api.FONTS.big.rows;
    const clockY = m.rows - big - 2;

    // big clock, bottom centre (the signature of a UK board)
    m.textCenter(clockText(api), clockY, 'big', C.AMBER);

    const deps = api.upcoming();
    if (!deps.length) {
      const [a, b] = emptyMessage(api);
      m.textCenter(fitText(stopLabel(state.cfg.stop), 'normal', W - 4), 4, 'normal', C.DIM);
      m.textCenter(a, 30, 'normal', C.AMBER);
      if (b) m.textCenter(fitText(b, 'small', W - 4), 46, 'small', C.DIM);
      return;
    }

    // tram/bus/metro stop -> London bus "Countdown" sign instead of the National Rail station board
    if (boardKind(deps) === 'urban') return countdownBoard(m, t, api, deps, clockY);

    const ordW = textWidth('10th', 'normal') + 4, timeW = textWidth('88:88', 'normal') + 6;
    const statusW = textWidth('Zpožd. +88', 'normal');
    const colDest = 2 + ordW + timeW;
    const status = (d) => {
      if (minutesTo(d) <= 0 && !(d.delayMinutes > 0)) return 'Odjíždí';
      if (d.delayMinutes > 0) return d.delayMinutes >= 5 ? `Exp ${hhmm(new Date(depTime(d)))}` : `Zpožd. +${d.delayMinutes}`;
      return 'Včas';
    };
    const row = (d, i, y, c) => {
      m.text(ORD[i] || `${i + 1}th`, 2, y, 'normal', c);
      m.text(hhmm(new Date(d.plannedTime)), 2 + ordW, y, 'normal', c);
      const plat = api.platLabel(d, 'Plat ');
      const dest = `${d.line} ${d.destination || ''}`;
      const pw = plat ? textWidth(plat, 'small') + 6 : 0;
      m.text(fitText(dest, 'normal', W - colDest - statusW - pw - 6), colDest, y, 'normal', c);
      if (plat) m.textRight(plat, W - statusW - 6, y, 'small', C.DIM);
      m.textRight(status(d), W - 2, y, 'normal', d.delayMinutes >= 5 ? C.WHITE : c);
    };

    // first train + "Calling at" ticker
    let y = 2;
    row(deps[0], 0, y, C.AMBER);
    y += nor + 2;
    const n = depNotice(deps[0]);
    const calling = n ? n.text : deps[0].via?.length ? deps[0].via.join(', ') + '.' : ''; // no stop list: leave the row empty (a scrolling filler sentence was cut into nonsense like "řádu")
    if (calling) {
      m.text('Calling at:', 2, y, 'small', C.DIM);
      marquee(m, api, calling, 2 + textWidth('Calling at: ', 'small'), W - 2, y, 'small', C.AMBER, t);
    }
    y += nor + 4;

    // following trains, paged
    const rowH = nor + 3;
    const per = Math.max(1, Math.floor((clockY - 4 - y) / rowH));
    const rest = deps.slice(1, ORD.length).map((d, i) => ({ d, i: i + 1 }));
    const pg = paginate(rest, per, t, 6000);
    pg.items.forEach(({ d, i }, k) => row(d, i, y + k * rowH, C.AMBER));
    if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 2, clockY + 4, 'small', C.DIM);
    if (state.error) m.text('!', 2, clockY + 4, 'normal', C.WHITE);
  },
};

// ---------------------------------------------------------------- native (vector) version
// Text is rendered like a browser would (anti-aliased TrueType, Barlow Condensed), then turned into
// round amber LEDs by Canvas.dotScreen — smooth letter shapes, real dot-matrix look.
const AMBER = [255, 176, 0], DIMA = [150, 100, 0], WHITE = [255, 222, 140];
const FU = { semi: 'BarlowCondensed-SemiBold', med: 'BarlowCondensed-Medium' };
const ORDN = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

function nativeUK(c, t, api) {
  const { state, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
  const s = Math.min(c.w / 1280, c.h / 720), W = c.w, x0 = 24 * s, x1 = W - 24 * s;
  c.clear([0, 0, 0]);
  const now = new Date();
  const clock = `${hhmm(now)}:${api.pad2(now.getSeconds())}`;
  c.text(clock, W / 2, c.h - 30 * s, { font: FU.semi, size: 86 * s, color: AMBER, align: 'center' });
  const deps = api.upcoming();
  const T = (str, x, y, size, col = AMBER, opt = {}) => c.text(str, x, y, { font: FU.semi, size: size * s, color: col, ...opt });
  if (!deps.length) {
    T(stopLabel(state.cfg.stop), W / 2, 90 * s, 46, DIMA, { align: 'center' });
    T(state.lastOk ? 'No departures' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', W / 2, 300 * s, 60, AMBER, { align: 'center' });
    return c.dotScreen(Math.max(2, Math.floor(W / 420)));
  }
  const urban = deps.slice(0, 20).filter((d) => d.type === 'train' || d.type === 'rail').length < Math.min(deps.length, 20) / 2;
  const status = (d) => (d.cancelled ? 'Cancelled' : minutesTo(d) <= 0 && !(d.delayMinutes > 0) ? 'Odjíždí'
    : d.delayMinutes >= 5 ? `Exp ${hhmm(new Date(depTime(d)))}` : d.delayMinutes > 0 ? `Zpožd. +${d.delayMinutes}` : 'Včas');
  if (urban) {
    // London "Countdown": stop name, then "line  destination   N min"
    T(stopLabel(state.cfg.stop), x0, 64 * s, 50);
    const rowH = 66 * s, per = Math.max(1, Math.floor((c.h - 130 * s - 110 * s) / rowH));
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 3) / per))), pg = pageAt(t, 6000, pages);
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = 140 * s + i * rowH;
      const mins = minutesTo(d);
      T(String(d.line), x0, y, 50);
      T(d.destination, x0 + 130 * s, y, 50, AMBER, { maxW: x1 - x0 - 330 * s });
      T(mins <= 0 ? 'due' : mins < 60 ? `${mins} min` : hhmm(new Date(depTime(d))), x1, y, 50, mins <= 0 ? WHITE : AMBER, { align: 'right' });
    });
    if (pages > 1) T(`${pg + 1}/${pages}`, x1, c.h - 30 * s, 30, DIMA, { align: 'right' });
    return c.dotScreen(Math.max(2, Math.floor(W / 420)));
  }
  // National Rail station board
  const row = (d, i, y, size) => {
    T(ORDN[i] || `${i + 1}th`, x0, y, size);
    T(hhmm(new Date(d.plannedTime)), x0 + 90 * s, y, size);
    const st = status(d), sw = c.measure(st, FU.semi, size * s);
    const plat = api.platLabel(d, 'Plat ');
    const pw = plat ? c.measure(plat, FU.semi, size * 0.8 * s) + 30 * s : 0;
    T(`${d.train || d.line}  ${d.destination}`, x0 + 220 * s, y, size, AMBER, { maxW: x1 - x0 - 220 * s - sw - pw - 30 * s });
    if (plat) T(plat, x1 - sw - 24 * s, y, size * 0.8, DIMA, { align: 'right' });
    T(st, x1, y, size, d.cancelled || d.delayMinutes >= 5 ? WHITE : AMBER, { align: 'right' });
  };
  row(deps[0], 0, 64 * s, 52);
  // "Calling at" ticker (clipped by painting the margins back to black)
  const n = depNotice(deps[0]);
  const calling = n ? n.text : deps[0].via?.length ? deps[0].via.join(', ') + '.' : ''; // no stop list: leave the row empty (a scrolling filler sentence was cut into nonsense like "řádu")
  if (calling) {
    const lx = x0 + c.measure('Calling at: ', FU.med, 36 * s), tw = c.measure(calling, FU.med, 36 * s) + 80 * s;
    const off = (t / 25) % (tw + (x1 - lx));
    c.text(calling, x1 - off, 122 * s, { font: FU.med, size: 36 * s, color: AMBER });
    c.rect(0, 88 * s, lx, 46 * s, [0, 0, 0]);
    c.text('Calling at:', x0, 122 * s, { font: FU.med, size: 36 * s, color: DIMA });
  }
  const rowH = 64 * s, top = 200 * s, per = Math.max(1, Math.floor((c.h - top - 120 * s) / rowH));
  const rest = deps.slice(1, 12).map((d, i) => ({ d, i: i + 1 }));
  const pages = pageCount(Math.max(1, Math.ceil(rest.length / per))), pg = pageAt(t, 6000, pages);
  rest.slice(pg * per, pg * per + per).forEach(({ d, i }, k) => row(d, i, top + k * rowH, 46));
  if (pages > 1) T(`${pg + 1}/${pages}`, x1, c.h - 30 * s, 30, DIMA, { align: 'right' });
  c.dotScreen(Math.max(2, Math.floor(W / 420)));
}

module.exports.renderNative = nativeUK;
module.exports.nativeFont = FU.semi;
