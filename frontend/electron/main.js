import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win     = null
let tray    = null
let backend = null

// ── backend ───────────────────────────────────────────────────────

function startBackend() {
  const isDev       = !!process.env.VITE_DEV_SERVER_URL
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

// ── global shortcuts ──────────────────────────────────────────────

// Read hotkeys from backend settings.json directly (no HTTP at this point)
function readHotkeys() {
  try {
    const settingsPath = path.join(__dirname, '../../backend/settings.json')
    const data = JSON.parse(readFileSync(settingsPath, 'utf8'))
    return {
      save_clip:        data?.hotkeys?.save_clip        || 'F8',
      toggle_recording: data?.hotkeys?.toggle_recording || 'F9',
      open_browser:     data?.hotkeys?.open_browser     || 'F10',
    }
  } catch {
    return { save_clip: 'F8', toggle_recording: 'F9', open_browser: 'F10' }
  }
}

function electronKey(key) {
  // Convert clipdat key labels to Electron accelerator format
  if (key.startsWith('F') && !isNaN(key.slice(1))) return key  // F1-F24
  if (key === 'Space') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

async function callBackend(path) {
  try {
    const { default: http } = await import('node:http')
    return new Promise(resolve => {
      const req = http.request({ hostname: 'localhost', port: 9847, path, method: 'POST' }, res => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => resolve(false))
      req.end()
    })
  } catch {
    return false
  }
}

function registerGlobalShortcuts(hotkeys) {
  globalShortcut.unregisterAll()

  const saveKey   = electronKey(hotkeys.save_clip)
  const toggleKey = electronKey(hotkeys.toggle_recording)
  const focusKey  = electronKey(hotkeys.open_browser)

  try {
    globalShortcut.register(saveKey, () => {
      callBackend('/capture/clip')
    })
  } catch (e) {
    console.error(`[shortcuts] failed to register save key (${saveKey}):`, e.message)
  }

  try {
    globalShortcut.register(toggleKey, () => {
      callBackend('/capture/toggle')
    })
  } catch (e) {
    console.error(`[shortcuts] failed to register toggle key (${toggleKey}):`, e.message)
  }

  try {
    globalShortcut.register(focusKey, () => {
      win?.show()
      win?.focus()
    })
  } catch (e) {
    console.error(`[shortcuts] failed to register focus key (${focusKey}):`, e.message)
  }

  console.log(`[shortcuts] registered: save=${saveKey} toggle=${toggleKey} focus=${focusKey}`)
}

// ── tray ──────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '../../frontend/src/img/icon_titlebar.png')
  const icon     = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray           = new Tray(icon)
  tray.setToolTip('clipdat!')

  const menu = Menu.buildFromTemplate([
    { label: 'Show clipdat',      click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
    { label: 'Start recording',   click: () => callBackend('/capture/start') },
    { label: 'Stop recording',    click: () => callBackend('/capture/stop') },
    { label: 'Save clip',         click: () => callBackend('/capture/clip') },
    { type: 'separator' },
    { label: 'Quit',              click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => { win?.show(); win?.focus() })
}

// ── window ────────────────────────────────────────────────────────

function createWindow() {
  const iconPath    = path.join(__dirname, '../../frontend/src/img/icon_titlebar.png')
  const icon        = nativeImage.createFromPath(iconPath)
  const preloadPath = process.env.ELECTRON_PRELOAD || path.join(__dirname, 'preload.js')

  win = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 1000,
    minHeight: 500,
    frame: true,
    icon,
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

// ── IPC ───────────────────────────────────────────────────────────

ipcMain.on('minimize-to-tray', () => win?.hide())

// Renderer sends updated hotkeys after the user rebinds them
ipcMain.on('update-hotkeys', (_event, hotkeys) => {
  registerGlobalShortcuts(hotkeys)
})

// Native file picker — used by Games & Apps panel to browse for .exe files
ipcMain.handle('open-file-dialog', async (_event, opts = {}) => {
  if (!win) return []
  const result = await dialog.showOpenDialog(win, {
    title:       opts.title       || 'Select executable',
    buttonLabel: opts.buttonLabel || 'Select',
    filters:     opts.filters     || [{ name: 'Executable', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }],
    properties:  opts.properties  || ['openFile', 'multiSelections'],
    defaultPath: opts.defaultPath || 'C:\\Program Files',
  })
  return result.canceled ? [] : result.filePaths
})

// ── app lifecycle ─────────────────────────────────────────────────

app.whenReady().then(() => {
  startBackend()

  // Register shortcuts immediately using saved settings
  const hotkeys = readHotkeys()
  registerGlobalShortcuts(hotkeys)

  // Wait for backend to be ready before opening the window
  setTimeout(() => {
    createWindow()
    createTray()
  }, 1500)
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  app.isQuitting = true
  globalShortcut.unregisterAll()
  backend?.kill()
})
app.on('activate', () => win?.show())
