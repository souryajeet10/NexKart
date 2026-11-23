# SmartCart architecture

The React dashboard sends commands to Express. A single server-side state machine handles simulator and ESP32 events. SQLite commits each accepted action, its resulting state, and its associated records together. Socket.IO broadcasts authoritative cart snapshots. The firmware handles measurement, networking, LCD and buzzer output. The browser and ESP32 never calculate the official bill.

## Verification

An RFID scan records the stable baseline and creates an **AWAITING_WEIGHT** action. A removal request creates **AWAITING_REMOVAL** with a negative expected delta. A scale change larger than the 4 g stability span enters **VERIFYING**. The backend uses five consecutive samples with a spread of at most 4 g. It compares their average minus the baseline against the signed product weight and checks the resulting total against the verified cart total. Both checks use the configured tolerance. The simulator submits a set of identical samples to model a settled reading.

A match commits the addition or removal, enters **VERIFIED** and increments the confirmation signal. The cart settles in **CHECKOUT_READY** when it contains verified items and all checks pass, or **IDLE** when empty. A wrong stable delta enters **WEIGHT_MISMATCH**. Unexplained stable changes without a pending operation enter **UNEXPECTED_WEIGHT**. Readings outside the operating range invalidate the stable weight and block checkout. A pending operation expires after 30 seconds. A cancelled or expired operation with displaced weight stays blocked until the original weight returns.

The database uses paise for prices, and snapshots product details into each session item. RFID event IDs are unique and survive a restart. A hardware same-tag cooldown and the firmware's tag halt further limit repeated reads. Hardware readings and connection freshness expire after 2.5 seconds. A missing reading immediately clears the stable sample window. A subsequent connection needs a new set of stable readings.

## HTTP API

Every request and response with a body uses JSON. Errors have an `error` string. Browser cart actions include the numeric `session` ID from the latest cart snapshot.

| Method and route | Purpose or additional body fields |
|---|---|
| GET /api/cart | Authoritative cart snapshot |
| GET /api/products | Product catalog |
| POST /api/products | Create with uid, name, price in paise, grams, category and optional image |
| PUT /api/products/:id | Update the same product fields |
| DELETE /api/products/:id | Delete a catalog row. Send an empty JSON object. |
| GET /api/sessions | Session history |
| POST /api/sessions | Open a new shopping session |
| GET /api/sessions/:id/receipt | Retrieve a completed receipt |
| POST /api/scan | Simulated RFID scan with uid and unique event |
| POST /api/weight | Set simulated absolute scale grams |
| POST /api/remove | Begin verified removal using lineId |
| POST /api/cancel | Cancel a pending action and wait for baseline restoration if needed |
| POST /api/checkout | Complete the session and create a receipt |
| POST /api/sim/connection | Set online to true or false |
| POST /api/sim/reset | Reset the virtual trolley and archive the session |
| POST /api/mode | Set mode to simulation or hardware |
| POST /api/settings | Set tolerance to an integer between 5 and 30 g |
| POST /api/scale | Request kind tare or calibrate with a nonzero value for calibrate |
| POST /api/device | Authenticated ESP32 frame |

Device frames use `Authorization: Bearer <SMARTCART_DEVICE_KEY>` with `id`, `boot`, `grams` or null, optional `scan: {uid,event}`, optional `setupScale` for a ready but uncommissioned scale, and optional `ack` for a completed scale command. Successful responses return `state`, `alert`, `beep`, `command`, `scan`, `session`, `subtotal` and LCD `text`. A null reading invalidates scale readiness even if the authenticated device is still online. Device command IDs are retained by the server until acknowledged.

Socket.IO uses `cart` for full snapshots and `products` for catalog invalidation. The app binds to loopback by default. With LAN access enabled, browser operations are intended for operators on the trusted demo network. The device endpoint requires its separate shared credential. Run one backend process per database.


## Integration updates

See [API.md](API.md) for current response fields and [HARDWARE_SETUP.md](../HARDWARE_SETUP.md) for setup. Hardware mismatches now require 1.5 seconds of stable mismatch, after a 4-second placement grace for pending operations. Simulator scenarios remain immediate. The verification counter remains for protocol compatibility; current firmware keeps verified weight silent. SQLite stores scan responses for consistent retries. Device binding persists beyond disconnects. Production forcibly disables simulation and skips new demo catalog seeding. This deployment continues to serve one physical cart per backend/database.
