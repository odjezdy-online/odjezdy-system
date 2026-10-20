// BUSE (Czech) — the default look: real BUSE panel font, amber LED dots.
// A theme is { id, name, style: "led"|"lcd", background, unlit, colors, render(m, t, api) }.
// Colour slots (api.C): AMBER=main text, DIM=secondary, RED, GREEN, WHITE, BLUE, YELLOW, ORANGE, GREY, ACCENT.
module.exports = {
  id: 'buse',
  name: 'BUSE (Česko)',
  style: 'led',
  background: [0, 0, 0],
  unlit: [18, 10, 4],
  colors: {},
  render(m, t, api) {
    const { state, C, textWidth, fitText, stopLabel, hhmm, pad2, depTime, depNotice, hasDelay, delayLabel, delayColor, layout } = api;

    const now = new Date();
    const W = m.cols;
    const L = layout(m);
    // header: stop name + clock (big BUSE face)
    const clock = `${hhmm(now)}:${pad2(now.getSeconds())}`;
    const cw = textWidth(clock, 'big');
    m.text(fitText(stopLabel(state.cfg.stop), 'big', W - cw - 8), 1, 1, 'big', C.AMBER);
    m.textRight(clock, W - 2, 1, 'big', C.AMBER);
    m.hline(0, W - 1, L.headerLine, C.DIM);

    // columns
    // wide enough for the longest line label of the whole list (a foreign line such as "1398" or "FLX 13"), at most a quarter of the width
    const labelW = Math.max(0, ...state.deps.map((d) => textWidth(String(d.line || d.trainNumber || d.category || ''), 'normal')));
    const lineW = Math.min(Math.floor(W / 4), Math.max(textWidth('888', 'normal'), textWidth('Linka', 'small'), labelW));
    const colDest = 2 + lineW + 6, colIn = W - 2;
    m.textRight('Linka', 2 + lineW, L.colHead, 'small', C.DIM);
    m.text('Směr', colDest, L.colHead, 'small', C.DIM);
    m.textRight('Odjezd', colIn, L.colHead, 'small', C.DIM);

    const deps = state.deps.filter((d) => depTime(d) > Date.now() - 30000);
    const midY = L.top + Math.floor((m.rows - L.top - L.footerH) / 2) - L.nor;
    if (!state.cfg.stop.ids.length) {
      m.textCenter('Zastávka nenalezena', midY, 'normal', C.AMBER);
      m.textCenter('Stiskni S a vyber zastávku', midY + L.rowH + 2, 'small', C.DIM);
    } else if (!deps.length) {
      const msg = state.lastOk ? 'V nejbližší době nic neodjíždí' : (state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…');
      m.textCenter(msg, midY, 'normal', C.AMBER);
      if (state.error) m.textCenter(fitText(state.error, 'small', W - 4), midY + L.rowH + 2, 'small', C.RED);
    }
    const minW = textWidth('88 min', 'normal');
    const bottom = m.rows - L.footerH - 1;
    const avail = bottom - L.top + 3;
    const rowH2 = L.nor + 1 + L.sm + 2; // two-row departure: destination (face 3) + notice (face 1)

    // paginate: fill each page top-down; a notice row costs more height, but every page keeps at least
    // MIN_PER_PAGE departures (later ones then fall back to a single row with "+N").
    const MIN_PER_PAGE = 0, MAX_PAGES = 6, PAGE_MS = 8000;
    const pages = [];
    let page = [], used = 0;
    for (const d of state.deps.filter((x) => depTime(x) > Date.now() - 30000)) {
      if (pages.length >= MAX_PAGES) break;
      let notice = depNotice(d), tall = !!notice || hasDelay(d);
      const stillNeeded = Math.max(0, MIN_PER_PAGE - page.length - 1);
      const h = tall ? rowH2 : L.rowH;
      if (used + h > avail) {
        pages.push(page); page = []; used = 0;
        if (pages.length >= MAX_PAGES) break;
        notice = depNotice(d); tall = !!notice || hasDelay(d);
      }
      page.push({ d, notice, tall, h: tall ? rowH2 : L.rowH });
      used += tall ? rowH2 : L.rowH;
    }
    if (page.length && pages.length < MAX_PAGES) pages.push(page);
    // a page stays until its longest scrolling notice has run through once (8 s minimum, 45 s maximum)
    const SCROLL_MS = 45, GAP = 24, noticeW = colIn - minW - 4 - colDest;
    const pageMs = pages.map((p) => Math.min(45000, Math.max(PAGE_MS, ...p.map((r) => {
      const w = r.notice ? textWidth(r.notice.text, 'small') : 0;
      return w > noticeW ? (w + GAP) * SCROLL_MS + 1500 : 0;
    }))));
    const cycle = pageMs.reduce((a, x) => a + x, 0) || 1;
    let pi = 0, pageT = t % cycle;
    while (pi < pages.length - 1 && pageT >= pageMs[pi]) { pageT -= pageMs[pi]; pi++; }
    if (!api.paging()) { pages.length = Math.min(pages.length, 1); pi = 0; pageT = t % 60000; } // setting: one fixed page
    if (pages.length > 1) {
      const label = `${pi + 1}/${pages.length}`;
      m.textRight(label, colIn - textWidth('Odjezd', 'small') - 8, L.colHead, 'small', C.DIM);
    }

    let y = L.top;
    for (const { d, notice, tall, h } of pages[pi] || []) {
      const mins = Math.round((depTime(d) - Date.now()) / 60000);
      const line = String(d.line || d.trainNumber || d.category || '');
      const midRow = y;
      m.textRight(fitText(line, 'normal', lineW), 2 + lineW, midRow, 'normal', C.AMBER);

      let right;
      if (mins <= 0) right = (Math.floor(t / 600) % 2) ? '' : '**'; // like real BUSE panels: blinking stars
      else if (mins < 60) right = `${mins} min`;
      else right = hhmm(new Date(depTime(d)));
      const delay = d.delayMinutes;
      // delay goes under the departure time on two-row departures; single-row fallback keeps a small "+N" before it
      const delayStr = !tall && hasDelay(d) ? (delay > 0 ? `+${delay}` : `${delay}`) : '';
      const dw = delayStr ? textWidth(delayStr, 'small') + 4 : 0;
      const plat = api.platMark(d);
      const pw = plat ? textWidth(plat, 'small') + 5 : 0;
      const destMax = colIn - minW - dw - pw - colDest - 4;
      m.text(fitText(d.destination || '', 'normal', destMax), colDest, y, 'normal', C.AMBER);
      { const tg = api.trainTag(d), dx = colDest + textWidth(d.destination || '', 'normal') + 6; if (tg && dx + textWidth(tg, 'small') <= colDest + destMax) m.text(tg, dx, y + 1, 'small', C.DIM); }
      if (plat) m.text(plat, colIn - minW - dw - pw + 1, y, 'small', C.DIM);
      if (delayStr) m.text(delayStr, colIn - minW - dw + 1, y, 'small', delay >= 5 ? C.RED : C.DIM);
      m.textRight(right, colIn, midRow, 'normal', mins <= 0 ? C.WHITE : C.AMBER);
      if (tall && hasDelay(d)) m.textRight(delayLabel(d), colIn, y + L.nor + 1, 'small', delayColor(d));

      if (notice) {
        const ny = y + L.nor + 1, x0 = colDest, x1 = colIn - minW - 4;
        const w = textWidth(notice.text, 'small');
        if (w <= x1 - x0) m.text(notice.text, x0, ny, 'small', notice.color);
        else { // too long: scroll inside the notice row only, from the start of the page
          const off = (api.tickCount ? Math.max(0, api.tickCount() - 20) : Math.floor((pageT - 1000) / SCROLL_MS)) % (w + GAP); // one dot per tick
          m.text(notice.text, x0 - off, ny, 'small', notice.color, x0, x1);
          m.text(notice.text, x0 - off + w + GAP, ny, 'small', notice.color, x0, x1);
        }
      }
      y += h;
    }

    // footer marquee: alerts for this stop + status
    const fy = m.rows - L.footerH + 2;
    m.hline(0, W - 1, fy - 2, C.DIM);
    const parts = api.alertLines().map((a) => '! ' + a);
    // statusText carries the data source credit and the offline notice ("BEZ SPOJENÍ · poslední data …")
    parts.push(`Odjezdy OS · ${api.statusText()}${state.ip ? ' · IP ' + state.ip : ''} · S = změnit zastávku`);
    const text = parts.join('   ·   ');
    const tw = textWidth(text, 'normal') + 40;
    const x = W - ((api.tickCount ? api.tickCount() : Math.floor(t / 40)) % (tw + W)); // one dot per tick: even steps
    const offline = (state.error || state.fromCache) && state.lastOk;
    m.text(text, x, fy, 'normal', offline ? C.RED : state.alerts.length ? C.AMBER : C.DIM);
  },
};
