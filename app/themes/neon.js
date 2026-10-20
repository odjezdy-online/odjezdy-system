// Neon (fictional): a night-city sign board. Dark violet background with a faint perspective grid, glowing
// cyan / magenta tube lettering (soft halo drawn as faded copies around the text), line numbers in neon frames.
const { simpleLed } = require('./_simple');
const { pageAt, pageCount } = require('./_util');

const N = { bg: [10, 6, 24], grid: [40, 16, 70], cyan: [80, 240, 255], pink: [255, 70, 200], white: [240, 236, 255], dim: [130, 110, 180], warn: [255, 220, 80] };
const F = { bold: 'BarlowCondensed-SemiBold', med: 'BarlowCondensed-Medium' };

function glow(c, str, x, y, o) {
  // halo: 8 faded copies around the glyphs, then the bright core in a lighter tint
  const r = Math.max(1.5, o.size * 0.06);
  for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, r], [-r, r], [r, -r]]) c.text(str, x + dx, y + dy, { ...o, alpha: 0.16 });
  const core = o.color.map((v) => Math.min(255, v + (255 - v) * 0.55));
  return c.text(str, x, y, { ...o, color: core });
}

module.exports = {
  id: 'neon',
  name: 'Neon (fiktivní)',
  style: 'lcd',
  background: N.bg,
  unlit: N.bg,
  colors: { 1: N.cyan, 2: N.dim, 3: N.pink, 5: N.white, 10: N.warn },
  render(m, t, api) { simpleLed(m, t, api); },
  nativeFont: F.bold,
  renderNative(c, t, api) {
    const { state, hhmm, depTime, minutesTo, platformOf, depNotice, stopLabel } = api;
    const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h, x0 = 40 * s, x1 = W - 40 * s;
    c.clear(N.bg);
    // perspective floor grid in the lower third
    const hz = H * 0.62;
    for (let i = 0; i < 9; i++) { const y = hz + (H - hz) * (i / 8) ** 1.8; c.hline(0, W, y, N.grid, 1); }
    for (let i = -10; i <= 10; i++) {
      const xb = W / 2 + i * W * 0.12, xt = W / 2 + i * W * 0.02;
      for (let k = 0; k < 40; k++) { const f = k / 40; c.rect(xt + (xb - xt) * f, hz + (H - hz) * f, 1, (H - hz) / 40, N.grid); }
    }
    // header: flicker the sign once in a while like an old tube
    const flick = Math.floor(t / 90) % 97 === 3 ? 0.35 : 1;
    glow(c, 'ODJEZDY', x0, 74 * s, { font: F.bold, size: 64 * s, color: flick === 1 ? N.pink : N.dim });
    c.text(stopLabel(state.cfg.stop), x0 + c.measure('ODJEZDY', F.bold, 64 * s) + 30 * s, 70 * s, { font: F.med, size: 30 * s, color: N.white, maxW: W * 0.5 });
    const now = new Date();
    glow(c, `${hhmm(now)}:${api.pad2(now.getSeconds())}`, x1, 72 * s, { font: F.bold, size: 50 * s, color: N.cyan, align: 'right' });
    c.hline(x0, x1, 100 * s, N.pink, Math.max(1, 2 * s));

    const deps = api.upcoming();
    if (!deps.length) {
      glow(c, state.lastOk ? 'Nic neodjíždí' : state.error ? 'Bez spojení' : 'Načítám…', x0, 220 * s, { font: F.bold, size: 44 * s, color: N.cyan });
      c.text(api.statusText(), x0, 262 * s, { font: F.med, size: 22 * s, color: N.dim, maxW: x1 - x0 });
      return;
    }
    const top = 124 * s, rowH = 84 * s, per = Math.max(1, Math.floor((H - top - 40 * s) / rowH));
    const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
    const boxW = 110 * s, colDest = x0 + boxW + 28 * s, timeW = 170 * s;
    deps.slice(pg * per, pg * per + per).forEach((d, i) => {
      const y = top + i * rowH;
      // neon frame around the line number
      c.roundRect(x0, y + 12 * s, boxW, 52 * s, 10 * s, N.cyan);
      c.roundRect(x0 + 3 * s, y + 15 * s, boxW - 6 * s, 46 * s, 8 * s, N.bg);
      const label = String(d.line ?? '');
      const fsz = Math.min(36 * s, (36 * s * (boxW - 20 * s)) / Math.max(1, c.measure(label, F.bold, 36 * s)));
      glow(c, label, x0 + boxW / 2, y + 38 * s + fsz * 0.36, { font: F.bold, size: fsz, color: N.cyan, align: 'center' });
      const mins = minutesTo(d);
      const when = mins <= 0 ? 'TEĎ' : mins < 60 ? `${mins} min` : hhmm(new Date(depTime(d)));
      const blink = mins <= 0 && Math.floor(t / 500) % 2;
      if (!blink) glow(c, when, x1, y + 52 * s, { font: F.bold, size: 40 * s, color: mins <= 0 ? N.warn : N.pink, align: 'right' });
      const destMax = x1 - timeW - colDest;
      c.text(d.cancelled ? `${d.destination} · odpadá` : d.destination || '', colDest, y + 48 * s, { font: F.bold, size: 38 * s, color: d.cancelled ? N.pink : N.white, maxW: destMax });
      const n = depNotice(d), plat = platformOf(d);
      const sub = n ? n.text : [api.trainTag(d), api.platLabel(d, 'nást. '), api.hasDelay(d) && api.delayLabel(d), d.via?.length && 'přes ' + d.via.slice(0, 3).join(', ')].filter(Boolean).join('  ·  ');
      c.text(sub, colDest, y + 74 * s, { font: F.med, size: 20 * s, color: n ? N.warn : N.dim, maxW: destMax });
    });
    if (pages > 1) c.text(`${pg + 1}/${pages}`, x1, H - 14 * s, { font: F.med, size: 18 * s, color: N.dim, align: 'right' });
    c.text(api.statusText(), x0, H - 14 * s, { font: F.med, size: 18 * s, color: N.dim, maxW: x1 - x0 - 80 * s });
  },
};
