import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, QrCode, ShoppingCart, X } from 'lucide-react';
import { readCartCode } from './cart-code.js';

export default function ConnectCart({ connect }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('cart') || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const video = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(value) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setScanning(false);
    try {
      const normalized = readCartCode(value, window.location.origin);
      setCode(normalized);
      await connect(normalized);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false, stream, timer;
    const stop = () => stream?.getTracks().forEach(track => track.stop());
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera scanning needs HTTPS and a supported browser. Enter your cart code below.');
        const { default: jsQR } = await import('jsqr');
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
        if (cancelled) { stop(); return; }
        const player = video.current;
        player.srcObject = stream;
        await player.play();
        if (cancelled) { stop(); return; }
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        function scan() {
          if (cancelled) return;
          if (player.readyState >= 2 && player.videoWidth) {
            canvas.width = Math.min(player.videoWidth, 640);
            canvas.height = Math.round(player.videoHeight * canvas.width / player.videoWidth);
            context.drawImage(player, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(frame.data, frame.width, frame.height);
            if (found) { stop(); submit(found.data); return; }
          }
          timer = setTimeout(scan, 180);
        }
        scan();
      } catch (err) {
        stop();
        if (!cancelled) {
          setScanning(false);
          setError(err.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser, or enter the cart code below.' : err.name === 'NotFoundError' ? 'No camera found. Enter the cart code below.' : err.message);
        }
      }
    }
    start();
    return () => { cancelled = true; clearTimeout(timer); stop(); };
  }, [scanning]);

  return <div className="customer connect-page">
    <header className="customer-header"><div className="customer-header-inner"><a className="brand" href="/"><img className="brand-logo" src="/nexkart-logo.png?v=27d2da9c" alt=""/><div>NexKart<small>Self Checkout</small></div></a></div></header>
    <main className="connect-content">
      <div className="connect-symbol"><ShoppingCart size={38}/></div>
      <span className="connect-eyebrow">YOUR SHOPPING STARTS HERE</span>
      <h1>Connect your cart.</h1>
      <p>Find the QR label on your trolley. Scan it or enter the cart code to start shopping.</p>
      <section className="panel connect-panel" aria-label="Connect to a cart">
        {error && <div className="notice" role="alert">{error}</div>}
        {scanning ? <div className="camera-view"><video ref={video} muted playsInline aria-label="Cart QR camera preview"/><p role="status">Point your camera at the cart’s QR code.</p><button className="button" onClick={() => setScanning(false)}><X size={18}/> Close camera</button></div> : <button className="scan-cart-button" disabled={busy} onClick={() => { setError(''); setScanning(true); }}><QrCode size={44}/><strong>Scan cart QR</strong><span><Camera size={16}/> Use your camera</span></button>}
        <div className="connect-divider">or enter cart code</div>
        <form onSubmit={event => { event.preventDefault(); submit(code); }}>
          <label htmlFor="cart-code">Cart code</label>
          <input id="cart-code" value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. SC-01" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} required disabled={busy}/>
          <button className="button primary full" disabled={busy || !code.trim()} type="submit">{busy ? 'Connecting…' : 'Connect & start shopping'}<ArrowRight size={18}/></button>
        </form>
        <p className="connect-help">Your cart code is printed beside its QR code.</p>
      </section>
      <p className="connect-footnote">Scan. Verify. Checkout.</p>
    </main>
  </div>;
}
