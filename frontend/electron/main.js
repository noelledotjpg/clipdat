import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win
let backend

function startBackend() {
  const isDev = !!process.env.VITE_DEV_SERVER_URL

  const backendPath = isDev
    ? path.join(__dirname, '../../backend/main.py')
    : path.join(process.resourcesPath, 'clipdat-backend.exe')

  if (isDev) {
    const venvPython = path.join(__dirname, '../../backend/venv/Scripts/python.exe')
    backend = spawn(venvPython, [backendPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    backend = spawn(backendPath, [], {
      stdio: 'ignore'
    })
  }

  backend.stdout?.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`)
  })

  backend.stderr?.on('data', (data) => {
    console.error(`[backend error] ${data.toString().trim()}`)
  })

  backend.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  startBackend()
  // Small delay to let Flask start before the window loads
  setTimeout(createWindow, 1500)
})

app.on('window-all-closed', () => {
  backend?.kill()
  if (process.platform !== 'darwin') app.quit()
})
