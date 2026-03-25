import { ipcMain, app, nativeImage, BrowserWindow, Menu, Tray } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
let win = null;
let tray = null;
let backend = null;
function startBackend() {
  var _a, _b;
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const backendPath = isDev ? path.join(__dirname$1, "../../backend/main.py") : path.join(process.resourcesPath, "clipdat-backend.exe");
  if (isDev) {
    const venvPython = path.join(__dirname$1, "../../backend/venv/Scripts/python.exe");
    backend = spawn(venvPython, [backendPath], { stdio: ["ignore", "pipe", "pipe"] });
  } else {
    backend = spawn(backendPath, [], { stdio: "ignore" });
  }
  (_a = backend.stdout) == null ? void 0 : _a.on("data", (d) => console.log(`[backend] ${d.toString().trim()}`));
  (_b = backend.stderr) == null ? void 0 : _b.on("data", (d) => console.error(`[backend err] ${d.toString().trim()}`));
  backend.on("exit", (code) => console.log(`[backend] exited with code ${code}`));
}
function createTray() {
  const iconPath = path.join(__dirname$1, "../../frontend/src/img/icon_titlebar.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("clipdat!");
  const menu = Menu.buildFromTemplate([
    { label: "Show clipdat", click: () => {
      win == null ? void 0 : win.show();
      win == null ? void 0 : win.focus();
    } },
    { type: "separator" },
    { label: "Quit", click: () => {
      app.isQuitting = true;
      app.quit();
    } }
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    win == null ? void 0 : win.show();
    win == null ? void 0 : win.focus();
  });
}
function createWindow() {
  const iconPath = path.join(__dirname$1, "../../frontend/src/img/icon_titlebar.png");
  const icon = nativeImage.createFromPath(iconPath);
  const preloadPath = process.env.ELECTRON_PRELOAD || path.join(__dirname$1, "preload.js");
  win = new BrowserWindow({
    width: 1200,
    height: 680,
    minWidth: 700,
    minHeight: 500,
    frame: true,
    icon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  Menu.setApplicationMenu(null);
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}
ipcMain.on("minimize-to-tray", () => win == null ? void 0 : win.hide());
app.whenReady().then(() => {
  startBackend();
  setTimeout(() => {
    createWindow();
    createTray();
  }, 1500);
});
app.on("window-all-closed", () => {
});
app.on("before-quit", () => {
  app.isQuitting = true;
  backend == null ? void 0 : backend.kill();
});
app.on("activate", () => win == null ? void 0 : win.show());
