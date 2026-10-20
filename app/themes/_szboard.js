// Czech station board in the layout of the Správa železnic standard SŽ SM118 (fields: kind of train, number, line,
// operator, destination, via, departure, expected departure, notice, platform) and its look-alikes: the same layout
// with different palettes / fonts / LED filter. Imitates the arrangement only; nothing here is copied from a real board.
// Used by sz.js (black LCD), elektrocas.js (amber LEDs), gema.js (light LCD).
const { pageAt, pageCount } = require('./_util');

// analog station clock as a vector icon (face ring, 12 ticks, hour / minute / second hands), 100x100 units
function clockSvg(now) {
  const rect = (a, r0, r1, w) => { // a thin rectangle from radius r0 to r1 around the centre at angle a (radians, 0 = up)
    const sx = Math.sin(a), sy = -Math.cos(a), nx = -sy * w / 2, ny = sx * w / 2;
    const p = [[50 + sx * r0 + nx, 50 + sy * r0 + ny], [50 + sx * r1 + nx, 50 + sy * r1 + ny], [50 + sx * r1 - nx, 50 + sy * r1 - ny], [50 + sx * r0 - nx, 50 + sy * r0 - ny]];
    return 'M' + p.map((q) => q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join('L') + 'Z';
  };
  const sec = now.getSeconds() + now.getMilliseconds() / 1000, min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
  let d = 'M50 1A49 49 0 1 1 49.99 1Z M50 5A45 45 0 1 0 50.01 5Z'; // ring (inner circle wound the other way = hole)
  for (let i = 0; i < 12; i++) d += rect((i * Math.PI) / 6, 36, i % 3 === 0 ? 43 : 41, i % 3 === 0 ? 3.4 : 2);
  d += rect((hr / 12) * 2 * Math.PI, -6, 26, 5) + rect((min / 60) * 2 * Math.PI, -8, 38, 3.4) + rect((sec / 60) * 2 * Math.PI, -10, 40, 1.4);
  return `<svg viewBox="0 0 100 100"><path d="${d}"/></svg>`;
}

const CAT = /^(EC|IC|EN|SC|AEx|Ex|R|Sp|Os|rj|RJ|LE|TLX|Rx|Pn|Nex|Mn)$/;

// opts: id, name, palette { bg, head, headInk, ink, dim, time, late, ok, rule, row2 }, fonts { head, bold, reg }, dots (pitch fn or null)
function makeBoard(opts) {
  const P = opts.palette, F = opts.fonts;
  return {
    id: opts.id,
    name: opts.name,
    style: 'lcd',
    background: P.bg,
    unlit: P.bg,
    colors: { 1: P.ink, 2: P.dim, 3: P.late, 5: P.ink, 10: P.time },
    render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: opts.title || 'Odjezdy' }); },
    nativeFont: F.bold,
    alertStyle: { bg: P.bg, ink: P.ink, accent: P.late, dim: P.dim, dots: opts.dots || 0, off: P.off },
    renderNative(c, t, api) {
      const { state, hhmm, depTime, minutesTo, stopLabel } = api;
      const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h, now = new Date();
      c.clear(P.bg);
      const T = (str, x, y, size, col, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font: o.font || F.reg, size: size * s, color: col, ...o });
      // ---- header: stop name, digital time, analog clock
      const headH = 96;
      c.rect(0, 0, W, headH * s, P.head);
      T(String(stopLabel(state.cfg.stop)).toUpperCase(), 32, 62, 46, P.headInk, { font: F.head, maxW: W - 360 * s });
      T(`${hhmm(now)}`, (W / s) - 120, 62, 44, P.headInk, { font: F.bold, align: 'right' });
      c.svg(clockSvg(now), W - 100 * s, 10 * s, 76 * s, 76 * s, { color: P.headInk });
      // ---- column titles
      const colY = headH + 30;
      const X = { kind: 32, dest: 150, time: (W / s) - 250, plat: (W / s) - 50 };
      T('Vlak', X.kind, colY, 22, P.dim); T('Cílová stanice / přes', X.dest, colY, 22, P.dim);
      T('Odjezd', X.time, colY, 22, P.dim, { align: 'right' }); T('Nást.', X.plat, colY, 22, P.dim, { align: 'right' });
      c.rect(24 * s, (colY + 10) * s, W - 48 * s, Math.max(1, 2 * s), P.rule);
      // ---- rows
      const deps = api.upcoming();
      const top = colY + 18, rowH = opts.rowH || 86, k = rowH / 86, foot = 34, per = Math.max(1, Math.floor((H / s - top - foot) / rowH));
      if (!deps.length) {
        T(state.lastOk ? 'Žádné odjezdy' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', W / 2 / s, top + 150, 60, P.ink, { font: F.bold, align: 'center' });
      }
      const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
      const pg = pageAt(t, 8000, pages);
      deps.slice(pg * per, pg * per + per).forEach((d, i) => {
        const y = top + i * rowH, rail = d.type === 'train' || d.type === 'rail';
        const cancelled = !!d.cancelled, delay = d.delayMinutes > 0, plat = api.platMark(d);
        const cat = rail ? String(d.category || (CAT.test(String(d.line)) ? d.line : '') || '').trim() : '';
        // kind (category for trains, the line for everything else)
        const kind = rail ? (cat || d.line || '') : String(d.line ?? '');
        T(kind, X.kind, y + 44 * k, (rail ? 40 : 38) * k, cancelled ? P.late : P.ink, { font: F.bold, maxW: 105 * s });
        // second line of the destination block: number · line · operator · via, or the notice (orange "šot")
        const n = api.depNotice(d);
        const op = d.operator || api.providerLabel(d);
        const info = [rail && d.trainNumber ? String(d.trainNumber) : '', rail && d.line && d.line !== cat ? d.line : '', rail ? op : '',
          d.via?.length ? 'přes ' + d.via.slice(0, 3).join(', ') : ''].filter(Boolean).join('  ·  ');
        const destMax = X.time - 210 - X.dest;
        T(String(d.destination || 'cíl neuveden').toUpperCase(), X.dest, y + 42 * k, 44 * k, cancelled ? P.late : P.ink, { font: F.bold, maxW: destMax * s });
        if (cancelled) T('ZRUŠEN', X.dest, y + 72 * k, 24 * k, P.late, { font: F.bold });
        else if (n) T(n.text, X.dest, y + 72 * k, 24 * k, P.time, { maxW: destMax * s });
        else if (info) T(info, X.dest, y + 72 * k, 24 * k, P.row2, { maxW: destMax * s });
        // departure: planned time, "očekávaný hh:mm" when late
        const when = hhmm(new Date(d.plannedTime || depTime(d)));
        const blink = minutesTo(d) <= 0 && !cancelled && Math.floor(Date.now() / 500) % 2;
        T(when, X.time, y + 44 * k, 46 * k, cancelled ? P.late : blink ? P.bg : P.time, { font: F.bold, align: 'right' });
        if (delay && !cancelled) T(`očekávaný ${hhmm(new Date(depTime(d)))}`, X.time, y + 72 * k, 22 * k, P.late, { align: 'right' });
        else if (d.delayMinutes === 0 && !cancelled) T('včas', X.time, y + 72 * k, 22 * k, P.ok, { align: 'right' });
        // platform
        if (plat) T(plat, X.plat, y + 44 * k, 44 * k, P.ink, { font: F.bold, align: 'right' });
        c.rect(24 * s, (y + rowH - 8) * s, W - 48 * s, Math.max(1, s), P.rule);
      });
      T(api.statusText() + (pages > 1 ? `   ${pg + 1}/${pages}` : ''), 32, H / s - 10, 18, P.dim, { maxW: W - 64 * s });
      if (opts.dots) return c.dotScreen(Math.max(2, Math.floor(W / opts.dots)), { bg: P.bg, off: P.off });
    },
  };
}

module.exports = { makeBoard, clockSvg };
