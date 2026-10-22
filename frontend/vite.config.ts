import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// AGENT_PORT: when :8000 is taken by another project on this machine.
const agent = `localhost:${process.env.AGENT_PORT ?? 8000}`

export default defineConfig({
  plugins: [react()],
  server: {
    // The agent server (backend/, uvicorn on :8000) serves the WebSocket and the health check.
    proxy: {
      '/ws': { target: `ws://${agent}`, ws: true },
      '/api': `http://${agent}`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
