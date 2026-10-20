// PID stop "tablo" (the LCD stop board of Pražská integrovaná doprava, look of data.pid.cz/tabla): dark grey
// screen, white header strip with the logo, the stop name in capitals and the time with seconds, a grey column
// heading that alternates Czech / English, rows in alternating greys with a coloured box per line type
// (city bus blue, tram dark red, metro A/B/C, train dark blue …), arrow, destination with the "přes" stop
// underneath, platform, low-floor symbol and the departure (green = on time, orange = delayed, white + "?" =
// not tracked, red struck through = cancelled); orange notice bar with a "!" at the bottom.
// Imitates the look only, drawn here with free fonts (Fira Sans) and the MIT-licensed PID icons in app/assets/pid.
const fs = require('fs');
const path = require('path');
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const ICON = {};
for (const n of ['accessible', 'logo_pid']) {
  try { ICON[n] = fs.readFileSync(path.join(__dirname, '..', 'assets', 'pid', n + '.svg'), 'utf8'); } catch {}
}
const K = {
  bg: [25, 25, 25], alt: [50, 50, 50], rule: [150, 150, 150], head: [98, 98, 98], white: [255, 255, 255], black: [0, 0, 0],
  grey: [150, 150, 150], ok: [201, 208, 34], late: [255, 147, 30], red: [255, 56, 56], orange: [255, 170, 30], ink: [25, 35, 65],
};
const F = { bold: 'FiraSans-Bold', semi: 'FiraSans-SemiBold', reg: 'FiraSans-Regular' };

// colours of the line box per kind of vehicle (the official tablo palette)
function lineStyle(d) {
  const line = String(d.line ?? ''), n = parseInt(line, 10), t = d.type;
  if (t === 'metro' || t === 'subway') return { A: { bg: [0, 168, 98], fg: K.white }, B: { bg: [248, 179, 34], fg: K.black }, C: { bg: [207, 0, 61], fg: K.white } }[line.toUpperCase()] || { bg: K.white, fg: K.grey };
  if (t === 'train' || t === 'rail') return { bg: [30, 60, 120], fg: K.white };
  if (t === 'tram') return n >= 90 && n <= 99 ? { bg: [120, 2, 0], fg: K.white } : { bg: K.white, fg: [120, 2, 0] }; // 90-99 night trams
  if (t === 'trolleybus') return { bg: K.white, fg: [128, 22, 111] };
  if (t === 'ferry') return { bg: K.white, fg: [0, 164, 167] };
  if (t === 'cablecar' || t === 'funicular') return { bg: K.white, fg: [201, 208, 34] };
  if (/^X/i.test(line)) return { bg: K.white, fg: [244, 159, 25] }; // replacement transport
  if (d.provider === 'PID' || !d.provider) return n >= 900 ? { bg: [0, 120, 160], fg: K.white } : { bg: K.white, fg: [0, 120, 160] }; // city bus, 9xx night
  return n >= 900 ? { bg: [25, 25, 25], fg: K.white, edge: [113, 113, 113] } : { bg: K.white, fg: K.black }; // regional bus
}

module.exports = {
  id: 'pidtablo',
  name: 'PID tablo (LCD)',
  style: 'lcd',
  background: K.bg,
  unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: K.red, 5: K.white, 10: K.orange },
  render(m, t, api) { simpleLed(m, t, api, { title: 'PID' }); },
  nativeFont: F.bold,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, stopLabel } = api;
    const s = c.w / 1920, W = c.w, H = c.h, en = Math.floor(t / 5000) % 2 === 1; // headings alternate cs / en
    c.clear(K.bg);
    const T = (str, x, y, size, color, opt = {}) => c.text(String(str ?? ''), x, y, { font: F.reg, size: size * s, color, ...opt });
    const now = new Date();

    // ---- header strip
    const headerH = 118 * s;
    c.rect(0, 0, W, headerH, K.white);
    if (ICON.logo_pid) c.svg(ICON.logo_pid, 22 * s, 10 * s, 150 * s, headerH - 20 * s, { color: K.ink });
    const city = state.cfg.stop?.city || '';
    T(String(stopLabel(state.cfg.stop)).toUpperCase(), W / 2, city ? 70 * s : 82 * s, 67, K.black, { font: F.bold, align: 'center', maxW: W * 0.58 });
    if (city) T(city, W / 2, 104 * s, 34, [100, 100, 100], { align: 'center', maxW: W * 0.58 });
    const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0'), ss = String(now.getSeconds()).padStart(2, '0');
    T(ss, W - 18 * s, 56 * s, 34, K.black, { align: 'right' });
    const sw = c.measure(ss, F.reg, 34 * s);
    T(`${hh}:${mm}`, W - 18 * s - sw - 6 * s, 74 * s, 67, K.black, { font: F.bold, align: 'right' });
    const days = en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
    T(`${days[now.getDay()]} ${now.getDate()}. ${now.getMonth() + 1}.`, W - 18 * s, 106 * s, 34, [100, 100, 100], { align: 'right' });

    // ---- column heading (grey bar), Czech and English alternate
    const colY = headerH, colH = 50 * s;
    c.rect(0, colY, W, colH, K.head);
    const X = { line: 24 * s, lineW: 130 * s, arrow: 160 * s, dest: 232 * s };
    const depW = 330 * s, lfW = 60 * s, platW = 150 * s;
    const depR = W - 14 * s, lfX = depR - depW, platCx = lfX - lfW - platW / 2;
    const H1 = (cs, e, x, al = 'left') => T(en ? e : cs, x, colY + 34 * s, 29, K.white, { align: al });
    H1('Linka', 'Route', X.line + 12 * s); H1('Směr', 'Direction', X.dest); H1('Stanoviště', 'Platform', platCx, 'center');
    H1('Odjezd (+ zpoždění)', 'Departure (+ delay)', depR, 'right');

    // ---- rows
    const deps = api.upcoming();
    const infoH = 96 * s, top = colY + colH, rowH = 91 * s;
    const alerts = api.alertLines(), bar = alerts.length ? infoH : 0;
    const per = Math.max(1, Math.floor((H - top - bar) / rowH));
    if (!deps.length) {
      T(en ? 'No departures' : 'Žádné odjezdy', W / 2, top + 220 * s, 150, K.white, { font: F.bold, align: 'center' });
      T(en ? 'in next 5 hours.' : 'v následujících 5 hodinách.', W / 2, top + 330 * s, 80, en ? K.grey : K.white, { font: F.bold, align: 'center' });
      T(state.lastOk ? '' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', W / 2, top + 420 * s, 44, K.grey, { align: 'center' });
    }
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
    const pg = pageAt(t, 8000, pages);
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y0 = top + i * rowH, mid = y0 + rowH / 2;
      c.rect(0, y0, W, rowH, i % 2 === 0 ? K.bg : K.alt);
      c.rect(0, y0, W, Math.max(1, s), K.rule); // 1px rule above each row
      const st = lineStyle(d), label = String(d.line ?? '');
      // line box 95x65, radius 5, number bold 50px (shrunk for long labels)
      const bx = X.line + (X.lineW - 95 * s) / 2, by = mid - 32.5 * s;
      if (st.edge) c.roundRect(bx - s, by - s, 97 * s, 67 * s, 6 * s, st.edge);
      c.roundRect(bx, by, 95 * s, 65 * s, 5 * s, st.bg);
      const size = Math.min(50, 50 * (86 * s) / Math.max(86 * s, c.measure(label, F.bold, 50 * s)));
      T(label, bx + 47.5 * s, by + 49 * s, size, st.fg, { font: F.bold, align: 'center' });
      // arrow
      const ax = X.arrow;
      c.rect(ax, mid - 2 * s, 20 * s, 4 * s, K.grey);
      for (let k = 0; k < 10; k++) c.rect(ax + 12 * s + k * s, mid - (10 - k) * s * 0.9, 2.2 * s, (10 - k) * 1.8 * s, K.grey);
      // destination (+ "přes" stop in small print below)
      const cancelled = !!d.cancelled, dest = String(d.destination || 'cíl neuveden');
      const via = [api.trainTag(d), d.via?.length ? d.via.slice(0, 3).join(' – ') : ''].filter(Boolean).join(' · ');
      const dy = via ? mid + 6 * s : mid + 15 * s, dmax = platCx - platW / 2 - 30 * s - X.dest;
      T(dest, X.dest, dy, 43, cancelled ? K.red : K.white, { font: F.semi, maxW: dmax });
      if (cancelled) c.rect(X.dest, dy - 14 * s, Math.min(c.measure(dest, F.semi, 43 * s), dmax), 4 * s, K.red);
      if (via) T(via, X.dest, mid + 30 * s, 22, K.grey, { maxW: dmax });
      // platform (stand), low-floor symbol
      const plat = api.platMark(d);
      if (plat) T(plat, platCx, mid + 14 * s, 40, K.grey, { align: 'center' });
      if ((d.lowFloor ?? d.isWheelchairAccessible) === true && ICON.accessible) c.svg(ICON.accessible, lfX - lfW + 6 * s, mid - 17 * s, 34 * s, 34 * s, { color: K.grey });
      // departure: green on time, orange delayed (+n), white with "?" when not tracked, red when cancelled
      const mins = minutesTo(d), untracked = d.delayMinutes == null, late = d.delayMinutes > 0;
      const when = hhmm(new Date(d.plannedTime || depTime(d)));
      const col = cancelled ? K.red : late ? K.late : untracked ? K.white : K.ok;
      const flash = mins <= 0 && !cancelled && Math.floor(Date.now() / 500) % 2 ? [38, 38, 38] : col; // blinks when departing
      const extra = cancelled ? '' : late ? `+${d.delayMinutes}` : untracked ? '?' : '';
      const ew = extra ? c.measure(extra, F.reg, 34 * s) + 8 * s : 0;
      T(when, depR - ew, mid + 15 * s, 43, flash, { font: F.bold, align: 'right' });
      if (extra) T(extra, depR, mid + 14 * s, 34, late ? K.late : K.grey, { align: 'right' });
      if (cancelled) c.rect(depR - ew - c.measure(when, F.bold, 43 * s), mid - 2 * s, c.measure(when, F.bold, 43 * s), 4 * s, K.red);
    });

    // ---- notice bar (orange, bold black text with "!" at the left), scrolling
    if (alerts.length) {
      const by = H - infoH;
      c.rect(0, by, W, infoH, K.orange);
      const text = alerts.join('     ·     '), tx0 = 130 * s;
      // the text moves smoothly between theme frames (api.scroller), the "!" block is static
      api.scroller(c, { text, x: tx0, y: by, w: W - tx0, h: infoH, baseline: 66 * s, font: F.bold, size: 58 * s, color: K.black, bg: K.orange, speed: 130 * s, gap: 160 * s });
      T('!', 50 * s, by + 72 * s, 80, K.black, { font: F.bold, align: 'center' });
    }
    if (pages > 1) T(`${pg + 1} / ${pages}`, W / 2 - 40 * s, colY + 34 * s, 24, K.white, { align: 'center' }); // not in the original: only so paging is visible
  },
};
