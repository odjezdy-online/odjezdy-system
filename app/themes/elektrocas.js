// Elektročas platform board (blue panels, as on the platforms of Praha hl.n.): per departure one blue panel with the
// kind-of-train tile (white, red edge), number and operator, the destination, "směr …", the time, and a framed
// platform box "NÁSTUPIŠTĚ · PLATFORM · BAHNSTEIG". Imitates the look only.
const { fields, emptyText } = require('./_station');
const K = { bg: [20, 22, 26], blue: [14, 52, 196], blue2: [10, 40, 160], white: [246, 246, 250], dim: [186, 198, 240], red: [210, 30, 40], ink: [14, 52, 196], frame: [60, 64, 72] };
const F = { bold: 'FiraSans-Bold', semi: 'FiraSans-SemiBold', reg: 'FiraSans-Regular', cond: 'BarlowCondensed-SemiBold' };
module.exports = {
  id: 'elektrocas', name: 'Elektročas (nástupiště, modrý)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.white, 2: K.dim, 3: [255, 110, 100], 5: K.white, 10: K.white },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.semi,
  renderNative(c, t, api) {
    const { state, stopLabel, hhmm } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    const now = new Date();
    // top strip: stop name (the direction arrow strip of the real boards) and the clock
    c.rect(20 * s, 12 * s, W - 40 * s, 62 * s, K.blue);
    T(String(stopLabel(state.cfg.stop)).toUpperCase(), 44, 56, 34, K.white, F.semi, { maxW: W - 260 * s });
    T(hhmm(now), W / s - 44, 56, 38, K.white, F.bold, { align: 'right' });
    const deps = api.upcoming(), top = 90, rowH = 150, gap = 12, per = Math.max(1, Math.floor((H / s - top - 10 + gap) / (rowH + gap)));
    if (!deps.length) T(emptyText(state), W / 2 / s, top + 150, 56, K.white, F.bold, { align: 'center' });
    deps.slice(0, per).forEach((d, i) => {
      const f = fields(d, api), y0 = top + i * (rowH + gap), x0 = 20, x1 = W / s - 20, boxW = 230;
      c.rect(x0 * s, y0 * s, (x1 - x0) * s, rowH * s, K.frame);
      c.rect((x0 + 6) * s, (y0 + 6) * s, (x1 - x0 - boxW - 22) * s, (rowH - 12) * s, K.blue);
      const ix = x0 + 6;
      // category tile: white, red edge on the left, bold letters in blue; number and operator below
      c.rect(ix * s, (y0 + 12) * s, 120 * s, 44 * s, K.white); c.rect(ix * s, (y0 + 12) * s, 10 * s, 44 * s, K.red);
      T(f.kind, ix + 68, y0 + 48, 36, K.ink, F.bold, { align: 'center', maxW: 96 * s });
      T(f.num, ix + 64, y0 + 88, 30, K.white, F.semi, { align: 'center' });
      T(f.op, ix + 64, y0 + 122, 20, K.dim, F.reg, { align: 'center', maxW: 118 * s });
      // destination, direction, notice
      const dx = ix + 150, dw = (x1 - x0 - boxW - 22) - 150 - 190;
      T(f.dest.toUpperCase(), dx, y0 + 62, 52, f.cancelled ? [255, 150, 140] : K.white, F.semi, { maxW: dw * s });
      if (f.cancelled) T('ZRUŠEN', dx, y0 + 106, 28, [255, 150, 140], F.bold);
      else if (f.notice) T(f.notice, dx, y0 + 106, 26, K.white, F.reg, { maxW: dw * s });
      else if (f.dir) { T('směr', dx, y0 + 106, 22, K.white, F.reg); T(f.dir, dx + 62, y0 + 106, 32, K.white, F.bold, { maxW: (dw - 62) * s }); }
      if (f.delay && !f.cancelled) T(`zpoždění ${f.delay} min`, dx, y0 + 134, 22, [255, 220, 120], F.reg, { maxW: dw * s });
      T(f.time, x1 - boxW - 40, y0 + 62, 56, f.cancelled ? [255, 150, 140] : K.white, F.semi, { align: 'right' });
      // platform box
      const bx = x1 - boxW - 8;
      c.rect(bx * s, (y0 + 6) * s, (boxW + 2) * s, (rowH - 12) * s, K.blue2); c.rect((bx + 3) * s, (y0 + 9) * s, (boxW - 4) * s, (rowH - 18) * s, K.blue);
      T(f.plat ? f.plat + '.' : f.rail ? '' : '', bx + boxW / 2, y0 + 96, 96, K.white, F.bold, { align: 'center', maxW: (boxW - 20) * s });
      T('NÁSTUPIŠTĚ', bx + boxW / 2, y0 + 122, 20, K.white, F.bold, { align: 'center' });
      T('PLATFORM · BAHNSTEIG', bx + boxW / 2, y0 + 140, 13, K.dim, F.reg, { align: 'center' });
    });
  },
};
