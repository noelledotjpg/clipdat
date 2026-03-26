import { ipcMain, app, globalShortcut, nativeImage, BrowserWindow, Menu, Tray } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
function readHotkeys() {
  var _a, _b, _c;
  try {
    const settingsPath = path.join(__dirname$1, "../../backend/settings.json");
    const data = JSON.parse(readFileSync(settingsPath, "utf8"));
    return {
      save_clip: ((_a = data == null ? void 0 : data.hotkeys) == null ? void 0 : _a.save_clip) || "F8",
      toggle_recording: ((_b = data == null ? void 0 : data.hotkeys) == null ? void 0 : _b.toggle_recording) || "F9",
      open_browser: ((_c = data == null ? void 0 : data.hotkeys) == null ? void 0 : _c.open_browser) || "F10"
    };
  } catch {
    return { save_clip: "F8", toggle_recording: "F9", open_browser: "F10" };
  }
}
function electronKey(key) {
  if (key.startsWith("F") && !isNaN(key.slice(1))) return key;
  if (key === "Space") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}
async function callBackend(path2) {
  try {
    const { default: http } = await import("node:http");
    return new Promise((resolve) => {
      const req = http.request({ hostname: "localhost", port: 9847, path: path2, method: "POST" }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.end();
    });
  } catch {
    return false;
  }
}
function registerGlobalShortcuts(hotkeys) {
  globalShortcut.unregisterAll();
  const saveKey = electronKey(hotkeys.save_clip);
  const toggleKey = electronKey(hotkeys.toggle_recording);
  const focusKey = electronKey(hotkeys.open_browser);
  try {
    globalShortcut.register(saveKey, () => {
      callBackend("/capture/clip");
    });
  } catch (e) {
    console.error(`[shortcuts] failed to register save key (${saveKey}):`, e.message);
  }
  try {
    globalShortcut.register(toggleKey, () => {
      callBackend("/capture/toggle");
    });
  } catch (e) {
    console.error(`[shortcuts] failed to register toggle key (${toggleKey}):`, e.message);
  }
  try {
    globalShortcut.register(focusKey, () => {
      win == null ? void 0 : win.show();
      win == null ? void 0 : win.focus();
    });
  } catch (e) {
    console.error(`[shortcuts] failed to register focus key (${focusKey}):`, e.message);
  }
  console.log(`[shortcuts] registered: save=${saveKey} toggle=${toggleKey} focus=${focusKey}`);
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
    { label: "Start recording", click: () => callBackend("/capture/start") },
    { label: "Stop recording", click: () => callBackend("/capture/stop") },
    { label: "Save clip", click: () => callBackend("/capture/clip") },
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
    height: 720,
    minWidth: 1e3,
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
ipcMain.on("update-hotkeys", (_event, hotkeys) => {
  registerGlobalShortcuts(hotkeys);
});
app.whenReady().then(() => {
  startBackend();
  const hotkeys = readHotkeys();
  registerGlobalShortcuts(hotkeys);
  setTimeout(() => {
    createWindow();
    createTray();
  }, 1500);
});
app.on("window-all-closed", () => {
});
app.on("before-quit", () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  backend == null ? void 0 : backend.kill();
});
app.on("activate", () => win == null ? void 0 : win.show());
