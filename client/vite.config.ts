import {readFileSync} from 'node:fs'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// the release the workspace belongs to: one number, in the package.json of the repository
const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}

export default defineConfig({
  plugins: [vue()],
  base: '/workspace-assets/',
  define: {__APP_VERSION__: JSON.stringify(version)},
  build: {outDir: 'dist', emptyOutDir: true, manifest: true, sourcemap: false},
})
