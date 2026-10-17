// Bridge to the OS tools of the Arch image (arch/): installer and Wi-Fi. Both speak JSON (contracts agreed
// with the arch/ side): odjezdy-install --list-disks --json, odjezdy-install --json --disk X --yes (one object
// per line), odjezdy-wifi scan|connect|status --json. On systems without them (Alpine live, a dev PC) the
// features simply report themselves unavailable. ODJEZDY_INSTALL_CMD / ODJEZDY_WIFI_CMD override the paths
// (used with mock scripts for testing).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PATHS = ['/usr/local/bin', '/usr/bin', '/usr/lib/odjezdy', '/usr/local/sbin', '/usr/sbin'];
function which(name, env) {
  if (process.env[env]) return process.env[env];
  for (const d of PATHS) { const p = path.join(d, name); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  return null;
}
const INSTALL = () => which('odjezdy-install', 'ODJEZDY_INSTALL_CMD');
const WIFI = () => which('odjezdy-wifi', 'ODJEZDY_WIFI_CMD');

// a command path may be "node mock.js" for tests -> split into exe + leading args
function cmd(base, args) {
  const parts = base.split(' ');
  return [parts[0], [...parts.slice(1), ...args]];
}
function json(base, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const [exe, a] = cmd(base, args);
    execFile(exe, a, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => {
      let out = null;
      try { out = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
      if (out) return resolve(out); // tools answer with JSON even on failure ({ok:false,error})
      reject(err || new Error('neplatná odpověď nástroje'));
    });
  });
}

// live medium: / in RAM (archiso, Alpine diskless)
function isLive() {
  try {
    if (fs.existsSync('/run/archiso')) return true;
    const root = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).find((f) => f[1] === '/');
    return !!root && /^(tmpfs|rootfs|overlay|squashfs|erofs)$/.test(root[2]);
  } catch { return false; }
}
const cmdline = () => { try { return fs.readFileSync('/proc/cmdline', 'utf8'); } catch { return ''; } };

// fallback when the installer does not answer --options (older image)
const DEFAULT_OPTIONS = {
  locales: [['cs_CZ.UTF-8', 'Čeština'], ['sk_SK.UTF-8', 'Slovenčina'], ['en_US.UTF-8', 'English (US)'], ['en_GB.UTF-8', 'English (UK)'], ['de_DE.UTF-8', 'Deutsch'], ['pl_PL.UTF-8', 'Polski']].map(([id, name]) => ({ id, name })),
  keymaps: [['cz-qwertz', 'Česká (QWERTZ)'], ['cz', 'Česká (QWERTY)'], ['sk-qwertz', 'Slovenská (QWERTZ)'], ['us', 'Anglická (US)'], ['uk', 'Anglická (UK)'], ['de', 'Německá'], ['pl', 'Polská']].map(([id, name]) => ({ id, name })),
  timezones: ['Europe/Prague', 'Europe/Bratislava', 'Europe/Vienna', 'Europe/Berlin', 'Europe/Warsaw', 'Europe/Budapest', 'Europe/Zurich', 'Europe/Amsterdam', 'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome', 'Europe/Copenhagen', 'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Kyiv', 'UTC'],
};

const installer = {
  available: () => !!INSTALL(),
  defaultOptions: () => JSON.parse(JSON.stringify(DEFAULT_OPTIONS)),
  // {locales, keymaps, timezones} from the image itself; null when the installer predates --options
  async options() {
    try { const o = await json(INSTALL(), ['--options', '--json'], 15000); return o.locales?.length ? o : null; } catch { return null; }
  },
  async disks() { return (await json(INSTALL(), ['--list-disks', '--json'])).disks || []; },
  // onEvent({stage, progress, message}) for every line; resolves on "done", rejects on {"error"} / exit code
  run(disk, onEvent, extra = []) {
    return new Promise((resolve, reject) => {
      const [exe, a] = cmd(INSTALL(), ['--json', '--disk', disk, '--yes', ...extra]);
      const p = spawn(exe, a, { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '', done = false, error = null;
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.error) error = ev; else { if (ev.stage === 'done') done = true; onEvent(ev); }
        }
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (done && code === 0) resolve();
        else reject(new Error(error?.error || `instalátor skončil s kódem ${code}`));
      });
    });
  },
};

const wifi = {
  available: () => !!WIFI(),
  scan: () => json(WIFI(), ['scan', '--json'], 40000).then((j) => j.networks || []),
  connect: (ssid, pass) => json(WIFI(), ['connect', ssid, ...(pass ? [pass] : []), '--json'], 60000),
  status: () => json(WIFI(), ['status', '--json'], 15000),
};

// console keyboard layout, applied immediately (the board reads raw tty input through it)
function setKeymap(id) {
  if (!/^[\w-]+$/.test(id)) return;
  execFile('loadkeys', [id], (e) => { if (e) execFile('loadkeys', ['-q', id], () => {}); });
}

function reboot() {
  execFile('systemctl', ['reboot'], (e) => { if (e) execFile('reboot', () => {}); });
}

module.exports = { isLive, cmdline, installer, wifi, setKeymap, reboot };
