import { component, html, reactive } from '@arrow-js/core'
import { render } from '@arrow-js/framework'
import './styles.css'

const state = reactive({
  installTool: 'pnpm',
  presetId: 'standard-upload',
})

const installCommands = {
  pnpm: 'pnpm add @standardagents/sip',
  npm: 'npm install @standardagents/sip',
  yarn: 'yarn add @standardagents/sip',
}

const stats = [
  { value: '<1MB peak RAM', label: 'Streaming JPEG path on very large images' },
  { value: '128MB-safe', label: 'Designed for Cloudflare Workers limits' },
  { value: 'JPEG output', label: 'Universal output path with size control' },
]

const capabilities = [
  {
    title: 'Probe without decode',
    body: 'Read format, dimensions, and alpha data before committing to a full pipeline.',
  },
  {
    title: 'Resize with row buffers',
    body: 'The resize path only keeps the minimum rows needed for bilinear interpolation.',
  },
  {
    title: 'Stream JPEG with WASM',
    body: 'libjpeg-turbo enables DCT downscaling and scanline processing for large uploads.',
  },
]

const apiEntries = [
  {
    name: 'sip.probe(input)',
    summary: 'Inspect dimensions and format before processing.',
    points: [
      'Accepts ArrayBuffer or Uint8Array input.',
      'Returns format, width, height, and alpha support.',
      'Cheap enough to run before validation or storage decisions.',
    ],
  },
  {
    name: 'sip.process(input, options)',
    summary: 'Decode, resize, and encode to JPEG.',
    points: [
      'Targets width, height, bytes, and quality in one call.',
      'Preserves aspect ratio while fitting the requested bounds.',
      'Falls back through quality and dimensions when byte budgets are tight.',
    ],
  },
  {
    name: 'initStreaming()',
    summary: 'Warm the WASM path ahead of the first request.',
    points: [
      'Optional, but useful when you want to pay startup cost early.',
      'Returns whether the streaming path is available.',
      'Pairs well with worker startup hooks and tests.',
    ],
  },
]

const presets = [
  {
    id: 'standard-upload',
    title: 'Standard upload',
    description: 'General-purpose image normalization for user uploads.',
    options: {
      maxWidth: 2048,
      maxHeight: 2048,
      maxBytes: 1572864,
      quality: 85,
    },
  },
  {
    id: 'thumbnail',
    title: 'Thumbnail',
    description: 'Small previews that stay crisp without overspending bytes.',
    options: {
      maxWidth: 640,
      maxHeight: 640,
      maxBytes: 160000,
      quality: 78,
    },
  },
  {
    id: 'archive',
    title: 'Archive ingest',
    description: 'Higher retention ceiling for large source images and internal review.',
    options: {
      maxWidth: 4096,
      maxHeight: 4096,
      maxBytes: 4194304,
      quality: 90,
    },
  },
]

const wasmSteps = [
  'Install the Emscripten SDK and load its environment into your shell.',
  'Run pnpm build:wasm to compile libjpeg-turbo, libspng, and the sip bindings.',
  'Import dist/sip.js and register the loader when you want the streaming path.',
]

const examples = {
  process: `import { sip } from '@standardagents/sip'

const result = await sip.process(imageBuffer, {
  maxWidth: 2048,
  maxHeight: 2048,
  maxBytes: 1.5 * 1024 * 1024,
  quality: 85,
})

console.log(result.width, result.height)
console.log(result.originalFormat)
`,
  streaming: `import { initStreaming, sip } from '@standardagents/sip'
import createSipModule from '@standardagents/sip/dist/sip.js'

globalThis.__SIP_WASM_LOADER__ = async () => createSipModule()

await initStreaming()
const result = await sip.process(imageBuffer, { maxWidth: 1600 })
`,
}

const activePreset = () =>
  presets.find((preset) => preset.id === state.presetId) ?? presets[0]

const SectionTitle = component((props) => html`
  <header class="section-title">
    <span class="eyebrow">${() => props.eyebrow}</span>
    <h2>${() => props.title}</h2>
    <p>${() => props.body}</p>
  </header>
`)

const StatCard = component((props) => html`
  <article class="stat-card">
    <strong>${() => props.value}</strong>
    <span>${() => props.label}</span>
  </article>
`)

const FeatureCard = component((props) => html`
  <article class="feature-card">
    <h3>${() => props.title}</h3>
    <p>${() => props.body}</p>
  </article>
`)

const ApiCard = component((props) => html`
  <article class="api-card">
    <div class="api-card__header">
      <p class="api-card__name"><code>${() => props.name}</code></p>
      <p>${() => props.summary}</p>
    </div>
    <ul class="api-card__list">
      ${props.points.map((point) => html`<li>${point}</li>`)}
    </ul>
  </article>
`)

const App = component(() => html`
  <main class="shell">
    <section class="hero">
      <div class="hero__copy">
        <span class="eyebrow">Static Docs</span>
        <h1>@standardagents/sip</h1>
        <p class="hero__lede">
          Small Image Processor for Cloudflare Workers. It probes images cheaply,
          resizes with row buffers, and can stream JPEG processing through WASM
          when memory ceilings are tight.
        </p>
        <div class="hero__actions">
          <a href="#install" class="button button--primary">Install</a>
          <a href="#wasm" class="button">Build WASM</a>
        </div>
      </div>
      <div class="hero__panel">
        <div class="hero__code-label">Pipeline</div>
        <pre class="code-panel"><code>Probe -> Decode -> Resize -> Encode -> JPEG</code></pre>
        <p class="hero__panel-note">
          Streaming mode uses DCT downscaling and scanline processing to stay
          below the memory ceiling that breaks ordinary Workers uploads.
        </p>
      </div>
    </section>

    <section class="stats">
      ${stats.map((stat) => StatCard(stat))}
    </section>

    <section class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'Why sip',
          title: 'Built for oversized uploads in small runtimes',
          body:
            'The library is optimized for Cloudflare Workers, where decoding huge images into raw memory is usually what blows the request up.',
        })}
        <div class="feature-grid">
          ${capabilities.map((feature) => FeatureCard(feature))}
        </div>
      </div>
    </section>

    <section id="install" class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'Install',
          title: 'Start with the published package',
          body:
            'The coordinator and agentbuilder repos now consume sip as a published dependency, so the package contract matters on its own.',
        })}
        <div class="install-panel">
          <div class="install-tabs">
            ${Object.keys(installCommands).map((tool) => html`
              <button
                type="button"
                class="${() =>
                  state.installTool === tool ? 'chip chip--active' : 'chip'}"
                @click="${() => {
                  state.installTool = tool
                }}"
              >
                ${tool}
              </button>
            `)}
          </div>
          <pre class="code-panel"><code>${() => installCommands[state.installTool]}</code></pre>
        </div>
      </div>
      <aside class="section-grid__side">
        <div class="aside-card">
          <h3>Package contract</h3>
          <p>
            sip ships as a standalone npm package with its own docs, build,
            tests, and WASM artifacts.
          </p>
        </div>
      </aside>
    </section>

    <section id="api" class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'API surface',
          title: 'Small entrypoints, predictable behavior',
          body:
            'The public surface is intentionally narrow so downstream agentbuilder packages can treat image processing as infrastructure, not app logic.',
        })}
        <div class="api-grid">
          ${apiEntries.map((entry) => ApiCard(entry))}
        </div>
      </div>
    </section>

    <section id="presets" class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'Presets',
          title: 'Tune byte budgets without guessing',
          body:
            'These presets are examples, but they map closely to the actual decisions most apps need to make: previews, general uploads, and archival storage.',
        })}
        <div class="preset-grid">
          ${presets.map((preset) => html`
            <button
              type="button"
              class="${() =>
                state.presetId === preset.id
                  ? 'preset-card preset-card--active'
                  : 'preset-card'}"
              @click="${() => {
                state.presetId = preset.id
              }}"
            >
              <span class="preset-card__title">${preset.title}</span>
              <span class="preset-card__body">${preset.description}</span>
            </button>
          `)}
        </div>
      </div>
      <aside class="section-grid__side">
        <div class="aside-card">
          <h3>${() => activePreset().title}</h3>
          <p>${() => activePreset().description}</p>
          <pre class="code-panel code-panel--compact"><code>${() =>
            JSON.stringify(activePreset().options, null, 2)}</code></pre>
        </div>
      </aside>
    </section>

    <section id="wasm" class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'Streaming mode',
          title: 'Build the WASM path when memory matters most',
          body:
            'The package works without the optional WASM artifacts, but the streaming JPEG path is where sip gets its real leverage on very large files.',
        })}
        <div class="steps">
          ${wasmSteps.map((step, index) => html`
            <article class="step-card">
              <span class="step-card__index">0${index + 1}</span>
              <p>${step}</p>
            </article>
          `)}
        </div>
        <pre class="code-panel"><code>pnpm build:wasm
pnpm build
pnpm test:unit</code></pre>
      </div>
      <aside class="section-grid__side">
        <div class="aside-card">
          <h3>Generated artifacts</h3>
          <p>dist/sip.js loads the module and dist/sip.wasm contains the compiled codec path.</p>
        </div>
      </aside>
    </section>

    <section id="examples" class="section-grid">
      <div class="section-grid__main">
        ${SectionTitle({
          eyebrow: 'Examples',
          title: 'Use the high-level path first',
          body:
            'Most callers only need one processing call. Add the streaming loader when the runtime and traffic shape justify it.',
        })}
        <div class="example-grid">
          <article class="example-card">
            <h3>Process an upload</h3>
            <pre class="code-panel"><code>${examples.process}</code></pre>
          </article>
          <article class="example-card">
            <h3>Register the streaming loader</h3>
            <pre class="code-panel"><code>${examples.streaming}</code></pre>
          </article>
        </div>
      </div>
    </section>
  </main>
`)

const root = document.querySelector('#app')

if (!root) {
  throw new Error('Missing #app root for docs site')
}

render(root, App())
