/**
 * Server-side render entry. Used by the prerender step at build time.
 *
 * Imports the App from main.js (the same file the client uses) and renders
 * it to an HTML string via @arrow-js/ssr.
 */

import { renderToString } from '@arrow-js/ssr'
import highlighted from 'virtual:highlighted-code'
import { App } from './main.js'

export async function renderPage() {
  const result = await renderToString(App())

  // Inline syntax-highlighted code blocks into the HTML so the static page
  // ships fully rendered. The client also runs this on hydration, but doing
  // it here means the static HTML already contains the highlighted markup.
  let html = result.html
  for (const [key, markup] of Object.entries(highlighted)) {
    const placeholder = `<div class="shiki-block" data-code="${key}"></div>`
    html = html.replace(placeholder, `<div class="shiki-block" data-code="${key}">${markup}</div>`)
  }

  return { html }
}
