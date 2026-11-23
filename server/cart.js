export const CAPACITY = 5000;
const STALE_MS = 2500;
const ACTION_MS = 30000;
const STABLE_SPAN = 4;
const SAMPLE_COUNT = 5;
const nowIso = (ms) => new Date(ms).toISOString();
export const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

export function normalizeUid(value) {
  if (typeof value !== 'string') fail('Enter a hexadecimal RFID UID.', 400);
  const uid = value.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^(?:[A-F0-9]{8}|[A-F0-9]{14}|[A-F0-9]{20})$/.test(uid)) fail('Use a 4-, 7-, or 10-byte hexadecimal RFID UID.', 400);
  return uid;
}

export class Cart {
  constructor(store, clock = Date.now, { simulationEnabled = true, deviceId = null, placementMs = 4000, mismatchMs = 1500 } = {}) {
    this.simulationEnabled = simulationEnabled;
    this.deviceId = deviceId;
    this.placementMs = placementMs;
    this.mismatchMs = mismatchMs;
    this.store = store;
    this.clock = clock;
    this.data = store.get('cart') ?? {
      mode: simulationEnabled ? 'simulation' : 'hardware', session: null, tolerance: 10, actual: 0, stable: 0,
      pending: null, alert: null, state: 'IDLE', simOnline: true, beep: 0,
      command: null,
    };
    if (!simulationEnabled && this.data.mode === 'simulation') {
      // Never reinterpret a simulated basket as physically verified stock.
      if (this.data.session !== null) this.sql("UPDATE sessions SET status='RESET', ended=? WHERE id=? AND status='OPEN'").run(this.time, this.data.session);
      Object.assign(this.data, { mode: 'hardware', session: null, pending: null, alert: null, command: null, state: 'IDLE' });
    }
    this.data.mismatchSince = null;
    this.samples = [];
    this.lastWeight = null;
    this.lastDevice = null;
    this.device = null;
    this.recentScan = null;
    this.revision = 0;
    if (this.data.mode === 'hardware') {
      this.data.stable = null;
      this.data.actual = null;
    }
    if (this.data.session === null) this.change(() => this.newSession());
  }

  get sql() { return this.store.sql; }
  get time() { return nowIso(this.clock()); }
  get open() { return this.session().status === 'OPEN'; }
  get connected() {
    return this.data.mode === 'simulation' ? this.data.simOnline :
      this.lastDevice !== null && this.clock() - this.lastDevice <= STALE_MS;
  }
  get sensorReady() {
    return this.connected && !this.data.command && this.data.stable !== null &&
      (this.data.mode === 'simulation' || (this.lastWeight !== null && this.clock() - this.lastWeight <= STALE_MS));
  }
  get items() {
    return this.sql('SELECT id,product FROM session_items WHERE session = ? AND removed = 0 ORDER BY id')
      .all(this.data.session).map((row) => ({ ...JSON.parse(row.product), lineId: row.id }));
  }
  get expected() { return this.items.reduce((sum, item) => sum + item.grams, 0); }
  get balanced() { return this.sensorReady && Math.abs(this.data.stable - this.expected) <= this.data.tolerance; }
  get ready() { return this.open && this.items.length > 0 && this.balanced && !this.data.pending && !this.data.alert; }
  session() { return this.sql('SELECT id,started,ended,status FROM sessions WHERE id = ?').get(this.data.session); }

  change(fn) {
    const saved = structuredClone(this.data);
    const runtime = [this.samples.slice(), this.lastWeight, this.lastDevice, this.device, this.recentScan];
    try {
      const result = this.store.transaction(() => {
        const result = fn();
        this.store.set('cart', this.data);
        return result;
      });
      this.revision++;
      return result;
    } catch (error) {
      this.data = saved;
      [this.samples, this.lastWeight, this.lastDevice, this.device, this.recentScan] = runtime;
      throw error;
    }
  }

  log(kind, message) {
    this.sql('INSERT INTO activity(session,time,kind,message) VALUES (?,?,?,?)').run(this.data.session, this.time, kind, message);
  }

  view() {
    const items = this.items;
    return {
      ...this.data, simulationEnabled: this.simulationEnabled, targetWeight: this.expected + (this.data.pending && !this.data.pending.cancelled ? this.data.pending.delta : 0), cartId: 'SC-01', session: this.session(), items, expected: this.expected,
      subtotal: items.reduce((sum, item) => sum + item.price, 0), connected: this.connected, commissioning: Boolean(this.connected && this.device?.setupScale),
      sensorReady: this.sensorReady, ready: this.ready, capacity: CAPACITY, revision: this.revision,
      activity: this.sql('SELECT id,time,kind,message FROM activity WHERE session = ? ORDER BY id DESC LIMIT 32').all(this.data.session),
    };
  }

  newSession(reset = false) {
    const { mode, pending, alert } = this.data;
    if (this.data.session !== null) {
      if (reset && mode !== 'simulation') fail('Simulator reset is available in Simulation Mode.');
      if (!reset && mode === 'hardware' && (!this.sensorReady || Math.abs(this.data.stable) > this.data.tolerance || (this.open && (pending || alert || this.items.length)))) {
        fail('Clear the cart safely and wait for a stable empty scale before starting a session.');
      }
      if (!reset && this.open && (pending || alert || this.items.length)) fail('Finish or reset the current shopping session first.');
      if (this.open) this.sql("UPDATE sessions SET status = 'RESET', ended = ? WHERE id = ?").run(this.time, this.data.session);
    }
    const id = Number(this.sql("INSERT INTO sessions(started,status) VALUES (?, 'OPEN')").run(this.time).lastInsertRowid);
    Object.assign(this.data, { session: id, pending: null, alert: null, state: 'IDLE', command: null });
    this.samples = [];
    this.recentScan = null;
    if (mode === 'simulation') Object.assign(this.data, { actual: 0, stable: this.connected ? 0 : null });
    this.log('info', 'Shopping session started.');
  }

  clearState() {
    this.data.alert = null;
    this.data.mismatchSince = null;
    this.data.state = this.open && this.items.length && this.balanced ? 'CHECKOUT_READY' : 'IDLE';
  }

  warn(kind, title, expected, actual, message) {
    if (this.data.alert?.kind !== kind || this.data.alert?.title !== title) {
      this.log('alert', message);
      this.sql('INSERT INTO alerts(session,time,kind,message) VALUES (?,?,?,?)').run(this.data.session, this.time, kind, message);
    }
    this.data.alert = { kind, title, expected, actual, message };
    this.data.state = kind === 'mismatch' ? 'WEIGHT_MISMATCH' : 'UNEXPECTED_WEIGHT';
  }

  requireAction() {
    if (!this.open) fail('Start a new session before shopping.');
    if (this.data.pending) fail('Finish or cancel the pending action first.');
    if (this.data.alert || !this.balanced) fail('Restore the verified weight and wait for a stable reading.');
  }

  scan(rawUid, event, source) {
    const uid = normalizeUid(rawUid);
    const key = source + ':' + event;
    const replay = this.sql('SELECT response FROM scans WHERE event = ?').get(key);
    if (replay) return { ...(replay.response ? JSON.parse(replay.response) : {}), duplicate: true };
    const product = this.sql('SELECT * FROM products WHERE uid = ?').get(uid);
    let error;
    let duplicate = false;
    if (source === 'hardware' && this.recentScan?.uid === uid && this.clock() - this.recentScan.time < 2200) {
      duplicate = true;
    } else if (!product) {
      error = 'Unknown RFID tag ' + uid + '. Register it under Products.';
    } else {
      try {
        this.requireAction();
        if (this.expected + product.grams > CAPACITY) fail('This product would exceed the 5 kg scale capacity.');
      } catch (err) { error = err.message; }
    }
    this.sql('INSERT INTO scans(event,session,uid,time,result) VALUES (?,?,?,?,?)').run(key, this.data.session, uid, this.time, duplicate ? 'DUPLICATE' : error ? 'REJECTED' : 'ACCEPTED');
    const save = (response) => {
      this.sql('UPDATE scans SET response=? WHERE event=?').run(JSON.stringify(response), key);
      return response;
    };
    if (duplicate) return save({ duplicate: true });
    if (source === 'hardware') this.recentScan = { uid, time: this.clock() };
    if (error) {
      this.log('alert', error);
      return save({ error, status: product ? 409 : 404 });
    }
    this.log('scan', 'RFID ' + uid + ' · ' + product.name + ' · ₹' + (product.price / 100).toFixed(2));
    this.begin('add', product, product.grams);
    return save({ accepted: true, product });
  }

  begin(operation, item, delta) {
    this.samples = [];
    this.data.mismatchSince = null;
    this.data.pending = { operation, item, delta, baseline: this.data.stable, since: this.clock(), cancelled: false, moved: false };
    this.data.state = operation === 'add' ? 'AWAITING_WEIGHT' : 'AWAITING_REMOVAL';
    this.log('info', (operation === 'add' ? 'Place ' : 'Remove ') + item.name + ' on the scale to verify.');
  }

  remove(lineId) {
    this.requireAction();
    const item = this.items.find((row) => row.lineId === lineId);
    if (!item) fail('Verified item not found.', 404);
    this.begin('remove', item, -item.grams);
  }

  cancel(reason = 'Action cancelled') {
    const pending = this.data.pending;
    if (!pending) fail('There is no pending action.');
    if (pending.cancelled) return;
    pending.cancelled = true;
    pending.reason = reason;
    this.log('info', reason + '. Restore the original scale weight.');
    if (this.sensorReady && Math.abs(this.data.stable - pending.baseline) <= STABLE_SPAN) {
      this.data.pending = null;
      this.evaluate();
    } else {
      this.warn('mismatch', 'RESTORE ORIGINAL WEIGHT', 0, this.data.actual === null ? null : Math.round(this.data.actual - pending.baseline), 'Restore the original scale weight to clear the cancelled action.');
    }
  }

  loseWeight() {
    if (this.lastWeight !== null) this.log('alert', 'Scale readings stopped. Check calibration or the HX711 connection.');
    this.lastWeight = null;
    this.samples = [];
    this.data.stable = null;
    this.data.actual = null;
    if (!this.data.pending && !this.data.alert) this.clearState();
  }

  read(grams) {
    if (!this.connected) fail('Connect the sensor before sending readings.');
    this.lastWeight = this.clock();
    this.data.actual = grams;
    if (grams > CAPACITY || grams < -25) {
      this.samples = [];
      this.data.stable = null;
      this.warn('capacity', 'SCALE OUT OF RANGE', CAPACITY, grams, 'Return the scale to its operating range.');
      return;
    }
    this.samples.push(grams);
    if (this.samples.length > (this.data.sampleCount ?? SAMPLE_COUNT)) this.samples.shift();
    const stable = this.samples.length === (this.data.sampleCount ?? SAMPLE_COUNT) && Math.max(...this.samples) - Math.min(...this.samples) <= (this.data.stableSpan ?? STABLE_SPAN);
    this.data.stable = stable ? this.samples.reduce((sum, value) => sum + value, 0) / (this.data.sampleCount ?? SAMPLE_COUNT) : null;
    const pending = this.data.pending;
    if (pending && Math.abs(grams - pending.baseline) > STABLE_SPAN) {
      pending.moved = true;
      if (!this.data.alert) this.data.state = 'VERIFYING';
    }
    if (!stable) this.data.mismatchSince = null;
    if (stable && !this.data.command) this.evaluate();
    else if (!pending && !this.data.alert) this.clearState();
  }

  record(pending, change, result) {
    this.sql('INSERT INTO verification_events(session,time,operation,expected,actual,result) VALUES (?,?,?,?,?,?)')
      .run(this.data.session, this.time, pending.operation, pending.delta, change, result);
  }

  persistentMismatch() {
    if (this.data.mode === 'simulation') return true;
    if (this.data.pending && this.clock() - this.data.pending.since < this.placementMs) return false;
    this.data.mismatchSince ??= this.clock();
    return this.clock() - this.data.mismatchSince >= this.mismatchMs;
  }

  evaluate() {
    if (!this.sensorReady) return;
    const { pending, stable, tolerance } = this.data;
    if (!pending) {
      if (!this.open) { this.clearState(); return; }
      if (Math.abs(stable - this.expected) > tolerance) {
        if (!this.persistentMismatch()) return;
        this.warn('unexpected', 'UNEXPECTED WEIGHT', this.expected, Math.round(stable), 'Unexplained weight change. Restore the verified cart weight.');
      } else if (this.data.alert || this.data.state !== 'VERIFIED') {
        this.clearState();
      }
      return;
    }

    const delta = stable - pending.baseline;
    if (pending.cancelled) {
      if (Math.abs(delta) <= STABLE_SPAN) {
        this.data.pending = null;
        this.clearState();
        this.log('info', 'Original weight restored. Action cleared.');
        this.evaluate();
      } else {
        this.warn('mismatch', 'RESTORE ORIGINAL WEIGHT', 0, Math.round(delta), 'Restore the original scale weight to clear the cancelled action.');
      }
      return;
    }

    if (Math.abs(delta) <= STABLE_SPAN) {
      this.data.mismatchSince = null;
      this.data.alert = null;
      this.data.state = pending.operation === 'add' ? 'AWAITING_WEIGHT' : 'AWAITING_REMOVAL';
      return;
    }
    const expectedTotal = this.expected + pending.delta;
    const matched = Math.sign(delta) === Math.sign(pending.delta) &&
      Math.abs(delta - pending.delta) <= tolerance &&
      Math.abs(stable - expectedTotal) <= tolerance;
    if (!matched) {
      if (!this.persistentMismatch()) return;
      if (this.data.alert?.kind !== 'mismatch') this.record(pending, delta, 'MISMATCH');
      this.warn('mismatch', 'WEIGHT MISMATCH', pending.delta, Math.round(delta), 'Adjust the weight to verify ' + pending.item.name + '.');
      return;
    }
    if (pending.operation === 'add') {
      this.sql('INSERT INTO session_items(session,product) VALUES (?,?)').run(this.data.session, JSON.stringify(pending.item));
    } else {
      this.sql('UPDATE session_items SET removed = 1 WHERE id = ?').run(pending.item.lineId);
    }
    this.data.mismatchSince = null;
    this.record(pending, delta, 'VERIFIED');
    this.data.pending = null;
    this.data.alert = null;
    this.data.state = 'VERIFIED';
    this.data.verifiedAt = this.clock();
    this.data.beep++;
    this.log('success', pending.item.name + (pending.operation === 'add' ? ' added' : ' removed') + ' · verified ' + Math.round(delta) + ' g.');
  }

  simulate(grams) {
    if (!this.simulationEnabled) fail('Simulation is disabled.', 403);
    if (this.data.mode !== 'simulation') fail('Switch to Simulation Mode first.');
    if (!this.connected) fail('Connect the simulated ESP32 first.');
    this.samples = [];
    for (let sample = 0; sample < (this.data.sampleCount ?? SAMPLE_COUNT); sample++) this.read(grams);
  }

  switchMode(mode) {
    if (mode === 'simulation' && !this.simulationEnabled) fail('Simulation is disabled.', 403);
    if (mode === this.data.mode) return;
    if (this.items.length || this.data.pending || this.data.alert || (this.data.actual !== null && Math.abs(this.data.actual) > this.data.tolerance)) {
      fail('Use an empty, clear shopping session before changing operating mode.');
    }
    Object.assign(this.data, { mode, stable: null, actual: null, command: null });
    this.samples = [];
    this.lastDevice = null;
    this.lastWeight = null;
    this.device = null;
    this.recentScan = null;
    if (mode === 'simulation') Object.assign(this.data, { actual: 0, stable: this.connected ? 0 : null });
    this.log('info', mode === 'simulation' ? 'Simulation Mode enabled.' : 'Hardware Mode enabled. Waiting for ESP32.');
  }

  connection(online) {
    if (this.data.mode !== 'simulation') fail('The ESP32 reports its own connection in Hardware Mode.');
    if (this.data.simOnline === online) return;
    this.data.simOnline = online;
    this.data.stable = null;
    this.samples = [];
    this.log('info', online ? 'Simulated ESP32 connected.' : 'Simulated ESP32 disconnected.');
    if (online) this.simulate(this.data.actual ?? 0);
    else if (!this.data.pending && !this.data.alert) this.clearState();
  }

  checkout() {
    if (!this.ready) fail('Checkout requires verified items and a stable, balanced cart without pending actions.');
    const { items, subtotal, expected, cartId, session } = this.view();
    const receipt = { items, subtotal, expected, cartId, session: { ...session, status: 'PAID', ended: this.time } };
    this.sql("UPDATE sessions SET status = 'PAID', ended = ?, receipt = ? WHERE id = ?").run(this.time, JSON.stringify(receipt), session.id);
    this.data.state = 'IDLE';
    this.log('success', 'Checkout completed. Receipt #' + session.id + ' saved.');
    return receipt;
  }

  tick() {
    const expired = this.data.pending && !this.data.pending.cancelled && this.clock() - this.data.pending.since >= ACTION_MS;
    const offline = this.lastDevice !== null && !this.connected;
    const stale = this.data.mode === 'hardware' && this.lastWeight !== null && this.clock() - this.lastWeight > STALE_MS;
    const verified = this.data.state === 'VERIFIED' && this.clock() - this.data.verifiedAt > 750;
    if (expired || offline || stale || verified) this.change(() => {
      if (offline || stale) {
        this.data.stable = null;
        this.samples = [];
        this.lastWeight = null;
        this.data.actual = null;
        if (!this.data.pending && !this.data.alert) this.clearState();
        if (offline) {
          this.lastDevice = null;
          this.log('alert', 'ESP32 disconnected.');
        } else {
          this.log('alert', 'Scale readings stopped. Check the HX711 connection.');
        }
      }
      if (expired) this.cancel('Verification timed out');
      if (verified && !this.data.pending && !this.data.alert) this.clearState();
    });
    return Boolean(expired || offline || stale || verified);
  }

  acceptDevice(id, boot, setupScale) {
    if (this.data.mode !== 'hardware') fail('Select Hardware Mode on the dashboard.');
    const bound = this.deviceId || this.store.get('boundDevice');
    if (bound && bound !== id) fail('Device is not assigned to this cart.', 403);
    if (!bound) this.store.set('boundDevice', id);
    if (this.connected && this.device?.id !== id) fail('A different device is already connected.');
    if (!this.connected || this.device?.boot !== boot) {
      this.log('info', 'ESP32 connected · ' + id);
      this.data.stable = null;
      this.samples = [];
      this.lastWeight = null;
      this.recentScan = null;
    }
    this.device = { id, boot, setupScale };
    this.lastDevice = this.clock();
  }

  control(kind, value, id) {
    const commissioning = this.data.mode === 'hardware' && this.connected && this.device?.setupScale && !this.data.command;
    if (this.data.pending || this.items.length || this.data.alert || (!commissioning && !this.sensorReady) ||
      (!commissioning && Math.abs(this.data.stable) > (kind === 'tare' ? this.data.tolerance : STABLE_SPAN))) {
      fail('Calibration and tare require an empty, stable scale with no pending action.');
    }
    if (this.data.mode === 'simulation') {
      if (kind === 'tare') this.simulate(0);
      else this.data.simCalibration = value;
      this.log('info', kind === 'tare' ? 'Simulated scale tared.' : 'Simulated calibration factor saved.');
    } else {
      this.data.command = { kind, value, id };
      this.data.stable = null;
      this.samples = [];
      this.log('info', 'Requested ESP32 ' + kind + '.');
    }
  }
}
