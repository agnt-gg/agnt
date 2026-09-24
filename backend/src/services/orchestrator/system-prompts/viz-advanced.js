/**
 * D3 / Three.js / HTML renderer guides.
 *
 * SPLIT OUT OF CHART_CHEATSHEET 2026-07-31. Together these measured 2,670 of
 * the cheatsheet's 3,187 tokens (~3,870 calibrated) and shipped on every turn
 * — the tool-surface problem in prose form: capability documentation resident
 * by default whether or not the turn had anything to do with visualization.
 *
 * Chart.js stayed resident because it is the cheapest of the four and by far
 * the most used. These three are delivered as a discover_tools RESULT rather
 * than folded back into the system prompt, and that placement is deliberate:
 * a tool result lands in the append-only message region, which costs nothing
 * in cached prefix, whereas growing the system prompt mid-conversation
 * rewrites every cached message after it. See promptElements.js.
 */
export const VIZ_ADVANCED_CHEATSHEET = `ADVANCED VISUALIZATION GUIDE (D3 / THREE.JS / HTML)

D3.JS VISUALIZATION GUIDE:

For advanced/custom visualizations (treemaps, force graphs, custom SVGs, etc.), use a \\\`\\\`\\\`d3 code block with JavaScript.
The frontend renders it in a sandboxed iframe with D3 v7 loaded. A \`container\` variable (d3 selection of #chart div) is available.

SYNTAX: ALWAYS Wrap D3 JavaScript code in a d3 fenced code block:
\\\`\\\`\\\`d3
// 'container' is already a d3.select("#chart") selection
const svg = container.append("svg").attr("width", 400).attr("height", 300);
// ... your D3 code here
\\\`\\\`\\\`

RULES:
- \`container\` is pre-defined as d3.select("#chart") - use it directly
- D3 v7 is loaded - use d3.* methods freely
- Dark theme: background is transparent, text defaults to #e0e0e0
- Keep SVG dimensions reasonable (width 400-600, height 200-400)
- No external data fetches - all data must be inline
- Use the AGNT color palette: #e53d8f, #12e0ff, #19ef83, #ffd700, #7d3de5, #ff9500

EXAMPLE - Horizontal bar chart:
\\\`\\\`\\\`d3
const data = [{label: "Alpha", value: 40}, {label: "Beta", value: 65}, {label: "Gamma", value: 30}];
const w = 450, h = data.length * 40 + 20;
const svg = container.append("svg").attr("width", w).attr("height", h);
const x = d3.scaleLinear().domain([0, d3.max(data, d => d.value)]).range([0, w - 120]);
const y = d3.scaleBand().domain(data.map(d => d.label)).range([10, h - 10]).padding(0.3);
svg.selectAll("rect").data(data).join("rect")
  .attr("x", 80).attr("y", d => y(d.label)).attr("width", d => x(d.value)).attr("height", y.bandwidth())
  .attr("fill", (d,i) => ["#e53d8f","#12e0ff","#19ef83"][i]);
svg.selectAll(".label").data(data).join("text").attr("class","label")
  .attr("x", 75).attr("y", d => y(d.label) + y.bandwidth()/2).attr("dy", "0.35em")
  .attr("text-anchor","end").attr("fill","#e0e0e0").attr("font-size","13px").text(d => d.label);
svg.selectAll(".val").data(data).join("text").attr("class","val")
  .attr("x", d => 85 + x(d.value)).attr("y", d => y(d.label) + y.bandwidth()/2).attr("dy","0.35em")
  .attr("fill","#e0e0e0").attr("font-size","12px").text(d => d.value);
\\\`\\\`\\\`

THREE.JS 3D VISUALIZATION GUIDE:

For interactive 3D scenes, use a \\\`\\\`\\\`threejs code block with JavaScript.
The frontend renders it in a sandboxed environment with Three.js. Pre-defined variables: THREE, THREE_ADDONS, scene, camera, renderer, controls, canvas.

SYNTAX: ALWAYS Wrap threejs code in a threejs fenced code block:
\\\`\\\`\\\`threejs
// scene, camera, renderer, controls are already set up
// Just add objects to the scene
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xe53d8f });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);
\\\`\\\`\\\`

PRE-DEFINED SETUP (do NOT recreate these):
- \`scene\` - THREE.Scene with dark background (0x1a1a2e)
- \`camera\` - PerspectiveCamera at position (3, 3, 5) looking at origin
- \`renderer\` - WebGLRenderer with antialiasing on the canvas
- \`controls\` - OrbitControls with damping (user can rotate/zoom)
- \`canvas\` - The canvas element (600x400)
- Ambient light (0x404040) and directional light already added
- Animation loop already running (calls controls.update + renderer.render each frame)

AVAILABLE ADDONS (via THREE_ADDONS object):
- Loaders: GLTFLoader, FBXLoader, OBJLoader, MTLLoader, SVGLoader, FontLoader
- Controls: OrbitControls, DragControls, TransformControls
- Geometries: TextGeometry, RoundedBoxGeometry, ConvexGeometry, ParametricGeometry
- Post-processing: EffectComposer, RenderPass, UnrealBloomPass
Usage: \`const { GLTFLoader } = THREE_ADDONS;\` or \`const loader = new THREE_ADDONS.GLTFLoader();\`

⚠️ CRITICAL SANDBOX RULES:
- Do NOT use \`import\` or \`export\` statements - they will cause errors
- Do NOT use dynamic \`import()\` calls - they will fail
- ALL Three.js classes are on the \`THREE\` object (e.g., THREE.BoxGeometry, THREE.Vector3)
- ALL addons are on the \`THREE_ADDONS\` object (e.g., THREE_ADDONS.GLTFLoader)
- Do NOT create new Scene, Camera, Renderer, or animation loop - they already exist
- Keep geometry vertex counts reasonable (under 1 million) - huge buffers will be blocked
- \`await\` is supported - the code runs in an async context
- AGNT palette: 0xe53d8f (pink), 0x12e0ff (cyan), 0x19ef83 (green), 0xffd700 (gold), 0x7d3de5 (purple)

RULES:
- Just add meshes, lights, helpers, etc. to \`scene\`
- Use THREE.* for all Three.js classes
- For custom per-frame logic, override: renderer.setAnimationLoop((time) => { /* your code */ controls.update(); renderer.render(scene, camera); });

EXAMPLE - Spinning torus knot:
\\\`\\\`\\\`threejs
const geo = new THREE.TorusKnotGeometry(1, 0.3, 128, 32);
const mat = new THREE.MeshStandardMaterial({ color: 0x12e0ff, metalness: 0.5, roughness: 0.3 });
const knot = new THREE.Mesh(geo, mat);
scene.add(knot);
renderer.setAnimationLoop((time) => {
  knot.rotation.x = time * 0.001;
  knot.rotation.y = time * 0.0015;
  controls.update();
  renderer.render(scene, camera);
});
\\\`\\\`\\\`

EXAMPLE - Using addons (post-processing bloom):
\\\`\\\`\\\`threejs
const { EffectComposer, RenderPass, UnrealBloomPass } = THREE_ADDONS;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(canvas.width, canvas.height), 1.5, 0.4, 0.85));
const geo = new THREE.IcosahedronGeometry(1.5, 1);
const mat = new THREE.MeshStandardMaterial({ color: 0x12e0ff, emissive: 0x12e0ff, emissiveIntensity: 0.5 });
scene.add(new THREE.Mesh(geo, mat));
renderer.setAnimationLoop((time) => {
  scene.rotation.y = time * 0.0005;
  controls.update();
  composer.render();
});
\\\`\\\`\\\`

HTML VISUALIZATION / INTERACTIVE CONTENT GUIDE:

For rich interactive content, dashboards, mini-apps, forms, or anything that needs full HTML/CSS/JS, use a \\\`\\\`\\\`html code block.
The frontend renders it inline as a live preview in a sandboxed iframe. Users can toggle to view source, open fullscreen, or share.
The app's full CSS theme variables are automatically injected into the iframe, so use var(--color-*) etc. for styling.

SYNTAX:
\\\`\\\`\\\`html
<!DOCTYPE html>
<html>
<head><style>/* your styles */</style></head>
<body>
  <!-- your content -->
  <script>/* your JS */</script>
</body>
</html>
\\\`\\\`\\\`

RULES:
- Write a complete, self-contained HTML document (include <!DOCTYPE html>, <html>, <head>, <body>)
- All CSS and JS must be inline (no external fetches unless from CDNs)
- The iframe is sandboxed with allow-scripts allow-same-origin
- Use dark theme defaults: background #1a1a2e, text #e0e0e0, accent colors from AGNT palette
- Keep it responsive - the iframe width is 100% of the chat message area
- Popular CDN libraries are fine: Chart.js, D3, Three.js, Anime.js, p5.js, etc.

DESIGN QUALITY (CRITICAL):
- Every HTML output MUST look like it was crafted by a world-class design agency — bold, visually unique, and forward-thinking
- Ultra high design quality is NON-NEGOTIABLE — think high-end architecture firm portfolio, not generic enterprise software
- The aesthetic should feel like the world's leading design agencies: confident, distinctive, and visually striking
- Use a base-2 spacing scale for all padding, margins, and gaps (2, 4, 8, 16, 24, 32, 48, 64px) — never arbitrary values
- Establish clear typographic hierarchy: distinct sizes for headings, subheadings, body, and captions with consistent line-height
- Generous whitespace — let content breathe, never feel cramped
- Strong visual hierarchy: the user's eye should be guided naturally through the content
- Consistent alignment and grid structure throughout the layout
- Polished interactive states and smooth transitions on all interactive elements
- Purposeful use of color: AGNT accent colors as highlights, not floods — accents on key UI elements and data points
- Every element should feel intentional, refined, and professionally designed
- NEVER produce generic or cookie-cutter layouts — every output should feel bespoke and premium

EXAMPLE - Interactive counter:
\\\`\\\`\\\`html
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: system-ui; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; gap: 16px; }
  button { background: #e53d8f; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 18px; cursor: pointer; }
  button:hover { opacity: 0.85; }
  #count { font-size: 48px; font-weight: bold; color: #12e0ff; min-width: 80px; text-align: center; }
</style></head>
<body>
  <button onclick="update(-1)">−</button>
  <div id="count">0</div>
  <button onclick="update(1)">+</button>
  <script>
    let n = 0;
    function update(d) { n += d; document.getElementById('count').textContent = n; }
  </script>
</body>
</html>
\\\`\\\`\\\`

WHEN TO USE HTML:
- Dashboards or multi-chart layouts
- Interactive tools, calculators, or mini-apps
- Custom styled content that needs full CSS control
- Anything combining multiple visualizations in one view
- Content that needs third-party libraries via CDN

WHEN TO USE WHICH:
- **Chart.js** (\\\`\\\`\\\`chartjs): Standard 2D charts (bar, line, pie) - JSON config, simplest (always available, no load needed)
- **D3** (\\\`\\\`\\\`d3): Custom 2D visualizations (treemaps, force graphs, network diagrams)
- **Three.js** (\\\`\\\`\\\`threejs): Interactive 3D scenes (3D models, particles, physics, spatial data)
- **HTML** (\\\`\\\`\\\`html): Full interactive pages, dashboards, mini-apps, or multi-viz layouts`;
