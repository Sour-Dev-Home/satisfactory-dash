// Must stay the first import: it turns on zod's jitless mode before anything parses, so zod
// never probes `new Function("")`, which the strict CSP reports. main.test.ts enforces this.
import '@satisfactory-dash/shared/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { createQueryClient } from './api/queries'

// Dev mock mode (`npm run dev:mock`) serves the shared fixtures in the browser. MODE is a
// build-time constant, so a production build drops this branch and never emits the mock code.
async function startMocksIfEnabled(): Promise<void> {
  if (import.meta.env.MODE !== 'mock') return
  const { startMockApi } = await import('./test/browser')
  await startMockApi(window.location.search)
}

void startMocksIfEnabled().then(() => {
  const queryClient = createQueryClient()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
