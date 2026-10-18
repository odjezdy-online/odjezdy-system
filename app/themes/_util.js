// Shared helpers for themes (files starting with "_" are not loaded as themes).

// Split items into pages of `per` and pick the one to show now (rotates every `ms`).
// Setting "Stránkování": paging === false shows only the first page and never rotates (board.js sets it).
let paging = true;
const setPaging = (on) => { paging = on !== false; };
const pageAt = (t, ms, pages) => (paging ? Math.floor(t / ms) % pages : 0);
const pageCount = (pages) => (paging ? pages : 1);
function paginate(items, per, t, ms = 8000) {
  per = Math.max(1, per);
  const pages = pageCount(Math.max(1, Math.ceil(items.length / per)));
  const page = pageAt(t, ms, pages);
  return { items: items.slice(page * per, page * per + per), page, pages };
}

// Filled rectangle in a colour slot (0 = background / "knock-out").
function box(m, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m.set(x, y, c);
}

// Text inside a filled box (inverted label, e.g. DB delay box or SBB line badge).
function badge(m, api, str, x, y, size, fill, ink, padX = 2, minW = 0) {
  const w = Math.max(minW, api.textWidth(str, size) + padX * 2);
  const h = api.FONTS[size].rows + 2;
  box(m, x, y - 1, w, h, fill);
  m.text(str, x + Math.floor((w - api.textWidth(str, size)) / 2), y, size, ink);
  return w;
}

// Message for an empty board (no stop / loading / network error / nothing departing).
function emptyMessage(api) {
  const { state } = api;
  if (!state.cfg.stop.ids?.length) return ['Zastávka nenalezena', 'Stiskni S a vyber zastávku'];
  if (state.error && !state.deps.length) return ['Nelze načíst odjezdy', api.statusText()];
  if (!state.lastOk) return ['Načítám odjezdy…', ''];
  return ['V nejbližší době nic neodjíždí', ''];
}

// Seconds-precise clock text.
const clockText = (api) => { const d = new Date(); return `${api.hhmm(d)}:${api.pad2(d.getSeconds())}`; };

// Scrolling text clipped to [x0, x1].
function marquee(m, api, text, x0, x1, y, size, c, t, speed = 40) {
  const w = api.textWidth(text, size);
  if (w <= x1 - x0) { m.text(text, x0, y, size, c); return; }
  // one dot per tick: with the time-based step (t / speed) and a fixed tick the step alternated between 1 and 2 dots
  const gap = 30, off = (api.tickCount ? api.tickCount() : Math.floor(t / speed)) % (w + gap);
  m.text(text, x0 - off, y, size, c, x0, x1);
  m.text(text, x0 - off + w + gap, y, size, c, x0, x1);
}

// What kind of board this is: 'rail' (station: train number, platform/track, clock times)
// or 'urban' (tram/bus/metro stop: line, destination, minutes). Real boards differ exactly like this,
// e.g. DB station "Zeit | Zug | Ziel | Gleis" vs. city stop "Linie | Ziel | Abfahrt".
const RAIL = new Set(['train', 'rail']);
// With hysteresis: a mixed station (Ústí hl.n.: trains + buses) used to flip between the two layouts
// whenever the next 20 departures tipped over 50 %. Now it switches only below 35 % / above 60 %.
let lastKind = null, lastKey = null;
function boardKind(deps) {
  if (!deps.length) return lastKind || 'urban';
  const key = deps[0].stopId || deps[0].provider || '';
  const ratio = deps.slice(0, 20).filter((d) => RAIL.has(d.type)).length / Math.min(deps.length, 20);
  if (key !== lastKey || !lastKind) { lastKey = key; lastKind = ratio >= 0.5 ? 'rail' : 'urban'; }
  else if (lastKind === 'rail' && ratio < 0.35) lastKind = 'urban';
  else if (lastKind === 'urban' && ratio > 0.6) lastKind = 'rail';
  return lastKind;
}
const isRail = (d) => RAIL.has(d.type);

// "sofort" / "3 min" style countdown text
function countdown(api, d, now = 'teď') {
  const m = api.minutesTo(d);
  if (m <= 0) return now;
  return m < 60 ? `${m} min` : api.hhmm(new Date(api.depTime(d)));
}

module.exports = { setPaging, pageAt, pageCount, paginate, box, badge, emptyMessage, clockText, marquee, boardKind, isRail, countdown };
