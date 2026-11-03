import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/workspace-assets/',
  build: {outDir: 'dist', emptyOutDir: true, manifest: true, sourcemap: false},
})
