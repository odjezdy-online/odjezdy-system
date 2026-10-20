// Elen platform board: grey stop-name strip, black LED field in orange (kind, destination, regular departure, direction,
// delay) and a framed "Kolej" box with the platform number. One panel per departure (as many as fit the screen).
const { fields, emptyText } = require('./_station');
const K = { bg: [14, 16, 20], frame: [196, 198, 204], strip: [206, 208, 214], blue: [24, 70, 160], led: [255, 150, 10], dim: [180, 190, 205], white: [240, 240, 240], red: [255, 70, 40] };
const F = { bold: 'FiraSans-Bold', reg: 'FiraSans-Regular', led: 'BarlowCondensed-SemiBold' };
module.exports = {
  id: 'elen', name: 'Elen (nástupiště, oranžové LED)', style: 'lcd', background: K.bg, unlit: K.bg,
  colors: { 1: K.led, 2: K.dim, 3: K.red, 5: K.led, 10: K.led },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.led,
  renderNative(c, t, api) {
    const { state, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear(K.bg);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    const deps = api.upcoming();
    const panelH = 224, gap = 14, per = Math.max(1, Math.floor((H / s - 20 + gap) / (panelH + gap)));
    if (!deps.length) T(emptyText(state), W / 2 / s, H / 2 / s, 56, K.led, F.led, { align: 'center' });
    deps.slice(0, per).forEach((d, i) => {
      const f = fields(d, api), y0 = 10 + i * (panelH + gap), x0 = 24, x1 = W / s - 24, boxW = 250, inner = x1 - x0 - boxW - 14;
      c.rect(x0 * s, y0 * s, (x1 - x0) * s, panelH * s, K.frame);
      c.rect((x0 + 8) * s, (y0 + 8) * s, (x1 - x0 - 16) * s, (panelH - 16) * s, [4, 5, 8]);
      // light strip with the stop name
      c.rect((x0 + 14) * s, (y0 + 14) * s, inner * s, 44 * s, K.strip);
      T(String(stopLabel(state.cfg.stop)), x0 + 26, y0 + 49, 34, K.blue, F.bold, { maxW: (inner - 30) * s });
      // printed labels + LED rows
      T('Druh vlaku', x0 + 26, y0 + 78, 15, K.dim, F.reg); T('Cílová stanice', x0 + 120, y0 + 78, 17, K.dim, F.reg);
      T('Prav. odjezd', x0 + inner - 6, y0 + 78, 15, K.dim, F.reg, { align: 'right' });
      const col = f.cancelled ? K.red : K.led;
      T(f.kind, x0 + 30, y0 + 122, 52, col, F.led, { maxW: 90 * s });
      T(f.dest.toUpperCase(), x0 + 120, y0 + 122, 56, col, F.led, { maxW: (inner - 300) * s });
      T(f.time, x0 + inner - 6, y0 + 122, 58, col, F.led, { align: 'right' });
      T('Směr', x0 + 42, y0 + 186, 22, K.white, F.reg);
      T(f.cancelled ? 'ZRUŠEN' : f.notice || f.dir || f.via, x0 + 120, y0 + 186, 52, f.notice ? K.white : col, F.led, { maxW: (inner - 330) * s });
      if (f.delay) { T('Zpoždění', x0 + inner - 150, y0 + 148, 15, K.dim, F.reg); T(`${f.delay}`, x0 + inner - 150, y0 + 190, 52, col, F.led); T('min.', x0 + inner - 6, y0 + 190, 26, K.white, F.reg, { align: 'right' }); }
      // "Kolej" box
      const bx = x1 - boxW - 6;
      c.rect(bx * s, (y0 + 12) * s, boxW * s, (panelH - 24) * s, [226, 226, 230]);
      c.rect((bx + 4) * s, (y0 + 16) * s, (boxW - 8) * s, (panelH - 32) * s, [18, 20, 26]);
      T('Kolej', bx + boxW / 2, y0 + 58, 32, K.white, F.reg, { align: 'center' });
      T(f.plat || (f.rail ? '' : ''), bx + boxW / 2, y0 + 178, 120, K.white, F.bold, { align: 'center', maxW: (boxW - 30) * s });
    });
  },
};
