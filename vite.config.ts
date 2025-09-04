import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // App is hosted at a custom domain root (backroads.kiwiapps.dev)
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
})
