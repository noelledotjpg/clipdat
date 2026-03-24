import os
import json
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")

def log(msg):
    print(f"  {msg}")

def rename(src, dst):
    if os.path.exists(src):
        os.rename(src, dst)
        log(f"Renamed: {os.path.relpath(src, ROOT)} -> {os.path.relpath(dst, ROOT)}")
    else:
        log(f"Skipped (not found): {os.path.relpath(src, ROOT)}")

def delete(path):
    if os.path.exists(path):
        os.remove(path)
        log(f"Deleted: {os.path.relpath(path, ROOT)}")
    else:
        log(f"Skipped (not found): {os.path.relpath(path, ROOT)}")

def write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    log(f"Written: {os.path.relpath(path, ROOT)}")


print("\n[1/5] Renaming electron/ files...")
rename(
    os.path.join(FRONTEND, "electron", "main.ts"),
    os.path.join(FRONTEND, "electron", "main.js")
)
rename(
    os.path.join(FRONTEND, "electron", "preload.ts"),
    os.path.join(FRONTEND, "electron", "preload.js")
)
delete(os.path.join(FRONTEND, "electron", "electron-env.d.ts"))


print("\n[2/5] Renaming src/ files...")
rename(
    os.path.join(FRONTEND, "src", "main.ts"),
    os.path.join(FRONTEND, "src", "main.js")
)
rename(
    os.path.join(FRONTEND, "src", "counter.ts"),
    os.path.join(FRONTEND, "src", "counter.js")
)
delete(os.path.join(FRONTEND, "src", "vite-env.d.ts"))


print("\n[3/5] Writing vite.config.js...")
delete(os.path.join(FRONTEND, "vite.config.ts"))
vite_config = """\
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    electron({
      main: { entry: 'electron/main.js' },
      preload: { input: 'electron/preload.js' },
      renderer: {}
    })
  ]
})
"""
write(os.path.join(FRONTEND, "vite.config.js"), vite_config)


print("\n[4/5] Updating package.json...")
pkg_path = os.path.join(FRONTEND, "package.json")
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)

# Remove TypeScript dev dependencies
ts_deps = ["typescript", "@types/node"]
removed = []
for dep in ts_deps:
    if dep in pkg.get("devDependencies", {}):
        del pkg["devDependencies"][dep]
        removed.append(dep)

if removed:
    log(f"Removed devDependencies: {', '.join(removed)}")
else:
    log("No TypeScript devDependencies found to remove")

with open(pkg_path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, indent=2)
log("package.json updated")


print("\n[5/5] Deleting tsconfig.json...")
delete(os.path.join(FRONTEND, "tsconfig.json"))


print("\n✓ Done! Your frontend is now plain JavaScript.")
print("  Run 'npm run dev' inside frontend/ to verify everything works.\n")
