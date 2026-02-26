<template>
  <span class="svg-icon" v-html="svgContent"></span>
</template>

<script>
// Pre-load all SVGs at build time via Vite glob import (raw strings)
const svgModules = import.meta.glob('/src/assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// Build a name -> content map at module load (instant, no network requests)
const svgCache = new Map();

const gradientDef = `
  <linearGradient id="SVG-Gradient" gradientTransform="rotate(-45)">
    <stop offset="0%" stop-color="#E53d8F" />
    <stop offset="50%" stop-color="#3E405A" />
  </linearGradient>
  <linearGradient id="SVG-Gradient-Dark" gradientTransform="rotate(-45)">
    <stop offset="0%" stop-color="#19EF83" />
    <stop offset="50%" stop-color="#12E0FF" />
  </linearGradient>
`;

function injectGradient(svgContent) {
  const match = svgContent.match(/<svg[^>]*>/i);
  if (match) {
    const i = match.index + match[0].length;
    return svgContent.slice(0, i) + `<defs>${gradientDef}</defs>` + svgContent.slice(i);
  }
  return svgContent;
}

for (const [path, raw] of Object.entries(svgModules)) {
  // Extract icon name from path: "/src/assets/icons/agent.svg" -> "agent"
  const name = path.split('/').pop().replace('.svg', '');
  if (raw.trim().toLowerCase().startsWith('<svg')) {
    svgCache.set(name, injectGradient(raw));
  } else {
    svgCache.set(name, '');
  }
}

export default {
  name: 'SvgIcon',
  props: {
    name: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      svgContent: svgCache.get(this.name) || '',
    };
  },
  watch: {
    name(newName) {
      this.svgContent = svgCache.get(newName) || '';
    },
  },
};
</script>

<style>
body.dark .svg-icon path[fill] {
  fill: var(--color-dull-white);
}

body.dark .svg-icon path[stroke] {
  stroke: var(--color-dull-white);
}

body.dark .svg-icon rect[stroke] {
  stroke: var(--color-dull-white);
}
</style>

<style scoped>
span.svg-icon {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: center;
  align-items: center;
}

#sidebar.closed .node.starter .svg-icon {
  transform: scale(1);
}

#sidebar.closed .node.starter svg:last-child {
  display: none;
}
</style>
