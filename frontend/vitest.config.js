import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import jsdom from 'jsdom'
import { onUnhandledError } from '../tests/setup/unhandledErrorFilter.mjs'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    reporters: ['verbose'],
    passWithNoTests: true,
    // Mirrors the global registrations main.js makes on the real app.
    setupFiles: ['./vitest.setup.js'],
    // Drops only the vitest worker-teardown "onUserConsoleLog" rpc race that
    // fails CI with all tests green. See tests/setup/unhandledErrorFilter.mjs.
    onUnhandledError,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})