# SmartCart

SmartCart is a local self-checkout demo. Scan an RFID tag, place the product on the scale, and bill it only after its weight change has been verified. Simulation Mode is ready to use without electronics. Hardware Mode connects one ESP32 cart over a local Wi-Fi network.

## Quick start

Install Node.js 24 or newer. Extract the ZIP, open a terminal in the SmartCart folder, and run:

```sh
npm ci
npm start
```

Open [the SmartCart dashboard](http://127.0.0.1:3001). The home page is the customer checkout. Follow the scan and scale prompts to shop. Use **Admin console** in the header or open [the admin console](http://127.0.0.1:3001/admin) for the catalog, session history, diagnostics and full simulator. Both views share the same live cart. The views are separated by purpose and share the local demo's access model. Keep the terminal open. Stop the server with Ctrl+C. The ZIP includes a built dashboard. Run `npm run build` after editing frontend source. The ZIP includes a built dashboard. Run `npm run build` after editing frontend source. The ZIP includes a built dashboard. Run `npm run build` after editing frontend source. The initial dependency install needs internet access. The application can then run offline.

SQLite creates `data/smartcart.sqlite` on first launch and seeds the five demo products. Product edits, current cart items, and session history survive a restart. The application uses one cart, `SC-01`. Checkout saves a demo receipt without processing a payment.

### Development

Use two terminals from the SmartCart folder:

```sh
npm run server
```

```sh
npm run client
```

Open the Vite URL shown in the second terminal, normally [localhost:5173](http://localhost:5173). The development server forwards the API and Socket.IO connection to port 3001. Set `SMARTCART_DEV_BACKEND` before running Vite if the backend uses a different address.

## Live demonstration

Start with an empty trolley in **Admin console → Overview → Hardware simulator**. Enable **Alert sound** if you want browser beeps.

| Demo | Click | Result |
|---|---|---|
| A | **Successful shopping** | A 100 g Biscuit Packet verifies and adds ₹20.00. |
| B | **Weight mismatch** | A Chocolate scan is followed by excess weight. The alert and buzzer indicator turn on, while the subtotal stays ₹20.00. Click **Correct weight** to verify Chocolate and bring the subtotal to ₹70.00. |
| C | **Unscanned product** | An unexpected 150 g appears. Checkout is disabled. Click **Correct weight** to restore the verified weight. |
| D | **Verified removal** | The simulator requests removal of the latest verified item, then applies the matching weight decrease. The bill returns to ₹20.00. |

Click **Checkout** to see the digital receipt. **Print / Save as PDF** opens the browser print dialog. **New session** clears the checked-out virtual trolley. **Sessions** lets you reopen any completed receipt.

For a manual demonstration, select a product, click **Simulate RFID scan**, and check that the price appears in the pending row while the bill stays unchanged. Then use **Place correct item** or enter the new **total** scale reading. To remove a specific verified unit, click its trash icon and then **Remove from scale**. A reset archives an open session as Reset and starts an empty virtual trolley. Simulated connection and virtual readings are labelled on the dashboard.

Use **Products** to create, update, find, or delete catalog entries. RFID UIDs use 4, 7, or 10 bytes of hexadecimal. Registered product weights should include packaging. Existing verified purchases and receipts keep the details captured when scanned.

## Settings and tests

The dashboard settings button opens mode, tolerance, tare and calibration controls. Default tolerance is ±10 g. Virtual readings are entered in grams and the simulator tare returns the empty scale to zero. The calibration setting records the configured virtual factor. Real counts-per-gram conversion runs on the ESP32.

```sh
npm test
```

The tests cover verification, noise, duplicate and unknown scans, unexpected weight, removal, checkout, reset, SQLite persistence, product CRUD, live Socket.IO updates and authenticated test-device requests. The HTTP integration tests need permission to connect to temporary loopback ports.

- [Hardware setup and wiring](docs/HARDWARE.md)
- [Architecture and API](docs/ARCHITECTURE.md)

`client/` contains the React, Vite, Tailwind and Lucide dashboard. `server/` contains Express, Socket.IO, SQLite and the state machine. `firmware/` contains the Arduino sketch and a configuration template.
