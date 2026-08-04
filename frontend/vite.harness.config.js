/**
 * Verification-only build for _harness/shelf.html.
 *
 * Separate config so the harness can never leak into the shipped bundle, and so
 * it does not run the app's dependency guard on an unrelated entrypoint.
 * Output goes to _harness/dist, which is gitignored.
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '_harness'),
  base: './',
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: path.resolve(__dirname, '_harness/dist'),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, '_harness/shelf.html') },
  },
});
