import express from 'express';
import { attachSimulator } from './simulator.js';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';
import { Cart, CAPACITY, fail, normalizeUid } from './cart.js';

function number(value, min, max, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(label + ' must be ' + (integer ? 'a whole number' : 'a number') + ' between ' + min + ' and ' + max + '.', 400);
  }
  return value;
}
function label(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('Enter a valid ' + name + '.', 400);
  return value.trim();
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) fail('Invalid ' + name + '.', 400);
  return value;
}
function product(body) {
  const image = body.image ? label(body.image, 500, 'image URL') : '';
  if (image && !/^https?:\/\//i.test(image)) fail('Use an HTTP or HTTPS image URL.', 400);
  return [
    normalizeUid(body.uid), label(body.name, 100, 'name'), number(body.price, 1, 100000000, 'Price in paise', true),
    number(body.grams, 10, CAPACITY, 'Weight in grams', true), label(body.category, 60, 'category'), image,
  ];
}

export function createApp(store, { secret = '', staticDir, clock, simulationEnabled = process.env.NODE_ENV !== 'production', deviceId, placementMs, mismatchMs, demoStore } = {}) {
  const cart = new Cart(store, clock, { simulationEnabled: simulationEnabled && process.env.NODE_ENV !== 'production', deviceId, placementMs, mismatchMs });
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const io = new Server(server);
  const runId = randomUUID();
  const snapshot = () => ({ ...cart.view(), runId });
  const publish = () => io.emit('cart', snapshot());
  const update = (fn) => {
    const result = cart.change(fn);
    publish();
    return result;
  };
  const sessionRequired = (req) => {
    if (req.body.session !== cart.data.session) fail('The shopping session changed. Use the current dashboard.');
  };

  app.use('/api', express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (!req.is('application/json') || !req.body || Array.isArray(req.body)) return next(Object.assign(new Error('Send a JSON object.'), { status: 400 }));
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== (req.get('x-forwarded-host') || req.get('host'))) fail('Origin is not allowed.', 403);
      } catch (error) { return next(error); }
    }
    next();
  });
  io.on('connection', (socket) => socket.emit('cart', snapshot()));
  const timer = setInterval(() => {
    try { if (cart.tick()) publish(); }
    catch (error) { console.error(error); }
  }, 250);
  timer.unref();
  server.on('close', () => clearInterval(timer));

  const simulator = attachSimulator(app, io, store, { enabled: cart.simulationEnabled, store: demoStore, clock, runId });
  server.on('close', () => simulator.close());

  app.get('/api/cart', (_req, res) => res.json(snapshot()));
  app.get('/api/products', (_req, res) => res.json(store.sql('SELECT * FROM products ORDER BY id').all()));
  app.post('/api/products', (req, res) => {
    const id = store.sql('INSERT INTO products(uid,name,price,grams,category,image) VALUES (?,?,?,?,?,?)').run(...product(req.body)).lastInsertRowid;
    io.emit('products');
    res.status(201).json({ id: Number(id) });
  });
  app.put('/api/products/:id', (req, res) => {
    if (!store.sql('UPDATE products SET uid=?,name=?,price=?,grams=?,category=?,image=? WHERE id=?').run(...product(req.body), Number(req.params.id)).changes) fail('Product not found.', 404);
    io.emit('products');
    res.json({ ok: true });
  });
  app.delete('/api/products/:id', (req, res) => {
    if (!store.sql('DELETE FROM products WHERE id=?').run(Number(req.params.id)).changes) fail('Product not found.', 404);
    io.emit('products');
    res.json({ ok: true });
  });
  app.get('/api/sessions', (_req, res) => res.json(store.sql('SELECT id,started,ended,status,receipt FROM sessions ORDER BY id DESC').all().map(
    ({ receipt, ...session }) => ({ ...session, subtotal: receipt ? JSON.parse(receipt).subtotal : null }),
  )));
  app.get('/api/sessions/:id/receipt', (req, res) => {
    const row = store.sql('SELECT receipt FROM sessions WHERE id=?').get(Number(req.params.id));
    if (!row?.receipt) fail('Receipt not found.', 404);
    res.json(JSON.parse(row.receipt));
  });
  const action = (path, fn, needsSession = true) => app.post('/api' + path, (req, res) => {
    if (needsSession) sessionRequired(req);
    const result = update(() => fn(req.body));
    if (result?.error) return res.status(result.status).json({ error: result.error });
    res.json({ cart: snapshot(), result });
  });
  const sim = () => { if (!cart.simulationEnabled) fail('Simulation is disabled.', 403); if (cart.data.mode !== 'simulation') fail('Switch to Simulation Mode first.'); };
  action('/sessions', () => cart.newSession());
  action('/scan', (body) => {
    sim();
    return cart.scan(body.uid, identifier(body.event, 'event ID'), 'simulation');
  });
  action('/weight', (body) => { sim(); return cart.simulate(number(body.grams, -10000, 20000, 'Weight')); });
  action('/remove', (body) => cart.remove(number(body.lineId, 1, Number.MAX_SAFE_INTEGER, 'Item line ID', true)));
  action('/cancel', () => cart.cancel());
  action('/checkout', () => cart.checkout());
  action('/sim/reset', () => { sim(); return cart.newSession(true); });
  action('/sim/connection', (body) => {
    sim();
    if (typeof body.online !== 'boolean') fail('Provide a connection state.', 400);
    cart.connection(body.online);
  });
  action('/mode', (body) => {
    if (!['simulation', 'hardware'].includes(body.mode)) fail('Choose Simulation or Hardware Mode.', 400);
    if (body.mode === 'hardware' && !secret) fail('Set SMARTCART_DEVICE_KEY on the server before enabling Hardware Mode.');
    cart.switchMode(body.mode);
  });
  action('/settings', (body) => {
    if (cart.data.pending) fail('Finish or cancel the pending action before changing tolerance.');
    cart.data.tolerance = number(body.tolerance, 5, 30, 'Tolerance', true);
    cart.evaluate();
  });
  action('/scale', (body) => {
    if (!['tare', 'calibrate'].includes(body.kind)) fail('Choose tare or calibrate.', 400);
    const value = body.kind === 'calibrate' ? number(body.value, -1000000, 1000000, 'Calibration factor') : null;
    if (value === 0) fail('Calibration factor cannot be zero.', 400);
    cart.control(body.kind, value, randomUUID());
  });
  app.get('/api/device/status', (_req, res) => res.json({ cartId: 'SC-01', connected: cart.connected, sensorReady: cart.sensorReady, deviceId: deviceId || store.get('boundDevice'), command: cart.data.command }));
  app.post('/api/device', (req, res) => {
    const key = Buffer.from(req.get('authorization') ?? '');
    const expected = Buffer.from('Bearer ' + secret);
    if (!secret || key.length !== expected.length || !timingSafeEqual(key, expected)) fail('Invalid device credential.', 401);
    const { id, boot, grams, ack, scan, setupScale = false } = req.body;
    identifier(id, 'device ID');
    identifier(boot, 'boot ID');
    if (typeof setupScale !== 'boolean' || (setupScale && grams != null)) fail('Invalid scale setup state.', 400);
    if (grams !== null && grams !== undefined) number(grams, -1000000, 1000000, 'Weight');
    if (ack !== undefined && ack !== null) identifier(ack, 'command acknowledgment');
    if (scan) {
      normalizeUid(scan.uid);
      identifier(scan.event, 'scan event ID');
    }
    const result = update(() => {
      cart.acceptDevice(id, boot, setupScale);
      if (cart.data.command && ack === cart.data.command.id) {
        cart.log('info', 'ESP32 completed ' + cart.data.command.kind + '.');
        cart.data.command = null;
      }
      if (grams == null) cart.loseWeight();
      const scanned = scan && cart.scan(scan.uid, id + ':' + boot + ':' + scan.event, 'hardware');
      if (grams != null) cart.read(grams);
      return scanned || null;
    });
    res.json({
      state: cart.data.state, alert: Boolean(cart.data.alert && cart.open), beep: cart.data.beep,
      command: cart.data.command, scan: result, session: cart.data.session, expected: cart.expected, actual: cart.data.actual, sensorReady: cart.sensorReady,
      subtotal: cart.view().subtotal, text: cart.data.alert ? 'Weight Mismatch' : cart.data.pending?.item.name ?? (cart.data.state === 'VERIFIED' ? 'Product Added' : cart.balanced && cart.items.length ? 'Weight Verified' : 'Scan Product'),
    });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (staticDir) {
    app.get(['/admin', '/simulator'], (_req, res) => res.sendFile(join(staticDir, 'index.html')));
    app.use(express.static(staticDir));
  }
  app.use((error, _req, res, _next) => {
    const duplicate = error.errcode === 2067;
    const status = duplicate ? 409 : error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: duplicate ? 'That RFID UID is already assigned.' : status >= 500 ? 'The server could not complete the request.' : error.message });
  });
  return { server, io, cart };
}
