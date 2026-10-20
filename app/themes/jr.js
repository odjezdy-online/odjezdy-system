// Japan (JR) style: black LED board with colour-coded service type, alternating
// languages every few seconds (here Czech / English), platform ("track") on the right.
const { paginate, badge, emptyMessage, clockText, marquee } = require('./_util');

// type -> [colour slot, Czech, English]
const KIND = {
  metro: ['GREEN', 'Metro', 'Subway'], subway: ['GREEN', 'Metro', 'Subway'],
  train: ['RED', 'Vlak', 'Train'], rail: ['RED', 'Vlak', 'Train'],
  tram: ['ORANGE', 'Tram', 'Tram'], bus: ['BLUE', 'Bus', 'Bus'], trolleybus: ['BLUE', 'Trolejbus', 'Trolley'],
  ferry: ['YELLOW', 'Přívoz', 'Ferry'],
};

module.exports = {
  id: 'jr',
  name: 'JR (Japonsko)',
  // DotGothic16 (OFL) for the main text; its 11-row cut is illegible, so labels stay in the BUSE small face
  fonts: { normal: 'dotgothic', big: 'dotgothic' },
  style: 'led',
  background: [0, 0, 0],
  unlit: [10, 10, 10],
  colors: { 1: [255, 160, 30], 2: [110, 110, 110], 3: [255, 40, 40], 4: [40, 230, 70], 5: [240, 240, 240], 6: [60, 170, 255], 8: [255, 130, 0] },
  render(m, t, api) {
    const { C, state, textWidth, fitText, hhmm, platformOf, depNotice, stopLabel } = api;
    const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
    const en = Math.floor(t / 4000) % 2 === 1;

    // header
    m.text(en ? 'Departures' : 'Odjezdy', 2, 2, 'normal', C.WHITE);
    { const nx = 2 + textWidth('Departures', 'normal') + 10, room = W - nx - textWidth('88:88:88', 'normal') - 8, nm = stopLabel(state.cfg.stop), fc = textWidth(nm, 'normal') <= room ? 'normal' : 'small';
      m.text(fitText(nm, fc, room), nx, fc === 'small' ? 2 + Math.floor((nor - sm) / 2) : 2, fc, C.AMBER); }
    m.textRight(clockText(api), W - 2, 2, 'normal', C.GREEN);
    const hy = nor + 6;
    const kindW = textWidth('Trolejbus', 'small') + 6;
    const colTime = 2 + kindW + 4, colLine = colTime + textWidth('88:88', 'normal') + 6;
    const colDest = colLine + textWidth('888', 'normal') + 6;
    const platW = textWidth('Track', 'small') + textWidth('8', 'normal') + 6;
    m.text(en ? 'Type' : 'Druh', 2, hy, 'small', C.DIM);
    m.text(en ? 'Time' : 'Čas', colTime, hy, 'small', C.DIM);
    m.text(en ? 'For' : 'Směr', colDest, hy, 'small', C.DIM);
    m.textRight(en ? 'Track' : 'Nást.', W - 2, hy, 'small', C.DIM);
    const top = hy + sm + 4;

    const deps = api.upcoming();
    if (!deps.length) {
      const [a, b] = emptyMessage(api);
      m.text(a, colDest, top + 6, 'normal', C.AMBER);
      if (b) m.text(fitText(b, 'small', W - colDest - 2), colDest, top + 6 + nor + 4, 'small', C.DIM);
      return;
    }

    // the big face first; when it leaves fewer than 8 rows the rows are set in the small face (more departures, whole destinations)
    let face = 'normal', fr = nor;
    if (Math.floor((m.rows - top - sm - 6) / (nor + 4)) < 8) { face = 'small'; fr = sm; }
    const rowH = fr + 4;
    const per = Math.max(1, Math.floor((m.rows - top - sm - 6) / rowH));
    const pg = paginate(deps.slice(0, per * 4), per, t, 8000);
    pg.items.forEach((d, k) => {
      const y = top + k * rowH;
      const [slot, cz, eng] = KIND[d.type] || ['GREY', 'Linka', 'Line'];
      badge(m, api, en ? eng : cz, 2, y + (face === 'small' ? 0 : 1), 'small', C[slot], 0, 2, kindW);
      m.text(hhmm(new Date(d.plannedTime)), colTime, y, face, d.delayMinutes >= 5 ? C.RED : C.AMBER);
      m.text(fitText(String(d.line), face, colDest - colLine - 4), colLine, y, face, C[slot]);
      const plat = api.platMark(d);
      const destMax = W - colDest - platW - 6;
      const dest = d.delayMinutes > 0 ? `${d.destination}  ${en ? `delay ${d.delayMinutes} min` : `zpožď. ${d.delayMinutes} min`}` : d.destination;
      m.text(fitText(dest || '', face, destMax), colDest, y, face, C.WHITE);
      if (plat) m.textRight(fitText(plat, face, platW), W - 2, y, face, C.AMBER);
    });

    // bottom ticker: disruptions / status, like the scrolling info line on JR boards
    const n = deps.map(depNotice).find(Boolean);
    const info = [...api.alertLines(), n?.text].filter(Boolean).join('   ·   ') || (en ? 'Have a nice trip' : 'Šťastnou cestu') + ' · ' + api.statusText();
    marquee(m, api, info, 2, W - 2, m.rows - sm - 2, 'small', state.alerts.length || n ? C.ORANGE : C.GREEN, t);
    if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 2 - textWidth(en ? 'Track' : 'Nást.', 'small') - 8, hy, 'small', C.DIM);
  },
};
