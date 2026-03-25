import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win = null
let tray = null
let backend = null

function startBackend() {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  const backendPath = isDev
    ? path.join(__dirname, '../../backend/main.py')
    : path.join(process.resourcesPath, 'clipdat-backend.exe')

  if (isDev) {
    const venvPython = path.join(__dirname, '../../backend/venv/Scripts/python.exe')
    backend = spawn(venvPython, [backendPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  } else {
    backend = spawn(backendPath, [], { stdio: 'ignore' })
  }

  backend.stdout?.on('data', d => console.log(`[backend] ${d.toString().trim()}`))
  backend.stderr?.on('data', d => console.error(`[backend err] ${d.toString().trim()}`))
  backend.on('exit', code => console.log(`[backend] exited with code ${code}`))
}

function createTray() {
  const iconPath = path.join(__dirname, '../../frontend/src/img/icon_titlebar.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('clipdat!')
  const menu = Menu.buildFromTemplate([
    { label: 'Show clipdat', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => { win?.show(); win?.focus() })
}

function createWindow() {
  const iconPath = path.join(__dirname, '../../frontend/src/img/icon_titlebar.png')
  const icon = nativeImage.createFromPath(iconPath)
  const preloadPath = process.env.ELECTRON_PRELOAD || path.join(__dirname, 'preload.js')

  win = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 1000,
    minHeight: 500,
    frame: true,
    icon: icon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  Menu.setApplicationMenu(null)

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

ipcMain.on('minimize-to-tray', () => win?.hide())

app.whenReady().then(() => {
  startBackend()
  setTimeout(() => { createWindow(); createTray() }, 1500)
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => { app.isQuitting = true; backend?.kill() })
app.on('activate', () => win?.show())