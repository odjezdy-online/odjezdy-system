// Deutsche Bahn style: LCD screen, white on dark blue, white title bar.
// Two layouts like the real thing:
//   rail  (station):  Zeit | Zug | Ziel | Gleis   + "ca. +5" yellow delay box, small line under the destination
//   urban (city stop): Linie | Ziel | Abfahrt (in min, "sofort")
const { paginate, box, badge, emptyMessage, clockText, marquee, boardKind, isRail, countdown } = require('./_util');

const BLUE = [10, 32, 92];

module.exports = {
  id: 'db',
  name: 'Deutsche Bahn (LCD)',
  style: 'lcd',
  background: BLUE,
  unlit: BLUE,
  colors: { 1: [255, 255, 255], 2: [150, 172, 214], 3: [255, 96, 96], 5: [255, 255, 255], 7: [255, 220, 0] },
  render(m, t, api) {
    const { C, state, fitText, stopLabel } = api;
    const W = m.cols, nor = api.FONTS.normal.rows;

    // title bar: white, text knocked out in the background blue (colour slot 0)
    const barH = nor + 4;
    box(m, 0, 0, W, barH, C.WHITE);
    m.text(fitText(stopLabel(state.cfg.stop), 'normal', W - 60), 3, 2, 'normal', 0);
    m.textRight(clockText(api), W - 3, 2, 'normal', 0);

    const deps = api.upcoming();
    const top = barH + 3;
    if (!deps.length) {
      const [a, b] = emptyMessage(api);
      m.text(a, 30, top + 16, 'normal', C.AMBER);
      if (b) m.text(fitText(b, 'small', W - 34), 30, top + 16 + nor + 4, 'small', C.DIM);
      return;
    }
    if (boardKind(deps) === 'rail') railBoard(m, t, api, deps, top);
    else cityBoard(m, t, api, deps, top);
  },
};

function railBoard(m, t, api, deps, hy) {
  const { C, textWidth, fitText, hhmm, platformOf, depNotice } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
  const colTime = 3, colTrain = colTime + textWidth('88:88', 'normal') + 8;
  const colDest = colTrain + textWidth('Os 8888', 'small') + 8;
  const gleisW = textWidth('Gleis', 'small') + 4;
  m.text('Zeit', colTime, hy, 'small', C.DIM);
  m.text('Zug', colTrain, hy, 'small', C.DIM);
  m.text('Ziel', colDest, hy, 'small', C.DIM);
  m.textRight('Gleis', W - 3, hy, 'small', C.DIM);
  const top = hy + sm + 3;
  const rowH = nor + sm + 6;
  const per = Math.max(1, Math.floor((m.rows - top - 2) / rowH));
  const pg = paginate(deps.slice(0, per * 4), per, t, 7000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    m.hline(0, W - 1, y - 2, C.DIM);
    m.text(hhmm(new Date(d.plannedTime)), colTime, y, 'normal', C.AMBER);
    if (d.delayMinutes > 0) badge(m, api, `ca. +${d.delayMinutes}`, colTime, y + nor + 2, 'small', C.YELLOW, 0, 1);
    else if (d.delayMinutes < 0) m.text(`${d.delayMinutes}`, colTime, y + nor + 2, 'small', C.DIM);
    // train: category + number ("R 1234"); for non-rail rows on a station board, the line
    m.text(fitText(String(d.line), 'small', colDest - colTrain - 4), colTrain, y + 1, 'small', C.AMBER);
    const plat = platformOf(d);
    if (plat) m.textRight(fitText(plat, 'normal', gleisW + 10), W - 3, y, 'normal', C.AMBER);
    const destMax = W - colDest - gleisW - 14;
    m.text(fitText(d.destination || '', 'normal', destMax), colDest, y, 'normal', C.AMBER);
    const n = depNotice(d);
    const sub = n ? n.text : (isRail(d) ? 'Zug' : typeName(d.type));
    marquee(m, api, sub, colDest, colDest + destMax, y + nor + 2, 'small', n ? C.YELLOW : C.DIM, t);
  });
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 3 - gleisW - 10, hy, 'small', C.DIM);
}

function cityBoard(m, t, api, deps, hy) {
  const { C, textWidth, fitText, depNotice } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
  const lineW = textWidth('888', 'normal') + 6;
  const colDest = 3 + lineW + 8;
  const minW = textWidth('88 min', 'normal');
  m.text('Linie', 3, hy, 'small', C.DIM);
  m.text('Ziel', colDest, hy, 'small', C.DIM);
  m.textRight('Abfahrt', W - 3, hy, 'small', C.DIM);
  const top = hy + sm + 4;
  const rowH = nor + 5;
  const per = Math.max(1, Math.floor((m.rows - top - sm - 4) / rowH));
  const pg = paginate(deps.slice(0, per * 3), per, t, 7000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    // line in a white box, like the line badges on BVG/DB city stop screens
    badge(m, api, fitText(String(d.line), 'normal', lineW - 4), 3, y + 1, 'normal', C.WHITE, 0, 2, lineW);
    const cd = countdown(api, d, 'sofort');
    const late = d.delayMinutes > 0;
    m.text(fitText(d.destination || '', 'normal', W - colDest - minW - 30), colDest, y + 1, 'normal', C.AMBER);
    if (late) m.textRight(`+${d.delayMinutes}`, W - 3 - minW - 6, y + 2, 'small', C.YELLOW);
    m.textRight(cd, W - 3, y + 1, 'normal', cd === 'sofort' ? C.YELLOW : C.AMBER);
  });
  // ticker: disruptions for this stop
  const n = deps.map(depNotice).find(Boolean);
  const info = [...api.state.alerts, n?.text].filter(Boolean).join('   ·   ');
  if (info) marquee(m, api, info, 3, W - 3, m.rows - sm - 2, 'small', C.YELLOW, t);
  else m.text(api.statusText(), 3, m.rows - sm - 2, 'small', C.DIM);
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 3 - textWidth('Abfahrt', 'small') - 10, hy, 'small', C.DIM);
}

function typeName(type) {
  return { tram: 'Tram', bus: 'Bus', trolleybus: 'O-Bus', metro: 'U-Bahn', subway: 'U-Bahn', train: 'Zug', rail: 'Zug', ferry: 'Fähre' }[type] || 'Linie';
}
