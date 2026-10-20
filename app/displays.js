// Multiple monitors. One board process per display: the primary one (keyboard, mouse, menus, updates) runs
// display 0 and starts a child board for every other display, each with its own config file
// (/etc/odjezdy/display-N.json: stop, theme, …).
//
// How the pixels get out:
//  - 'fb'  : every display has its own framebuffer (/dev/fb0, /dev/fb1 …: several GPUs, some VMs)
//  - 'kms' : one GPU with several connected outputs. The kernel's fbdev emulation only shows one of them,
//            so native/odjezdy-kms (DRM/KMS helper) drives all outputs and boards stream frames to it over
//            a unix socket ("OUT n" -> "OK w h stride", then raw XRGB8888 frames).
//  - 'single': the usual /dev/fb0.
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const SOCK = process.env.ODJEZDY_KMS_SOCK || '/run/odjezdy-kms.sock';
// Wayland: native/odjezdy-wl (started by odjezdy-board-wl under cage / in a desktop session) speaks the same protocol as odjezdy-kms
const WL_SOCK = process.env.ODJEZDY_WL_SOCK || path.join(process.env.XDG_RUNTIME_DIR || '/run/user/0', 'odjezdy-wl.sock');
const KMS_BIN = () => [process.env.ODJEZDY_KMS, '/usr/lib/odjezdy/odjezdy-kms', path.join(__dirname, 'native', 'odjezdy-kms')]
  .find((p) => { try { return p && (fs.accessSync(p, fs.constants.X_OK), true); } catch { return false; } }) || null;
const displayConfig = (n) => path.join(path.dirname(process.env.ODJEZDY_CONFIG || '/etc/odjezdy/config.json'), `display-${n}.json`);

function connectedConnectors() {
  try {
    return fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+-/.test(d))
      .filter((d) => { try { return fs.readFileSync(`/sys/class/drm/${d}/status`, 'utf8').trim() === 'connected'; } catch { return false; } })
      .map((d) => d.replace(/^card\d+-/, ''));
  } catch { return []; }
}
function framebuffers() {
  try { return fs.readdirSync('/dev').filter((d) => /^fb\d+$/.test(d)).sort((a, b) => a.slice(2) - b.slice(2)); } catch { return []; }
}

// preferred mode ("1920x1080") of the first connected connector: what the monitor / the VM host asks for. In a VM the host
// changes it when the window is resized.
function preferredMode() {
  try {
    for (const d of fs.readdirSync('/sys/class/drm').filter((x) => /^card\d+-/.test(x)).sort()) {
      if (fs.readFileSync(`/sys/class/drm/${d}/status`, 'utf8').trim() !== 'connected') continue;
      const m = fs.readFileSync(`/sys/class/drm/${d}/modes`, 'utf8').split('\n')[0].trim();
      if (/^\d+x\d+/.test(m)) return m;
    }
  } catch {}
  return null;
}
// size of the framebuffer the kernel gave us ("1280x720")
function fbSize(dev = 'fb0') {
  try { // the visible mode ("U:1280x720p-0"); virtual_size may be taller (virtual screens)
    const m = /(\d+)x(\d+)/.exec(fs.readFileSync(`/sys/class/graphics/${dev}/modes`, 'utf8'));
    if (m) return `${m[1]}x${m[2]}`;
  } catch {}
  try { return fs.readFileSync(`/sys/class/graphics/${dev}/virtual_size`, 'utf8').trim().replace(',', 'x'); } catch { return null; }
}

// what this machine has; ODJEZDY_DISPLAYS=off forces a single display
function detect() {
  if (process.env.ODJEZDY_DISPLAYS === 'off') return { mode: 'single' };
  if (process.env.ODJEZDY_DISPLAYS === 'kms' && KMS_BIN()) return { mode: 'kms', connectors: connectedConnectors() }; // force (testing)
  if (process.env.ODJEZDY_WL_SOCK || fs.existsSync(WL_SOCK)) return { mode: 'wl' };
  const conns = connectedConnectors(), fbs = framebuffers();
  if (fbs.length > 1) return { mode: 'fb', outputs: fbs.map((f) => ({ type: 'fb', dev: f, name: f })) };
  if (conns.length > 1 && KMS_BIN()) return { mode: 'kms', connectors: conns };
  // one output whose preferred mode is not what the framebuffer has (VM window resized, monitor with a native size the console
  // did not pick): the kernel's fbdev cannot change size, the KMS helper sets the preferred mode itself
  const pm = preferredMode(), fz = fbSize();
  if (conns.length === 1 && KMS_BIN() && pm && fz && pm !== fz && process.env.ODJEZDY_NO_MODESET !== '1') return { mode: 'kms', connectors: conns, resize: `${fz} -> ${pm}` };
  return { mode: 'single', connectors: conns };
}

// start the helper, resolve with its output list [{ n, w, h, stride, name }]
function startKms() {
  return new Promise((resolve, reject) => {
    const p = spawn(KMS_BIN(), [SOCK, process.env.ODJEZDY_VT || 'tty1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('odjezdy-kms did not start')), 8000);
    p.on('exit', (c) => reject(new Error('odjezdy-kms exited ' + c)));
    p.stdout.on('data', (d) => {
      out += d;
      if (!/READY \d+/.test(out)) return;
      clearTimeout(timer);
      kmsList().then((list) => resolve({ proc: p, outputs: list })).catch(reject);
    });
  });
}
function kmsList(sock = SOCK, type = 'kms') {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sock, () => s.write('LIST\n'));
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      if (!/END\n/.test(buf)) return;
      s.end();
      resolve(buf.split('\n').filter((l) => l.startsWith('OUT ')).map((l) => {
        const [, n, w, h, stride, name] = l.split(' ');
        return { type, n: +n, w: +w, h: +h, stride: +stride, name };
      }));
    });
    s.on('error', reject);
  });
}
// connect a board to output n: { type:'kms', n, w, h, stride, sock }
function kmsConnect(n, sock = SOCK, type = 'kms') {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sock, () => s.write(`OUT ${n}\n`));
    let buf = '';
    const onData = (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      s.off('data', onData);
      const [ok, w, h, stride] = buf.slice(0, i).split(' ');
      if (ok !== 'OK') return reject(new Error(buf.slice(0, i)));
      resolve({ type, n, w: +w, h: +h, stride: +stride, sock: s });
    };
    s.on('data', onData);
    s.on('error', reject);
  });
}

// Wayland helper: the socket may appear a moment after the board starts (cage launches both); retry for ~12 s
async function wlList() {
  let err;
  for (let i = 0; i < 24; i++) {
    try { return await kmsList(WL_SOCK, 'wl'); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 500)); }
  }
  throw err;
}
const wlConnect = (n) => kmsConnect(n, WL_SOCK, 'wl');

// primary: keep one child board per extra display running
const children = new Map(); // n -> ChildProcess
function startChildren(outputs, boardJs, log) {
  for (const o of outputs) {
    if (o.index === 0) continue;
    const run = () => {
      const args = [boardJs, '--display', String(o.index), '--output', o.type === 'kms' ? `kms:${o.n}` : o.type === 'wl' ? `wl:${o.n}` : o.dev];
      const env = { ...process.env, ODJEZDY_CONFIG: displayConfig(o.index), ODJEZDY_CHILD: '1' };
      const c = spawn(process.execPath, args, { env, stdio: 'ignore' });
      children.set(o.index, c);
      log(`display ${o.index} (${o.name}): board pid ${c.pid}`);
      c.on('exit', (code) => { if (children.get(o.index) === c && !stopping) { log(`display ${o.index} exited ${code}, restarting`); setTimeout(run, 3000); } });
    };
    run();
  }
}
let stopping = false;
function stopChildren() { stopping = true; for (const c of children.values()) try { c.kill('SIGTERM'); } catch {} }
function reloadChild(n) { try { children.get(n)?.kill('SIGHUP'); } catch {} }

module.exports = { preferredMode, fbSize, detect, startKms, kmsConnect, wlList, wlConnect, startChildren, stopChildren, reloadChild, displayConfig, framebuffers };
