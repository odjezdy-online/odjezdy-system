// UK National Rail style: amber dot-matrix (Infotec "menu" boards).
// "1st 19:42 Destination ... On time", scrolling "Calling at" line under the first train,
// following trains below, big clock bottom centre.
const { paginate, emptyMessage, clockText, marquee, boardKind } = require('./_util');

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
  if (n || state.alerts.length) marquee(m, api, [...state.alerts, n?.text].filter(Boolean).join('   ·   '), 2, W - 2, clockY - nor - 2, 'small', C.DIM, t);
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
      const plat = platformOf(d);
      const dest = `${d.line} ${d.destination || ''}`;
      const pw = plat ? textWidth(`Plat ${plat}`, 'small') + 6 : 0;
      m.text(fitText(dest, 'normal', W - colDest - statusW - pw - 6), colDest, y, 'normal', c);
      if (plat) m.textRight(`Plat ${plat}`, W - statusW - 6, y, 'small', C.DIM);
      m.textRight(status(d), W - 2, y, 'normal', d.delayMinutes >= 5 ? C.WHITE : c);
    };

    // first train + "Calling at" ticker
    let y = 2;
    row(deps[0], 0, y, C.AMBER);
    y += nor + 2;
    const n = depNotice(deps[0]);
    const calling = n ? n.text : `Linka ${deps[0].line} · ${stopLabel(state.cfg.stop)} · zastavuje dle jízdního řádu`;
    m.text('Calling at:', 2, y, 'small', C.DIM);
    marquee(m, api, calling, 2 + textWidth('Calling at: ', 'small'), W - 2, y, 'small', C.AMBER, t);
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
