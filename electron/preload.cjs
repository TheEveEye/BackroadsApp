'use strict'
const { contextBridge } = require('electron')

// Expose a minimal, safe API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Example: add any APIs you might need later
  env: () => ({
    platform: process.platform,
    versions: process.versions,
  }),
})
