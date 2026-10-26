// Runs in Node (not jsdom) so it can read the raw Netlify headers file from disk.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards against silently dropping the COOP/COEP lines that make
// `crossOriginIsolated` (→ multithreaded WASM) work in production.
describe('Netlify _headers', () => {
  const content = readFileSync(join(__dirname, '..', '..', '_headers'), 'utf-8');

  it('sets both cross-origin isolation headers', () => {
    expect(content).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/);
    expect(content).toMatch(/Cross-Origin-Embedder-Policy:\s*require-corp/);
  });

  it('caches hashed assets but not the entry HTML', () => {
    expect(content).toMatch(/\/assets\/\*[\s\S]*?max-age=31536000/);
    expect(content).toMatch(/\/index\.html[\s\S]*?no-cache/);
  });
});