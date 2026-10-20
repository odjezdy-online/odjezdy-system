// NS (Netherlands) style: deep blue screen, yellow "Vertrek" band, white text, platform number in a white
// square, delays as "+5" in orange-red next to the time. Fira Sans (OFL) as a stand-in for NS Sans.
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const N = { blue: [0, 48, 130], band: [255, 201, 23], white: [255, 255, 255], dim: [160, 186, 230], red: [255, 96, 64], line: [40, 84, 160] };
const F = { reg: 'FiraSans-Regular', semi: 'FiraSans-SemiBold', bold: 'FiraSans-Bold' };

module.exports = {
  id: 'ns',
  name: 'NS (Nizozemsko)',
  style: 'lcd',
  background: N.blue,
  unlit: N.blue,
  colors: { 1: N.white, 2: N.dim, 3: N.red, 5: N.white, 10: N.band },
  render(m, t, api) { simpleLed(m, t, api, { title: 'Vertrek' }); },
  nativeFont: F.bold,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, x0 = 34 * s, x1 = W - 34 * s;
    c.clear(N.blue);
    c.rect(0, 0, W, 96 * s, N.band);
    c.text('Vertrek', x0, 64 * s, { font: F.bold, size: 46 * s, color: N.blue });
    c.text(stopLabel(state.cfg.stop), x0 + c.measure('Vertrek', F.bold, 46 * s) + 26 * s, 62 * s, { font: F.semi, size: 30 * s, color: N.blue, maxW: W * 0.55 });
    c.text(hhmm(new Date()), x1, 64 * s, { font: F.bold, size: 46 * s, color: N.blue, align: 'right' });

    const deps = api.upcoming();
    const colTime = x0, colDest = x0 + 150 * s, platW = 70 * s, colKind = x1 - platW - 24 * s;
    c.text('Tijd', colTime, 132 * s, { font: F.reg, size: 20 * s, color: N.dim });
    c.text('Naar / Opmerkingen', colDest, 132 * s, { font: F.reg, size: 20 * s, color: N.dim });
    c.text('Spoor', x1, 132 * s, { font: F.reg, size: 20 * s, color: N.dim, align: 'right' });
    if (!deps.length) {
      c.text(state.lastOk ? 'Geen vertrekken' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', x0, 230 * s, { font: F.bold, size: 36 * s, color: N.white });
      c.text(api.statusText(), x0, 270 * s, { font: F.reg, size: 20 * s, color: N.dim, maxW: x1 - x0 });
      return;
    }
    const top = 146 * s, rowH = 88 * s, per = Math.max(1, Math.floor((c.h - top - 34 * s) / rowH));
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = top + i * rowH;
      c.hline(x0, x1, y, N.line, Math.max(1, 2 * s));
      c.text(hhmm(new Date(d.plannedTime || depTime(d))), colTime, y + 46 * s, { font: F.bold, size: 34 * s, color: N.white });
      if (d.delayMinutes > 0) c.text(`+${d.delayMinutes}`, colTime + 96 * s, y + 46 * s, { font: F.bold, size: 26 * s, color: N.red });
      const mins = minutesTo(d);
      if (mins >= 0 && mins < 10) c.text(mins <= 0 ? 'nu' : `${mins} min`, colTime, y + 76 * s, { font: F.reg, size: 18 * s, color: N.dim });
      const kind = `${d.train || d.line || ''}`.trim();
      const destMax = colKind - colDest - 20 * s;
      c.text(d.cancelled ? `${d.destination} — rijdt niet` : d.destination || '', colDest, y + 46 * s, { font: F.bold, size: 34 * s, color: d.cancelled ? N.red : N.white, maxW: destMax });
      const n = depNotice(d);
      const sub = n ? n.text : d.via?.length ? 'via ' + d.via.slice(0, 4).join(', ') : kind;
      c.text(sub, colDest, y + 76 * s, { font: n ? F.semi : F.reg, size: 19 * s, color: n ? N.band : N.dim, maxW: destMax });
      const plat = api.platMark(d);
      if (plat) {
        c.roundRect(x1 - platW, y + 14 * s, platW, 46 * s, 4 * s, N.white);
        const fsz = Math.min(30 * s, (30 * s * (platW - 10 * s)) / Math.max(1, c.measure(plat, F.bold, 30 * s)));
        c.text(plat, x1 - platW / 2, y + 37 * s + fsz * 0.36, { font: F.bold, size: fsz, color: N.blue, align: 'center' });
      }
    });
    if (pages > 1) c.text(`${pg + 1}/${pages}`, x1, c.h - 12 * s, { font: F.reg, size: 16 * s, color: N.dim, align: 'right' });
    c.text(api.statusText(), x0, c.h - 12 * s, { font: F.reg, size: 16 * s, color: N.dim, maxW: x1 - x0 - 80 * s });
  },
};
