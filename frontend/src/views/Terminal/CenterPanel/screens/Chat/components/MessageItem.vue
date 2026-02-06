<template>
  <div class="message-wrapper" :class="message.role" ref="messageRef">
    <img v-if="message.role === 'assistant' && showAvatar" :src="assistantAvatar" alt="Assistant Avatar" class="message-avatar" />
    <div class="message-content">
      <div class="message-card">
        <div v-if="status" class="status-indicator" :class="status.type">
          <div class="status-spinner"></div>
          <span class="status-text">{{ status.text }}</span>
        </div>
        <p v-if="renderedContent" class="message-text" v-html="renderedContent"></p>

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

        <!-- Tool Execution Details -->
        <div v-if="message.toolCalls && message.toolCalls.length > 0" class="tool-execution-details">
          <div v-for="(toolCall, index) in message.toolCalls" :key="`${message.id}-${index}`" class="tool-call-item">
            <div class="tool-header" @click="toggleToolCall(index)">
              <span class="tool-expansion-icon">
                {{ isExpanded(index) ? '▾' : '▸' }}
              </span>
              <span class="tool-icon">⚙️</span>
              <span class="tool-label">{{ toolCall.name }}</span>
            </div>

            <div v-if="isRunning(toolCall.id)" class="tool-running">
              <div class="spinner"></div>
              <span>Executing...</span>
            </div>

            <!-- Stop button for async tools -->
            <div v-if="isAsyncToolRunning(toolCall)" class="async-tool-running">
              <button @click="stopAsyncTool(toolCall)" class="stop-async-tool-btn">
                <span class="stop-icon">⏹</span>
                <span class="stop-text">Stop Async Tool</span>
              </button>
            </div>

            <div v-if="isExpanded(index)" class="tool-call-content">
              <div class="tool-params">
                <div class="params-label">Input Parameters:</div>
                <pre class="params-content"><code class="language-json" v-html="formatJSON(toolCall.args)"></code></pre>
              </div>
              <div v-if="toolCall.result" class="tool-result">
                <div class="result-label">Output:</div>

                <!-- Image Gallery for image generation results -->
                <div v-if="hasImages(toolCall.result)" class="tool-images">
                  <div v-if="extractImages(toolCall.result).length === 1" class="single-image-container">
                    <img :src="extractImages(toolCall.result)[0]" alt="Generated Image" class="generated-image" />
                    <div class="image-actions">
                      <button @click="downloadImage(extractImages(toolCall.result)[0], 'generated-image.png')" class="image-action-btn">
                        <span class="btn-icon">📥</span>
                        <span class="btn-text">Download</span>
                      </button>
                      <button @click="copyImageToClipboard(extractImages(toolCall.result)[0])" class="image-action-btn">
                        <span class="btn-icon">📋</span>
                        <span class="btn-text">Copy</span>
                      </button>
                      <button @click="openImageInNewTab(extractImages(toolCall.result)[0])" class="image-action-btn">
                        <span class="btn-icon">🔍</span>
                        <span class="btn-text">Open</span>
                      </button>
                    </div>
                  </div>

                  <div v-else class="image-grid">
                    <div v-for="(img, idx) in extractImages(toolCall.result)" :key="idx" class="grid-item">
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
                <pre v-else class="result-content"><code class="language-json" v-html="formatJSON(toolCall.result)"></code></pre>
              </div>
              <div v-if="toolCall.error" class="tool-error">
                <div class="error-label">Error:</div>
                <pre class="error-content"><code v-html="toolCall.error"></code></pre>
              </div>
            </div>
          </div>
        </div>

        <div v-if="message.metadata && message.metadata.length > 0" class="message-metadata">
          <span v-for="data in message.metadata" :key="data" class="metadata-tag">
            {{ data }}
          </span>
        </div>
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
import { computed, ref, onMounted, onUpdated, nextTick } from 'vue';
import { useStore } from 'vuex';
import showdown from 'showdown';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/atom-one-dark.css';
import defaultAvatar from '@/assets/images/annie-avatar.png';
import ProviderSetup from './ProviderSetup.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

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
    // Add a custom extension to wrap Mermaid code blocks in divs with class "mermaid"
    function () {
      return [
        {
          type: 'output',
          filter: function (text) {
            // Match code blocks with language "mermaid"
            return text.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<div class="mermaid">$1</div>');
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
  },
  emits: ['toggle-tool', 'provider-connected', 'open-html-preview'],
  setup(props, { emit }) {
    // Initialize Mermaid with minimal theming to reduce inline styles
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'Arial, sans-serif',
      fontSize: 16,
      // Disable as many inline styles as possible
      themeVariables: {
        primaryColor: 'transparent',
        primaryTextColor: '#fff',
        primaryBorderColor: 'transparent',
        lineColor: '#5E5E5E',
        secondaryColor: 'transparent',
        tertiaryColor: 'transparent',
        background: 'transparent',
        mainBkg: 'transparent',
        secondBkg: 'transparent',
        tertiaryBkg: 'transparent',
        primaryBorderColor: 'transparent',
        secondaryBorderColor: 'transparent',
        tertiaryBorderColor: 'transparent',
        lineColor: '#5E5E5E',
        textColor: '#fff',
        nodeTextColor: '#fff',
      },
      // Configure Mermaid to use full width
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'linear',
        // Add text wrapping configuration
        wrap: true,
        padding: 10,
      },
      sequence: {
        useMaxWidth: true,
        wrap: true,
      },
      gantt: {
        useMaxWidth: true,
        wrap: true,
      },
      class: {
        useMaxWidth: true,
        wrap: true,
      },
      state: {
        useMaxWidth: true,
        wrap: true,
      },
      pie: {
        useMaxWidth: true,
        wrap: true,
      },
      journey: {
        useMaxWidth: true,
        wrap: true,
      },
      mindmap: {
        useMaxWidth: true,
        wrap: true,
      },
    });
    // Get Vuex store for auth token
    const store = useStore();

    const messageRef = ref(null);
    const showPreviewModal = ref(false);
    const previewHTML = ref('');
    const previewIframe = ref(null);

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

    // Open preview modal with HTML in iframe
    const openPreviewModal = (html) => {
      // Store the raw HTML - srcdoc attribute will handle rendering
      previewHTML.value = html;
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

            // Mark as processed
            codeBlock.setAttribute('data-buttons-added', 'true');

            // Get the raw HTML code
            const htmlCode = codeBlock.textContent || '';

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'html-code-actions';

            // Create Copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'html-action-btn copy-btn';
            copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
            copyBtn.onclick = (e) => {
              e.stopPropagation();
              copyHTMLCode(htmlCode);
              // Visual feedback
              copyBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Copied!</span>';
              setTimeout(() => {
                copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Copy</span>';
              }, 2000);
            };

            // Create Preview button
            const previewBtn = document.createElement('button');
            previewBtn.className = 'html-action-btn preview-btn';
            previewBtn.innerHTML = '<span class="btn-icon">👁</span><span class="btn-text">Preview</span>';
            previewBtn.onclick = (e) => {
              e.stopPropagation();
              openPreviewModal(htmlCode);
            };

            // Add buttons to container
            buttonContainer.appendChild(copyBtn);
            buttonContainer.appendChild(previewBtn);

            // Add container to pre element
            pre.style.position = 'relative';
            pre.appendChild(buttonContainer);
          });
        }
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

    // HTML Sanitization Configuration
    const sanitizeHTML = (html) => {
      return DOMPurify.sanitize(html, {
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

    // Sanitize Mermaid code to remove invalid characters and fix common issues
    const sanitizeMermaidCode = (code) => {
      let sanitized = code;

      // Remove any HTML/CSS that might have been accidentally included
      sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      sanitized = sanitized.replace(/<[^>]+>/g, '');

      // Remove zero-width characters and other invisible Unicode characters
      sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
      sanitized = sanitized.replace(/[\u2028\u2029]/g, '\n'); // Replace line/paragraph separators

      // Fix common arrow syntax issues
      // Replace various arrow-like characters with standard Mermaid arrows
      sanitized = sanitized.replace(/[→←↑↓⟶⟵⟷↔]/g, '-->');
      sanitized = sanitized.replace(/[─━│┃]/g, '-'); // Replace box drawing characters
      sanitized = sanitized.replace(/[┌┐└┘├┤┬┴┼]/g, ''); // Remove box corners

      // Fix common bracket/parenthesis issues
      // Replace various bracket types with standard ones
      sanitized = sanitized.replace(/[｛｝]/g, function (match) {
        return match === '｛' ? '{' : '}';
      });
      sanitized = sanitized.replace(/[［］]/g, function (match) {
        return match === '［' ? '[' : ']';
      });
      sanitized = sanitized.replace(/[（）]/g, function (match) {
        return match === '（' ? '(' : ')';
      });

      // Replace smart quotes and other quote variations with standard quotes
      sanitized = sanitized.replace(/[""''`´]/g, '"');

      // Fix common node ID issues - but preserve valid Mermaid syntax
      // Only sanitize if there are actual problematic characters, not valid Mermaid shapes

      // First, check if this looks like a valid flowchart with standard node shapes
      const hasValidFlowchartSyntax = /^flowchart\s+(TD|TB|BT|RL|LR)/.test(sanitized.trim());

      if (!hasValidFlowchartSyntax) {
        // Only apply aggressive sanitization to non-standard diagrams
        sanitized = sanitized.replace(/(\w+[^[\s]*?)(\([^)]*\))?(\[[^\]]+\])?/g, (match, nodeId, parens, brackets) => {
          // Clean the node ID - remove ALL special characters except alphanumeric, underscore, dash
          let cleanNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '');

          // If we have both parens and brackets, keep only the brackets (label)
          if (parens && brackets) {
            // Extract label from brackets, remove problematic characters
            const label = brackets.slice(1, -1).replace(/[()[\]!@#$%^&*]/g, '');
            return `${cleanNodeId}[${label}]`;
          } else if (brackets) {
            // Just brackets - clean the label
            const label = brackets.slice(1, -1).replace(/[()[\]!@#$%^&*]/g, '');
            return `${cleanNodeId}[${label}]`;
          } else if (parens) {
            // Just parens - convert to brackets for safety
            const label = parens.slice(1, -1).replace(/[()[\]!@#$%^&*]/g, '');
            return `${cleanNodeId}[${label}]`;
          }

          // No brackets or parens, just return the clean ID
          return cleanNodeId || match;
        });

        // Additional pass to catch any remaining problematic node patterns
        // Remove any node IDs that still have parentheses followed by brackets
        sanitized = sanitized.replace(/(\w+)\([^)]*\)\[[^\]]*\]/g, (match, nodeId) => {
          return `${nodeId}[Node]`;
        });
      } else {
        // For valid flowcharts, only remove truly problematic characters from labels
        // Preserve standard Mermaid node shapes: [], (), {}, (())
        sanitized = sanitized.replace(/(\w+)(\([^)]*\)|\[[^\]]+\]|\{[^}]*\})/g, (match, nodeId, shape) => {
          // Only clean the node ID if it has invalid characters
          const cleanNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '') || nodeId;

          // Clean the shape content but preserve the shape syntax
          if (shape.startsWith('[') && shape.endsWith(']')) {
            // Rectangle node - clean label but keep brackets
            const label = shape.slice(1, -1).replace(/[!@#$%^&*]/g, '');
            return `${cleanNodeId}[${label}]`;
          } else if (shape.startsWith('(') && shape.endsWith(')')) {
            // Round node - clean label but keep parentheses
            const label = shape.slice(1, -1).replace(/[!@#$%^&*]/g, '');
            return `${cleanNodeId}(${label})`;
          } else if (shape.startsWith('{') && shape.endsWith('}')) {
            // Diamond node - clean label but keep braces
            const label = shape.slice(1, -1).replace(/[!@#$%^&*]/g, '');
            return `${cleanNodeId}{${label}}`;
          }

          return match;
        });
      }

      // Fix edge label syntax - ensure proper format and remove problematic characters
      // First, handle the specific case from the error: -->|contains "!dice" edge-->
      sanitized = sanitized.replace(/-->\|([^|]*)"([^"]*)"([^|]*?)(?:edge)?-->/g, (match, before, quoted, after) => {
        // Remove exclamation marks and clean up the label
        const cleanLabel = (before + quoted + after).replace(/!/g, '').trim();
        return `-->|${cleanLabel}|`;
      });

      // Fix other edge label formats
      sanitized = sanitized.replace(/-->\|([^|]+)\|/g, (match, label) => {
        // Remove exclamation marks from edge labels
        const cleanLabel = label.replace(/!/g, '').trim();
        return `-->|${cleanLabel}|`;
      });

      // Fix edge labels with -- syntax
      sanitized = sanitized.replace(/--\s*([^->|]+?)\s*-->/g, (match, label) => {
        // Remove exclamation marks and clean up
        const cleanLabel = label.replace(/!/g, '').replace(/"/g, '').trim();
        return cleanLabel ? `-->|${cleanLabel}|` : '-->';
      });

      // Fix edge labels with quotes
      sanitized = sanitized.replace(/--\s*"([^"]+?)"\s*-->/g, (match, label) => {
        // Remove exclamation marks
        const cleanLabel = label.replace(/!/g, '').trim();
        return `-->|${cleanLabel}|`;
      });

      // Clean up any remaining "edge" keywords in arrows
      sanitized = sanitized.replace(/\s+edge\s*-->/g, ' -->');
      sanitized = sanitized.replace(/\s+edge-->/g, '-->');

      // Remove or replace problematic Unicode characters
      // Keep only ASCII and common extended Latin characters
      sanitized = sanitized.replace(/[^\x00-\x7F\xA0-\xFF\n\r\t]/g, '');

      // Fix multiple dashes (should be exactly 2 or 3)
      sanitized = sanitized.replace(/----+/g, '---');
      sanitized = sanitized.replace(/--([^->])/g, '-- $1');

      // Ensure proper spacing around arrows
      sanitized = sanitized.replace(/(\w+)-->/g, '$1 -->');
      sanitized = sanitized.replace(/-->(\w+)/g, '--> $1');

      // Remove any remaining control characters
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      // Fix common subgraph issues
      sanitized = sanitized.replace(/subgraph\s+([^a-zA-Z0-9_\s])/g, 'subgraph $1');

      // Ensure node definitions don't have trailing invalid characters
      sanitized = sanitized.replace(/(\[[^\]]+\])[^\s\n\r;|>-]/g, '$1');

      // Clean up excessive whitespace
      sanitized = sanitized.replace(/[ \t]+/g, ' '); // Multiple spaces to single
      sanitized = sanitized.replace(/\n{3,}/g, '\n\n'); // Multiple newlines to double

      // Trim each line
      sanitized = sanitized
        .split('\n')
        .map((line) => line.trim())
        .join('\n');

      // Remove empty lines at the beginning and end
      sanitized = sanitized.trim();

      return sanitized;
    };

    // Fix foreignObject widths and center text properly
    const fixForeignObjectWidths = (svg) => {
      // Find all foreignObject elements in node labels
      const foreignObjects = svg.querySelectorAll('.label foreignObject');

      foreignObjects.forEach((foreignObject) => {
        try {
          const div = foreignObject.querySelector('div');
          const span = foreignObject.querySelector('span');
          const textElement = span || div;

          if (textElement) {
            // Get the actual text content
            const textContent = textElement.textContent || textElement.innerText || '';

            // Create a temporary element to measure text width
            const tempElement = document.createElement('span');
            tempElement.style.visibility = 'hidden';
            tempElement.style.position = 'absolute';
            tempElement.style.whiteSpace = 'nowrap';

            // Get computed styles with fallbacks
            const computedStyle = window.getComputedStyle(textElement);
            tempElement.style.fontSize = computedStyle.fontSize || '14px';
            tempElement.style.fontFamily = computedStyle.fontFamily || 'Arial, sans-serif';
            tempElement.style.fontWeight = computedStyle.fontWeight || 'normal';
            tempElement.textContent = textContent;

            document.body.appendChild(tempElement);
            const textWidth = tempElement.offsetWidth || 100; // Fallback width
            document.body.removeChild(tempElement);

            // Add padding to the width
            const padding = 20;
            const currentWidth = parseInt(foreignObject.getAttribute('width')) || 100;
            const newWidth = Math.max(textWidth + padding, currentWidth);

            // Validate newWidth is a valid number
            if (!isNaN(newWidth) && isFinite(newWidth) && newWidth > 0) {
              // Update the foreignObject width and center it
              foreignObject.setAttribute('width', newWidth);
              foreignObject.setAttribute('x', -(newWidth / 2));

              // Get the foreignObject height and ensure proper vertical centering
              const foreignObjectHeight = parseInt(foreignObject.getAttribute('height')) || 50;

              // Center the text content within the foreignObject
              if (textElement && !isNaN(foreignObjectHeight) && isFinite(foreignObjectHeight)) {
                textElement.style.textAlign = 'center';
                textElement.style.width = '100%';
                textElement.style.height = '100%';
                textElement.style.display = 'flex';
                textElement.style.alignItems = 'center';
                textElement.style.justifyContent = 'center';
                textElement.style.margin = '0';
                textElement.style.padding = '0';
                textElement.style.lineHeight = '1.2';
                textElement.style.boxSizing = 'border-box';
                textElement.style.transform = 'scale(.9)';

                // For multi-line text, ensure proper vertical centering
                if (textContent.length > 20 || textContent.includes(' ')) {
                  textElement.style.minHeight = foreignObjectHeight + 'px';
                }
              }

              // Update the parent rect if it exists
              const parentNode = foreignObject.closest('.node');
              if (parentNode) {
                const rect = parentNode.querySelector('rect.label-container, rect');
                if (rect) {
                  // Center the rect as well
                  rect.setAttribute('width', newWidth);
                  rect.setAttribute('x', -(newWidth / 2));
                }
              }

              // Update the label group transform to ensure proper centering
              const labelGroup = foreignObject.closest('.label');
              if (labelGroup) {
                const transform = labelGroup.getAttribute('transform');
                if (transform) {
                  const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
                  if (match) {
                    const translateY = parseFloat(match[2]);
                    // Validate translateY is a valid number
                    if (!isNaN(translateY) && isFinite(translateY)) {
                      // Center the label group horizontally
                      labelGroup.setAttribute('transform', `translate(0,${translateY})`);
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          // Silently catch errors for individual foreignObject elements
          // This prevents one bad element from breaking the entire diagram
          console.warn('Error fixing foreignObject width:', error);
        }
      });
    };

    // Apply node status coloring based on content keywords
    const applyNodeStatusColoring = (svg) => {
      // Find all node elements in the SVG
      const nodes = svg.querySelectorAll('.node');

      nodes.forEach((node) => {
        // Get the node's text content from its label
        const labelElement = node.querySelector('.nodeLabel, .label');
        if (!labelElement) return;

        const nodeText = (labelElement.textContent || '').toLowerCase().trim();

        // Define keyword patterns for each status
        const statusPatterns = {
          success: [
            // Success keywords
            'success',
            'successful',
            'complete',
            'completed',
            'done',
            'finished',
            'passed',
            'ok',
            'ready',
            // Success symbols
            '✓',
            '✔',
            '✅',
            '☑',
            '✔️',
            // Success phrases
            'format cli response',
            'send discord response',
            'response sent',
            'task complete',
            // Workflow-specific success patterns
            'step complete',
            'step completed',
            'workflow finished',
            'workflow complete',
            'execution successful',
            'task done',
            'process completed',
            'operation success',
            'node executed',
            'step executed',
            'workflow success',
            'execution complete',
          ],
          warning: [
            // Warning keywords
            'warning',
            'caution',
            'pending',
            'waiting',
            'processing',
            'in progress',
            'review',
            'check',
            // Warning symbols
            '⚠',
            '⚠️',
            '!',
            '❗',
            '❕',
            // Warning phrases
            'parse command',
            'command success',
            'needs review',
            'validate',
            // Workflow-specific warning patterns
            'step pending',
            'workflow paused',
            'awaiting execution',
            'needs input',
            'manual step',
            'conditional branch',
            'step processing',
            'workflow processing',
            'awaiting approval',
            'requires review',
            'step waiting',
            'node pending',
          ],
          error: [
            // Error keywords
            'error',
            'failed',
            'failure',
            'broken',
            'issue',
            'problem',
            'exception',
            'crash',
            'bug',
            // Error symbols
            '✗',
            '✘',
            '❌',
            '❎',
            '⛔',
            '🚫',
            '💥',
            // Error phrases
            'format error message',
            'error handling',
            'failed to',
            'connection failed',
            // Workflow-specific error patterns
            'step failed',
            'workflow error',
            'execution failed',
            'task error',
            'process failed',
            'operation failed',
            'node failed',
            'step error',
            'workflow failed',
            'execution error',
            'timeout occurred',
            'validation error',
            'connection timeout',
            'step timeout',
          ],
        };

        // Check which status matches the node text
        let detectedStatus = null;

        // Check for exact matches and partial matches
        for (const [status, patterns] of Object.entries(statusPatterns)) {
          for (const pattern of patterns) {
            if (nodeText.includes(pattern.toLowerCase())) {
              detectedStatus = status;
              break;
            }
          }
          if (detectedStatus) break;
        }

        // Apply the detected status class
        if (detectedStatus) {
          node.classList.add(detectedStatus);

          // Also check for specific node shapes and apply to their containers
          const shapeElements = node.querySelectorAll('rect, circle, ellipse, polygon, path, .basic, .label-container');
          shapeElements.forEach((shape) => {
            shape.parentElement?.classList.add(detectedStatus);
          });
        }
      });
    };

    const renderMermaidDiagrams = () => {
      nextTick(() => {
        if (messageRef.value) {
          // Find all Mermaid diagram containers
          const mermaidElements = messageRef.value.querySelectorAll('.mermaid:not([data-processed])');
          if (mermaidElements.length > 0) {
            // Sanitize and prepare elements for rendering
            const elementsToRender = [];

            mermaidElements.forEach((el) => {
              // Get the original Mermaid code
              const originalCode = el.textContent || el.innerText || '';

              // Store original code for error display
              el.setAttribute('data-original-code', originalCode);

              // Sanitize the code
              const sanitizedCode = sanitizeMermaidCode(originalCode);

              // Update the element with sanitized code
              el.textContent = sanitizedCode;

              // Add to render list
              elementsToRender.push(el);
            });

            // Render all sanitized Mermaid diagrams
            mermaid
              .run({
                nodes: elementsToRender,
              })
              .then(() => {
                // Mark elements as processed and remove inline styles
                elementsToRender.forEach((el) => {
                  el.setAttribute('data-processed', 'true');

                  // Remove all inline styles from Mermaid SVG elements
                  const svg = el.querySelector('svg');
                  if (svg) {
                    // Remove inline styles from all elements
                    svg.querySelectorAll('*[style]').forEach((element) => {
                      element.removeAttribute('style');
                    });

                    // Add a class to identify successful diagrams
                    el.classList.add('mermaid-success');

                    // Apply node status coloring based on content
                    applyNodeStatusColoring(svg);

                    // Fix foreignObject widths to prevent text breaking
                    fixForeignObjectWidths(svg);
                  }
                });
              })
              .catch((err) => {
                console.error('Mermaid rendering error:', err);
                // Mark elements as processed even if there's an error to avoid infinite loops
                mermaidElements.forEach((el) => {
                  el.setAttribute('data-processed', 'true');
                  // Show the original Mermaid code along with the error message
                  // Try to get the original unsanitized code if available
                  let mermaidCode = el.getAttribute('data-original-code') || el.textContent;
                  // Try to extract only the actual diagram code by finding common Mermaid patterns
                  // First try to match the specific diagram type with its content
                  const diagramMatch = mermaidCode.match(
                    /(graph|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|flowchart|erDiagram|requirementDiagram|gitGraph|journey|quadrantChart|sankey|xychart|mindmap|timeline|quadrantChart|sankey).*?(\n\s*\n|$)/s
                  );
                  if (diagramMatch) {
                    mermaidCode = diagramMatch[0];
                  } else {
                    // If no specific pattern matched, try to find any content that looks like a diagram
                    const generalMatch = mermaidCode.match(
                      /(graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|erDiagram|requirementDiagram|gitGraph|journey|quadrantChart|sankey|xychart|mindmap|timeline).*?(%%.*?\n)*.*?(?=\n\s*\n|$)/s
                    );
                    if (generalMatch) {
                      mermaidCode = generalMatch[0];
                    }
                  }
                  // Simple HTML escaping function
                  const escapeHtml = (unsafe) => {
                    return unsafe
                      .replace(/&/g, '&' + 'amp;')
                      .replace(/</g, '&' + 'lt;')
                      .replace(/>/g, '&' + 'gt;')
                      .replace(/"/g, '&' + 'quot;')
                      .replace(/'/g, '&' + '#039;');
                  };
                  el.innerHTML = `
                  <div class="mermaid-error-wrapper">
                    <div class="mermaid-error">
                      <div class="error-header">Mermaid Diagram Error:</div>
                      <div class="error-message">${err.message}</div>
                      <details class="error-details">
                        <summary>Show diagram code</summary>
                        <pre class="mermaid-code">${escapeHtml(mermaidCode)}</pre>
                      </details>
                    </div>
                  </div>
                `;
                });
              });
          }
        }
      });
    };

    const highlightCode = () => {
      nextTick(() => {
        if (messageRef.value) {
          // Highlight all code blocks, including those with v-html
          messageRef.value.querySelectorAll('pre code').forEach((block) => {
            if (!block.classList.contains('hljs') && !block.classList.contains('language-mermaid')) {
              hljs.highlightElement(block);
            }
          });

          // Render Mermaid diagrams
          renderMermaidDiagrams();

          // Add HTML code action buttons
          addHTMLCodeButtons();

          // Add image action buttons to assistant messages
          addImageActionButtons();

          // Trigger MathJax rendering if available - simplified approach like response.js
          if (window.MathJax) {
            // Add a small delay to ensure DOM is fully updated before MathJax rendering
            setTimeout(() => {
              try {
                window.MathJax.typesetPromise([messageRef.value]).catch((err) => {
                  console.error('MathJax rendering error:', err);
                });
              } catch (err) {
                console.error('MathJax rendering error:', err);
              }
            }, 10);
          }
        }
      });
    };

    onMounted(highlightCode);
    onUpdated(highlightCode);

    const renderedContent = computed(() => {
      if (typeof props.message.content === 'string') {
        if (props.message.content.toLowerCase() === 'null' || props.message.content.toLowerCase() === 'undefined') {
          return '';
        }

        let content = props.message.content;

        if (!content) {
          return '';
        }

        // USER MESSAGES: Display as plain text, only use code block if it looks like code
        if (props.message.role === 'user') {
          const content = props.message.content;

          // Detect if content looks like code (has HTML tags, multiple lines of code-like syntax, etc.)
          const looksLikeCode =
            content.includes('<!DOCTYPE') ||
            content.includes('<html') ||
            content.includes('<script') ||
            content.includes('<style') ||
            (content.includes('<') && content.includes('>') && content.split('\n').length > 3) ||
            (content.includes('function') && content.includes('{') && content.includes('}')) ||
            (content.includes('const') && content.includes('=') && content.split('\n').length > 2) ||
            (content.includes('import') && content.includes('from')) ||
            content.match(/^```/m); // User explicitly used code fences

          // Escape HTML entities
          const escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

          if (looksLikeCode) {
            // Wrap in pre/code block for code-like content
            return `<pre><code>${escapedContent}</code></pre>`;
          } else {
            // Regular text - preserve line breaks but don't use code block
            return escapedContent.replace(/\n/g, '<br>');
          }
        }

        // ASSISTANT MESSAGES: Process as markdown/HTML
        // Check if message has explicit contentType metadata
        if (props.message.contentType === 'html') {
          // Explicitly marked as HTML - sanitize and return
          return sanitizeHTML(props.message.content);
        }

        // Check for incomplete code blocks during streaming
        // Count opening and closing code fence markers
        const openingFences = (props.message.content.match(/```/g) || []).length;

        // If we have an odd number of code fences, we have an incomplete code block
        // Return the raw content wrapped in a pre tag to prevent premature rendering
        if (openingFences % 2 !== 0) {
          // Find the last opening fence
          const lastFenceIndex = props.message.content.lastIndexOf('```');

          // Split content into completed part and incomplete code block
          const completedContent = props.message.content.substring(0, lastFenceIndex);
          const incompleteBlock = props.message.content.substring(lastFenceIndex);

          // Process the completed content as markdown
          let renderedCompleted = '';
          if (completedContent.trim()) {
            let processedCompleted = completedContent.replace(/([.!?:])([A-Z])/g, '$1 $2').replace(/([.!?:])(\n)([A-Z])/g, '$1$2$3');
            renderedCompleted = markdownConverter.makeHtml(processedCompleted);
          }

          // Return completed markdown + raw incomplete block in a pre tag
          return renderedCompleted + '<pre><code>' + incompleteBlock.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>';
        }

        // Default: Process as Markdown (removed auto-detection to prevent false positives)
        // Fix spacing issues when sentences are concatenated during streaming
        // Add space between sentence endings (. ! ? :) and capital letters
        let processedContent = props.message.content.replace(/([.!?:])([A-Z])/g, '$1 $2').replace(/([.!?:])(\n)([A-Z])/g, '$1$2$3'); // Don't add space if there's already a newline

        let renderedHtml = markdownConverter.makeHtml(processedContent);

        // CRITICAL: Resolve image references AFTER markdown conversion
        // This ensures the HTML structure is complete before we replace image references
        const imageRefPattern = /\{\{IMAGE_REF:([^}]+)\}\}/g;

        console.log('[MessageItem] Processing rendered HTML for image references');
        console.log('[MessageItem] Image cache size:', props.imageCache.size);
        console.log('[MessageItem] Image cache keys:', Array.from(props.imageCache.keys()));

        renderedHtml = renderedHtml.replace(imageRefPattern, (match, imageId) => {
          console.log(`[MessageItem] Attempting to resolve: ${imageId}`);
          const cached = props.imageCache.get(imageId);
          console.log(`[MessageItem] Cache lookup result:`, cached ? 'FOUND' : 'NOT FOUND');
          if (cached && cached.data) {
            console.log(`[MessageItem] Resolved image reference: ${imageId}, data length: ${cached.data.length}`);
            return cached.data; // Return the actual data URL
          }
          console.warn(`[MessageItem] Image reference not found in cache: ${imageId}`);
          return ''; // Remove unresolved references
        });

        return renderedHtml;
      }
      return '';
    });

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

    const isAsyncToolRunning = (toolCall) => {
      // Check if this tool is an async tool that's still running
      console.log('[AsyncTool Check] Checking tool:', toolCall.name);

      if (!toolCall.result) {
        console.log('[AsyncTool Check] No result yet');
        return false;
      }

      try {
        const result = typeof toolCall.result === 'string'
          ? JSON.parse(toolCall.result)
          : toolCall.result;

        console.log('[AsyncTool Check]', toolCall.name, 'result:', result);
        console.log('[AsyncTool Check] executionId:', result.executionId, 'status:', result.status);

        // Async tools have status: "queued" or "running" and an executionId
        const isAsync = result.executionId && (result.status === 'queued' || result.status === 'running');
        console.log('[AsyncTool Check] IS ASYNC RUNNING?', isAsync);
        return isAsync;
      } catch (e) {
        console.error('[AsyncTool Check] Parse error:', e);
        return false;
      }
    };

    const stopAsyncTool = async (toolCall) => {
      try {
        const result = typeof toolCall.result === 'string'
          ? JSON.parse(toolCall.result)
          : toolCall.result;

        const executionId = result.executionId;
        if (!executionId) {
          console.error('No executionId found for async tool');
          return;
        }

        console.log(`Stopping async tool execution: ${executionId}`);

        // Call the cancel API
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3333'}/api/async-tools/cancel/${executionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        });

        const data = await response.json();

        if (data.success) {
          console.log('Async tool cancelled successfully');
          // Update the tool result to show it was cancelled
          toolCall.result = JSON.stringify({
            ...result,
            status: 'cancelled',
            message: 'Execution cancelled by user',
          });
        } else {
          console.error('Failed to cancel async tool:', data.error);
          alert(`Failed to stop: ${data.error}`);
        }
      } catch (error) {
        console.error('Error stopping async tool:', error);
        alert(`Error stopping tool: ${error.message}`);
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
      renderedContent,
      formatJSON,
      formatTime,
      isExpanded,
      isRunning,
      isAsyncToolRunning,
      stopAsyncTool,
      toggleToolCall,
      assistantAvatar,
      showPreviewModal,
      previewHTML,
      previewIframe,
      closePreviewModal,
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
  border: 2px solid var(--color-green);
  padding: 2px;
}

.message-wrapper {
  display: flex;
  gap: 16px;
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
  /* overflow: scroll; */
  width: 100%;
  width: -webkit-fill-available;
  backdrop-filter: blur(4px);
}

body[data-page='terminal-agent-forge'] .message-card,
body[data-page='terminal-workflow-designer'] .message-card,
body[data-page='terminal-tool-forge'] .message-card {
  padding: 12px 16px;
}

body[data-page='terminal-agent-forge'] .message-wrapper.assistant .message-card,
body[data-page='terminal-workflow-designer'] .message-wrapper.assistant .message-card,
body[data-page='terminal-tool-forge'] .message-wrapper.assistant .message-card {
  padding: 0;
  background: transparent;
  border: none;
}
-agent-forge .message-wrapper.user .message-card {
  background: rgba(25, 239, 131, 0.05);
  border-color: rgba(25, 239, 131, 0.15);
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
}

.message-text {
  font-size: var(--font-size-sm);
  line-height: 1.35;
  color: var(--color-bright-light-navy);
  margin: 0;
  overflow-wrap: anywhere;
  width: inherit;
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

.message-text :deep(p) {
  margin-top: 1em;
  margin-bottom: 1em;
}
.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

/* Mermaid Styling - Consistent appearance for all diagrams */

/* Default state - Pink border */
.message-text :deep(.mermaid) {
  --mermaid-node-fill: var(--color-darker-1);
  --mermaid-node-stroke: var(--terminal-border-color);
  --mermaid-edge-color: var(--color-lighter-1);
}

/* Success state - Green border */
/* .message-text :deep(.mermaid-success) {
  --mermaid-node-stroke: var(--color-green);
} */

/* Error state - Red border */
.message-text :deep(.mermaid-error-wrapper) {
  --mermaid-node-stroke: #ff6b6b;
}

/* Apply consistent styles to all Mermaid nodes */
.message-text :deep(.mermaid .node rect),
.message-text :deep(.mermaid circle),
.message-text :deep(.mermaid ellipse),
.message-text :deep(.mermaid polygon),
.message-text :deep(.mermaid path.node),
.message-text :deep(.mermaid .basic),
.message-text :deep(.mermaid .label-container),
.message-text :deep(.mermaid .node.ok rect) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--mermaid-node-stroke) !important;
  stroke-width: 1px !important;
  rx: 8 !important;
  ry: 8 !important;
}

/* Node Status Styling - Success nodes (green stroke) */
.message-text :deep(.mermaid .node.success rect),
.message-text :deep(.mermaid .node.success circle),
.message-text :deep(.mermaid .node.success ellipse),
.message-text :deep(.mermaid .node.success polygon),
.message-text :deep(.mermaid .node.success path),
.message-text :deep(.mermaid .node.success .basic),
.message-text :deep(.mermaid .node.success .label-container) {
  stroke: var(--color-green) !important;
}

/* Node Status Styling - Warning nodes (yellow stroke) */
.message-text :deep(.mermaid .node.warning rect),
.message-text :deep(.mermaid .node.warning circle),
.message-text :deep(.mermaid .node.warning ellipse),
.message-text :deep(.mermaid .node.warning polygon),
.message-text :deep(.mermaid .node.warning path),
.message-text :deep(.mermaid .node.warning .basic),
.message-text :deep(.mermaid .node.warning .label-container) {
  stroke: var(--color-yellow) !important;
}

/* Node Status Styling - Error nodes (red stroke) */
.message-text :deep(.mermaid .node.error rect),
.message-text :deep(.mermaid .node.error circle),
.message-text :deep(.mermaid .node.error ellipse),
.message-text :deep(.mermaid .node.error polygon),
.message-text :deep(.mermaid .node.error path),
.message-text :deep(.mermaid .node.error .basic),
.message-text :deep(.mermaid .node.error .label-container) {
  stroke: var(--color-red) !important;
}

/* Force all extra node classes to use only our 3 status types */
/* Override any Mermaid-generated classes like trigger, process, display, action, etc. */
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) rect),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) circle),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) ellipse),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) polygon),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) path),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) .basic),
.message-text :deep(.mermaid .node:not(.success):not(.warning):not(.error) .label-container) {
  stroke: var(--mermaid-node-stroke) !important; /* Default neutral stroke */
}

/* Force override any extra classes that might be applied - MAXIMUM SPECIFICITY */
.message-text :deep(.mermaid .node.trigger rect),
.message-text :deep(.mermaid .node.trigger circle),
.message-text :deep(.mermaid .node.trigger ellipse),
.message-text :deep(.mermaid .node.trigger polygon),
.message-text :deep(.mermaid .node.trigger path),
.message-text :deep(.mermaid .node.trigger .basic),
.message-text :deep(.mermaid .node.trigger .label-container),
.message-text :deep(.mermaid .node.process rect),
.message-text :deep(.mermaid .node.process circle),
.message-text :deep(.mermaid .node.process ellipse),
.message-text :deep(.mermaid .node.process polygon),
.message-text :deep(.mermaid .node.process path),
.message-text :deep(.mermaid .node.process .basic),
.message-text :deep(.mermaid .node.process .label-container),
.message-text :deep(.mermaid .node.display rect),
.message-text :deep(.mermaid .node.display circle),
.message-text :deep(.mermaid .node.display ellipse),
.message-text :deep(.mermaid .node.display polygon),
.message-text :deep(.mermaid .node.display path),
.message-text :deep(.mermaid .node.display .basic),
.message-text :deep(.mermaid .node.display .label-container),
.message-text :deep(.mermaid .node.action rect),
.message-text :deep(.mermaid .node.action circle),
.message-text :deep(.mermaid .node.action ellipse),
.message-text :deep(.mermaid .node.action polygon),
.message-text :deep(.mermaid .node.action path),
.message-text :deep(.mermaid .node.action .basic),
.message-text :deep(.mermaid .node.action .label-container),
.message-text :deep(.mermaid .node.utility rect),
.message-text :deep(.mermaid .node.utility circle),
.message-text :deep(.mermaid .node.utility ellipse),
.message-text :deep(.mermaid .node.utility polygon),
.message-text :deep(.mermaid .node.utility path),
.message-text :deep(.mermaid .node.utility .basic),
.message-text :deep(.mermaid .node.utility .label-container) {
  stroke: var(--mermaid-node-stroke) !important; /* Force default neutral stroke */
  fill: var(--mermaid-node-fill) !important; /* Override any fill colors */
}

/* Override Mermaid's inline generated styles with maximum specificity */
.message-text :deep(.mermaid svg .trigger > *),
.message-text :deep(.mermaid svg .trigger span),
.message-text :deep(.mermaid svg .process > *),
.message-text :deep(.mermaid svg .process span),
.message-text :deep(.mermaid svg .display > *),
.message-text :deep(.mermaid svg .display span),
.message-text :deep(.mermaid svg .action > *),
.message-text :deep(.mermaid svg .action span) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--mermaid-node-stroke) !important;
}

/* Even more specific overrides for inline styles */
.message-text :deep(.mermaid svg g.node.trigger rect),
.message-text :deep(.mermaid svg g.node.process rect),
.message-text :deep(.mermaid svg g.node.display rect),
.message-text :deep(.mermaid svg g.node.action rect) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--mermaid-node-stroke) !important;
}

/* Ensure success nodes always override any other classes */
.message-text :deep(.mermaid .node.success rect),
.message-text :deep(.mermaid .node.success circle),
.message-text :deep(.mermaid .node.success ellipse),
.message-text :deep(.mermaid .node.success polygon),
.message-text :deep(.mermaid .node.success path),
.message-text :deep(.mermaid .node.success .basic),
.message-text :deep(.mermaid .node.success .label-container) {
  stroke: var(--color-green) !important;
}

/* Ensure warning nodes always override any other classes */
.message-text :deep(.mermaid .node.warning rect),
.message-text :deep(.mermaid .node.warning circle),
.message-text :deep(.mermaid .node.warning ellipse),
.message-text :deep(.mermaid .node.warning polygon),
.message-text :deep(.mermaid .node.warning path),
.message-text :deep(.mermaid .node.warning .basic),
.message-text :deep(.mermaid .node.warning .label-container) {
  stroke: var(--color-yellow) !important;
}

/* Ensure error nodes always override any other classes */
.message-text :deep(.mermaid .node.error rect),
.message-text :deep(.mermaid .node.error circle),
.message-text :deep(.mermaid .node.error ellipse),
.message-text :deep(.mermaid .node.error polygon),
.message-text :deep(.mermaid .node.error path),
.message-text :deep(.mermaid .node.error .basic),
.message-text :deep(.mermaid .node.error .label-container) {
  stroke: var(--color-red) !important;
}

/* Node labels */
.message-text :deep(.mermaid .nodeLabel) {
  color: var(--color-white) !important;
  fill: var(--color-white) !important;
}

rect.basic.label-container {
  transform: scale(0.75);
}

.message-text :deep(.mermaid .nodeLabel p) {
  transform: scale(0.75);
}

.message-text :deep(.mermaid .label foreignObject) {
  overflow: visible !important;
}

.message-text :deep(.mermaid .label div) {
  color: var(--color-white) !important;
  /* margin-top: -7px !important; */
}

/* Edges/Lines */
.message-text :deep(.mermaid .edge-pattern-solid),
.message-text :deep(.mermaid .edge-pattern-dotted),
.message-text :deep(.mermaid .edge-pattern-dashed),
.message-text :deep(.mermaid path.edge-path),
.message-text :deep(.mermaid .flowchart-link) {
  stroke: var(--mermaid-edge-color) !important;
  stroke-width: 2px !important;
  fill: none !important;
}

/* Arrow markers */
.message-text :deep(.mermaid marker path) {
  fill: var(--mermaid-edge-color) !important;
  stroke: var(--mermaid-edge-color) !important;
}

/* Edge labels */
.message-text :deep(.mermaid .edgeLabel) {
  background-color: var(--color-darker-1) !important;
  color: var(--color-white) !important;
}

.message-text :deep(.mermaid .edgeLabel p),
.message-text :deep(.mermaid .labelBkg) {
  white-space: nowrap;
  background: transparent !important;
}

.message-text :deep(.mermaid .nodeLabel p) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
  background: transparent !important;
}

.message-text :deep(.mermaid .node .nodeLabel p) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
}

.message-text :deep(.mermaid .edgeLabel rect) {
  fill: var(--color-darker-1) !important;
  stroke: none !important;
}

.message-text :deep(.mermaid .edgeLabel span),
.message-text :deep(.mermaid .edgeLabel div) {
  color: var(--color-white) !important;
}

/* Special diagram types */
.message-text :deep(.mermaid .actor),
.message-text :deep(.mermaid .task),
.message-text :deep(.mermaid .section) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--mermaid-node-stroke) !important;
  stroke-width: 3px !important;
}

/* Pie charts - Updated selectors based on actual DOM structure */
.message-text :deep(.mermaid .pieCircle) {
  stroke: var(--mermaid-node-stroke) !important;
  stroke-width: 3px !important;
}

.message-text :deep(.mermaid .pieTitleText) {
  fill: var(--color-white) !important;
}

/* Pie slice colors - Target ONLY pie chart path elements, exclude flowchart elements */
.message-text :deep(.mermaid svg path.pieCircle:nth-child(1):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #ff6b6b !important; /* Red */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(2):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #4ecdc4 !important; /* Teal */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(3):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #45b7d1 !important; /* Blue */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(4):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #96ceb4 !important; /* Green */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(5):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #feca57 !important; /* Yellow */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(6):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #ff9ff3 !important; /* Pink */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(7):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #54a0ff !important; /* Light Blue */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(8):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #5f27cd !important; /* Purple */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(9):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #00d2d3 !important; /* Cyan */
}

.message-text :deep(.mermaid svg path.pieCircle:nth-child(10):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #ff6348 !important; /* Orange */
}

/* More specific selectors for pie slices - exclude flowchart elements */
.message-text :deep(.mermaid svg g path:nth-of-type(1).pieCircle:not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #ff6b6b !important; /* Red */
}

.message-text :deep(.mermaid svg g path:nth-of-type(2).pieCircle:not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #4ecdc4 !important; /* Teal */
}

.message-text :deep(.mermaid svg g path:nth-of-type(3).pieCircle:not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #45b7d1 !important; /* Blue */
}

.message-text :deep(.mermaid svg g path:nth-of-type(4).pieCircle:not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #96ceb4 !important; /* Green */
}

.message-text :deep(.mermaid svg g path:nth-of-type(5).pieCircle:not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #feca57 !important; /* Yellow */
}

/* Legend colors to match slices exactly - Use the same colors as pie slices */
/* Target legend rectangles and apply the same colors as the corresponding pie slices */

/* First legend item - matches first pie slice */
.message-text :deep(.mermaid svg g.legend:nth-of-type(1) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(1) rect),
.message-text :deep(.mermaid svg g[transform*='translate(216,-44)'] rect) {
  fill: #ff6b6b !important; /* Red */
}

/* Second legend item - matches second pie slice */
.message-text :deep(.mermaid svg g.legend:nth-of-type(2) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(2) rect),
.message-text :deep(.mermaid svg g[transform*='translate(216,-22)'] rect) {
  fill: #4ecdc4 !important; /* Teal */
}

/* Third legend item - matches third pie slice */
.message-text :deep(.mermaid svg g.legend:nth-of-type(3) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(3) rect),
.message-text :deep(.mermaid svg g[transform*='translate(216,0)'] rect) {
  fill: #45b7d1 !important; /* Blue */
}

/* Fourth legend item - matches fourth pie slice */
.message-text :deep(.mermaid svg g.legend:nth-of-type(4) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(4) rect),
.message-text :deep(.mermaid svg g[transform*='translate(216,22)'] rect) {
  fill: #96ceb4 !important; /* Green */
}

/* Fifth legend item - matches fifth pie slice */
.message-text :deep(.mermaid svg g.legend:nth-of-type(5) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(5) rect),
.message-text :deep(.mermaid svg g[transform*='translate(216,44)'] rect) {
  fill: #feca57 !important; /* Yellow */
}

/* Additional legend items for larger pie charts */
.message-text :deep(.mermaid svg g.legend:nth-of-type(6) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(6) rect) {
  fill: #ff9ff3 !important; /* Pink */
}

.message-text :deep(.mermaid svg g.legend:nth-of-type(7) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(7) rect) {
  fill: #54a0ff !important; /* Light Blue */
}

.message-text :deep(.mermaid svg g.legend:nth-of-type(8) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(8) rect) {
  fill: #5f27cd !important; /* Purple */
}

.message-text :deep(.mermaid svg g.legend:nth-of-type(9) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(9) rect) {
  fill: #00d2d3 !important; /* Cyan */
}

.message-text :deep(.mermaid svg g.legend:nth-of-type(10) rect),
.message-text :deep(.mermaid svg g[class='legend']:nth-child(10) rect) {
  fill: #ff6348 !important; /* Orange */
}

/* Fallback: Apply colors to any legend rectangle based on position */
.message-text :deep(.mermaid svg g.legend rect) {
  fill: var(--color-text) !important; /* Default fallback */
}

/* Alternative approach - target by position in DOM, but exclude flowchart elements */
.message-text :deep(.mermaid svg g:nth-child(2) path:nth-child(2):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #ff6b6b !important; /* Red - first slice */
}

.message-text :deep(.mermaid svg g:nth-child(2) path:nth-child(3):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #4ecdc4 !important; /* Teal - second slice */
}

.message-text :deep(.mermaid svg g:nth-child(2) path:nth-child(4):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #45b7d1 !important; /* Blue - third slice */
}

.message-text :deep(.mermaid svg g:nth-child(2) path:nth-child(5):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #96ceb4 !important; /* Green - fourth slice */
}

.message-text :deep(.mermaid svg g:nth-child(2) path:nth-child(6):not(.flowchart-link):not(.edge-pattern-solid)) {
  fill: #feca57 !important; /* Yellow - fifth slice */
}

/* Legend text styling */
.message-text :deep(.mermaid svg g.legend text) {
  fill: var(--color-white) !important;
  font-size: 14px !important;
}

/* Pie chart percentage labels */
.message-text :deep(.mermaid .pieSectionText) {
  fill: var(--color-white) !important;
  font-size: 12px !important;
  font-weight: bold !important;
}

/* Additional fallback selectors for different Mermaid versions */
.message-text :deep(.mermaid .slice0) {
  fill: #ff6b6b !important;
}
.message-text :deep(.mermaid .slice1) {
  fill: #4ecdc4 !important;
}
.message-text :deep(.mermaid .slice2) {
  fill: #45b7d1 !important;
}
.message-text :deep(.mermaid .slice3) {
  fill: #96ceb4 !important;
}
.message-text :deep(.mermaid .slice4) {
  fill: #feca57 !important;
}
.message-text :deep(.mermaid .slice5) {
  fill: #ff9ff3 !important;
}
.message-text :deep(.mermaid .slice6) {
  fill: #54a0ff !important;
}
.message-text :deep(.mermaid .slice7) {
  fill: #5f27cd !important;
}
.message-text :deep(.mermaid .slice8) {
  fill: #00d2d3 !important;
}
.message-text :deep(.mermaid .slice9) {
  fill: #ff6348 !important;
}

/* Gantt charts */
.message-text :deep(.mermaid .grid .tick line) {
  stroke: var(--color-darker-2) !important;
}

.message-text :deep(.mermaid .grid .tick text) {
  fill: var(--color-white) !important;
}

/* Mindmap specific styles */
.message-text :deep(g.mindmap-edges .edge) {
  stroke-width: 2px !important;
  stroke: var(--mermaid-edge-color) !important;
}

.message-text :deep(.mermaid .mindmap-node) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--mermaid-node-stroke) !important;
  stroke-width: 3px !important;
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
/* .message-text :deep(pre code:not(.hljs):not(.language-mermaid)) {
  opacity: 0;
  transition: opacity 0.2s ease;
} */

.message-text :deep(pre code.hljs) {
  opacity: 1;
}

.message-text :deep(.mermaid) {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  padding: 16px 0;
  text-align: center;
  /* font-size: 1.2em; */
  min-width: 100%;
}

.message-text :deep(.mermaid svg) {
  width: 100% !important;
  height: auto !important;
  max-width: 100% !important;
  max-height: 500px !important; /* Limit maximum height */
  min-width: 100% !important;
}

/* Override Mermaid's inline styles */
.message-text :deep(.mermaid svg[style*='max-width']) {
  max-width: 100% !important;
  width: 100% !important;
}

/* Ensure Mermaid diagrams use full width */
.message-text :deep(.mermaid-chart) {
  width: 100% !important;
  max-width: 100% !important;
}

.message-text :deep(.mermaid-chart svg) {
  width: 100% !important;
  height: auto !important;
  max-width: 100% !important;
}

/* Ensure Mermaid diagrams use full width */
.message-text :deep(.mermaid-chart) {
  width: 100% !important;
  max-width: 100% !important;
}

.message-text :deep(.mermaid-chart svg) {
  width: 100% !important;
  height: auto !important;
  max-width: 100% !important;
}

.message-text :deep(.mermaid foreignObject) {
  overflow: visible !important;
}

.message-text :deep(.mermaid .nodeLabel) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
  font-size: var(--font-size-xs) !important;
}

/* Target foreignObject content specifically */
.message-text :deep(.mermaid foreignObject div) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
}

.message-text :deep(.mermaid foreignObject .nodeLabel) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
}

.message-text :deep(.mermaid foreignObject span) {
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
}

.message-text :deep(pre code.language-mermaid) {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  font-size: var(--font-size-sm) !important;
}

.message-text :deep(.mermaid-error-wrapper) {
  border: 3px solid var(--color-red) !important;
  border-radius: 8px;
  padding: 2px;
  margin: 16px 0;
}

.message-text :deep(.mermaid .node.error rect) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--color-red) !important;
}

.message-text :deep(.mermaid .node.warning rect) {
  fill: var(--mermaid-node-fill) !important;
  stroke: var(--color-yellow) !important;
}

.message-text :deep(.mermaid-error) {
  background-color: rgba(255, 107, 107, 0.1);
  border-radius: 6px;
  padding: 16px;
  text-align: left;
}

.message-text :deep(.mermaid-error .error-header) {
  color: var(--color-red) !important;
  font-weight: bold;
  margin-bottom: 8px;
}

.message-text :deep(.mermaid-error .error-message) {
  color: var(--color-red) !important;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  margin-bottom: 12px;
  white-space: pre-wrap;
}

.message-text :deep(.mermaid-error .error-details) {
  border-top: 1px solid rgba(255, 107, 107, 0.2);
  padding-top: 12px;
}

.message-text :deep(.mermaid-error .error-details summary) {
  cursor: pointer;
  color: var(--color-light-med-navy);
  font-weight: 500;
}

.message-text :deep(.mermaid-error .mermaid-code) {
  background-color: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 12px;
  margin-top: 8px;
  font-family: var(--font-family-mono);
  font-size: 0.8em;
  white-space: pre-wrap;
  overflow-x: auto;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5),
.message-text :deep(h6) {
  color: var(--color-white);
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
  color: var(--color-pink);
  border: 1px solid rgba(127, 129, 147, 0.1);
}

.message-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  font-size: 0.9em;
  border: 1px solid rgba(127, 129, 147, 0.15);
  border-radius: 6px;
  overflow: hidden;
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
  color: var(--color-white);
}

.message-text :deep(em),
.message-text :deep(i) {
  font-style: italic;
}

.message-wrapper.user .message-text {
  color: var(--color-white);
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
  background: rgb(0 0 0 / 10%);
  border-radius: 8px;
  border: 1px solid rgba(127, 129, 147, 0.1);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ref-image-action-btn:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.2);
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
  color: #ff6b6b;
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
  color: #ff6b6b;
}

.tool-running {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--color-med-navy);
}

.tool-running .spinner {
  width: 16px;
  height: 16px;
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
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);
}

.stop-async-tool-btn:hover {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
  transform: translateY(-1px);
}

.stop-async-tool-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);
}

.stop-async-tool-btn .stop-icon {
  font-size: 14px;
}

.stop-async-tool-btn .stop-text {
  font-weight: 600;
  letter-spacing: 0.3px;
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

/* HTML Code Action Buttons */
.message-text :deep(.html-code-actions) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.message-text :deep(.html-action-btn) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-text :deep(.html-action-btn:hover) {
  background: rgba(25, 239, 131, 0.2);
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
  background: white;
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
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.3);
}

.message-text :deep(.step-text) {
  flex: 1;
}

.message-text :deep(.step-text h3) {
  margin: 0 0 8px 0;
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-white);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.image-action-btn:hover {
  background: rgba(25, 239, 131, 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.2);
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
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.2);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
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
  background: rgba(25, 239, 131, 0.2);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-text :deep(.assistant-image-action-btn:hover) {
  background: rgba(25, 239, 131, 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.2);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.share-preview-btn:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.2);
  border-color: var(--color-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.2);
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
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.share-copy-btn:hover {
  background: rgba(25, 239, 131, 0.2);
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
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.3);
}

.share-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
