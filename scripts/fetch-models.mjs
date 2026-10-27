/**
 * One-off model mirror: downloads every file the app requests from Hugging
 * Face into ./models (gitignored), mirroring the repo layout that
 * transformers.js expects. Skips complete files, RESUMES partial ones via
 * HTTP Range, and retries a few times per file — a dropped connection only
 * continues where it stopped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HOST = 'https://huggingface.co';
const RETRIES = 8;

/** Exactly the files this app requests: configs + both device paths per model. */
const MODELS = [
  {
    repo: 'onnx-community/whisper-small',
    files: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      // WebGPU path: fp16 encoder, q4 merged decoder
      'onnx/encoder_model_fp16.onnx',
      'onnx/decoder_model_merged_q4.onnx',
      // WASM path: q8 everywhere
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ],
  },
  {
    repo: 'onnx-community/whisper-base',
    files: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      // WebGPU path: fp32 encoder (no suffix), q4 merged decoder
      'onnx/encoder_model.onnx',
      'onnx/decoder_model_merged_q4.onnx',
      // WASM path: q8 everywhere
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ],
  },
];

async function contentLength(url) {
  const head = await fetch(url, { method: 'HEAD' });
  return Number(head.headers.get('Content-Length') ?? 0);
}

async function download(repo, file, total) {
  const dest = path.join('models', repo, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const response = await fetch(`${HOST}/${repo}/resolve/main/${file}`, {
      redirect: 'follow',
      headers: have > 0 && have < total ? { Range: `bytes=${have}-` } : {},
    });
    // 206 = resume accepted, append; 200 = full body, start over.
    const resuming = response.status === 206 && have > 0;
    const write = fs.createWriteStream(dest, { flags: resuming ? 'a' : 'w' });
    if (!resuming) have === 0 || fs.truncateSync(dest, 0);
    try {
      await pipeline(Readable.fromWeb(response.body), write);
    } catch (error) {
      console.log(`  retry ${attempt}/${RETRIES} (${fs.existsSync(dest) ? fs.statSync(dest).size : 0} bytes so far)`);
      if (attempt === RETRIES) throw error;
      continue;
    }
    const size = fs.statSync(dest).size;
    if (total > 0 && size !== total) {
      console.log(`  size mismatch (${size} vs ${total}), retrying`);
      if (attempt === RETRIES) throw new Error(`size mismatch for ${file}`);
      continue;
    }
    return;
  }
}

for (const { repo, files } of MODELS) {
  for (const file of files) {
    const url = `${HOST}/${repo}/resolve/main/${file}`;
    let total = 0;
    try {
      total = await contentLength(url);
    } catch {
      // HEAD blocked: proceed without a total (no skip check, no size verify).
    }

    const existing = fs.existsSync(path.join('models', repo, file)) ? fs.statSync(path.join('models', repo, file)).size : -1;
    if (total > 0 && existing === total) {
      console.log(`skip (cached) ${repo}/${file} (${(total / 1048576).toFixed(1)} MB)`);
      continue;
    }

    try {
      await download(repo, file, total);
      const mb = (fs.statSync(path.join('models', repo, file)).size / 1048576).toFixed(1);
      console.log(`ok ${repo}/${file} (${mb} MB)`);
    } catch (error) {
      console.error(`FAILED ${repo}/${file}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
console.log('done');