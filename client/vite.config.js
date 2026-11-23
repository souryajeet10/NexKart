import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const backend = process.env.SMARTCART_DEV_BACKEND || 'http://127.0.0.1:3001';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tailwind()],
  server: { proxy: { '/api': backend, '/socket.io': { target: backend, ws: true } } },
});
