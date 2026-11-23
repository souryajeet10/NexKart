import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  Activity, ArrowRight, Barcode, Bell, Check, CircleAlert, ClipboardList,
  FlaskConical, History, LayoutDashboard, Moon, Package, Plus, Printer, Radio, RotateCcw, Scale,
  Settings2, ShoppingCart, Sun, Trash2, Wallet, Wifi, WifiOff, X,
} from 'lucide-react';
import './style.css';
import ConnectCart from './ConnectCart.jsx';

const admin = /^\/admin\/?$/.test(window.location.pathname);
document.title = admin ? 'NexKart · Admin console' : 'NexKart · Customer checkout';

const money = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
const grams = (value) => value == null ? '—' : Math.round(value).toLocaleString('en-IN') + ' g';
const sessionNo = (id) => '#' + String(id).padStart(4, '0');
const date = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const time = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Cart service is unavailable. Please try again shortly.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function group(items) {
  const rows = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.id, item.name, item.price, item.grams]);
    if (!rows.has(key)) rows.set(key, { ...item, quantity: 0 });
    rows.get(key).quantity++;
  }
  return [...rows.values()];
}

function Button({ children, tone = '', ...props }) {
  return <button className={'button ' + tone} {...props}>{children}</button>;
}

function App({ onDisconnect }) {
  const [cart, setCart] = useState(null);
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState('Overview');
  const [dark, setDark] = useState(() => localStorage.getItem('smartcart-theme') === 'dark');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [payment, setPayment] = useState(false);
  const [settings, setSettings] = useState(false);
  const actionLock = useRef(false);
  const runRef = useRef(null);

  function accept(next) {
    if (next.runId !== runRef.current) return;
    setCart((previous) => previous?.runId === next.runId && previous.revision > next.revision ? previous : next);
  }
  async function loadProducts() { setProducts(await api('/products')); }
  useEffect(() => {
    const socket = io();
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('cart', (next) => {
      runRef.current = next.runId;
      accept(next);
    });
    socket.on('products', () => loadProducts().catch((err) => setError(err.message)));
    api('/cart').then((next) => {
      runRef.current ??= next.runId;
      accept(next);
    }).catch((err) => setError(err.message));
    loadProducts().catch((err) => setError(err.message));
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('smartcart-theme', dark ? 'dark' : 'light');
  }, [dark]);

  async function run(fn) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    try { return await fn(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); actionLock.current = false; }
  }
  async function send(path, body = {}) {
    const response = await api(path, 'POST', { ...body, session: cart.session.id });
    accept(response.cart);
    return response;
  }
  const action = (path, body) => run(() => send(path, body));
  const sim = cart?.mode === 'simulation';
  const checkout = () => setPayment(true);
  const confirmCheckout = () => run(async () => {
    const response = await send('/checkout');
    setPayment(false);
    setReceipt(response.result);
  });
  const loadDemo = () => run(async () => {
    if (!sim || cart.items.length || cart.pending || cart.session.status === 'PAID') return;
    const samples = products.filter((item) => ['Lays Classic', 'Cadbury Dairy Milk', 'Amul Taaza'].includes(item.name));
    for (const item of (samples.length ? samples : products.slice(0, 3))) {
      const response = await send('/scan', { uid: item.uid, event: crypto.randomUUID() });
      const pending = response.cart.pending;
      if (!pending) throw new Error('Demo item could not be scanned.');
      await send('/weight', { grams: pending.baseline + pending.delta });
    }
  });
  const openReceipt = (id = cart.session.id) => run(async () => setReceipt(await api('/sessions/' + id + '/receipt')));
  const themeButton = <button className="icon" aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
  const errorNotice = error && <div className="notice" role="alert"><CircleAlert size={18}/><span>{error}</span><button className="icon" aria-label="Dismiss message" onClick={() => setError('')}><X size={16}/></button></div>;
  const receiptDialog = <>
    {receipt && <Receipt receipt={receipt} close={() => setReceipt(null)}/>}
    {payment && <DemoPayment total={cart?.subtotal || 0} busy={busy} ready={live && cart?.ready} error={error} close={() => setPayment(false)} confirm={confirmCheckout}/>}
  </>;

  if (!admin) return <>
    <Customer cart={cart} products={products} action={action} checkout={checkout} openReceipt={openReceipt}
      busy={busy} live={live} themeButton={themeButton} error={error} errorNotice={errorNotice} loadDemo={loadDemo} onDisconnect={onDisconnect}/>
    {receiptDialog}
  </>;

  return <>
    <div className="app">
      <aside className="rail">
        <div className="brand"><img className="brand-logo" src="/nexkart-logo.png?v=27d2da9c" alt=""/><div>NexKart<small>ADMIN CONSOLE</small></div></div>
        <p className="nav-label">ADMIN WORKSPACE</p>
        <nav aria-label="Main navigation">
          {[[LayoutDashboard, 'Overview'], [Package, 'Products'], [History, 'Sessions']].map(([Icon, name]) =>
            <button key={name} className={name === tab ? 'selected' : ''} aria-current={name === tab ? 'page' : undefined} onClick={() => setTab(name)}><Icon size={18}/>{name}</button>)}
        </nav>
        <div className="rail-bottom"><Radio size={17}/><div>Local checkout<small>IoT demo console</small></div></div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">Admin <span>/</span> <strong>{tab}</strong></div>
          <div className="top-controls">
            <span className={'live ' + (live ? '' : 'offline')}><i/>{live ? 'Live sync' : 'Reconnecting'}</span>
            <a className="button" href="/">Customer checkout <ArrowRight size={15}/></a>
            {themeButton}
            <button className="icon" aria-label="Scale and mode settings" onClick={() => setSettings(!settings)}><Settings2 size={18}/></button>
          </div>
        </header>
        <div className="content">
          {errorNotice}
          {!cart && <p>Connecting to NexKart…</p>}
          {cart && settings && <ScaleSettings cart={cart} action={action} busy={busy} close={() => setSettings(false)}/>}
          {cart && tab === 'Overview' && <>
            <div className="intro">
              <div><div className="eyebrow"><span/> CART OPERATIONS</div><h1>Cart operations</h1><p>Scan, weigh, and verify every item in the trolley.</p></div>
              <div className="mode-pill"><FlaskConical size={15}/>{sim ? 'Simulation Mode' : 'Hardware Mode'}</div>
            </div>
            <section className="metrics" aria-label="Cart metrics">
              <Metric icon={ShoppingCart} label="Cart & session" value={cart.cartId} note={'Session ' + sessionNo(cart.session.id) + ' · ' + (cart.session.status === 'PAID' ? 'Checked out' : 'In progress')}/>
              <Metric icon={Wallet} label="Verified subtotal" value={money(cart.subtotal)} note={cart.items.length + ' verified unit' + (cart.items.length === 1 ? '' : 's')} accent/>
              <Metric icon={Scale} label={sim ? 'Simulated weight' : 'Measured weight'} value={grams(cart.actual)} note={'Expected ' + grams(cart.expected) + ' · ±' + cart.tolerance + ' g'}/>
              <Metric icon={cart.connected ? Wifi : WifiOff} label={sim ? 'Simulated ESP32' : 'ESP32 device'} value={cart.connected ? 'Connected' : 'Offline'} note={cart.sensorReady ? 'Stable reading' : 'Waiting for stable weight'}/>
            </section>
            {cart.alert && <div className="weight-alert" role="alert"><Bell size={23}/><div><strong>{cart.alert.title}</strong><p>{cart.alert.message}</p><span>Expected {grams(cart.alert.expected)} <b>·</b> Actual {grams(cart.alert.actual)} {cart.pending ? ' (weight change)' : ''}</span></div><span className="chip red">{cart.connected ? 'Buzzer active' : 'Buzzer offline'}</span></div>}
            {!cart.connected && <div className="notice" role="status"><WifiOff size={18}/>{sim ? 'Simulated ESP32 is disconnected.' : 'Waiting for authenticated ESP32 readings.'} Checkout and weight verification are paused.</div>}
            <div className="dashboard-grid">
              <div className="stack">
                <CartPanel cart={cart} busy={busy} action={action} checkout={checkout} openReceipt={() => openReceipt()}/>
                <ActivityPanel activity={cart.activity}/>
              </div>
              <div className="stack">
                {sim ? <Simulator cart={cart} products={products} send={send} run={run} busy={busy}/> :
                  <section className="panel"><div className="section-title"><span className="glyph"><Radio size={19}/></span><div><h2>Hardware feed</h2><p>Authenticated ESP32 over your local network.</p></div></div>
                    <p className="hardware-copy">{cart.connected ? 'Scan a registered tag on the RC522. Place the product on the scale once it appears in your cart.' : 'Power on the ESP32 and point its firmware at this server to begin.'}</p>
                  </section>}
              </div>
            </div>
          </>}
          {tab === 'Products' && <Products products={products} reload={loadProducts} run={run} busy={busy}/>}
          {tab === 'Sessions' && <Sessions revision={cart ? cart.session.id + '-' + cart.session.status : undefined} openReceipt={openReceipt}/>}
          <footer><span>NEXKART / SC-01</span><span>Local IoT checkout system</span></footer>
        </div>
      </main>
    </div>
    {receiptDialog}
  </>;
}

function Customer({ cart, products, action, checkout, openReceipt, busy, live, themeButton, error, errorNotice, loadDemo, onDisconnect }) {
  const [selected, setSelected] = useState('');
  const [view, setView] = useState('Home');
  const product = products.find((item) => String(item.id) === selected) || products[0];
  const sim = cart?.mode === 'simulation';
  const paid = cart?.session.status === 'PAID';
  const pending = cart?.pending;
  const unavailable = !live || !cart?.connected;
  const scanning = !unavailable && cart?.sensorReady && !pending && !cart?.alert && !paid;
  const target = pending ? pending.baseline + (pending.cancelled ? 0 : pending.delta) : cart?.expected;
  const weight = (value) => value == null ? '—' : value >= 1000 ? (value / 1000).toFixed(2) + ' kg' : grams(value);
  function scan(item = product) {
    if (!item) return;
    const event = crypto.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2);
    return action('/scan', { uid: item.uid, event });
  }
  const catalogue = <div className="product-picker" role="group" aria-label="Choose a demo product">
    {!products.length && <p>No products available.</p>}
    {products.map((item) => <button key={item.id} className={'pick-product ' + (product?.id === item.id ? 'chosen' : '')}
      aria-pressed={product?.id === item.id} disabled={busy || unavailable} onClick={() => setSelected(String(item.id))}>
      <span className="pick-art">{item.image ? <img src={item.image} alt=""/> : <Package size={27}/>}</span>
      <span className="pick-detail"><small>{item.category}</small><strong>{item.name}</strong><span>{money(item.price)} <small>· {grams(item.grams)}</small></span></span>
      <span className="pick-check">{product?.id === item.id ? <Check size={14}/> : <Plus size={14}/>}</span>
    </button>)}
  </div>;
  return <div className="customer">
    <header className="customer-header"><div className="customer-header-inner">
      <a href="/" className="brand"><img className="brand-logo" src="/nexkart-logo.png?v=27d2da9c" alt=""/><div>NexKart<small>Self Checkout</small></div></a>
      <div className="top-controls">{themeButton}</div>
    </div></header>
    <main className="customer-content">
      <div className="cart-connection"><span><ShoppingCart size={16}/> Cart {cart?.cartId || 'SC-01'}</span><button onClick={onDisconnect}>Disconnect</button></div>
      <section className="customer-intro">
        <div className="hero-copy"><span className="session-badge">{cart ? 'SESSION ' + sessionNo(cart.session.id) : 'WELCOME TO NEXKART'}</span>
          <h1>Your Shopping Cart</h1><p>Scan items & place them on the tray<br/>to auto-verify weight.</p>
        </div>
        <div className="hero-cart" aria-hidden="true"><div className="groceries">🥦 🥛</div><ShoppingCart strokeWidth={1.4}/><span className="hero-spark">✦</span></div>
      </section>
      {errorNotice}
      {!cart && <div className="panel" role="status">{error ? 'Unable to connect to NexKart.' : 'Connecting to NexKart…'}</div>}
      {cart && <>
        <div className="shopping-summary" aria-label="Shopping summary">
          {[[Package, 'Items', cart.items.length], [Scale, 'Weight', weight(cart.actual)], [Wallet, 'Total', money(cart.subtotal)]].map(([Icon, label, value]) => <div key={label}><span className="summary-icon"><Icon/></span><span><small>{label}</small><strong>{value}</strong></span></div>)}
        </div>
        {sim && !paid && <div className="demo-banner"><div><strong>Demo shopping</strong><p>Try a sample basket and a simulated payment. No money is charged.</p></div>{!cart.items.length && !pending && <Button tone="primary" disabled={busy || !scanning || !products.length} onClick={loadDemo}><Plus size={17}/> Add demo items</Button>}</div>}
        {unavailable && <div className="notice" role="status"><WifiOff size={20}/> Cart offline. Waiting for a connection to resume shopping.</div>}
        {view === 'History' ? <Sessions revision={cart.session.id + '-' + cart.session.status} openReceipt={openReceipt}/> : view === 'Products' ?
          <section className="panel"><div className="section-title"><Package/><h2>Products</h2><span className="chip push">{products.length} available</span></div>{catalogue}<Button tone="primary full" onClick={() => setView('Home')}>Back to scanning</Button></section> : <>
        <section className="panel scan-panel">
          <div className="section-title"><Barcode/><h2>Scan Product</h2><span className="rfid-pill"><Radio size={18}/> RFID</span></div>
          <div className={'scan-zone ' + (pending ? 'is-pending' : '')} role="status"><Radio size={49}/><h3>{paid ? 'Shopping Complete' : unavailable ? 'Reader Offline' : cart.alert ? 'Check Cart Weight' : pending ? 'Verify Your Item' : !cart.sensorReady ? 'Waiting for Scale' : 'Ready to Scan'}</h3><p>{paid ? 'Thank you for shopping with NexKart.' : pending ? pending.item.name + ' · Place or remove the item as requested below.' : 'Tap the RFID tag on the reader'}</p></div>
          {sim && !paid && <details className="demo-drawer" open={pending || cart.alert ? true : undefined}><summary><FlaskConical size={16}/> Try the demo <span>No physical reader needed</span></summary>
            {pending || cart.alert ? <Button tone="primary full" disabled={busy || unavailable} onClick={() => action('/weight', { grams: target })}><Scale size={18}/>{pending?.cancelled || cart.alert ? 'Correct demo weight' : pending.operation === 'remove' ? 'Remove from demo scale' : 'Place on demo scale'}</Button> : <>{catalogue}<Button tone="primary full" disabled={busy || !scanning || !product} onClick={() => scan()}><Radio size={18}/> Scan selected product</Button></>}
          </details>}
        </section>
        <section className="panel weight-panel">
          <div className="section-title"><Scale/><h2>Weight Verification</h2><span className={'connection-label ' + (unavailable ? 'disconnected' : '')}>{unavailable ? 'Offline' : sim ? 'Demo scale' : 'Live scale'}</span></div>
          <div className="weight-values"><div><span>Expected Weight</span><strong>{weight(target)}</strong></div><div className={cart.alert ? 'mismatch' : ''}><span>Actual Weight</span><strong>{weight(cart.actual)}</strong></div></div>
          <div className={'verification-message ' + (cart.alert ? 'mismatch' : pending || unavailable || !cart.sensorReady ? 'waiting' : 'matched')} role={cart.alert ? 'alert' : 'status'}>
            {cart.alert ? <CircleAlert/> : pending || unavailable || !cart.sensorReady ? <Scale/> : <Check/>}<div><strong>{cart.alert ? cart.alert.title : unavailable ? 'Scale disconnected' : pending ? 'Verification pending' : !cart.sensorReady ? 'Waiting for stable weight' : 'Weight verified'}</strong><p>{cart.alert ? cart.alert.message : pending ? pending.cancelled ? 'Restore the original cart weight.' : pending.operation === 'remove' ? 'Remove the item from the tray.' : 'Place the scanned item on the tray.' : 'Each item is checked for a worry-free checkout.'}</p></div>
          </div>
        </section>
        <section className="panel shopper-cart">
          <div className="section-title"><ShoppingCart/><h2>Cart Items ({cart.items.length})</h2>{sim && !paid && <button className="clear-cart" disabled={busy || unavailable || (!cart.items.length && !pending)} onClick={() => { if (window.confirm('Clear the demo cart and start a new session?')) action('/sim/reset'); }}><Trash2 size={17}/> Clear Cart</button>}</div>
          {pending && <div className="pending"><div><small>{pending.operation === 'remove' ? 'AWAITING REMOVAL' : 'AWAITING VERIFICATION'}</small><strong>{pending.item.name}</strong></div>{!pending.cancelled && <Button disabled={busy || unavailable} onClick={() => action('/cancel')}>Cancel</Button>}</div>}
          {!cart.items.length ? <div className="empty"><span><ShoppingCart size={30}/></span><h3>A fresh start for your cart</h3><p>Scan your first item to add it here.</p></div> : <div className="cart-rows">{group(cart.items).map((item) => <div className="cart-row" key={item.lineId}>
            <span className="item-art">{item.image ? <img src={item.image} alt=""/> : <Package/>}</span><div className="item-info"><strong>{item.name}</strong><small>{grams(item.grams)}</small></div><strong className="item-price">{money(item.price * item.quantity)}</strong>
            <div className="quantity"><button aria-label={'Remove one ' + item.name} disabled={busy || !scanning} onClick={() => action('/remove', { lineId: item.lineId })}>−</button><span>{item.quantity}</span><button aria-label={'Scan another ' + item.name} disabled={busy || !scanning || !sim || !products.some((p) => p.id === item.id)} onClick={() => scan(products.find((p) => p.id === item.id))}>+</button></div><span className="item-verified" aria-label="Verified"><Check size={17}/></span>
          </div>)}</div>}
        </section>
        <section className="panel bill-summary"><div className="section-title"><ClipboardList/><h2>Bill Summary</h2></div><div><span>Items ({cart.items.length})</span><span>{money(cart.subtotal)}</span></div><div><span>Discount</span><span className="discount">− {money(0)}</span></div><div className="payable"><strong>Total Payable</strong><strong>{money(cart.subtotal)}</strong></div></section>
        {paid ? <div className="button-row"><Button tone="primary full" disabled={busy} onClick={() => openReceipt()}>View receipt</Button><Button tone="full" disabled={busy || unavailable} onClick={() => action('/sessions')}>Start new session</Button></div> : <button className="checkout-button" disabled={busy || unavailable || !cart.ready} onClick={checkout}><ShoppingCart/> Proceed to Checkout <ArrowRight/></button>}
        {!paid && !cart.ready && <p className="checkout-hint">{pending || cart.alert ? 'Resolve weight verification to continue.' : 'Checkout unlocks when your items are verified.'}</p>}
        </>}
      </>}
    </main>
    <nav className="shop-nav" aria-label="Shop navigation">{[[LayoutDashboard, 'Home'], [Package, 'Products'], [History, 'History']].map(([Icon, name]) => <button key={name} className={view === name ? 'active' : ''} aria-current={view === name ? 'page' : undefined} onClick={() => setView(name)}><Icon size={24}/><span>{name}</span></button>)}</nav>
  </div>;
}

function Metric({ icon: Icon, label, value, note, accent }) {
  return <article className={'metric ' + (accent ? 'accent' : '')}><span className="glyph"><Icon size={18}/></span>
    <p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}
function CartPanel({ cart, action, busy, checkout, openReceipt, customer }) {
  const paid = cart.session.status === 'PAID';
  const canRemove = !busy && cart.sensorReady && !cart.alert && !cart.pending && !paid;
  return <section className="panel cart-panel">
    <div className="section-title"><span className="glyph"><ShoppingCart size={19}/></span><div><h2>{customer ? 'Your cart' : 'Shopping cart'}</h2><p>Only verified products count toward your bill.</p></div><span className="chip push">{cart.items.length} {cart.items.length === 1 ? 'item' : 'items'}</span></div>
    {cart.pending && <div className="pending" role="status">
      <div><small>{cart.pending.cancelled ? 'RESTORE ORIGINAL WEIGHT' : cart.pending.operation === 'add' ? 'AWAITING WEIGHT VERIFICATION' : 'AWAITING REMOVAL'}</small>
        <strong>{cart.pending.item.name}</strong><span>{money(cart.pending.item.price)} · {grams(cart.pending.delta)} expected change</span></div>
      {!cart.pending.cancelled && <Button disabled={busy} onClick={() => action('/cancel')}>Cancel</Button>}
    </div>}
    {!cart.items.length ? <div className="empty"><span><Barcode size={28}/></span><h3>Your trolley is empty</h3><p>Scan a product and place it on the scale to get started.</p></div> :
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Weight</th><th>Total</th><th/></tr></thead>
        <tbody>{group(cart.items).map((item) => <tr key={item.lineId}>
          <td><div className="product-name">{item.image && <img src={item.image} alt=""/>}<div><strong>{item.name}</strong><small>{money(item.price)} each · <span className="verified">Verified</span></small></div></div></td><td>{item.quantity}</td>
          <td>{grams(item.grams * item.quantity)}</td><td>{money(item.price * item.quantity)}</td>
          <td><button className="icon" disabled={!canRemove} aria-label={'Remove one ' + item.name} onClick={() => action('/remove', { lineId: item.lineId })}><Trash2 size={16}/></button></td>
        </tr>)}</tbody>
      </table></div>}
    <div className="bill">
      <div><small>{customer ? 'YOUR TOTAL' : 'VERIFIED SUBTOTAL'}</small><strong>{money(cart.subtotal)}</strong></div>
      <div className="button-row">
        {paid ? <><Button onClick={openReceipt} disabled={busy}>View receipt</Button><Button tone="primary" onClick={() => action('/sessions')} disabled={busy}>New session <Plus size={16}/></Button></> :
          <Button tone="primary" onClick={checkout} disabled={!cart.ready || busy}>Checkout <ArrowRight size={17}/></Button>}
      </div>
    </div>
    {!cart.ready && !paid && <p className="bill-note">{customer ? 'Checkout is available once your cart has verified items and the scale is clear of alerts.' : 'Checkout unlocks when verified items balance with the stable scale reading.'}</p>}
  </section>;
}
function ActivityPanel({ activity }) {
  const icons = { scan: Barcode, success: Check, alert: CircleAlert, info: Activity };
  return <section className="panel"><div className="section-title"><span className="glyph"><Activity size={19}/></span><div><h2>Live activity</h2><p>RFID, weight verification and connection events.</p></div></div>
    <ol className="activity">{activity.map((entry) => {
      const Icon = icons[entry.kind] || Activity;
      return <li key={entry.id}><span className={'event-icon ' + entry.kind}><Icon size={15}/></span><span>{entry.message}</span><time>{time(entry.time)}</time></li>;
    })}</ol>
  </section>;
}

function Simulator({ cart, products, send, run, busy }) {
  const [selected, select] = useState('');
  const [value, setValue] = useState('');
  const [sound, setSound] = useState(false);
  const audio = useRef(null);
  const seenBeep = useRef(cart.beep);
  const product = products.find((item) => String(item.id) === selected) || products[0];
  const pending = cart.pending;
  const actual = cart.actual ?? 0;
  const act = (path, data) => run(() => send(path, data));
  const scan = (uid) => send('/scan', { uid, event: crypto.randomUUID?.() ?? String(Date.now()) + '-' + Math.random().toString(36).slice(2) });
  const weight = (grams) => send('/weight', { grams });
  const blocked = busy || !cart.connected;
  const scanBlocked = blocked || !cart.sensorReady || pending || cart.alert || cart.session.status !== 'OPEN';
  const target = pending ? pending.baseline + (pending.cancelled ? 0 : pending.delta) : cart.expected;

  function ping(hz, duration) {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = hz;
    volume.gain.setValueAtTime(0.05, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
  useEffect(() => {
    if (!sound || !cart.alert || !cart.connected) return;
    ping(420, 0.16);
    const timer = setInterval(() => ping(420, 0.16), 700);
    return () => clearInterval(timer);
  }, [sound, Boolean(cart.alert), cart.connected]);
  useEffect(() => {
    if (sound && cart.beep !== seenBeep.current) ping(960, 0.13);
    seenBeep.current = cart.beep;
  }, [cart.beep, sound]);
  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);
  async function toggleSound() {
    if (sound) { setSound(false); return; }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audio.current ??= new Context();
    await audio.current.resume();
    setSound(true);
  }

  function demo(kind) {
    run(async () => {
      if (kind === 'C') return weight(Math.min(5001, Math.round(actual + 150)));
      if (kind === 'D') {
        const item = cart.items.at(-1);
        const response = await send('/remove', { lineId: item.lineId });
        return weight(response.cart.pending.baseline - item.grams);
      }
      const demoProduct = products.find((item) => item.name === (kind === 'A' ? 'Biscuit Packet' : 'Chocolate')) || product;
      const response = await scan(demoProduct.uid);
      const operation = response.cart.pending;
      const correct = operation.baseline + operation.delta;
      return weight(kind === 'A' ? correct : Math.min(5001, correct + 75));
    });
  }

  return <section className="panel simulator">
    <div className="section-title"><span className="glyph"><FlaskConical size={20}/></span><div><h2>Hardware simulator</h2><p>Test the trolley without electronics.</p></div></div>
    <div className="sensor-strip"><div><small>VIRTUAL SCALE</small><strong>{grams(actual)}</strong></div><span className={'chip ' + (cart.alert && cart.connected ? 'red' : '')}><Bell size={13}/>{!cart.connected ? 'Offline' : cart.alert ? 'Beeps active' : 'Standby'}</span></div>
    <label>RFID product<select value={product?.id ?? ''} onChange={(event) => select(event.target.value)}>{products.length === 0 && <option value="">No products registered</option>}{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {grams(item.grams)}</option>)}</select></label>
    <Button tone="primary full" disabled={Boolean(scanBlocked || !product)} onClick={() => run(() => scan(product.uid))}><Barcode size={18}/> Simulate RFID scan</Button>
    <form className="weight-form" onSubmit={(event) => { event.preventDefault(); run(() => weight(Number(value))); }}>
      <label>Scale reading (g)<input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} placeholder={String(Math.round(actual))} required/></label>
      <Button disabled={blocked}>Apply</Button>
    </form>
    <div className="sim-actions">
      <Button disabled={blocked || !pending || pending.operation !== 'add' || pending.cancelled} onClick={() => run(() => weight(target))}>Place correct item</Button>
      <Button disabled={blocked || !pending || pending.cancelled} onClick={() => run(() => weight(Math.min(5001, target + 75)))}>Trigger mismatch</Button>
      <Button disabled={blocked || Boolean(pending) || cart.session.status !== 'OPEN'} onClick={() => demo('C')}>Add unscanned item</Button>
      <Button disabled={blocked || (!pending && !cart.alert)} onClick={() => run(() => weight(target))}>{pending?.operation === 'remove' && !cart.alert ? 'Remove from scale' : 'Correct weight'}</Button>
    </div>
    <div className="demo">
      <h3>Demo scenarios</h3><p>Run a preset, then use the scale controls to recover from alerts.</p>
      {[
        ['A', 'Successful shopping', scanBlocked || !product],
        ['B', 'Weight mismatch', scanBlocked || !product],
        ['C', 'Unscanned product', blocked || pending || cart.alert || cart.session.status !== 'OPEN'],
        ['D', 'Verified removal', scanBlocked || !cart.items.length],
      ].map(([kind, title, disabled]) => <button key={kind} disabled={Boolean(disabled)} onClick={() => demo(kind)}><b>{kind}</b><span>{title}</span><ArrowRight size={15}/></button>)}
    </div>
    <div className="sim-footer">
      <label><input type="checkbox" checked={sound} onChange={() => run(toggleSound)}/> Alert sound</label>
      <button disabled={busy} onClick={() => act('/sim/connection', { online: !cart.connected })}>{cart.connected ? 'Disconnect' : 'Connect'}</button>
      <button disabled={busy} onClick={() => { if (confirm('Reset the virtual trolley and start a new session?')) act('/sim/reset'); }}><RotateCcw size={14}/> Reset</button>
    </div>
  </section>;
}

function ScaleSettings({ cart, action, busy, close }) {
  const [tolerance, setTolerance] = useState(cart.tolerance);
  const [factor, setFactor] = useState('');
  return <section className="panel settings">
    <div className="section-title"><span className="glyph"><Settings2 size={18}/></span><div><h2>Scale and mode</h2><p>Configure the verification tolerance and scale controls.</p></div><button className="icon push" aria-label="Close settings" onClick={close}><X size={17}/></button></div>
    <div className="settings-grid">
      <label>Operating mode<select disabled={busy} value={cart.mode} onChange={(event) => action('/mode', { mode: event.target.value })}><option value="simulation">Simulation Mode</option><option value="hardware">Hardware Mode</option></select></label>
      <form onSubmit={(event) => { event.preventDefault(); action('/settings', { tolerance: Number(tolerance) }); }}><label>Tolerance (g)<input type="number" min="5" max="30" required value={tolerance} onChange={(event) => setTolerance(event.target.value)}/></label><Button disabled={busy}>Save</Button></form>
      <form onSubmit={(event) => { event.preventDefault(); action('/scale', { kind: 'calibrate', value: Number(factor) }); }}><label>Calibration factor<input type="number" step="any" required value={factor} onChange={(event) => setFactor(event.target.value)} placeholder="Counts per gram"/></label><Button disabled={busy}>Set</Button></form>
      <Button disabled={busy} onClick={() => action('/scale', { kind: 'tare' })}>Tare scale</Button>
    </div>
    <p className="hint">{cart.commissioning ? 'ESP32 setup required. Empty the scale and tare it, then follow the hardware calibration instructions.' : 'Use an empty, stable scale for calibration or tare. Virtual readings are entered in grams.'}</p>
  </section>;
}

const blankProduct = { uid: '', name: '', price: '', grams: '', category: '', image: '' };
function Products({ products, run, reload, busy }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState(null);
  const categories = [...new Set(products.map((item) => item.category))].sort();
  const rows = products.filter((item) => (!category || item.category === category) &&
    (item.name + ' ' + item.uid + ' ' + item.category).toLowerCase().includes(query.toLowerCase().trim()));
  function save(event) {
    event.preventDefault();
    run(async () => {
      await api('/products' + (edit.id ? '/' + edit.id : ''), edit.id ? 'PUT' : 'POST',
        { ...edit, price: Math.round(Number(edit.price) * 100), grams: Number(edit.grams) });
      setEdit(null);
      await reload();
    });
  }
  return <>
    <div className="intro"><div><div className="eyebrow"><span/> INVENTORY</div><h1>Product management</h1><p>Register RFID tags and maintain the local product catalog.</p></div><Button tone="primary" onClick={() => setEdit({ ...blankProduct })}><Plus size={18}/> Add product</Button></div>
    {edit && <section className="panel form-panel"><h2>{edit.id ? 'Edit product' : 'New product'}</h2>
      <form onSubmit={save}><div className="product-form">
        {[
          ['name', 'Product name', 'text', { maxLength: 100 }], ['uid', 'RFID UID', 'text', { placeholder: 'A0010001' }],
          ['price', 'Price (₹)', 'number', { min: 0.01, max: 1000000, step: 0.01 }],
          ['grams', 'Expected weight (g)', 'number', { min: 10, max: 5000, step: 1 }],
          ['category', 'Category', 'text', { maxLength: 60 }], ['image', 'Image URL (optional)', 'url', { maxLength: 500 }],
        ].map(([key, title, type, props]) => <label key={key}>{title}<input type={type} {...props} required={key !== 'image'} value={edit[key]} onChange={(event) => setEdit({ ...edit, [key]: event.target.value })}/></label>)}
      </div><div className="button-row"><Button type="button" onClick={() => setEdit(null)}>Cancel</Button><Button tone="primary" disabled={busy}>Save product</Button></div></form>
    </section>}
    <section className="panel"><div className="filters"><label>Search<input type="search" value={query} placeholder="Product name or RFID UID" onChange={(event) => setQuery(event.target.value)}/></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>RFID UID</th><th>Category</th><th>Price</th><th>Weight</th><th>Actions</th></tr></thead>
      <tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>ID {item.id}</small></td><td><code>{item.uid}</code></td><td>{item.category}</td><td>{money(item.price)}</td><td>{grams(item.grams)}</td>
        <td><div className="button-row"><Button onClick={() => setEdit({ ...item, price: item.price / 100 })}>Edit</Button><button className="icon" aria-label={'Delete ' + item.name} disabled={busy} onClick={() => {
          if (confirm('Delete ' + item.name + ' from the catalog?')) run(async () => { await api('/products/' + item.id, 'DELETE', {}); if (edit?.id === item.id) setEdit(null); await reload(); });
        }}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>
      {!rows.length && <p className="hint">No products match your filters.</p>}
    </section>
  </>;
}

function Sessions({ revision, openReceipt }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/sessions').then((next) => { if (active) { setRows(next); setError(''); } }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [revision]);
  return <><div className="intro"><div><div className="eyebrow"><span/> TRANSACTIONS</div><h1>Shopping sessions</h1><p>Review completed sessions and reprint receipts.</p></div></div>
    <section className="panel"><div className="section-title"><span className="glyph"><ClipboardList size={19}/></span><div><h2>Session history</h2><p>Saved locally in SQLite.</p></div></div>
      {error && <p role="alert">{error}</p>}
      <div className="table-wrap"><table><thead><tr><th>Session</th><th>Started</th><th>Ended</th><th>Status</th><th>Total</th><th>Receipt</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td>{sessionNo(row.id)}</td><td>{date(row.started)}</td><td>{row.ended ? date(row.ended) : '—'}</td><td><span className={'chip ' + (row.status === 'PAID' ? 'green' : '')}>{row.status === 'PAID' ? 'Completed' : row.status === 'RESET' ? 'Reset' : 'Open'}</span></td><td>{row.subtotal == null ? '—' : money(row.subtotal)}</td><td>{row.status === 'PAID' && <Button onClick={() => openReceipt(row.id)}>View</Button>}</td></tr>)}
      </tbody></table></div>
    </section></>;
}
function DemoPayment({ total, busy, ready, error, close, confirm }) {
  const dialog = useRef(null);
  const [method, setMethod] = useState('UPI');
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="receipt demo-payment" aria-labelledby="payment-title" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <div className="section-title"><span className="glyph"><Wallet size={22}/></span><div><h2 id="payment-title">Demo checkout</h2><p>A simulated payment, just for trying NexKart.</p></div><button className="icon push" aria-label="Close checkout" disabled={busy} onClick={close}><X size={18}/></button></div>
    <div className="demo-payment-total"><span>Total payable</span><strong>{money(total)}</strong><small>No real money will be charged</small></div>
    <fieldset className="payment-methods"><legend>Choose a demo payment method</legend>{['UPI', 'Card', 'Cash'].map((name) => <label key={name}><input type="radio" name="payment-method" checked={method === name} onChange={() => setMethod(name)} disabled={busy}/>{name}</label>)}</fieldset>
    <p className="hint">No card details, UPI ID, or bank connection required.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {!ready && <p className="notice">Your cart must be connected and verified before completing checkout.</p>}
    <Button tone="primary full" disabled={busy || !ready} onClick={confirm}>{busy ? 'Completing checkout…' : 'Simulate ' + method + ' payment'}</Button>
  </dialog>;
}

function Receipt({ receipt, close }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="receipt" aria-labelledby="receipt-title" onCancel={close}>
    <div className="section-title"><span className="glyph"><Check size={20}/></span><div><h2 id="receipt-title">Digital receipt</h2><p>NexKart · {receipt.cartId} · Session {sessionNo(receipt.session.id)}</p></div><button className="icon push no-print" onClick={close} aria-label="Close receipt"><X size={18}/></button></div>
    <p className="receipt-demo">Demo checkout complete · No payment was collected.</p>
      <p className="hint">{date(receipt.session.ended)} · Verified trolley weight {grams(receipt.expected)}</p>
    <table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{group(receipt.items).map((item) => <tr key={item.lineId}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.price)}</td><td>{money(item.price * item.quantity)}</td></tr>)}</tbody></table>
    <div className="bill"><div><small>TOTAL</small><strong>{money(receipt.subtotal)}</strong></div><Button tone="primary no-print" onClick={() => window.print()}><Printer size={17}/> Print / Save as PDF</Button></div>
  </dialog>;
}

function Root() {
  const [connected, setConnected] = useState(false);
  if (admin) return <App/>;
  if (connected) return <App onDisconnect={() => setConnected(false)}/>;
  return <ConnectCart connect={async (code, showSuccess) => {
    const snapshot = await api('/cart');
    if (snapshot.cartId !== code) throw new Error('Cart not found. Check the code on your trolley and try again.');
    if (!snapshot.connected) throw new Error('This cart is offline. Ask a store assistant for help or try another cart.');
    await showSuccess();
    setConnected(true);
  }}/>;
}

createRoot(document.getElementById('root')).render(<Root/>);
