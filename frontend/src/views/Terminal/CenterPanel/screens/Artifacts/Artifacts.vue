<template>
  <BaseScreen
    ref="baseScreenRef"
    activeLeftPanel="ArtifactsPanel"
    activeRightPanel="FileTreePanel"
    screenId="ArtifactsScreen"
    :showInput="false"
    @screen-change="(screenName) => $emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
  >
    <template #default>
      <div class="ce-root">
        <!-- Tab bar (full width) -->
        <div class="ce-tabs" v-if="openTabs.length > 0">
          <div
            v-for="tab in openTabs"
            :key="tab.path"
            class="ce-tab"
            :class="{ active: activeTabPath === tab.path }"
            @click="switchTab(tab.path)"
          >
            <span class="ce-tab-name">{{ tab.name }}{{ tab.isDirty ? ' *' : '' }}</span>
            <Tooltip text="Close">
              <button class="ce-tab-close" @click.stop="closeTab(tab.path)">
                <i class="fas fa-times"></i>
              </button>
            </Tooltip>
          </div>
        </div>

        <!-- Body: editor + divider + preview -->
        <div class="ce-body" ref="bodyRef" :class="{ 'is-resizing': isResizing }">
          <!-- Editor half (toggled) -->
          <template v-if="showCode">
            <div class="ce-editor-half" :style="{ width: editorWidth + '%' }">
              <!-- Info bar -->
              <div class="ce-info" v-if="activeTab">
                <span class="ce-filepath">{{ activeTab.path }}</span>
                <button class="ce-save-btn" :disabled="!activeTab.isDirty || isSaving" @click="saveActiveFile">
                  <i :class="isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'"></i>
                  {{ isSaving ? 'Saving...' : 'Save' }}
                </button>
              </div>

              <!-- Editor -->
              <div class="ce-editor" v-if="activeTab">
                <Codemirror
                  :key="activeTab.path"
                  :model-value="activeTab.content"
                  :style="{ height: '100%', width: '100%' }"
                  :indent-with-tab="true"
                  :tab-size="2"
                  :extensions="editorExtensions"
                  @update:model-value="handleEditorChange"
                />
              </div>

              <!-- Empty state -->
              <div class="ce-empty" v-else>
                <i class="fas fa-code"></i>
                <p>Open a file from the file tree or ask Annie to create one</p>
                <span class="ce-shortcut">Files are stored in ~/.agnt/projects/</span>
              </div>
            </div>

            <!-- Draggable divider -->
            <div
              class="ce-divider"
              :class="{ active: isResizing }"
              @mousedown="startResize"
            ></div>
          </template>

          <!-- Preview half -->
          <div class="ce-preview-half">
            <div class="ce-preview-header">
              <span class="ce-preview-label">
                <i class="fas fa-eye"></i>
                Preview
              </span>
              <div class="ce-preview-actions">
                <Tooltip :text="showCode ? 'Hide source' : 'Show source'">
                  <button class="ce-preview-btn" :class="{ active: showCode }" @click="showCode = !showCode">
                    <i class="fas fa-code"></i>
                  </button>
                </Tooltip>
                <Tooltip text="Refresh preview">
                  <button class="ce-preview-btn" @click="refreshPreview">
                    <i class="fas fa-sync-alt"></i>
                  </button>
                </Tooltip>
                <Tooltip text="Share to AGNT Creations" v-if="isHtmlFile">
                  <button class="ce-preview-btn" @click="openShareModal" :disabled="isSharing">
                    <i class="fas fa-share-alt"></i>
                  </button>
                </Tooltip>
              </div>
            </div>
            <div class="ce-preview-content">
              <iframe
                v-if="isHtmlFile && activeTab"
                ref="previewFrame"
                class="ce-preview-iframe"
                sandbox="allow-scripts allow-same-origin"
              ></iframe>
              <div v-else-if="isMarkdownFile && activeTab" ref="markdownPreviewRef" class="ce-markdown-preview" v-html="renderedMarkdown"></div>
              <div v-else-if="isImageFile && activeTab" class="ce-media-preview">
                <img :src="rawFileUrl" :alt="activeTab.name" />
              </div>
              <div v-else-if="isVideoFile && activeTab" class="ce-media-preview">
                <video :src="rawFileUrl" controls />
              </div>
              <div v-else-if="isAudioFile && activeTab" class="ce-media-preview ce-audio-preview">
                <canvas ref="audioCanvasRef" class="ce-audio-canvas"></canvas>
                <p class="ce-audio-name">{{ activeTab.name }}</p>
                <audio ref="audioPlayerRef" :src="rawFileUrl" crossorigin="anonymous" controls @play="startVisualizer" @pause="stopVisualizer" @ended="stopVisualizer" />
              </div>
              <iframe
                v-else-if="isPdfFile && activeTab"
                :src="rawFileUrl"
                class="ce-pdf-preview"
              ></iframe>
              <div v-else-if="isEpubFile && activeTab" class="ce-epub-wrapper">
                <div ref="epubContainerRef" class="ce-epub-container"></div>
                <div class="ce-epub-nav">
                  <button class="ce-preview-btn" @click="epubPrev"><i class="fas fa-chevron-left"></i></button>
                  <button class="ce-preview-btn" @click="epubNext"><i class="fas fa-chevron-right"></i></button>
                </div>
              </div>
              <div v-else-if="is3DFile && activeTab" ref="modelContainerRef" class="ce-3d-preview"></div>
              <div v-else-if="isSpreadsheetFile && activeTab" class="ce-spreadsheet-preview">
                <table class="ce-spreadsheet">
                  <thead>
                    <tr>
                      <th class="ce-row-num">#</th>
                      <th v-for="(h, ci) in spreadsheetData.headers" :key="ci">{{ h }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in spreadsheetData.rows" :key="ri">
                      <td class="ce-row-num">{{ ri + 1 }}</td>
                      <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else-if="isTextFile && activeTab" class="ce-text-preview">{{ activeTab.content }}</div>
              <div v-else-if="activeTab" class="ce-preview-empty">
                <i class="fas fa-eye-slash"></i>
                <p>No preview for .{{ activeTab.path.split('.').pop() }} files</p>
              </div>
              <div v-else class="ce-preview-empty">
                <i class="fas fa-eye"></i>
                <p>Open a file to see preview</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>

  <!-- Share Modal - Teleported to body -->
  <Teleport to="body">
    <div v-if="showShareModal" class="share-modal-overlay" @click="closeShareModal">
      <div class="share-modal" @click.stop>
        <div class="share-modal-header">
          <h3>Share to AGNT Creations</h3>
          <button class="share-modal-close" @click="closeShareModal">&times;</button>
        </div>

        <div v-if="isSharing" class="share-modal-loading">
          <div class="share-spinner"></div>
          <p>Sharing your creation...</p>
        </div>

        <div v-else-if="shareError" class="share-modal-error">
          <div class="error-icon">Failed</div>
          <p>{{ shareError }}</p>
          <button class="share-retry-btn" @click="retryShare">Try Again</button>
        </div>

        <div v-else-if="shareResult" class="share-modal-success">
          <p class="success-message">Your creation has been shared!</p>
          <div class="share-options">
            <div class="share-option">
              <label>Link</label>
              <div class="share-input">
                <input type="text" :value="shareResult.url" readonly ref="shareLinkInput" />
                <button class="share-copy-btn" @click="copyShareLink">
                  {{ copiedLink ? 'Copied!' : 'Copy' }}
                </button>
              </div>
            </div>
            <div class="share-option">
              <label>Embed</label>
              <div class="share-input">
                <input type="text" :value="shareEmbedCode" readonly ref="shareEmbedInput" />
                <button class="share-copy-btn" @click="copyEmbedCode">
                  {{ copiedEmbed ? 'Copied!' : 'Copy' }}
                </button>
              </div>
            </div>
          </div>
          <div class="share-actions">
            <button class="share-action-btn view-btn" @click="openInBrowser(shareResult.url)">
              <span>View</span>
            </button>
            <button class="share-action-btn edit-btn" @click="openInBrowser(shareResult.editUrl)">
              <span>Edit</span>
            </button>
          </div>
        </div>

        <div v-else class="share-modal-form">
          <div class="share-form-field">
            <label for="shareTitle">Title</label>
            <input type="text" id="shareTitle" v-model="shareTitle" placeholder="My Creation" @keyup.enter="submitShare" />
          </div>
          <div class="share-form-actions">
            <button class="share-cancel-btn" @click="closeShareModal">Cancel</button>
            <button class="share-submit-btn" @click="submitShare" :disabled="!shareTitle.trim()">
              <span>Share</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useStore } from 'vuex';
import { Codemirror } from 'vue-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import showdown from 'showdown';
import BaseScreen from '../../BaseScreen.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { getFile, saveFile } from '@/services/fileSystemService.js';
import { API_CONFIG } from '@/tt.config.js';

// Lazy-loaded heavy library caches
let _Chart = null;
let _d3 = null;
let _THREE = null;
let _THREE_ADDONS = null;
let _OrbitControls = null;

const loadChartJs = async () => {
  if (!_Chart) {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    _Chart = Chart;
  }
  return _Chart;
};

const loadD3 = async () => {
  if (!_d3) { _d3 = await import('d3'); }
  return _d3;
};

const loadThreeJs = async () => {
  if (!_THREE) {
    const [
      threeModule,
      { OrbitControls },
      { GLTFLoader },
      { FontLoader },
      { TextGeometry },
      { EffectComposer },
      { RenderPass },
      { UnrealBloomPass },
      { DragControls },
      { TransformControls },
      { FBXLoader },
      { OBJLoader },
      { MTLLoader },
      { SVGLoader },
      { RoundedBoxGeometry },
      { ConvexGeometry },
      { ParametricGeometry },
      { STLLoader },
      { PLYLoader },
      { ColladaLoader },
      { ThreeMFLoader },
    ] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/FontLoader.js'),
      import('three/examples/jsm/geometries/TextGeometry.js'),
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/controls/DragControls.js'),
      import('three/examples/jsm/controls/TransformControls.js'),
      import('three/examples/jsm/loaders/FBXLoader.js'),
      import('three/examples/jsm/loaders/OBJLoader.js'),
      import('three/examples/jsm/loaders/MTLLoader.js'),
      import('three/examples/jsm/loaders/SVGLoader.js'),
      import('three/examples/jsm/geometries/RoundedBoxGeometry.js'),
      import('three/examples/jsm/geometries/ConvexGeometry.js'),
      import('three/examples/jsm/geometries/ParametricGeometry.js'),
      import('three/examples/jsm/loaders/STLLoader.js'),
      import('three/examples/jsm/loaders/PLYLoader.js'),
      import('three/examples/jsm/loaders/ColladaLoader.js'),
      import('three/examples/jsm/loaders/3MFLoader.js'),
    ]);
    _THREE = threeModule;
    _OrbitControls = OrbitControls;
    _THREE_ADDONS = {
      OrbitControls, GLTFLoader, FontLoader, TextGeometry,
      EffectComposer, RenderPass, UnrealBloomPass,
      DragControls, TransformControls,
      FBXLoader, OBJLoader, MTLLoader, SVGLoader,
      STLLoader, PLYLoader, ColladaLoader, ThreeMFLoader,
      RoundedBoxGeometry, ConvexGeometry, ParametricGeometry,
      // Legacy aliases — LLMs often generate old Three.js class names
      ParametricBufferGeometry: ParametricGeometry,
      ConvexBufferGeometry: ConvexGeometry,
    };
  }
  return { THREE: _THREE, THREE_ADDONS: _THREE_ADDONS, OrbitControls: _OrbitControls };
};

// Simple hash for deterministic IDs
const hashCode = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
};

// Protect math from showdown (which eats backslashes). HTML comments survive all contexts.
// Fenced code blocks are excluded first so $/$$/\(\) inside code aren't corrupted.
const mathStore = [];
const protectMath = (text) => {
  mathStore.length = 0;
  const codeBlocks = [];
  text = text.replace(/```[\s\S]*?```/g, (m) => { codeBlocks.push(m); return `\n<!--CB${codeBlocks.length - 1}-->\n`; });
  const save = (match) => { mathStore.push(match); return `<!--M${mathStore.length - 1}-->`; };
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, save);
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, save);
  text = text.replace(/\\\([\s\S]+?\\\)/g, save);
  text = text.replace(/\$([^\$\n]+?)\$/g, save);
  text = text.replace(/<!--CB(\d+)-->/g, (_, i) => codeBlocks[parseInt(i)] || '');
  return text;
};
const restoreMath = (html) => {
  return html.replace(/<!--M(\d+)-->/g, (_, i) => {
    let m = (mathStore[parseInt(i)] || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // Convert $/$$ delimiters to \(\)/\[\] which MathJax always supports
    if (m.startsWith('$$') && m.endsWith('$$')) {
      m = '\\[' + m.slice(2, -2) + '\\]';
    } else if (m.startsWith('$') && m.endsWith('$')) {
      m = '\\(' + m.slice(1, -1) + '\\)';
    }
    return m;
  });
};

const mdConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  tasklists: true,
  ghCodeBlocks: true,
  simpleLineBreaks: true,
  openLinksInNewWindow: true,
  extensions: [
    function () {
      return [{
        type: 'output',
        filter: function (text) {
          let blockIndex = 0;
          // chartjs
          let result = text.replace(/<pre><code class="[^"]*language-chartjs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, config) => {
            const id = 'achart-' + hashCode(config) + '-' + blockIndex++;
            return `<div class="chartjs-container" data-chart-id="${id}"><canvas id="${id}"></canvas><code class="chartjs-config" style="display:none">${config}</code></div>`;
          });
          // d3
          result = result.replace(/<pre><code class="[^"]*language-d3[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
            const id = 'ad3-' + hashCode(code) + '-' + blockIndex++;
            return `<div class="d3-container" data-d3-id="${id}"><code class="d3-code" style="display:none">${code}</code></div>`;
          });
          // threejs
          result = result.replace(/<pre><code class="[^"]*language-threejs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
            const id = 'athree-' + hashCode(code) + '-' + blockIndex++;
            return `<div class="threejs-container" data-three-id="${id}"><code class="threejs-code" style="display:none">${code}</code></div>`;
          });
          return result;
        },
      }];
    },
  ],
});

const LANG_MAP = {
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  jsx: javascript,
  ts: javascript,
  tsx: javascript,
  json: javascript,
  py: python,
  html: html,
  htm: html,
  vue: html,
  xml: html,
  svg: html,
};

const HTML_PREVIEW_EXTS = new Set(['html', 'htm', 'svg']);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'mkv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus']);
const PDF_EXTS = new Set(['pdf']);
const EPUB_EXTS = new Set(['epub']);
const MODEL3D_EXTS = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3mf']);
const SPREADSHEET_EXTS = new Set(['csv', 'tsv']);
const TEXT_EXTS = new Set(['txt', 'log', 'ini', 'cfg', 'conf', 'env', 'yaml', 'yml', 'toml']);

/**
 * Parse CSV/TSV content into rows, handling quoted fields with commas/newlines.
 */
function parseDelimited(content, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || (ch === '\r' && content[i + 1] === '\n')) {
      if (ch === '\r') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export default {
  name: 'ArtifactsScreen',
  components: { BaseScreen, Codemirror, Tooltip },
  emits: ['screen-change'],
  setup() {
    const baseScreenRef = ref(null);
    const bodyRef = ref(null);
    const previewFrame = ref(null);
    const markdownPreviewRef = ref(null);
    const openTabs = ref([]);
    const activeTabPath = ref(null);
    const isSaving = ref(false);
    const editorWidth = ref(50);
    const isResizing = ref(false);
    const showCode = ref(false);

    // Share to AGNT Creations state
    const store = useStore();
    const showShareModal = ref(false);
    const isSharing = ref(false);
    const shareError = ref(null);
    const shareResult = ref(null);
    const shareTitle = ref('');
    const copiedLink = ref(false);
    const copiedEmbed = ref(false);
    const shareLinkInput = ref(null);
    const shareEmbedInput = ref(null);
    const CREATIONS_API_URL = 'https://agnt.gg/api/previews';

    const shareEmbedCode = computed(() => {
      if (shareResult.value && shareResult.value.id) {
        return `<iframe src="https://agnt.gg/creations/${shareResult.value.id}/embed" width="100%" height="500" frameborder="0"></iframe>`;
      }
      return '';
    });

    const openShareModal = () => {
      shareTitle.value = activeTab.value?.name || 'My Creation';
      shareError.value = null;
      shareResult.value = null;
      copiedLink.value = false;
      copiedEmbed.value = false;
      showShareModal.value = true;
    };

    const closeShareModal = () => {
      showShareModal.value = false;
      shareTitle.value = '';
      shareError.value = null;
      shareResult.value = null;
      isSharing.value = false;
    };

    const submitShare = async () => {
      if (!activeTab.value?.content || !shareTitle.value.trim()) return;
      isSharing.value = true;
      shareError.value = null;
      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = store.state.userAuth?.token;
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(CREATIONS_API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            html: activeTab.value.content,
            title: shareTitle.value.trim(),
            source: 'desktop-app',
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to share (${response.status})`);
        }
        shareResult.value = await response.json();
      } catch (error) {
        shareError.value = error.message || 'Failed to share. Please try again.';
      } finally {
        isSharing.value = false;
      }
    };

    const retryShare = () => { shareError.value = null; submitShare(); };

    const copyShareLink = async () => {
      if (!shareResult.value?.url) return;
      try {
        await navigator.clipboard.writeText(shareResult.value.url);
        copiedLink.value = true;
        setTimeout(() => { copiedLink.value = false; }, 2000);
      } catch (e) { /* */ }
    };

    const copyEmbedCode = async () => {
      if (!shareEmbedCode.value) return;
      try {
        await navigator.clipboard.writeText(shareEmbedCode.value);
        copiedEmbed.value = true;
        setTimeout(() => { copiedEmbed.value = false; }, 2000);
      } catch (e) { /* */ }
    };

    const openInBrowser = (url) => { if (url) window.open(url, '_blank'); };

    // ── Audio visualizer ────────────────────────────────────
    const audioPlayerRef = ref(null);
    const audioCanvasRef = ref(null);
    // WeakMap tracks which <audio> elements already have a MediaElementSource
    // (an element can only be connected once — ever — to a single AudioContext)
    const audioSourceMap = new WeakMap();
    let audioCtx = null;
    let audioAnalyser = null;
    let audioAnimId = null;

    const drawVisualizer = () => {
      const canvas = audioCanvasRef.value;
      const analyser = audioAnalyser;
      if (!canvas || !analyser) return;

      const ctx = canvas.getContext('2d');
      const primaryColor = getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#19ef83';

      const draw = () => {
        audioAnimId = requestAnimationFrame(draw);

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
        }
        const W = rect.width;
        const H = rect.height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.clearRect(0, 0, W, H);

        // Waveform line with glow
        ctx.shadowBlur = 8;
        ctx.shadowColor = primaryColor;
        ctx.lineWidth = 2;
        ctx.strokeStyle = primaryColor;
        ctx.beginPath();

        const sliceWidth = W / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * H) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        // Subtle fill under the waveform
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = primaryColor;
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      draw();
    };

    const startVisualizer = () => {
      const audio = audioPlayerRef.value;
      if (!audio) return;

      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          audioAnalyser = audioCtx.createAnalyser();
          audioAnalyser.fftSize = 2048;
          audioAnalyser.connect(audioCtx.destination);
        }

        // Each <audio> element can only have one MediaElementSource ever created for it
        if (!audioSourceMap.has(audio)) {
          const source = audioCtx.createMediaElementSource(audio);
          source.connect(audioAnalyser);
          audioSourceMap.set(audio, source);
        }

        if (audioCtx.state === 'suspended') audioCtx.resume();
        stopVisualizer(); // cancel any prior animation loop
        drawVisualizer();
      } catch (e) {
        // If visualizer fails, audio still plays normally without crossorigin
        console.warn('[AudioViz] Could not start visualizer:', e.message);
      }
    };

    const stopVisualizer = () => {
      if (audioAnimId) {
        cancelAnimationFrame(audioAnimId);
        audioAnimId = null;
      }
    };

    // Chart/viz instance tracking for cleanup
    const chartInstances = ref([]);
    const threeInstances = ref([]);
    const renderedChartIds = new Set();
    const renderedD3Ids = new Set();
    const renderedThreeIds = new Set();

    const activeTab = computed(() => openTabs.value.find((t) => t.path === activeTabPath.value) || null);

    const fileExt = computed(() => {
      if (!activeTab.value) return '';
      return activeTab.value.path.split('.').pop()?.toLowerCase() || '';
    });

    const isHtmlFile = computed(() => HTML_PREVIEW_EXTS.has(fileExt.value));
    const isMarkdownFile = computed(() => MARKDOWN_EXTS.has(fileExt.value));
    const isImageFile = computed(() => IMAGE_EXTS.has(fileExt.value));
    const isVideoFile = computed(() => VIDEO_EXTS.has(fileExt.value));
    const isAudioFile = computed(() => AUDIO_EXTS.has(fileExt.value));
    const isPdfFile = computed(() => PDF_EXTS.has(fileExt.value));
    const isEpubFile = computed(() => EPUB_EXTS.has(fileExt.value));
    const is3DFile = computed(() => MODEL3D_EXTS.has(fileExt.value));
    const isSpreadsheetFile = computed(() => SPREADSHEET_EXTS.has(fileExt.value));
    const isTextFile = computed(() => TEXT_EXTS.has(fileExt.value));

    const spreadsheetData = computed(() => {
      if (!activeTab.value || !isSpreadsheetFile.value) return { headers: [], rows: [] };
      const delimiter = fileExt.value === 'tsv' ? '\t' : ',';
      const all = parseDelimited(activeTab.value.content || '', delimiter);
      if (all.length === 0) return { headers: [], rows: [] };
      return { headers: all[0], rows: all.slice(1) };
    });

    const rawFileUrl = computed(() => {
      if (!activeTab.value) return '';
      return `${API_CONFIG.BASE_URL}/filesystem/raw?path=${encodeURIComponent(activeTab.value.path)}`;
    });

    const renderedMarkdown = computed(() => {
      if (!activeTab.value || !isMarkdownFile.value) return '';
      const safe = protectMath(activeTab.value.content || '');
      return restoreMath(mdConverter.makeHtml(safe));
    });

    // ── EPUB reader ───────────────────────────────────────
    const epubContainerRef = ref(null);
    let epubBook = null;
    let epubRendition = null;

    const loadEpub = async () => {
      destroyEpub();
      if (!isEpubFile.value || !activeTab.value || !epubContainerRef.value) return;

      try {
        const ePub = (await import('epubjs')).default;
        epubBook = ePub(rawFileUrl.value, { openAs: 'epub' });
        epubRendition = epubBook.renderTo(epubContainerRef.value, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled-doc',
        });
        await epubRendition.display();

        epubRendition.themes.default({
          'body': { color: 'var(--color-text, #ccc) !important', background: 'transparent !important', 'font-family': 'system-ui, sans-serif', 'line-height': '1.7', padding: '0 8px !important' },
          'p': { color: 'var(--color-text, #ccc) !important' },
          'h1, h2, h3, h4, h5, h6': { color: 'var(--color-white, #fff) !important' },
          'a': { color: 'var(--color-primary, #19ef83) !important' },
          'img': { 'max-width': '100% !important' },
        });
      } catch (e) {
        console.error('[EPUB] Failed to load:', e);
      }
    };

    const destroyEpub = () => {
      if (epubRendition) { epubRendition.destroy(); epubRendition = null; }
      if (epubBook) { epubBook.destroy(); epubBook = null; }
    };

    const epubPrev = () => { if (epubRendition) epubRendition.prev(); };
    const epubNext = () => { if (epubRendition) epubRendition.next(); };

    watch([activeTabPath, isEpubFile], () => {
      nextTick(() => loadEpub());
    });

    // ── 3D model viewer ──────────────────────────────────
    const modelContainerRef = ref(null);
    let modelRenderer = null;
    let modelScene = null;
    let modelCamera = null;
    let modelControls = null;
    let modelAnimId = null;

    // Read a CSS variable as a Three.js Color
    const cssColor = (varName, fallback) => {
      const raw = getComputedStyle(document.body).getPropertyValue(varName).trim();
      return raw || fallback;
    };
    const load3DModel = async () => {
      destroy3DModel();
      if (!is3DFile.value || !activeTab.value || !modelContainerRef.value) return;

      try {
        const { THREE, THREE_ADDONS, OrbitControls } = await loadThreeJs();
        const container = modelContainerRef.value;
        const rect = container.getBoundingClientRect();

        const bgColor = new THREE.Color(cssColor('--color-background', '#10101f'));
        const primaryColor = new THREE.Color(cssColor('--color-primary', '#19ef83'));
        const secondaryColor = new THREE.Color(cssColor('--color-secondary', '#333355'));

        // Scene
        modelScene = new THREE.Scene();
        modelScene.background = null;


        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        modelScene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 10, 7);
        modelScene.add(dirLight);
        const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
        backLight.position.set(-5, 5, -5);
        modelScene.add(backLight);

        // Camera (Z-up)
        modelCamera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.01, 1000);
        modelCamera.up.set(0, 0, 1);
        modelCamera.position.set(3, 3, 3);

        // Renderer
        modelRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        modelRenderer.setPixelRatio(window.devicePixelRatio);
        modelRenderer.setSize(rect.width, rect.height);
        container.appendChild(modelRenderer.domElement);

        // Controls
        modelControls = new OrbitControls(modelCamera, modelRenderer.domElement);
        modelControls.enableDamping = true;
        modelControls.dampingFactor = 0.1;

        // Load model
        const url = rawFileUrl.value;
        const ext = fileExt.value;
        let object = null;

        // Default material uses theme primary color
        const defaultMaterial = () => new THREE.MeshStandardMaterial({ color: primaryColor, metalness: 0.3, roughness: 0.6 });

        if (ext === 'glb' || ext === 'gltf') {
          const loader = new THREE_ADDONS.GLTFLoader();
          const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          object = gltf.scene;
        } else if (ext === 'fbx') {
          const loader = new THREE_ADDONS.FBXLoader();
          object = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        } else if (ext === 'obj') {
          const loader = new THREE_ADDONS.OBJLoader();
          object = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        } else if (ext === 'stl') {
          const loader = new THREE_ADDONS.STLLoader();
          const geometry = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          object = new THREE.Mesh(geometry, defaultMaterial());
        } else if (ext === 'ply') {
          const loader = new THREE_ADDONS.PLYLoader();
          const geometry = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          geometry.computeVertexNormals();
          const material = geometry.hasAttribute('color')
            ? new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 })
            : defaultMaterial();
          object = new THREE.Mesh(geometry, material);
        } else if (ext === 'dae') {
          const loader = new THREE_ADDONS.ColladaLoader();
          const collada = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          object = collada.scene;
        } else if (ext === '3mf') {
          const loader = new THREE_ADDONS.ThreeMFLoader();
          object = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        }

        if (!object) return;
        modelScene.add(object);

        // Auto-frame: center XY, sit bottom at Z=0
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        object.position.x -= center.x;
        object.position.y -= center.y;
        object.position.z -= box.min.z;

        // Recompute bounds after repositioning
        const fittedBox = new THREE.Box3().setFromObject(object);
        const midZ = (fittedBox.min.z + fittedBox.max.z) / 2;

        modelCamera.position.set(size, size, midZ + size * 0.25);
        modelCamera.lookAt(0, 0, midZ);
        modelControls.target.set(0, 0, midZ);
        modelCamera.near = size * 0.001;
        modelCamera.far = size * 100;
        modelCamera.updateProjectionMatrix();

        // Animation loop
        const animate = () => {
          modelAnimId = requestAnimationFrame(animate);
          modelControls.update();
          modelRenderer.render(modelScene, modelCamera);
        };
        animate();

        // Handle resize
        const ro = new ResizeObserver(() => {
          const r = container.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          modelCamera.aspect = r.width / r.height;
          modelCamera.updateProjectionMatrix();
          modelRenderer.setSize(r.width, r.height);
        });
        ro.observe(container);
        container._ro = ro;
      } catch (e) {
        console.error('[3D] Failed to load model:', e);
      }
    };

    const destroy3DModel = () => {
      if (modelAnimId) { cancelAnimationFrame(modelAnimId); modelAnimId = null; }
      if (modelControls) { modelControls.dispose(); modelControls = null; }
      if (modelRenderer) {
        modelRenderer.dispose();
        if (modelRenderer.domElement?.parentNode) modelRenderer.domElement.parentNode.removeChild(modelRenderer.domElement);
        modelRenderer = null;
      }
      if (modelContainerRef.value?._ro) {
        modelContainerRef.value._ro.disconnect();
        delete modelContainerRef.value._ro;
      }
      modelScene = null;
      modelCamera = null;
    };

    watch([activeTabPath, is3DFile], () => {
      nextTick(() => load3DModel());
    });

    const getLanguageExt = (filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase();
      return LANG_MAP[ext] || null;
    };

    const editorExtensions = computed(() => {
      if (!activeTab.value) return [oneDark];
      const langFn = getLanguageExt(activeTab.value.path);
      return langFn ? [langFn(), oneDark] : [oneDark];
    });

    // ── Preview ──────────────────────────────────────────────
    const updatePreview = () => {
      if (!previewFrame.value || !activeTab.value || !isHtmlFile.value) return;
      previewFrame.value.srcdoc = activeTab.value.content;
    };

    const refreshPreview = () => {
      if (isHtmlFile.value && previewFrame.value) {
        // Force iframe reload by clearing then re-setting srcdoc
        previewFrame.value.srcdoc = '';
        nextTick(() => updatePreview());
      } else {
        updatePreview();
      }
      if (isMarkdownFile.value) {
        destroyVizInstances();
        renderMarkdownViz();
      }
    };

    let previewTimer = null;
    const schedulePreviewUpdate = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        updatePreview();
        if (isMarkdownFile.value) renderMarkdownViz();
      }, 400);
    };

    watch(activeTabPath, () => nextTick(() => {
      updatePreview();
      // Markdown viz/math handled by watch(renderedMarkdown) — don't duplicate
    }));

    // ── Chart/Viz rendering for markdown preview ─────────────
    const destroyVizInstances = () => {
      chartInstances.value.forEach((inst) => { try { inst.destroy(); } catch (e) { /* */ } });
      chartInstances.value = [];
      threeInstances.value.forEach(({ renderer, animationId, controls }) => {
        try { cancelAnimationFrame(animationId); controls.dispose(); renderer.dispose(); } catch (e) { /* */ }
      });
      threeInstances.value = [];
      renderedChartIds.clear();
      renderedD3Ids.clear();
      renderedThreeIds.clear();
    };

    const renderChartJsInPreview = async () => {
      if (!markdownPreviewRef.value) return;
      const containers = markdownPreviewRef.value.querySelectorAll('.chartjs-container');
      if (containers.length === 0) return;

      const Chart = await loadChartJs();
      const styles = getComputedStyle(document.body);
      const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
      const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#a0a0a0';
      const primaryRgb = styles.getPropertyValue('--primary-rgb').trim() || '25, 239, 131';
      const gridColor = `rgba(${primaryRgb}, 0.08)`;
      const palette = ['#e53d8f', '#12e0ff', '#19ef83', '#ffd700', '#7d3de5', '#ff9500', '#ff4444', '#d13de5'];

      containers.forEach((container) => {
        const chartId = container.getAttribute('data-chart-id');
        if (!chartId || renderedChartIds.has(chartId)) return;
        renderedChartIds.add(chartId);
        try {
          const configEl = container.querySelector('.chartjs-config');
          if (!configEl) return;
          const textarea = document.createElement('textarea');
          textarea.innerHTML = configEl.textContent || '';
          const rawConfig = textarea.value;
          configEl.remove();

          const config = JSON.parse(rawConfig);
          config.options = config.options || {};
          config.options.responsive = true;
          config.options.maintainAspectRatio = true;
          config.options.plugins = config.options.plugins || {};
          config.options.plugins.legend = config.options.plugins.legend || {};
          config.options.plugins.legend.labels = config.options.plugins.legend.labels || {};
          config.options.plugins.legend.labels.color = config.options.plugins.legend.labels.color || textColor;

          const chartType = config.type || 'bar';
          if (['bar', 'line', 'scatter', 'bubble'].includes(chartType)) {
            config.options.scales = config.options.scales || {};
            config.options.scales.x = config.options.scales.x || {};
            config.options.scales.x.ticks = config.options.scales.x.ticks || {};
            config.options.scales.x.ticks.color = config.options.scales.x.ticks.color || textMuted;
            config.options.scales.x.grid = config.options.scales.x.grid || {};
            config.options.scales.x.grid.color = config.options.scales.x.grid.color || gridColor;
            config.options.scales.y = config.options.scales.y || {};
            config.options.scales.y.ticks = config.options.scales.y.ticks || {};
            config.options.scales.y.ticks.color = config.options.scales.y.ticks.color || textMuted;
            config.options.scales.y.grid = config.options.scales.y.grid || {};
            config.options.scales.y.grid.color = config.options.scales.y.grid.color || gridColor;
          }

          if (config.data && config.data.datasets) {
            config.data.datasets.forEach((ds, i) => {
              const color = palette[i % palette.length];
              if (['pie', 'doughnut', 'polarArea'].includes(chartType)) {
                ds.backgroundColor = ds.backgroundColor || palette.slice(0, (config.data.labels || []).length);
                ds.borderColor = ds.borderColor || 'rgba(0,0,0,0.2)';
              } else {
                ds.backgroundColor = ds.backgroundColor || color;
                ds.borderColor = ds.borderColor || color;
              }
            });
          }

          const canvas = container.querySelector('canvas');
          if (!canvas) return;
          const instance = new Chart(canvas.getContext('2d'), config);
          chartInstances.value.push(instance);
        } catch (err) {
          console.warn('Chart.js rendering error:', err.message);
          container.innerHTML = `<div style="padding:16px;background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);border-radius:8px;color:var(--color-red,#ff4d4d);font-size:13px;"><strong>Chart Render Failed</strong><br><span style="opacity:0.8">${err.message}</span></div>`;
        }
      });
    };

    const renderD3InPreview = async () => {
      if (!markdownPreviewRef.value) return;
      const containers = markdownPreviewRef.value.querySelectorAll('.d3-container');
      if (containers.length === 0) return;

      const d3 = await loadD3();

      containers.forEach((container) => {
        const d3Id = container.getAttribute('data-d3-id');
        if (!d3Id || renderedD3Ids.has(d3Id)) return;
        renderedD3Ids.add(d3Id);

        (async () => {
          try {
            const codeEl = container.querySelector('.d3-code');
            if (!codeEl) return;
            const textarea = document.createElement('textarea');
            textarea.innerHTML = codeEl.textContent || '';
            const d3Code = textarea.value;
            codeEl.remove();

            const chartDiv = document.createElement('div');
            chartDiv.classList.add('d3-chart');
            container.appendChild(chartDiv);

            const cleanedD3Code = d3Code.replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '').replace(/^\s*export\s+(?:default\s+)?/gm, '');
            const containerSelection = d3.select(chartDiv);
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const fn = new AsyncFunction('d3', 'container', cleanedD3Code);
            await fn(d3, containerSelection);
          } catch (err) {
            console.warn('D3 rendering error:', err.message);
            container.innerHTML = `<div style="padding:16px;background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);border-radius:8px;color:var(--color-red,#ff4d4d);font-size:13px;"><strong>D3 Render Failed</strong><br><span style="opacity:0.8">${err.message}</span></div>`;
          }
        })();
      });
    };

    const renderThreeJsInPreview = async () => {
      if (!markdownPreviewRef.value) return;
      const containers = markdownPreviewRef.value.querySelectorAll('.threejs-container');
      if (containers.length === 0) return;

      const { THREE, THREE_ADDONS, OrbitControls } = await loadThreeJs();

      containers.forEach((container) => {
        const threeId = container.getAttribute('data-three-id');
        if (!threeId || renderedThreeIds.has(threeId)) return;
        renderedThreeIds.add(threeId);

        (async () => {
          try {
            const codeEl = container.querySelector('.threejs-code');
            if (!codeEl) return;
            const textarea = document.createElement('textarea');
            textarea.innerHTML = codeEl.textContent || '';
            const threeCode = textarea.value;
            codeEl.remove();

            const canvas = document.createElement('canvas');
            canvas.classList.add('threejs-canvas');
            canvas.width = 600;
            canvas.height = 400;
            container.appendChild(canvas);

            const scene = new THREE.Scene();
            scene.background = new THREE.Color(cssColor('--color-background', '#10101f'));
            const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000);
            camera.position.set(3, 3, 5);
            camera.lookAt(0, 0, 0);
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setSize(canvas.width, canvas.height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            const controls = new OrbitControls(camera, canvas);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            const ambientLight = new THREE.AmbientLight(0x404040, 2);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
            directionalLight.position.set(5, 10, 7);
            scene.add(directionalLight);

            const safeAtob = (str) => {
              let cleaned = str.replace(/[^A-Za-z0-9+/=]/g, '');
              while (cleaned.length % 4 !== 0) cleaned += '=';
              return atob(cleaned);
            };

            const MAX_ARRAY_LENGTH = 10_000_000;
            const guardedTHREE = new Proxy(THREE, {
              get(target, prop) {
                const val = target[prop] ?? THREE_ADDONS[prop];
                if (['BufferAttribute','Float32BufferAttribute','Uint16BufferAttribute','Uint32BufferAttribute','Int8BufferAttribute','Int16BufferAttribute','Int32BufferAttribute','Float64BufferAttribute','Uint8BufferAttribute','Uint8ClampedBufferAttribute'].includes(prop)) {
                  return new Proxy(val, {
                    construct(Target, args) {
                      const arr = args[0];
                      if (arr && arr.length > MAX_ARRAY_LENGTH) throw new Error(`Buffer too large (${arr.length.toLocaleString()} elements)`);
                      return new Target(...args);
                    },
                  });
                }
                return val;
              },
            });

            const cleanedCode = threeCode
              .replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '')
              .replace(/^\s*export\s+(?:default\s+)?/gm, '')
              .replace(/await\s+import\s*\(\s*['"][^'"]*['"]\s*\)/g, 'THREE_ADDONS')
              .replace(/import\s*\(\s*['"][^'"]*['"]\s*\)/g, 'Promise.resolve(THREE_ADDONS)');

            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const fn = new AsyncFunction('THREE', 'THREE_ADDONS', 'scene', 'camera', 'renderer', 'controls', 'canvas', 'atob', cleanedCode);
            await fn(guardedTHREE, THREE_ADDONS, scene, camera, renderer, controls, canvas, safeAtob);

            let animationId;
            const animate = () => { animationId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
            animate();
            threeInstances.value.push({ renderer, animationId, controls });
          } catch (err) {
            console.warn('Three.js rendering error:', err.message);
            container.innerHTML = `<div style="padding:16px;background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);border-radius:8px;color:var(--color-red,#ff4d4d);font-size:13px;"><strong>3D Render Failed</strong><br><span style="opacity:0.8">${err.message}</span></div>`;
          }
        })();
      });
    };

    let mathJaxTimer = null;
    const renderMathJax = () => {
      clearTimeout(mathJaxTimer);
      mathJaxTimer = setTimeout(() => {
        const el = markdownPreviewRef.value;
        if (!el || typeof MathJax === 'undefined' || !MathJax.typesetPromise) return;
        // Clear previous state and re-typeset scoped to this element only
        MathJax.typesetClear([el]);
        MathJax.typesetPromise([el])
          .catch((err) => {
            console.error('MathJax rendering error:', err);
          });
      }, 50);
    };

    const renderMarkdownViz = () => {
      nextTick(() => {
        renderChartJsInPreview();
        renderD3InPreview();
        renderThreeJsInPreview();
        renderMathJax();
      });
    };

    // Re-render viz when markdown content changes
    watch(renderedMarkdown, () => {
      destroyVizInstances();
      renderMarkdownViz();
    });

    // ── Divider resize ───────────────────────────────────────
    let resizeStartX = 0;
    let resizeStartWidth = 0;

    const startResize = (e) => {
      isResizing.value = true;
      resizeStartX = e.clientX;
      resizeStartWidth = editorWidth.value;
      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', stopResize);
    };

    const onResize = (e) => {
      if (!bodyRef.value) return;
      const containerWidth = bodyRef.value.getBoundingClientRect().width;
      const delta = ((e.clientX - resizeStartX) / containerWidth) * 100;
      editorWidth.value = Math.max(20, Math.min(80, resizeStartWidth + delta));
    };

    const stopResize = () => {
      isResizing.value = false;
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
      // Re-render charts at new size after divider drag
      if (isMarkdownFile.value) {
        destroyVizInstances();
        renderMarkdownViz();
      }
    };

    // ── File operations ───────────────────────────────────────
    const broadcastOpenFile = (tab) => {
      window.dispatchEvent(
        new CustomEvent('artifacts-open-file', {
          detail: { path: tab.path, content: tab.content },
        })
      );
    };

    const isBinaryExt = (ext) => IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || PDF_EXTS.has(ext) || EPUB_EXTS.has(ext) || MODEL3D_EXTS.has(ext);

    const openFile = async (filePath) => {
      const existing = openTabs.value.find((t) => t.path === filePath);
      if (existing) {
        activeTabPath.value = filePath;
        broadcastOpenFile(existing);
        return;
      }

      try {
        const name = filePath.split('/').pop();
        const ext = name.split('.').pop()?.toLowerCase() || '';
        let tab;

        if (isBinaryExt(ext)) {
          // Binary files — don't read content, just open the tab for preview
          tab = { path: filePath, name, content: '', savedContent: '', isDirty: false };
        } else {
          const data = await getFile(filePath);
          tab = { path: filePath, name, content: data.content, savedContent: data.content, isDirty: false };
        }

        openTabs.value.push(tab);
        activeTabPath.value = filePath;
        broadcastOpenFile(tab);
      } catch (err) {
        console.error('Error opening file:', err);
      }
    };

    const switchTab = (path) => {
      activeTabPath.value = path;
      const tab = openTabs.value.find((t) => t.path === path);
      if (tab) broadcastOpenFile(tab);
    };

    const closeTab = (path) => {
      const idx = openTabs.value.findIndex((t) => t.path === path);
      if (idx === -1) return;
      openTabs.value.splice(idx, 1);

      if (activeTabPath.value === path) {
        if (openTabs.value.length > 0) {
          const newIdx = Math.min(idx, openTabs.value.length - 1);
          activeTabPath.value = openTabs.value[newIdx].path;
          broadcastOpenFile(openTabs.value[newIdx]);
        } else {
          activeTabPath.value = null;
          broadcastOpenFile({ path: null, content: null });
        }
      }
    };

    const handleEditorChange = (value) => {
      if (activeTab.value) {
        activeTab.value.content = value;
        activeTab.value.isDirty = value !== activeTab.value.savedContent;
        schedulePreviewUpdate();
      }
    };

    const saveActiveFile = async () => {
      if (!activeTab.value || !activeTab.value.isDirty) return;
      isSaving.value = true;
      try {
        await saveFile(activeTab.value.path, activeTab.value.content);
        activeTab.value.savedContent = activeTab.value.content;
        activeTab.value.isDirty = false;
      } catch (err) {
        console.error('Error saving file:', err);
      } finally {
        isSaving.value = false;
      }
    };

    const handlePanelAction = (action, data) => {
      if (action === 'open-file' && data?.path) {
        openFile(data.path);
      } else if (action === 'file-renamed' && data?.oldPath && data?.newPath) {
        const tab = openTabs.value.find((t) => t.path === data.oldPath);
        if (tab) {
          tab.path = data.newPath;
          tab.name = data.newPath.split('/').pop();
          if (activeTabPath.value === data.oldPath) {
            activeTabPath.value = data.newPath;
          }
        }
      } else if (action === 'file-deleted' && data?.path) {
        // Close the deleted file's tab if open
        const idx = openTabs.value.findIndex((t) => t.path === data.path);
        if (idx !== -1) {
          closeTab(data.path);
        }
        // Also close any tabs inside a deleted directory
        if (data.type === 'directory') {
          const prefix = data.path + '/';
          const toClose = openTabs.value.filter((t) => t.path.startsWith(prefix)).map((t) => t.path);
          toClose.forEach((p) => closeTab(p));
        }
      }
    };

    // Keyboard shortcut: Ctrl+S
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    };

    // Listen for file_written events from Annie chat
    const handleFileWritten = (e) => {
      const { path, content } = e.detail;
      const existingTab = openTabs.value.find((t) => t.path === path);
      if (existingTab) {
        existingTab.content = content;
        existingTab.savedContent = content;
        existingTab.isDirty = false;
        if (activeTabPath.value === path) schedulePreviewUpdate();
      } else {
        const name = path.split('/').pop();
        openTabs.value.push({ path, name, content, savedContent: content, isDirty: false });
        activeTabPath.value = path;
        broadcastOpenFile({ path, content });
      }
    };

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('code-file-written', handleFileWritten);
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('code-file-written', handleFileWritten);
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
      clearTimeout(previewTimer);
      clearTimeout(mathJaxTimer);
      destroyVizInstances();
      destroyEpub();
      destroy3DModel();
      stopVisualizer();
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; audioAnalyser = null; }
    });

    return {
      baseScreenRef,
      bodyRef,
      previewFrame,
      markdownPreviewRef,
      openTabs,
      activeTabPath,
      activeTab,
      isSaving,
      editorWidth,
      isResizing,
      showCode,
      isHtmlFile,
      isMarkdownFile,
      isImageFile,
      isVideoFile,
      isAudioFile,
      isPdfFile,
      isEpubFile,
      epubContainerRef,
      epubPrev,
      epubNext,
      is3DFile,
      modelContainerRef,
      isSpreadsheetFile,
      spreadsheetData,
      isTextFile,
      rawFileUrl,
      audioPlayerRef,
      audioCanvasRef,
      startVisualizer,
      stopVisualizer,
      renderedMarkdown,
      editorExtensions,
      switchTab,
      closeTab,
      handleEditorChange,
      saveActiveFile,
      handlePanelAction,
      startResize,
      refreshPreview,
      // Share
      showShareModal,
      isSharing,
      shareError,
      shareResult,
      shareTitle,
      shareEmbedCode,
      copiedLink,
      copiedEmbed,
      shareLinkInput,
      shareEmbedInput,
      openShareModal,
      closeShareModal,
      submitShare,
      retryShare,
      copyShareLink,
      copyEmbedCode,
      openInBrowser,
    };
  },
};
</script>

<style scoped>
.ce-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-background);
}

/* ── Tab bar ── */
.ce-tabs {
  display: flex;
  gap: 0;
  background: var(--color-darker-0);
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}

.ce-tabs::-webkit-scrollbar {
  display: none;
}

.ce-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  border-right: 1px solid var(--terminal-border-color);
  white-space: nowrap;
  transition: all 0.12s;
  user-select: none;
}

.ce-tab:hover {
  background: rgba(var(--primary-rgb), 0.04);
  color: var(--color-text);
}

.ce-tab.active {
  background: var(--color-background);
  color: var(--color-primary);
  border-bottom: 1px solid var(--color-primary);
  margin-bottom: -1px;
}

.ce-tab-name {
  font-family: inherit;
}

.ce-tab-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 10px;
  padding: 2px;
  opacity: 0.4;
  transition: opacity 0.12s;
  line-height: 1;
}

.ce-tab-close:hover {
  opacity: 1;
  color: var(--color-red);
}

/* ── Body (editor + divider + preview) ── */
.ce-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}

.ce-body.is-resizing {
  user-select: none;
}

.ce-body.is-resizing .ce-preview-iframe {
  pointer-events: none;
}

/* ── Editor half ── */
.ce-editor-half {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  flex-shrink: 0;
}

/* ── Info bar ── */
.ce-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  flex-shrink: 0;
}

.ce-filepath {
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ce-save-btn {
  padding: 3px 10px;
  border-radius: 3px;
  border: 1px solid var(--terminal-border-color);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s;
  white-space: nowrap;
}

.ce-save-btn:hover:not(:disabled) {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}

.ce-save-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ── Editor ── */
.ce-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Empty state ── */
.ce-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
}

.ce-empty i {
  font-size: 3em;
  opacity: 0.3;
  color: var(--color-primary);
}

.ce-empty p {
  font-size: 14px;
  color: var(--color-text-muted);
}

.ce-shortcut {
  font-size: 11px;
  opacity: 0.5;
  font-family: var(--font-family-mono);
}

/* ── Divider ── */
.ce-divider {
  width: 5px;
  flex-shrink: 0;
  background: var(--terminal-border-color);
  cursor: col-resize;
  transition: background 0.15s;
  position: relative;
}

.ce-divider:hover,
.ce-divider.active {
  background: var(--color-primary);
}

/* ── Preview half ── */
.ce-preview-half {
  flex: 1 1 0%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 0;
  overflow: hidden;
}

.ce-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--color-darker-0);
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
}

.ce-preview-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ce-preview-actions {
  display: flex;
  gap: 6px;
}

.ce-preview-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.12s;
}

.ce-preview-btn:hover {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.ce-preview-btn.active {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.12);
}

.ce-preview-content {
  flex: 1 1 0%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ce-preview-iframe {
  flex: 1 1 0%;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.ce-markdown-preview {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--color-darker-1);
  color: var(--color-text, #ccc);
  font-size: 14px;
  line-height: 1.7;
  scrollbar-width: thin;
}

.ce-text-preview {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  background: var(--color-darker-1);
  color: var(--color-text, #ccc);
  font-family: var(--font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
}

.ce-media-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: var(--color-darkest);
  padding: 16px;
}

.ce-media-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.ce-media-preview video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
  outline: none;
}

.ce-audio-preview {
  flex-direction: column;
  gap: 12px;
}

.ce-audio-canvas {
  width: 100%;
  max-width: 500px;
  height: 140px;
  border-radius: 8px;
  background: rgba(var(--primary-rgb, 25, 239, 131), 0.04);
  border: 1px solid rgba(var(--primary-rgb, 25, 239, 131), 0.1);
}

.ce-audio-name {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0;
}

.ce-media-preview audio {
  width: 100%;
  max-width: 500px;
  outline: none;
}

.ce-pdf-preview {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.ce-epub-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-darker-1);
}

.ce-epub-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ce-epub-nav {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 8px;
  border-top: 1px solid var(--terminal-border-color);
}

.ce-epub-nav .ce-preview-btn {
  font-size: 14px;
  padding: 4px 12px;
}

.ce-3d-preview {
  flex: 1;
  min-height: 0;
  background: var(--color-background);
  cursor: grab;
}

.ce-3d-preview:active {
  cursor: grabbing;
}

.ce-spreadsheet-preview {
  flex: 1;
  overflow: auto;
  background: var(--color-darker-1);
  scrollbar-width: thin;
}

.ce-spreadsheet {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--font-family-mono);
}

.ce-spreadsheet thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.ce-spreadsheet th {
  background: var(--color-darkest);
  color: var(--color-text, #ccc);
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--terminal-border-color);
  white-space: nowrap;
}

.ce-spreadsheet td {
  padding: 6px 12px;
  border-bottom: 1px solid rgba(var(--primary-rgb, 25, 239, 131), 0.06);
  color: var(--color-text, #ccc);
  white-space: nowrap;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ce-spreadsheet tbody tr:hover td {
  background: rgba(var(--primary-rgb, 25, 239, 131), 0.04);
}

.ce-row-num {
  color: var(--color-text-muted) !important;
  font-size: 11px;
  opacity: 0.5;
  text-align: right !important;
  user-select: none;
  padding-right: 8px !important;
  min-width: 36px;
  border-right: 1px solid var(--terminal-border-color) !important;
}

.ce-preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--color-darker-1);
  color: var(--color-text-muted);
}

.ce-preview-empty i {
  font-size: 2.5em;
  opacity: 0.25;
  color: var(--color-primary);
}

.ce-preview-empty p {
  font-size: 12px;
  opacity: 0.6;
}
</style>

<style>
/* CodeMirror overrides for the artifacts screen */
.ce-editor .cm-editor {
  height: 100% !important;
  background: var(--color-darker-1) !important;
}

.ce-editor .cm-scroller {
  overflow: auto;
}

/* Markdown element styles (unscoped so v-html content is styled) */
.ce-markdown-preview p {
  margin-top: 1em;
  margin-bottom: 1em;
}
.ce-markdown-preview p:last-child {
  margin-bottom: 0;
}

.ce-markdown-preview h1,
.ce-markdown-preview h2,
.ce-markdown-preview h3,
.ce-markdown-preview h4,
.ce-markdown-preview h5,
.ce-markdown-preview h6 {
  color: var(--color-text);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1em;
  margin-bottom: 0.75em;
}

.ce-markdown-preview img {
  width: 100%;
  max-width: 100%;
}

.ce-markdown-preview pre {
  background-color: var(--color-darker-1);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid var(--terminal-border-color);
  margin-top: 0;
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.ce-markdown-preview code {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.ce-markdown-preview pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  font-size: 0.9em;
}

.ce-markdown-preview code:not(pre code) {
  background-color: rgba(127, 129, 147, 0.15);
  padding: 0 2px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: bold;
  color: var(--color-primary);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.ce-markdown-preview ul,
.ce-markdown-preview ol {
  margin-top: 0.5em;
  margin-bottom: 1em;
  padding-left: 2em;
}

.ce-markdown-preview li {
  margin-bottom: 0.5em;
  line-height: 1.6;
}

.ce-markdown-preview blockquote {
  margin: 1em 0;
  padding: 0.8em 1.5em;
  border-left: 4px solid var(--color-blue);
  background-color: rgba(18, 224, 255, 0.03);
  color: var(--color-light-med-navy);
  border-radius: 0 4px 4px 0;
}

.ce-markdown-preview table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  border: 1px solid rgba(127, 129, 147, 0.15);
  border-radius: 6px;
  margin: 1.5em 0;
}

.ce-markdown-preview th,
.ce-markdown-preview td {
  border: 1px solid rgba(127, 129, 147, 0.15);
  padding: 0.75em 1em;
  text-align: left;
}

.ce-markdown-preview th {
  background-color: rgba(127, 129, 147, 0.08);
  font-weight: 600;
  color: var(--color-light-med-navy);
}

.ce-markdown-preview a {
  color: var(--color-primary);
  transition: color 0.2s ease;
}

.ce-markdown-preview a:hover {
  text-decoration-thickness: 2px;
}

.ce-markdown-preview strong,
.ce-markdown-preview b {
  font-weight: 600;
}

.ce-markdown-preview em,
.ce-markdown-preview i {
  font-style: italic;
}

.ce-markdown-preview hr {
  border: none;
  border-top: 1px solid var(--terminal-border-color);
  margin: 16px 0;
}

/* Chart.js containers in markdown preview */
.ce-markdown-preview .chartjs-container {
  width: 100%;
  max-height: 400px;
  padding: 16px;
  margin: 12px 0;
  background-color: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ce-markdown-preview .chartjs-container canvas {
  max-height: 360px !important;
  width: 100% !important;
}

/* D3 containers in markdown preview */
.ce-markdown-preview .d3-container {
  width: 100%;
  margin: 12px 0;
  padding: 16px;
  background-color: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ce-markdown-preview .d3-container .d3-chart {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ce-markdown-preview .d3-container svg {
  max-width: 100%;
  height: auto;
  display: block;
}

.ce-markdown-preview .d3-container text {
  fill: #e0e0e0;
}

.ce-markdown-preview .d3-container .axis text {
  fill: #a0a0a0;
  font-size: 11px;
}

.ce-markdown-preview .d3-container .axis path,
.ce-markdown-preview .d3-container .axis line {
  stroke: #555;
}

.ce-markdown-preview .d3-container .grid line {
  stroke: rgba(255, 255, 255, 0.08);
}

/* Three.js containers in markdown preview */
.ce-markdown-preview .threejs-container {
  width: 100%;
  margin: 12px 0;
  background-color: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ce-markdown-preview .threejs-container .threejs-canvas {
  width: 100% !important;
  height: auto !important;
  max-height: 450px;
  display: block;
  cursor: grab;
}

.ce-markdown-preview .threejs-container .threejs-canvas:active {
  cursor: grabbing;
}

/* Share Modal Styles */
.share-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  backdrop-filter: blur(4px);
  animation: modal-fade-in 0.2s ease;
}
.share-modal {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  width: 90%;
  max-width: 450px;
  animation: modal-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.share-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.share-modal-header h3 {
  margin: 0;
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-white);
}
.share-modal-close {
  background: none;
  border: none;
  color: var(--color-light-med-navy);
  font-size: 1.5em;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
  transition: color 0.2s ease;
}
.share-modal-close:hover { color: var(--color-red); }
.share-modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
}
.share-spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--terminal-border-color);
  border-top-color: var(--color-green);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.share-modal-loading p { color: var(--color-light-med-navy); font-size: 0.95em; margin: 0; }
.share-modal-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  gap: 16px;
  text-align: center;
}
.share-modal-error .error-icon { font-size: 1.2em; color: var(--color-red); font-weight: 600; }
.share-modal-error p { color: var(--color-red); font-size: 0.95em; margin: 0; }
.share-retry-btn {
  padding: 10px 24px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 6px;
  color: var(--color-red);
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.share-retry-btn:hover { background: rgba(255, 107, 107, 0.2); border-color: var(--color-red); }
.share-modal-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  gap: 20px;
}
.share-modal-success .success-message { color: var(--color-green); font-size: 1em; font-weight: 500; margin: 0; }
.share-options { width: 100%; display: flex; flex-direction: column; gap: 16px; }
.share-option { display: flex; flex-direction: column; gap: 8px; }
.share-option label { font-size: 0.8em; font-weight: 500; color: var(--color-light-med-navy); text-transform: uppercase; letter-spacing: 0.05em; }
.share-input { display: flex; gap: 8px; }
.share-input input {
  flex: 1;
  background: var(--color-darkest);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-white);
  font-family: var(--font-family-mono);
  font-size: 0.85em;
}
.share-input input:focus { outline: none; border-color: var(--color-green); }
.share-copy-btn {
  padding: 10px 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.share-copy-btn:hover { background: rgba(var(--green-rgb), 0.2); border-color: var(--color-green); }
.share-actions { display: flex; gap: 12px; width: 100%; margin-top: 8px; }
.share-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.share-action-btn.view-btn { background: rgba(18, 224, 255, 0.1); border: 1px solid rgba(18, 224, 255, 0.3); color: var(--color-blue); }
.share-action-btn.view-btn:hover { background: rgba(18, 224, 255, 0.2); border-color: var(--color-blue); }
.share-action-btn.edit-btn { background: rgba(127, 129, 147, 0.1); border: 1px solid rgba(127, 129, 147, 0.3); color: var(--color-light-med-navy); }
.share-action-btn.edit-btn:hover { background: rgba(127, 129, 147, 0.2); border-color: var(--color-light-med-navy); }
.share-modal-form { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
.share-form-field { display: flex; flex-direction: column; gap: 8px; }
.share-form-field label { font-size: 0.85em; font-weight: 500; color: var(--color-light-med-navy); }
.share-form-field input {
  background: var(--color-darkest);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px 14px;
  color: var(--color-white);
  font-size: 0.95em;
}
.share-form-field input:focus { outline: none; border-color: var(--color-green); }
.share-form-field input::placeholder { color: var(--color-duller-navy); }
.share-form-actions { display: flex; gap: 12px; justify-content: flex-end; }
.share-cancel-btn {
  padding: 10px 20px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.share-cancel-btn:hover { background: rgba(127, 129, 147, 0.1); border-color: var(--color-light-med-navy); }
.share-submit-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--color-green);
  border: none;
  border-radius: 6px;
  color: var(--color-darkest);
  font-size: 0.9em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}
.share-submit-btn:hover:not(:disabled) { background: #15d975; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3); }
.share-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

@keyframes modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-slide-up { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
