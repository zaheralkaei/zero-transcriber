import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true, // registers RTL auto-cleanup + global describe/it/expect
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/worker/**', 'src/hooks/**'],
      thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 },
    },
    // Worker-heavy code is exercised through the message protocol in jsdom.
    testTimeout: 10000,
  },
});