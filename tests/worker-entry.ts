// @ts-nocheck - workerd loads the generated Emscripten module dynamically
import createSipModule from '../dist/sip.js';
import sipWasm from '../dist/sip.wasm';
import avifDecoderWasm from '@jsquash/avif/codec/dec/avif_dec.wasm';
import webpDecoderWasm from '@jsquash/webp/codec/dec/webp_dec.wasm';
import { collect, ready, toResponse, transform } from '../src';

globalThis.__SIP_CODEC_WASM__ = {
  avif: avifDecoderWasm,
  webp: webpDecoderWasm,
};

globalThis.__SIP_WASM_LOADER__ = async () => {
  return createSipModule({
    instantiateWasm(
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => void
    ) {
      WebAssembly.instantiate(sipWasm, imports).then((instance) => {
        receiveInstance(instance);
      });
      return {};
    },
  });
};

let wasmReady: Promise<void> | null = null;

async function ensureReady() {
  if (!wasmReady) {
    wasmReady = ready();
  }
  await wasmReady;
}

function getOptions(url: URL) {
  return {
    width: Number(url.searchParams.get('width')) || undefined,
    height: Number(url.searchParams.get('height')) || undefined,
    quality: Number(url.searchParams.get('quality')) || undefined,
  };
}

export default {
  async fetch(request: Request, env: { ASSETS?: Fetcher }): Promise<Response> {
    await ensureReady();

    const url = new URL(request.url);
    if (request.method === 'GET' && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return new Response('Use POST', { status: 405 });
    }

    const image = transform(request.body ?? request, getOptions(url));

    if (url.pathname === '/stream') {
      return toResponse(image, {
        headers: {
          'X-Test-Mode': 'stream',
        },
      });
    }

    const result = await collect(image);
    return new Response(result.data, {
      headers: {
        'Content-Type': result.info.mimeType,
        'X-Output-Width': String(result.info.width),
        'X-Output-Height': String(result.info.height),
        'X-Original-Format': result.info.originalFormat,
        'X-Peak-Pipeline-Bytes': String(result.stats.peakPipelineBytes),
        'X-Peak-Codec-Bytes': String(result.stats.peakCodecBytes),
        'X-Peak-Buffered-Input-Bytes': String(result.stats.peakBufferedInputBytes),
        'X-Peak-Buffered-Output-Bytes': String(result.stats.peakBufferedOutputBytes),
        'X-Bytes-In': String(result.stats.bytesIn),
        'X-Bytes-Out': String(result.stats.bytesOut),
        'X-Notes': result.stats.notes.join(','),
      },
    });
  },
};
