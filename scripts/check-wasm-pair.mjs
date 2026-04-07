import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const loaderPath = join(root, 'dist', 'sip.js');
const wasmPath = join(root, 'dist', 'sip.wasm');

const { default: createSipModule } = await import(pathToFileURL(loaderPath).href + `?t=${Date.now()}`);
const wasmBinary = await readFile(wasmPath);

const module = await createSipModule({ wasmBinary });

const requiredFns = [
  '_malloc',
  '_free',
  '_sip_decoder_create',
  '_sip_decoder_push_input',
  '_sip_decoder_read_header',
  '_sip_decoder_read_scanline',
  '_sip_encoder_create',
  '_sip_png_decoder_create',
];

for (const name of requiredFns) {
  if (typeof module[name] !== 'function') {
    throw new Error(`WASM loader mismatch: expected ${name} to be a function`);
  }
}

console.log('Verified dist/sip.js and dist/sip.wasm are compatible.');
