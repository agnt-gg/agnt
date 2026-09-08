// Function form supported by both Rollup (Vite 5) and Rolldown (Vite 8).
const groups = {
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
        };
export function vendorChunks(id) {
  const normalized = id.replaceAll('\\', '/');
  const marker = '/node_modules/';
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return;
  const parts = normalized.slice(at + marker.length).split('/');
  const pkg = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (pkg.startsWith('@vue/')) return 'vendor-vue';
  if (pkg.startsWith('d3-')) return 'vendor-charts';
  if (pkg.startsWith('@codemirror/') || pkg.startsWith('@lezer/')) return 'vendor-editor';
  for (const [name, packages] of Object.entries(groups)) {
    if (packages.includes(pkg)) return name;
  }
}
