// PID virtual departure board (Pražská integrovaná doprava, data.pid.cz/departures): black screen, header with
// the stop name and a thin white rule, rows on dark grey (#363635) separated by white lines, route number
// right-aligned, destination, white platform circle, departure on the right in a condensed face (minutes, or
// hh:mm after an hour); orange when delayed, light grey when only scheduled (no real-time), cancelled rows are
// struck through; footer with a light-grey strip for notices (hazard-stripe block, scrolling black text), the date
// and the time with a blinking colon. Imitates the look only; the PID typeface and logo are replaced by free
// stand-ins (Fira Sans, Barlow Condensed, a plain "PID" mark).
const { simpleLed } = require('./_simple');
const fs = require('fs');
const path = require('path');
const { pageAt, pageCount } = require('./_util');

// PID's own icons (MIT, see app/assets/pid)
const ICON = {};
for (const n of ['accessible', 'snowflake', 'logo_pid', 'metro-a', 'metro-b', 'metro-c']) {
  try { ICON[n] = fs.readFileSync(path.join(__dirname, '..', 'assets', 'pid', n + '.svg'), 'utf8'); } catch {}
}

const K = {
  bg: [0, 0, 0], rows: [54, 54, 53], white: [255, 255, 255], grey: [226, 226, 226], delay: [207, 102, 27],
  cancel: [255, 102, 51], dark: [34, 34, 34],
};
const FALLBACK = { semi: 'FiraSans-SemiBold', reg: 'FiraSans-Regular', cond: 'BarlowCondensed-Medium', bold: 'FiraSans-Bold' };
const PRAGUE = { semi: 'PragueCitizen-SemiBold', reg: 'PragueCitizen-Regular', cond: 'PragueCitizen-RegularCondensed', bold: 'PragueCitizen-SemiBold' };
let F = FALLBACK; // Prague Citizen when installed (see app/assets/pid/README.md)


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
    F = api.vector().findFont(PRAGUE.semi) && api.vector().findFont(PRAGUE.cond) ? PRAGUE : FALLBACK;
    // everything is laid out in the original's 1920x1080 pixels and scaled
    const s = Math.min(c.w / 1920, c.h / 1080), W = c.w, H = c.h, pad = 25 * s;
    c.clear(K.bg);
    const headerH = 240 * s, footerH = 120 * s, rowH = 120 * s, line = Math.max(1, 2.5 * s);
    const T = (str, x, y, size, color, opt = {}) => c.text(String(str ?? ''), x, y, { font: F.semi, size: size * s, color, ...opt });

    // ---- header: stop name (+ city), the PID mark, rule
    T(stopLabel(state.cfg.stop), pad, headerH * 0.58, 90, K.white, { maxW: W - 2 * pad - 260 * s });
    const city = state.cfg.stop?.city;
    if (city) T(city, pad, headerH * 0.58 + 52 * s, 36, K.white, { font: F.reg, maxW: W - 2 * pad - 260 * s });
    if (ICON.logo_pid) c.svg(ICON.logo_pid, W - pad - 172 * s, (headerH - 125 * s) / 2, 172 * s, 125 * s);
    else T('PID', W - pad, headerH * 0.5 + 24 * s, 76, K.white, { font: F.bold, align: 'right' });
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
    const pageRows = deps.slice(pg * per, pg * per + per);
    const lfOf = (d) => d.lowFloor ?? d.isWheelchairAccessible, acOf = (d) => d.airConditioned ?? d.isAirConditioned;
    const hasLF = pageRows.some((d) => lfOf(d) === true), hasAC = pageRows.some((d) => acOf(d) === true);
    const routeR = pad + 165 * s, lfW = (hasLF ? 90 : 20) * s, acW = (hasAC ? 70 : 0) * s;
    const headX = routeR + lfW + acW, headR = platCx + 60 * s - 10 * s;
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y0 = headerH + i * rowH, base = y0 + rowH * 0.68;
      if (i < per - 1) c.rect(pad, y0 + rowH - line / 2, W - 2 * pad, line, K.white);
      const mins = minutesTo(d), late = d.delayMinutes > 0;
      const rt = d.delayMinutes == null; // no real-time data: scheduled time only
      const col = d.cancelled ? K.white : late ? K.delay : rt ? K.grey : K.white;
      const metro = (d.type === 'metro' || d.type === 'subway') && ICON['metro-' + String(d.line).toLowerCase()];
      if (metro) c.svg(metro, routeR - 75 * s, y0 + rowH / 2 - 37.5 * s, 75 * s, 75 * s); // PID's A/B/C icons
      else T(String(d.line ?? ''), routeR, base, 65, K.white, { align: 'right', maxW: 160 * s });
      if (lfOf(d) === true && ICON.accessible) c.svg(ICON.accessible, routeR + 20 * s, y0 + rowH / 2 - 25 * s, 50 * s, 50 * s, { color: K.white });
      if (acOf(d) === true && ICON.snowflake) c.svg(ICON.snowflake, routeR + lfW + 10 * s, y0 + rowH / 2 - 25 * s, 50 * s, 50 * s, { color: K.white });
      const tag = api.trainTag(d);
      if (tag) T(tag, routeR, y0 + rowH - 12 * s, 24, K.grey, { font: F.reg, align: 'right', maxW: 160 * s });
      const dest = String(d.destination || 'cíl neuveden');
      const dw = Math.min(c.measure(dest, F.semi, 65 * s), headR - headX - (d.cancelled ? 190 * s : 0));
      T(dest, headX, base, 65, K.white, { maxW: headR - headX - (d.cancelled ? 190 * s : 0) });
      const when = mins <= 0 ? '<1 min' : mins < 60 ? `${mins} min` : hhmm(new Date(d.plannedTime || depTime(d)));
      const ww = c.measure(when, F.cond, 65 * s);
      const dl = late && mins >= 60 ? (d.delayMinutes > 99 ? '>99' : '+' + String(d.delayMinutes).padStart(2, '0')) : ''; // original: +05, >99
      T(when, W - pad - (dl ? 100 * s : 0), base, 65, mins >= 60 ? K.white : col, { font: F.cond, align: 'right' });
      if (dl) T(dl, W - pad, base, 65, K.delay, { font: F.cond, align: 'right' });
      if (d.cancelled) {
        // struck through in orange-red, with the small message at the right end of the destination
        c.rect(headX, base - 24 * s, dw, 5 * s, K.cancel);
        c.rect(W - pad - ww, base - 24 * s, ww, 5 * s, K.cancel);
        T('zrušeno', headR, base - 30 * s, 28, K.cancel, { font: F.reg, align: 'right' });
        T('canceled', headR, base + 2 * s, 28, K.cancel, { font: F.reg, align: 'right' });
      }
      const plat = api.platMark(d);
      if (plat) { // white circle with the platform / stop mark
        c.roundRect(platCx - 37.5 * s, y0 + rowH / 2 - 37.5 * s, 75 * s, 75 * s, 37.5 * s, K.white);
        const psz = Math.max(18, Math.min(plat.length > 2 ? 30 : 45, (45 * 62 * s) / Math.max(1, c.measure(plat, F.semi, 45 * s)) * (plat.length > 2 ? 0.8 : 1))); // long values ("3 / 5") shrink instead of being cut
        T(plat, platCx, y0 + rowH / 2 + 16 * s, psz, K.bg, { align: 'center' });
      }
    });

    // ---- footer: notices strip (scrolling), date, time with blinking colon
    const fy = H - footerH, now = new Date();
    c.rect(pad, fy, W - 2 * pad, line, K.white);
    const alerts = api.alertLines();
    if (alerts.length) {
      const bx = pad, bw = W - pad - 300 * s - bx, bh = 80 * s, by = fy + (footerH - bh) / 2, text = alerts.join('   /   ');
      c.rect(bx, by, bw, bh, K.grey);
      // hazard-stripe block at the left end; the text scrolls smoothly to its right (api.scroller)
      c.rect(bx, by, bh + 20 * s, bh, K.grey);
      for (let yy = 0; yy < bh; yy++) { // diagonal orange stripes
        for (let k = -2; k < 8; k++) {
          const x = bx + 20 * s + k * (bh / 3) - yy * 0.9;
          c.rect(Math.max(bx + 20 * s, x), by + yy, Math.max(1, bh / 6), 1, K.delay);
        }
      }
      c.rect(bx + 20 * s + bh, by, 4 * s, bh, K.grey);
      const wx = bx + bh + 24 * s;
      api.scroller(c, { text, x: wx, y: by, w: bx + bw - wx, h: bh, baseline: bh * 0.72, font: F.reg, size: 48 * s, color: K.bg, bg: K.grey, speed: 80 * s, gap: 120 * s });
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
