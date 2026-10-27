# Zero Transcriber

Real-time speech transcription that runs **entirely in your browser**. No backend, no API keys:
audio is captured from your microphone (or a shared tab), transcribed locally by a Whisper model
via [transformers.js](https://huggingface.co/docs/transformers.js), and displayed live — **nothing
is recorded and nothing is sent anywhere.** The only network calls are one-time downloads of the
model weights and JS bundle from public CDNs (cached in your browser afterwards).

## Privacy

- Audio never leaves your machine: capture → VAD segmentation → model inference all happen locally
  (inference in a Web Worker via WebGPU, WASM fallback).
- No telemetry, no analytics, no storage: the transcript lives only in the page's memory; closing
  the tab erases it. The browser caches model weights in Cache Storage — nothing else.
- You can verify it: open DevTools → Network and watch the only requests after the model loads.

## Features

- **Live partials** — text streams in while you speak; each finished utterance becomes an editable
  line (auto-detect language or pick one of 30+ languages).
- **Two audio sources** — microphone, or a browser tab / screen with media playing (a call without
  joining it, a video, a lecture). Tab capture is Chrome/Edge; mic works everywhere.
- **Two quality levels** — `small` (default: noticeably better quality) and `base` (lighter,
  lower quality, opt-in). Weights download **sequentially** with **one aggregated progress bar**
  ("Loading model…"), and are cached in the browser after the first run — every visit afterwards
  loads instantly from cache.
- **Editing toolbox** — per-line editing, undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z` also work inline),
  copy, select-all (merged view), download `.txt`, clear.
- **Accessible & calm** — ARIA labels/roles, `aria-live` partials, all animation behind
  `prefers-reduced-motion`.

## Model sizes (one-time download, then browser-cached)

| Model  | WebGPU | WASM  |
| ------ | ------ | ----- |
| small (default) | ~410 MB | ~250 MB |
| base   | ~206 MB | ~77 MB |

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (cross-origin-isolated via dev-server headers)
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build
```

Debug helpers:

- `/?debug=audio` — console harness for capture/segmentation without the model.
- `/?device=wasm` — force the CPU (WASM) path, e.g. to test fallback on a WebGPU-capable machine.

## Deploy (Netlify)

Static hosting — no server code. Deploy via `npx netlify deploy --prod` or connect the repo in the
Netlify dashboard. The `_headers` file ships the COOP/COEP headers that enable `SharedArrayBuffer`
(multithreaded WASM) — model weights are fetched from the Hugging Face CDN in CORS mode, which is
valid under `Cross-Origin-Embedder-Policy: require-corp`.

## Browser matrix

| Browser | Device        | Tab capture | Notes                        |
| ------- | ------------- | ----------- | ---------------------------- |
| Chrome / Edge | WebGPU + threaded WASM | yes | full experience |
| Firefox | WASM (single-threaded without COI) | no | use `?device=wasm` if needed |
| Safari  | WASM          | no          | mic only                     |

If a host ever refuses custom headers, the documented fallback is the
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) shim (register it in
`index.html`); this project ships proper headers instead.