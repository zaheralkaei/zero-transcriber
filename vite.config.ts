import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server sends the same COOP/COEP headers as Netlify prod (via `_headers`),
// so `crossOriginIsolated` is true in dev and prod alike — required for
// multithreaded WASM inference.
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  // The worker uses a dynamic import (transformers.js) — ES-module workers it is.
  worker: {
    format: 'es',
  },
  server: {
    headers: coiHeaders,
  },
});