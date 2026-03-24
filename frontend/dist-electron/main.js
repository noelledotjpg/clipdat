import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
let win;
let backend;
function startBackend() {
  var _a, _b;
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const backendPath = isDev ? path.join(__dirname$1, "../../backend/main.py") : path.join(process.resourcesPath, "clipdat-backend.exe");
  if (isDev) {
    const venvPython = path.join(__dirname$1, "../../backend/venv/Scripts/python.exe");
    backend = spawn(venvPython, [backendPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } else {
    backend = spawn(backendPath, [], {
      stdio: "ignore"
    });
  }
  (_a = backend.stdout) == null ? void 0 : _a.on("data", (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });
  (_b = backend.stderr) == null ? void 0 : _b.on("data", (data) => {
    console.error(`[backend error] ${data.toString().trim()}`);
  });
  backend.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js")
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
}
app.whenReady().then(() => {
  startBackend();
  setTimeout(createWindow, 1500);
});
app.on("window-all-closed", () => {
  backend == null ? void 0 : backend.kill();
  if (process.platform !== "darwin") app.quit();
});
