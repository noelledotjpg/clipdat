import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

export default defineConfig({
  plugins: [
    electron({
      main: { entry: 'electron/main.js' },
      preload: {
        input: 'electron/preload.js',
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: 'preload.js',
              }
            }
          }
        }
      },
      renderer: {}
    })
  ]
})