import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import jsdom from 'jsdom'
import { onUnhandledError } from '../tests/setup/unhandledErrorFilter.mjs'
import { verifyDeps } from './build/verifyDeps.js'
import { aliases } from './build/aliases.js'

// Same guard as vite.config.js: refuse to start on a node_modules that has
// drifted from the lockfile, with an error that names the real cause.
verifyDeps(__dirname)

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
  // Shared with vite.config.js. Tests must resolve exactly what the build
  // resolves, or a passing suite proves nothing about the shipped bundle.
  resolve: { alias: aliases },
  // TermsPrivacyModal imports LICENSE.md?raw. `vitest related` walks the
  // import graph without the ?raw query and tried to parse the markdown as
  // JavaScript, aborting before a single test ran — so `npm run
  // test:impacted` gave frontend changes no coverage at all. Declaring
  // markdown an asset fixes the graph walk; ?raw still yields the text.
  assetsInclude: ['**/*.md'],
})