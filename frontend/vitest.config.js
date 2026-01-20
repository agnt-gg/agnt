import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import jsdom from 'jsdom'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    reporters: ['verbose'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})