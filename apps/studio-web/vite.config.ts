import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep the dev cache outside the managed node_modules tree.
  cacheDir: '.vite-local',
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three-core'
          if (id.includes('/node_modules/@react-three/')) return 'react-three'
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react-runtime'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/artifacts': 'http://127.0.0.1:8010',
      '/uploads': 'http://127.0.0.1:8010',
    },
  },
})
