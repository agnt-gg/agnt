import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import path from 'path';
import fs from 'fs-extra';

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
    vueJsx(),
    copyDirectoryPlugin({
      'src/assets/icons': 'assets/icons'
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
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

          // Utility libraries - shared across app
          'vendor-utils': [
            'axios',
            'dompurify',
            'showdown',
            'highlight.js',
            'date-fns',
            'lodash-es',
            'crypto-js'
          ],

          // Real-time & payments - loaded on demand
          'vendor-services': ['socket.io-client', '@stripe/stripe-js'],
        },
      },
    },
  },
});
