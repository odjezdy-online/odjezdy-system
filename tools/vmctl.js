// Dev helper for a QEMU started with `-monitor tcp:127.0.0.1:4444,server,nowait`.
//   node vmctl.js shot out.png        screenshot (PPM from QEMU -> PNG)
//   node vmctl.js keys "hlavni" ret   type text / send key names (ret, esc, up, down, alt-f2 …)
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function monitor(cmds) {
  return new Promise((resolve, reject) => {
    const s = net.connect(4444, '127.0.0.1');
    let out = '';
    s.on('data', (d) => (out += d));
    s.on('error', reject);
    s.on('connect', async () => {
      for (const c of cmds) { s.write(c + '\n'); await new Promise((r) => setTimeout(r, 120)); }
      setTimeout(() => { s.destroy(); resolve(out); }, 400);
    });
  });
}

function ppmToPng(ppm, png) {
  const buf = fs.readFileSync(ppm);
  const header = buf.toString('latin1', 0, 64).match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const [, w, h] = header.map(Number);
  const data = buf.subarray(header[0].length);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return [w, h];
}

const KEYMAP = {
  '|': 'shift-backslash', "'": 'apostrophe', '"': 'shift-apostrophe', $: 'shift-4', '(': 'shift-9', ')': 'shift-0', _: 'shift-minus',
  '>': 'shift-dot', '<': 'shift-comma', '*': 'shift-8', ':': 'shift-semicolon', '&': 'shift-7', '\\': 'backslash', ' ': 'spc', '.': 'dot', ',': 'comma', '-': 'minus', '/': 'slash', '=': 'equal', ';': 'semicolon', '\n': 'ret' };

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'shot') {
    const png = path.resolve(rest[0] || 'shot.png');
    // monitor arguments cannot contain spaces -> dump to a temp path first
    const ppm = path.join(require('os').tmpdir(), `vmshot-${process.pid}.ppm`);
    await monitor([`screendump ${ppm.replace(/\\/g, '/')}`]);
    await new Promise((r) => setTimeout(r, 500));
    const [w, h] = ppmToPng(ppm, png);
    fs.unlinkSync(ppm);
    console.log(`${png} ${w}x${h}`);
  } else if (cmd === 'keys') {
    const cmds = [];
    for (const arg of rest) {
      if (/^[a-z0-9]+(-[a-z0-9]+)+$|^(ret|esc|up|down|left|right|backspace|tab)$/.test(arg)) cmds.push(`sendkey ${arg}`);
      else for (const ch of arg) {
        const k = KEYMAP[ch] || (/[A-Z]/.test(ch) ? `shift-${ch.toLowerCase()}` : ch);
        cmds.push(`sendkey ${k}`);
      }
    }
    await monitor(cmds);
    console.log(`sent ${cmds.length} keys`);
  } else {
    console.log(await monitor([rest.join(' ') || 'info status']));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
