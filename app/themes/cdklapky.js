// ČD station flap board (the classic Czech "Odjezd / Departure / Abfahrt" board with split-flap plates):
// blue header "Kam To Nach · Přes Via Über · Čas Time Zeit · Zpoždění / Nástupiště …", black body, one plate per
// destination / via / train type, flap digits for the time, delayed or cancelled trains get red-orange plates.
// Imitates the look only (photo reference from the user). Fonts: Barlow Condensed + Fira Sans (OFL).
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const K = {
  bg: [18, 18, 20], blue: [40, 54, 128], white: [240, 240, 238], dim: [150, 156, 178], plate: [30, 33, 44], plateHi: [44, 48, 62],
  edge: [8, 8, 10], red: [214, 62, 34], yellow: [255, 206, 60], rule: [226, 226, 226],
};
const F = { plate: 'BarlowCondensed-SemiBold', head: 'FiraSans-SemiBold', reg: 'FiraSans-Regular' };

module.exports = {
  id: 'cdklapky',
  name: 'ČD klapky (nádraží)',
  style: 'lcd',
  background: K.bg,
  unlit: K.bg,
  colors: { 1: K.white, 2: K.dim, 3: K.red, 5: K.white, 10: K.yellow },
  render(m, t, api) { simpleLed(m, t, api, { title: 'Odjezd' }); },
  nativeFont: F.plate,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, platformOf, depNotice, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, rail = (d) => d.type === 'train' || d.type === 'rail';
    c.clear(K.bg);
    // ---- header (blue) with the trilingual column titles
    c.rect(0, 0, W, 112 * s, K.blue);
    const H = (str, x, y, size, font = F.head, col = K.white, opt = {}) => c.text(str, x * s, y * s, { font, size: size * s, color: col, ...opt });
    H('Odjezd', 36, 50, 38); H('Departure  Abfahrt', 36 + 138, 50, 38, F.reg);
    H('Kam', 36, 96, 19); H('To  Nach', 36 + 52, 96, 19, F.reg);
    H('Přes', 396, 96, 19); H('Via  Über', 396 + 56, 96, 19, F.reg);
    const X = { kam: [36, 372], pres: [384, 676], druh: [688, 812], cas: [826, 1012], zp: [1024, 1148], nast: [1158, 1244] };
    for (const x of [380, 820, 1016]) c.rect(x * s, 8 * s, 2 * s, 98 * s, K.white);
    H('Čas', 836, 36, 20); H('Time', 836, 62, 20, F.reg); H('Zeit', 836, 88, 20, F.reg);
    H('Zpoždění / Nástupiště', 1030, 36, 18); H('Delay / Platform', 1030, 62, 18, F.reg); H('Verspätung / Bahnsteig', 1030, 88, 18, F.reg);
    // ---- plates
    const deps = api.upcoming();
    const top = 124 * s, rowH = 74 * s, per = Math.max(1, Math.floor((c.h - top - 34 * s) / rowH));
    const plate = (x0, x1, y, h, fill, text, size, col = K.white, opt = {}) => {
      const x = x0 * s, w = (x1 - x0) * s;
      c.rect(x, y, w, h, K.edge);
      c.rect(x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, fill);
      c.rect(x + 2 * s, y + 2 * s, w - 4 * s, (h - 4 * s) / 2, fill === K.red ? [226, 78, 48] : K.plateHi); // upper flap is lighter
      c.rect(x + 2 * s, y + h / 2 - 0.5 * s, w - 4 * s, Math.max(1, 1.2 * s), K.edge); // the split between the flaps
      if (text) {
        // long names are set smaller (down to 60 %) before they would be cut, like narrower lettering on a plate
        const room = w - 20 * s, tw = c.measure(text, F.plate, size * s), sz = tw > room ? Math.max(size * 0.6, size * room / tw) : size;
        c.text(text, opt.align === 'center' ? x + w / 2 : x + 12 * s, y + h * 0.7, { font: F.plate, size: sz * s, color: col, maxW: room, ...opt });
      }
    };
    if (!deps.length) {
      plate(36, 676, top + 8 * s, 62 * s, K.plate, state.lastOk ? 'ŽÁDNÉ ODJEZDY' : state.error ? 'NELZE NAČÍST ODJEZDY' : 'NAČÍTÁM ODJEZDY…', 36);
      c.text(api.statusText(), 36 * s, c.h - 14 * s, { font: F.reg, size: 14 * s, color: K.dim, maxW: W - 72 * s });
      return;
    }
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
    const pg = pageAt(t, 8000, pages);
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = top + i * rowH, h = 62 * s;
      const bad = d.cancelled || d.delayMinutes >= 5, fill = bad ? K.red : K.plate;
      const n = depNotice(d);
      plate(...X.kam, y, h, fill, String(d.destination || '').toUpperCase(), 40, K.white);
      const via = d.cancelled ? 'ZRUŠENO' : n ? n.text : [api.trainTag(d), d.via?.length ? d.via.slice(0, 3).join(' – ') : ''].filter(Boolean).join(' · ');
      plate(...X.pres, y, h, fill, via.toUpperCase(), 25, bad ? K.white : [214, 218, 232]);
      const cat = rail(d) ? (d.category || d.line || '') : ({ bus: 'Bus', tram: 'Tram', trolleybus: 'Tb', metro: 'Metro' }[d.type] || '') + ' ' + (d.line ?? '');
      plate(...X.druh, y, h, K.plate, String(cat).trim(), 36, /^(EC|IC|EN|SC|RJ|LE)$/i.test(cat) ? K.yellow : K.white, { align: 'center' });
      // time as flap digits: one tile per character
      const tm = hhmm(new Date(d.plannedTime || depTime(d))).replace(':', '.'), tw = (X.cas[1] - X.cas[0] - 8) / 5;
      [...tm].forEach((ch, k) => {
        const tx = X.cas[0] + 4 + k * tw;
        c.rect(tx * s, y, (tw - 3) * s, h, K.edge);
        c.rect((tx + 1.5) * s, y + 2 * s, (tw - 6) * s, h - 4 * s, K.plate);
        c.rect((tx + 1.5) * s, y + 2 * s, (tw - 6) * s, (h - 4 * s) / 2, K.plateHi);
        c.rect((tx + 1.5) * s, y + h / 2 - 0.5 * s, (tw - 6) * s, Math.max(1, 1.2 * s), K.edge);
        c.text(ch, (tx + tw / 2 - 1.5) * s, y + h * 0.74, { font: F.plate, size: (ch === '.' ? 50 : 46) * s, color: K.white, align: 'center' });
      });
      plate(...X.zp, y, h, K.plate, d.delayMinutes > 0 ? `${d.delayMinutes} min` : '', 34, K.white, { align: 'center' });
      const plat = api.platMark(d);
      plate(...X.nast, y, h, K.plate, plat && rail(d) ? plat : '', 40, K.white, { align: 'center' });
      c.rect(36 * s, y + h + 5 * s, (W / s - 72) * s, Math.max(1, 2 * s), K.rule); // the white rule between rows
    });
    c.text(stopLabel(state.cfg.stop) + (pages > 1 ? `   ${pg + 1}/${pages}` : '') + '   ' + api.statusText(), 36 * s, c.h - 12 * s, { font: F.reg, size: 14 * s, color: K.dim, maxW: W - 72 * s });
  },
};
