import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { collect, inspect, ready, toReadableStream, transform } from '../../src';
import { probe } from '../../src/probe';

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

let largeJpeg: Uint8Array;
let samplePng: Uint8Array;
let sampleWebp: Uint8Array;
let sampleAvif: Uint8Array;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function chunkStream(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)));
      }
      controller.close();
    },
  });
}

beforeAll(async () => {
  [largeJpeg, samplePng, sampleWebp, sampleAvif] = await Promise.all([
    readFile(join(FIXTURES, 'large.jpg')).then((buffer) => new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))),
    readFile(join(FIXTURES, 'sample.png')).then((buffer) => new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))),
    readFile(join(FIXTURES, 'sample.webp')).then((buffer) => new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))),
    readFile(join(FIXTURES, 'sample.avif')).then((buffer) => new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))),
  ]);

  const builtWasmLoaderPath = join(ROOT, 'dist', 'sip.js');
  const builtWasmBinaryPath = join(ROOT, 'dist', 'sip.wasm');

  if (existsSync(builtWasmLoaderPath)) {
    (globalThis as typeof globalThis & {
      __SIP_WASM_LOADER__?: () => Promise<unknown>;
    }).__SIP_WASM_LOADER__ = async () => {
      const { default: createSipModule } = await import(pathToFileURL(builtWasmLoaderPath).href);
      const wasmBinary = await readFile(builtWasmBinaryPath);
      return createSipModule({ wasmBinary });
    };
  }

  await ready();
});

describe('new API surface', () => {
  it('inspects each supported format', async () => {
    const jpeg = await inspect(toArrayBuffer(largeJpeg));
    const png = await inspect(toArrayBuffer(samplePng));
    const webp = await inspect(toArrayBuffer(sampleWebp));
    const avif = await inspect(toArrayBuffer(sampleAvif));

    expect(jpeg.info.format).toBe('jpeg');
    expect(png.info.format).toBe('png');
    expect(webp.info.format).toBe('webp');
    expect(avif.info.format).toBe('avif');
  });

  it('transforms a large JPEG from a chunked stream with bounded buffered input', async () => {
    const result = await collect(
      transform(chunkStream(largeJpeg), {
        width: 1024,
        height: 1024,
        quality: 80,
      })
    );

    expect(result.info.originalFormat).toBe('jpeg');
    expect(result.info.width).toBe(1024);
    expect(result.info.height).toBe(809);
    expect(result.stats.peakBufferedInputBytes).toBeLessThanOrEqual(128 * 1024);
    expect(result.stats.bytesOut).toBe(result.data.byteLength);

    const outputProbe = probe(result.data);
    expect(outputProbe.format).toBe('jpeg');
    expect(outputProbe.width).toBe(1024);
    expect(outputProbe.height).toBe(809);
  });

  it('transforms PNG, WebP, and AVIF samples to JPEG', async () => {
    const png = await collect(transform(toArrayBuffer(samplePng), { width: 800, height: 800, quality: 85 }));
    const webp = await collect(transform(toArrayBuffer(sampleWebp), { width: 800, height: 800, quality: 85 }));
    const avif = await collect(transform(toArrayBuffer(sampleAvif), { width: 800, height: 800, quality: 85 }));

    for (const result of [png, webp, avif]) {
      const outputProbe = probe(result.data);
      expect(outputProbe.format).toBe('jpeg');
      expect(result.data.byteLength).toBeGreaterThan(0);
      expect(result.stats.bytesIn).toBeGreaterThan(0);
      expect(result.stats.bytesOut).toBe(result.data.byteLength);
    }

    expect(png.info.originalFormat).toBe('png');
    expect(webp.info.originalFormat).toBe('webp');
    expect(avif.info.originalFormat).toBe('avif');
  });

  it('exposes a readable stream helper', async () => {
    const image = transform(toArrayBuffer(samplePng), { width: 320, height: 320, quality: 80 });
    const readable = toReadableStream(image);
    const reader = readable.getReader();
    let total = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }

    expect(total).toBeGreaterThan(0);
  });
});

