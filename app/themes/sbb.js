// SBB (Switzerland) style: corporate blue screen, white text, line in a white badge,
// delay in red "+5'", platform ("Gleis/Kante") on the right. Header "Abfahrt  Départ  Partenza".
// Station (rail): clock time + Gleis. City stop (urban): waiting time in minutes ("3'") like SBB/VBZ stop displays.
const { paginate, badge, emptyMessage, clockText, marquee, boardKind, pageAt, pageCount } = require('./_util');

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
      const plat = api.platMark(d);
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

// ---------------------------------------------------------------- native (vector) version
// SBB platform/hall screen: corporate blue, white text, line in a white box, red delays,
// rotating "Abfahrt / Départ / Partenza" heading. Lato (OFL) as a free stand-in for SBB's Frutiger.
const SB = { blue: [45, 50, 125], white: [255, 255, 255], dim: [176, 182, 226], red: [255, 70, 60], line: [96, 102, 170] };
const FS = { reg: 'Lato-Regular', bold: 'Lato-Bold' };

function nativeSBB(c, t, api) {
  const { state, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
  const s = Math.min(c.w / 1280, c.h / 720), W = c.w, x0 = 36 * s, x1 = W - 36 * s;
  c.clear(SB.blue);
  const head = ['Odjezd', 'Abfahrt', 'Départ', 'Partenza'][Math.floor(t / 4000) % 4];
  c.text(head, x0, 74 * s, { font: FS.bold, size: 58 * s, color: SB.white });
  const now = new Date();
  c.text(`${hhmm(now)}:${api.pad2(now.getSeconds())}`, x1, 60 * s, { font: FS.bold, size: 38 * s, color: SB.white, align: 'right' });
  c.text(stopLabel(state.cfg.stop), x1, 92 * s, { font: FS.reg, size: 22 * s, color: SB.dim, align: 'right', maxW: W / 2 });
  c.hline(0, W, 112 * s, SB.white, Math.max(1, 3 * s));

  const deps = api.upcoming();
  if (!deps.length) {
    c.text(state.lastOk ? 'Keine Abfahrten' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', x0, 210 * s, { font: FS.bold, size: 36 * s, color: SB.white });
    c.text(api.statusText(), x0, 250 * s, { font: FS.reg, size: 20 * s, color: SB.dim, maxW: x1 - x0 });
    return;
  }
  const urban = deps.slice(0, 20).filter((d) => d.type === 'train' || d.type === 'rail').length < Math.min(deps.length, 20) / 2;
  const top = 130 * s, rowH = 94 * s;
  const per = Math.max(1, Math.floor((c.h - top - 30 * s) / rowH));
  const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 7000, pages);
  const badgeW = 118 * s, colTime = x0 + badgeW + 24 * s, colDest = colTime + 120 * s, platW = 110 * s;
  deps.slice(pg * per, pg * per + per).forEach((d, i) => {
    const y = top + i * rowH;
    // line / train in a white box with blue text
    const label = String(urban ? d.line : d.train || d.line);
    c.roundRect(x0, y + 14 * s, badgeW, 44 * s, 4 * s, SB.white);
    // shrink long train numbers ("Os 28018") to fit the box instead of cutting them
    const fs28 = Math.min(28 * s, (28 * s * (badgeW - 14 * s)) / Math.max(1, c.measure(label, FS.bold, 28 * s)));
    c.text(label, x0 + badgeW / 2, y + 36 * s + fs28 * 0.36, { font: FS.bold, size: fs28, color: SB.blue, align: 'center' });
    const mins = minutesTo(d);
    const when = urban ? (mins <= 0 ? 'jetzt' : mins < 60 ? `${mins}'` : hhmm(new Date(depTime(d)))) : hhmm(new Date(d.plannedTime));
    c.text(when, colTime, y + 48 * s, { font: FS.bold, size: 34 * s, color: urban && mins <= 0 ? SB.red : SB.white });
    if (!urban && d.delayMinutes > 0) c.text(`+${d.delayMinutes}'`, colTime, y + 78 * s, { font: FS.bold, size: 22 * s, color: SB.red });
    c.text(d.cancelled ? `${d.destination} — fällt aus` : d.destination, colDest, y + 48 * s, { font: FS.bold, size: 34 * s, color: d.cancelled ? SB.red : SB.white, maxW: x1 - colDest - platW - 20 * s });
    const n = depNotice(d);
    const sub = n ? n.text : d.via?.length ? d.via.slice(0, 4).join(' · ') : ({ tram: 'Tram', bus: 'Bus', trolleybus: 'Trolleybus', metro: 'Metro', train: 'Zug', ferry: 'Schiff' }[d.type] || '');
    const opW = api.providerLabel(d) ? c.measure(api.providerLabel(d), FS.bold, 16 * s) + 16 * s : 0; // operator in its own cell
    c.text(sub, colDest, y + 78 * s, { font: n ? FS.bold : FS.reg, size: 20 * s, color: n ? SB.red : SB.dim, maxW: x1 - colDest - platW - opW - 36 * s });
    if (opW) {
      c.roundRect(x1 - platW - opW - 10 * s, y + 62 * s, opW, 22 * s, 4 * s, SB.line);
      c.text(api.providerLabel(d), x1 - platW - opW / 2 - 10 * s, y + 78 * s, { font: FS.bold, size: 16 * s, color: SB.white, align: 'center' });
    }
    const plat = api.platMark(d);
    if (plat) {
      c.text(plat, x1, y + 48 * s, { font: FS.bold, size: 34 * s, color: SB.white, align: 'right' });
      c.text(d.type === 'train' ? 'Gleis' : 'Kante', x1, y + 76 * s, { font: FS.reg, size: 18 * s, color: SB.dim, align: 'right' });
    }
    c.hline(x0, x1, y + rowH - 4 * s, SB.line);
  });
  if (pages > 1) c.text(`${pg + 1}/${pages}`, x1, c.h - 12 * s, { font: FS.reg, size: 16 * s, color: SB.dim, align: 'right' });
  c.text(api.statusText(), x0, c.h - 12 * s, { font: FS.reg, size: 16 * s, color: SB.dim, maxW: x1 - x0 - 80 * s });
}

module.exports.renderNative = nativeSBB;
module.exports.nativeFont = FS.bold;
