# NexKart hardware and integration setup

## Architecture and scope

The existing React 19/Vite mobile UI, Express 5 API, SQLite database and Socket.IO are retained. ESP32 communicates only with Express. The backend owns product prices, cart state, weight verification and receipts. No account authentication existed: browser/operator actions remain intended for a trusted private demonstration LAN; `/admin` is not a security boundary. Device frames require a bearer token.

This installation serves **one physical cart (SC-01) per backend/database**, with sequential customer sessions. `SMARTCART_DEVICE_ID` binds its device; if omitted, the first authenticated device is persisted as the binding. Other device IDs are rejected even after disconnects and restarts. For multiple physical carts, run separate backend ports, databases and tokens. Do not share one instance between independent carts/customers. QR cart codes select the cart, not an authenticated customer account.

A scan immediately appears as a pending product, including price, on the website. The existing safety workflow commits the bill only after stable weight verification. Removal likewise waits for a matching physical decrease. Checkout remains a demo payment and saves a persistent receipt; no real payment is collected.

## Run the existing app

Install Node.js 24 or newer. In PowerShell at the repository root:

```powershell
npm ci
Copy-Item .env.example .env
npm run server
# In a second terminal:
npm run client -- --host 0.0.0.0
```

Open the Vite URL for the customer page, or append `/admin` for products, simulator and scale settings. Alternatively run `npm run build` then `npm start` and open `http://localhost:3001/admin`; Express serves the built UI and Socket.IO on the same port. Never overwrite an existing `.env` or `config.h` when updating.

For physical use set `.env` to `HOST=0.0.0.0`, a long random `SMARTCART_DEVICE_KEY`, and `SMARTCART_DEVICE_ID=SC-01-ESP32`. Use `ipconfig` to find the IPv4 address of the laptop's active Wi-Fi adapter (not a VPN/virtual adapter). ESP32 and laptop must share a reachable 2.4 GHz LAN. Set firmware `SERVER_URL` to `http://<that-IPv4>:3001/api/device`. Allow inbound TCP 3001 on the private Windows network. Do not use localhost in firmware. Use a DHCP reservation if the laptop address changes. HTTP bearer tokens are visible on the LAN; keep this demonstration network private.

For production set `NODE_ENV=production`. Simulation is forcibly disabled, including direct API calls, and a fresh database receives no demo products. Existing simulated baskets are archived as RESET before a hardware session begins. `SMARTCART_SIMULATION=false` disables simulation in development too. `SMARTCART_SEED_DEMO=false` skips sample products on new development databases. Existing catalog rows are preserved: replace demo UIDs with your real tags before the physical demonstration.

## Wiring and libraries

The pin map already in `firmware/SmartCart/config.example.h` and the existing wiring guides is preserved:

| Device | ESP32 GPIO |
|---|---|
| RC522 SS / RST / SCK / MISO / MOSI | 5 / 27 / 18 / 19 / 23 |
| HX711 DOUT / SCK | 32 / 33 |
| LCD SDA / SCL | 21 / 22 |
| Buzzer | 25 |

Verify these against your actual completed assembly before upload. LCD is 16x2, address **0x27**. See [existing electrical guidance](docs/HARDWARE.md) for supplies, shared ground, level shifting and load cell mounting. The tray and all its products must load the same cell; tare the empty tray, not each product. The physical cell rating includes the tray dead load.

In Arduino IDE install **esp32 by Espressif Systems (3.x)** via Boards Manager. Install these libraries:

- ArduinoJson **7.x** by Benoit Blanchon.
- HX711 by **bogde**.
- MFRC522 by **GithubCommunity**.
- LiquidCrystal I2C by **Frank de Brabander**, exposing `init()` and `backlight()`.

WiFi, HTTPClient, Preferences, SPI, Wire and FreeRTOS are supplied by the ESP32 core. The existing guide specifies an **active buzzer**; default firmware drives timed active-level pulses. If your component is a passive piezo, set `NEXKART_PASSIVE_BUZZER true` in config.h (ESP32 3.x LEDC API); use its appropriate driver and verify physically. Verified weight is silent. Persistent mismatch pulses, and rejected scans produce a short alert.

Copy `firmware/SmartCart/config.example.h` to `config.h` in the same folder. Fill WIFI_SSID, WIFI_PASSWORD, SERVER_URL, DEVICE_KEY and DEVICE_ID. Both private config files are ignored by Git. Preserve your working pin overrides. Open `SmartCart.ino`, select **ESP32 Dev Module** for the stated board, select its USB COM port under Tools > Port, and upload. Use a data-capable cable. Hold BOOT during connection if your board needs it. Open Serial Monitor at **115200 baud**.

## Tare, calibration and registering tags

1. Start the backend; select Hardware Mode in the dashboard while the session is empty. In production this is automatic.
2. Keep the empty tray still. Select **Tare scale** in settings. The server queues a UUID command; ESP32 averages 12 raw readings, stores the offset in Preferences, and acknowledges completion. The UI does not treat the request itself as completed. Missing HX711 data leaves the command pending; fix the sensor rather than pretending tare succeeded.
3. With the initial uncalibrated factor, Serial Monitor prints net raw counts after tare. Put a known mass on the tray and record stable counts. Calculate **factor = net counts / known mass in grams**, keeping its sign. Remove that mass, enter the factor in settings, and wait for acknowledgement. Alternatively set INITIAL_COUNTS_PER_GRAM and INITIAL_FACTOR_CALIBRATED=true before initial commissioning. Stored Preferences override initial values on subsequent boots.
4. Reapply known masses at several loads and positions. Check grams, remove them, and confirm zero. Tare again if necessary. Once commissioned, routine tare requires an empty verified tray; never tare away an unexplained product or mismatch. A stored offset is not proof the tray is still zero after transport or reboot.
5. Scan each actual RC522 tag. Copy the hexadecimal UID from Serial Monitor or Live activity into Products. Edit a sample product or create one with its actual price and **gross packaged mass**. The backend normalizes spaces, colons and letter case and accepts 4-, 7-, or 10-byte UIDs. Unknown tags never add products. No demo UID is embedded in firmware.
6. Scan a registered product. Place it after its pending card appears. Five readings spanning at most 4 g are averaged. Total weight and signed change must both fit the configured tolerance (5–30 g). Hardware gets a 4-second placement grace period and a further 1.5 seconds of sustained stable mismatch before alerting. Verification may succeed earlier. A pending action expires after 30 seconds and requires restoring its baseline if displaced. Unexpected stable additions/removals also require 1.5 seconds before alarming. Out-of-range readings alert immediately.

Backend filtering operates on absolute tray grams. HTTP runs in a separate ESP32 task; RFID, scale sampling and timed buzzer updates continue during network timeouts. Failed requests retry the same scan event. Persistent event IDs protect against duplicate billing; remove the tag from the reader field before intentionally rescanning another unit. Loss of readings or heartbeat blocks checkout; recovery needs five fresh stable readings. Wi-Fi reconnection runs automatically.

## Tests and physical acceptance

```powershell
npm test
npm run build
```

There is no configured lint command. Tests use Node's built-in runner and temporary SQLite databases, covering catalog CRUD, scan replay, rejected tags, Socket.IO updates, weight noise, correct and incorrect totals, removal, checkout, persistence, device auth, connection loss, placement grace and disabled simulation.

In development, use the existing admin Simulator: scan valid/unknown tags, place correct weight, trigger mismatch, add an unscanned item, remove an item, disconnect/reconnect, and replay an event. Simulation settles readings instantly and deliberately bypasses hardware timing delays. Switch to hardware only with a clear empty session.

Before a live demonstration physically verify: pin/voltage correctness; LCD address/contrast; scale zero and known masses; actual UIDs; held tag and deliberate rescan behavior; product name/price and total on LCD; brief unknown-tag beep; silent placement/verified weight; persistent mismatch and correction; safe removal; Wi-Fi interruption and restart while a scan is in flight; missing HX711; tare command completion; checkout lockout during faults; unloading before a new session. Software tests do not establish any of these physical results. Arduino compilation/upload and actual hardware testing must be performed with the target toolchain and assembly.

## Troubleshooting

- **Server offline:** verify laptop IPv4, full `/api/device` URL, HOST, firewall and same LAN; check Serial HTTP status. 401 means token mismatch; 403 means wrong bound device ID; 409 can mean Hardware Mode is not selected. Restart the backend after environment edits.
- **Scale waiting:** check HX711 power, shared ground and DOUT/SCK; no synthetic weights are sent for a missing sensor. **Setup required:** finish tare and calibration.
- **Wrong or negative grams:** preserve calibration sign, verify load-cell orientation/wiring and known mass. Do not compensate by increasing tolerance excessively.
- **LCD blank:** check contrast potentiometer, power, I2C level shifting, SDA/SCL and scanner-reported 0x27.
- **Buzzer silent/continuous:** check active versus passive type, polarity and driver. Select passive mode only for that hardware.
- **Weight mismatch while placing:** wait for stability, stop touching the tray and ensure all products are supported by it. Check gross package mass and tray friction.
- **Pending tare after disconnect:** restore hardware connectivity. Command stays queued until ESP32 actually completes and acknowledges it; the cart remains unavailable meanwhile.
- **Wrong device bound:** stop the server and set SMARTCART_DEVICE_ID to the intended device. Use a separate database/token for another cart. Do not bypass binding by spoofing IDs.

API details: [docs/API.md](docs/API.md). Existing deployment instructions remain in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
