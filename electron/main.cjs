let el
try {
  el = require('node:electron')
} catch {
  el = require('electron')
}
console.log('[main.cjs] typeof electron import:', typeof el)
console.log('[main.cjs] value sample:', String(el).slice(0, 120))
console.log('[main.cjs] process.versions.electron:', process.versions && process.versions.electron)
const { app, BrowserWindow, shell } = el
const path = require('path')

let mainWindow

const isMac = process.platform === 'darwin'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const isDev = !app.isPackaged

  if (isDev) {
    const devServerURL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173/BackroadsApp/'
    mainWindow.loadURL(devServerURL)
    mainWindow.webContents.once('dom-ready', () => {
      mainWindow.show()
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    const indexHtml = path.resolve(__dirname, '../build/index.html')
    mainWindow.loadFile(indexHtml)
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
