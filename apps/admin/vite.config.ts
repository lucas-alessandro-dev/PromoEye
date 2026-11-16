import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // O painel é servido em /painel pelo Fastify.
  base: '/painel/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    // Em dev, a API e o redirecionador /ir continuam vindo do Fastify.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ir': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
