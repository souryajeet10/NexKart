import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { openStore } from './store.js';
import { createApp } from './http.js';

const filename = process.env.SMARTCART_DB || fileURLToPath(new URL('../data/smartcart.sqlite', import.meta.url));
mkdirSync(dirname(filename), { recursive: true });
const store = openStore(filename, { seedDemo: process.env.NODE_ENV !== 'production' && process.env.SMARTCART_SEED_DEMO !== 'false' });
const demoStore = openStore(filename + '.simulator', { seedDemo: false });
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const { server } = createApp(store, {
  demoStore,
  secret: process.env.SMARTCART_DEVICE_KEY,
  deviceId: process.env.SMARTCART_DEVICE_ID || undefined,
  simulationEnabled: process.env.SMARTCART_SIMULATION !== 'false',
  staticDir: fileURLToPath(new URL('../client/dist', import.meta.url)),
});
server.listen(port, host, () => console.log('SmartCart listening at http://' + host + ':' + port));
