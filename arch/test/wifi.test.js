'use strict';
// node --test arch/test/wifi.test.js
// Runs odjezdy-wifi's logic against fake busctl/iwctl output shaped like the real thing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWifi, signalPercent, securityOf } = require('../pkg/odjezdy-board/odjezdy-wifi');

const v = (type, data) => ({ type, data });
const DEV = '/net/connman/iwd/0/3';
const N1 = `${DEV}/616c7068615f707361`, N2 = `${DEV}/6f70656e`, N3 = `${DEV}/616c7068615f707361_2`;

function objects({ connected = null, state = 'disconnected' } = {}) {
  return {
    [DEV]: {
      'net.connman.iwd.Device': { Name: v('s', 'wlan0'), Powered: v('b', true) },
      'net.connman.iwd.Station': { State: v('s', state), Scanning: v('b', false), ConnectedNetwork: v('o', connected || '/') }
    },
    [N1]: { 'net.connman.iwd.Network': { Name: v('s', 'Home'), Type: v('s', 'psk'), Connected: v('b', connected === N1), KnownNetwork: v('o', '/net/connman/iwd/known1') } },
    [N2]: { 'net.connman.iwd.Network': { Name: v('s', 'Cafe'), Type: v('s', 'open'), Connected: v('b', false) } },
    [N3]: { 'net.connman.iwd.Network': { Name: v('s', 'Home'), Type: v('s', 'psk'), Connected: v('b', false) } }
  };
}

function fakeBus(objs, calls = []) {
  return async args => {
    calls.push(args.join(' '));
    if (args.includes('GetManagedObjects')) return { type: 'a{oa{sa{sv}}}', data: [objs] };
    if (args.includes('GetOrderedNetworks')) return { type: 'a(on)', data: [[[N2, -7000], [N1, -4500], [N3, -8800]]] };
    if (args.includes('Scanning')) return v('b', false);
    return { type: '', data: [] };
  };
}

test('signalPercent maps -30..-90 dBm to 100..0', () => {
  assert.equal(signalPercent(-3000), 100);
  assert.equal(signalPercent(-6000), 50);
  assert.equal(signalPercent(-9000), 0);
  assert.equal(signalPercent(-2000), 100);
  assert.equal(signalPercent(-9900), 0);
  assert.equal(signalPercent('x'), null);
});

test('securityOf collapses iwd network types', () => {
  assert.deepEqual(['open', 'psk', '8021x', 'wep', undefined].map(securityOf), ['open', 'psk', '8021x', 'psk', 'psk']);
});

test('scan lists networks strongest first, one per SSID, with known/connected flags', async () => {
  const w = makeWifi({ bus: fakeBus(objects({ connected: N1, state: 'connected' })), wait: async () => {} });
  const r = await w.scan();
  assert.equal(r.device, 'wlan0');
  assert.deepEqual(r.networks, [
    { ssid: 'Home', signal: 75, security: 'psk', known: true, connected: true },
    { ssid: 'Cafe', signal: 33, security: 'open', known: false, connected: false }
  ]);
});

test('scan without a Wi-Fi card gives an empty list and no device', async () => {
  const w = makeWifi({ bus: fakeBus({}), wait: async () => {} });
  assert.deepEqual(await w.scan(), { networks: [], device: null });
});

test('status when disconnected, and when connected with signal and address', async () => {
  const off = makeWifi({ bus: fakeBus(objects()) });
  assert.deepEqual(await off.status(), { connected: false, ssid: null, ip: null, signal: null, device: 'wlan0' });
  const on = makeWifi({
    bus: fakeBus(objects({ connected: N1, state: 'connected' })),
    ip: async dev => { assert.equal(dev, 'wlan0'); return [{ addr_info: [{ local: '192.168.1.20' }] }]; }
  });
  assert.deepEqual(await on.status(), { connected: true, ssid: 'Home', ip: '192.168.1.20', signal: 75, device: 'wlan0' });
});

test('status without a card', async () => {
  const w = makeWifi({ bus: fakeBus({}) });
  assert.deepEqual(await w.status(), { connected: false, ssid: null, ip: null, signal: null, device: null });
});

test('connect passes the passphrase to iwctl and confirms by status', async () => {
  let used;
  let objs = objects();
  const w = makeWifi({
    bus: async a => fakeBus(objs)(a),
    iwctl: async args => { used = args; objs = objects({ connected: N1, state: 'connected' }); return ''; },
    ip: async () => []
  });
  assert.deepEqual(await w.connect('Home', 'secret pass'), { ok: true, ssid: 'Home' });
  assert.deepEqual(used, ['--passphrase', 'secret pass', 'station', 'wlan0', 'connect', 'Home']);
});

test('connect failures become readable errors', async () => {
  const fail = text => makeWifi({ bus: fakeBus(objects()), iwctl: async () => { const e = new Error('x'); e.stderr = text; throw e; } });
  assert.deepEqual(await fail('Operation failed').connect('Home', 'bad'), { ok: false, error: 'Připojení se nezdařilo, zkontrolujte heslo.' });
  assert.deepEqual(await fail('Operation failed').connect('Home'), { ok: false, error: 'Síť vyžaduje heslo.' });
  assert.deepEqual(await fail('Network not found').connect('Nope'), { ok: false, error: 'Síť nebyla nalezena.' });
  assert.deepEqual(await fail('???').connect('Home', 'x'), { ok: false, error: 'Připojení se nezdařilo.' });
  assert.deepEqual(await makeWifi({ bus: fakeBus({}) }).connect('Home'), { ok: false, error: 'Žádná Wi-Fi karta.' });
  assert.deepEqual(await makeWifi({ bus: fakeBus(objects()) }).connect(''), { ok: false, error: 'Chybí název sítě.' });
});

test('connect that iwctl calls successful but status does not confirm is a failure', async () => {
  const w = makeWifi({ bus: fakeBus(objects()), iwctl: async () => '' });
  assert.equal((await w.connect('Home', 'x')).ok, false);
});
