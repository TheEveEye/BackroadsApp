import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use a relative base so the app works when hosted under a subpath (e.g., GitHub Pages project site)
  base: './',
  plugins: [react()],
  build: {
    // Emit into docs/ so GitHub Pages can serve from the main branch
    outDir: 'docs',
    emptyOutDir: true,
  },
})
