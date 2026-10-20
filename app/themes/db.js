// Deutsche Bahn style: LCD screen, white on dark blue, white title bar.
// Two layouts like the real thing:
//   rail  (station):  like bahnhof.de "Abfahrt": train badge + time (+ new time in a white box) | Über/Ziel | Gleis
//   urban (city stop): Linie | Ziel | Abfahrt (in min, "sofort")
const { paginate, box, badge, emptyMessage, clockText, marquee, boardKind, isRail, countdown, pageAt, pageCount } = require('./_util');

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
    const over = n ? n.text : d.via?.length ? d.via.slice(0, 4).join(' · ') : '';
    const opW = api.providerLabel(d) ? textWidth(api.providerLabel(d), 'small') + 4 : 0; // operator in its own cell, right of the Über line
    if (over) marquee(m, api, over, colMid, midEnd - opW - 3, y + 1, 'small', n ? C.YELLOW : C.DIM, t);
    if (opW) m.textRight(api.providerLabel(d), midEnd, y + 1, 'small', C.DIM);
    const dest = d.cancelled ? `${d.destination}  · fällt aus` : d.destination || '';
    m.text(fitText(dest, 'normal', midEnd - colMid), colMid, yTime, 'normal', d.cancelled ? C.RED : C.AMBER);
    const plat = api.platMark(d);
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
  const info = [...api.alertLines(), n?.text].filter(Boolean).join('   ·   ');
  if (info) marquee(m, api, info, 3, W - 3, m.rows - sm - 2, 'small', C.YELLOW, t);
  else m.text(api.statusText(), 3, m.rows - sm - 2, 'small', C.DIM);
  if (pg.pages > 1) m.textRight(`${pg.page + 1}/${pg.pages}`, W - 3 - textWidth('Abfahrt', 'small') - 10, hy, 'small', C.DIM);
}

function typeName(type) {
  return { tram: 'Tram', bus: 'Bus', trolleybus: 'O-Bus', metro: 'U-Bahn', subway: 'U-Bahn', train: 'Zug', rail: 'Zug', ferry: 'Fähre' }[type] || 'Linie';
}

// ---------------------------------------------------------------- native (vector) version, like bahnhof.de "Abfahrt"
const N = {
  bg: [25, 33, 118], bar: [40, 58, 151], chip: [19, 25, 91], white: [255, 255, 255], dim: [176, 186, 228], line: [120, 132, 200],
  sbahn: [64, 140, 58], grey: [98, 102, 116], red: [236, 0, 22], yellow: [255, 216, 0], ink: [20, 24, 70],
  bus: [196, 35, 120], tram: [204, 0, 0], metro: [0, 92, 170],
};
const F = { reg: 'FiraSans-Regular', semi: 'FiraSans-SemiBold', bold: 'FiraSans-Bold' };
const TRAIN = '\uE000';
const BERLIN = {
  S1: [222, 77, 164], S15: [222, 77, 164], S2: [0, 95, 39], S25: [0, 95, 39], S26: [0, 95, 39], S3: [10, 76, 153], S41: [162, 59, 30], S42: [199, 110, 0],
  S45: [195, 135, 55], S46: [195, 135, 55], S47: [195, 135, 55], S5: [255, 88, 0], S7: [111, 78, 156], S75: [111, 78, 156], S8: [85, 168, 34], S85: [85, 168, 34], S9: [138, 15, 48],
  U1: [125, 173, 76], U2: [218, 66, 30], U3: [22, 104, 61], U4: [240, 215, 34], U5: [126, 83, 48], U6: [140, 109, 171], U7: [0, 155, 213], U8: [34, 79, 134], U9: [243, 121, 31],
  RB10: [102, 170, 34], RE3: [235, 116, 5], RE8: [2, 132, 133],
};
// the badge above the time: a coloured pill for S/U/RB/RE lines (S and U fully round, regional a rounded box), grey box with the
// train name for long-distance trains ("ICE 905"), exactly as bahnhof.de draws them
function badgeStyle(d, N, berlin) {
  const line = String(d.line || '').replace(/\s+/g, '').toUpperCase();
  const known = berlin ? BERLIN[line] : null; // the colours are Berlin's; elsewhere the generic ones
  if (/^S\d+$/.test(line) || /^U\d+$/.test(line)) return { label: line, bg: known || (line[0] === 'S' ? N.sbahn : N.metro), fg: line === 'U4' ? N.ink : N.white, radius: 999 };
  if (/^(RB|RE|R)\d+$/.test(line)) return { label: line, bg: known || [2, 132, 133], fg: N.white, radius: 7 };
  if (/^M\d+$/.test(line)) return { label: line, bg: N.tram, fg: N.white, radius: 3 };
  return { label: d.train || String(d.line), bg: [68, 77, 96], fg: N.white, radius: 3.5 };
}
const KINDS = [['Fern', /^(ICE|IC|EC|EN|NJ|RJ|rj|RJX|SC|Ex|LE|ES)\b/], ['Regio', /^(R|RE|RB|Os|Sp|IRE|U\d|L\d)/], ['S-Bahn', /^S\s?\d/]];

function pill(c, x, yTop, label, bg, fg, s, size = 17, radius = 999) {
  const w = c.measure(label, F.bold, size * s) + 16 * s, h = size * 1.45 * s;
  c.roundRect(x, yTop, w, h, Math.min(radius * s, h / 2), bg);
  c.text(label, x + w / 2, yTop + h * 0.74, { font: F.bold, size: size * s, color: fg, align: 'center' });
  return w;
}

function nativeRender(c, t, api) {
  const { state, hhmm, depTime, platformOf, depNotice, stopLabel } = api;
  const s = Math.min(c.w / 1280, c.h / 720), W = c.w;
  const x0 = Math.max(24 * s, (W - 960 * s) / 2), x1 = W - x0;
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
    const ic = { Fern: [[255, 205, 0], N.ink, TRAIN], Regio: [[0, 128, 120], N.white, 'R'], 'S-Bahn': [[64, 140, 58], N.white, 'S'], Bus: [[196, 35, 120], N.white, 'BUS'], Fähre: [[40, 120, 220], N.white, 'E'], 'U-Bahn': [[20, 90, 200], N.white, 'U'], Tram: [[220, 20, 40], N.white, 'T'] }[k];
    if (ic) {
      const d0 = 22 * s;
      c.roundRect(bx, 138 * s, d0, d0, k === 'Fähre' || k === 'U-Bahn' || k === 'Tram' ? 3 * s : d0 / 2, ic[0]);
      c.text(ic[2], bx + d0 / 2, 138 * s + d0 * (ic[2] === 'BUS' ? 0.66 : 0.74), { font: F.bold, size: (ic[2] === 'BUS' ? 9 : 15) * s, color: ic[1], align: 'center' });
      bx += d0 + 8 * s;
    }
    c.text(k, bx, 156 * s, { font: F.semi, size: 17 * s, color: N.white });
    bx += c.measure(k, F.semi, 17 * s) + 28 * s;
  }

  if (!deps.length) {
    c.text(state.lastOk ? 'Derzeit keine Abfahrten' : (state.error ? 'Keine Verbindung' : 'Lade Abfahrten…'), x0, 260 * s, { font: F.semi, size: 34 * s, color: N.white });
    c.text(api.statusText(), x0, 300 * s, { font: F.reg, size: 20 * s, color: N.dim, maxW: x1 - x0 });
    return;
  }
  const rail = deps.slice(0, 20).filter((d) => d.type === 'train' || d.type === 'rail').length >= Math.min(deps.length, 20) / 2;

  // column heads
  const colL = x0 + 155 * s, colM = x0 + 190 * s, colG = x1, midEnd = x1 - 100 * s;
  const hy = 206 * s;
  c.text(rail ? 'Zug / Bus' : 'Linie', colL, hy, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  c.text(rail ? 'Zeit' : '', colL, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  c.text(rail ? 'Über' : 'Ziel', colM, hy, { font: F.semi, size: 15 * s, color: N.white });
  if (rail) c.text('Ziel', colM, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white });
  c.text(rail ? 'Gleis' : 'Abfahrt', colG, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.white, align: 'right' });
  const lineY = hy + 30 * s;
  c.hline(x0, colL, lineY, N.white, Math.max(1, 2 * s)); c.hline(colM, midEnd, lineY, N.white, Math.max(1, 2 * s)); c.hline(midEnd + 14 * s, colG, lineY, N.white, Math.max(1, 2 * s));

  const top = lineY + 16 * s, rowH = (rail ? 108 : 70) * s;
  const per = Math.max(1, Math.floor((c.h - top - 30 * s) / rowH));
  const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
  const page = pageAt(t, 8000, pages);
  if (pages > 1) c.text(`${page + 1}/${pages}`, midEnd, hy + 20 * s, { font: F.semi, size: 15 * s, color: N.dim, align: 'right' });

  deps.slice(page * per, page * per + per).forEach((d, i) => {
    const y = top + i * rowH;
    const n = depNotice(d);
    if (rail) {
      // badge above the time
      const bst = badgeStyle(d, N, /Berlin/i.test(`${stopLabel(state.cfg.stop)} ${state.cfg.stop?.city || ''}`)), label = bst.label;
      const bw = c.measure(label, F.bold, 15 * s) + 14 * s;
      pill(c, colL - bw, y + 14 * s, label, bst.bg, bst.fg, s, 15, bst.radius);
      const planned = hhmm(new Date(d.plannedTime));
      let tx = colL;
      if (d.delayMinutes > 0) {
        const exp = hhmm(new Date(depTime(d)));
        const ew = c.measure(exp, F.semi, 16 * s) + 10 * s;
        c.rect(colL - ew, y + 60 * s, ew, 24 * s, N.white);
        c.text(exp, colL - ew / 2, y + 78 * s, { font: F.semi, size: 16 * s, color: N.ink, align: 'center' });
        tx = colL - ew - 8 * s;
      }
      c.text(planned, tx, y + 82 * s, { font: F.semi, size: 28 * s, color: d.cancelled ? N.red : N.white, align: 'right' });
      // "über" line, destination, platform
      const over = n ? n.text : d.via?.length ? d.via.slice(0, 5).join(' – ') : '';
      // operator (ČD, DÚK, PID …) is its own cell at the right end of the Über line, not part of the stop list
      const opW = api.providerLabel(d) ? c.measure(api.providerLabel(d), F.semi, 14 * s) + 18 * s : 0;
      if (opW) {
        c.roundRect(midEnd - opW, y + 14 * s, opW, 22 * s, 4 * s, N.line);
        c.text(api.providerLabel(d), midEnd - opW / 2, y + 30 * s, { font: F.semi, size: 14 * s, color: N.white, align: 'center' });
      }
      // chips row: "i" when the train has information (notice / delay), as on the page
      if (n || d.delayMinutes > 0 || d.cancelled) { c.roundRect(colM, y + 8 * s, 20 * s, 20 * s, 2 * s, N.white); c.text('i', colM + 10 * s, y + 24 * s, { font: F.bold, size: 15 * s, color: N.ink, align: 'center' }); }
      const ov = c.fit(over, F.semi, 14 * s, midEnd - colM - opW - 36 * s), cut = ov !== over;
      let vx = colM;
      const mcity = !n && /^(Berlin|Hamburg|Wien|München|Köln|Praha) /.exec(ov);
      if (mcity) { c.text(mcity[1], vx, y + 50 * s, { font: F.reg, size: 12 * s, color: N.white }); vx += c.measure(mcity[1] + ' ', F.reg, 12 * s); }
      c.text(mcity ? ov.slice(mcity[0].length) : ov, vx, y + 50 * s, { font: F.semi, size: 14 * s, color: n ? N.yellow : N.white });
      if (cut) { const cx = vx + c.measure(mcity ? ov.slice(mcity[0].length) : ov, F.semi, 14 * s) + 6 * s; c.roundRect(cx, y + 36 * s, 26 * s, 18 * s, 3 * s, N.chip); c.text('…', cx + 13 * s, y + 47 * s, { font: F.bold, size: 14 * s, color: N.white, align: 'center' }); }
      c.text(d.cancelled ? `${d.destination} — Fahrt fällt aus` : d.destination, colM, y + 82 * s, { font: F.semi, size: 28 * s, color: d.cancelled ? N.red : N.white, maxW: midEnd - colM - 130 * s });
      const info = n || d.delayMinutes > 0 || d.cancelled ? 'Fahrtinformationen' : '';
      if (info) { const iw = c.measure(info, F.semi, 12 * s) + 14 * s; c.roundRect(midEnd - iw, y + 62 * s, iw, 22 * s, 3 * s, N.chip); c.text(info, midEnd - iw / 2, y + 77 * s, { font: F.semi, size: 12 * s, color: N.white, align: 'center' }); }
      const plat = api.platMark(d);
      if (plat) c.text(plat, colG, y + 82 * s, { font: F.semi, size: 28 * s, color: N.white, align: 'right' });
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
