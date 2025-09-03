import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Use GitHub Pages base by default; switch to relative for Electron builds
  const isElectron = mode === 'electron'
  return {
    base: isElectron ? './' : '/BackroadsApp/',
    plugins: [react()],
    build: {
      // Emit into build/ so GitHub Pages can serve from the main branch
      outDir: 'build',
      emptyOutDir: true,
    },
  }
})
