// Remote administration of a board over the network: a small HTTP server (port 8080, ODJEZDY_ADMIN_PORT, 0 = off) with a
// one-page web UI and a JSON API. Everything needs the admin token (/etc/odjezdy/admin.token, created on first start, shown
// on the board in the menu "Správa na dálku"). No TLS: meant for a trusted LAN / VPN; wrong tokens are rate-limited.
//   GET  /                 the page
//   GET  /api/status       version, uptime, stop, theme, memory, load, temperature, displays, last data refresh, schedule
//   GET  /api/stops?q=     stop search (for the stop picker)
//   POST /api/config       { stop: <stop object from /api/stops>, theme, custom: {…}, schedule: [{days,from,to,brightness}] }
//   POST /api/action       { action: restart | reboot | poweroff | update | clear-cache }
//   GET  /api/log          tail of the board log
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const TOKEN_FILE = process.env.ODJEZDY_ADMIN_TOKEN || '/etc/odjezdy/admin.token';
function readToken(create = true) {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (t.length >= 12) return t; } catch {}
  if (!create) return null;
  const t = crypto.randomBytes(9).toString('base64url');
  try { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 }); } catch {}
  return t;
}
let token = null;
const newToken = () => { try { fs.unlinkSync(TOKEN_FILE); } catch {} token = readToken(true); return token; };

// schedule rule -> brightness at a given time (0..100); days 1 = Monday … 7 = Sunday, windows may cross midnight
function scheduledBrightness(rules, now = new Date()) {
  const day = now.getDay() === 0 ? 7 : now.getDay(), min = now.getHours() * 60 + now.getMinutes();
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  for (const r of rules || []) {
    const a = toMin(r.from), b = toMin(r.to);
    if (a == null || b == null) continue;
    const days = Array.isArray(r.days) && r.days.length ? r.days : [1, 2, 3, 4, 5, 6, 7];
    const inRange = a <= b ? min >= a && min < b : min >= a || min < b;
    // after midnight a window that began yesterday still belongs to the day it started on
    const startDay = a > b && min < b ? (day === 1 ? 7 : day - 1) : day;
    if (inRange && days.includes(startDay)) return Math.max(0, Math.min(100, Number(r.brightness) || 0));
  }
  return 100;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now(), list = (failures.get(ip) || []).filter((t) => now - t < 60000);
  failures.set(ip, list);
  return list.length >= 8;
}

function start(api) {
  const port = process.env.ODJEZDY_ADMIN_PORT !== undefined ? +process.env.ODJEZDY_ADMIN_PORT : 8080;
  if (!port) return null;
  token = readToken(true);
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (d) => { b += d; if (b.length > 200000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
  const authed = (req) => {
    const t = String(req.headers['x-admin-token'] || '');
    const a = Buffer.from(t), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress || '?';
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, PAGE, 'text/html');
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (limited(ip)) return send(res, 429, { error: 'too many attempts, wait a minute' });
      if (!authed(req)) { failures.get(ip).push(Date.now()); return send(res, 401, { error: 'bad token' }); }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, api.status());
      if (req.method === 'GET' && url.pathname === '/api/stops') return send(res, 200, api.searchStops(url.searchParams.get('q') || ''));
      if (req.method === 'GET' && url.pathname === '/api/log') return send(res, 200, { log: api.logTail() });
      if (req.method === 'POST' && url.pathname === '/api/config') { api.applyConfig(await readBody(req)); return send(res, 200, { ok: true, status: api.status() }); }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const { action } = await readBody(req);
        if (!['restart', 'reboot', 'poweroff', 'update', 'clear-cache'].includes(action)) return send(res, 400, { error: 'unknown action' });
        send(res, 200, { ok: true, action });
        await sleep(300);
        return api.action(action);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
  });
  server.on('error', (e) => api.log('admin server: ' + e.message));
  server.listen(port, '0.0.0.0', () => api.log(`admin server on :${port}`));
  return { port, server };
}

// addresses the admin page can be reached on (for the board's info screen)
function addresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  return out;
}

const PAGE = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odjezdy – správa</title>
<style>
:root{--bg:#10131c;--card:#1a1f2e;--ink:#e8ecf5;--dim:#8b95ad;--acc:#ff9f1c;--ok:#4cc38a;--bad:#ff6b6b;--line:#2a3147}
@media (prefers-color-scheme:light){:root{--bg:#f2f4f9;--card:#fff;--ink:#141a2b;--dim:#5a647d;--line:#d6dbe8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}h1{font-size:20px;margin:8px 0 16px}h2{font-size:15px;margin:0 0 10px;color:var(--acc)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}label{color:var(--dim);min-width:110px}
input,select,button{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:7px 10px}
button{cursor:pointer;background:var(--acc);color:#1a1200;border:0;font-weight:600}button.sec{background:transparent;color:var(--ink);border:1px solid var(--line)}button.bad{background:var(--bad);color:#fff}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.k div{background:var(--bg);border-radius:8px;padding:8px 10px}.k b{display:block;font-size:12px;color:var(--dim);font-weight:500}
pre{background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:260px;font-size:12px}.msg{min-height:20px;color:var(--ok)}.err{color:var(--bad)}
td,th{padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%}
</style></head><body><main>
<h1>Odjezdy – správa tabule</h1>
<div class="card" id="login"><h2>Přihlášení</h2><div class="row"><label>Heslo</label><input id="tok" type="password" autocomplete="current-password" placeholder="heslo z obrazovky tabule"><button id="go">Přihlásit</button></div><div class="msg err" id="lerr"></div></div>
<div id="app" hidden>
<div class="card"><h2>Stav</h2><div class="k" id="st"></div></div>
<div class="card"><h2>Zastávka a vzhled</h2>
<div class="row"><label>Zastávka</label><input id="q" placeholder="hledat zastávku…" style="flex:1;min-width:200px"><button class="sec" id="sq">Hledat</button></div><div class="row" id="res"></div>
<div class="row"><label>Vzhled</label><select id="theme"></select></div>
<div class="row"><label>Jas (%)</label><input id="br" type="number" min="10" max="100" step="5" style="width:90px"></div>
<div class="row"><button id="save">Uložit</button><span class="msg" id="cm"></span></div></div>
<div class="card"><h2>Plán zapnutí a jasu</h2><p style="color:var(--dim);margin:0 0 8px">Pravidla se kontrolují shora; první platné vyhrává. Jas 0 = tabule zhasnutá. Mimo pravidla je plný jas.</p>
<table id="sch"></table><div class="row"><button class="sec" id="addr">Přidat pravidlo</button><button id="savesch">Uložit plán</button><span class="msg" id="sm"></span></div></div>
<div class="card"><h2>Akce</h2><div class="row"><button class="sec" data-a="restart">Restartovat tabuli</button><button class="sec" data-a="update">Zkontrolovat aktualizaci</button><button class="sec" data-a="clear-cache">Smazat mezipaměť</button><button class="bad" data-a="reboot">Restartovat počítač</button><button class="bad" data-a="poweroff">Vypnout</button></div><div class="msg" id="am"></div></div>
<div class="card"><h2>Záznam</h2><div class="row"><button class="sec" id="lg">Načíst záznam</button></div><pre id="log"></pre></div>
</div></main>
<script>
const $=s=>document.querySelector(s);let T=localStorage.getItem('odjezdyTok')||'',S=null,picked=null;
async function api(p,o={}){const r=await fetch(p,{...o,headers:{'X-Admin-Token':T,'Content-Type':'application/json'}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
function fmt(s){return s.toFixed?s:s}
function render(){const d=S;$('#st').innerHTML=[['Verze',d.version],['Zastávka',d.stop],['Vzhled',d.theme],['Doba běhu',d.uptime],['Paměť tabule',d.memory],['Volná paměť',d.free],['Zatížení',d.load],['Teplota',d.temp||'–'],['Data aktualizována',d.lastOk||'–'],['Jas teď',d.gain+' %'],['Displeje',d.displays]].map(([a,b])=>'<div><b>'+a+'</b>'+b+'</div>').join('');
$('#theme').innerHTML=d.themes.map(t=>'<option value="'+t.id+'"'+(t.id===d.themeId?' selected':'')+'>'+t.name+'</option>').join('');$('#br').value=d.brightness;renderSch(d.schedule||[])}
function renderSch(r){$('#sch').innerHTML='<tr><th>Dny</th><th>Od</th><th>Do</th><th>Jas %</th><th></th></tr>'+r.map((x,i)=>'<tr><td><input data-i="'+i+'" data-k="days" value="'+(x.days||[1,2,3,4,5,6,7]).join(',')+'" style="width:130px"></td><td><input data-i="'+i+'" data-k="from" value="'+x.from+'" style="width:80px"></td><td><input data-i="'+i+'" data-k="to" value="'+x.to+'" style="width:80px"></td><td><input data-i="'+i+'" data-k="brightness" type="number" value="'+x.brightness+'" style="width:80px"></td><td><button class="sec" data-del="'+i+'">×</button></td></tr>').join('')}
function readSch(){const rows=[...S.schedule||[]];document.querySelectorAll('#sch input').forEach(e=>{const i=+e.dataset.i,k=e.dataset.k;rows[i]=rows[i]||{};rows[i][k]=k==='days'?e.value.split(',').map(Number).filter(n=>n>=1&&n<=7):k==='brightness'?+e.value:e.value});return rows}
async function load(){try{S=await api('/api/status');$('#login').hidden=true;$('#app').hidden=false;render()}catch(e){$('#login').hidden=false;$('#app').hidden=true;$('#lerr').textContent=e.message}}
$('#go').onclick=()=>{T=$('#tok').value.trim();localStorage.setItem('odjezdyTok',T);load()};
$('#sq').onclick=async()=>{const r=await api('/api/stops?q='+encodeURIComponent($('#q').value));$('#res').innerHTML=r.map((s,i)=>'<button class="sec" data-p="'+i+'">'+s.name+(s.city?' ('+s.city+')':'')+'</button>').join('');window._r=r};
$('#res').onclick=e=>{const i=e.target.dataset.p;if(i!=null){picked=window._r[i];$('#q').value=picked.name;$('#cm').textContent='Vybráno: '+picked.name+' – uložte'}};
$('#save').onclick=async()=>{try{await api('/api/config',{method:'POST',body:JSON.stringify({stop:picked||undefined,theme:$('#theme').value,custom:{brightness:+$('#br').value}})});picked=null;$('#cm').textContent='Uloženo';await load()}catch(e){$('#cm').textContent=e.message}};
$('#addr').onclick=()=>{S.schedule=readSch();S.schedule.push({days:[1,2,3,4,5,6,7],from:'23:00',to:'05:00',brightness:0});renderSch(S.schedule)};
$('#sch').onclick=e=>{if(e.target.dataset.del!=null){S.schedule=readSch();S.schedule.splice(+e.target.dataset.del,1);renderSch(S.schedule)}};
$('#savesch').onclick=async()=>{try{await api('/api/config',{method:'POST',body:JSON.stringify({schedule:readSch()})});$('#sm').textContent='Uloženo';await load()}catch(e){$('#sm').textContent=e.message}};
document.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{const a=b.dataset.a;if((a==='reboot'||a==='poweroff')&&!confirm('Opravdu?'))return;try{await api('/api/action',{method:'POST',body:JSON.stringify({action:a})});$('#am').textContent='Provedeno: '+a}catch(e){$('#am').textContent=e.message}});
$('#lg').onclick=async()=>{const r=await api('/api/log');$('#log').textContent=r.log};
if(T)load();setInterval(()=>{if(!$('#app').hidden)load()},30000);
</script></body></html>`;

module.exports = { start, addresses, scheduledBrightness, newToken, readToken: () => token || readToken(true) };
