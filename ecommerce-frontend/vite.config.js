import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Anything starting with /api is forwarded to Express. Because the browser
    // only ever talks to localhost:5173, there is no cross-origin problem and
    // cookies would work too. Leave VITE_API_URL unset to use this proxy.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
