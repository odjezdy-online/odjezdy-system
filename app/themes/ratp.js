// Paris RATP "SIEL" style: amber LED, deliberately simple. One block per (line, destination)
// with the waiting time of the next two vehicles in minutes ("Prochain passage").
const { paginate, emptyMessage, clockText } = require('./_util');

module.exports = {
  id: 'ratp',
  name: 'RATP SIEL (Paříž)',
  fonts: 'barlowc', // app/fonts/barlowc.json (OFL, tools/fontgen.js)
  style: 'led',
  background: [0, 0, 0],
  unlit: [20, 12, 0],
  colors: { 1: [255, 150, 0], 2: [130, 76, 0], 5: [255, 205, 120] },
  render(m, t, api) {
    const { C, state, textWidth, fitText, minutesTo, stopLabel, depNotice } = api;
    const W = m.cols, nor = api.FONTS.normal.rows, big = api.FONTS.big.rows, sm = api.FONTS.small.rows;

    m.text(fitText(stopLabel(state.cfg.stop), 'normal', W - 70), 2, 2, 'normal', C.DIM);
    m.textRight(clockText(api), W - 2, 2, 'normal', C.DIM);
    const top = nor + 6;
    m.hline(0, W - 1, top - 3, C.DIM);

    // group: (line, destination) -> next departures
    const groups = new Map();
    for (const d of api.upcoming()) {
      const k = `${d.line}|${d.destination}`;
      if (!groups.has(k)) groups.set(k, { line: String(d.line), dest: d.destination || '', deps: [] });
      groups.get(k).deps.push(d);
    }
    const list = [...groups.values()].sort((a, b) => minutesTo(a.deps[0]) - minutesTo(b.deps[0]));
    if (!list.length) {
      const [a, b] = emptyMessage(api);
      m.textCenter(a, top + 20, 'normal', C.AMBER);
      if (b) m.textCenter(fitText(b, 'small', W - 4), top + 36, 'small', C.DIM);
      return;
    }

    const blockH = big + 5;
    const per = Math.max(1, Math.floor((m.rows - top) / blockH));
    const pg = paginate(list.slice(0, per * 4), per, t, 8000);
    const minsW = textWidth('88', 'big') + textWidth(' mn', 'small');
    const lineW = textWidth('888', 'normal') + 6;
    pg.items.forEach((g, k) => {
      const y = top + k * blockH;
      // line number in a frame
      m.hline(2, 2 + lineW, y, C.AMBER); m.hline(2, 2 + lineW, y + big - 1, C.AMBER);
      for (let yy = y; yy < y + big; yy++) { m.set(2, yy, C.AMBER); m.set(2 + lineW, yy, C.AMBER); }
      m.text(fitText(g.line, 'normal', lineW - 4), 2 + Math.floor((lineW - textWidth(fitText(g.line, 'normal', lineW - 4), 'normal')) / 2) + 1, y + Math.floor((big - nor) / 2), 'normal', C.AMBER);
      // destination + optional notice
      const x0 = 2 + lineW + 6, xMins = W - 2 - minsW * 2 - 10;
      m.text(fitText(g.dest, 'normal', xMins - x0 - 4), x0, y + 1, 'normal', C.AMBER);
      const n = depNotice(g.deps[0]);
      if (n) m.text(fitText(n.text, 'small', xMins - x0 - 4), x0, y + nor + 2, 'small', C.DIM);
      // next two waiting times, big digits
      g.deps.slice(0, 2).forEach((d, i) => {
        const mins = Math.max(0, minutesTo(d));
        const xr = W - 2 - (1 - i) * (minsW + 10);
        if (mins === 0) { if (Math.floor(t / 600) % 2 === 0) m.textRight('0', xr - textWidth(' mn', 'small'), y, 'big', C.WHITE); }
        else m.textRight(mins > 99 ? '99' : String(mins), xr - textWidth(' mn', 'small'), y, 'big', C.AMBER);
        m.textRight('mn', xr, y + big - sm - 1, 'small', C.DIM);
      });
    });
  },
};
