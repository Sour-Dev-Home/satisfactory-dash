/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The `/*` rules from public/_headers (the production security headers, ADR-0016 item 8),
 * so `vite preview` serves the built app under the same CSP as Workers static assets.
 */
function productionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  let inAllPaths = false
  for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#') || !line.trim()) continue
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*'
      continue
    }
    const match = /^\s+([^:]+):\s*(.+)$/.exec(line)
    if (inAllPaths && match) headers[match[1].trim()] = match[2].trim()
  }
  return headers
}

/**
 * Dev mock mode only: serves MSW's service worker from node_modules at the path MSW
 * expects, so the file is never copied into public/ and never deployed.
 */
function mockServiceWorker(): Plugin {
  const workerPath = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js')
  return {
    name: 'mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(workerPath))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Mock mode is dev-only: a mock build would ship MSW with no worker file (a blank page).
  if (command === 'build' && mode === 'mock') {
    throw new Error('Mock mode is for `vite` (dev) only; build without --mode mock.')
  }
  return {
    plugins: [react(), ...(mode === 'mock' ? [mockServiceWorker()] : [])],
    define: {
      // The deployed commit for the AGPL source link (src/source.ts). Cloudflare Workers
      // Builds sets WORKERS_CI_COMMIT_SHA; it's empty locally and in GitHub CI, so the link
      // falls back to the repo root and e2e screenshots stay stable.
      __COMMIT_SHA__: JSON.stringify(process.env.WORKERS_CI_COMMIT_SHA ?? ''),
    },
    server: {
      // Dev only: the browser calls /api on the Vite origin and Vite forwards it to the
      // backend, so cookies and CORS behave like production's single site (ADR-0013).
      // Mock mode answers /api in the browser instead, so it needs no backend.
      proxy: mode === 'mock' ? undefined : { '/api': 'http://localhost:3001' },
    },
    preview: {
      headers: productionHeaders(),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/vitest-setup.ts'],
      globals: true,
      // Playwright specs run in a real browser via `npm run e2e`, not in Vitest.
      exclude: ['**/node_modules/**', 'e2e/**'],
    },
  }
})
