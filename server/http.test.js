import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { openStore } from './store.js';
import { createApp } from './http.js';

async function setup(t, options = {}) {
  const store = openStore(':memory:');
  const { server, io } = createApp(store, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await io.close(); store.close(); });
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(origin + '/api' + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { code: response.status, body: await response.json() };
  }
  return { origin, request };
}

test('HTTP simulator publishes verified cart updates to a Socket.IO subscriber', async (t) => {
  const { origin, request } = await setup(t);
  const socket = connect(origin, { transports: ['websocket'], autoConnect: false });
  t.after(() => socket.close());
  const initial = once(socket, 'cart');
  socket.connect();
  const [cart] = await initial;
  const body = { session: cart.session.id };
  assert.equal((await request('/scan', 'POST', { ...body, uid: 'A0010001', event: 'demo' })).code, 200);
  const update = new Promise((resolve) => {
    socket.on('cart', (next) => { if (next.subtotal === 2000) resolve(next); });
  });
  assert.equal((await request('/weight', 'POST', { ...body, grams: 102 })).code, 200);
  assert.equal((await update).expected, 100);
  const checkout = await request('/checkout', 'POST', body);
  assert.equal(checkout.body.result.subtotal, 2000);
  const receipt = await request('/sessions/' + cart.session.id + '/receipt');
  assert.deepEqual(receipt.body, checkout.body.result);
});

test('catalog CRUD validates unique RFID tags and preserves captured sale details', async (t) => {
  const { request } = await setup(t);
  const original = { uid: '12345678', name: 'Tea', price: 7500, grams: 100, category: 'Beverages' };
  const created = await request('/products', 'POST', original);
  assert.equal(created.code, 201);
  assert.equal((await request('/products', 'POST', original)).code, 409);
  const cart = (await request('/cart')).body;
  const session = { session: cart.session.id };
  assert.equal((await request('/scan', 'POST', { ...session, uid: original.uid, event: 'tea' })).code, 200);
  const path = '/products/' + created.body.id;
  assert.equal((await request(path, 'PUT', { ...original, price: 8000 })).code, 200);
  assert.equal((await request(path, 'DELETE', {})).code, 200);
  const verified = await request('/weight', 'POST', { ...session, grams: 100 });
  assert.equal(verified.body.cart.subtotal, 7500);
});

test('hardware protocol requires credentials and handles stable readings, replay and sensor loss', async (t) => {
  const { request } = await setup(t, { secret: 'fixture-credential', placementMs: 0, mismatchMs: 0 });
  const session = (await request('/cart')).body.session.id;
  const post = (path, body) => request(path, 'POST', { ...body, session });
  await post('/mode', { mode: 'hardware' });
  assert.equal((await request('/device', 'POST', {})).code, 401);
  const frame = (data) => request('/device', 'POST', { id: 'test-esp', boot: 'a1', ...data }, { Authorization: 'Bearer fixture-credential' });
  await frame({ setupScale: true });
  const control = await post('/scale', { kind: 'tare' });
  assert.equal(control.code, 200);
  const command = (await frame({ setupScale: true })).body.command;
  assert.equal(command.kind, 'tare');
  await frame({ setupScale: true, ack: command.id });
  for (let i = 0; i < 5; i++) await frame({ grams: 0 });
  const scan = { uid: 'A0010001', event: '1' };
  assert.equal((await frame({ grams: 0, scan })).body.scan.accepted, true);
  assert.equal((await frame({ grams: 0, scan })).body.scan.duplicate, true);
  for (let i = 0; i < 5; i++) await frame({ grams: 160 });
  assert.equal((await frame({ grams: 160 })).body.alert, true);
  assert.equal((await post('/checkout', {})).code, 409);
  for (let i = 0; i < 5; i++) await frame({ grams: 102 });
  assert.equal((await request('/cart')).body.ready, true);
  await frame({ grams: null });
  assert.equal((await request('/cart')).body.ready, false);
  assert.equal((await post('/checkout', {})).code, 409);
});


test('disabled simulation cannot mutate a hardware cart and device binding survives offline', async (t) => {
  let now = 1000;
  const { request } = await setup(t, { secret: 'test-key', simulationEnabled: false, deviceId: 'assigned', clock: () => now });
  const session = (await request('/cart')).body.session.id;
  for (const [path, body] of [['/scan', { uid: 'A0010001', event: 'x' }], ['/weight', { grams: 100 }], ['/sim/reset', {}], ['/sim/connection', { online: true }], ['/mode', { mode: 'simulation' }]]) {
    assert.equal((await request(path, 'POST', { session, ...body })).code, 403);
  }
  const frame = (id, extra = {}) => request('/device', 'POST', { id, boot: 'boot', grams: 0, ...extra }, { Authorization: 'Bearer test-key' });
  assert.equal((await frame('assigned')).code, 200);
  now += 10000;
  assert.equal((await frame('other')).code, 403);
  assert.equal((await request('/device/status')).body.connected, false);
  for (let i = 0; i < 5; i++) await frame('assigned');
  assert.equal((await request('/cart')).body.sensorReady, true);
  const scan = { uid: 'FFFFFFFF', event: 'unknown' };
  assert.equal((await frame('assigned', { scan })).body.scan.status, 404);
  const replay = (await frame('assigned', { scan })).body.scan;
  assert.equal(replay.status, 404);
  assert.equal(replay.duplicate, true);
});


test('dedicated simulator is isolated from hardware, reuses catalog and publishes separate snapshots', async (t) => {
  const { request, origin } = await setup(t, { secret: 'hardware-key' });
  const real = (await request('/cart')).body;
  await request('/mode', 'POST', { session: real.session.id, mode: 'hardware' });
  const before = (await request('/cart')).body;
  const socket = connect(origin, { transports: ['websocket'], autoConnect: false });
  t.after(() => socket.close());
  const initial = once(socket, 'simulator:cart'); socket.connect();
  const [demo] = await initial;
  assert.equal(demo.source, 'simulator');
  const post = (path, body = {}) => request('/simulator/' + path, 'POST', { session: demo.session.id, ...body });
  const event = { uid: 'A0010001', event: 'sim-1' };
  assert.equal((await post('scan', event)).body.result.product.name, 'Biscuit Packet');
  assert.equal((await post('scan', event)).body.result.duplicate, true);
  const synced = new Promise(resolve => socket.on('simulator:cart', state => { if (state.subtotal === 2000) resolve(state); }));
  await post('weight', { grams: 100 });
  assert.equal((await synced).expected, 100);
  assert.equal((await post('scan', event)).body.cart.items.length, 1);
  await post('scan', { ...event, event: 'sim-2' });
  const second = await post('weight', { grams: 200 });
  assert.equal(second.body.cart.subtotal, 4000);
  await post('weight', { grams: 300 });
  assert.equal((await post('checkout')).code, 409);
  await post('weight', { grams: 200 });
  await post('remove', { lineId: second.body.cart.items[0].lineId });
  assert.equal((await post('weight', { grams: 100 })).body.cart.subtotal, 2000);
  const receipt = await post('checkout');
  assert.equal(receipt.body.result.subtotal, 2000);
  const history = (await request('/sessions')).body;
  assert.equal(history.filter(row => row.status === 'PAID').length, 0);
  assert.deepEqual((await request('/cart')).body, before);
  await post('reset');
  assert.equal((await post('weight', { grams: 0 })).code, 409, 'old session cannot mutate a reset demo');
});

test('virtual raw samples honor configured stability, reject invalid events and reconnect without hardware', async (t) => {
  const { request } = await setup(t);
  const { session } = (await request('/simulator/cart')).body;
  const post = (path, body = {}) => request('/simulator/' + path, 'POST', { session: session.id, ...body });
  assert.equal((await post('settings', { tolerance: 5, sampleCount: 3, stableSpan: 1 })).code, 200);
  await post('sample', { grams: 0 });
  await post('sample', { grams: 3 });
  assert.equal((await post('sample', { grams: 0 })).body.cart.sensorReady, false);
  await post('weight', { grams: 0 });
  assert.equal((await post('scan', { uid: 'FFFFFFFF', event: 'unknown' })).code, 404);
  assert.equal((await post('scan', { uid: 'A0010001', event: {} })).code, 400);
  await post('scan', { uid: 'A0010001', event: 'ok' });
  await post('sample', { grams: 100 });
  assert.equal((await post('sample', { grams: 100 })).body.cart.subtotal, 0);
  assert.equal((await post('sample', { grams: 100 })).body.cart.subtotal, 2000);
  await post('connection', { online: false });
  assert.equal((await post('weight', { grams: 100 })).code, 409);
  assert.equal((await post('connection', { online: true })).body.cart.ready, true);
  assert.equal((await post('settings', { tolerance: 99, sampleCount: 3, stableSpan: 1 })).code, 400);
});

test('dedicated simulator API is disabled when simulation is disabled', async (t) => {
  const { request } = await setup(t, { simulationEnabled: false });
  assert.equal((await request('/simulator/cart')).code, 403);
  assert.equal((await request('/simulator/reset', 'POST', { session: 1 })).code, 403);
});
