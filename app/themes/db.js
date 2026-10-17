// Deutsche Bahn style: LCD screen, white on dark blue, white title bar.
// Two layouts like the real thing:
//   rail  (station):  like bahnhof.de "Abfahrt": train badge + time (+ new time in a white box) | Über/Ziel | Gleis
//   urban (city stop): Linie | Ziel | Abfahrt (in min, "sofort")
const { paginate, box, badge, emptyMessage, clockText, marquee, boardKind, isRail, countdown } = require('./_util');

const BLUE = [10, 32, 92];

module.exports = {
  id: 'db',
  name: 'Deutsche Bahn (LCD)',
  fonts: 'inter', // app/fonts/inter.json (OFL, tools/fontgen.js)
  style: 'lcd',
  background: BLUE,
  unlit: BLUE,
  colors: { 1: [255, 255, 255], 2: [150, 172, 214], 3: [255, 96, 96], 5: [255, 255, 255], 7: [255, 220, 0] },
  render(m, t, api) {
    const { C, state, fitText, stopLabel } = api;
    const W = m.cols, nor = api.FONTS.normal.rows;

    // title bar: white, text knocked out in the background blue (colour slot 0)
    const barH = nor + 4;
    box(m, 0, 0, W, barH, C.WHITE);
    m.text(fitText(stopLabel(state.cfg.stop), 'normal', W - 60), 3, 2, 'normal', 0);
    m.textRight(clockText(api), W - 3, 2, 'normal', 0);

    const deps = api.upcoming();
    const top = barH + 3;
    if (!deps.length) {
      const [a, b] = emptyMessage(api);
      m.text(a, 30, top + 16, 'normal', C.AMBER);
      if (b) m.text(fitText(b, 'small', W - 34), 30, top + 16 + nor + 4, 'small', C.DIM);
      return;
    }
    if (boardKind(deps) === 'rail') railBoard(m, t, api, deps, top);
    else cityBoard(m, t, api, deps, top);
  },
};

function railBoard(m, t, api, deps, hy) {
  const { C, textWidth, fitText, hhmm, platformOf, depNotice, depTime } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
  const leftW = textWidth('88:88', 'normal') + textWidth('88:88', 'small') + 10;
  const colMid = leftW + 8;
  const gleisW = textWidth('Gleis', 'small') + 4;
  const midEnd = W - gleisW - 10;
  m.textRight('Zug/Bus', leftW, hy, 'small', C.DIM);
  m.text('Über', colMid, hy, 'small', C.DIM);
  m.textRight('Gleis', W - 3, hy, 'small', C.DIM);
  const hy2 = hy + sm + 1;
  m.textRight('Zeit', leftW, hy2, 'small', C.DIM);
  m.text('Ziel', colMid, hy2, 'small', C.DIM);
  const lineY = hy2 + sm + 1;
  m.hline(2, leftW, lineY, C.AMBER); m.hline(colMid, midEnd, lineY, C.AMBER); m.hline(midEnd + 6, W - 3, lineY, C.AMBER);

  const top = lineY + 4;
  const rowH = sm + nor + 7;
  const per = Math.max(1, Math.floor((m.rows - top - 1) / rowH));
  const pg = paginate(deps.slice(0, per * 4), per, t, 8000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    const yTime = y + sm + 2;
    // train / line badge (S-Bahn green pill, everything else grey)
    const label = fitText(d.train || String(d.line), 'small', leftW - 4);
    const sbahn = /^S\s?\d/.test(String(d.line));
    const bw = textWidth(label, 'small') + 4;
    badge(m, api, label, leftW - bw + 1, y + 1, 'small', sbahn ? C.GREEN : C.GREY, sbahn ? C.WHITE : C.WHITE, 2);
    // planned time, and the expected one in a white box when late
    const planned = hhmm(new Date(d.plannedTime));
    if (d.delayMinutes > 0) {
      const exp = hhmm(new Date(depTime(d)));
      const ew = textWidth(exp, 'small') + 4;
      badge(m, api, exp, leftW - ew + 1, yTime + 2, 'small', C.WHITE, 0, 2);
      m.textRight(planned, leftW - ew - 3, yTime, 'normal', C.AMBER);
    } else {
      m.textRight(planned, leftW, yTime, 'normal', C.AMBER);
    }
    // small line above the destination: disruption first, otherwise operator / line
    const n = depNotice(d);
    const over = n ? n.text : d.via?.length ? d.via.slice(0, 4).join(' · ') : ''; // Über = via; no stops -> empty, not the operator
    if (over) marquee(m, api, over, colMid, midEnd, y + 1, 'small', n ? C.YELLOW : C.DIM, t);
    const dest = d.cancelled ? `${d.destination}  · fällt aus` : d.destination || '';
    m.text(fitText(dest, 'normal', midEnd - colMid), colMid, yTime, 'normal', d.cancelled ? C.RED : C.AMBER);
    const plat = platformOf(d);
    if (plat) m.textRight(fitText(plat, 'normal', gleisW + 6), W - 3, yTime, 'normal', C.AMBER);
    // underline per column, like the screenshot
    const uy = y + rowH - 2;
    m.hline(2, leftW, uy, C.DIM); m.hline(colMid, midEnd, uy, C.DIM); m.hline(midEnd + 6, W - 3, uy, C.DIM);
  });
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, midEnd, hy, 'small', C.DIM);
}

function cityBoard(m, t, api, deps, hy) {
  const { C, textWidth, fitText, depNotice } = api;
  const W = m.cols, nor = api.FONTS.normal.rows, sm = api.FONTS.small.rows;
  const lineW = textWidth('888', 'normal') + 6;
  const colDest = 3 + lineW + 8;
  const minW = textWidth('88 min', 'normal');
  m.text('Linie', 3, hy, 'small', C.DIM);
  m.text('Ziel', colDest, hy, 'small', C.DIM);
  m.textRight('Abfahrt', W - 3, hy, 'small', C.DIM);
  const top = hy + sm + 4;
  const rowH = nor + 5;
  const per = Math.max(1, Math.floor((m.rows - top - sm - 4) / rowH));
  const pg = paginate(deps.slice(0, per * 3), per, t, 7000);
  pg.items.forEach((d, k) => {
    const y = top + k * rowH;
    // line in a white box, like the line badges on BVG/DB city stop screens
    badge(m, api, fitText(String(d.line), 'normal', lineW - 4), 3, y + 1, 'normal', C.WHITE, 0, 2, lineW);
    const cd = countdown(api, d, 'sofort');
    const late = d.delayMinutes > 0;
    m.text(fitText(d.destination || '', 'normal', W - colDest - minW - 30), colDest, y + 1, 'normal', C.AMBER);
    if (late) m.textRight(`+${d.delayMinutes}`, W - 3 - minW - 6, y + 2, 'small', C.YELLOW);
    m.textRight(cd, W - 3, y + 1, 'normal', cd === 'sofort' ? C.YELLOW : C.AMBER);
  });
  // ticker: disruptions for this stop
  const n = deps.map(depNotice).find(Boolean);
  const info = [...api.state.alerts, n?.text].filter(Boolean).join('   ·   ');
  if (info) marquee(m, api, info, 3, W - 3, m.rows - sm - 2, 'small', C.YELLOW, t);
  else m.text(api.statusText(), 3, m.rows - sm - 2, 'small', C.DIM);
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 3 - textWidth('Abfahrt', 'small') - 10, hy, 'small', C.DIM);
}

function typeName(type) {
  return { tram: 'Tram', bus: 'Bus', trolleybus: 'O-Bus', metro: 'U-Bahn', subway: 'U-Bahn', train: 'Zug', rail: 'Zug', ferry: 'Fähre' }[type] || 'Linie';
}

// ---------------------------------------------------------------- native (vector) version, like bahnhof.de "Abfahrt"
const N = {
  bg: [24, 31, 104], bar: [46, 58, 150], white: [255, 255, 255], dim: [176, 186, 228], line: [120, 132, 200],
  sbahn: [64, 140, 58], grey: [98, 102, 116], red: [236, 0, 22], yellow: [255, 216, 0], ink: [20, 24, 70],
  bus: [196, 35, 120], tram: [204, 0, 0], metro: [0, 92, 170],
};
const F = { reg: 'FiraSans-Regular', semi: 'FiraSans-SemiBold', bold: 'FiraSans-Bold' };
const KINDS = [['Fern', /^(ICE|IC|EC|EN|NJ|RJ|rj|RJX|SC|Ex|LE|ES)\b/], ['Regio', /^(R|RE|RB|Os|Sp|IRE|U\d|L\d)/], ['S-Bahn', /^S\s?\d/]];

function pill(c, x, yTop, label, bg, fg, s, size = 17, radius = 999) {
  const w = c.measure(label, F.bold, size * s) + 16 * s, h = size * 1.45 * s;
  c.roundRect(x, yTop, w, h, Math.min(radius * s, h / 2), bg);
  c.text(label, x + w / 2, yTop + h * 0.74, { font: F.bold, size: size * s, color: fg, align: 'center' });
  return w;
}

function nativeRender(c, t, api) {
  const { state, hhmm, depTime, platformOf, depNotice, stopLabel } = api;
  const s = c.h / 720, W = c.w;
  const x0 = Math.max(40 * s, (W - 1400 * s) / 2), x1 = W - x0;
  c.clear(N.bg);

  // header: station, big "Abfahrt", clock
  c.text('‹ ' + stopLabel(state.cfg.stop), x0, 46 * s, { font: F.semi, size: 22 * s, color: N.white, maxW: x1 - x0 - 200 * s });
  c.text('Abfahrt', x0, 104 * s, { font: F.semi, size: 46 * s, color: N.white });
  const now = new Date();
  c.text(`${hhmm(now)}:${api.pad2(now.getSeconds())}`, x1, 104 * s, { font: F.semi, size: 40 * s, color: N.white, align: 'right' });

  // filter bar with the transport kinds present at this stop
  const deps = api.upcoming();
  c.rect(x0, 126 * s, x1 - x0, 46 * s, N.bar);
  let bx = x0 + 18 * s;
  bx += pill(c, bx, 135 * s, 'Alle', N.white, N.ink, s, 16, 6) + 16 * s;
  const kinds = new Set(deps.map((d) => kindOf(d)));
  for (const k of ['Fern', 'Regio', 'S-Bahn', 'U-Bahn', 'Tram', 'Bus', 'Fähre']) {
    if (!kinds.has(k)) continue;
    c.text(k, bx, 156 * s, { font: F.semi, size: 18 * s, color: N.white });
    bx += c.measure(k, F.semi, 18 * s) + 26 * s;
  }

  if (!deps.length) {
    c.text(state.lastOk ? 'Derzeit keine Abfahrten' : (state.error ? 'Keine Verbindung' : 'Lade Abfahrten…'), x0, 260 * s, { font: F.semi, size: 34 * s, color: N.white });
    c.text(api.statusText(), x0, 300 * s, { font: F.reg, size: 20 * s, color: N.dim, maxW: x1 - x0 });
    return;
  }
  const rail = deps.slice(0, 20).filter((d) => d.type === 'train' || d.type === 'rail').length >= Math.min(deps.length, 20) / 2;

  // column heads
  const colL = x0 + 210 * s, colM = colL + 30 * s, colG = x1, midEnd = x1 - 120 * s;
  const hy = 206 * s;
  c.text(rail ? 'Zug / Bus' : 'Linie', colL, hy, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  c.text(rail ? 'Zeit' : '', colL, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  c.text(rail ? 'Über' : 'Ziel', colM, hy, { font: F.semi, size: 15 * s, color: N.white });
  if (rail) c.text('Ziel', colM, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white });
  c.text(rail ? 'Gleis' : 'Abfahrt', colG, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  const lineY = hy + 30 * s;
  c.hline(x0, colL, lineY, N.white, Math.max(1, 2 * s)); c.hline(colM, midEnd, lineY, N.white, Math.max(1, 2 * s)); c.hline(midEnd + 14 * s, colG, lineY, N.white, Math.max(1, 2 * s));

  const top = lineY + 16 * s, rowH = (rail ? 96 : 70) * s;
  const per = Math.max(1, Math.floor((c.h - top - 30 * s) / rowH));
  const pages = Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per));
  const page = Math.floor(t / 8000) % pages;
  if (pages > 1) c.text(`${page + 1}/${pages}`, midEnd, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.dim, align: 'right' });

  deps.slice(page * per, page * per + per).forEach((d, i) => {
    const y = top + i * rowH;
    const n = depNotice(d);
    if (rail) {
      // badge above the time
      const label = d.train || String(d.line);
      const sb = /^S\s?\d/.test(String(d.line));
      const bw = c.measure(label, F.bold, 15 * s) + 14 * s;
      pill(c, colL - bw, y + 6 * s, label, sb ? N.sbahn : N.grey, N.white, s, 15, sb ? 999 : 3);
      const planned = hhmm(new Date(d.plannedTime));
      let tx = colL;
      if (d.delayMinutes > 0) {
        const exp = hhmm(new Date(depTime(d)));
        const ew = c.measure(exp, F.semi, 16 * s) + 10 * s;
        c.rect(colL - ew, y + 44 * s, ew, 24 * s, N.white);
        c.text(exp, colL - ew / 2, y + 62 * s, { font: F.semi, size: 16 * s, color: N.ink, align: 'center' });
        tx = colL - ew - 8 * s;
      }
      c.text(planned, tx, y + 66 * s, { font: F.semi, size: 30 * s, color: d.cancelled ? N.red : N.white, align: 'right' });
      // "über" line, destination, platform
      const over = n ? n.text : d.via?.length ? d.via.slice(0, 5).join(' – ') : ''; // Über = via; no stops -> empty, not the operator
      c.text(over, colM, y + 30 * s, { font: n ? F.semi : F.reg, size: 16 * s, color: n ? N.yellow : N.dim, maxW: midEnd - colM });
      c.text(d.cancelled ? `${d.destination} — Fahrt fällt aus` : d.destination, colM, y + 66 * s, { font: F.semi, size: 30 * s, color: d.cancelled ? N.red : N.white, maxW: midEnd - colM - 10 * s });
      const plat = platformOf(d);
      if (plat) c.text(plat, colG, y + 66 * s, { font: F.semi, size: 30 * s, color: N.white, align: 'right' });
      const uy = y + rowH - 12 * s;
      c.hline(x0, colL, uy, N.white); c.hline(colM, midEnd, uy, N.white); c.hline(midEnd + 14 * s, colG, uy, N.white);
    } else {
      // city stop: coloured line badge, destination, minutes
      const col = d.type === 'bus' || d.type === 'trolleybus' ? N.bus : d.type === 'tram' ? N.tram : d.type === 'metro' ? N.metro : N.grey;
      const label = String(d.line);
      const bw = Math.max(64 * s, c.measure(label, F.bold, 22 * s) + 20 * s);
      c.roundRect(colL - bw, y + 14 * s, bw, 36 * s, 6 * s, col);
      c.text(label, colL - bw / 2, y + 41 * s, { font: F.bold, size: 22 * s, color: N.white, align: 'center' });
      c.text(d.destination, colM, y + 42 * s, { font: F.semi, size: 30 * s, color: d.cancelled ? N.red : N.white, maxW: midEnd - colM - 10 * s });
      if (n) c.text(n.text, colM, y + 62 * s, { font: F.reg, size: 15 * s, color: N.yellow, maxW: midEnd - colM });
      const mins = api.minutesTo(d);
      const right = mins <= 0 ? 'sofort' : mins < 60 ? `${mins} min` : hhmm(new Date(depTime(d)));
      c.text(right, colG, y + 42 * s, { font: F.semi, size: 30 * s, color: mins <= 0 ? N.yellow : N.white, align: 'right' });
      if (d.delayMinutes > 0) c.text(`+${d.delayMinutes}`, colG - c.measure(right, F.semi, 30 * s) - 12 * s, y + 40 * s, { font: F.semi, size: 18 * s, color: N.yellow, align: 'right' });
      c.hline(colM, colG, y + rowH - 6 * s, N.line);
    }
  });
  // status / attribution
  c.text(api.statusText(), x0, c.h - 14 * s, { font: F.reg, size: 14 * s, color: N.dim, maxW: x1 - x0 });
}

function kindOf(d) {
  if (d.type === 'train' || d.type === 'rail') {
    const l = String(d.train || d.line);
    for (const [k, re] of KINDS) if (re.test(l)) return k;
    return 'Regio';
  }
  return { metro: 'U-Bahn', tram: 'Tram', bus: 'Bus', trolleybus: 'Bus', ferry: 'Fähre' }[d.type] || 'Bus';
}

module.exports.renderNative = nativeRender;
module.exports.nativeFont = F.bold;
