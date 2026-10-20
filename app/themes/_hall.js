// Big hall departure boards of Czech stations (Gema, Elen, Elektročas "Odjezd", Elekon …): a heading, printed column titles
// and rows that fill the whole screen, optionally in bands of 2-3 rows, optionally drawn as round LEDs (Canvas.dotScreen
// on the rows only, so the printed titles stay crisp). Each theme file only gives the look as a config. Imitates the look.
const { pageAt, pageCount } = require('./_util');
const { fields, emptyText } = require('./_station');

// cfg: id, name, bg, band, bandGap, group, title{text,size,color,font,spaced}, head(c,T,ctx) extra header, labels[{t,x,y,size,color,align}],
//      cols[{key,x,align,maxW,size,color(f,d)}], font, dots (LEDs per 1280 px of width, 0 = smooth), off (unlit LED colour),
//      top (first row y in 1280x720 units), bottom, tick(f) -> colour of the red tick, minRow, maxRow
function makeHall(cfg) {
  return {
    id: cfg.id,
    name: cfg.name,
    style: 'lcd',
    background: cfg.bg,
    unlit: cfg.bg,
    colors: { 1: cfg.ink, 2: cfg.dim, 3: [255, 90, 70], 5: cfg.ink, 10: cfg.ink },
    render(m, t, api) { require('./_simple').simpleLed(m, t, api, { title: cfg.simpleTitle || 'Odjezdy' }); },
    nativeFont: cfg.font,
    alertStyle: { bg: cfg.bg, ink: cfg.ink, accent: cfg.accent || [255, 76, 52], dim: cfg.dim, dots: cfg.dots ? Math.round(cfg.dots * 1.05) : 0, off: cfg.off },
    renderNative(c, t, api) {
      const { state } = api;
      const s = Math.min(c.w / 1280, c.h / 720), W = c.w, H = c.h, now = new Date();
      c.clear(cfg.bg);
      const T = (str, x, y, size, col, font, o = {}) => c.text(String(str ?? ''), x * s, y * s, { font, size: size * s, color: col, ...o });
      const ctx = { T, s, W, H, now, api };
      if (cfg.title) T(cfg.title.text, 640, cfg.title.y || 76, cfg.title.size || 58, cfg.title.color, cfg.title.font, { align: 'center' });
      if (cfg.head) cfg.head(c, ctx);
      for (const l of cfg.labels || []) T(l.t, l.x, l.y, l.size || 17, l.color || cfg.dim, l.font || cfg.labFont, { align: l.align || 'left' });
      const top = cfg.top, bottom = cfg.bottom ?? 14, group = cfg.group || 3, gap = cfg.bandGap ?? 20;
      const avail = H / s - top - bottom;
      const groups = Math.max(1, Math.floor((avail + gap) / (group * (cfg.minRow || 56) + gap)));
      const rowH = Math.min(cfg.maxRow || 92, (avail - (groups - 1) * gap) / (groups * group));
      const groupH = group * rowH + gap, per = groups * group;
      const deps = api.upcoming();
      if (!deps.length) T(emptyText(state), W / 2 / s, top + 120, 56, cfg.ink, cfg.font, { align: 'center' });
      const pages = pageCount(Math.max(1, Math.ceil(Math.min(deps.length, per * 4) / per))), pg = pageAt(t, 8000, pages);
      const rows = deps.slice(pg * per, pg * per + per);
      if (cfg.band) for (let g = 0; g * group < rows.length; g++) c.rect(30 * s, (top + g * groupH) * s, W - 60 * s, group * rowH * s, cfg.band);
      const size = Math.round(rowH * 0.68);
      rows.forEach((d, i) => {
        const f = fields(d, api), g = Math.floor(i / group), y = top + g * groupH + (i % group) * rowH + rowH * 0.72;
        const tick = cfg.tick && cfg.tick(f);
        if (tick) c.rect(36 * s, (y - rowH * 0.62) * s, 7 * s, rowH * 0.8 * s, tick);
        for (const col of cfg.cols) {
          let v = f[col.key];
          if (col.key === 'dir') v = f.cancelled ? 'ZRUŠEN' : f.notice || f.dir;
          if (col.key === 'dest') v = f.cancelled && !cfg.noCancelTag ? f.dest + ' – ZRUŠEN' : f.dest;
          if (col.key === 'plat' && !v && f.rail) v = '';
          if (col.key === 'track' && !v) v = '';
          if (col.key === 'delay' && !v) continue;
          if (col.key === 'destvia') { // "DESTINATION-via" on one line (destination in capitals, the way in lower case)
            const dn = String(f.dest).toUpperCase() + (f.cancelled || f.notice || f.dir ? '-' : '');
            T(dn, col.x, y, col.size || size, col.color ? col.color(f, d) : cfg.ink, col.font || cfg.font, { maxW: col.maxW * s });
            const via = f.cancelled ? 'ZRUŠEN' : f.notice || f.dir, dw = c.measure(dn, col.font || cfg.font, (col.size || size) * s) / s;
            if (via) T(via, col.x + dw, y, col.size || size, col.color ? col.color(f, d) : cfg.ink, col.font || cfg.font, { maxW: Math.max(40, col.maxW - dw) * s });
            continue;
          }
          if (col.upper !== false && col.key === 'dest') v = String(v).toUpperCase();
          T(v, col.x, y, col.size || size, col.color ? col.color(f, d) : cfg.ink, col.font || cfg.font, { align: col.align || 'left', maxW: col.maxW ? col.maxW * s : 0 });
        }
      });
      if (cfg.dots) c.dotScreen(Math.max(2, Math.round(W / cfg.dots)), { bg: cfg.bg, off: cfg.off || [14, 14, 14], region: { x: 24 * s, y: (top - 6) * s, w: W - 48 * s, h: H - (top - 6) * s - 6 * s } });
      if (pages > 1) T(`${pg + 1}/${pages}`, W / s - 40, H / s - 8, 15, cfg.dim, cfg.labFont, { align: 'right' });
    },
  };
}

module.exports = { makeHall };
