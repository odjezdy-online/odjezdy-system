// ČD hall board (České dráhy "Odjezdy" LED boards in station halls): black screen, thin round LEDs in green /
// orange / red depending on the train category, columns Druh · Číslo · CÍLOVÁ STANICE · Směr · Prav. odjezd ·
// Nást. · Kolej · Zpoždění, white "ODJEZDY" heading. Imitates the look only (photo reference from the user).
// Text is rendered as vector Barlow Condensed (OFL) and turned into LEDs with Canvas.dotScreen.
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const GREEN = [96, 226, 64], RED = [255, 58, 40], ORANGE = [255, 150, 24], WHITE = [236, 236, 236], DIM = [120, 150, 120];
const F = { semi: 'BarlowCondensed-SemiBold', med: 'BarlowCondensed-Medium' };

// category -> LED colour: regional trains green, fast/long-distance red, private carriers orange
function colourOf(cat, d) {
  const k = String(cat || '').toUpperCase();
  if (d.cancelled) return RED;
  if (/^(OS|SP|REGIO|OS\.)$/.test(k) || /^[SU]\d+$/.test(k) || (d.type !== 'train' && d.type !== 'rail')) return GREEN; // S1, U4 = suburban lines
  if (/^(R|EX|SC|EC|IC|EN)$/.test(k)) return RED;
  return ORANGE; // LE, RJ and the rest
}

module.exports = {
  id: 'cdhala',
  name: 'ČD hala (LED tabule)',
  style: 'led',
  background: [0, 0, 0],
  unlit: [2, 10, 4],
  colors: { 1: GREEN, 2: DIM, 3: RED, 5: WHITE, 10: ORANGE },
  render(m, t, api) { simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.semi,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, platformOf, depNotice, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, rail = (d) => d.type === 'train' || d.type === 'rail';
    const deps = api.upcoming();
    const pitch = Math.max(2, Math.floor(W / 420));
    c.clear([0, 0, 0]);
    const T = (str, x, y, size, col, opt = {}) => c.text(str, x, y, { font: F.med, size: size * s, color: col, ...opt });
    const top = 168 * s, rowH = 62 * s, per = Math.max(1, Math.floor((c.h - top - 46 * s) / rowH));
    const X = { druh: 24, cislo: 118, cil: 228, smer: 690, cas: 940, nast: 1040, kolej: 1108, zp: 1256 };
    if (!deps.length) {
      T(state.lastOk ? 'ŽÁDNÉ ODJEZDY' : state.error ? 'NELZE NAČÍST ODJEZDY' : 'NAČÍTÁM ODJEZDY…', 24 * s, 260 * s, 46, GREEN, { font: F.semi });
    }
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
    const pg = pageAt(t, 8000, pages);
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = top + (i + 1) * rowH - 16 * s;
      const cat = rail(d) ? (d.category || d.line || '') : ({ bus: 'Bus', tram: 'Tram', trolleybus: 'Tb', metro: 'Metro' }[d.type] || '');
      const num = rail(d) ? String(d.trainNumber || (d.train || '').replace(/^\D+/, '') || '') : String(d.line ?? '');
      const col = colourOf(cat, d);
      T(cat, X.druh * s, y, 36, col, { font: F.semi });
      T(num, X.cislo * s, y, 36, col, { font: F.semi });
      T(String(d.destination || '').toUpperCase(), X.cil * s, y, 38, col, { font: F.semi, maxW: (X.smer - X.cil - 14) * s });
      const n = depNotice(d);
      const via = n ? n.text : d.via?.length ? d.via.slice(0, 3).join(' – ') : '';
      if (via) T(via, X.smer * s, y, 30, n ? RED : col, { maxW: (X.cas - X.smer - 12) * s });
      T(hhmm(new Date(d.plannedTime || depTime(d))), X.cas * s, y, 38, col, { font: F.semi });
      const plat = api.platMark(d);
      if (plat && rail(d)) T(plat, X.kolej * s, y, 36, col, { font: F.semi });
      if (d.cancelled) T('ZRUŠEN', X.zp * s, y, 30, RED, { align: 'right', font: F.semi });
      else if (d.delayMinutes > 0) T(String(d.delayMinutes), X.zp * s, y, 36, col, { align: 'right', font: F.semi });
    });
    c.dotScreen(pitch);
    // crisp heading and column labels on top, like the printed/LCD parts of the real board
    const L = (str, x, y, size, col = WHITE, opt = {}) => c.text(str, x * s, y * s, { font: 'FiraSans-SemiBold', size: size * s, color: col, ...opt });
    L('ODJEZDY', 640, 74, 60, WHITE, { align: 'center' });
    L(stopLabel(state.cfg.stop), 24, 40, 24, [160, 160, 160]);
    L(`${hhmm(new Date())}`, 1256, 40, 28, [160, 160, 160], { align: 'right' });
    const lab = (str, x, al = 'left') => L(str, x, 150, 15, [200, 200, 200], { font: 'FiraSans-Regular', align: al });
    lab('Druh', X.druh); lab('Číslo', X.cislo); lab('CÍLOVÁ STANICE', X.cil); lab('Směr', X.smer);
    lab('Prav. odjezd', X.cas); lab('Nást.', X.nast); lab('Kolej', X.kolej); lab('Zpoždění', X.zp + 4, 'right');
    c.text(api.statusText() + (pages > 1 ? `   ${pg + 1}/${pages}` : ''), 24 * s, c.h - 14 * s, { font: 'FiraSans-Regular', size: 14 * s, color: [110, 110, 110], maxW: W - 48 * s });
  },
};
