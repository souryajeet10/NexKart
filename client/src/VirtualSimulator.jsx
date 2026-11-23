import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Radio, ShoppingCart, Scale, Bell, Package, Wifi, FlaskConical, Check } from 'lucide-react';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
export const lcdLine = text => String(text).replace(/[^ -~]/g, '?').slice(0, 16).padEnd(16, ' ');
const eventId = () => globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2);

export default function VirtualSimulator({ products }) {
  const [cart, setCart] = useState(null);
  const [hardware, setHardware] = useState(null);
  const [mode, setMode] = useState('simulation');
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [lcdNotice, setLcdNotice] = useState('');
  const [notice, setNotice] = useState('Choose Start Demo for a guided walkthrough.');
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState('0');
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(false);
  const [step, setStep] = useState(-1);
  const [settings, setSettings] = useState({ tolerance: 10, sampleCount: 5, stableSpan: 4 });
  const audio = useRef(null);
  useEffect(() => { if (!lcdNotice) return; const timer = setTimeout(() => setLcdNotice(''), 2200); return () => clearTimeout(timer); }, [lcdNotice]);
  const lock = useRef(false);
  const runId = useRef(null);
  const lastScan = useRef(null);
  function accept(next) {
    if (runId.current && next.runId !== runId.current) return;
    setCart(old => old?.runId === next.runId && old.revision > next.revision ? old : next);
  }
  useEffect(() => {
    let active = true;
    const socket = io();
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('simulator:cart', next => { runId.current = next.runId; accept(next); });
    socket.on('cart', setHardware);
    fetch('/api/simulator/cart').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (active) { runId.current ??= data.runId; accept(data); setSettings({ tolerance: data.tolerance, sampleCount: data.sampleCount ?? 5, stableSpan: data.stableSpan ?? 4 }); }
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; socket.disconnect(); };
  }, []);
  const alarm = mode === 'simulation' && live && cart?.connected && Boolean(cart?.alert);
  useEffect(() => {
    // One quiet, short tone on alarm transition; never a repeating siren.
    const context = audio.current;
    if (!sound || !alarm || context?.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    return () => { try { oscillator.stop(); } catch {} };
  }, [alarm, sound]);
  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);
  async function toggleSound() {
    if (sound) { setSound(false); return; }
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Browser audio is unavailable. Visual buzzer remains active.');
      audio.current ??= new Context();
      await audio.current.resume();
      setSound(audio.current.state === 'running');
    } catch (err) { setError(err.message); }
  }
  async function send(action, body = {}, session = cart.session.id) {
    const response = await fetch('/api/simulator/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, session }) });
    const data = await response.json();
    if (data.cart) accept(data.cart);
    if (!response.ok) { if (action === 'scan') setLcdNotice(response.status === 404 ? 'Unknown RFID' : 'Scan rejected'); throw new Error(data.error || 'Simulator request failed.'); }
    return data;
  }
  async function run(fn, message) {
    if (lock.current || mode !== 'simulation' || !live) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await fn(); if (message) setNotice(message); return result; }
    catch (err) { setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const scan = product => {
    const event = { uid: product.uid, event: eventId() };
    lastScan.current = event;
    return send('scan', event);
  };
  const target = cart?.pending ? cart.pending.baseline + (cart.pending.cancelled ? 0 : cart.pending.delta) : cart?.expected ?? 0;
  const blocked = busy || !live || !cart?.connected || mode !== 'simulation';
  const scanBlocked = blocked || !cart?.sensorReady || cart.pending || cart.alert || cart.session.status !== 'OPEN';
  const apply = value => run(() => send('weight', { grams: value }), 'Settled tray reading sent to the backend.');
  const filtered = products.filter(p => (p.name + ' ' + p.uid + ' ' + p.category).toLowerCase().includes(query.toLowerCase()));
  const steps = ['Scan a product', 'Place it on the tray', 'Add unexpected weight', 'Restore and verify', 'Complete demo checkout'];
  async function start() {
    await run(async () => {
      const fresh = await send('reset');
      await send('connection', { online: true }, fresh.cart.session.id);
      lastScan.current = null; setStep(0); setReading('0');
    }, 'Demo started. Follow the highlighted step below.');
  }
  async function next() {
    await run(async () => {
      if (step === 0) { if (!products.length) throw new Error('Add a product under Products first.'); await scan(products[0]); }
      if (step === 1 || step === 3) await send('weight', { grams: target });
      if (step === 2) await send('weight', { grams: Math.min(6000, target + 100) });
      if (step === 4) await send('checkout');
      setStep(step + 1);
      setNotice(step === 4 ? 'Demo complete. The verified bill is saved in the separate demo database.' : 'Step complete. Continue when you are ready.');
    });
  }
  const display = mode === 'hardware' ? hardware : cart;
  const latest = display?.activity?.[0];
  const lcdTop = mode === 'simulation' && lcdNotice ? lcdNotice : !live ? 'Server offline' : !display?.connected ? 'Device offline' : display.alert ? 'Weight Mismatch' : display.pending?.item.name ?? (display.sensorReady ? display.items.length ? 'Weight Verified' : 'Scan Product' : 'Scale settling');
  const lcdBottom = display?.pending ? 'Price Rs.' + (display.pending.item.price / 100).toFixed(2) : 'Total Rs.' + ((display?.subtotal ?? 0) / 100).toFixed(2);
  const grouped = new Map();
  for (const item of display?.items ?? []) {
    const key = JSON.stringify([item.id, item.price, item.grams, item.name]);
    if (!grouped.has(key)) grouped.set(key, { ...item, quantity: 0 });
    grouped.get(key).quantity++;
  }
  return <div className="virtual-simulator">
    <div className="intro"><div><div className="eyebrow"><FlaskConical size={16}/> VIRTUAL LAB</div><h1>SmartCart Simulator</h1><p>A complete shopping journey, with no electronics required.</p></div><label>Active feed<select value={mode} disabled={busy} onChange={e => { setMode(e.target.value); setSound(false); }}><option value="simulation">Virtual Simulator</option><option value="hardware">Real ESP32 Hardware</option></select></label></div>
    <div className="sim-mode-banner"><strong>{mode === 'simulation' ? 'VIRTUAL-01 · Simulation Mode' : 'SC-01 · Hardware feed'}</strong><span>{mode === 'simulation' ? 'Separate demo basket and receipts. Real carts stay untouched.' : hardware?.mode === 'hardware' ? 'Read-only hardware view. Manage the physical cart in Overview.' : 'Main cart is in legacy Simulation Mode. Select Hardware Mode in Overview to receive ESP32 data.'}</span></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {mode === 'simulation' && <>
      <p role="status" className="hint">{notice}</p>
      <div className="button-row sim-toolbar"><button className="button primary" disabled={busy || !live || !cart} onClick={start}>Start Demo</button><button className="button" disabled={busy || !live || !cart} onClick={() => run(async () => { await send('reset'); setStep(-1); setReading('0'); lastScan.current = null; }, 'Demo basket reset. Hardware cart unchanged.')}>Reset Demo</button><button className="button" disabled={blocked || !cart?.ready} onClick={() => run(() => send('checkout'), 'Demo checkout complete. No payment collected.')}>Demo checkout</button></div>
      {step >= 0 && <section className="panel sim-guide"><h2>Presentation walkthrough</h2><ol>{steps.map((text, i) => <li key={text} aria-current={step === i ? 'step' : undefined} className={step === i ? 'current' : step > i ? 'done' : ''}>{step > i && <Check size={14}/>} {text}</li>)}</ol>{step < 5 ? <button className="button primary" disabled={blocked} onClick={next}>{steps[step]}</button> : <p>All five steps complete. Start again or explore the controls below.</p>}</section>}
    </>}
    {!display ? <p>Waiting for the selected cart feed…</p> : <>
      <div className="sim-instruments">
        <section className="panel"><div className="section-title"><Radio/><h2>Virtual 16 × 2 LCD</h2></div><div className="virtual-lcd" role="status" aria-label="LCD display"><pre>{lcdLine(lcdTop)}{'\n'}{lcdLine(lcdBottom)}</pre></div><p className="hint"><Wifi size={14}/> {display.connected ? 'Device connected' : 'Device disconnected'} · {live ? 'Live backend sync' : 'Reconnecting to backend'}</p></section>
        <section className="panel"><div className="section-title"><Bell/><h2>Buzzer</h2></div><div className={'virtual-buzzer ' + (display.alert && display.connected ? 'sounding' : '')}><Bell size={32}/><strong>{display.alert && display.connected ? 'ON' : 'OFF'}</strong></div><p>{display.alert ? display.alert.message : 'Silent while weight is verified.'}</p><button className="button" disabled={mode !== 'simulation'} onClick={toggleSound}>{sound ? 'Mute sound' : 'Enable simulator sound'}</button><p className="hint">One quiet beep per alert. Muted by default.</p></section>
      </div>
      <div className="sim-workspace">
        <section className="panel"><div className="section-title"><ShoppingCart/><h2>{mode === 'simulation' ? 'Virtual shopping cart' : 'Hardware cart'}</h2><span className="chip">{display.items.length} units</span></div><div className="virtual-basket"><ShoppingCart size={70}/><span>{display.items.length ? display.items.length + ' verified items in your trolley' : 'Your trolley is ready'}</span></div>
          {display.pending && <div className="pending" role="status"><div><small>{display.pending.cancelled ? 'RESTORE WEIGHT' : 'AWAITING ' + (display.pending.operation === 'add' ? 'PLACEMENT' : 'REMOVAL')}</small><strong>{display.pending.item.name}</strong><span>{money(display.pending.item.price)} · {display.pending.item.grams} g</span></div>{mode === 'simulation' && <button className="button" disabled={blocked || display.pending.cancelled} onClick={() => run(() => send('cancel'))}>Cancel</button>}</div>}
          {[...grouped.values()].map(item => <div className="sim-cart-row" key={item.lineId}><Package/><div><strong>{item.name}</strong><small>Qty {item.quantity} · {money(item.price)} each · {item.grams} g each</small></div><strong>{money(item.price * item.quantity)}</strong>{mode === 'simulation' && <button className="button" aria-label={'Remove one ' + item.name} disabled={Boolean(scanBlocked)} onClick={() => run(() => send('remove', { lineId: item.lineId }), 'Remove this item from the virtual tray using Verify Weight.')}>Remove</button>}</div>)}
          <div className="bill"><div><small>VERIFIED TOTAL</small><strong>{money(display.subtotal)}</strong></div><span>{display.session.status === 'PAID' ? 'Demo paid' : display.ready ? 'Ready for checkout' : 'Verification required'}</span></div>
        </section>
        <section className="panel"><div className="section-title"><Scale/><h2>Load-cell tray</h2></div><div className={'virtual-tray ' + (display.alert ? 'mismatch' : '')}><Package size={34}/><strong>{display.actual == null ? '—' : Math.round(display.actual)} g</strong><span>{display.sensorReady ? 'Stable reading' : 'Waiting for stable samples'}</span></div><p>Expected: <strong>{display.targetWeight ?? display.expected} g</strong> · tolerance ±{display.tolerance} g</p>
          {mode === 'simulation' && <><form className="weight-form" onSubmit={e => { e.preventDefault(); apply(Number(reading)); }}><label>Measured weight (g)<input type="number" min="-25" max="6000" step="any" value={reading} onChange={e => setReading(e.target.value)} required/></label><button className="button" disabled={blocked}>Apply settled weight</button></form><input aria-label="Adjust tray weight" type="range" min="0" max="6000" value={Math.max(0, Number(reading) || 0)} onChange={e => setReading(e.target.value)}/>
          <div className="sim-actions"><button className="button primary" disabled={blocked} onClick={() => apply(target)}>Verify Weight / Place item</button><button className="button" disabled={blocked} onClick={() => apply(Math.min(6000, target + 100))}>Extra weight / Mismatch</button><button className="button" disabled={blocked} onClick={() => apply(Math.max(0, target - 100))}>Missing weight</button><button className="button" disabled={blocked} onClick={() => apply(0)}>Reset tray to 0 g</button><button className="button" disabled={blocked || reading === ''} onClick={() => run(() => send('sample', { grams: Number(reading) }), 'One sample sent. Repeat until stable, or vary readings to model noise.')}>Send one raw sample</button></div>
          <details><summary>Stability and tolerance settings</summary><form className="sim-settings" onSubmit={e => { e.preventDefault(); run(() => send('settings', settings), 'Settings saved. Send a new settled weight.'); }}>{[['tolerance', 'Tolerance (g)', 5, 30], ['sampleCount', 'Stable samples', 2, 20], ['stableSpan', 'Maximum sample spread (g)', 0, 20]].map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} required value={settings[key]} onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })}/></label>)}<button className="button" disabled={blocked || Boolean(cart.pending)}>Save demo settings</button></form></details></>}
        </section>
      </div>
      {mode === 'simulation' && <section className="panel"><div className="section-title"><Radio/><div><h2>Virtual RFID scanner</h2><p>Choose a product, scan its tag, then place it on the tray.</p></div></div><label>Search products<input type="search" placeholder="Name, category or RFID UID" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="sim-products">{filtered.map(product => <article className="sim-product" key={product.id}><div className="sim-product-art">{product.image ? <img src={product.image} alt="" loading="lazy"/> : <Package size={32}/>}</div><span className="chip">{product.category}</span><h3>{product.name}</h3><p>{money(product.price)} · {product.grams} g</p><code>{product.uid}</code><button className="button primary" disabled={Boolean(scanBlocked)} onClick={() => run(() => scan(product), product.name + ' scanned. Place it on the tray to verify.')}><Radio size={16}/> Scan RFID</button></article>)}</div>{!filtered.length && <p>No matching products. Add products in the existing Products tab.</p>}<div className="button-row sim-toolbar"><button className="button" disabled={Boolean(scanBlocked || !products.length)} onClick={() => run(() => scan(products[0]), 'Simulated scan sent.')}>Simulate Scan</button><button className="button" disabled={blocked || !lastScan.current} onClick={() => run(() => send('scan', lastScan.current), 'Replayed the same event. No duplicate item was added.')}>Replay last scan</button><button className="button" disabled={blocked} onClick={() => run(() => send('scan', { uid: Array.from({ length: products.length + 1 }, (_, i) => i.toString(16).padStart(8, '0').toUpperCase()).find(uid => !products.some(p => p.uid === uid)), event: eventId() }))}>Scan unknown tag</button><button className="button" disabled={busy || !live} onClick={() => run(() => send('connection', { online: !cart.connected }))}>{cart.connected ? 'Disconnect virtual ESP32' : 'Reconnect virtual ESP32'}</button></div></section>}
      <section className="panel"><div className="section-title"><Check/><h2>Live activity · {mode === 'simulation' ? 'virtual events' : 'cart events'}</h2></div><p role="status">{latest?.message}</p><ol className="sim-log">{display.activity.slice(0, 8).map(entry => <li key={entry.id}><time>{new Date(entry.time).toLocaleTimeString()}</time> {entry.message}</li>)}</ol></section>
    </>}
  </div>;
}
