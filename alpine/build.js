#!/usr/bin/env node
// Builds odjezdy-os.iso: Alpine Linux (standard, all drivers) + overlay that boots straight
// into the LED departure board. Runs on Windows/macOS/Linux — needs Node 18+ and Python 3 with pycdlib.
//
//   node alpine/build.js [--stop "Florenc"]
//
// Steps: download Alpine ISO -> resolve nodejs (+deps) from APKINDEX -> download .apk files
//        -> write apkovl overlay (tar.gz) -> python remaster.py adds everything into the ISO.

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ALPINE = '3.24';
const ALPINE_REL = '3.24.2';
const ARCH = 'x86_64';
const MIRROR = 'https://dl-cdn.alpinelinux.org/alpine';
const WANT = ['nodejs', 'tzdata'];
// already part of every Alpine live system; reinstalling them mid-boot is pointless risk
const SKIP = new Set(['musl', 'busybox', 'busybox-binsh']);

const ROOT = __dirname;
const CACHE = path.join(ROOT, 'cache');
const OUT = path.join(ROOT, 'out');
const APP = path.join(ROOT, '..', 'app'); // shared board app (repo root /app)
const OVERLAY = path.join(ROOT, 'overlay');
const BASE_ISO = path.join(CACHE, `alpine-standard-${ALPINE_REL}-${ARCH}.iso`);

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STOP = opt('--stop', 'Florenc');

const log = (...a) => console.log('»', ...a);

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', buf);
  fs.renameSync(file + '.part', file);
  return file;
}

// ---------------------------------------------------------------- tar (ustar) reader/writer
function readTar(buf) {
  const files = {};
  let o = 0;
  while (o + 512 <= buf.length) {
    const name = buf.toString('utf8', o, o + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(buf.toString('utf8', o + 124, o + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    files[name] = buf.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function tarHeader(name, { size = 0, mode = 0o644, type = '0', link = '' }) {
  const h = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
  h.write(name, 0, 100);
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(link, 157, 100);
  h.write('ustar\0', 257); h.write('00', 263);
  h.write('root', 265); h.write('root', 297);
  h.write(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function writeTar(entries) {
  const parts = [];
  for (const e of entries) {
    if (e.type === 'dir') parts.push(tarHeader(e.path.replace(/\/?$/, '/'), { mode: e.mode ?? 0o755, type: '5' }));
    else if (e.type === 'link') parts.push(tarHeader(e.path, { mode: 0o777, type: '2', link: e.target }));
    else {
      const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
      parts.push(tarHeader(e.path, { size: data.length, mode: e.mode ?? 0o644 }));
      parts.push(data, Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- APKINDEX + dependency resolution
async function loadIndex(repo) {
  const file = await download(`${MIRROR}/v${ALPINE}/${repo}/${ARCH}/APKINDEX.tar.gz`, path.join(CACHE, `APKINDEX-${ALPINE}-${repo}.tar.gz`));
  const tar = readTar(zlib.gunzipSync(fs.readFileSync(file)));
  const text = tar.APKINDEX.toString('utf8');
  return text.split('\n\n').filter(Boolean).map((block) => {
    const p = { repo };
    for (const line of block.split('\n')) {
      const k = line[0], v = line.slice(2);
      if (k === 'P') p.name = v; else if (k === 'V') p.version = v; else if (k === 'S') p.size = +v;
      else if (k === 'D') p.deps = v.split(' ').filter(Boolean); else if (k === 'p') p.provides = v.split(' ').filter(Boolean);
      else if (k === 'C') p.checksum = v;
    }
    return p;
  }).filter((p) => p.name);
}

function resolve(pkgs, wanted) {
  const byName = new Map(), byProv = new Map();
  for (const p of pkgs) {
    byName.set(p.name, p);
    for (const pr of p.provides || []) { const n = pr.split('=')[0]; if (!byProv.has(n)) byProv.set(n, p); }
  }
  const out = new Map();
  const visit = (dep) => {
    if (dep.startsWith('!')) return;
    const n = dep.split(/[<>=~]/)[0];
    const p = byName.get(n) || byProv.get(n);
    if (!p) { console.warn('  ! unresolved dependency', dep); return; }
    if (out.has(p.name)) return;
    out.set(p.name, p);
    for (const d of p.deps || []) visit(d);
  };
  wanted.forEach(visit);
  return [...out.values()];
}

// ---------------------------------------------------------------- overlay
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ type: 'dir', rel: path.relative(base, full) }, ...walk(full, base));
    else out.push({ type: 'file', rel: path.relative(base, full), full });
  }
  return out;
}

function buildApkovl() {
  const entries = [];
  const dirs = new Set();
  const addDir = (p) => {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!dirs.has(d)) { dirs.add(d); entries.push({ type: 'dir', path: d }); }
    }
  };
  const addFile = (p, data, mode) => { addDir(path.posix.dirname(p)); entries.push({ path: p, data, mode }); };
  const addLink = (p, target) => { addDir(path.posix.dirname(p)); entries.push({ type: 'link', path: p, target }); };

  // static overlay files (etc/…)
  for (const f of walk(OVERLAY)) {
    const rel = f.rel.split(path.sep).join('/');
    if (f.type === 'dir') addDir(rel);
    else addFile(rel, fs.readFileSync(f.full), /\.(sh|start)$/.test(rel) || rel.includes('/init.d/') ? 0o755 : 0o644);
  }
  // the app
  for (const f of ['board.js', 'font.json', 'stops.json.gz', 'regions.json.gz']) addFile(`opt/odjezdy/${f}`, fs.readFileSync(path.join(APP, f)));
  for (const f of fs.readdirSync(path.join(APP, 'themes')).filter((n) => n.endsWith('.js'))) {
    addFile(`opt/odjezdy/themes/${f}`, fs.readFileSync(path.join(APP, 'themes', f)));
  }
  addFile('opt/odjezdy/start.sh', fs.readFileSync(path.join(ROOT, 'start.sh')), 0o755);
  addFile('opt/odjezdy/config.json', JSON.stringify({ stop: { name: STOP, ids: [] }, favorites: [] }, null, 2) + '\n');
  // services: Alpine's init adds the default sysinit/boot set when this marker exists
  addFile('etc/.default_boot_services', '');
  addLink('etc/runlevels/default/networking', '/etc/init.d/networking');
  addLink('etc/localtime', '/usr/share/zoneinfo/Europe/Prague');
  return zlib.gzipSync(writeTar(entries), { level: 9 });
}

// ---------------------------------------------------------------- main
(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  log(`Alpine ${ALPINE_REL} standard ISO`);
  if (!fs.existsSync(BASE_ISO)) {
    await download(`${MIRROR}/v${ALPINE}/releases/${ARCH}/alpine-standard-${ALPINE_REL}-${ARCH}.iso`, BASE_ISO);
    const want = (await (await fetch(`${MIRROR}/v${ALPINE}/releases/${ARCH}/alpine-standard-${ALPINE_REL}-${ARCH}.iso.sha256`)).text()).split(/\s+/)[0];
    const got = crypto.createHash('sha256').update(fs.readFileSync(BASE_ISO)).digest('hex');
    if (want !== got) throw new Error('ISO checksum mismatch');
  }

  log('resolving', WANT.join(', '));
  const pkgs = [...(await loadIndex('main')), ...(await loadIndex('community'))];
  // packages that the ISO already carries (/apks/x86_64) are taken from there at boot, in the exact
  // versions the live system was built with — shipping newer ones breaks pinned deps (openssl=libcrypto3=x.y.z)
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const onIso = new Set(execFileSync(py, ['-c', [
    'import pycdlib,sys', 'i=pycdlib.PyCdlib()', 'i.open(sys.argv[1])',
    'print("\\n".join(c.rock_ridge.name().decode() for c in i.list_children(rr_path="/apks/' + ARCH + '") if c.rock_ridge and c.is_file()))',
  ].join('\n'), BASE_ISO]).toString().split(/\r?\n/).filter((f) => f.endsWith('.apk')).map((f) => f.replace(/-\d[^-]*-r\d+\.apk$/, '')));
  const closure = resolve(pkgs, WANT).filter((p) => !SKIP.has(p.name) && !onIso.has(p.name));
  log(`${onIso.size} packages already on the ISO`);
  const pkgDir = path.join(OUT, 'pkgs');
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  let total = 0;
  for (const p of closure) {
    const fname = `${p.name}-${p.version}.apk`;
    const cached = await download(`${MIRROR}/v${ALPINE}/${p.repo}/${ARCH}/${fname}`, path.join(CACHE, 'apk', fname));
    fs.copyFileSync(cached, path.join(pkgDir, fname));
    total += fs.statSync(cached).size;
  }
  log(`${closure.length} packages, ${(total / 1048576).toFixed(1)} MB: ${closure.map((p) => p.name).join(' ')}`);

  log('building overlay (apkovl)');
  const ovl = buildApkovl();
  const ovlFile = path.join(OUT, 'odjezdy.apkovl.tar.gz');
  fs.writeFileSync(ovlFile, ovl);
  log(`overlay ${(ovl.length / 1024).toFixed(0)} KB, default stop: ${STOP}`);

  log('remastering ISO');
  const iso = path.join(OUT, 'odjezdy-os.iso');
  execFileSync(py, [path.join(ROOT, 'remaster.py'), BASE_ISO, iso, ovlFile, pkgDir], { stdio: 'inherit' });
  log(`done → ${iso} (${(fs.statSync(iso).size / 1048576).toFixed(0)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
