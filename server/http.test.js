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
  const { request } = await setup(t, { secret: 'fixture-credential' });
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
