# Full-app hosting

The app needs one running Node.js 24 server and persistent SQLite storage. The server serves the built frontend, `/api`, `/socket.io`, and the admin console at `/admin` on the same origin. Run one instance: cart state lives in memory and SQLite lives on disk.

## Docker host

On a server with Docker Compose installed:

```sh
git clone https://github.com/souryajeet10/NexKart.git
cd NexKart
docker compose up -d --build
```

Open `http://YOUR_SERVER:3001` for checkout and `http://YOUR_SERVER:3001/admin` for the admin console. Set up your host's HTTPS domain or a reverse proxy to port 3001 with WebSocket upgrades enabled. The named volume `smartcart-data` preserves the database across container replacements. Do not delete that volume when updating.

To update:

```sh
git pull
docker compose up -d --build
```

For Hardware Mode, set `SMARTCART_DEVICE_KEY` in a `.env` file next to `compose.yaml`, then recreate the service. Match the key and public `/api/device` URL in the ESP32 configuration.

## Managed Node.js host

Use Node.js 24, one instance, and these settings:

| Setting | Value |
| --- | --- |
| Build | `npm ci && npm run build` |
| Start | `npm start` |
| Host | `HOST=0.0.0.0` |
| Port | Host-provided `PORT`, or `3001` |
| Persistent disk | Mount at `/data` with write permission for the app user |
| Database | `SMARTCART_DB=/data/smartcart.sqlite` |
| Health check | `/api/cart` |

Use the host's full-app URL for customers and append `/admin` for the console. The console has no customer navigation link, but the URL is not authentication: this remains a shared demo, including its mutation API. Use an access-controlled demo environment if it should not be publicly editable.

## Existing Vercel deployment

`vercel.json` deploys only the frontend. It does not start `server/index.js`, so `/api` and live cart updates are unavailable there. Use the full-app host URL once deployed. Keeping Vercel as the frontend would require connecting both API and Socket.IO traffic to the running backend.

## Checks and backup

Customers first see a connection screen with QR scanning and manual cart-code entry. The current single-cart backend uses `SC-01`. Print a QR containing `SC-01` or `https://YOUR_APP_DOMAIN/?cart=SC-01` beside that code on the trolley. The customer must connect again after refreshing or disconnecting. Opening a QR link prefills the code; it does not automatically connect. Camera scanning needs HTTPS (or localhost) and browser camera permission. `/admin` opens directly. This connection screen selects the existing shared demo cart; it is not authentication, exclusive reservation, or multi-cart isolation. The frontend-only Vercel deployment cannot validate a cart until its backend is connected.

Check `docker compose ps` and `docker compose logs smartcart` after deployment. Verify `/api/products` returns JSON, then scan and weigh an item in Simulation Mode and reload to confirm persistence. Stop the service before copying the SQLite database and its sidecar files for a consistent offline backup, then restart it.
