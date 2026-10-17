// Test client for odjezdy-kms: streams moving colour bars with the output number to one output.
//   node kms-test.js [/run/odjezdy-kms.sock] [output] [seconds]
const net = require('net');
const [sock = '/run/odjezdy-kms.sock', out = '0', secs = '8'] = process.argv.slice(2);
const s = net.createConnection(sock, () => s.write(`LIST\nOUT ${out}\n`));
let buf = '', geo = null;
s.on('data', (d) => {
  if (geo) return;
  buf += d;
  const m = buf.match(/OK (\d+) (\d+) (\d+)\n/);
  if (!m) return;
  process.stdout.write(buf);
  const [w, h, stride] = m.slice(1).map(Number);
  geo = { w, h, stride };
  const frame = Buffer.alloc(stride * h);
  const colors = [[255, 180, 0], [0, 200, 80], [40, 120, 255], [255, 60, 60]];
  const t0 = Date.now();
  const draw = () => {
    const t = Date.now() - t0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = colors[(Math.floor((x + t / 5) / (w / 8)) + Number(out)) % 4], o = y * stride + x * 4;
      frame[o] = c[2]; frame[o + 1] = c[1]; frame[o + 2] = c[0]; frame[o + 3] = 255;
    }
    if (s.writableLength === 0) s.write(Buffer.from(frame));
    if (t < Number(secs) * 1000) setTimeout(draw, 100); else s.end();
  };
  draw();
});
s.on('error', (e) => { console.error(e.message); process.exit(1); });
