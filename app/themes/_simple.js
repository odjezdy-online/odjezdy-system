// Plain LED list used as the render() of vector-first themes (when the user forces LED dots or an LED font)
// and by simple recoloured LED themes: header with stop + clock, then line · destination · time rows, paged.
const { paginate, emptyMessage, clockText, marquee } = require('./_util');

function simpleLed(m, t, api, { title } = {}) {
  const { C, state, textWidth, fitText, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows, big = api.FONTS.big.rows;
  const clock = clockText(api);
  m.text(fitText(title ? `${title} ${stopLabel(state.cfg.stop)}` : stopLabel(state.cfg.stop), 'big', W - textWidth(clock, 'normal') - 10), 2, 1, 'big', C.AMBER);
  m.textRight(clock, W - 2, 3, 'normal', C.DIM);
  const top = big + 6;
  m.hline(0, W - 1, top - 3, C.DIM);
  const deps = api.upcoming();
  if (!deps.length) {
    const [a, b] = emptyMessage(api);
    m.text(a, 3, top + 6, 'normal', C.AMBER);
    if (b) m.text(fitText(b, 'small', W - 6), 3, top + 8 + nor, 'small', C.DIM);
    return;
  }
  const lineW = Math.max(textWidth('888', 'normal'), textWidth('X88', 'normal')) + 4;
  const timeW = textWidth('88 min', 'normal');
  const rowH = nor + sm + 4;
  const per = Math.max(1, Math.floor((m.rows - top - sm - 3) / rowH));
  const pg = paginate(deps.slice(0, per * 4), per, t, 8000);
  pg.items.forEach((d, i) => {
    const y = top + i * rowH, mins = minutesTo(d);
    m.text(fitText(String(d.line ?? ''), 'normal', lineW - 2), 2, y, 'normal', C.AMBER);
    const when = mins <= 0 ? '**' : mins < 60 ? `${mins} min` : hhmm(new Date(depTime(d)));
    m.textRight(when, W - 2, y, 'normal', mins <= 0 ? C.WHITE : C.AMBER);
    const plat = api.platMark(d), pw = plat ? textWidth(plat, 'small') + 6 : 0;
    if (plat) m.textRight(plat, W - 4 - timeW, y + 1, 'small', C.DIM);
    const destMax = W - 2 - timeW - pw - lineW - 8;
    m.text(fitText(d.destination || '', 'normal', destMax), lineW + 4, y, 'normal', C.AMBER);
    { const tg = api.trainTag(d), dx = lineW + 4 + textWidth(d.destination || '', 'normal') + 6; if (tg && dx + textWidth(tg, 'small') <= lineW + 4 + destMax) m.text(tg, dx, y + 1, 'small', C.DIM); }
    const n = depNotice(d);
    if (n) marquee(m, api, n.text, lineW + 4, lineW + 4 + destMax, y + nor + 1, 'small', C.RED, t);
    else if (api.hasDelay(d)) m.text(api.delayLabel(d), lineW + 4, y + nor + 1, 'small', api.delayColor(d));
  });
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 2, m.rows - sm - 1, 'small', C.DIM);
  m.text(fitText(api.statusText(), 'small', W - 40), 2, m.rows - sm - 1, 'small', C.DIM);
}

module.exports = { simpleLed };
