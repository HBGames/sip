import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

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

async function postFixture(path: string, contentType: string, options: {
  width?: number;
  height?: number;
  quality?: number;
  stream?: boolean;
}) {
  const response = await SELF.fetch(`https://example.com/${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const url = new URL(options.stream ? 'https://example.com/stream' : 'https://example.com/transform');

  if (options.width) url.searchParams.set('width', String(options.width));
  if (options.height) url.searchParams.set('height', String(options.height));
  if (options.quality) url.searchParams.set('quality', String(options.quality));

  return SELF.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': contentType,
      },
      body: path.endsWith('.jpg') ? chunkStream(bytes) : bytes,
    })
  );
}

describe('worker integration', () => {
  it('processes a chunked JPEG request body in the worker', async () => {
    const response = await postFixture('large.jpg', 'image/jpeg', {
      width: 1024,
      height: 1024,
      quality: 80,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-original-format')).toBe('jpeg');
    expect(Number(response.headers.get('x-output-width'))).toBe(1024);
    expect(Number(response.headers.get('x-peak-buffered-input-bytes'))).toBeLessThanOrEqual(128 * 1024);

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
  });

  it('processes PNG, WebP, and AVIF bodies in the worker', async () => {
    const png = await postFixture('sample.png', 'image/png', { width: 800, height: 800, quality: 85 });
    const webp = await postFixture('sample.webp', 'image/webp', { width: 800, height: 800, quality: 85 });
    const avif = await postFixture('sample.avif', 'image/avif', { width: 800, height: 800, quality: 85 });

    for (const response of [png, webp, avif]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(Number(response.headers.get('x-bytes-out'))).toBeGreaterThan(0);
      expect((response.headers.get('x-notes') ?? '').length).toBeGreaterThan(0);
    }
  });

  it('supports the streaming response helper in the worker', async () => {
    const response = await postFixture('large.jpg', 'image/jpeg', {
      width: 512,
      height: 512,
      quality: 80,
      stream: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-test-mode')).toBe('stream');

    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
