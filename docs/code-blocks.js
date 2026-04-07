export const codeBlocks = {
  pipeline: {
    lang: 'text',
    code: `
request.body -> inspect() -> decode -> resize -> encodeJpeg -> Response
`,
  },
  install: {
    lang: 'shell',
    code: `
pnpm add @standardagents/sip
`,
  },
  workerStream: {
    lang: 'typescript',
    code: `
import { ready, transform, toResponse } from '@standardagents/sip'
import createSipModule from '@standardagents/sip/dist/sip.js'
import sipWasm from '@standardagents/sip/dist/sip.wasm'

globalThis.__SIP_WASM_LOADER__ = async () =>
  createSipModule({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(sipWasm, imports).then((instance) => {
        receiveInstance(instance)
      })
      return {}
    },
  })

let boot: Promise<void> | undefined

export default {
  async fetch(request: Request) {
    boot ??= ready()
    await boot

    const url = new URL(request.url)
    const width = Number(url.searchParams.get('width')) || 1024
    const height = Number(url.searchParams.get('height')) || 1024

    const image = transform(request.body ?? request, {
      width,
      height,
      quality: 82,
    })

    return toResponse(image, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  },
}
`,
  },
  inspect: {
    lang: 'typescript',
    code: `
import { inspect, toResponse, transform } from '@standardagents/sip'

const { info, source } = await inspect(request)

if (info.width > 12_000 || info.height > 12_000) {
  return Response.json({ error: 'Image is too large' }, { status: 413 })
}

if (!['jpeg', 'png', 'webp', 'avif'].includes(info.format)) {
  return Response.json({ error: 'Unsupported format' }, { status: 415 })
}

return toResponse(transform(source, { width: 1600, height: 1600 }))
`,
  },
  manual: {
    lang: 'typescript',
    code: `
import { decode, encodeJpeg, inspect, resize, toResponse } from '@standardagents/sip'

const { source } = await inspect(request)
const pixels = decode(source)
const resized = resize(pixels, { width: 960, height: 960 })
const jpeg = encodeJpeg(resized, { quality: 78 })

return toResponse(jpeg)
`,
  },
  collect: {
    lang: 'typescript',
    code: `
import { collect, transform } from '@standardagents/sip'

const image = transform(bytes, { width: 512, height: 512, quality: 80 })
const { data, info, stats } = await collect(image)

console.log(info.width, info.height, info.originalFormat)
console.log(stats.peakPipelineBytes, stats.peakCodecBytes)
`,
  },
  memory: {
    lang: 'typescript',
    code: `
const image = transform(request.body ?? request, { width: 1200, height: 1200 })
const { stats } = await collect(image)

console.log({
  // Total memory SIP itself used during the transform.
  peakSipMemoryBytes: stats.peakPipelineBytes,
  // Decoder + encoder portion of that total.
  peakCodecMemoryBytes: stats.peakCodecBytes,
  peakBufferedInputBytes: stats.peakBufferedInputBytes,
  peakBufferedOutputBytes: stats.peakBufferedOutputBytes,
})
`,
  },
  loader: {
    lang: 'typescript',
    code: `
import { ready } from '@standardagents/sip'
import createSipModule from '@standardagents/sip/dist/sip.js'
import sipWasm from '@standardagents/sip/dist/sip.wasm'

globalThis.__SIP_WASM_LOADER__ = async () =>
  createSipModule({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(sipWasm, imports).then((instance) => {
        receiveInstance(instance)
      })
      return {}
    },
  })

await ready()
`,
  },
  build: {
    lang: 'shell',
    code: `
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh

pnpm build:wasm
pnpm build:code
pnpm test:unit
pnpm test:workers
`,
  },
}
