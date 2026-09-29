import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, './src'),
      // jspdf / старые импорты: html2canvas без oklch → форк с поддержкой
      html2canvas: path.resolve(projectRoot, 'node_modules/html2canvas-pro'),
    },
  },
  optimizeDeps: {
    include: ['html2canvas-pro'],
  },
})
