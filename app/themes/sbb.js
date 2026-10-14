// SBB (Switzerland) style: corporate blue screen, white text, line in a white badge,
// delay in red "+5'", platform ("Gleis/Kante") on the right. Header "Abfahrt  Départ  Partenza".
// Station (rail): clock time + Gleis. City stop (urban): waiting time in minutes ("3'") like SBB/VBZ stop displays.
const { paginate, badge, emptyMessage, clockText, marquee, boardKind } = require('./_util');

const SBB_BLUE = [45, 50, 125];

module.exports = {
  id: 'sbb',
  name: 'SBB (Švýcarsko)',
  // Source Sans 3 (OFL) for the main text; its 11-row cut is rough, so small labels stay BUSE
  fonts: { normal: 'sourcesans', big: 'sourcesans' },
  style: 'lcd',
  background: SBB_BLUE,
  unlit: SBB_BLUE,
  colors: { 1: [255, 255, 255], 2: [168, 174, 220], 3: [255, 70, 60], 5: [255, 255, 255], 10: [235, 0, 0] },
  render(m, t, api) {
    const { C, state, textWidth, fitText, hhmm, platformOf, depNotice, stopLabel } = api;
    const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows, big = api.FONTS.big.rows;

    // header: "Abfahrt" in big + station + clock
    const head = ['Odjezd', 'Abfahrt', 'Départ', 'Partenza'][Math.floor(t / 4000) % 4];
    m.text(head, 3, 2, 'big', C.AMBER);
    m.textRight(clockText(api), W - 3, 2, 'normal', C.AMBER);
    m.textRight(fitText(stopLabel(state.cfg.stop), 'small', W / 2), W - 3, 2 + nor + 2, 'small', C.DIM);
    const top = big + 8;
    m.hline(0, W - 1, top - 3, C.AMBER);

    const deps = api.upcoming();
    if (!deps.length) {
      const [a, b] = emptyMessage(api);
      m.text(a, 3, top + 8, 'normal', C.AMBER);
      if (b) m.text(fitText(b, 'small', W - 6), 3, top + 8 + nor + 4, 'small', C.DIM);
      return;
    }

    const badgeW = textWidth('888', 'normal') + 6;
    const colTime = 3 + badgeW + 6, colDest = colTime + textWidth('88:88', 'normal') + 8;
    const platW = textWidth('Kante', 'small') + 6;
    const rowH = nor + sm + 5;
    const per = Math.max(1, Math.floor((m.rows - top - 1) / rowH));
    const urban = boardKind(deps) === 'urban';
    const pg = paginate(deps.slice(0, per * 4), per, t, 7000);
    pg.items.forEach((d, k) => {
      const y = top + k * rowH;
      // line badge: white box, blue text (knock-out)
      badge(m, api, fitText(String(d.line), 'normal', badgeW - 4), 3, y + 1, 'normal', C.WHITE, 0, 2, badgeW);
      const mins = api.minutesTo(d);
      const when = urban ? (mins <= 0 ? 'jetzt' : mins < 60 ? `${mins}'` : hhmm(new Date(api.depTime(d)))) : hhmm(new Date(d.plannedTime));
      m.text(when, colTime, y, 'normal', urban && mins <= 0 ? C.ACCENT : C.AMBER);
      if (d.delayMinutes > 0 && !urban) m.text(`+${d.delayMinutes}'`, colTime, y + nor + 2, 'small', C.ACCENT);
      const plat = platformOf(d);
      if (plat) {
        m.textRight(fitText(plat, 'normal', platW), W - 3, y, 'normal', C.AMBER);
        m.textRight(d.type === 'train' ? 'Gleis' : 'Kante', W - 3, y + nor + 2, 'small', C.DIM);
      }
      const destMax = W - colDest - platW - 8;
      m.text(fitText(d.destination || '', 'normal', destMax), colDest, y, 'normal', C.AMBER);
      const n = depNotice(d);
      if (n) marquee(m, api, n.text, colDest, colDest + destMax, y + nor + 2, 'small', C.ACCENT, t);
      else m.text(fitText(kind(d.type), 'small', destMax), colDest, y + nor + 2, 'small', C.DIM);
    });
    if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 3, m.rows - sm - 1, 'small', C.DIM);
  },
};

function kind(type) {
  return { tram: 'Tram', bus: 'Bus', trolleybus: 'Trolleybus', metro: 'Metro', subway: 'Metro', train: 'Zug', rail: 'Zug', ferry: 'Schiff' }[type] || '';
}
