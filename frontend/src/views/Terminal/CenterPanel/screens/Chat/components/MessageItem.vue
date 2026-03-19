<template>
  <div class="message-wrapper" :class="[message.role, { compact, editing: isEditing }]" ref="messageRef">
    <img v-if="message.role === 'assistant' && showAvatar" :src="assistantAvatar" alt="Assistant Avatar" class="message-avatar" />
    <div class="message-content">
      <div class="message-card">
        <!-- Edit mode for user messages -->
        <div v-if="isEditing" class="message-edit-container">
          <textarea
            ref="editTextarea"
            v-model="editText"
            class="message-edit-textarea"
            @keydown="handleEditKeydown"
            @input="autoResizeEdit"
            rows="1"
          ></textarea>
          <div class="message-edit-actions">
            <button class="edit-cancel-btn" @click="cancelEditing">Cancel</button>
            <button class="edit-send-btn" @click="submitEdit" :disabled="!editText.trim()">Send</button>
          </div>
        </div>

        <template v-else>
          <!-- Edit button for user messages -->
          <button v-if="message.role === 'user' && !status" class="message-edit-btn" @click="startEditing" title="Edit & resend">
            <i class="fas fa-pen"></i>
          </button>

          <div v-if="status" class="status-indicator" :class="status.type">
            <div class="status-spinner"></div>
            <span class="status-text">{{ status.text }}</span>
          </div>
          <!-- Interleaved content: text and tool calls rendered in order -->
          <template v-for="(part, partIdx) in renderedParts" :key="partIdx">
            <div v-if="part.type === 'text' && part.html" class="message-text" v-morph-html="part.html"></div>
            <div v-else-if="part.type === 'tool_calls'" class="tool-execution-details">
              <div v-for="tc in part.items" :key="`${message.id}-${tc.index}`" class="tool-call-item">
                <div class="top-tool-bar">
                  <div class="tool-header" @click="toggleToolCall(tc.index)">
                    <span class="tool-expansion-icon">
                      {{ isExpanded(tc.index) ? '▾' : '▸' }}
                    </span>
                    <span class="tool-icon">⚙️</span>
                    <span class="tool-label">{{ tc.toolCall.name }}</span>
                  </div>

                  <div v-if="isRunning(tc.toolCall.id)" class="tool-running">
                    <div class="spinner"></div>
                    <span>Executing...</span>
                  </div>

                  <!-- Stop button for async tools -->
                  <Tooltip text="Stop async tool">
                    <button v-if="isAsyncToolRunning(tc.toolCall)" @click="stopAsyncTool(tc.toolCall)" class="stop-async-tool-btn">
                      <i class="fas fa-stop"></i>
                    </button>
                  </Tooltip>
                </div>

                <div v-if="isExpanded(tc.index)" class="tool-call-content">
                  <div class="tool-params">
                    <div class="params-label">Input Parameters:</div>
                    <pre class="params-content"><code class="language-json" v-html="formatJSON(tc.toolCall.args)"></code></pre>
                  </div>
                  <div v-if="tc.toolCall.result" class="tool-result">
                    <div class="result-label">Output:</div>

                    <!-- Image Gallery for image generation results -->
                    <div v-if="hasImages(tc.toolCall.result)" class="tool-images">
                      <div v-if="extractImages(tc.toolCall.result).length === 1" class="single-image-container">
                        <img :src="extractImages(tc.toolCall.result)[0]" alt="Generated Image" class="generated-image" />
                        <div class="image-actions">
                          <button @click="downloadImage(extractImages(tc.toolCall.result)[0], 'generated-image.png')" class="image-action-btn">
                            <span class="btn-icon">📥</span>
                            <span class="btn-text">Download</span>
                          </button>
                          <button @click="copyImageToClipboard(extractImages(tc.toolCall.result)[0])" class="image-action-btn">
                            <span class="btn-icon">📋</span>
                            <span class="btn-text">Copy</span>
                          </button>
                          <button @click="openImageInNewTab(extractImages(tc.toolCall.result)[0])" class="image-action-btn">
                            <span class="btn-icon">🔍</span>
                            <span class="btn-text">Open</span>
                          </button>
                        </div>
                      </div>

                      <div v-else class="image-grid">
                        <div v-for="(img, idx) in extractImages(tc.toolCall.result)" :key="idx" class="grid-item">
                          <img :src="img" :alt="`Generated Image ${idx + 1}`" class="grid-image" @click="openImageInNewTab(img)" />
                          <div class="grid-item-actions">
                            <Tooltip text="Download" width="auto">
                              <button @click="downloadImage(img, `generated-image-${idx + 1}.png`)" class="grid-action-btn">📥</button>
                            </Tooltip>
                            <Tooltip text="Copy" width="auto">
                              <button @click="copyImageToClipboard(img)" class="grid-action-btn">📋</button>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Regular JSON output for non-image results -->
                    <pre v-else class="result-content"><code class="language-json" v-html="formatJSON(tc.toolCall.result)"></code></pre>
                  </div>
                  <div v-if="tc.toolCall.error" class="tool-error">
                    <div class="error-label">Error:</div>
                    <pre class="error-content"><code v-html="tc.toolCall.error"></code></pre>
                  </div>
                </div>

                <!-- Inline Goal Progress Widget for autonomous goals -->
                <GoalProgressWidget
                  v-if="isAutonomousGoalTool(tc.toolCall)"
                  :goalId="extractGoalId(tc.toolCall)"
                  :goalTitle="extractGoalTitle(tc.toolCall)"
                  :taskCount="extractTaskCount(tc.toolCall)"
                  :maxIterations="extractMaxIterations(tc.toolCall)"
                />
              </div>
            </div>
          </template>

          <!-- Uploaded Files Preview (for user messages) -->
          <div v-if="message.files && message.files.length > 0 && message.role === 'user'" class="uploaded-files-preview">
            <div v-for="(file, idx) in message.files" :key="idx" class="uploaded-file-item">
              <!-- Image preview -->
              <div v-if="file.type.startsWith('image/')" class="uploaded-image-preview">
                <img :src="getFilePreviewUrl(file)" :alt="file.name" class="preview-image" />
                <div class="file-info">
                  <span class="file-name">{{ file.name }}</span>
                  <span class="file-size">{{ formatFileSize(file.size) }}</span>
                </div>
              </div>
              <!-- Non-image file preview -->
              <div v-else class="uploaded-file-info">
                <span class="file-icon">📄</span>
                <div class="file-details">
                  <span class="file-name">{{ file.name }}</span>
                  <span class="file-size">{{ formatFileSize(file.size) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Provider Setup UI -->
          <ProviderSetup v-if="message.showProviderSetup" @provider-connected="handleProviderConnected" />

          <!-- Provider Note (shown after provider buttons) -->
          <div v-if="message.showProviderNote" class="provider-note">
            <div class="note-icon">💡</div>
            <div class="note-text">
              <strong>Local Models:</strong> Any models running at <code>http://127.0.0.1:1234</code> will be automatically detected.
            </div>
          </div>

          <div v-if="message.metadata && message.metadata.length > 0" class="message-metadata">
            <span v-for="data in message.metadata" :key="data" class="metadata-tag">
              {{ data }}
            </span>
          </div> </template
        ><!-- end v-else (non-editing mode) -->
      </div>
      <span class="message-time">{{ formatTime(message.timestamp) }}</span>
    </div>

    <!-- HTML Preview Modal - Teleported to body for fullscreen -->
    <Teleport to="body">
      <div v-if="showPreviewModal" class="html-preview-modal" @click="closePreviewModal">
        <div class="html-preview-content" @click.stop>
          <div class="html-preview-header">
            <h3>HTML Preview</h3>
            <div class="html-preview-header-actions">
              <button class="share-preview-btn" @click="openShareModal(previewHTML)" :disabled="isSharing">
                <span class="btn-icon">{{ isSharing ? '⏳' : '🚀' }}</span>
                <span class="btn-text">{{ isSharing ? 'Sharing...' : 'Share' }}</span>
              </button>
              <button class="close-preview-btn" @click="closePreviewModal">✕</button>
            </div>
          </div>
          <div class="html-preview-body">
            <iframe :srcdoc="previewHTML" class="html-preview-iframe" frameborder="0"></iframe>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Visualization Fullscreen Modal (Chart.js, D3, Three.js) -->
    <Teleport to="body">
      <div v-if="showVizModal" class="html-preview-modal" @click="closeVizModal">
        <div class="html-preview-content" @click.stop>
          <div class="html-preview-header">
            <h3>{{ vizModalTitle }}</h3>
            <div class="html-preview-header-actions">
              <button class="share-preview-btn" @click="openShareModal(vizModalHTML)" :disabled="isSharing">
                <span class="btn-icon">{{ isSharing ? '⏳' : '🚀' }}</span>
                <span class="btn-text">{{ isSharing ? 'Sharing...' : 'Share' }}</span>
              </button>
              <button class="close-preview-btn" @click="closeVizModal">✕</button>
            </div>
          </div>
          <div class="html-preview-body">
            <iframe
              :srcdoc="vizModalHTML"
              class="html-preview-iframe"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
            ></iframe>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Share Modal - Teleported to body -->
    <Teleport to="body">
      <div v-if="showShareModal" class="share-modal-overlay" @click="closeShareModal">
        <div class="share-modal" @click.stop>
          <div class="share-modal-header">
            <h3>🚀 Share to AGNT Creations</h3>
            <button class="share-modal-close" @click="closeShareModal">&times;</button>
          </div>

          <!-- Sharing State -->
          <div v-if="isSharing" class="share-modal-loading">
            <div class="share-spinner"></div>
            <p>Sharing your creation...</p>
          </div>

          <!-- Error State -->
          <div v-else-if="shareError" class="share-modal-error">
            <div class="error-icon">❌</div>
            <p>{{ shareError }}</p>
            <button class="share-retry-btn" @click="retryShare">Try Again</button>
          </div>

          <!-- Success State -->
          <div v-else-if="shareResult" class="share-modal-success">
            <div class="success-icon">✅</div>
            <p class="success-message">Your creation has been shared!</p>

            <div class="share-options">
              <div class="share-option">
                <label>Link</label>
                <div class="share-input">
                  <input type="text" :value="shareResult.url" readonly ref="shareLinkInput" />
                  <button class="share-copy-btn" @click="copyShareLink">
                    {{ copiedLink ? '✓ Copied!' : 'Copy' }}
                  </button>
                </div>
              </div>

              <div class="share-option">
                <label>Embed</label>
                <div class="share-input">
                  <input type="text" :value="shareEmbedCode" readonly ref="shareEmbedInput" />
                  <button class="share-copy-btn" @click="copyEmbedCode">
                    {{ copiedEmbed ? '✓ Copied!' : 'Copy' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="share-actions">
              <button class="share-action-btn view-btn" @click="openInBrowser(shareResult.url)">
                <span class="btn-icon">👁</span>
                <span>View</span>
              </button>
              <button class="share-action-btn edit-btn" @click="openInBrowser(shareResult.editUrl)">
                <span class="btn-icon">✏️</span>
                <span>Edit</span>
              </button>
            </div>
          </div>

          <!-- Initial State - Title Input -->
          <div v-else class="share-modal-form">
            <div class="share-form-field">
              <label for="shareTitle">Title</label>
              <input type="text" id="shareTitle" v-model="shareTitle" placeholder="My Creation" @keyup.enter="submitShare" />
            </div>
            <div class="share-form-actions">
              <button class="share-cancel-btn" @click="closeShareModal">Cancel</button>
              <button class="share-submit-btn" @click="submitShare" :disabled="!shareTitle.trim()">
                <span class="btn-icon">🚀</span>
                <span>Share</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { computed, ref, watch, onMounted, onUpdated, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue';
import { useStore } from 'vuex';
import showdown from 'showdown';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/atom-one-dark.css';

import defaultAvatar from '@/assets/images/annie-avatar.png';
// Lazy-load ProviderSetup - only shown conditionally (message.showProviderSetup)
// This defers the crypto-js dependency (~40KB) from the critical render path
const ProviderSetup = defineAsyncComponent(() => import('./ProviderSetup.vue'));
import GoalProgressWidget from './GoalProgressWidget.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import morphdom from 'morphdom';
import { API_CONFIG } from '@/../user.config.js';

// --- v-morph-html directive ---
// Uses morphdom to diff/patch DOM instead of innerHTML replacement (v-html).
// Preserves stateful elements (Chart.js canvases, iframes, MathJax) during streaming.
const PRESERVE_SELECTORS = [
  '.chartjs-container[data-source-code]',
  '.d3-container[data-source-code]',
  '.threejs-container[data-source-code]',
  '.html-inline-preview-wrapper',
  '[data-buttons-added]',
  '[data-image-buttons-added]',
  '[data-viz-buttons]',
  '.math-container[data-math-rendered]',
].join(',');

function shouldPreserve(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'CANVAS') return true;
  if (el.tagName === 'IFRAME') return true;
  try {
    return el.matches(PRESERVE_SELECTORS);
  } catch {
    return false;
  }
}

const vMorphHtml = {
  mounted(el, binding) {
    el.innerHTML = binding.value || '';
    el._morphHtml = binding.value;
  },
  updated(el, binding) {
    const newHtml = binding.value || '';
    if (newHtml === el._morphHtml) return;
    el._morphHtml = newHtml;

    if (!el.childNodes.length) {
      el.innerHTML = newHtml;
      return;
    }

    const wrapper = document.createElement(el.tagName);
    wrapper.innerHTML = newHtml;

    morphdom(el, wrapper, {
      childrenOnly: true,
      onBeforeElUpdated(fromEl, toEl) {
        if (shouldPreserve(fromEl)) return false;
        if (fromEl.tagName === 'CODE' && fromEl.classList.contains('hljs') && fromEl.textContent === toEl.textContent) return false;
        return true;
      },
      onBeforeNodeDiscarded(node) {
        if (node.nodeType === 1 && shouldPreserve(node)) return false;
        if (node.nodeType === 1) {
          try {
            if (node.matches('.viz-action-buttons, .assistant-image-wrapper, .html-code-actions')) return false;
          } catch {}
        }
        return true;
      },
    });
  },
};

// Lazy-loaded heavy library caches (loaded on first use)
let _hljs = null;
let _Chart = null;
let _d3 = null;
let _THREE = null;
let _THREE_ADDONS = null;
let _OrbitControls = null;

const loadHljs = async () => {
  if (!_hljs) {
    const mod = await import('highlight.js');
    _hljs = mod.default;
  }
  return _hljs;
};

const loadChartJs = async () => {
  if (!_Chart) {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    _Chart = Chart;
  }
  return _Chart;
};

const loadD3 = async () => {
  if (!_d3) {
    _d3 = await import('d3');
  }
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
    ]);
    _THREE = threeModule;
    _OrbitControls = OrbitControls;
    _THREE_ADDONS = {
      OrbitControls,
      GLTFLoader,
      FontLoader,
      TextGeometry,
      EffectComposer,
      RenderPass,
      UnrealBloomPass,
      DragControls,
      TransformControls,
      FBXLoader,
      OBJLoader,
      MTLLoader,
      SVGLoader,
      RoundedBoxGeometry,
      ConvexGeometry,
      ParametricGeometry,
      // Legacy aliases — LLMs often generate old Three.js class names
      ParametricBufferGeometry: ParametricGeometry,
      ConvexBufferGeometry: ConvexGeometry,
    };
  }
  return { THREE: _THREE, THREE_ADDONS: _THREE_ADDONS, OrbitControls: _OrbitControls };
};

// Simple showdown converter like in response.js
const markdownConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  omitExtraWLInCodeBlocks: false,
  simpleLineBreaks: true,
  ghCodeBlocks: true,
  preserveIndent: true,
  extensions: [
    function () {
      return [
        {
          type: 'output',
          filter: function (text) {
            // Simple hash for deterministic IDs from content
            const hashCode = (s) => {
              let h = 0;
              for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
              }
              return Math.abs(h).toString(36);
            };

            // Convert ```chartjs code blocks into chart containers
            let blockIndex = 0;
            let result = text.replace(/<pre><code class="[^"]*language-chartjs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, config) => {
              const id = 'chart-' + hashCode(config) + '-' + blockIndex++;
              return `<div class="chartjs-container" data-chart-id="${id}"><canvas id="${id}"></canvas><code class="chartjs-config" style="display:none">${config}</code></div>`;
            });
            // Convert ```d3 code blocks into D3 containers
            result = result.replace(/<pre><code class="[^"]*language-d3[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
              const id = 'd3-' + hashCode(code) + '-' + blockIndex++;
              return `<div class="d3-container" data-d3-id="${id}"><code class="d3-code" style="display:none">${code}</code></div>`;
            });
            // Convert ```threejs code blocks into Three.js containers
            result = result.replace(/<pre><code class="[^"]*language-threejs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
              const id = 'three-' + hashCode(code) + '-' + blockIndex++;
              return `<div class="threejs-container" data-three-id="${id}"><code class="threejs-code" style="display:none">${code}</code></div>`;
            });
            return result;
          },
        },
      ];
    },
  ],
});

export default {
  name: 'MessageItem',
  components: {
    ProviderSetup,
    Tooltip,
    GoalProgressWidget,
  },
  directives: {
    'morph-html': vMorphHtml,
  },
  props: {
    message: {
      type: Object,
      required: true,
    },
    status: {
      type: Object,
      default: null,
    },
    runningTools: {
      type: Array,
      default: () => [],
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    showAvatar: {
      type: Boolean,
      default: true,
    },
    imageCache: {
      type: Map,
      default: () => new Map(),
    },
    dataCache: {
      type: Map,
      default: () => new Map(),
    },
    compact: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['toggle-tool', 'provider-connected', 'open-html-preview', 'edit-message'],
  setup(props, { emit }) {
    // Get Vuex store for auth token
    const store = useStore();

    // Build theme CSS tag by extracting all CSS custom properties from the live document.
    // Injected into iframes so HTML/D3/Three.js/Chart.js content can use var(--color-*) etc.
    const themeStyleTag = ref('');
    function buildThemeStyleTag() {
      const vars = [];
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.style) {
                for (let i = 0; i < rule.style.length; i++) {
                  const prop = rule.style[i];
                  if (prop.startsWith('--')) vars.push(prop);
                }
              }
            }
          } catch (_) {
            /* cross-origin */
          }
        }
      } catch (_) {}
      const unique = [...new Set(vars)];
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const lines = unique
        .map((prop) => {
          const val = bodyStyle.getPropertyValue(prop).trim() || rootStyle.getPropertyValue(prop).trim();
          return val ? `  ${prop}: ${val};` : null;
        })
        .filter(Boolean);
      themeStyleTag.value = `<style id="agnt-theme">:root{${lines.join('')}}</style>`;
    }
    watch(
      () => store.state.theme?.currentTheme,
      () => nextTick(() => requestAnimationFrame(buildThemeStyleTag)),
      { immediate: true },
    );

    const messageRef = ref(null);

    // Edit message state
    const isEditing = ref(false);
    const editText = ref('');
    const editTextarea = ref(null);

    const startEditing = () => {
      editText.value = props.message.content || '';
      isEditing.value = true;
      nextTick(() => {
        if (editTextarea.value) {
          editTextarea.value.focus();
          // Auto-resize
          editTextarea.value.style.height = 'auto';
          editTextarea.value.style.height = editTextarea.value.scrollHeight + 'px';
        }
      });
    };

    const cancelEditing = () => {
      isEditing.value = false;
      editText.value = '';
    };

    const submitEdit = () => {
      if (!editText.value.trim()) return;
      isEditing.value = false;
      emit('edit-message', { messageId: props.message.id, newContent: editText.value.trim() });
    };

    const handleEditKeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitEdit();
      } else if (e.key === 'Escape') {
        cancelEditing();
      }
    };

    const autoResizeEdit = () => {
      if (editTextarea.value) {
        editTextarea.value.style.height = 'auto';
        editTextarea.value.style.height = editTextarea.value.scrollHeight + 'px';
      }
    };

    const showPreviewModal = ref(false);
    const previewHTML = ref('');
    const previewIframe = ref(null);
    const chartInstances = ref([]);
    const renderedChartIds = new Set();
    const renderedD3Ids = new Set();
    const renderedThreeIds = new Set();
    const threeInstances = ref([]);

    // Visualization fullscreen modal state
    const showVizModal = ref(false);
    const vizModalTitle = ref('');
    const vizModalHTML = ref('');

    // Share to AGNT Creations state
    const showShareModal = ref(false);
    const isSharing = ref(false);
    const shareError = ref(null);
    const shareResult = ref(null);
    const shareTitle = ref('');
    const pendingShareHTML = ref('');
    const copiedLink = ref(false);
    const copiedEmbed = ref(false);
    const shareLinkInput = ref(null);
    const shareEmbedInput = ref(null);

    // AGNT Creations API URL
    const CREATIONS_API_URL = 'https://agnt.gg/api/previews';

    // Computed embed code
    const shareEmbedCode = computed(() => {
      if (shareResult.value && shareResult.value.id) {
        return `<iframe src="https://agnt.gg/creations/${shareResult.value.id}/embed" width="100%" height="500" frameborder="0"></iframe>`;
      }
      return '';
    });

    const assistantAvatar = computed(() => {
      if (props.avatarUrl) {
        return props.avatarUrl;
      }
      return defaultAvatar;
    });

    // Copy HTML code to clipboard
    const copyHTMLCode = (code) => {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          // Could add a toast notification here
          console.log('HTML copied to clipboard');
        })
        .catch((err) => {
          console.error('Failed to copy HTML:', err);
        });
    };

    // Inject theme CSS variables + scrollbar hide into an HTML string so iframes match the app theme
    const noScrollCSS =
      '<style>html,body{scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}</style>';
    const injectTheme = (html) => {
      const inject = (themeStyleTag.value || '') + noScrollCSS;
      if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
      }
      if (/<html[^>]*>/i.test(html)) {
        return html.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`);
      }
      return inject + html;
    };

    // Open preview modal with HTML in iframe
    const openPreviewModal = (html) => {
      // Store the raw HTML - srcdoc attribute will handle rendering
      previewHTML.value = injectTheme(html);
      showPreviewModal.value = true;

      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    };

    // Close preview modal
    const closePreviewModal = () => {
      showPreviewModal.value = false;
      previewHTML.value = '';
      // Restore body scroll
      document.body.style.overflow = '';
    };

    // Build a self-contained HTML document for fullscreen iframe rendering
    const buildVizHTML = (container, type) => {
      const sourceCode = container.getAttribute('data-source-code') || '';
      if (!sourceCode) return null;

      if (type === 'chartjs') {
        return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px}canvas{max-width:100%;max-height:100%}</style>
</head><body><canvas id="chart"></canvas><script>
try{const config=${sourceCode};
config.options=config.options||{};config.options.responsive=true;config.options.maintainAspectRatio=true;
config.options.plugins=config.options.plugins||{};config.options.plugins.legend=config.options.plugins.legend||{};
config.options.plugins.legend.labels=config.options.plugins.legend.labels||{};
config.options.plugins.legend.labels.color=config.options.plugins.legend.labels.color||'#e0e0e0';
const palette=['#e53d8f','#12e0ff','#19ef83','#ffd700','#7d3de5','#ff9500','#ff4444','#d13de5'];
const chartType=config.type||'bar';
if(['bar','line','scatter','bubble'].includes(chartType)){
config.options.scales=config.options.scales||{};
config.options.scales.x=config.options.scales.x||{};config.options.scales.x.ticks=config.options.scales.x.ticks||{};config.options.scales.x.ticks.color='#a0a0a0';
config.options.scales.x.grid=config.options.scales.x.grid||{};config.options.scales.x.grid.color='rgba(255,255,255,0.08)';
config.options.scales.y=config.options.scales.y||{};config.options.scales.y.ticks=config.options.scales.y.ticks||{};config.options.scales.y.ticks.color='#a0a0a0';
config.options.scales.y.grid=config.options.scales.y.grid||{};config.options.scales.y.grid.color='rgba(255,255,255,0.08)';
}
if(config.data&&config.data.datasets){config.data.datasets.forEach((ds,i)=>{const c=palette[i%palette.length];
if(['pie','doughnut','polarArea'].includes(chartType)){ds.backgroundColor=ds.backgroundColor||palette.slice(0,(config.data.labels||[]).length);ds.borderColor=ds.borderColor||'rgba(0,0,0,0.2)';}
else{ds.backgroundColor=ds.backgroundColor||c;ds.borderColor=ds.borderColor||c;}});}
new Chart(document.getElementById('chart'),config);
}catch(e){document.body.innerHTML='<div style="color:#ff4d4d;padding:40px;text-align:center"><strong>Chart Render Failed</strong><br>'+e.message+'</div>';}
<\/script></body></html>`;
      }

      if (type === 'd3') {
        return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/d3@7"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden}
#chart{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
text{fill:#e0e0e0}.axis text{fill:#a0a0a0;font-size:11px}.axis path,.axis line{stroke:#555}.grid line{stroke:rgba(255,255,255,0.08)}</style>
</head><body><div id="chart"></div><script>
try{const container=d3.select('#chart');${sourceCode.replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '').replace(/^\s*export\s+(?:default\s+)?/gm, '')}
// Scale SVG to fill viewport after render
setTimeout(()=>{const svg=document.querySelector('svg');if(svg){const w=parseFloat(svg.getAttribute('width'))||svg.getBoundingClientRect().width;const h=parseFloat(svg.getAttribute('height'))||svg.getBoundingClientRect().height;if(w&&h){svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.removeAttribute('width');svg.removeAttribute('height');svg.style.width='100%';svg.style.height='100%';svg.style.maxWidth='100vw';svg.style.maxHeight='100vh';}}},50);
}catch(e){document.body.innerHTML='<div style="color:#ff4d4d;padding:40px;text-align:center"><strong>D3 Render Failed</strong><br>'+e.message+'</div>';}
<\/script></body></html>`;
      }

      if (type === 'threejs') {
        return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;overflow:hidden}canvas{width:100%;height:100vh;display:block;cursor:grab}canvas:active{cursor:grabbing}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}<\/script>
</head><body><canvas id="c"></canvas>
<script type="module">
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {TextGeometry} from 'three/addons/geometries/TextGeometry.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {DragControls} from 'three/addons/controls/DragControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {ParametricGeometry} from 'three/addons/geometries/ParametricGeometry.js';
const THREE_ADDONS={OrbitControls,GLTFLoader,FontLoader,TextGeometry,EffectComposer,RenderPass,UnrealBloomPass,DragControls,TransformControls,FBXLoader,OBJLoader,MTLLoader,SVGLoader,RoundedBoxGeometry,ConvexGeometry,ParametricGeometry};
try{
const canvas=document.getElementById('c');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x1a1a2e);
const camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,0.1,1000);
camera.position.set(3,3,5);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setSize(window.innerWidth,window.innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=0.05;
scene.add(new THREE.AmbientLight(0x404040,2));
const dl=new THREE.DirectionalLight(0xffffff,1.5);dl.position.set(5,10,7);scene.add(dl);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
${sourceCode.replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '').replace(/^\s*export\s+(?:default\s+)?/gm, '')}
{const an=()=>{requestAnimationFrame(an);controls.update();renderer.render(scene,camera);};an();}
}catch(e){document.body.innerHTML='<div style="color:#ff4d4d;padding:40px;text-align:center"><strong>3D Render Failed</strong><br>'+e.message+'</div>';}
<\/script></body></html>`;
      }

      return null;
    };

    // Open visualization fullscreen - render in iframe just like HTML preview
    const openVizFullscreen = (container, type) => {
      const html = buildVizHTML(container, type);
      if (!html) return;
      vizModalTitle.value = type === 'chartjs' ? 'Chart.js' : type === 'd3' ? 'D3 Visualization' : '3D Scene';
      vizModalHTML.value = injectTheme(html);
      showVizModal.value = true;
      document.body.style.overflow = 'hidden';
    };

    // Close visualization fullscreen modal
    const closeVizModal = () => {
      showVizModal.value = false;
      vizModalTitle.value = '';
      vizModalHTML.value = '';
      document.body.style.overflow = '';
    };

    // Image detection and extraction functions
    const isDataURL = (str) => {
      return typeof str === 'string' && str.startsWith('data:image/');
    };

    const hasImages = (result) => {
      if (!result) return false;

      // Check for firstImage field (could be data URL or reference)
      if (result.firstImage) {
        if (isDataURL(result.firstImage)) return true;
        if (typeof result.firstImage === 'string' && result.firstImage.startsWith('{{IMAGE_REF:')) return true;
      }

      // Check for generatedImages array (could contain data URLs or references)
      if (result.generatedImages && Array.isArray(result.generatedImages)) {
        return result.generatedImages.some((img) => {
          if (isDataURL(img)) return true;
          if (typeof img === 'string' && img.startsWith('{{IMAGE_REF:')) return true;
          return false;
        });
      }

      return false;
    };

    const extractImages = (result) => {
      const images = [];

      if (!result) return images;

      // Only use generatedImages array (firstImage is just a convenience duplicate)
      if (result.generatedImages && Array.isArray(result.generatedImages)) {
        result.generatedImages.forEach((img) => {
          // Check if it's a reference that needs to be resolved from cache
          if (typeof img === 'string' && img.startsWith('{{IMAGE_REF:')) {
            const match = img.match(/{{IMAGE_REF:(.+?)}}/);
            if (match) {
              const imageId = match[1];
              const cached = props.imageCache.get(imageId);
              if (cached && cached.data) {
                images.push(cached.data);
                console.log(`Resolved image reference: ${imageId}`);
              } else {
                console.warn(`Image reference not found in cache: ${imageId}`);
              }
            }
          } else if (isDataURL(img)) {
            // Direct data URL (legacy or fallback)
            images.push(img);
          }
        });
      }

      return images;
    };

    // Image action functions
    const downloadImage = (dataUrl, filename = 'image.png') => {
      try {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Failed to download image:', error);
      }
    };

    const copyImageToClipboard = async (dataUrl) => {
      try {
        // Create an image element to load the data URL
        const img = new Image();
        img.src = dataUrl;

        // Wait for image to load
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        // Create a canvas to convert the image to PNG
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Convert canvas to blob (PNG format - the only format supported by clipboard)
        const blob = await new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/png');
        });

        // Copy to clipboard
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ]);

        console.log('Image copied to clipboard');
      } catch (error) {
        console.error('Failed to copy image to clipboard:', error);
        // Fallback: copy the data URL as text
        try {
          await navigator.clipboard.writeText(dataUrl);
          console.log('Image data URL copied to clipboard as text');
        } catch (fallbackError) {
          console.error('Failed to copy data URL:', fallbackError);
        }
      }
    };

    const openImageInNewTab = (dataUrl) => {
      try {
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Generated Image</title>
                <style>
                  body {
                    margin: 0;
                    padding: 20px;
                    background: #000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                  }
                  img {
                    max-width: 100%;
                    max-height: 100vh;
                    object-fit: contain;
                  }
                </style>
              </head>
              <body>
                <img src="${dataUrl}" alt="Generated Image" />
              </body>
            </html>
          `);
          newWindow.document.close();
        }
      } catch (error) {
        console.error('Failed to open image in new tab:', error);
      }
    };

    // Add HTML code action buttons to code blocks
    const addHTMLCodeButtons = () => {
      nextTick(() => {
        if (messageRef.value) {
          // Find all HTML code blocks that don't have buttons yet
          const htmlCodeBlocks = messageRef.value.querySelectorAll('pre code.language-html:not([data-buttons-added])');

          htmlCodeBlocks.forEach((codeBlock) => {
            const pre = codeBlock.parentElement;
            if (!pre) return;

            codeBlock.setAttribute('data-buttons-added', 'true');
            const htmlCode = codeBlock.textContent || '';

            // Create a wrapper that replaces the <pre> block
            const wrapper = document.createElement('div');
            wrapper.className = 'html-inline-preview-wrapper';

            // Scrollable container for the iframe (caps visible height at 800px)
            const iframeScroller = document.createElement('div');
            iframeScroller.className = 'html-inline-iframe-scroller';

            // Inline iframe showing rendered HTML (default view)
            const iframe = document.createElement('iframe');
            iframe.className = 'html-inline-iframe';
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            iframe.setAttribute('frameborder', '0');
            iframe.srcdoc = injectTheme(htmlCode);
            // Auto-size iframe to fit its content (no cap — scroller handles overflow)
            iframe.onload = () => {
              try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc?.body) {
                  // Temporarily override viewport-relative heights so we can measure true content size
                  const tmpStyle = doc.createElement('style');
                  tmpStyle.textContent = 'html,body{height:auto!important;min-height:0!important;overflow:visible!important}';
                  (doc.head || doc.documentElement).appendChild(tmpStyle);
                  const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
                  tmpStyle.remove();
                  if (h > 50) iframe.style.height = h + 2 + 'px';
                }
              } catch (e) {
                /* cross-origin — keep default height */
              }
            };
            iframeScroller.appendChild(iframe);

            // Hidden code block (toggled via Code button)
            const codePre = pre.cloneNode(true);
            codePre.style.display = 'none';
            codePre.classList.add('html-inline-code');

            // Button bar
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'html-code-actions';

            // Copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'html-action-btn copy-btn';
            copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
            copyBtn.onclick = (e) => {
              e.stopPropagation();
              copyHTMLCode(htmlCode);
              copyBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Copied!</span>';
              setTimeout(() => {
                copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
              }, 2000);
            };

            // Code toggle button
            const codeBtn = document.createElement('button');
            codeBtn.className = 'html-action-btn code-toggle-btn';
            codeBtn.innerHTML = '<span class="btn-icon">{ }</span><span class="btn-text">Code</span>';
            codeBtn.onclick = (e) => {
              e.stopPropagation();
              const showingCode = codePre.style.display !== 'none';
              codePre.style.display = showingCode ? 'none' : '';
              iframe.style.display = showingCode ? '' : 'none';
              codeBtn.innerHTML = showingCode
                ? '<span class="btn-icon">{ }</span><span class="btn-text">Code</span>'
                : '<span class="btn-icon">👁</span><span class="btn-text">Preview</span>';
            };

            // Fullscreen button
            const fsBtn = document.createElement('button');
            fsBtn.className = 'html-action-btn preview-btn';
            fsBtn.innerHTML = '<span class="btn-icon">⛶</span><span class="btn-text">Fullscreen</span>';
            fsBtn.onclick = (e) => {
              e.stopPropagation();
              openPreviewModal(htmlCode);
            };

            // Left group: Copy + Code
            const leftGroup = document.createElement('div');
            leftGroup.className = 'html-actions-group';
            leftGroup.appendChild(copyBtn);
            leftGroup.appendChild(codeBtn);

            // Share button — opens the share modal (same as fullscreen header)
            const shareBtn = document.createElement('button');
            shareBtn.className = 'html-action-btn share-btn';
            shareBtn.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">Share</span>';
            shareBtn.onclick = (e) => {
              e.stopPropagation();
              openShareModal(htmlCode);
            };

            // Right group: Share + Fullscreen
            const rightGroup = document.createElement('div');
            rightGroup.className = 'html-actions-group';
            rightGroup.appendChild(shareBtn);
            rightGroup.appendChild(fsBtn);

            buttonContainer.appendChild(leftGroup);
            buttonContainer.appendChild(rightGroup);

            wrapper.appendChild(buttonContainer);
            wrapper.appendChild(iframeScroller);
            wrapper.appendChild(codePre);

            pre.replaceWith(wrapper);
          });
        }
      });
    };

    // Add Copy/Fullscreen buttons to rendered Chart.js, D3, and Three.js containers
    const addVizActionButtons = () => {
      nextTick(() => {
        if (!messageRef.value) return;

        const vizContainers = messageRef.value.querySelectorAll(
          '.chartjs-container:not([data-viz-buttons]), .d3-container:not([data-viz-buttons]), .threejs-container:not([data-viz-buttons])',
        );

        vizContainers.forEach((container) => {
          container.setAttribute('data-viz-buttons', 'true');
          container.style.position = 'relative';

          // Determine type
          let type = 'chartjs';
          if (container.classList.contains('d3-container')) type = 'd3';
          else if (container.classList.contains('threejs-container')) type = 'threejs';

          // Source code is stored during render (data-source-code attribute)
          const sourceCode = container.getAttribute('data-source-code') || '';

          // Create button container
          const btnContainer = document.createElement('div');
          btnContainer.className = 'viz-action-buttons';

          // Copy button
          const copyBtn = document.createElement('button');
          copyBtn.className = 'html-action-btn copy-btn';
          copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
          copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(sourceCode).catch(console.error);
            copyBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Copied!</span>';
            setTimeout(() => {
              copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
            }, 2000);
          };

          // Fullscreen button
          const fsBtn = document.createElement('button');
          fsBtn.className = 'html-action-btn preview-btn';
          fsBtn.innerHTML = '<span class="btn-icon">⛶</span><span class="btn-text">Fullscreen</span>';
          fsBtn.onclick = (e) => {
            e.stopPropagation();
            openVizFullscreen(container, type);
          };

          btnContainer.appendChild(copyBtn);
          btnContainer.appendChild(fsBtn);
          container.appendChild(btnContainer);
        });
      });
    };

    // Add download/copy buttons to images in assistant messages
    const addImageActionButtons = () => {
      nextTick(() => {
        if (messageRef.value && props.message.role === 'assistant') {
          // Find all images in the message text that don't have buttons yet
          const images = messageRef.value.querySelectorAll('.message-text img:not([data-image-buttons-added])');

          images.forEach((img) => {
            // Skip if image doesn't have a valid src
            if (!img.src || !img.src.startsWith('data:image/')) return;

            // Mark as processed
            img.setAttribute('data-image-buttons-added', 'true');

            // Create wrapper if image isn't already in one
            let wrapper = img.parentElement;
            if (!wrapper.classList.contains('assistant-image-wrapper')) {
              wrapper = document.createElement('div');
              wrapper.className = 'assistant-image-wrapper';
              img.parentNode.insertBefore(wrapper, img);
              wrapper.appendChild(img);
            }

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'assistant-image-actions';

            // Create Download button
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'assistant-image-action-btn';
            downloadBtn.innerHTML = '<span class="btn-icon">📥</span><span class="btn-text">Download</span>';
            downloadBtn.onclick = (e) => {
              e.stopPropagation();
              const filename = img.alt ? `${img.alt.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png` : 'image.png';
              downloadImage(img.src, filename);
            };

            // Create Copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'assistant-image-action-btn';
            copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
            copyBtn.onclick = (e) => {
              e.stopPropagation();
              copyImageToClipboard(img.src);
              // Visual feedback
              copyBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Copied!</span>';
              setTimeout(() => {
                copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
              }, 2000);
            };

            // Add buttons to container
            buttonContainer.appendChild(downloadBtn);
            buttonContainer.appendChild(copyBtn);

            // Add container after the image
            wrapper.appendChild(buttonContainer);
          });
        }
      });
    };

    // Helper function to add target="_blank" to all links
    const addTargetBlankToLinks = (html) => {
      // Use DOMPurify hook to add target="_blank" and rel="noopener noreferrer" to all anchor tags
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        // Set all elements owning target to target=_blank
        if ('target' in node) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });

      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'div',
          'span',
          'p',
          'a',
          'img',
          'ul',
          'ol',
          'li',
          'strong',
          'em',
          'b',
          'i',
          'u',
          'code',
          'pre',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'blockquote',
          'table',
          'thead',
          'tbody',
          'tr',
          'td',
          'th',
          'caption',
          'br',
          'hr',
          'dl',
          'dt',
          'dd',
          'sup',
          'sub',
          'mark',
          'small',
          'iframe',
          'video',
          'audio',
          'source',
          'canvas',
          'svg',
          'path',
          'circle',
          'rect',
          'line',
          'polyline',
          'polygon',
          'button',
          'input',
          'form',
          'label',
          'select',
          'option',
          'textarea',
        ],
        ALLOWED_ATTR: [
          'href',
          'src',
          'alt',
          'class',
          'id',
          'style',
          'target',
          'rel',
          'title',
          'width',
          'height',
          'data-*',
          'aria-*',
          'role',
          'type',
          'value',
          'placeholder',
          'name',
          'disabled',
          'readonly',
          'checked',
          'controls',
          'autoplay',
          'loop',
          'muted',
          'poster',
          'viewBox',
          'xmlns',
          'd',
          'fill',
          'stroke',
          'stroke-width',
          'cx',
          'cy',
          'r',
          'x',
          'y',
          'x1',
          'y1',
          'x2',
          'y2',
          'points',
        ],
        ALLOW_DATA_ATTR: true,
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        ADD_ATTR: ['target'],
        FORCE_BODY: false,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        SANITIZE_DOM: true,
        KEEP_CONTENT: true,
      });

      // Remove the hook after sanitization to avoid affecting other uses
      DOMPurify.removeHook('afterSanitizeAttributes');

      return sanitized;
    };

    // Legacy alias for backward compatibility
    const sanitizeHTML = addTargetBlankToLinks;

    // --- Fenced code block extraction (handles nested fences) ---
    // Showdown can't handle nested fences (```markdown containing ```bash etc.)
    // We extract outermost blocks first, let showdown process the rest, then restore.
    // Uses a stack: ```lang pushes, bare ``` pops. When stack empties, outermost block is complete.
    const fencedBlockStore = [];

    const extractFencedBlocks = (text) => {
      fencedBlockStore.length = 0;
      const lines = text.split('\n');
      const result = [];
      const fenceStack = []; // stack of { char, len }
      let blockLines = [];
      let blockLang = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.trimStart();
        const fenceMatch = stripped.match(/^(`{3,}|~{3,})(.*)/);

        if (!fenceMatch) {
          if (fenceStack.length > 0) {
            blockLines.push(line);
          } else {
            result.push(line);
          }
          continue;
        }

        const char = fenceMatch[1][0];
        const len = fenceMatch[1].length;
        const info = fenceMatch[2].trim();

        // Closing fence: no info string, same char, >= same length as top of stack
        if (!info && fenceStack.length > 0) {
          const top = fenceStack[fenceStack.length - 1];
          if (top.char === char && len >= top.len) {
            fenceStack.pop();
            if (fenceStack.length === 0) {
              // Outermost fence closed — save the block
              fencedBlockStore.push({ content: blockLines.join('\n'), lang: blockLang });
              result.push(`<!--CBLK${fencedBlockStore.length - 1}-->`);
              blockLines = [];
              blockLang = '';
              continue;
            } else {
              // Inner fence closed — keep as block content
              blockLines.push(line);
              continue;
            }
          }
        }

        // Opening fence
        if (fenceStack.length === 0) {
          // Outermost opening
          blockLang = info.split(/\s/)[0] || '';
          blockLines = [];
        } else {
          // Inner opening — keep as block content
          blockLines.push(line);
        }
        fenceStack.push({ char, len });
      }

      // Unclosed outermost fence (streaming)
      if (fenceStack.length > 0 && blockLines.length > 0) {
        fencedBlockStore.push({ content: blockLines.join('\n'), lang: blockLang, unclosed: true });
        result.push(`<!--CBLK${fencedBlockStore.length - 1}-->`);
      }

      return result.join('\n');
    };

    const restoreFencedBlocks = (html) => {
      const hashCode = (s) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
          h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h).toString(36);
      };
      let vizIdx = 0;

      return html.replace(/(?:<p>\s*)?<!--CBLK(\d+)-->(?:\s*<\/p>)?/g, (_, idx) => {
        const block = fencedBlockStore[parseInt(idx)];
        if (!block) return '';

        const escaped = block.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Sanitize language name to prevent injection
        const safeLang = (block.lang || '').replace(/[^a-zA-Z0-9_+-]/g, '');

        // Unclosed blocks (still streaming) — show as code until closing fence arrives
        if (block.unclosed) {
          const langClass = safeLang ? ` class="${safeLang} language-${safeLang}"` : '';
          return `<pre><code${langClass}>${escaped}</code></pre>`;
        }

        // Handle special viz languages (morphdom preserves these during streaming)
        if (safeLang === 'chartjs') {
          const id = 'chart-' + hashCode(block.content) + '-' + vizIdx++;
          return `<div class="chartjs-container" data-chart-id="${id}"><canvas id="${id}"></canvas><code class="chartjs-config" style="display:none">${escaped}</code></div>`;
        }
        if (safeLang === 'd3') {
          const id = 'd3-' + hashCode(block.content) + '-' + vizIdx++;
          return `<div class="d3-container" data-d3-id="${id}"><code class="d3-code" style="display:none">${escaped}</code></div>`;
        }
        if (safeLang === 'threejs') {
          const id = 'three-' + hashCode(block.content) + '-' + vizIdx++;
          return `<div class="threejs-container" data-three-id="${id}"><code class="threejs-code" style="display:none">${escaped}</code></div>`;
        }

        const langClass = safeLang ? ` class="${safeLang} language-${safeLang}"` : '';
        return `<pre><code${langClass}>${escaped}</code></pre>`;
      });
    };

    // Protect math from showdown (which eats backslashes). HTML comments survive all contexts.
    // Code blocks are already extracted upstream, so only inline math needs protection here.
    const mathStore = [];
    const protectMath = (text) => {
      mathStore.length = 0;
      const save = (match) => {
        mathStore.push(match);
        return `<!--M${mathStore.length - 1}-->`;
      };
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, save);
      text = text.replace(/\\\[([\s\S]+?)\\\]/g, save);
      text = text.replace(/\\\([\s\S]+?\\\)/g, save);
      return text;
    };
    const restoreMath = (html) => {
      let mathIdx = 0;
      return html.replace(/<!--M(\d+)-->/g, (_, i) => {
        let m = (mathStore[parseInt(i)] || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        // Hash the content for a stable ID across re-renders
        let h = 0;
        for (let c = 0; c < m.length; c++) h = ((h << 5) - h + m.charCodeAt(c)) | 0;
        const id = 'math-' + Math.abs(h).toString(36) + '-' + mathIdx++;
        // Wrap in stable container — morphdom preserves these after MathJax typesets them
        if (m.startsWith('$$') && m.endsWith('$$')) {
          return `<div class="math-container" id="${id}">\\[${m.slice(2, -2)}\\]</div>`;
        } else if (m.startsWith('\\[') && m.endsWith('\\]')) {
          return `<div class="math-container" id="${id}">${m}</div>`;
        } else if (m.startsWith('\\(') && m.endsWith('\\)')) {
          return `<span class="math-container" id="${id}">${m}</span>`;
        }
        return m;
      });
    };

    // Wrapper to suppress showdown's noisy "maximum nesting of 10 spans" console.error
    // This warning fires during streaming when incomplete markdown creates recursive span patterns - harmless
    const safeMarkdownToHtml = (text) => {
      const origError = console.error;
      console.error = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('maximum nesting')) return;
        origError.apply(console, args);
      };
      try {
        // 1. Extract fenced code blocks (handles nested fences that showdown can't)
        const withoutBlocks = extractFencedBlocks(text);
        // 2. Protect math from showdown mangling
        const safe = protectMath(withoutBlocks);
        // 3. Convert markdown → HTML
        let html = restoreMath(markdownConverter.makeHtml(safe));
        // 4. Restore code blocks as proper <pre><code> (or viz containers)
        html = restoreFencedBlocks(html);
        return html;
      } catch (e) {
        // Showdown can stack-overflow on pathological content (deeply nested spans, etc.)
        console.warn('[MessageItem] Markdown rendering failed, falling back to escaped text:', e.message);
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      } finally {
        console.error = origError;
      }
    };

    // Detect if content is HTML
    const isHTMLContent = (content) => {
      if (!content || typeof content !== 'string') return false;

      // Check for common HTML patterns
      const htmlPatterns = [
        /<[a-z][\s\S]*>/i, // Any HTML tag
        /<!DOCTYPE/i, // DOCTYPE declaration
        /<html/i, // HTML tag
        /&[a-z]+;/i, // HTML entities
      ];

      return htmlPatterns.some((pattern) => pattern.test(content));
    };

    const renderChartJsDiagrams = () => {
      nextTick(async () => {
        if (!messageRef.value) return;

        const containers = messageRef.value.querySelectorAll('.chartjs-container');
        if (containers.length === 0) return;

        const Chart = await loadChartJs();

        containers.forEach((container) => {
          const chartId = container.getAttribute('data-chart-id');
          if (!chartId || renderedChartIds.has(chartId)) return;
          renderedChartIds.add(chartId);

          try {
            // Read config from the hidden code element and decode HTML entities
            const configEl = container.querySelector('.chartjs-config');
            if (!configEl) return;
            const textarea = document.createElement('textarea');
            textarea.innerHTML = configEl.textContent || '';
            const rawConfig = textarea.value;
            configEl.remove();

            // Store source code for copy/fullscreen buttons
            container.setAttribute('data-source-code', rawConfig);

            // Parse JSON config
            const config = JSON.parse(rawConfig);

            // Resolve theme colors from CSS variables
            const styles = getComputedStyle(document.body);
            const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
            const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#a0a0a0';
            const primaryRgb = styles.getPropertyValue('--primary-rgb').trim() || '25, 239, 131';
            const gridColor = `rgba(${primaryRgb}, 0.08)`;

            config.options = config.options || {};
            config.options.responsive = true;
            config.options.maintainAspectRatio = true;
            config.options.plugins = config.options.plugins || {};
            config.options.plugins.legend = config.options.plugins.legend || {};
            config.options.plugins.legend.labels = config.options.plugins.legend.labels || {};
            config.options.plugins.legend.labels.color = config.options.plugins.legend.labels.color || textColor;

            // Apply axis colors for cartesian charts
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

            // Apply default colors to datasets if not set
            const palette = ['#e53d8f', '#12e0ff', '#19ef83', '#ffd700', '#7d3de5', '#ff9500', '#ff4444', '#d13de5'];
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

            const ctx = canvas.getContext('2d');
            const instance = new Chart(ctx, config);
            chartInstances.value.push(instance);
          } catch (err) {
            console.warn('Chart.js rendering error:', err.message);
            container.innerHTML = `<div style="padding: 16px; background: rgba(255,77,77,0.08); border: 1px solid rgba(255,77,77,0.3); border-radius: 8px; color: var(--color-red, #ff4d4d); font-size: 13px;">
              <strong>Chart Render Failed</strong><br><span style="opacity:0.8">${err.message}</span>
            </div>`;
          }
        });
      });
    };

    const renderD3Diagrams = () => {
      nextTick(async () => {
        if (!messageRef.value) return;

        const containers = messageRef.value.querySelectorAll('.d3-container');
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

              // Decode HTML entities
              const textarea = document.createElement('textarea');
              textarea.innerHTML = codeEl.textContent || '';
              const d3Code = textarea.value;
              codeEl.remove();

              // Store source code for copy/fullscreen buttons
              container.setAttribute('data-source-code', d3Code);

              // Create a chart div inside the container
              const chartDiv = document.createElement('div');
              chartDiv.classList.add('d3-chart');
              container.appendChild(chartDiv);

              // Execute D3 code with the bundled d3 module
              // The LLM code expects `container` as a d3 selection and `d3` as the d3 module
              // Strip import/export statements - d3 is already injected as a parameter
              const cleanedD3Code = d3Code.replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '').replace(/^\s*export\s+(?:default\s+)?/gm, '');
              const containerSelection = d3.select(chartDiv);
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
              const fn = new AsyncFunction('d3', 'container', cleanedD3Code);
              await fn(d3, containerSelection);
            } catch (err) {
              console.warn('D3 rendering error:', err.message);
              container.innerHTML = `<div style="padding: 16px; background: rgba(255,77,77,0.08); border: 1px solid rgba(255,77,77,0.3); border-radius: 8px; color: var(--color-red, #ff4d4d); font-size: 13px;">
                <strong>D3 Render Failed</strong><br><span style="opacity:0.8">${err.message}</span>
              </div>`;
            }
          })();
        });
      });
    };

    const renderThreeJsDiagrams = () => {
      nextTick(async () => {
        if (!messageRef.value) return;

        const containers = messageRef.value.querySelectorAll('.threejs-container');
        if (containers.length === 0) return;

        const { THREE, THREE_ADDONS, OrbitControls } = await loadThreeJs();

        containers.forEach((container) => {
          const threeId = container.getAttribute('data-three-id');
          if (!threeId || renderedThreeIds.has(threeId)) return;
          renderedThreeIds.add(threeId);

          // Use an async IIFE so LLM-generated code can use await
          (async () => {
            try {
              const codeEl = container.querySelector('.threejs-code');
              if (!codeEl) return;

              const textarea = document.createElement('textarea');
              textarea.innerHTML = codeEl.textContent || '';
              const threeCode = textarea.value;
              codeEl.remove();

              // Store source code for copy/fullscreen buttons
              container.setAttribute('data-source-code', threeCode);

              // Create canvas for Three.js
              const canvas = document.createElement('canvas');
              canvas.classList.add('threejs-canvas');
              canvas.width = 600;
              canvas.height = 400;
              container.appendChild(canvas);

              // Set up scene, camera, renderer
              const scene = new THREE.Scene();
              scene.background = new THREE.Color(0x1a1a2e);

              const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000);
              camera.position.set(3, 3, 5);
              camera.lookAt(0, 0, 0);

              const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
              renderer.setSize(canvas.width, canvas.height);
              renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

              // Add orbit controls
              const controls = new OrbitControls(camera, canvas);
              controls.enableDamping = true;
              controls.dampingFactor = 0.05;

              // Add default lighting
              const ambientLight = new THREE.AmbientLight(0x404040, 2);
              scene.add(ambientLight);
              const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
              directionalLight.position.set(5, 10, 7);
              scene.add(directionalLight);

              // Safe atob wrapper that sanitizes malformed base64 from LLM output
              const safeAtob = (str) => {
                let cleaned = str.replace(/[^A-Za-z0-9+/=]/g, '');
                while (cleaned.length % 4 !== 0) cleaned += '=';
                return atob(cleaned);
              };

              // Guard against LLM generating absurdly large typed arrays (e.g. 2 billion vertices)
              const MAX_ARRAY_LENGTH = 10_000_000; // 10M elements max
              const guardedTHREE = new Proxy(THREE, {
                get(target, prop) {
                  // Fall back to addons for classes removed from core (e.g. ParametricGeometry)
                  const val = target[prop] ?? THREE_ADDONS[prop];
                  // Wrap BufferAttribute constructors to cap array sizes
                  if (
                    prop === 'BufferAttribute' ||
                    prop === 'Float32BufferAttribute' ||
                    prop === 'Uint16BufferAttribute' ||
                    prop === 'Uint32BufferAttribute' ||
                    prop === 'Int8BufferAttribute' ||
                    prop === 'Int16BufferAttribute' ||
                    prop === 'Int32BufferAttribute' ||
                    prop === 'Float64BufferAttribute' ||
                    prop === 'Uint8BufferAttribute' ||
                    prop === 'Uint8ClampedBufferAttribute'
                  ) {
                    return new Proxy(val, {
                      construct(Target, args) {
                        const arr = args[0];
                        if (arr && arr.length > MAX_ARRAY_LENGTH) {
                          throw new Error(`Buffer too large (${arr.length.toLocaleString()} elements, max ${MAX_ARRAY_LENGTH.toLocaleString()})`);
                        }
                        return new Target(...args);
                      },
                    });
                  }
                  return val;
                },
              });

              // Strip static import/export statements - THREE is already injected
              // Replace dynamic import() calls with local addon lookups
              const cleanedCode = threeCode
                .replace(/^\s*import\s+.*?from\s+['"][^'"]*['"];?\s*$/gm, '')
                .replace(/^\s*export\s+(?:default\s+)?/gm, '')
                .replace(/await\s+import\s*\(\s*['"][^'"]*['"]\s*\)/g, 'THREE_ADDONS')
                .replace(/import\s*\(\s*['"][^'"]*['"]\s*\)/g, 'Promise.resolve(THREE_ADDONS)');

              // Destructured names from imports (e.g. `const { GLTFLoader } = await import(...)`)
              // will now resolve from THREE_ADDONS which contains all pre-bundled addons

              // Execute user code with guarded THREE, addons, scene, camera, renderer, controls
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
              const fn = new AsyncFunction('THREE', 'THREE_ADDONS', 'scene', 'camera', 'renderer', 'controls', 'canvas', 'atob', cleanedCode);
              await fn(guardedTHREE, THREE_ADDONS, scene, camera, renderer, controls, canvas, safeAtob);

              // Animation loop
              let animationId;
              const animate = () => {
                animationId = requestAnimationFrame(animate);
                controls.update();
                renderer.render(scene, camera);
              };
              animate();

              // Store for cleanup
              threeInstances.value.push({ renderer, animationId, controls });
            } catch (err) {
              console.warn('Three.js rendering error:', err.message);
              container.innerHTML = `<div style="padding: 16px; background: rgba(255,77,77,0.08); border: 1px solid rgba(255,77,77,0.3); border-radius: 8px; color: var(--color-red, #ff4d4d); font-size: 13px;">
                <strong>3D Render Failed</strong><br><span style="opacity:0.8">${err.message}</span>
              </div>`;
            }
          })();
        });
      });
    };

    // Typeset individual math containers — same pattern as charts.
    // Each .math-container has a stable ID so morphdom preserves it after typesetting.
    const renderMathElements = () => {
      nextTick(() => {
        if (!messageRef.value || typeof MathJax === 'undefined' || !MathJax.typesetPromise) return;
        const containers = messageRef.value.querySelectorAll('.math-container:not([data-math-rendered])');
        if (containers.length === 0) return;
        const els = Array.from(containers);
        els.forEach((el) => el.setAttribute('data-math-rendered', 'true'));
        MathJax.typesetPromise(els).catch((err) => {
          console.error('MathJax rendering error:', err);
        });
      });
    };

    const destroyChartInstances = () => {
      chartInstances.value.forEach((instance) => {
        try {
          instance.destroy();
        } catch (e) {
          // ignore
        }
      });
      chartInstances.value = [];

      // Clean up Three.js instances
      threeInstances.value.forEach(({ renderer, animationId, controls }) => {
        try {
          cancelAnimationFrame(animationId);
          controls.dispose();
          renderer.dispose();
        } catch (e) {
          // ignore
        }
      });
      threeInstances.value = [];
      renderedChartIds.clear();
      renderedD3Ids.clear();
      renderedThreeIds.clear();
    };

    const highlightCode = () => {
      nextTick(async () => {
        if (messageRef.value) {
          // Highlight all code blocks, including those with v-html
          const codeBlocks = messageRef.value.querySelectorAll('pre code:not(.hljs)');
          if (codeBlocks.length > 0) {
            const hljs = await loadHljs();
            codeBlocks.forEach((block) => {
              hljs.highlightElement(block);
            });
          }

          // morphdom preserves rendered viz/math elements — safe to render during streaming
          renderChartJsDiagrams();
          renderD3Diagrams();
          renderThreeJsDiagrams();
          renderMathElements();

          // Imperative DOM manipulation (replaceWith, appendChild) conflicts with
          // morphdom during streaming — render once when message is complete.
          if (!props.status) {
            addVizActionButtons();
            addHTMLCodeButtons();
            addImageActionButtons();
          }
        }
      });
    };

    // Debounce heavy rendering (charts, D3, hljs) during streaming
    let highlightTimer = null;
    const debouncedHighlightCode = () => {
      if (highlightTimer) clearTimeout(highlightTimer);
      // Fast debounce during streaming, immediate when done
      const delay = props.status ? 300 : 0;
      highlightTimer = setTimeout(highlightCode, delay);
    };

    onMounted(highlightCode);
    onUpdated(debouncedHighlightCode);
    onBeforeUnmount(() => {
      if (highlightTimer) clearTimeout(highlightTimer);
      if (renderTimer) clearTimeout(renderTimer);
      destroyChartInstances();
    });

    // Core render function - extracted from computed for throttling
    // Render a single text segment through the markdown/HTML pipeline
    const renderTextSegment = (text) => {
      if (!text || typeof text !== 'string') return '';
      if (text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';

      // USER MESSAGES: Display as plain text, only use code block if it looks like code
      if (props.message.role === 'user') {
        const looksLikeCode =
          text.includes('<!DOCTYPE') ||
          text.includes('<html') ||
          text.includes('<script') ||
          text.includes('<style') ||
          (text.includes('<') && text.includes('>') && text.split('\n').length > 3) ||
          (text.includes('function') && text.includes('{') && text.includes('}')) ||
          (text.includes('const') && text.includes('=') && text.split('\n').length > 2) ||
          (text.includes('import') && text.includes('from')) ||
          text.match(/^```/m);

        const escapedContent = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

        let userHtml;
        if (looksLikeCode) {
          userHtml = `<pre><code>${escapedContent}</code></pre>`;
        } else {
          userHtml = escapedContent.replace(/\n/g, '<br>');
        }

        // Style @mentions as pills in user messages
        const agentNames = (store.state.agents.agents || []).map((a) => a.name).filter(Boolean);
        for (const name of agentNames) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          userHtml = userHtml.replace(new RegExp(`@${escaped}(?=[\\s.,!?;:&<]|$)`, 'g'), `<span class="mention-pill">@${name}</span>`);
        }
        return userHtml;
      }

      // ASSISTANT MESSAGES: Process as markdown/HTML
      if (props.message.contentType === 'html') {
        return sanitizeHTML(text);
      }

      let content = text;

      // Handle incomplete code blocks (odd number of ``` fences)
      const openingFences = (content.match(/```/g) || []).length;

      if (openingFences % 2 !== 0) {
        if (props.status) {
          const lastFenceIndex = content.lastIndexOf('```');
          const completedContent = content.substring(0, lastFenceIndex);
          const incompleteBlock = content.substring(lastFenceIndex);

          let renderedCompleted = '';
          if (completedContent.trim()) {
            let processedCompleted = completedContent.replace(/([.!?:])([A-Z])/g, '$1 $2').replace(/([.!?:])(\n)([A-Z])/g, '$1$2$3');
            renderedCompleted = safeMarkdownToHtml(processedCompleted);
            renderedCompleted = addTargetBlankToLinks(renderedCompleted);
          }
          return renderedCompleted + '<pre><code>' + incompleteBlock.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>';
        } else {
          content += '\n```';
        }
      }

      let processedContent = content.replace(/([.!?:])([A-Z])/g, '$1 $2').replace(/([.!?:])(\n)([A-Z])/g, '$1$2$3');
      let renderedHtml = safeMarkdownToHtml(processedContent);

      // Resolve image references AFTER markdown conversion
      const imageRefPattern = /\{\{IMAGE_REF:([^}]+)\}\}/g;
      renderedHtml = renderedHtml.replace(imageRefPattern, (match, imageId) => {
        const cached = props.imageCache.get(imageId);
        if (cached && cached.data) {
          return cached.data;
        }
        return '';
      });

      // Wrap tables in a scrollable container
      renderedHtml = renderedHtml.replace(/<table\b/g, '<div class="table-wrapper"><table').replace(/<\/table>/g, '</table></div>');

      // Style @mentions as pills — match known agent names to avoid false positives in code
      const agentNames = (store.state.agents.agents || []).map((a) => a.name).filter(Boolean);
      for (const name of agentNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        renderedHtml = renderedHtml.replace(new RegExp(`@${escaped}(?=[\\s.,!?;:&<]|$)`, 'g'), `<span class="mention-pill">@${name}</span>`);
      }

      return addTargetBlankToLinks(renderedHtml);
    };

    // Build display parts from contentParts (with fallback for old messages)
    const getDisplayParts = () => {
      const parts = props.message.contentParts;
      if (parts && parts.length > 0) {
        return parts;
      }
      // Fallback for old messages without contentParts
      const result = [];
      if (props.message.content) {
        result.push({ type: 'text', text: props.message.content });
      }
      if (props.message.toolCalls && props.message.toolCalls.length > 0) {
        for (const tc of props.message.toolCalls) {
          result.push({ type: 'tool_call', toolCallId: tc.id });
        }
      }
      return result;
    };

    // Build rendered parts array, grouping consecutive tool calls
    const buildRenderedParts = () => {
      const displayParts = getDisplayParts();
      const grouped = [];
      for (const part of displayParts) {
        if (part.type === 'tool_call') {
          const tc = props.message.toolCalls?.find((t) => t.id === part.toolCallId);
          if (!tc) continue;
          const tcIndex = props.message.toolCalls.indexOf(tc);
          const last = grouped[grouped.length - 1];
          if (last && last.type === 'tool_calls') {
            last.items.push({ toolCall: tc, index: tcIndex });
          } else {
            grouped.push({ type: 'tool_calls', items: [{ toolCall: tc, index: tcIndex }] });
          }
        } else if (part.type === 'text') {
          const html = renderTextSegment(part.text);
          if (html) {
            grouped.push({ type: 'text', html });
          }
        }
      }
      return grouped;
    };

    // Throttled rendering: during streaming, cap markdown re-renders to ~15fps
    const renderedParts = ref([]);
    let renderTimer = null;
    let lastRenderTime = 0;
    const RENDER_INTERVAL = 66; // ~15fps during streaming

    watch(
      () => [props.message.content, props.message.contentParts?.length, props.message.toolCalls?.length, props.status, props.imageCache],
      () => {
        if (!props.status) {
          // Not streaming - render immediately
          if (renderTimer) {
            clearTimeout(renderTimer);
            renderTimer = null;
          }
          // morphdom preserves chart/viz instances — no need to destroy before re-render
          renderedParts.value = buildRenderedParts();
          lastRenderTime = Date.now();
        } else {
          // Streaming - throttle renders
          const now = Date.now();
          const elapsed = now - lastRenderTime;

          if (elapsed >= RENDER_INTERVAL) {
            renderedParts.value = buildRenderedParts();
            lastRenderTime = now;
            if (renderTimer) {
              clearTimeout(renderTimer);
              renderTimer = null;
            }
          } else if (!renderTimer) {
            renderTimer = setTimeout(() => {
              renderedParts.value = buildRenderedParts();
              lastRenderTime = Date.now();
              renderTimer = null;
            }, RENDER_INTERVAL - elapsed);
          }
        }
      },
      { immediate: true, deep: false },
    );

    const formatJSON = (obj) => {
      try {
        // Resolve DATA_REF references before displaying
        const resolveDataRefs = (data) => {
          if (typeof data === 'string') {
            // Check for DATA_REF pattern
            const dataRefMatch = data.match(/^\{\{DATA_REF:(.+?)\}\}$/);
            if (dataRefMatch) {
              const dataId = dataRefMatch[1];
              // Try to resolve from cache
              const cached = props.dataCache.get(dataId);
              if (cached && cached.data !== undefined) {
                console.log(`[MessageItem] Resolved DATA_REF: ${dataId}`);
                return cached.data; // Return the actual data
              }
              // Fallback: show placeholder if not in cache
              console.warn(`[MessageItem] DATA_REF not found in cache: ${dataId}`);
              return `[Large data - ${dataId}]`;
            }
            return data;
          } else if (Array.isArray(data)) {
            return data.map((item) => resolveDataRefs(item));
          } else if (data !== null && typeof data === 'object') {
            const resolved = {};
            for (const [key, value] of Object.entries(data)) {
              resolved[key] = resolveDataRefs(value);
            }
            return resolved;
          }
          return data;
        };

        const resolvedObj = resolveDataRefs(obj);

        // Just stringify the JSON with proper indentation
        // The CSS white-space: pre-wrap will handle the formatting
        return JSON.stringify(resolvedObj, null, 2);
      } catch (e) {
        return String(obj);
      }
    };

    const formatTime = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };

    const isExpanded = (index) => {
      return props.message.expandedToolCalls?.includes(index) || false;
    };

    const isRunning = (toolCallId) => {
      return props.runningTools.includes(toolCallId);
    };

    // Helper functions for GoalProgressWidget detection
    const _parseToolResult = (toolCall) => {
      if (!toolCall.result) return null;
      try {
        const result = typeof toolCall.result === 'string' ? JSON.parse(toolCall.result) : toolCall.result;
        // Handle agnt_goals meta-tool: result is nested under .data
        if (toolCall.name === 'agnt_goals' && result.data) {
          return typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
        }
        return result;
      } catch {
        return null;
      }
    };

    const isAutonomousGoalTool = (toolCall) => {
      // Direct tool names
      const directMatch = toolCall.name === 'create_and_run_goal' || toolCall.name === 'execute_goal_autonomous';
      // agnt_goals meta-tool with autonomous operations
      const metaMatch =
        toolCall.name === 'agnt_goals' &&
        toolCall.args &&
        (toolCall.args.operation === 'create_and_run_goal' || toolCall.args.operation === 'execute_goal_autonomous');

      if (!directMatch && !metaMatch) return false;

      const result = _parseToolResult(toolCall);
      if (!result) return false;
      return result.success && (result.autonomous || result.goal?.id || result.goal_id);
    };

    const extractGoalId = (toolCall) => {
      const result = _parseToolResult(toolCall);
      return result?.goal?.id || result?.goal_id || '';
    };

    const extractGoalTitle = (toolCall) => {
      const result = _parseToolResult(toolCall);
      return result?.goal?.title || 'Autonomous Goal';
    };

    const extractTaskCount = (toolCall) => {
      const result = _parseToolResult(toolCall);
      return result?.goal?.task_count || 0;
    };

    const extractMaxIterations = (toolCall) => {
      const result = _parseToolResult(toolCall);
      return result?.goal?.max_iterations || 20;
    };

    const isAsyncToolRunning = (toolCall) => {
      if (!toolCall.result) return false;

      try {
        const result = typeof toolCall.result === 'string' ? JSON.parse(toolCall.result) : toolCall.result;

        return Boolean(result.executionId) && (result.status === 'queued' || result.status === 'running');
      } catch {
        return false;
      }
    };

    const stopAsyncTool = async (toolCall) => {
      try {
        const result = typeof toolCall.result === 'string' ? JSON.parse(toolCall.result) : toolCall.result;

        const executionId = result.executionId;
        if (!executionId) return;

        const response = await fetch(`${API_CONFIG.BASE_URL}/async-tools/cancel/${executionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[MessageItem] Failed to cancel async tool:', errorText);
          return;
        }

        const data = await response.json();

        if (data.success) {
          toolCall.result = JSON.stringify({
            ...result,
            status: 'cancelled',
            message: 'Execution cancelled by user',
          });
        }
      } catch (error) {
        console.error('Error stopping async tool:', error);
      }
    };

    const toggleToolCall = (index) => {
      emit('toggle-tool', props.message.id, index);
    };

    const handleProviderConnected = (provider) => {
      console.log('Provider connected:', provider);
      // Emit event to parent to refresh the chat interface
      emit('provider-connected', provider);
    };

    // File preview helper functions
    const getFilePreviewUrl = (file) => {
      if (!file) return '';

      // If file has a data URL (for images), use it
      if (file.dataUrl) {
        return file.dataUrl;
      }

      // For uploaded files, create a blob URL if we have the file object
      if (file.file && file.file instanceof File) {
        return URL.createObjectURL(file.file);
      }

      // Fallback: return empty string
      return '';
    };

    const formatFileSize = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';

      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));

      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    // ============================================
    // SHARE TO AGNT CREATIONS FUNCTIONS
    // ============================================

    // Open share modal with HTML content
    const openShareModal = (html) => {
      pendingShareHTML.value = html;
      shareTitle.value = 'My Creation';
      shareError.value = null;
      shareResult.value = null;
      copiedLink.value = false;
      copiedEmbed.value = false;
      showShareModal.value = true;
    };

    // Close share modal
    const closeShareModal = () => {
      showShareModal.value = false;
      pendingShareHTML.value = '';
      shareTitle.value = '';
      shareError.value = null;
      shareResult.value = null;
      isSharing.value = false;
    };

    // Submit share to AGNT Creations API
    const submitShare = async () => {
      if (!pendingShareHTML.value || !shareTitle.value.trim()) return;

      isSharing.value = true;
      shareError.value = null;

      try {
        // Build headers with auth token if available
        const headers = {
          'Content-Type': 'application/json',
        };

        // Get auth token from Vuex store
        const token = store.state.userAuth?.token;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          console.log('[Share] Including auth token for user ownership');
        }

        const response = await fetch(CREATIONS_API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            html: pendingShareHTML.value,
            title: shareTitle.value.trim(),
            source: 'desktop-app',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to share (${response.status})`);
        }

        const result = await response.json();
        shareResult.value = result;
        console.log('[Share] Successfully shared to AGNT Creations:', result);
      } catch (error) {
        console.error('[Share] Error sharing to AGNT Creations:', error);
        shareError.value = error.message || 'Failed to share. Please try again.';
      } finally {
        isSharing.value = false;
      }
    };

    // Retry share after error
    const retryShare = () => {
      shareError.value = null;
      submitShare();
    };

    // Copy share link to clipboard
    const copyShareLink = async () => {
      if (!shareResult.value?.url) return;
      try {
        await navigator.clipboard.writeText(shareResult.value.url);
        copiedLink.value = true;
        setTimeout(() => {
          copiedLink.value = false;
        }, 2000);
      } catch (error) {
        console.error('[Share] Failed to copy link:', error);
      }
    };

    // Copy embed code to clipboard
    const copyEmbedCode = async () => {
      if (!shareEmbedCode.value) return;
      try {
        await navigator.clipboard.writeText(shareEmbedCode.value);
        copiedEmbed.value = true;
        setTimeout(() => {
          copiedEmbed.value = false;
        }, 2000);
      } catch (error) {
        console.error('[Share] Failed to copy embed code:', error);
      }
    };

    // Open URL in browser
    const openInBrowser = (url) => {
      if (!url) return;
      window.open(url, '_blank');
    };

    return {
      messageRef,
      renderedParts,
      // Edit message
      isEditing,
      editText,
      editTextarea,
      startEditing,
      cancelEditing,
      submitEdit,
      handleEditKeydown,
      autoResizeEdit,
      formatJSON,
      formatTime,
      isExpanded,
      isRunning,
      isAutonomousGoalTool,
      extractGoalId,
      extractGoalTitle,
      extractTaskCount,
      extractMaxIterations,
      isAsyncToolRunning,
      stopAsyncTool,
      toggleToolCall,
      assistantAvatar,
      showPreviewModal,
      previewHTML,
      previewIframe,
      closePreviewModal,
      showVizModal,
      vizModalTitle,
      vizModalHTML,
      closeVizModal,
      handleProviderConnected,
      hasImages,
      extractImages,
      downloadImage,
      copyImageToClipboard,
      openImageInNewTab,
      getFilePreviewUrl,
      formatFileSize,
      // Share to AGNT Creations
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
.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  margin-top: 4px;
  align-self: flex-start;
  border: 3px solid var(--color-green);
  padding: 2px;
}

.message-wrapper {
  display: flex;
  gap: 16px;
  min-width: 0;
  animation: message-appear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes message-appear {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.message-wrapper.system {
  margin-left: 52px;
}

.message-wrapper.system .message-card {
  border-radius: 16px 16px 16px 0;
}

.message-wrapper.user {
  justify-content: flex-end;
  max-width: 784px;
  align-self: flex-end;
}

.message-wrapper.assistant {
  justify-content: flex-start;
  align-items: flex-start;
}

.message-wrapper.user .message-card {
  border-radius: 16px 16px 0 16px;
}

.message-wrapper.assistant .message-card {
  border-radius: 16px 16px 16px 0;
}

.message-content {
  min-width: 0;
  overflow: hidden;
  flex: 1;
}

.message-card {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  padding: 20px 24px;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.message-wrapper.assistant .message-card {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  /* border-left: 3px solid var(--color-primary); */
}

.message-wrapper.user .message-card {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  /* border-right: 3px solid var(--color-blue); */
  margin-left: auto;
}

.message-text {
  font-size: var(--font-size-sm);
  line-height: 1.35;
  color: var(--color-bright-light-navy);
  margin: 0;
  overflow-wrap: anywhere;
  width: 100%;
  min-width: 0;
}

.message-text :deep(img) {
  width: 100% !important;
  max-width: 100% !important;
}

.message-text :deep(iframe) {
  width: 100%;
  min-height: 388px;
  margin-bottom: 16px;
  border-radius: 8px;
}

.message-text :deep(iframe.html-inline-iframe) {
  max-height: 800px;
}

.message-text :deep(p) {
  margin-top: 1em;
  margin-bottom: 1em;
}
.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text :deep(.mention-pill) {
  display: inline-block;
  background-color: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  padding: 2px 8px 1px;
  border-radius: 16px;
  font-size: 0.85em;
  font-weight: 600;
  white-space: nowrap;
  vertical-align: baseline;
  line-height: 1.5;
}

.message-text :deep(pre) {
  background-color: var(--color-darker-1);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid var(--terminal-border-color);
  margin-top: 0;
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-word;
  width: calc(100% - 34px);
  /* text-align: center; */
}

.message-text :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.message-text :deep(pre code) {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  font-size: 0.9em;
}

/* Hide code blocks until they're highlighted to prevent janky rendering during streaming */
/* .message-text :deep(pre code:not(.hljs)) {
  opacity: 0;
  transition: opacity 0.2s ease;
} */

.message-text :deep(pre code.hljs) {
  opacity: 1;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5),
.message-text :deep(h6) {
  color: var(--color-text);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1em;
  margin-bottom: 0.75em;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin-top: 0.5em;
  margin-bottom: 1em;
  padding-left: 2em;
}

.message-text :deep(li) {
  margin-bottom: 0.5em;
  line-height: 1.6;
}

.message-text :deep(blockquote) {
  margin: 1em 0;
  padding: 0.8em 1.5em;
  border-left: 4px solid var(--color-blue);
  background-color: rgba(18, 224, 255, 0.03);
  color: var(--color-light-med-navy);
  border-radius: 0 4px 4px 0;
}

.message-text :deep(code:not(pre code)) {
  background-color: rgba(127, 129, 147, 0.15);
  padding: 0 2px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: bold;
  color: var(--color-primary);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.message-text :deep(table) {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  border: 1px solid rgba(127, 129, 147, 0.15);
  border-radius: 6px;
}

.message-text :deep(.table-wrapper) {
  overflow-x: auto;
  margin: 1.5em 0;
  border-radius: 6px;
}

.message-text :deep(th),
.message-text :deep(td) {
  border: 1px solid rgba(127, 129, 147, 0.15);
  padding: 0.75em 1em;
  text-align: left;
}

.message-text :deep(th) {
  background-color: rgba(127, 129, 147, 0.08);
  font-weight: 600;
  color: var(--color-light-med-navy);
}

.message-text :deep(a) {
  transition: color 0.2s ease;
}

.message-text :deep(a:hover) {
  text-decoration-thickness: 2px;
}

.message-text :deep(strong),
.message-text :deep(b) {
  font-weight: 600;
  /* color: var(--color-primary); */
}

.message-wrapper.user .message-text :deep(strong),
.message-wrapper.user .message-text :deep(b) {
  color: var(--color-text);
}

.message-text :deep(em),
.message-text :deep(i) {
  font-style: italic;
}

.message-wrapper.user .message-text {
  color: var(--color-text);
}

.message-text *:first-child {
  margin-top: 0;
}

.message-metadata {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

span.nodeLabel p {
  font-size: var(--font-size-sm) !important;
}

.metadata-tag {
  font-size: 0.7em;
  padding: 4px 12px;
  background: rgba(127, 129, 147, 0.1);
  border-radius: 12px;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.message-time {
  font-size: 0.7em;
  color: var(--color-duller-navy);
  margin-top: 8px;
  display: block;
  padding: 0 4px;
}

.file-info {
  color: var(--color-text-muted);
  display: none;
}

.file-size {
  margin-left: 8px;
}

.tool-execution-details {
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  width: 100%;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px 2px 4px;
  border-radius: 8px;
  transition: background-color 0.2s ease;
}

.tool-header:hover {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(127, 129, 147, 0.1);
}

.tool-expansion-icon {
  font-size: 0.9em;
  color: var(--color-med-navy);
  width: 1em;
  text-align: center;
}

.tool-icon {
  font-size: 1.1em;
}

.tool-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  overflow-wrap: anywhere;
}

.tool-call-item {
  display: flex;
  background: #0000001a;
  border-radius: 8px;
  border: 1px solid rgba(127, 129, 147, 0.1);
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

.top-tool-bar {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  align-items: center;
}

.tool-call-item:last-child {
  margin-bottom: 0;
}

.tool-call-content {
  padding: 0 12px 12px 12px;
}

.tool-params,
.tool-result,
.tool-error {
  margin-top: 12px;
}

.params-label,
.result-label,
.error-label {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-duller-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.params-content,
.result-content,
.error-content {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  line-height: 1.5;
  padding: 2em;
  background-color: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  border: none;
}

.uploaded-image-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.uploaded-image-preview img,
.assistant-image-wrapper img {
  /* border-radius: 16px; */
  width: 100%;
  max-width: 100%;
  height: auto;
}

/* Reference Image Action Buttons */
.ref-image-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
  flex-wrap: wrap;
  padding-top: 4px;
}

.ref-image-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ref-image-action-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.ref-image-action-btn .btn-icon {
  font-size: 1.1em;
}

.ref-image-action-btn .btn-text {
  font-family: var(--font-family);
}

.params-content {
  color: var(--color-bright-light-navy);
}

.result-content {
  color: var(--color-green);
}

.error-content {
  color: var(--color-red);
}

.params-content code,
.result-content code,
.error-content code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  font-size: 0.9em;
  font-family: var(--font-family-mono);
}

.tool-error .error-label {
  color: var(--color-red);
}

.tool-running {
  display: flex;
  align-items: center;
  gap: 8px;
  float: left;
  padding: 4px;
  align-self: self-start;
  color: var(--color-med-navy);
  justify-content: flex-start;
}

.tool-running .spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-blue);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Async Tool Running Indicator with Stop Button */
.async-tool-running {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
  border-left: 3px solid var(--color-blue);
  border-radius: 8px;
  margin: 8px 0;
}

.async-tool-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-med-navy);
  font-size: 14px;
}

.async-tool-status .spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-blue);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.stop-async-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 4px;
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px #ef44444d;
  margin-left: 8px;
}

.stop-async-tool-btn:hover {
  background: #dc2626;
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.4);
  transform: scale(1.1);
}

.stop-async-tool-btn:active {
  transform: scale(0.95);
  box-shadow: 0 1px 2px rgba(239, 68, 68, 0.3);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.status-indicator.thinking {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.status-indicator.tool {
  background: rgba(18, 224, 255, 0.05);
  border: 1px solid rgba(18, 224, 255, 0.1);
}

.status-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.status-indicator.thinking .status-spinner {
  border-color: var(--color-med-navy);
  border-top-color: transparent;
}

.status-indicator.tool .status-spinner {
  border-color: var(--color-blue);
  border-top-color: transparent;
}

.status-text {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-light-med-navy);
}

/* HTML Inline Preview */
.message-text :deep(.html-inline-preview-wrapper) {
  position: relative;
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-radius: 8px;
  overflow: hidden;
  margin: 0;
  padding: 0 12px 12px;
  background: var(--color-background);
}
.message-text :deep(.html-inline-preview-wrapper:last-child) {
  margin-bottom: 0;
}
.message-text :deep(* + .html-inline-preview-wrapper) {
  margin-top: 12px;
}
.message-text :deep(.html-inline-iframe-scroller) {
  max-height: 800px;
  overflow: auto;
  border-radius: 0;
  scrollbar-width: none;
}
.message-text :deep(.html-inline-iframe-scroller::-webkit-scrollbar) {
  display: none;
}
.message-text :deep(.html-inline-iframe) {
  width: 100%;
  /* height: 120px;  */
  min-height: 480px;
  min-width: 707px;
  margin-bottom: 0;
  border: none;
  border-radius: 0;
  display: block;
}
.message-text :deep(.html-inline-code) {
  margin: 0 !important;
  border-radius: 0 !important;
}

/* HTML Code Action Buttons */
.message-text :deep(.html-code-actions) {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  background: var(--color-background-primary);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  z-index: 10;
}
.message-text :deep(.html-actions-group) {
  display: flex;
  gap: 8px;
}

.message-text :deep(.html-action-btn) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-text :deep(.html-action-btn:hover) {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
}

.message-text :deep(.html-action-btn .btn-icon) {
  font-size: 1.1em;
}

.message-text :deep(.html-action-btn .btn-text) {
  font-family: var(--font-family);
}

/* HTML Preview Modal */
.html-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 0;
  backdrop-filter: blur(4px);
  animation: modal-fade-in 0.2s ease;
}

@keyframes modal-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.html-preview-content {
  background: var(--color-darkest);
  border: none;
  border-radius: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  animation: modal-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modal-slide-up {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.html-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(127, 129, 147, 0.1);
  background: var(--color-darker-1);
}

.html-preview-header h3 {
  margin: 0;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.close-preview-btn {
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.15);
  color: var(--color-light-med-navy);
  font-size: 1.2em;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.2s ease;
  line-height: 1;
  font-weight: 500;
}

.close-preview-btn:hover {
  background: rgba(255, 107, 107, 0.15);
  border-color: var(--color-red);
  color: var(--color-red);
}

.html-preview-body {
  padding: 0;
  overflow: hidden;
  flex: 1;
  background: var(--color-darkest);
  display: flex;
}

/* HTML Preview Iframe */
.html-preview-body :deep(.html-preview-iframe) {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-background);
}

/* Ensure preview content is styled appropriately */
.html-preview-body :deep(*) {
  max-width: 100%;
}

.html-preview-body :deep(img) {
  max-width: 100%;
  height: auto;
}

/* Setup Message Styles */
.message-text :deep(.setup-message) {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px 0;
}

.message-text :deep(.setup-header) {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(127, 129, 147, 0.15);
}

.message-text :deep(.setup-icon) {
  font-size: 2.5em;
  line-height: 1;
}

.message-text :deep(.setup-header h2) {
  margin: 0;
  font-size: 1.5em;
  font-weight: 700;
  color: var(--color-white);
  background: linear-gradient(135deg, var(--color-green), var(--color-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.message-text :deep(.setup-content) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-text :deep(.setup-step) {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.message-text :deep(.step-number) {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-green), var(--color-blue));
  color: var(--color-darkest);
  font-weight: 700;
  font-size: 1.1em;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.message-text :deep(.step-text) {
  flex: 1;
}

.message-text :deep(.step-text h3) {
  margin: 0 0 8px 0;
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-text);
}

.message-text :deep(.step-text p) {
  margin: 0;
  color: var(--color-light-med-navy);
  line-height: 1.5;
}

.message-text :deep(.setup-note) {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: rgba(18, 224, 255, 0.05);
  border: 1px solid rgba(18, 224, 255, 0.15);
  border-radius: 8px;
  align-items: flex-start;
}

.message-text :deep(.note-icon) {
  font-size: 1.3em;
  line-height: 1;
  flex-shrink: 0;
}

.message-text :deep(.note-text) {
  flex: 1;
  font-size: 0.95em;
  color: var(--color-light-med-navy);
  line-height: 1.6;
}

.message-text :deep(.note-text strong) {
  color: var(--color-blue);
  font-weight: 600;
}

.message-text :deep(.note-text code) {
  background-color: rgba(127, 129, 147, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--color-green);
  border: 1px solid rgba(127, 129, 147, 0.15);
}

/* Provider Note (rendered after provider buttons) */
.provider-note {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: rgba(18, 224, 255, 0.05);
  border: 1px solid rgba(18, 224, 255, 0.15);
  border-radius: 8px;
  align-items: flex-start;
  width: calc(100% - 32px);
}

.provider-note .note-icon {
  font-size: 1.3em;
  line-height: 1;
  flex-shrink: 0;
}

.provider-note .note-text {
  flex: 1;
  font-size: 0.95em;
  color: var(--color-light-med-navy);
  line-height: 1.6;
}

.provider-note .note-text strong {
  color: var(--color-blue);
  font-weight: 600;
}

.provider-note .note-text code {
  background-color: rgba(127, 129, 147, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--color-green);
  border: 1px solid rgba(127, 129, 147, 0.15);
}

/* Image Gallery Styles */
.tool-images {
  margin-top: 12px;
  width: 100%;
}

.single-image-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid rgba(127, 129, 147, 0.15);
}

.generated-image {
  width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid rgba(127, 129, 147, 0.2);
  object-fit: contain;
  max-height: 600px;
  background: rgba(0, 0, 0, 0.2);
}

.image-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.image-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.image-action-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.image-action-btn .btn-icon {
  font-size: 1.1em;
}

.image-action-btn .btn-text {
  font-family: var(--font-family);
}

/* Image Grid for Multiple Images */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  border: 1px solid rgba(127, 129, 147, 0.15);
}

.grid-item {
  position: relative;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(127, 129, 147, 0.2);
  transition: all 0.2s ease;
}

.grid-item:hover {
  border-color: var(--color-green);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.grid-image {
  width: 100%;
  height: 200px;
  object-fit: cover;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.grid-image:hover {
  opacity: 0.9;
}

.grid-item-actions {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.5);
  justify-content: center;
}

.grid-action-btn {
  padding: 6px 10px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-green);
  font-size: 1.1em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.uploaded-file-info {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
}

.grid-action-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: scale(1.1);
}

/* Assistant Message Image Wrapper and Actions */
.message-text :deep(.assistant-image-wrapper) {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
}

.message-text :deep(.assistant-image-wrapper img) {
  width: 100%;
  max-width: 100%;
  height: auto;
  /* border-radius: 8px; */
  border: 1px solid rgba(127, 129, 147, 0.2);
}

.message-text :deep(.assistant-image-actions) {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
  flex-wrap: wrap;
}

.message-text :deep(.assistant-image-action-btn) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-text :deep(.assistant-image-action-btn:hover) {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.message-text :deep(.assistant-image-action-btn .btn-icon) {
  font-size: 1.1em;
}

.message-text :deep(.assistant-image-action-btn .btn-text) {
  font-family: var(--font-family);
}

/* HTML Preview Header Actions */
.html-preview-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.share-preview-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.share-preview-btn:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.share-preview-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Share Modal Styles */
.share-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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

.share-modal-close:hover {
  color: var(--color-red);
}

/* Share Modal Loading State */
.share-modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
}

.share-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--terminal-border-color);
  border-top-color: var(--color-green);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.share-modal-loading p {
  color: var(--color-light-med-navy);
  font-size: 0.95em;
  margin: 0;
}

/* Share Modal Error State */
.share-modal-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  gap: 16px;
  text-align: center;
}

.share-modal-error .error-icon {
  font-size: 2.5em;
}

.share-modal-error p {
  color: var(--color-red);
  font-size: 0.95em;
  margin: 0;
}

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

.share-retry-btn:hover {
  background: rgba(255, 107, 107, 0.2);
  border-color: var(--color-red);
}

/* Share Modal Success State */
.share-modal-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  gap: 20px;
}

.share-modal-success .success-icon {
  font-size: 2.5em;
}

.share-modal-success .success-message {
  color: var(--color-green);
  font-size: 1em;
  font-weight: 500;
  margin: 0;
}

.share-options {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.share-option {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.share-option label {
  font-size: 0.8em;
  font-weight: 500;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.share-input {
  display: flex;
  gap: 8px;
}

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

.share-input input:focus {
  outline: none;
  border-color: var(--color-green);
}

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

.share-copy-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: var(--color-green);
}

.share-actions {
  display: flex;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

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

.share-action-btn.view-btn {
  background: rgba(18, 224, 255, 0.1);
  border: 1px solid rgba(18, 224, 255, 0.3);
  color: var(--color-blue);
}

.share-action-btn.view-btn:hover {
  background: rgba(18, 224, 255, 0.2);
  border-color: var(--color-blue);
}

.share-action-btn.edit-btn {
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid rgba(127, 129, 147, 0.3);
  color: var(--color-light-med-navy);
}

.share-action-btn.edit-btn:hover {
  background: rgba(127, 129, 147, 0.2);
  border-color: var(--color-light-med-navy);
}

/* Share Modal Form State */
.share-modal-form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.share-form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.share-form-field label {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-light-med-navy);
}

.share-form-field input {
  background: var(--color-darkest);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px 14px;
  color: var(--color-white);
  font-size: 0.95em;
}

.share-form-field input:focus {
  outline: none;
  border-color: var(--color-green);
}

.share-form-field input::placeholder {
  color: var(--color-duller-navy);
}

.share-form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

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

.share-cancel-btn:hover {
  background: rgba(127, 129, 147, 0.1);
  border-color: var(--color-light-med-navy);
}

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

.share-submit-btn:hover:not(:disabled) {
  background: #15d975;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.share-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Chart.js inline charts in chat messages */
.message-text :deep(.chartjs-container) {
  width: 100%;
  max-width: 100%;
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

.message-text :deep(.chartjs-container canvas) {
  width: 100% !important;
}

/* D3 inline visualizations in chat messages */
.message-text :deep(.d3-container) {
  width: 100%;
  max-width: 100%;
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

.message-text :deep(.d3-container .d3-chart) {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-text :deep(.d3-container svg) {
  max-width: 100%;
  height: auto;
  display: block;
}

.message-text :deep(.d3-container text) {
  fill: #e0e0e0;
}

.message-text :deep(.d3-container .axis text) {
  fill: #a0a0a0;
  font-size: 11px;
}

.message-text :deep(.d3-container .axis path),
.message-text :deep(.d3-container .axis line) {
  stroke: #555;
}

.message-text :deep(.d3-container .grid line) {
  stroke: rgba(255, 255, 255, 0.08);
}

/* Three.js inline 3D scenes in chat messages */
.message-text :deep(.threejs-container) {
  width: 100%;
  max-width: 100%;
  margin: 12px 0;
  background-color: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-text :deep(.threejs-container .threejs-canvas) {
  width: 100% !important;
  height: auto !important;
  max-height: 450px;
  display: block;
  cursor: grab;
}

.message-text :deep(.threejs-container .threejs-canvas:active) {
  cursor: grabbing;
}

/* Visualization action buttons (Copy / Fullscreen) on chart/d3/threejs containers */
.message-text :deep(.viz-action-buttons) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 8px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-text :deep(.chartjs-container:hover .viz-action-buttons),
.message-text :deep(.d3-container:hover .viz-action-buttons),
.message-text :deep(.threejs-container:hover .viz-action-buttons) {
  opacity: 1;
}

/* ── Compact mode (forge panels) ── */
.message-wrapper.compact .message-card {
  padding: 12px 16px;
}

.message-wrapper.compact.assistant .message-card {
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

/* ========== Edit Message ========== */
.message-card {
  position: relative;
}

.message-edit-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
  z-index: 1;
}

.message-wrapper:hover .message-edit-btn {
  opacity: 0.6;
}

.message-edit-btn:hover {
  opacity: 1 !important;
  background: rgba(255, 255, 255, 0.08);
}

/* When editing, user message stretches full width */
.message-wrapper.user.editing {
  max-width: 100%;
  align-self: stretch;
}

.message-wrapper.user.editing .message-card {
  width: 100%;
  margin-left: 0;
}

.message-edit-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.message-edit-textarea {
  width: 100%;
  min-height: 40px;
  max-height: 300px;
  padding: 10px 12px;
  background: var(--color-darker-2, #1a1a2e);
  border: 1px solid var(--color-primary, #6c63ff);
  border-radius: 8px;
  color: var(--color-bright-light-navy, #e0e0e0);
  font-family: inherit;
  font-size: var(--font-size-sm, 13px);
  line-height: 1.4;
  resize: none;
  outline: none;
  box-sizing: border-box;
}

.message-edit-textarea:focus {
  border-color: var(--color-primary, #6c63ff);
  box-shadow: 0 0 0 2px rgba(108, 99, 255, 0.15);
}

.message-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.edit-cancel-btn,
.edit-send-btn {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition:
    background 0.15s ease,
    opacity 0.15s ease;
}

.edit-cancel-btn {
  background: transparent;
  color: var(--color-med-navy, #8b949e);
  border: 1px solid var(--terminal-border-color, #30363d);
}

.edit-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.edit-send-btn {
  background: var(--color-primary, #6c63ff);
  color: #fff;
}

.edit-send-btn:hover {
  opacity: 0.9;
}

.edit-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
