import { Cart, fail } from './cart.js';
import { openStore } from './store.js';

// Separate storage, same state machine and read-only shared product catalog.
export function attachSimulator(app, io, catalog, { enabled, store, clock, runId }) {
  const owned = !store;
  store ??= openStore(':memory:', { seedDemo: false });
  const isolated = { ...store, sql: query => /\bproducts\b/i.test(query) ? catalog.sql(query) : store.sql(query) };
  const cart = new Cart(isolated, clock);
  const snapshot = () => ({ ...cart.view(), cartId: 'VIRTUAL-01', source: 'simulator', runId });
  const publish = () => io.emit('simulator:cart', snapshot());
  app.use('/api/simulator', (_req, _res, next) => {
    if (!enabled) return next(Object.assign(new Error('Simulation is disabled.'), { status: 403 }));
    next();
  });
  app.get('/api/simulator/cart', (_req, res) => res.json(snapshot()));
  app.post('/api/simulator/:action', (req, res) => {
    if (req.body.session !== cart.data.session) fail('Demo session changed. Reload the simulator.', 409);
    const numeric = (value, min, max) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('Invalid simulator setting or weight.', 400);
      return value;
    };
    const result = cart.change(() => {
      switch (req.params.action) {
        case 'scan':
          if (typeof req.body.event !== 'string' || !/^[\w.-]{1,100}$/.test(req.body.event)) fail('Invalid event ID.', 400);
          return cart.scan(req.body.uid, req.body.event, 'simulation');
        case 'weight': return cart.simulate(numeric(req.body.grams, -25, 6000));
        case 'sample': return cart.read(numeric(req.body.grams, -25, 6000));
        case 'remove': return cart.remove(numeric(req.body.lineId, 1, Number.MAX_SAFE_INTEGER));
        case 'cancel': return cart.cancel();
        case 'checkout': return cart.checkout();
        case 'reset': return cart.newSession(true);
        case 'connection':
          if (typeof req.body.online !== 'boolean') fail('Invalid connection state.', 400);
          return cart.connection(req.body.online);
        case 'settings':
          if (cart.data.pending) fail('Finish the pending action before changing settings.');
          cart.data.tolerance = numeric(req.body.tolerance, 5, 30);
          cart.data.sampleCount = numeric(req.body.sampleCount, 2, 20);
          if (!Number.isInteger(cart.data.sampleCount)) fail('Sample count must be an integer.', 400);
          cart.data.stableSpan = numeric(req.body.stableSpan, 0, 20);
          cart.samples = [];
          cart.data.stable = null;
          return;
        default: fail('Unknown simulator action.', 404);
      }
    });
    publish();
    res.status(result?.error ? result.status : 200).json({ cart: snapshot(), result, ...(result?.error ? { error: result.error } : {}) });
  });
  io.on('connection', socket => { if (enabled) socket.emit('simulator:cart', snapshot()); });
  const timer = setInterval(() => {
    try { if (enabled && cart.tick()) publish(); }
    catch (error) { console.error('Simulator tick failed:', error); }
  }, 250);
  timer.unref();
  return { cart, close() { clearInterval(timer); if (owned) store.close(); } };
}
