// PID virtual departure board (Pražská integrovaná doprava, data.pid.cz/departures): black screen, header with
// the stop name and a thin white rule, rows on dark grey (#363635) separated by white lines, route number
// right-aligned, destination, white platform circle, departure on the right in a condensed face (minutes, or
// hh:mm after an hour); orange when delayed, light grey when only scheduled (no real-time), cancelled rows are
// struck through; footer with a light-grey strip for notices (hazard-stripe block, scrolling black text), the date
// and the time with a blinking colon. Imitates the look only; the PID typeface and logo are replaced by free
// stand-ins (Fira Sans, Barlow Condensed, a plain "PID" mark).
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const K = {
  bg: [0, 0, 0], rows: [54, 54, 53], white: [255, 255, 255], grey: [226, 226, 226], delay: [207, 102, 27],
  cancel: [255, 102, 51], dark: [34, 34, 34],
};
const F = { semi: 'FiraSans-SemiBold', reg: 'FiraSans-Regular', cond: 'BarlowCondensed-Medium', bold: 'FiraSans-Bold' };

module.exports = {
  id: 'pid',
  name: 'PID (virtuální tablo)',
  style: 'lcd',
  background: K.bg,
  unlit: K.bg,
  colors: { 1: K.white, 2: K.grey, 3: K.cancel, 5: K.white, 10: K.delay },
  render(m, t, api) { simpleLed(m, t, api, { title: 'PID' }); },
  nativeFont: F.semi,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, stopLabel } = api;
    // everything is laid out in the original's 1920x1080 pixels and scaled
    const s = Math.min(c.w / 1920, c.h / 1080), W = c.w, H = c.h, pad = 25 * s;
    c.clear(K.bg);
    const headerH = 240 * s, footerH = 120 * s, rowH = 120 * s, line = Math.max(1, 2.5 * s);
    const T = (str, x, y, size, color, opt = {}) => c.text(String(str ?? ''), x, y, { font: F.semi, size: size * s, color, ...opt });

    // ---- header: stop name (+ city), the PID mark, rule
    T(stopLabel(state.cfg.stop), pad, headerH * 0.58, 90, K.white, { maxW: W - 2 * pad - 260 * s });
    const city = state.cfg.stop?.city;
    if (city) T(city, pad, headerH * 0.58 + 52 * s, 36, K.white, { font: F.reg, maxW: W - 2 * pad - 260 * s });
    c.roundRect(W - pad - 165 * s, headerH * 0.5 - 62 * s, 165 * s, 124 * s, 14 * s, K.white);
    T('PID', W - pad - 82.5 * s, headerH * 0.5 + 24 * s, 76, K.bg, { font: F.bold, align: 'center' });
    c.rect(pad, headerH - line, W - 2 * pad, line, K.white);

    // ---- rows
    const deps = api.upcoming();
    const area = H - headerH - footerH, per = Math.max(1, Math.floor(area / rowH));
    c.rect(pad, headerH, W - 2 * pad, per * rowH, K.rows);
    if (!deps.length) {
      T(state.lastOk ? 'V nejbližší době nic neodjíždí' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…', pad + 40 * s, headerH + 80 * s, 65, K.white);
      T(api.statusText(), pad + 40 * s, headerH + 140 * s, 36, K.grey, { font: F.reg, maxW: W - 2 * pad - 80 * s });
    }
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per)));
    const pg = pageAt(t, 8000, pages);
    const timeMode = deps.slice(pg * per, pg * per + per).some((d) => minutesTo(d) >= 60);
    const depW = (timeMode ? 270 : 180) * s, platCx = W - pad - depW - 60 * s;
    const routeR = pad + 165 * s, headX = routeR + 20 * s, headR = platCx + 60 * s - 10 * s;
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y0 = headerH + i * rowH, base = y0 + rowH * 0.68;
      if (i < per - 1) c.rect(pad, y0 + rowH - line / 2, W - 2 * pad, line, K.white);
      const mins = minutesTo(d), late = d.delayMinutes > 0;
      const rt = d.delayMinutes == null; // no real-time data: scheduled time only
      const col = d.cancelled ? K.white : late ? K.delay : rt ? K.grey : K.white;
      T(String(d.line ?? ''), routeR, base, 65, K.white, { align: 'right', maxW: 160 * s });
      const dest = String(d.destination || 'cíl neuveden');
      const dw = Math.min(c.measure(dest, F.semi, 65 * s), headR - headX - (d.cancelled ? 190 * s : 0));
      T(dest, headX, base, 65, K.white, { maxW: headR - headX - (d.cancelled ? 190 * s : 0) });
      const when = mins <= 0 ? '<1 min' : mins < 60 ? `${mins} min` : hhmm(new Date(d.plannedTime || depTime(d)));
      const ww = c.measure(when, F.cond, 65 * s);
      T(when, W - pad, base, 65, col, { font: F.cond, align: 'right' });
      if (d.cancelled) {
        // struck through in orange-red, with the small message at the right end of the destination
        c.rect(headX, base - 24 * s, dw, 5 * s, K.cancel);
        c.rect(W - pad - ww, base - 24 * s, ww, 5 * s, K.cancel);
        T('ZRUŠENO', headR, base - 20 * s, 28, K.cancel, { font: F.reg, align: 'right' });
      }
      const plat = platformOf(d);
      if (plat) { // white circle with the platform / stop mark
        c.roundRect(platCx - 37.5 * s, y0 + rowH / 2 - 37.5 * s, 75 * s, 75 * s, 37.5 * s, K.white);
        T(plat, platCx, y0 + rowH / 2 + 16 * s, plat.length > 2 ? 30 : 45, K.bg, { align: 'center', maxW: 66 * s });
      }
    });

    // ---- footer: notices strip (scrolling), date, time with blinking colon
    const fy = H - footerH, now = new Date();
    c.rect(pad, fy, W - 2 * pad, line, K.white);
    const alerts = api.alertLines();
    if (alerts.length) {
      const bx = pad, bw = W - pad - 300 * s - bx, bh = 80 * s, by = fy + (footerH - bh) / 2, text = alerts.join('   /   ');
      c.rect(bx, by, bw, bh, K.grey);
      const tw = c.measure(text, F.reg, 48 * s) + 120 * s;
      const off = tw > bw - bh ? (t / 1000 * 70 * s) % tw : 0;
      c.text(text, bx + bh + 20 * s - off, by + bh * 0.72, { font: F.reg, size: 48 * s, color: K.bg });
      if (tw > bw - bh) c.text(text, bx + bh + 20 * s - off + tw, by + bh * 0.72, { font: F.reg, size: 48 * s, color: K.bg });
      // hazard-stripe block at the left end hides the text start; black rect hides the overflow at the right
      c.rect(bx, by, bh + 20 * s, bh, K.grey);
      for (let yy = 0; yy < bh; yy++) { // diagonal orange stripes
        for (let k = -2; k < 8; k++) {
          const x = bx + 20 * s + k * (bh / 3) - yy * 0.9;
          c.rect(Math.max(bx + 20 * s, x), by + yy, Math.max(1, bh / 6), 1, K.delay);
        }
      }
      c.rect(bx + 20 * s + bh, by, 4 * s, bh, K.grey);
      c.rect(bx + bw, by - 2, 320 * s, bh + 4, K.bg);
    } else {
      const wd = now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase();
      T(wd, pad, fy + footerH * 0.7, 65, K.white, { maxW: W - 2 * pad - 360 * s });
    }
    const timeX = W - pad;
    const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
    const blink = Math.floor(Date.now() / 500) % 2;
    T(mm, timeX, fy + footerH * 0.7, 65, K.white, { align: 'right' });
    const mw = c.measure(mm, F.semi, 65 * s), cw = c.measure(':', F.semi, 65 * s);
    T(':', timeX - mw, fy + footerH * 0.7, 65, blink ? K.dark : K.white, { align: 'right' });
    T(hh, timeX - mw - cw, fy + footerH * 0.7, 65, K.white, { align: 'right' });
    if (pages > 1) T(`${pg + 1} / ${pages}`, W - pad - 190 * s, headerH - 18 * s, 28, K.grey, { font: F.reg, align: 'right' });
  },
};
