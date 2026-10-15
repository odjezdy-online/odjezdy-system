// Self-update of the board app from GitHub Releases.
//
// A release carries odjezdy-app.tar.gz (contents of app/, VERSION inside) and odjezdy-app.tar.gz.sha256.
// An accepted update is unpacked into UPDATE_DIR; board.js of the medium/package then hands over to the
// newer copy at start (pick()). The bundled app is never modified, so a broken update can fall back:
// the first start of a new version marks it ".trying"; if it does not survive ~20 s (confirm()),
// the next start moves it aside to "<dir>.bad" and runs the bundled version again.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = process.env.ODJEZDY_REPO || 'odjezdy-online/odjezdy-system';
const UPDATE_DIR = process.env.ODJEZDY_UPDATE_DIR || '/var/lib/odjezdy/app';
const ASSET = 'odjezdy-app.tar.gz';
const API = process.env.ODJEZDY_GITHUB_API || 'https://api.github.com';

function versionOf(dir) {
  try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch { return '0.0.0'; }
}
// 1.2.10 > 1.2.9; a leading "v" and pre-release suffixes ("-rc1") are ignored
function cmp(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// called at the very top of board.js: path of a newer installed update to run instead, or null
function pick(selfDir, log = () => {}) {
  if (path.resolve(selfDir) === path.resolve(UPDATE_DIR)) return null;
  if (!fs.existsSync(path.join(UPDATE_DIR, 'board.js'))) return null;
  if (cmp(versionOf(UPDATE_DIR), versionOf(selfDir)) <= 0) return null; // medium/package is as new or newer
  const trying = path.join(UPDATE_DIR, '.trying'), pending = path.join(UPDATE_DIR, '.pending');
  try {
    if (fs.existsSync(trying)) { // last start of this version never got confirmed -> roll back
      fs.rmSync(UPDATE_DIR + '.bad', { recursive: true, force: true });
      fs.renameSync(UPDATE_DIR, UPDATE_DIR + '.bad');
      log(`update ${versionOf(UPDATE_DIR + '.bad')} failed to start, rolled back to ${versionOf(selfDir)}`);
      return null;
    }
    if (fs.existsSync(pending)) fs.renameSync(pending, trying);
  } catch (e) { log('update pick: ' + e.message); return null; }
  return UPDATE_DIR;
}
// the running (updated) app is healthy
function confirm(selfDir) {
  try { fs.rmSync(path.join(selfDir, '.trying'), { force: true }); } catch {}
}

async function getJson(url, ua) {
  const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// newest release if it is newer than `current`: { version, notes, url, sumUrl, digest, size } or null
async function check(current, ua) {
  const rel = await getJson(`${API}/repos/${REPO}/releases/latest`, ua).catch((e) => { if (e.message === 'HTTP 404') return {}; throw e; }); // 404: no release yet
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!version || cmp(version, current) <= 0) return null;
  if (cmp(versionOf(UPDATE_DIR + '.bad'), version) === 0) return null; // this one already failed here
  const a = (rel.assets || []).find((x) => x.name === ASSET);
  if (!a) return null; // release without an app bundle (e.g. ISO only)
  const s = (rel.assets || []).find((x) => x.name === ASSET + '.sha256');
  return {
    version, notes: String(rel.body || '').replace(/\r/g, ''), url: a.browser_download_url, size: a.size,
    sumUrl: s?.browser_download_url || null, digest: /^sha256:/.test(a.digest || '') ? a.digest.slice(7) : null,
  };
}

async function download(url, ua) {
  const r = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// download, verify, unpack, swap in. progress(text) gets short Czech status lines for the screen.
async function install(info, ua, progress = () => {}) {
  progress('Stahuji ' + (info.size ? Math.round(info.size / 1e5) / 10 + ' MB' : 'balíček') + '…');
  const tgz = await download(info.url, ua);
  progress('Ověřuji kontrolní součet…');
  let want = info.digest;
  if (info.sumUrl) want = (await download(info.sumUrl, ua)).toString('utf8').trim().split(/\s+/)[0];
  if (!want) throw new Error('vydání nemá kontrolní součet');
  const got = crypto.createHash('sha256').update(tgz).digest('hex');
  if (got.toLowerCase() !== want.toLowerCase()) throw new Error('kontrolní součet nesedí');

  progress('Instaluji…');
  const parent = path.dirname(UPDATE_DIR), tmp = UPDATE_DIR + '.new', file = path.join(parent, ASSET);
  fs.mkdirSync(parent, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  fs.writeFileSync(file, tgz);
  try { execFileSync('tar', ['-xzf', file, '-C', tmp], { stdio: 'ignore' }); } finally { fs.rmSync(file, { force: true }); }
  if (!fs.existsSync(path.join(tmp, 'board.js'))) throw new Error('balíček neobsahuje board.js');
  if (cmp(versionOf(tmp), info.version) !== 0) throw new Error(`balíček má verzi ${versionOf(tmp)}, čekal jsem ${info.version}`);
  fs.writeFileSync(path.join(tmp, '.pending'), new Date().toISOString());
  fs.rmSync(UPDATE_DIR + '.old', { recursive: true, force: true });
  if (fs.existsSync(UPDATE_DIR)) fs.renameSync(UPDATE_DIR, UPDATE_DIR + '.old');
  fs.renameSync(tmp, UPDATE_DIR);
  // Alpine diskless: keep it across reboots when the boot medium is writable (no-op elsewhere)
  try { execFileSync('sh', ['-c', `command -v lbu >/dev/null && lbu include ${parent} && lbu commit`], { stdio: 'ignore', timeout: 60000 }); } catch {}
  return info.version;
}

module.exports = { REPO, UPDATE_DIR, versionOf, cmp, pick, confirm, check, install };
