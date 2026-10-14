// Deutsche Bahn style: LCD screen, white on dark blue, white title bar.
// Two layouts like the real thing:
//   rail  (station):  like bahnhof.de "Abfahrt": train badge + time (+ new time in a white box) | Über/Ziel | Gleis
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
  const { C, textWidth, fitText, hhmm, platformOf, depNotice, depTime } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
  const leftW = textWidth('88:88', 'normal') + textWidth('88:88', 'small') + 10;
  const colMid = leftW + 8;
  const gleisW = textWidth('Gleis', 'small') + 4;
  const midEnd = W - gleisW - 10;
  m.textRight('Zug/Bus', leftW, hy, 'small', C.DIM);
  m.text('Über', colMid, hy, 'small', C.DIM);
  m.textRight('Gleis', W - 3, hy, 'small', C.DIM);
  const hy2 = hy + sm + 1;
  m.textRight('Zeit', leftW, hy2, 'small', C.DIM);
  m.text('Ziel', colMid, hy2, 'small', C.DIM);
  const lineY = hy2 + sm + 1;
  m.hline(2, leftW, lineY, C.AMBER); m.hline(colMid, midEnd, lineY, C.AMBER); m.hline(midEnd + 6, W - 3, lineY, C.AMBER);

  const top = lineY + 4;
  const rowH = sm + nor + 7;
  const per = Math.max(1, Math.floor((m.rows - top - 1) / rowH));
  const pg = paginate(deps.slice(0, per * 4), per, t, 8000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    const yTime = y + sm + 2;
    // train / line badge (S-Bahn green pill, everything else grey)
    const label = fitText(d.train || String(d.line), 'small', leftW - 4);
    const sbahn = /^S\s?\d/.test(String(d.line));
    const bw = textWidth(label, 'small') + 4;
    badge(m, api, label, leftW - bw + 1, y + 1, 'small', sbahn ? C.GREEN : C.GREY, sbahn ? C.WHITE : C.WHITE, 2);
    // planned time, and the expected one in a white box when late
    const planned = hhmm(new Date(d.plannedTime));
    if (d.delayMinutes > 0) {
      const exp = hhmm(new Date(depTime(d)));
      const ew = textWidth(exp, 'small') + 4;
      badge(m, api, exp, leftW - ew + 1, yTime + 2, 'small', C.WHITE, 0, 2);
      m.textRight(planned, leftW - ew - 3, yTime, 'normal', C.AMBER);
    } else {
      m.textRight(planned, leftW, yTime, 'normal', C.AMBER);
    }
    // small line above the destination: disruption first, otherwise operator / line
    const n = depNotice(d);
    const over = n ? n.text : [d.train && d.line && d.train !== String(d.line) ? d.line : '', d.provider].filter(Boolean).join(' · ');
    if (over) marquee(m, api, over, colMid, midEnd, y + 1, 'small', n ? C.YELLOW : C.DIM, t);
    const dest = d.cancelled ? `${d.destination}  · fällt aus` : d.destination || '';
    m.text(fitText(dest, 'normal', midEnd - colMid), colMid, yTime, 'normal', d.cancelled ? C.RED : C.AMBER);
    const plat = platformOf(d);
    if (plat) m.textRight(fitText(plat, 'normal', gleisW + 6), W - 3, yTime, 'normal', C.AMBER);
    // underline per column, like the screenshot
    const uy = y + rowH - 2;
    m.hline(2, leftW, uy, C.DIM); m.hline(colMid, midEnd, uy, C.DIM); m.hline(midEnd + 6, W - 3, uy, C.DIM);
  });
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, midEnd, hy, 'small', C.DIM);
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
