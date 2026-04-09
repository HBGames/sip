#!/usr/bin/env node

/**
 * Prerender the docs site to a static HTML string and inject it into the
 * built index.html. Runs after `vite build` completes.
 *
 * Strategy:
 * 1. Spin up a Vite dev server in middleware mode (no HTTP listener).
 * 2. Use vite.ssrLoadModule to import docs/entry-server.js, which renders
 *    the App component to a string via @arrow-js/ssr (which uses jsdom).
 * 3. Read the built docs-dist/client/index.html, replace the empty
 *    <div id="app"></div> with the rendered HTML.
 * 4. Write the file back.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { createServer } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(__dirname, '..')
const repoRoot = resolve(docsDir, '..')
const builtIndex = resolve(repoRoot, 'docs-dist/client/index.html')

if (!existsSync(builtIndex)) {
  console.error(`[prerender] missing ${builtIndex}. Run vite build first.`)
  process.exit(1)
}

console.log('[prerender] starting Vite SSR runtime...')

// Create a Vite dev server in middleware mode just to get an SSR module loader.
// We disable hmr and middlewareMode so it doesn't try to bind to a port.
const vite = await createServer({
  root: docsDir,
  configFile: resolve(docsDir, 'vite.config.mjs'),
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true },
  // Disable the cloudflare plugin during prerender — we only need the
  // shiki plugin and basic vite resolution. The cloudflare plugin tries
  // to spin up workerd which we don't want here.
})

try {
  console.log('[prerender] loading entry-server...')
  const mod = await vite.ssrLoadModule('/entry-server.js')
  console.log('[prerender] rendering App to string...')
  const { html } = await mod.renderPage()

  console.log(`[prerender] rendered ${html.length} chars of HTML`)

  const template = readFileSync(builtIndex, 'utf8')
  const empty = /<div id="app"><\/div>/
  if (!empty.test(template)) {
    console.warn('[prerender] could not find empty <div id="app"></div> in built index.html — leaving file unchanged')
    process.exit(0)
  }

  const patched = template.replace(empty, `<div id="app">${html}</div>`)
  writeFileSync(builtIndex, patched)
  console.log(`[prerender] wrote ${builtIndex}`)
} catch (err) {
  console.error('[prerender] failed:', err)
  process.exit(1)
} finally {
  await vite.close()
}
