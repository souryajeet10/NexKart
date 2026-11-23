# Virtual SmartCart Simulator

## Launch

Use Node.js 24 or newer. From the repository root:

```powershell
npm ci
npm run server
# Second terminal:
npm run client
```

Open the Vite URL followed by `/simulator`, or select **Simulator** in the existing admin navigation. The customer connection screen also links to it. For a single-port presentation, use `npm run build` then `npm start` and open `http://localhost:3001/simulator`.

No ESP32, firmware, device token or audio permission is needed to use the virtual cart. Products come from the existing database. If the catalog is empty, add products in the Products tab. Existing development sample products work immediately.

Keep `NODE_ENV` unset or set to development, and `SMARTCART_SIMULATION=true` in `.env`. Production and `SMARTCART_SIMULATION=false` disable simulator APIs. Restart the backend after editing environment settings.

## Five-step presentation

1. Click **Start Demo**. This resets only the virtual basket and connects the virtual device.
2. Click **Scan a product** in the walkthrough. The registered UID travels to Express, and the pending product and price appear on the LCD and trolley.
3. Click **Place it on the tray** within 30 seconds. The backend verifies weight and commits the bill.
4. Click **Add unexpected weight**. Observe the red tray, LCD mismatch message, buzzer ON and blocked checkout.
5. Click **Restore and verify**, then **Complete demo checkout**. The buzzer turns OFF and a demo receipt is saved. No payment is collected.

The walkthrough pauses between steps so you can explain each stage. Existing pending actions expire after 30 seconds; if a scan times out, cancel/restore its baseline or Start Demo again. Manual controls can be used independently of the guide. Start Demo restarts its sequence.

## Manual controls

- Search by product name, category or UID; each card has **Scan RFID**. Scan commits a pending operation, not an unverified sale.
- **Verify Weight / Place item** sends the target weight. **Extra weight / Mismatch**, **Missing weight**, and **Reset tray to 0 g** model physical changes. Resetting the tray does not remove billed items: use Remove then verify the decrease, or Reset Demo.
- Type grams or adjust the slider, then **Apply settled weight**. The server feeds the configured number of identical samples through the shared verifier.
- **Send one raw sample** exercises stabilization. Vary successive readings to simulate noise. Under Stability settings choose tolerance (5-30 g), sample count (2-20), and maximum spread (0-20 g). Save with no pending action, then send fresh readings.
- **Remove** starts a safe one-unit removal. Use Verify Weight to take the item off the tray. Quantities, captured prices and total update from backend snapshots.
- **Replay last scan** resends the same event ID. It cannot create another item. Scan the product again with its card button for an intentional additional unit.
- **Scan unknown tag** generates a UID absent from the current catalog. It should produce an error without adding a product.
- Disconnect/reconnect the virtual ESP32 to demonstrate sensor availability and checkout gating.
- **Enable simulator sound** requires a deliberate click and resumes browser audio. One quiet 180 ms tone plays on a mismatch transition. Mute or leave the page to stop audio. Visual status works even when sound is unavailable.
- The LCD uses exactly two lines of 16 ASCII characters, truncating long names like physical hardware.

## Isolation and persistence

The dedicated page uses `/api/simulator/*`, the `simulator:cart` Socket.IO event, cart ID `VIRTUAL-01`, and a separate SQLite file at `<SMARTCART_DB>.simulator`. Defaults place both files under ignored `data/`. Demo receipts, scan IDs, settings and items never enter the main customer database. Both stores use the same Cart class; the simulator reads products from the main catalog without copying or editing it. Receipt data remains saved in the demo database; the main Sessions page intentionally excludes it.

The Active feed switch changes only the displayed feed. **Real ESP32 Hardware** is read-only on this page; use Overview to commission/manage the physical cart. Switching views never invokes the real mode mutation endpoint or resets a real basket. If Overview is still in its pre-existing Simulation Mode, the page explicitly says so. The old Overview simulator remains available for compatibility; use the dedicated page for isolated demonstrations.

There is one shared virtual demonstration basket per backend, synchronized across open simulator tabs. Reset Demo affects those simulator viewers only. Session IDs reject actions from outdated tabs until their snapshots refresh. This is a trusted-LAN demonstration app, not multi-user authentication.

## API and testing

`GET /api/simulator/cart` returns the full demo snapshot with `source: simulator`. POST actions accept JSON containing the latest numeric `session`:

| Action under /api/simulator/ | Additional fields |
|---|---|
| scan | uid, unique event |
| weight | grams; creates a settled sample window |
| sample | grams; submits one raw sample |
| remove | lineId |
| cancel, checkout, reset | none |
| connection | online boolean |
| settings | tolerance, sampleCount, stableSpan |

Mutations return `{cart,result}`. Errors return an error string and HTTP status; scan errors also include the updated activity snapshot. WebSocket reconnect receives the current complete demo snapshot. The browser applies server run IDs and revisions to avoid stale updates.

Run `npm test` and `npm run build`. Tests cover shared verification, demo totals/removal/checkout, event replay, unknown tags, configurable noise stabilization, reconnect, isolated receipt history and unchanged hardware state. No lint script is configured. Browser audio output depends on the local browser and sound device.
