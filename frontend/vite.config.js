import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import fs from 'fs-extra';
import { preserveHashedAssets } from './build/assetRetention.js';
import { verifyDeps } from './build/verifyDeps.js';

// Fail here, loudly and self-namingly, if a concurrent npm run pruned the
// shared node_modules — instead of dying mid-build on a transitive package
// name that appears in no package.json. See build/verifyDeps.js for history.
verifyDeps(fileURLToPath(new URL('.', import.meta.url)));

// Custom plugin to copy directories
const copyDirectoryPlugin = (directories) => ({
  name: 'copy-directory',
  writeBundle: async () => {
    for (const [src, dest] of Object.entries(directories)) {
      await fs.copy(src, path.resolve(__dirname, 'dist', dest), { overwrite: true });
    }
  }
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        // Define a function to check if an element is considered a custom element.
        compilerOptions: {
          isCustomElement: (tag) => tag.includes('-'),
        },
      },
    }),
    copyDirectoryPlugin({
      'src/assets/icons': 'assets/icons'
    }),
    // Keeps hashes that a previous build emitted alive for a retention window
    // instead of deleting them the moment they stop being current. Required by
    // emptyOutDir:false below — see build/assetRetention.js for why.
    preserveHashedAssets(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // The backend serves dist/ IN PLACE. Wiping it mid-session deletes the
    // content hashes an already-open renderer is still holding, so its
    // not-yet-loaded lazy screens 404 into the SPA catch-all and render blank.
    // Retirement is handled on a timer by preserveHashedAssets() instead.
    // Set AGNT_ASSET_RETENTION_DAYS=0 for a packaged release build.
    emptyOutDir: false,
    // Inline small assets as base64 data URLs (default 4KB)
    // Raised to 10KB so annie-avatar.png (8KB) is embedded directly
    // instead of requiring a separate HTTP request that competes with JS chunks
    assetsInlineLimit: 10240,
    rollupOptions: {
      output: {
        // Include a content hash in the filenames to ensure browsers fetch updated files
        entryFileNames: 'assets/js/[name].[hash].js',
        chunkFileNames: 'assets/js/[name].[hash].js',
        assetFileNames: 'assets/[ext]/[name].[hash].[ext]',

        // Manual chunks for better code splitting and caching
        // Separates vendor libraries so they can be cached independently
        manualChunks: {
          // Core Vue ecosystem - rarely changes, cache long-term
          'vendor-vue': ['vue', 'vue-router', 'vuex'],

          // Charting libraries - only used in Dashboard
          'vendor-charts': ['chart.js', 'chartjs-plugin-datalabels', 'd3'],

          // Code editor - only used in ToolForge
          'vendor-editor': [
            '@codemirror/lang-javascript',
            '@codemirror/lang-python',
            '@codemirror/theme-one-dark',
            'vue-codemirror'
          ],

          // 3D graphics - only used in BallJumper minigame
          'vendor-3d': ['three'],

          // HTTP client - imported eagerly by main.js, keep tiny and separate
          'vendor-axios': ['axios'],

          // Markdown rendering - only when chat messages render.
          // NOTE (PRD-105): highlight.js must NOT be fused here. showdown is
          // statically imported by MessageItem (eager via Chat screen), which
          // would drag the ~950KB of hljs grammars into the modulepreload
          // graph. All hljs usage is dynamic import — leaving it out of
          // manualChunks lets Rollup emit it as its own lazy chunk.
          'vendor-markdown': ['dompurify', 'showdown'],

          // Encryption - only when provider setup / onboarding triggers
          'vendor-crypto': ['crypto-js'],

          // Lightweight utilities - broadly used across app
          'vendor-utils': ['date-fns', 'lodash-es'],

          // Real-time & payments - loaded on demand
          'vendor-services': ['socket.io-client', '@stripe/stripe-js'],
        },
      },
    },
  },
});
