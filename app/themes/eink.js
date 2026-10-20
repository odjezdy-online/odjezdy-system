// E-ink (fictional): a calm paper display like the solar-powered e-paper signs at rural stops. Warm off-white,
// black text, thin rules, no seconds and no animation; the page turns only every 15 s.
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const E = { paper: [236, 233, 222], ink: [28, 28, 30], grey: [112, 110, 104], rule: [196, 192, 180], red: [170, 30, 20] };
const F = { reg: 'Lato-Regular', bold: 'Lato-Bold' };

module.exports = {
  id: 'eink',
  name: 'E-ink (fiktivní)',
  style: 'lcd',
  background: E.paper,
  unlit: E.paper,
  colors: { 1: E.ink, 2: E.grey, 3: E.red, 4: E.ink, 5: E.ink, 6: E.ink, 7: E.ink, 8: E.red, 9: E.grey, 10: E.red },
  render(m, t, api) { simpleLed(m, t, api); },
  nativeFont: F.bold,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, x0 = 48 * s, x1 = W - 48 * s;
    c.clear(E.paper);
    c.text(stopLabel(state.cfg.stop), x0, 76 * s, { font: F.bold, size: 48 * s, color: E.ink, maxW: W * 0.7 });
    c.text(hhmm(new Date()), x1, 76 * s, { font: F.bold, size: 48 * s, color: E.ink, align: 'right' });
    c.hline(x0, x1, 100 * s, E.ink, Math.max(1, 3 * s));
    const deps = api.upcoming();
    if (!deps.length) {
      c.text(state.lastOk ? 'V nejbližší době nic neodjíždí' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', x0, 200 * s, { font: F.bold, size: 34 * s, color: E.ink });
      c.text(api.statusText(), x0, 240 * s, { font: F.reg, size: 20 * s, color: E.grey, maxW: x1 - x0 });
      return;
    }
    const top = 116 * s, rowH = 80 * s, per = Math.max(1, Math.floor((c.h - top - 36 * s) / rowH));
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 3) / per))), pg = pageAt(t, 15000, pages);
    const colDest = x0 + 120 * s, timeW = 190 * s;
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = top + i * rowH, mins = minutesTo(d);
      // line: black pill with paper-coloured number
      const label = String(d.line ?? '');
      const pillW = Math.max(70 * s, c.measure(label, F.bold, 30 * s) + 26 * s);
      c.roundRect(x0, y + 16 * s, Math.min(pillW, 104 * s), 44 * s, 22 * s, E.ink);
      const fsz = Math.min(30 * s, (30 * s * (104 * s - 20 * s)) / Math.max(1, c.measure(label, F.bold, 30 * s)));
      c.text(label, x0 + Math.min(pillW, 104 * s) / 2, y + 38 * s + fsz * 0.36, { font: F.bold, size: fsz, color: E.paper, align: 'center' });
      const destMax = x1 - timeW - colDest;
      c.text(d.destination || '', colDest, y + 46 * s, { font: F.bold, size: 34 * s, color: E.ink, maxW: destMax });
      const n = depNotice(d), plat = platformOf(d);
      const sub = d.cancelled ? 'spoj odpadá' : n ? n.text : [api.trainTag(d), api.platLabel(d, 'nástupiště '), api.hasDelay(d) && `zpoždění ${api.delayLabel(d)}`].filter(Boolean).join(' · ');
      if (sub) c.text(sub, colDest, y + 72 * s, { font: F.reg, size: 19 * s, color: d.cancelled || n ? E.red : E.grey, maxW: destMax });
      const when = mins <= 0 ? 'nyní' : mins < 60 ? `${mins} min` : hhmm(new Date(depTime(d)));
      c.text(when, x1, y + 48 * s, { font: F.bold, size: 36 * s, color: E.ink, align: 'right' });
      c.hline(x0, x1, y + rowH - 2 * s, E.rule, 1);
    });
    if (pages > 1) c.text(`${pg + 1}/${pages}`, x1, c.h - 14 * s, { font: F.reg, size: 16 * s, color: E.grey, align: 'right' });
    c.text(api.statusText(), x0, c.h - 14 * s, { font: F.reg, size: 16 * s, color: E.grey, maxW: x1 - x0 - 80 * s });
  },
};
