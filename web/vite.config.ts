import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ported from Newsdesk web/vite.config.ts. The SPA is built into server/public and served by
// Fastify; in dev, /api and /mcp are proxied to the server process.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'
const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true'

/** A proxy failure would surface as a bare 500; say what actually happened, in the API's error envelope. */
const explainProxyErrors: ProxyOptions['configure'] = (proxy) => {
  proxy.on('error', (err, _req, res) => {
    if (!('writeHead' in res) || res.headersSent || res.writableEnded) return
    const refused = (err as Error & { code?: string }).code === 'ECONNREFUSED'
    res.writeHead(503, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        error: refused ? 'The API is not accepting connections — it is probably restarting. Try again in a moment.' : `Could not reach the API: ${err.message}`,
      }),
    )
  })
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../server/public', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    ...(usePolling ? { watch: { usePolling: true, interval: 500 } } : {}),
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, configure: explainProxyErrors },
      '/health': { target: apiTarget, changeOrigin: true, configure: explainProxyErrors },
    },
  },
})
