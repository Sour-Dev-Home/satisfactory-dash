/// <reference types="vitest/config" />
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const PRODUCTION_HEADERS = new URL('./public/_headers', import.meta.url)
/** The demo site's own headers (ADR-0026): the production ones, with connect-src 'self' only. */
const DEMO_HEADERS = new URL('./demo/_headers', import.meta.url)

/**
 * The `/*` rules from a _headers file (public/_headers: the production security headers,
 * ADR-0016 item 8), so `vite preview` serves the built app under the same CSP as Workers
 * static assets.
 */
function headersFrom(file: URL): Record<string, string> {
  const headers: Record<string, string> = {}
  let inAllPaths = false
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
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

/**
 * The demo build (`--mode demo`, ADR-0026):
 * - client.ts's `./transport` resolves to src/demo/transport.ts (in-process answers, no
 *   network), so the network transport never reaches the demo bundle;
 * - demo/_headers replaces public/_headers in the output, after Vite copies public/;
 * - public/demo/ (the landing page's walkthrough video) is dropped: the demo has no landing.
 */
function demoBuild(): Plugin {
  const demoTransport = fileURLToPath(new URL('./src/demo/transport.ts', import.meta.url))
  let outDir = ''
  return {
    name: 'demo-build',
    enforce: 'pre',
    configResolved(config) {
      outDir = config.build.outDir
    },
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return
      const target = resolve(dirname(importer), source)
      if (!/[\\/]src[\\/]api[\\/]transport(\.ts)?$/.test(target)) return
      if (/[\\/]src[\\/]api[\\/]client\.ts$/.test(importer)) return demoTransport
      // Any other route to the network transport would put it in the demo bundle: fail the
      // build instead. (A type-only import is erased before this and never gets here.)
      this.error(`${importer} imports src/api/transport.ts; only client.ts may (ADR-0026 demo build).`)
    },
    closeBundle() {
      if (!outDir) return
      writeFileSync(join(outDir, '_headers'), readFileSync(DEMO_HEADERS, 'utf8'))
      rmSync(join(outDir, 'demo'), { recursive: true, force: true })
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
    // Tailwind (ADR-0016) compiles to a static CSS file at build time, so the CSP needs no
    // inline styles.
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === 'mock' ? [mockServiceWorker()] : []),
      ...(mode === 'demo' ? [demoBuild()] : []),
    ],
    // The demo build lands next to the production one, never over it.
    build: mode === 'demo' ? { outDir: 'dist-demo' } : undefined,
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
      headers: headersFrom(mode === 'demo' ? DEMO_HEADERS : PRODUCTION_HEADERS),
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
