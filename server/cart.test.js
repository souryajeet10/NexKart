import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.js';
import { Cart } from './cart.js';

const biscuit = 'A0010001';
const chocolate = 'A0010002';

function setup(t, filename = ':memory:') {
  let now = 1000000;
  const store = openStore(filename);
  const cart = new Cart(store, () => now);
  t.after(() => store.close());
  const act = (fn) => cart.change(fn);
  const scan = (uid = biscuit, id = '1') => act(() => cart.scan(uid, id, 'simulation'));
  const weight = (grams) => act(() => cart.simulate(grams));
  return { store, cart, act, scan, weight, advance: (ms) => { now += ms; cart.tick(); } };
}

test('scan is pending until stable delta verification and receipt totals use paise', (t) => {
  const { cart, act, scan, weight } = setup(t);
  scan();
  assert.equal(cart.view().state, 'AWAITING_WEIGHT');
  assert.equal(cart.view().subtotal, 0);
  weight(103);
  assert.equal(cart.view().state, 'VERIFIED');
  assert.equal(cart.view().subtotal, 2000);
  const receipt = act(() => cart.checkout());
  assert.equal(receipt.subtotal, 2000);
  assert.equal(receipt.session.status, 'PAID');
});

test('mismatch blocks billing and checkout until corrected', (t) => {
  const { cart, act, scan, weight } = setup(t);
  scan();
  weight(350);
  assert.equal(cart.view().state, 'WEIGHT_MISMATCH');
  assert.equal(cart.view().alert.actual, 350);
  assert.equal(cart.view().subtotal, 0);
  assert.throws(() => act(() => cart.checkout()), /stable, balanced/);
  weight(100);
  assert.equal(cart.view().alert, null);
  assert.equal(cart.view().beep, 1);
});

test('unknown RFID tags produce an error and a recorded rejected scan', (t) => {
  const { cart, scan, store } = setup(t);
  assert.equal(scan('FFFFFFFF').status, 404);
  assert.equal(cart.view().pending, null);
  assert.equal(store.sql('SELECT result FROM scans').get().result, 'REJECTED');
});

test('replayed scan IDs cannot create additional units, including after completion', (t) => {
  const { cart, scan, weight } = setup(t);
  scan();
  assert.equal(scan().duplicate, true);
  weight(100);
  assert.equal(scan().duplicate, true);
  assert.equal(cart.items.length, 1);
  scan(biscuit, '2');
  weight(200);
  assert.equal(cart.items.length, 2);
});

test('unscanned weight activates alert without adding an item', (t) => {
  const { cart, scan, weight } = setup(t);
  scan();
  weight(100);
  weight(250);
  assert.equal(cart.view().state, 'UNEXPECTED_WEIGHT');
  assert.equal(cart.view().ready, false);
  assert.equal(cart.view().subtotal, 2000);
  weight(100);
  assert.equal(cart.view().ready, true);
});

test('removal requires a matching decrease from the stable pre-removal weight', (t) => {
  const { cart, act, scan, weight } = setup(t);
  scan();
  weight(102);
  act(() => cart.remove(cart.items[0].lineId));
  assert.equal(cart.view().state, 'AWAITING_REMOVAL');
  weight(175);
  assert.equal(cart.view().subtotal, 2000);
  assert.equal(cart.view().state, 'WEIGHT_MISMATCH');
  weight(2);
  assert.equal(cart.view().subtotal, 0);
});

test('multiple products use separate baselines and an acceptable combined weight', (t) => {
  const { cart, scan, weight } = setup(t);
  scan();
  weight(107);
  scan(chocolate, '2');
  weight(165);
  assert.equal(cart.view().state, 'WEIGHT_MISMATCH');
  weight(154);
  assert.equal(cart.view().subtotal, 7000);
  assert.equal(cart.view().expected, 150);
});

test('fluctuating and small sensor changes cannot verify a pending scan', (t) => {
  const { cart, act, scan } = setup(t);
  scan();
  for (const value of [99, 108, 95, 108, 95, 108]) act(() => cart.read(value));
  assert.equal(cart.view().sensorReady, false);
  assert.equal(cart.view().subtotal, 0);
  for (const value of [0, 1, -1, 1, 0]) act(() => cart.read(value));
  assert.equal(cart.view().state, 'AWAITING_WEIGHT');
  assert.equal(cart.view().subtotal, 0);
});

test('checkout blocks while pending, unstable, unexpected, out of range or disconnected', (t) => {
  const { cart, act, scan, weight } = setup(t);
  scan();
  weight(100);
  scan(chocolate, '2');
  assert.throws(() => act(() => cart.checkout()));
  act(() => cart.cancel());
  act(() => cart.read(200));
  assert.throws(() => act(() => cart.checkout()));
  weight(5001);
  assert.equal(cart.view().alert.title, 'SCALE OUT OF RANGE');
  assert.throws(() => act(() => cart.checkout()));
  weight(100);
  act(() => cart.connection(false));
  assert.throws(() => act(() => cart.checkout()));
  act(() => cart.connection(true));
  assert.equal(cart.view().ready, true);
});

test('timeout with displaced weight requires restoring the baseline', (t) => {
  const { cart, scan, weight, advance } = setup(t);
  scan();
  weight(350);
  advance(31000);
  assert.equal(cart.view().pending.cancelled, true);
  weight(100);
  assert.equal(cart.view().subtotal, 0);
  weight(0);
  assert.equal(cart.view().pending, null);
  assert.equal(cart.view().alert, null);
});

test('reset opens an empty session and preserves the prior session in history', (t) => {
  const { cart, act, scan, weight, store } = setup(t);
  scan();
  weight(100);
  const prior = cart.data.session;
  act(() => cart.newSession(true));
  assert.notEqual(cart.data.session, prior);
  assert.equal(cart.view().subtotal, 0);
  assert.equal(cart.view().actual, 0);
  assert.equal(store.sql('SELECT status FROM sessions WHERE id=?').get(prior).status, 'RESET');
});

test('SQLite retains verified purchases and pending state across reopening', () => {
  const folder = mkdtempSync(join(tmpdir(), 'smartcart-'));
  const filename = join(folder, 'cart.sqlite');
  let store = openStore(filename);
  try {
    const cart = new Cart(store);
    cart.change(() => cart.scan(biscuit, 'a', 'simulation'));
    cart.change(() => cart.simulate(100));
    cart.change(() => cart.scan(chocolate, 'b', 'simulation'));
    store.close();
    store = openStore(filename);
    const recovered = new Cart(store);
    assert.equal(recovered.view().subtotal, 2000);
    assert.equal(recovered.view().pending.item.name, 'Chocolate');
    recovered.change(() => recovered.simulate(150));
    assert.equal(recovered.view().subtotal, 7000);
  } finally {
    store.close();
    rmSync(folder, { recursive: true });
  }
});
