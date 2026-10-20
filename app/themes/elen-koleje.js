// Elen platform boards, all at once (as in the VISL simulation of the Elen LED boards): one board per platform - the big white
// platform number on the left, a black LED panel with two rows (kind, number, destination, time / "Směr", via, delay "min.")
// - showing the next train of that platform. Without platform data the next departures are listed in order. Imitates the look.
const { fields, emptyText } = require('./_station');
const GREEN = [70, 226, 70], RED = [255, 66, 48], ORANGE = [255, 160, 24], WHITE = [240, 240, 240];
const kindCol = (f) => (/^(R|Sp|SC|Zr|Rx)$/.test(f.kind) ? RED : /^(Ex|EC|IC|EN|LE|rj|RJ|AEx|Nex|TLX)$/.test(f.kind) ? ORANGE : GREEN);
const F = { bold: 'FiraSans-Bold', led: 'BarlowCondensed-SemiBold', reg: 'FiraSans-Regular' };
module.exports = {
  id: 'elen-koleje', name: 'Elen (tabule kolejí, LED body)', style: 'lcd', background: [0, 0, 0], unlit: [0, 0, 0],
  colors: { 1: GREEN, 2: [150, 150, 150], 3: RED, 5: GREEN, 10: ORANGE },
  render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: 'Odjezdy' }); },
  nativeFont: F.led,
  renderNative(c, t, api) {
    const { state } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h;
    c.clear([0, 0, 0]);
    const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
    // the next train of each platform (platform number order), or the next departures when platforms are unknown
    const deps = api.upcoming().map((d) => ({ d, f: fields(d, api) }));
    const byPlat = new Map();
    for (const x of deps) if (x.f.plat && !byPlat.has(x.f.plat)) byPlat.set(x.f.plat, x);
    let items = [...byPlat.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'cs', { numeric: true })).map(([p, x]) => ({ ...x, label: p }));
    if (items.length < 2) items = deps.slice(0, 5).map((x) => ({ ...x, label: x.f.plat || (x.f.rail ? '' : '') }));
    const n = Math.max(1, Math.min(items.length, 6)), gap = 8, rowH = (H / s - 12 - (n - 1) * gap) / n;
    if (!items.length) T(emptyText(state), W / 2 / s, H / 2 / s, 56, GREEN, F.led, { align: 'center' });
    const pitch = Math.max(2, Math.round(W / 400));
    const px = 190, pw = W / s - px - 24, size = Math.min(46, rowH * 0.36);
    items.slice(0, n).forEach(({ f, label }, i) => {
      const y0 = 6 + i * (rowH + gap);
      T(label, 92, y0 + rowH * 0.74, Math.min(150, rowH * 0.8), WHITE, F.bold, { align: 'center', maxW: 140 * s });
      c.rect(px * s, y0 * s, pw * s, rowH * s, [18, 18, 20]);
      c.rect((px + 3) * s, (y0 + 3) * s, (pw - 6) * s, (rowH - 6) * s, [0, 0, 0]);
      const col = f.cancelled ? RED : kindCol(f), y1 = y0 + rowH * 0.42, y2 = y0 + rowH * 0.84;
      T(f.kind, px + 22, y1, size, col, F.led); T(f.num, px + 112, y1, size, col, F.led);
      T(f.dest.toUpperCase(), px + 240, y1, size, col, F.led, { maxW: (pw - 240 - 150) * s }); T(f.time, px + pw - 24, y1, size, col, F.led, { align: 'right' });
      T(f.cancelled ? 'ZRUŠEN' : f.notice || f.dir || f.via, px + 240, y2, size, f.notice ? ORANGE : col, F.led, { maxW: (pw - 240 - 200) * s });
      if (f.delay) { T(f.delay, px + pw - 90, y2, size, ORANGE, F.led, { align: 'right' }); T('min.', px + pw - 24, y2, size * 0.6, WHITE, F.reg, { align: 'right' }); }
    });
    c.dotScreen(pitch, { bg: [0, 0, 0], off: [12, 12, 12], region: { x: (px + 3) * s, y: 0, w: (pw - 6) * s, h: H } });
  },
};
