// Assigns every stop in app/stops.json.gz to a municipality (obec) -> district (okres) -> region (kraj)
// and writes app/regions.json.gz (the tree used by the "choose by region" picker).
//
//   node tools/build-regions.js [obce.csv]
//
// obce.csv: municipality list with codes and centroids (ČSÚ data, e.g. github.com/33bcdd/souradnice-mest
// "souradnice.csv": Obec,Kód obce,Okres,Kód okresu,Kraj,Kód kraje,PSČ,Latitude,Longitude). Downloaded if missing.
//
// Matching rules:
//  1. CIS-style names "Obec,Část,Zastávka" -> the first part is the municipality name; if several
//     municipalities share it, the nearest centroid wins.
//  2. Names without a comma are city-network stops (PID in Prague, IDSJMK in Brno, …) -> the nearest
//     big city within 15 km, otherwise the nearest municipality centroid.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP = path.join(__dirname, '..', 'app');
const CSV_URL = 'https://raw.githubusercontent.com/33bcdd/souradnice-mest/master/souradnice.csv';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const hav = (a, b, c, d) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// big cities whose own network names stops without the town prefix
const BIG = ['Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec', 'Olomouc', 'Ústí nad Labem', 'Hradec Králové', 'České Budějovice',
  'Pardubice', 'Zlín', 'Havířov', 'Kladno', 'Most', 'Opava', 'Jihlava', 'Karviná', 'Teplice', 'Děčín', 'Karlovy Vary',
  'Chomutov', 'Jablonec nad Nisou', 'Mladá Boleslav', 'Prostějov', 'Přerov', 'Třinec', 'Frýdek-Místek', 'Kolín', 'Tábor', 'Znojmo', 'Cheb', 'Trutnov'];

// the source writes some statutory cities in capitals ("ÚSTÍ NAD LABEM")
const SMALL = new Set(['nad', 'pod', 'u', 'v', 'na', 'a', 've', 'při']);
function fixCase(s) {
  // all-caps names, and words with stray capitals inside ("MíSTek"), get proper case
  const allCaps = s === s.toUpperCase() && s !== s.toLowerCase();
  return s.split(/(\s+|-)/).map((w, i) => {
    const lw = w.toLowerCase();
    if (!allCaps && w.slice(1) === lw.slice(1)) return w;
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join('');
}

(async () => {
  let csvPath = process.argv[2];
  if (!csvPath) {
    csvPath = path.join(__dirname, '..', 'alpine', 'cache', 'obce.csv');
    if (!fs.existsSync(csvPath)) {
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.writeFileSync(csvPath, Buffer.from(await (await fetch(CSV_URL)).arrayBuffer()));
    }
  }
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
  const obce = lines.map((l) => {
    const [name, code, okres, okresCode, kraj, krajCode, , lat, lng] = l.split(',');
    const fixed = fixCase(name);
    return { name: fixed, code, okres: fixCase(okres), okresCode, kraj, krajCode, lat: +lat, lng: +lng, n: norm(fixed) };
  }).filter((o) => Number.isFinite(o.lat));
  const byName = new Map();
  for (const o of obce) { if (!byName.has(o.n)) byName.set(o.n, []); byName.get(o.n).push(o); }
  const big = BIG.map((n) => (byName.get(norm(n)) || [])[0]).filter(Boolean);
  const nearest = (list, lat, lng) => list.reduce((best, o) => {
    const d = hav(lat, lng, o.lat, o.lng);
    return !best || d < best.d ? { o, d } : best;
  }, null);

  const stopsFile = path.join(APP, 'stops.json.gz');
  const stops = JSON.parse(zlib.gunzipSync(fs.readFileSync(stopsFile)));
  let byPrefix = 0, byCity = 0, byNearest = 0;
  for (const s of stops) {
    let o = null;
    if (s.name.includes(',')) {
      const cands = byName.get(norm(s.name.split(',')[0]));
      if (cands) { o = cands.length === 1 ? cands[0] : nearest(cands, s.lat, s.lng).o; byPrefix++; }
    }
    if (!o) {
      const b = nearest(big, s.lat, s.lng);
      if (b && b.d < 15000 && !s.name.includes(',')) { o = b.o; byCity++; }
    }
    if (!o) { o = nearest(obce, s.lat, s.lng).o; byNearest++; }
    s.o = o.code;
  }

  // tree: kraj -> okres -> obec (only places that have stops), with stop counts
  const used = new Map(obce.map((o) => [o.code, o]));
  const tree = new Map();
  for (const s of stops) {
    const o = used.get(s.o);
    if (!tree.has(o.krajCode)) tree.set(o.krajCode, { code: o.krajCode, name: o.kraj, okresy: new Map() });
    const k = tree.get(o.krajCode);
    if (!k.okresy.has(o.okresCode)) k.okresy.set(o.okresCode, { code: o.okresCode, name: o.okres, obce: new Map() });
    const ok = k.okresy.get(o.okresCode);
    if (!ok.obce.has(o.code)) ok.obce.set(o.code, { code: o.code, name: o.name, stops: 0 });
    ok.obce.get(o.code).stops++;
  }
  const cs = (a, b) => a.name.localeCompare(b.name, 'cs');
  const regions = [...tree.values()].sort(cs).map((k) => ({
    code: k.code, name: k.name,
    okresy: [...k.okresy.values()].sort(cs).map((ok) => ({ code: ok.code, name: ok.name, obce: [...ok.obce.values()].sort(cs) })),
  }));

  fs.writeFileSync(stopsFile, zlib.gzipSync(JSON.stringify(stops), { level: 9 }));
  fs.writeFileSync(path.join(APP, 'regions.json.gz'), zlib.gzipSync(JSON.stringify(regions), { level: 9 }));
  console.log(`stops: ${stops.length} (prefix ${byPrefix}, city ${byCity}, nearest ${byNearest})`);
  console.log(`regions: ${regions.length} kraje, ${regions.reduce((n, k) => n + k.okresy.length, 0)} okresy, ` +
    `${regions.reduce((n, k) => n + k.okresy.reduce((m, o) => m + o.obce.length, 0), 0)} obcí se zastávkami`);
})();
