import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Inside docker-compose the API answers on another host, so the proxy target is
 * configurable. It only affects development: in production the frontend calls a
 * relative /api and the platform routes it.
 */
const apiTarget = process.env.KARGA_API_TARGET ?? 'http://localhost:4100';

const paraApi = { target: apiTarget, changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Refuse to drift to another port: the API's CORS list names this one, and a
    // silent fallback would produce a rejected origin that looks like a bug.
    strictPort: true,
    proxy: {
      '/api': paraApi,
      // Probes are proxied too, otherwise they fall through to the SPA fallback
      // and answer with index.html instead of the API's JSON.
      '/health': paraApi,
      '/ready': paraApi,
      // The socket needs `ws` as well as the target: without it the upgrade request
      // is proxied as plain HTTP and the connection silently falls back to polling.
      '/realtime': { ...paraApi, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
