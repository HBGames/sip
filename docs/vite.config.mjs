import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  root: rootDir,
  build: {
    emptyOutDir: true,
    outDir: resolve(rootDir, '../docs-dist'),
  },
})
