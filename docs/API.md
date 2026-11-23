# NexKart integration API

All bodies are JSON. Errors use `{ "error": "message" }` with 400 validation, 401 bad device token, 403 disallowed mode/device, 404 missing product/resource, or 409 invalid cart state. Browser mutations return `{cart, result}` and require numeric `session` from GET /api/cart. Existing routes are intentionally reused rather than duplicating device protocols.

| Requested capability | Existing route |
|---|---|
| Register/heartbeat, RFID scan, weight update | POST /api/device |
| Cart snapshot | GET /api/cart |
| Device status | GET /api/device/status |
| Remove unit | POST /api/remove with session, lineId |
| Tare | POST /api/scale with session, kind: tare |
| Calibration | POST /api/scale with session, kind: calibrate, value: signed counts per gram |
| Product/RFID setup | GET/POST /api/products; PUT/DELETE /api/products/:id |
| Simulated RFID | POST /api/scan with session, uid, event |
| Simulated absolute grams | POST /api/weight with session, grams |
| Simulated connection/reset | POST /api/sim/connection with session, online; POST /api/sim/reset with session |
| Operating mode | POST /api/mode with session, mode: hardware or simulation |
| Tolerance | POST /api/settings with session, tolerance (integer 5–30 g) |
| Cancel/checkout/new session | POST /api/cancel, /api/checkout, /api/sessions with session |
| Saved sessions/receipt | GET /api/sessions; GET /api/sessions/:id/receipt |

Product fields: uid (actual hexadecimal tag), name, price (integer **paise**), grams (integer gross mass, 10–5000), category, optional HTTP(S) image URL. Fresh development databases seed five sample catalog rows; replace UIDs using the Products editor. Production never automatically seeds a fresh catalog. Existing product data is not deleted.

## ESP32 protocol

Send `Authorization: Bearer <SMARTCART_DEVICE_KEY>` to POST /api/device approximately every 140 ms after the previous request completes:

```json
{"id":"SC-01-ESP32","boot":"unique-random-boot-id","grams":505,"setupScale":false,"scan":{"uid":"04AABBCCDDEEFF","event":"42"}}
```

UID above is illustrative only. Read the actual reader UID. Event increments per scan, boot changes per boot, and id must match the configured/persisted cart binding. Omit scan when none is pending. Retry the identical event until a successful JSON reply; event results persist in SQLite, including rejected outcomes. Same-tag cooldown also suppresses accidental events. Prices are looked up only by the server.

Use grams:null when unavailable. setupScale:true is permitted only with no weight, while an uncommissioned HX711 is producing raw readings. Ordinary stale readings/heartbeat expire after 2.5 seconds. A ready flag is not inferred from connectivity alone.

A successful envelope returns state, alert (buzzer demand), beep (legacy verification counter), command, scan, session, subtotal (paise), expected (verified grams), actual, sensorReady, and short LCD text. `scan` is null or `{accepted:true,product}`, `{error,status}`, or the stored result with `duplicate:true`. Scan rejection uses HTTP 200 for the frame so sensor telemetry still proceeds; inspect scan.status for 404/409. Other frame failures use HTTP error statuses.

Scale commands are `{id,kind,value}`. Backend retains the command until a frame includes `ack` equal to that command ID. ESP32 performs the operation first, then acknowledges; retries with an already acknowledged ID do not execute again during that boot. Tare is an empty-tray operation; if the device resets mid-command, leave the tray empty during recovery. No HTTP endpoint instantly alters physical scale state.

GET /api/cart includes verified items, grouped by the UI into quantities; subtotal; expected; targetWeight (includes pending add/remove); actual; stable; state; pending product; alert; connected; sensorReady; commissioning; simulationEnabled; activity; session; revision and runId. Socket.IO emits complete `cart` snapshots on updates and connection/reconnection. `products` invalidates the catalog cache. The frontend ignores older revisions within a server run.

This is a trusted-LAN, single-cart application; browser API and socket reads have no account login. For multiple carts use separate instances/databases and tokens, as documented in HARDWARE_SETUP.md. Production rejects simulation even if requested through the API.
