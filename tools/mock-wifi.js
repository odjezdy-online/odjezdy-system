// Stand-in for arch/'s odjezdy-wifi (same JSON contract), for testing the Wi-Fi screen anywhere:
//   ODJEZDY_WIFI_CMD="node tools/mock-wifi.js" node app/board.js --png out.png --wifi
const [cmd, ssid, pass] = process.argv.slice(2).filter((a) => a !== '--json');
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
if (cmd === 'scan') out({ networks: [
  { ssid: 'Domov', signal: 82, security: 'psk', known: true, connected: true },
  { ssid: 'Nadrazi-Free-WiFi', signal: 64, security: 'open', known: false, connected: false },
  { ssid: 'Soused 5G', signal: 41, security: 'psk', known: false, connected: false },
  { ssid: 'eduroam', signal: 22, security: '8021x', known: false, connected: false },
] });
if (cmd === 'status') out({ connected: true, ssid: 'Domov', ip: '192.168.1.42', signal: 82, device: 'wlan0' });
if (cmd === 'connect') out(pass === 'spatne' ? { ok: false, error: 'špatné heslo' } : { ok: true, ssid });
out({ ok: false, error: 'neznámý příkaz' });
