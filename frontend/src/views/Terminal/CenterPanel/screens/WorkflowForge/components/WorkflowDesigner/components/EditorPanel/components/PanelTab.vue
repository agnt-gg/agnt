<template>
  <div class="outer-tab-wrapper">
    <div class="inner-wrapper" v-if="activeTab === 'parameters'">
      <!-- Node content -->
      <template v-if="nodeContent">
        <!-- NODE INFORMATION -->
        <!-- NODE NAME -->
        <div class="form-group node-name">
          <label>Name</label>
          <input type="text" :value="nodeContent.text" @input="updateNodeName" spellcheck="false" @keydown="handleKeyDown($event, 'name')" />
        </div>
        <!-- NODE ID & TYPE-->
        <div class="form-row">
          <div class="form-group stretch node-id">
            <!-- <label>Id:</label> -->
            <div class="right-side">
              <Tooltip text="Click to copy" width="auto">
                <p class="static-value" @click="copyText(getNodeNameById(nodeContent.id), $event)">
                  {{ getNodeNameById(nodeContent.id) }}
                </p>
              </Tooltip>
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-group stretch node-type">
            <!-- <label>Type:</label> -->
            <div class="right-side">
              <SvgIcon v-if="nodeContent.icon && nodeContent.type !== 'label'" :name="nodeContent.icon" class="node-icon" />
              <p class="node-type">{{ nodeContent.type }}</p>
            </div>
          </div>
          <div v-if="authRequired" class="form-divider"></div>
          <div v-if="authRequired" class="form-group right-side fit-content node-connection-status">
            <button class="connection-status" :class="{ connected: isConnected }" @click="handleConnectionToggle">
              {{ isConnected ? 'Connected' : 'Connect' }}
            </button>
          </div>
        </div>

        <div class="hr"></div>

        <!-- NODE DESCRIPTION -->
        <div class="form-group node-description">
          <label>Description:</label>
          <p>{{ nodeContent.description }}</p>
          <!-- <p>
            <strong
              >Tool Docs: <a :href="`/docs/tools/${nodeContent.type}`" target="_blank">{{ nodeContent.type }}</a></strong
            >
          </p> -->
        </div>

        <div class="hr"></div>

        <!-- NODE PARAMETERS -->
        <div class="parameter-wrapper" v-if="nodeParameters && Object.keys(nodeParameters).length > 0">
          <h3 class="label">Input Parameters</h3>
          <div class="form-row wrap">
            <template v-for="(param, key) in nodeParameters" :key="key">
              <div
                :class="['form-group', getInputSize(key, param), { 'conditional-field': param && param.conditional }]"
                v-if="param && shouldShowParameter(key, param)"
              >
                <label>
                  {{ formatParameterLabel(key) }}
                  <Tooltip
                    v-if="param.conditional"
                    :text="`Shows when ${formatParameterLabel(param.conditional.field)} = ${
                      Array.isArray(param.conditional.value) ? param.conditional.value.join(' or ') : param.conditional.value
                    }`"
                    width="auto"
                  >
                    <span class="conditional-indicator">
                      <i class="fas fa-link"></i>
                    </span>
                  </Tooltip>
                  <Tooltip v-if="!isCustomTool || key === 'instructions'" :text="getInfoTitle(key, param)" width="auto">
                    <i class="fas fa-info-circle info-icon"></i>
                  </Tooltip>
                </label>
                <!-- IF CUSTOM FIELD IS INSTRUCTIONS -->
                <template v-if="isCustomTool && key === 'instructions'">
                  <textarea
                    :value="nodeContent.parameters[key]"
                    @input="updateParameter(key, $event.target.value)"
                    @focus="onTextareaFocus"
                    @blur="onTextareaBlur"
                    spellcheck="false"
                  ></textarea>
                </template>
                <!-- IF CUSTOM FIELD IS PROVIDER OR MODEL -->
                <template v-else-if="isCustomTool && (key === 'provider' || key === 'model')">
                  <select :value="getCustomParameterValue(key)" @input="updateCustomParameter(key, $event.target.value)">
                    <option value="">Select {{ key }}</option>
                    <option v-for="option in getOptionsForParameter(key)" :key="option" :value="option">
                      {{ option }}
                    </option>
                  </select>
                </template>
                <!-- IF CUSTOM FIELD IS INPUT -->
                <template v-else-if="isCustomTool && param && param.type === 'text'">
                  <input
                    :type="param.inputType || 'text'"
                    :value="getCustomParameterValue(key)"
                    @input="updateCustomParameter(key, $event.target.value)"
                    spellcheck="false"
                  />
                </template>
                <!-- IF CUSTOM FIELD IS TEXTAREA -->
                <template v-else-if="isCustomTool && param && param.type === 'textarea'">
                  <textarea
                    :value="getCustomParameterValue(key)"
                    @input="updateCustomParameter(key, $event.target.value)"
                    @focus="onTextareaFocus"
                    @blur="onTextareaBlur"
                    spellcheck="false"
                  ></textarea>
                </template>
                <!-- IF CUSTOM FIELD IS SELECT -->
                <template v-else-if="isCustomTool && param && param.type === 'select'">
                  <select :value="getCustomParameterValue(key)" @input="updateCustomParameter(key, $event.target.value)">
                    <option v-for="option in param.options" :key="option" :value="option">
                      {{ option }}
                    </option>
                  </select>
                </template>
                <!-- IF CUSTOM FIELD IS A FILE -->
                <template v-else-if="isCustomTool && param && (param.inputType || param.fieldType || param.type) === 'file'">
                  <div class="file-input-wrapper">
                    <div class="file-upload-header">
                      <label class="custom-file-upload">
                        <input type="file" :accept="param.accept" @change="handleFileUpload($event, key)" style="display: none" />
                        <span class="file-upload-button">
                          <i class="fas fa-upload"></i>
                          Upload File
                        </span>
                      </label>
                      <div v-if="getFileName(key)" class="file-text-display"><span>Uploaded File: </span>{{ getFileName(key) }}</div>
                    </div>
                    <div v-if="getFileContent(key) && isImageFile(key)" class="image-preview">
                      <img :src="getFileContent(key)" alt="Image preview" />
                    </div>
                    <div v-else-if="getFileContent(key)" class="file-content">
                      {{ getFileContent(key) }}
                    </div>
                  </div>
                </template>
                <!-- IF FIELD IS TIMER -->
                <template v-else-if="param.inputType === 'time'">
                  <input :id="key" type="time" :value="getParameterValue(key)" @input="updateParameter(key, $event.target.value)" />
                </template>
                <!-- IF FIELD IS MULTISELECT OR CHECKBOX WITH OPTIONS -->
                <template
                  v-else-if="
                    (param.inputType === 'multiselect' ||
                      param.inputType === 'checkbox' ||
                      param.type === 'checkbox' ||
                      param.fieldType === 'checkbox') &&
                    param.options &&
                    param.options.length > 0
                  "
                >
                  <div class="checkbox-group">
                    <div v-for="option in param.options" :key="option" class="checkbox-item">
                      <input
                        type="checkbox"
                        :id="`${key}-${option}`"
                        :value="option"
                        :checked="isOptionSelected(key, option)"
                        @change="updateMultiSelect(key, option, $event.target.checked)"
                      />
                      <label :for="`${key}-${option}`">{{ option }}</label>
                    </div>
                  </div>
                </template>
                <!-- IF FIELD IS SINGLE CHECKBOX (BOOLEAN) -->
                <template
                  v-else-if="
                    (param.inputType === 'checkbox' ||
                      param.type === 'checkbox' ||
                      param.fieldType === 'checkbox' ||
                      param.type === 'boolean' ||
                      param.fieldType === 'boolean') &&
                    (!param.options || param.options.length === 0)
                  "
                >
                  <div class="checkbox-item">
                    <input
                      type="checkbox"
                      :id="key"
                      :checked="getCustomParameterValue(key) === true || getCustomParameterValue(key) === 'true'"
                      @change="updateCustomParameter(key, $event.target.checked)"
                    />
                    <label :for="key">{{ param.label || formatParameterLabel(key) }}</label>
                  </div>
                </template>
                <!-- IF FIELD IS AGENT SELECT -->
                <template v-else-if="param.inputType === 'agent-select'">
                  <select :value="getParameterValue(key)" @input="updateParameter(key, $event.target.value)">
                    <option value="">Select Agent</option>
                    <option v-for="agent in availableAgents" :key="agent.id" :value="agent.id">
                      {{ agent.name }}
                    </option>
                  </select>
                </template>
                <!-- IF FIELD IS SELECT -->
                <template v-else-if="param.inputType === 'select'">
                  <select :value="getParameterValue(key)" @input="updateParameter(key, $event.target.value)">
                    <option value="">Select {{ formatParameterLabel(key) }}</option>
                    <template v-if="isAIProviderOrModelField(key)">
                      <option v-for="option in getOptionsForParameter(key)" :key="option" :value="option">
                        {{ option }}
                      </option>
                    </template>
                    <template v-else>
                      <option v-for="option in param.options" :key="option" :value="option">
                        {{ option }}
                      </option>
                    </template>
                  </select>
                </template>
                <!-- IF FIELD IS TEXTAREA -->
                <template v-else-if="(param.inputType || param.fieldType) === 'textarea'">
                  <textarea
                    :value="nodeContent.parameters[key] || param.default"
                    @input="updateParameter(key, $event.target.value)"
                    @focus="onTextareaFocus"
                    @blur="onTextareaBlur"
                    :ref="'textarea-' + key"
                    spellcheck="false"
                  ></textarea>
                </template>
                <!-- IF FIELD IS READONLY -->
                <template v-else-if="(param.inputType || param.fieldType) === 'readonly'">
                  <Tooltip text="Click to copy" width="auto">
                    <p class="static-value" @click="copyText(getReplacedValue(key, param.value), $event)">
                      {{ getReplacedValue(key, param.value) }}
                    </p>
                  </Tooltip>
                </template>
                <!-- IF FIELD IS A CODEAREA -->
                <template v-else-if="(param.inputType || param.fieldType) === 'codearea'">
                  <codemirror
                    :model-value="getSafeCodeMirrorValue(key)"
                    :style="{ height: '200px' }"
                    :indent-with-tab="true"
                    :tab-size="2"
                    :extensions="codeEditorExtensions"
                    @update:model-value="updateParameter(key, $event)"
                  />
                </template>
                <!-- IF FIELD IS OBJECT -->
                <template
                  v-else-if="nodeContent.parameters[key] && typeof nodeContent.parameters[key] === 'object' && !nodeContent.parameters[key].type"
                >
                  <textarea
                    :value="getParameterValue(key)"
                    @input="updateParameter(key, $event.target.value)"
                    spellcheck="false"
                    class="code-area"
                  ></textarea>
                </template>
                <!-- IF FIELD IS NUMBER, PASSWORD, OR TEXT -->
                <template
                  v-else-if="
                    param &&
                    (param.inputType === 'text' ||
                      param.inputType === 'number' ||
                      param.inputType === 'password' ||
                      param.type === 'string' ||
                      param.type === 'text' ||
                      param.type === 'number' ||
                      param.type === 'password' ||
                      param.fieldType === 'text' ||
                      param.fieldType === 'number' ||
                      param.fieldType === 'password')
                  "
                >
                  <input
                    :type="getInputType(param)"
                    :value="getCustomParameterValue(key)"
                    spellcheck="false"
                    @input="updateCustomParameter(key, $event.target.value)"
                  />
                </template>
                <template v-else-if="nodeContent.parameters[key] && nodeContent.parameters[key].type === 'input'">
                  <input
                    :type="nodeContent.parameters[key].inputType || 'text'"
                    :value="nodeContent.parameters[key].value"
                    spellcheck="false"
                    @input="
                      updateParameter(key, {
                        ...nodeContent.parameters[key],
                        value: $event.target.value,
                      })
                    "
                  />
                </template>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- Edge content -->
      <template v-if="edgeContent">
        <div class="edge-conditions-wrapper">
          <div v-for="(cond, index) in localEdgeContent.conditions" :key="index" class="condition-row">
            <!-- Logic toggle (AND/OR) for 2nd+ conditions -->
            <div v-if="index > 0" class="logic-toggle-row">
              <select :value="cond.logic" @change="updateConditionField(index, 'logic', $event.target.value)" class="logic-select">
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
              <div class="logic-line"></div>
            </div>
            <div class="condition-fields">
              <div class="condition-header">
                <span class="condition-label">Condition {{ index + 1 }}</span>
                <button
                  v-if="localEdgeContent.conditions.length > 1"
                  class="remove-condition-btn"
                  @click="removeCondition(index)"
                  title="Remove condition"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
              <div class="form-group">
                <label>If:</label>
                <input type="text" :value="cond.if" @input="updateConditionField(index, 'if', $event.target.value)" spellcheck="false" />
              </div>
              <div class="form-group">
                <label>Condition:</label>
                <select :value="cond.condition" @change="updateConditionField(index, 'condition', $event.target.value)">
                  <option value="true">True</option>
                  <option value="false">False</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does Not Contain</option>
                  <option value="equals">Equals</option>
                  <option value="not_equals">Not Equals</option>
                  <option value="greater_than">Greater Than</option>
                  <option value="less_than">Less Than</option>
                  <option value="greater_than_or_equal">Greater Than or Equal</option>
                  <option value="less_than_or_equal">Less Than or Equal</option>
                  <option value="is_empty">Is Empty</option>
                  <option value="is_not_empty">Is Not Empty</option>
                </select>
              </div>
              <div v-if="conditionNeedsValue(cond.condition)" class="form-group">
                <label>Value:</label>
                <input type="text" :value="cond.value" @input="updateConditionField(index, 'value', $event.target.value)" spellcheck="false" />
              </div>
            </div>
          </div>
          <button class="add-condition-btn" @click="addCondition"><i class="fas fa-plus"></i> Add Condition</button>
        </div>
        <div class="form-group">
          <label>Max Iterations:</label>
          <input type="text" v-model="localEdgeContent.maxIterations" @input="updateEdgeContent" spellcheck="false" min="1" />
        </div>
      </template>
    </div>
    <!-- Outputs -->
    <div class="outputs-tab" v-else-if="activeTab === 'outputs' && !edgeContent">
      <div class="outputs-wrapper" v-if="nodeOutputs">
        <div v-for="(output, key) in nodeOutputs" :key="key" class="form-group">
          <h4>
            {{ formatCamelCase(key) }}
          </h4>
          <div class="form-group">
            <label>Description:</label>
            <p>{{ output.description }}</p>
          </div>
          <div class="form-group">
            <label>Id:</label>
            <Tooltip text="Click to copy" width="auto">
              <p class="static-value" @click="copyText(`{{${getNodeNameById(nodeContent.id)}.${key}}}`, $event)">
                {{ getNodeNameById(nodeContent.id) }}.{{ key }}
              </p>
            </Tooltip>
          </div>
          <div class="form-group output-value">
            <div class="output-header">
              <label>Value:</label>
              <Tooltip v-if="isOutputTruncated(key)" text="Download full output" width="auto">
                <button @click="downloadOutput(key)" class="download-button">
                  <i class="fas fa-download"></i>
                  Download Full Output
                </button>
              </Tooltip>
            </div>
            <p v-if="hasOutputValue(key)">
              {{ getOutputValue(key) }}
            </p>
          </div>
          <div class="hr"></div>
        </div>
      </div>
    </div>
    <!-- Docs -->
    <div class="docs-tab" v-else-if="activeTab === 'docs' && !edgeContent">
      <div class="docs-wrapper">
        <div class="form-group">
          <!-- <h3>Tool Documentation</h3> -->
          <div class="tool-docs-content" v-html="renderedToolDocs"></div>
        </div>
      </div>
    </div>
    <div class="tooltip" ref="tooltip" :class="{ show: showTooltip }">
      {{ tooltipMessage }}
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref, onMounted, computed, defineAsyncComponent, shallowRef } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { API_CONFIG, AI_PROVIDERS_CONFIG, IMAP_EMAIL_DOMAIN } from '@/tt.config';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useProviderConnection } from '@/composables/useProviderConnection.js';

// Lazy-load CodeMirror and its dependencies only when codearea fields are present
const Codemirror = defineAsyncComponent(() => import('vue-codemirror').then((m) => m.Codemirror));

// Lazy-load CodeMirror extensions (cached at module level)
let _cmExtensions = null;
const loadCodeMirrorExtensions = async () => {
  if (!_cmExtensions) {
    const [{ javascript }, { python }, { oneDark }] = await Promise.all([
      import('@codemirror/lang-javascript'),
      import('@codemirror/lang-python'),
      import('@codemirror/theme-one-dark'),
    ]);
    _cmExtensions = { javascript, python, oneDark };
  }
  return _cmExtensions;
};

// Lazy-load showdown (cached at module level)
let _showdown = null;

export default {
  name: 'PanelTab',
  components: {
    SvgIcon,
    Codemirror,
    SimpleModal,
    Tooltip,
  },
  props: {
    nodeContent: Object,
    edgeContent: Object,
    activeTab: String,
    toolLibrary: Object,
    backendTools: Object, // Tools fetched from backend (includes plugins)
    nodes: Array,
    nodeOutput: Object,
    customTools: Array,
    workflowId: {
      type: String,
      default: null,
    },
  },
  emits: ['update:nodeContent', 'update:edgeContent'],
  data() {
    return {
      localEdgeContent: {
        conditions: [{ if: '', condition: 'true', value: '' }],
        maxIterations: 1,
      },
      showTooltip: false,
      tooltipMessage: '',
      toolDocsCache: {}, // Cache for loaded markdown docs
      converter: null, // Showdown converter instance
      availableAgents: [], // List of available agents
    };
  },
  setup(props) {
    const modal = ref(null);

    // Provider connection composable (fetches providers & connectedApps on mount)
    const { connectedApps, isProviderConnected, handleProviderToggle } = useProviderConnection(modal);

    const getProviderName = (nodeType) => {
      if (!nodeType) return '';
      for (const category in props.toolLibrary) {
        const node = props.toolLibrary[category].find((n) => n.type === nodeType);
        if (node && node.authProvider) {
          return node.authProvider;
        }
      }
      return '';
    };

    const currentProviderName = computed(() => getProviderName(props.nodeContent?.type));

    const isConnected = computed(() => {
      if (!props.nodeContent) return false;
      return isProviderConnected(currentProviderName.value);
    });

    const handleConnectionToggle = () => {
      const providerName = currentProviderName.value;
      if (providerName) {
        handleProviderToggle(providerName);
      }
    };

    const cmExtensions = shallowRef(null);

    onMounted(() => {
      loadCodeMirrorExtensions().then((ext) => {
        cmExtensions.value = ext;
      });
    });

    return {
      modal,
      isConnected,
      handleConnectionToggle,
      cmExtensions,
    };
  },
  computed: {
    nodeParameters() {
      if (this.nodeContent && this.nodeContent.type) {
        const nodeType = this.nodeContent.type;

        // First, check in toolLibrary (static import)
        for (const category in this.toolLibrary) {
          const node = this.toolLibrary[category].find((n) => n.type === nodeType);
          if (node) {
            // For standard tools, return parameters as is
            return node.parameters || {};
          }
        }

        // If not found in toolLibrary, check in backendTools (includes plugins)
        if (this.backendTools) {
          for (const category in this.backendTools) {
            if (Array.isArray(this.backendTools[category])) {
              const node = this.backendTools[category].find((n) => n.type === nodeType);
              if (node) {
                console.log(`🔌 PanelTab - Found node parameters for ${nodeType} in backendTools (category: ${category})`);
                return node.parameters || {};
              }
            }
          }
        }

        // If not found in toolLibrary or backendTools, check in customTools
        const customTool = this.customTools.find((tool) => tool.type === nodeType);
        if (customTool) {
          // For custom tools, set the description in the nodeContent
          if (!this.nodeContent.description) {
            this.$emit('update:nodeContent', {
              ...this.nodeContent,
              description: 'This is a custom tool created by the user in the Tool Forge.',
            });
          }

          // For custom tools, adjust the parameters to include field type
          const adjustedParameters = {};
          for (const [key, value] of Object.entries(customTool.parameters)) {
            adjustedParameters[key] = {
              ...value,
              fieldType: value.type, // Add fieldType based on the custom tool's type
              // CRITICAL: Preserve conditional property if it exists
              ...(value.conditional && { conditional: value.conditional }),
            };
          }
          return adjustedParameters;
        }
      }
      return null;
    },
    nodeOutputs() {
      if (this.nodeContent && this.nodeContent.type) {
        const nodeType = this.nodeContent.type;

        // Check in toolLibrary (static import)
        for (const category in this.toolLibrary) {
          const node = this.toolLibrary[category].find((n) => n.type === nodeType);
          if (node) {
            return node.outputs;
          }
        }

        // If not found in toolLibrary, check in backendTools (includes plugins)
        if (this.backendTools) {
          for (const category in this.backendTools) {
            if (Array.isArray(this.backendTools[category])) {
              const node = this.backendTools[category].find((n) => n.type === nodeType);
              if (node) {
                console.log(`🔌 PanelTab - Found node outputs for ${nodeType} in backendTools (category: ${category})`);
                return node.outputs;
              }
            }
          }
        }

        // Check in customTools
        const customTool = this.customTools.find((tool) => tool.type === nodeType);
        if (customTool) {
          return customTool.outputs;
        }
      }
      return null;
    },
    isNode() {
      return this.nodeContent && !this.edgeContent;
    },
    isCustomTool() {
      return this.nodeContent && this.nodeContent.category === 'custom';
    },
    codeEditorExtensions() {
      if (!this.cmExtensions) return [];
      const { javascript, python, oneDark } = this.cmExtensions;
      const languageExtension = this.isPythonNode ? python() : javascript();
      return [languageExtension, oneDark];
    },
    isPythonNode() {
      // Implement your logic to determine if the current node is a Python node
      return this.nodeContent?.type === 'execute-python';
    },
    isAILLMOrCustomTool() {
      return this.isCustomTool || this.nodeContent?.type === 'generate-with-ai-llm' || this.nodeContent?.type === 'agnt-api';
    },
    // I THINK THIS MAY NEED TO BE A CLOUD FEATURE? TOO MUCH REMOTE API STUFF NEEDS TO HAPPEN
    webhookUrl() {
      if (this.nodeContent && this.nodeContent.type === 'webhook-receiver' && this.workflowId) {
        return `${API_CONFIG.BASE_URL}/webhook/${this.workflowId}`; // IF USING LOCAL SERVER
        // return `${API_CONFIG.REMOTE_URL}/webhook/${this.workflowId}`; // IF USING REMOTE CLOUD SERVER
      }
      return null;
    },
    authRequired() {
      console.log('authRequired computed property called');
      console.log('nodeContent:', this.nodeContent);
      if (this.nodeContent && this.nodeContent.type) {
        const nodeType = this.nodeContent.type;
        for (const category in this.toolLibrary) {
          const node = this.toolLibrary[category].find((n) => n.type === nodeType);
          if (node) {
            console.log('authRequired for node:', node.authRequired);
            return node.authRequired;
          }
        }
      }
      console.log('authRequired returning null');
      return null;
    },
    renderedToolDocs() {
      if (!this.nodeContent || !this.nodeContent.type) {
        return '<p>No documentation available for this tool.</p>';
      }

      const toolType = this.nodeContent.type;
      if (this.toolDocsCache[toolType]) {
        return this.toolDocsCache[toolType];
      }

      // Load the docs dynamically
      this.loadToolDocs(toolType);
      return '<p>Loading documentation...</p>';
    },
  },
  async mounted() {
    // Lazy-load showdown and initialize converter
    if (!_showdown) {
      const mod = await import('showdown');
      _showdown = mod.default;
    }
    this.converter = new _showdown.Converter({
      tables: true,
      tasklists: true,
      strikethrough: true,
      ghCodeBlocks: true,
      smoothLivePreview: true,
      simpleLineBreaks: true,
      parseImgDimensions: true,
      emoji: true,
    });

    // Load pdf.js from CDN
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.worker.min.js';
    };
    document.head.appendChild(script);

    // Fetch available agents
    await this.fetchAvailableAgents();

    // If this is an AI LLM node or custom tool with a provider already selected, fetch models
    if (this.isAILLMOrCustomTool && this.nodeContent && this.nodeContent.parameters) {
      const provider = this.getCustomParameterValue('provider');
      if (provider) {
        console.log(`Node mounted with provider ${provider}, fetching models...`);
        await this.fetchModelsForProvider(provider);
      }
    }
  },
  methods: {
    isOptionSelected(key, option) {
      const currentValue = this.getParameterValue(key);
      return Array.isArray(currentValue) && currentValue.includes(option);
    },
    updateMultiSelect(key, option, isChecked) {
      let currentValue = this.getParameterValue(key) || [];
      if (!Array.isArray(currentValue)) {
        currentValue = [];
      }

      if (isChecked && !currentValue.includes(option)) {
        currentValue.push(option);
      } else if (!isChecked) {
        currentValue = currentValue.filter((item) => item !== option);
      }

      this.updateParameter(key, currentValue);
    },
    capitalizeOption(option) {
      return option
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    },
    handleFileUpload(event, key) {
      console.log('File upload triggered');
      const file = event.target.files[0];
      if (file) {
        console.log('File type:', file.type);
        console.log('File name:', file.name);
        console.log('File size:', file.size, 'bytes');

        const reader = new FileReader();
        reader.onload = (e) => {
          if (file.type.startsWith('image/')) {
            // For images, convert to base64
            const base64 = e.target.result;
            this.updateParameter(key, {
              filename: file.name,
              type: file.type,
              text: base64,
            });
          } else if (file.type === 'application/pdf') {
            const typedArray = new Uint8Array(e.target.result);
            window.pdfjsLib
              .getDocument(typedArray)
              .promise.then((pdf) => {
                let fullText = '';
                const processPage = (pageNum) => {
                  pdf.getPage(pageNum).then((page) => {
                    page.getTextContent().then((content) => {
                      const pageText = content.items.map((item) => item.str).join(' ');
                      fullText += pageText + '\n';
                      if (pageNum < pdf.numPages) {
                        processPage(pageNum + 1);
                      } else {
                        this.updateParameter(key, {
                          filename: file.name,
                          type: file.type,
                          text: fullText,
                        });
                      }
                    });
                  });
                };
                processPage(1);
              })
              .catch((error) => {
                console.error('Error parsing PDF:', error);
                this.updateParameter(key, {
                  filename: file.name,
                  type: file.type,
                  text: 'Error parsing PDF. Please try a different file.',
                });
              });
          } else {
            // For other file types, keep as is
            const content = e.target.result;
            this.updateParameter(key, {
              filename: file.name,
              type: file.type,
              text: content,
            });
          }
        };

        if (file.type.startsWith('image/')) {
          reader.readAsDataURL(file); // This will give us the base64 string
        } else if (file.type === 'application/pdf') {
          reader.readAsArrayBuffer(file);
        } else {
          reader.readAsText(file);
        }
      }
    },
    isImageFile(key) {
      if (this.nodeContent && this.nodeContent.parameters && this.nodeContent.parameters[key]) {
        return this.nodeContent.parameters[key].type.startsWith('image/');
      }
      return false;
    },
    getFileName(key) {
      if (this.nodeContent && this.nodeContent.parameters && this.nodeContent.parameters[key]) {
        return this.nodeContent.parameters[key].filename || '';
      }
      return '';
    },
    getFileContent(key) {
      if (this.nodeContent && this.nodeContent.parameters && this.nodeContent.parameters[key]) {
        const param = this.nodeContent.parameters[key];

        // For base64 images, don't return the full string - it's already displayed in img tag
        if (param.type && param.type.startsWith('image/') && param.text) {
          return null; // Image is displayed via img tag, no need to show base64
        }

        // For other files, truncate if too large
        let content = param.text || (param.data ? atob(param.data) : '');

        // Truncate large content to prevent UI lockup
        const MAX_DISPLAY_LENGTH = 5000;
        if (content.length > MAX_DISPLAY_LENGTH) {
          const start = content.substring(0, 2000);
          const end = content.substring(content.length - 1000);
          return `${start}\n\n... [${(content.length - 3000).toLocaleString()} characters truncated] ...\n\n${end}`;
        }

        return content;
      }
      return '';
    },
    updateFileContent(key, value) {
      if (this.nodeContent.parameters[key]) {
        this.nodeContent.parameters[key].text = value;
        this.$emit('update:nodeContent', { ...this.nodeContent });
        this.$nextTick(() => {
          const textarea = this.$refs['textarea-' + key];
          if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight - 12 + 'px';
          }
        });
      }
    },
    getInfoTitle(key, param) {
      if (this.isCustomTool && key === 'template-instructions') {
        return 'These are the default instructions set by the creator of this custom tool in the Tool Forge.';
      }
      return param.description || '';
    },
    updateNodeContent() {
      if (this.nodeContent) {
        this.$emit('update:nodeContent', {
          ...this.nodeContent,
          text: this.nodeContent.text,
          type: this.nodeContent.type,
          description: this.nodeContent.description,
          parameters: this.nodeContent.parameters || {},
          output: this.nodeContent.output,
          error: this.nodeContent.error,
        });
      }
    },
    handleKeyDown(event, field) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.updateNodeContent();
      }
    },
    updateNodeName(event) {
      if (this.nodeContent) {
        this.nodeContent.text = event.target.value;
        this.updateNodeContent();
      }
    },
    updateType(event) {
      if (this.nodeContent) {
        this.nodeContent.type = event.target.value;
        this.updateNodeContent();
      }
    },
    getInputComponent(inputType) {
      switch (inputType) {
        case 'textarea':
          return 'textarea';
        case 'select':
          return 'select';
        default:
          return 'input';
      }
    },
    getInputProps(param) {
      const props = {
        type: param.inputType === 'number' ? 'number' : 'text',
      };

      if (param.inputType === 'select' && param.options) {
        props.options = param.options;
      }

      return props;
    },
    getParameterValue(key) {
      // ⚠️ CRITICAL: This method is ONLY for UI DISPLAY purposes
      // The actual data in nodeContent.parameters[key] is NEVER truncated or modified
      // Full data (including large base64, audio, video, etc.) is preserved for workflow execution
      // This truncation only affects what users SEE in the editor panel, not what nodes RECEIVE
      if (
        this.nodeContent &&
        this.nodeContent.parameters &&
        this.nodeContent.parameters[key] !== undefined &&
        this.nodeContent.parameters[key] !== null
      ) {
        const value = this.nodeContent.parameters[key];

        // Handle file objects with base64 data - don't stringify large base64
        if (typeof value === 'object' && value.type && value.text) {
          const sizeKB = (value.text.length / 1024).toFixed(1);
          const sizeMB = (value.text.length / 1024 / 1024).toFixed(2);
          const displaySize = value.text.length > 1024 * 1024 ? `${sizeMB}MB` : `${sizeKB}KB`;

          // For images, return a placeholder
          if (value.type.startsWith('image/')) {
            return `[Image: ${value.filename || 'uploaded image'} - ${displaySize}]`;
          }
          // For videos, return a placeholder
          if (value.type.startsWith('video/')) {
            return `[Video: ${value.filename || 'uploaded video'} - ${displaySize}]`;
          }
          // For audio, return a placeholder
          if (value.type.startsWith('audio/')) {
            return `[Audio: ${value.filename || 'uploaded audio'} - ${displaySize}]`;
          }
          // For other files with large content, return metadata only
          if (value.text.length > 1000) {
            return `[File: ${value.filename || 'uploaded file'} - ${value.type} - ${displaySize}]`;
          }
        }

        // Handle objects that aren't arrays
        if (typeof value === 'object' && !Array.isArray(value)) {
          try {
            const stringified = JSON.stringify(value, null, 2);
            // Truncate very large JSON strings
            if (stringified.length > 5000) {
              return stringified.substring(0, 5000) + '\n... [truncated]';
            }
            return stringified;
          } catch (e) {
            console.warn('Failed to stringify parameter value:', value);
            return '';
          }
        }

        // If the value has a 'value' property that contains template variables
        if (value && typeof value === 'object' && value.value && typeof value.value === 'string') {
          return this.getReplacedValue(key, value.value);
        }

        // If the value itself is a string that contains template variables
        if (typeof value === 'string') {
          // Truncate very long strings (like base64)
          const replaced = this.getReplacedValue(key, value);
          if (replaced.length > 5000) {
            return replaced.substring(0, 2000) + '\n... [truncated] ...\n' + replaced.substring(replaced.length - 1000);
          }
          return replaced;
        }

        // Convert other types to string
        if (value !== null && value !== undefined) {
          return String(value);
        }
      }
      return '';
    },
    getSafeCodeMirrorValue(key) {
      try {
        const value = this.getParameterValue(key);
        // Ensure we always return a string for CodeMirror
        return typeof value === 'string' ? value : '';
      } catch (error) {
        console.warn('Error getting CodeMirror value for key:', key, error);
        return '';
      }
    },
    getReplacedValue(key, value) {
      // Replace common template variables
      value = value.replace('{{WORKFLOWID}}', this.workflowId || '');
      value = value.replace('{{FRONTEND_URL}}', API_CONFIG.FRONTEND_URL);
      value = value.replace('{{BASE_URL}}', API_CONFIG.BASE_URL);
      value = value.replace('{{REMOTE_URL}}', API_CONFIG.REMOTE_URL);
      value = value.replace('{{WEBHOOK_URL}}', API_CONFIG.WEBHOOK_URL);

      // Handle email-specific replacements
      if (this.nodeContent.type === 'receive-email' && key === 'emailAddress') {
        const imapUserDomain = IMAP_EMAIL_DOMAIN.BASE_DOMAIN;
        value = value.replace('{{IMAP_EMAIL_DOMAIN}}', imapUserDomain);
      }

      return value;
    },

    onTextareaFocus(event) {
      const textarea = event.target;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight - 12 + 'px';
    },
    onTextareaBlur(event) {
      const textarea = event.target;
      textarea.style.height = 'auto';
    },
    updateParameter(key, value) {
      console.log('Updating parameter:', key, value);
      if (this.nodeContent) {
        if (!this.nodeContent.parameters) {
          this.nodeContent.parameters = {};
        }

        this.nodeContent.parameters[key] = value;

        // Auto-select the first available model when the provider changes
        if (key === 'provider') {
          const models = this.getOptionsForParameter('model');
          if (models.length > 0) {
            this.updateParameter('model', models[0]);
          }
        }

        this.$emit('update:nodeContent', { ...this.nodeContent });

        // Force re-computation of nodeParameters
        this.$forceUpdate();
      }
    },
    getInputType(param) {
      if ((param.inputType || param.fieldType) === 'number') {
        return 'number';
      } else if ((param.inputType || param.fieldType) === 'password') {
        return 'password';
      } else {
        return 'text';
      }
    },
    getOutputValue(key) {
      // IMPORTANT: This method only affects UI DISPLAY, not the actual stored data
      // The full data in nodeOutput[key] remains intact for workflow variables
      if (this.nodeOutput && this.nodeOutput[key] !== undefined) {
        const value = this.nodeOutput[key];

        if (typeof value === 'object') {
          try {
            const stringified = JSON.stringify(value, null, 2);
            // Truncate very large output to prevent UI lockup
            if (stringified.length > 10000) {
              return (
                stringified.substring(0, 5000) +
                '\n\n... [Output truncated - too large to display] ...\n\n' +
                stringified.substring(stringified.length - 2000)
              );
            }
            return stringified;
          } catch (e) {
            return '[Error: Could not display output]';
          }
        }

        // Truncate very long strings
        const stringValue = String(value);
        if (stringValue.length > 10000) {
          return (
            stringValue.substring(0, 5000) +
            '\n\n... [Output truncated - too large to display] ...\n\n' +
            stringValue.substring(stringValue.length - 2000)
          );
        }

        return stringValue;
      }
      return '';
    },
    isOutputTruncated(key) {
      if (!this.nodeOutput || this.nodeOutput[key] === undefined) {
        return false;
      }

      const value = this.nodeOutput[key];

      if (typeof value === 'object') {
        try {
          const stringified = JSON.stringify(value, null, 2);
          return stringified.length > 10000;
        } catch (e) {
          return false;
        }
      }

      const stringValue = String(value);
      return stringValue.length > 10000;
    },
    downloadOutput(key) {
      if (!this.nodeOutput || this.nodeOutput[key] === undefined) {
        return;
      }

      const value = this.nodeOutput[key];
      let content;
      let filename;
      let mimeType;

      if (typeof value === 'object') {
        content = JSON.stringify(value, null, 2);
        filename = `${this.getNodeNameById(this.nodeContent.id)}_${key}_output.json`;
        mimeType = 'application/json';
      } else {
        content = String(value);
        filename = `${this.getNodeNameById(this.nodeContent.id)}_${key}_output.txt`;
        mimeType = 'text/plain';
      }

      // Create blob and download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up blob URL
      setTimeout(() => URL.revokeObjectURL(url), 100);

      this.showTooltipMessage('Download started!', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
    },
    updateEdgeContent() {
      this.$emit('update:edgeContent', { ...this.localEdgeContent });
    },
    conditionNeedsValue(condition) {
      return [
        'equals',
        'not_equals',
        'contains',
        'not_contains',
        'greater_than',
        'less_than',
        'greater_than_or_equal',
        'less_than_or_equal',
      ].includes(condition);
    },
    updateConditionField(index, field, value) {
      this.localEdgeContent.conditions[index][field] = value;
      this.updateEdgeContent();
    },
    addCondition() {
      this.localEdgeContent.conditions.push({ logic: 'and', if: '', condition: 'true', value: '' });
      this.updateEdgeContent();
    },
    removeCondition(index) {
      this.localEdgeContent.conditions.splice(index, 1);
      // If we removed the first item, strip the logic field from the new first item
      if (index === 0 && this.localEdgeContent.conditions.length > 0) {
        delete this.localEdgeContent.conditions[0].logic;
      }
      this.updateEdgeContent();
    },
    formatCamelCase(str) {
      const formattedStr = str.replace(/([A-Z])/g, ' $1').trim();
      return formattedStr.replace(/\b\w/g, (c) => c.toUpperCase());
    },
    async copyText(text, event) {
      try {
        await navigator.clipboard.writeText(text);
        this.showTooltipMessage('Copied to clipboard!', event);
      } catch (err) {
        console.error('Failed to copy: ', err);
        this.showTooltipMessage('Failed to copy', event);
      }
    },

    showTooltipMessage(message, event) {
      this.tooltipMessage = message;
      this.showTooltip = true;

      // Position the tooltip near the cursor
      if (event) {
        const tooltip = this.$refs.tooltip;
        tooltip.style.left = `${event.clientX + 10}px`;
        tooltip.style.top = `${event.clientY + 10}px`;
      }

      setTimeout(() => {
        this.showTooltip = false;
      }, 1000);
    },
    getNodeNameById(id) {
      if (!this.nodes) return id;
      const node = this.nodes.find((node) => node.id === id);
      if (!node) return id;
      return this.toCamelCase(node.text);
    },
    toCamelCase(str) {
      return str.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => (index === 0 ? word.toLowerCase() : word.toUpperCase())).replace(/\s+/g, '');
    },
    convertNameToId(nameParam) {
      const [name, param] = nameParam.split('.');
      if (!this.nodes) return nameParam;
      const node = this.nodes.find((node) => this.toCamelCase(node.text) === name);
      return node ? `${node.id}.${param}` : nameParam;
    },
    isJsonString(str) {
      try {
        JSON.parse(str);
      } catch (e) {
        return false;
      }
      return true;
    },
    hasOutputValue(key) {
      return this.nodeOutput && this.nodeOutput[key] !== undefined && this.nodeOutput[key] !== null && this.nodeOutput[key] !== '';
    },
    shouldShowParameter(key, param, visited = new Set()) {
      if (!param || !param.conditional) return true;

      const { field, value, and } = param.conditional;

      // Prevent infinite recursion from circular references or self-references
      if (field === key || visited.has(field)) {
        return true; // If circular reference detected, show the parameter
      }

      // First, check if the parent field itself should be shown
      // This recursively validates the entire conditional chain
      const parentParam = this.nodeParameters?.[field];
      if (parentParam) {
        // Add current key to visited set before recursing
        const newVisited = new Set(visited);
        newVisited.add(key);
        if (!this.shouldShowParameter(field, parentParam, newVisited)) {
          return false;
        }
      }

      // Get the current value - handle both object format {value: "x"} and direct values
      let currentValue = this.nodeContent?.parameters?.[field];

      // For custom tools, parameters are stored as objects with a 'value' property
      if (currentValue && typeof currentValue === 'object' && 'value' in currentValue) {
        currentValue = currentValue.value;
      }

      // If the parent field has no value yet, hide conditional fields by default
      if (currentValue === undefined || currentValue === null || currentValue === '') return false;

      // Check primary condition
      const primaryConditionMet = Array.isArray(value) ? value.includes(currentValue) : currentValue === value;

      if (!primaryConditionMet) return false;

      // Check AND condition if it exists
      if (and) {
        let andValue = this.nodeContent?.parameters?.[and.field];

        // Handle object format for custom tools
        if (andValue && typeof andValue === 'object' && 'value' in andValue) {
          andValue = andValue.value;
        }

        // If the AND field has no value yet, hide the parameter
        if (andValue === undefined || andValue === null || andValue === '') return false;

        // Check if AND condition is met
        const andConditionMet = Array.isArray(and.value) ? and.value.includes(andValue) : andValue === and.value;

        return andConditionMet;
      }

      return true;
    },
    formatParameterLabel(key) {
      if (key === 'instructions') return 'Instructions';
      return this.formatCamelCase(key);
    },
    getInputSize(key, param) {
      if (this.isCustomTool && (key === 'provider' || key === 'model')) {
        return 'half';
      }
      return param?.inputSize || '';
    },
    isAIProviderOrModelField(key) {
      return this.isAILLMOrCustomTool && (key === 'provider' || key === 'model');
    },
    getOptionsForParameter(key) {
      // First, check if the current node has options defined in its parameters
      if (this.nodeParameters && this.nodeParameters[key] && this.nodeParameters[key].options) {
        return this.nodeParameters[key].options;
      }

      // Fall back to AI provider logic for standard AI tools
      if (key === 'provider') {
        return this.$store.getters['aiProvider/filteredProviders'];
      } else if (key === 'model') {
        const provider = this.getCustomParameterValue('provider');
        const models = this.$store.state.aiProvider.allModels[provider] || [];

        // If no models are loaded yet, trigger fetch
        if (models.length === 0 && provider) {
          this.fetchModelsForProvider(provider);
        }

        return models;
      }
      return [];
    },
    async fetchModelsForProvider(provider) {
      const fetchActions = {
        Anthropic: 'aiProvider/fetchAnthropicModels',
        Cerebras: 'aiProvider/fetchCerebrasModels',
        'Claude-Code': 'aiProvider/fetchClaudeCodeModels',
        DeepSeek: 'aiProvider/fetchDeepSeekModels',
        Gemini: 'aiProvider/fetchGeminiModels',
        GrokAI: 'aiProvider/fetchGrokAIModels',
        Groq: 'aiProvider/fetchGroqModels',
        Kimi: 'aiProvider/fetchKimiModels',
        Local: 'aiProvider/fetchLocalModels',
        Minimax: 'aiProvider/fetchMinimaxModels',
        OpenAI: 'aiProvider/fetchOpenAIModels',
        'OpenAI-Codex': 'aiProvider/fetchOpenAICodexModels',
        'OpenAI-Codex-CLI': 'aiProvider/fetchOpenAICodexCliModels',
        OpenRouter: 'aiProvider/fetchOpenRouterModels',
        TogetherAI: 'aiProvider/fetchTogetherAIModels',
        ZAI: 'aiProvider/fetchZAIModels',
      };

      const action = fetchActions[provider];
      if (action) {
        try {
          await this.$store.dispatch(action);
        } catch (error) {
          console.error(`Failed to fetch ${provider} models:`, error);
        }
      }
    },
    getCustomParameterValue(key) {
      if (this.nodeContent && this.nodeContent.parameters && this.nodeContent.parameters[key]) {
        const param = this.nodeContent.parameters[key];
        if (typeof param === 'object' && param !== null) {
          return param.value || '';
        }
        return param || '';
      }
      return '';
    },
    async updateCustomParameter(key, value) {
      if (this.nodeContent && this.nodeContent.parameters) {
        if (typeof this.nodeContent.parameters[key] === 'object' && this.nodeContent.parameters[key] !== null) {
          this.nodeContent.parameters[key].value = value;
        } else {
          this.nodeContent.parameters[key] = value;
        }

        // Auto-fetch models for all providers when the provider changes
        if (key === 'provider') {
          console.log(`Fetching ${value} models...`);
          await this.fetchModelsForProvider(value);

          const models = this.getOptionsForParameter('model');
          if (models.length > 0) {
            this.updateCustomParameter('model', models[0]);
          }
        }

        this.$emit('update:nodeContent', { ...this.nodeContent });

        this.$nextTick(() => {
          const textarea = this.$refs['textarea-' + key];
          if (textarea && textarea.scrollHeight > textarea.clientHeight) {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight - 12 + 'px';
          }
        });
      }
    },
    async loadToolDocs(toolType) {
      try {
        // Dynamically import the markdown file for this tool type
        // Path is relative to frontend/src/views/Docs/docfiles/tools/
        const module = await import(`../../../../../../../../../Docs/docfiles/tools/${toolType}.md?raw`);
        const markdownContent = module.default;

        // Convert markdown to HTML
        const htmlContent = this.converter.makeHtml(markdownContent);

        // Cache the result
        this.toolDocsCache[toolType] = htmlContent;

        // Force re-computation of renderedToolDocs
        this.$forceUpdate();
      } catch (error) {
        console.warn(`Could not load documentation for tool: ${toolType}`, error);
        // Fallback to a simple message
        const fallbackContent = `<p>Documentation for <strong>${toolType}</strong> is not available.</p>`;
        this.toolDocsCache[toolType] = fallbackContent;
        this.$forceUpdate();
      }
    },
    async fetchAvailableAgents() {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.warn('No authentication token found, cannot fetch agents');
          return;
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/agents`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        this.availableAgents = data.agents || [];
        console.log('Available agents loaded:', this.availableAgents);
      } catch (error) {
        console.error('Error fetching available agents:', error);
        this.availableAgents = [];
      }
    },
  },
  watch: {
    edgeContent: {
      handler(newEdgeContent) {
        if (!newEdgeContent) return;
        const local = { ...newEdgeContent };
        // Migrate legacy format: if edge has if/condition/value but no conditions array
        if (!local.conditions || !Array.isArray(local.conditions) || local.conditions.length === 0) {
          if (local.if || (local.condition && local.condition !== 'true')) {
            local.conditions = [{ if: local.if || '', condition: local.condition || 'true', value: local.value || '' }];
          } else {
            local.conditions = [{ if: '', condition: 'true', value: '' }];
          }
        }
        this.localEdgeContent = local;
      },
      immediate: true,
      deep: true,
    },
    'nodeContent.parameters.operation': {
      handler() {
        this.$forceUpdate();
      },
      deep: true,
    },
    customTools: {
      handler(newCustomTools) {
        console.log('Custom tools updated in PanelTab:', newCustomTools);
      },
      deep: true,
    },
    nodeContent: {
      handler(newNodeContent, oldNodeContent) {
        // Handle nodeContent changes that might affect CodeMirror
        if (newNodeContent && oldNodeContent) {
          // Check if parameters have changed in a way that might affect CodeMirror
          const newParams = newNodeContent.parameters || {};
          const oldParams = oldNodeContent.parameters || {};

          // Force update if parameters structure has changed
          if (JSON.stringify(newParams) !== JSON.stringify(oldParams)) {
            this.$nextTick(() => {
              this.$forceUpdate();
            });
          }
        }
      },
      deep: true,
    },
  },
};
</script>

<style scoped>
.outer-tab-wrapper {
  width: 100%;
}

.inner-wrapper {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
  width: 100%;
  gap: 8px;
}

.form-group select {
  height: 32px;
  padding: 3px 3px 1px;
  font-family: var(--font-family-primary);
  font-size: var(--base-font-size);
  color: var(--color-navy);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  background-color: var(--color-dull-white);
}

.form-group select option {
  padding: 8px 4px;
}

.form-group.stretch.output-value {
  /* width: 100%; */
  overflow: hidden;
  justify-content: space-between;
}

.form-group.output-value .output-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 12px;
}

.form-group.output-value label {
  width: fit-content;
  align-self: flex-start;
}

.form-group.output-value p {
  overflow: scroll;
  white-space: pre-wrap;
}

.download-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 2px;
  background-color: var(--color-green);
  color: var(--color-dull-navy);
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.download-button:hover {
  background-color: var(--color-light-green);
  transform: translateY(-1px);
}

.download-button i {
  font-size: 11px;
}

body.dark .download-button {
  background-color: var(--color-green);
  color: var(--color-ultra-dark-navy);
}

body.dark .download-button:hover {
  background-color: var(--color-light-green);
}

.code,
.output {
  width: 100%;
}

.right-side {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.info-icon {
  font-size: 12px;
  margin-left: 4px;
  cursor: help;
  opacity: 0.5;
}

.right-side .info-icon {
  margin-left: 0px;
}

.parameter-wrapper,
.outputs-wrapper {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.hr {
  width: 100%;
  border-bottom: 1px solid #ddd;
}

.form-divider {
  width: 1px;
  height: 24px;
  border-right: 1px solid #ddd;
}

.form-row {
  display: flex;
  flex-direction: row;
  /* flex-wrap: nowrap; */
  flex-wrap: wrap;
  align-content: center;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.form-row.wrap {
  flex-wrap: wrap;
}

.form-group.stretch {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  width: fit-content;
}

.form-group.stretch p {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  text-wrap: wrap;
  /* width: 100%; */
}

.form-group.node-description {
  gap: 8px;
}

.form-group.half {
  width: calc(50% - 8px);
}

p.static-value {
  width: fit-content;
  padding: 8px 8px 6px;
  color: var(--color-text);
  background: var(--color-lighter-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  line-height: 125%;
  cursor: pointer;
}

textarea.code-area {
  font-family: var(--font-family-mono);
  font-size: 14px;
  overflow-x: scroll;
  white-space: nowrap;
}

body.dark p.static-value {
  color: var(--color-text);
  border: 1px solid var(--color-lighter-0);
}

p.static-value:hover {
  color: var(--color-primary) !important;
}

.form-group.output-value p {
  margin-top: 0;
  font-family: var(--font-family-mono);
  padding: 6px 8px;
  border: 1px solid var(--color-light-navy);
  /* border-color: limegreen; */
  border-radius: 8px;
  background: var(--color-bright-light-navy);
  text-wrap: pretty;
}

.controls-panel.right-panel-component label {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

body.dark .hr {
  border-bottom: 1px solid var(--color-dull-navy);
}

body.dark .form-divider {
  border-right: 1px solid var(--color-dull-navy);
}

body.dark .form-group.output-value p {
  padding: 8px;
  border: 1px solid var(--color-lighter-0);
  background: var(--color-darker-1);
  /* border-color: limegreen; */
}

/* CODEMIRROR */
:deep(.cm-editor) {
  height: 100%;
  width: calc(100% - 2px);
  font-family: var(--font-family-mono);
  font-size: 14px;
}

:deep(.cm-scroller) {
  overflow: auto;
}

.file-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.custom-file-upload {
  display: inline-block;
  cursor: pointer;
  width: fit-content;
}

.file-upload-header {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.file-upload-button {
  display: inline-block;
  padding: 6px 12px 4px;
  background-color: var(--color-light-navy);
  color: var(--color-dull-white);
  border-radius: 4px;
  font-size: 14px;
  transition: background-color 0.3s ease;
}

.file-upload-button:hover {
  background-color: var(--color-navy);
}

.file-upload-button i {
  margin-right: 8px;
}

.file-text-display {
  font-size: 16px;
  color: var(--color-navy);
  margin-top: 4px;
  margin-right: 2px;
}

.file-content {
  max-height: 160px;
  overflow: scroll;
}

body.dark .file-upload-button {
  background-color: var(--color-dull-navy);
  color: var(--color-dull-white);
}

body.dark .file-upload-button:hover {
  background-color: var(--color-med-navy);
}

body.dark .file-text-display {
  color: var(--color-dull-white);
  font-weight: 300;
}

body.dark .file-text-display span {
  color: var(--color-med-navy);
  font-weight: 400;
}

.fit-content {
  width: fit-content;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkbox-item {
  display: flex;
  align-items: center;
}

.checkbox-item input[type='checkbox'] {
  margin-right: 8px;
  margin-top: 0;
}

.checkbox-item label {
  width: fit-content;
}

/* Conditional Field Styles */
.form-group.conditional-field {
  border-left: 2px solid var(--color-primary);
  padding: 8px 0 8px 16px;
  width: calc(100% - 16px);
  border-radius: 8px;
}

.form-group.half.conditional-field {
  width: calc(50% - 32px);
}

.conditional-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  padding: 2px 6px;
  /* background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color); */
  border-radius: 4px;
  font-size: 0.75em;
  /* color: var(--color-text-muted); */
  cursor: help;
  transition: all 0.2s ease;
  opacity: 0.6;
}

/* .conditional-indicator:hover {
  background: rgba(var(--color-primary-rgb, 25, 239, 131), 0.2);
  border-color: rgba(var(--color-primary-rgb, 25, 239, 131), 0.5);
  color: var(--color-text);
} */

.conditional-indicator i {
  font-size: 1em;
}

/* Compound Edge Conditions */
.edge-conditions-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
}

.condition-row {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.condition-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}

.condition-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.condition-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.remove-condition-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  transition: all 0.2s ease;
}

.remove-condition-btn:hover {
  color: var(--color-red);
  background: rgba(254, 78, 78, 0.1);
}

.logic-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.logic-select {
  width: auto !important;
  min-width: 70px;
  height: 28px !important;
  padding: 2px 4px 0 !important;
  font-size: 12px !important;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 6px !important;
  background-color: var(--color-green) !important;
  color: var(--color-ultra-dark-navy) !important;
  border: none !important;
  cursor: pointer;
}

.logic-line {
  flex: 1;
  height: 1px;
  background: var(--terminal-border-color);
}

.add-condition-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px 6px;
  margin-top: 8px;
  background: transparent;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-family: var(--font-family-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-condition-btn:hover {
  border-color: var(--color-green);
  color: var(--color-green);
  background: rgba(34, 197, 94, 0.05);
}

.add-condition-btn i {
  font-size: 11px;
}

body.dark .condition-fields {
  background: var(--color-darker-1);
  border-color: var(--color-lighter-0);
}

body.dark .logic-select {
  background-color: var(--color-green) !important;
  color: var(--color-ultra-dark-navy) !important;
}

.tooltip {
  position: fixed;
  background-color: var(--color-med-navy);
  color: var(--color-dull-white);
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 14px;
  pointer-events: none;
  opacity: 0;
  z-index: 1000;
  transition: opacity 0.1s ease-in-out;
}

body.dark .tooltip {
  background-color: var(--color-dull-navy);
  color: var(--color-white);
}

.tooltip.show {
  opacity: 0.75;
}

/* Tool docs content styling */
.tool-docs-content {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  font-family: var(--font-family-primary);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  word-wrap: break-word;
  color: var(--color-text);
  max-width: 100%;
  /* padding: 8px 0; */
  gap: 8px;
}

.tool-docs-content h1,
.tool-docs-content h2,
.tool-docs-content h3,
.tool-docs-content h4,
.tool-docs-content h5,
.tool-docs-content h6 {
  margin-top: 32px;
  margin-bottom: 16px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-green);
  letter-spacing: -0.025em;
}

.tool-docs-content h1 {
  font-size: 1.8em;
  border-bottom: 2px solid var(--color-green);
  padding-bottom: 0.5em;
  margin-top: 0;
  margin-bottom: 24px;
}

.tool-docs-content h2 {
  font-size: 1.4em;
  border-bottom: 1px solid var(--color-light-navy);
  padding-bottom: 0.4em;
}

.tool-docs-content h3 {
  font-size: 1.2em;
  color: var(--color-primary);
  margin-top: 28px;
}

.tool-docs-content h4 {
  font-size: 1.1em;
  color: var(--color-primary);
  font-weight: 600;
}

.tool-docs-content h5,
.tool-docs-content h6 {
  font-size: 1em;
  color: var(--color-primary);
  font-weight: 600;
}

.tool-docs-content p {
  margin-bottom: 16px;
  text-align: justify;
  hyphens: auto;
}

.tool-docs-content ul,
.tool-docs-content ol {
  padding-left: 1.5em;
  margin-bottom: 20px;
  margin-top: 8px;
}

.tool-docs-content li {
  margin-bottom: 8px;
  padding-left: 4px;
}

.tool-docs-content li p {
  margin-bottom: 8px;
}

.tool-docs-content code {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.1), rgba(var(--primary-rgb), 0.05));
  border: 1px solid rgba(var(--primary-rgb), 0.2);
  border-radius: 4px;
  padding: 0.15em 0.4em;
  color: var(--color-primary);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.tool-docs-content pre {
  background: linear-gradient(135deg, var(--color-darker-0), rgba(26, 32, 44, 0.95));
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 20px;
  overflow-x: auto;
  margin: 20px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  position: relative;
}

.tool-docs-content pre::before {
  content: '';
  position: absolute;
  top: 12px;
  left: 12px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ff5f56;
  box-shadow:
    20px 0 0 #ffbd2e,
    40px 0 0 #27ca3f;
}

.tool-docs-content pre code {
  background: none;
  padding: 0;
  color: var(--color-light-green);
  font-size: 0.9em;
  line-height: 1.5;
  border: none;
  box-shadow: none;
}

.tool-docs-content blockquote {
  border-left: 4px solid var(--color-green);
  padding: 16px 20px;
  margin: 24px 0;
  background: linear-gradient(90deg, rgba(34, 197, 94, 0.05), transparent);
  border-radius: 0 8px 8px 0;
  color: var(--color-light-green);
  font-style: italic;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.1);
}

:deep(.tool-docs-content p) {
  margin-bottom: 8px;
}

:deep(.tool-docs-content code) {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 4px 8px;
  font-size: var(--font-size-xs);
}

.tool-docs-content blockquote::before {
  content: '"';
  position: absolute;
  top: -8px;
  left: 8px;
  font-size: 3em;
  color: var(--color-green);
  opacity: 0.3;
  font-family: var(--font-family-primary);
}

.tool-docs-content table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  margin: 24px 0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.tool-docs-content th,
.tool-docs-content td {
  border: 1px solid var(--color-light-navy);
  padding: 12px 16px;
  text-align: left;
  vertical-align: top;
}

.tool-docs-content th {
  background: linear-gradient(135deg, var(--color-dull-white), rgba(248, 250, 252, 0.8));
  font-weight: 700;
  color: var(--color-navy);
  text-transform: uppercase;
  font-size: 0.85em;
  letter-spacing: 0.05em;
}

.tool-docs-content tbody tr:nth-child(even) {
  background: rgba(248, 250, 252, 0.3);
}

.tool-docs-content tbody tr:hover {
  background: rgba(34, 197, 94, 0.05);
  transition: background-color 0.2s ease;
}

.tool-docs-content a {
  color: var(--color-green);
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s ease;
}

.tool-docs-content a:hover {
  border-bottom-color: var(--color-green);
  text-decoration: none;
}

.tool-docs-content strong {
  font-weight: 700;
  color: var(--color-primary);
}

.tool-docs-content em {
  font-style: italic;
  color: var(--color-light-green);
}

/* Enhanced dark mode styles */
body.dark .tool-docs-content {
  color: var(--color-light-green);
}

body.dark .tool-docs-content h1,
body.dark .tool-docs-content h2,
body.dark .tool-docs-content h3,
body.dark .tool-docs-content h4,
body.dark .tool-docs-content h5,
body.dark .tool-docs-content h6 {
  color: var(--color-green);
}

body.dark .tool-docs-content code {
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.15), rgba(var(--primary-rgb), 0.08));
  border-color: rgba(var(--primary-rgb), 0.3);
  color: #ffb3d9;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

body.dark .tool-docs-content pre {
  background: linear-gradient(135deg, var(--color-ultra-dark-navy), rgba(26, 32, 44, 0.95));
  border-color: var(--color-dull-navy);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

body.dark .tool-docs-content pre code {
  color: var(--color-light-green);
}

body.dark .tool-docs-content blockquote {
  border-left-color: var(--color-green);
  background: linear-gradient(90deg, rgba(34, 197, 94, 0.08), transparent);
  color: var(--color-light-green);
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.15);
}

body.dark .tool-docs-content table {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

body.dark .tool-docs-content th {
  background: linear-gradient(135deg, var(--color-ultra-dark-navy), rgba(45, 55, 72, 0.8));
  color: var(--color-light-green);
  border-color: var(--color-dull-navy);
}

body.dark .tool-docs-content th,
body.dark .tool-docs-content td {
  border-color: var(--color-dull-navy);
}

body.dark .tool-docs-content tbody tr:nth-child(even) {
  background: rgba(45, 55, 72, 0.3);
}

body.dark .tool-docs-content tbody tr:hover {
  background: rgba(34, 197, 94, 0.08);
}

body.dark .tool-docs-content strong {
  color: var(--color-primary);
}

body.dark .tool-docs-content em {
  color: var(--color-light-green);
}
</style>

<style>
body.dark .right-side .node-icon svg path[stroke] {
  stroke: var(--color-med-navy) !important;
}

body.dark .right-side .node-icon svg path[fill] {
  fill: var(--color-med-navy) !important;
}

body.dark .right-side .node-icon svg rect[stroke] {
  stroke: var(--color-med-navy) !important;
}

body.dark .right-side .node-icon svg rect[fill] {
  fill: var(--color-med-navy) !important;
}

/* CODEMIRROR */
.cm-editor {
  background: var(--color-darker-0) !important;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  font-weight: 300;
  cursor: text;
}

.ͼo .cm-gutters {
  /* display: none !important; */
  background-color: transparent;
  color: var(--color-light-navy);
  margin-left: 4px;
  border: none;
}

.ͼ1 .cm-foldGutter span {
  opacity: 0;
}

.cm-content {
  margin-left: -6px !important;
  padding: 12px 6px !important;
  padding-left: 0 !important;
}

.ͼo .cm-cursor,
.ͼo .cm-dropCursor {
  border-left-color: var(--color-primary) !important;
}

.cm-activeLine .cm-line {
  caret-color: var(--color-primary) !important;
}

.cm-focused {
  border: 2px solid var(--color-primary) !important;
}

.cm-activeLine {
  background: transparent !important;
  border-left-color: var(--color-primary) !important;
}

.cm-content {
  color: var(--color-primary);
  font-weight: 600;
}

.ͼt {
  color: var(--color-dull-white);
  font-weight: 300;
}

.ͼp {
  color: var(--color-blue);
  font-weight: 300;
}

.ͼq {
  color: var(--color-dull-white);
  font-weight: 300;
}

.ͼr {
  color: #ffd97d;
  font-weight: 300;
}

.ͼ13 {
  color: var(--color-primary);
  font-weight: 600;
}

.ͼu {
  color: var(--color-green);
  font-weight: 300;
}

.ͼv {
  /* color: #19EF83; */
  color: var(--color-dull-white);
}

.ͼw {
  color: #7d8799;
  opacity: 0.85;
}

.cm-focused {
  border: 1px solid var(--color-primary) !important;
}

.ͼo .cm-gutters {
  color: #3e405a85;
}

.ͼo .cm-activeLineGutter {
  background-color: #3e405a50;
}

.ͼo.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,
.ͼo .cm-selectionBackground,
.ͼo .cm-content ::selection {
  background-color: #3e405a50;
}

body.dark .ͼo .cm-activeLineGutter {
  background-color: var(--color-dark-navy) !important;
}

body.dark .ͼo.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,
body.dark .ͼo .cm-selectionBackground,
body.dark .ͼo .cm-content ::selection {
  background-color: var(--color-lighter-0) !important;
}

body.dark .ͼo.cm-focused .cm-matchingBracket,
body.dark .ͼo.cm-focused .cm-nonmatchingBracket {
  background-color: var(--color-dull-navy) !important;
}

/* body.dark .cm-editor {
  background: var(--color-darker-1) !important;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-light-navy);
} */

.controls-panel .connection-status {
  width: fit-content;
  padding: 8px 12px 6px;
  border-radius: 8px;
  border: none;
  font-weight: 500;
  font-family: inherit;
  line-height: 125%;
  background-color: var(--color-red);
  color: white;
  cursor: pointer;
  transition:
    background-color 0.2s ease-in-out,
    filter 0.2s ease-in-out;
  text-wrap-mode: nowrap;
}

.controls-panel .connection-status:hover {
  filter: brightness(1.15);
}

.controls-panel .connection-status.connected {
  background-color: var(--color-green);
  color: var(--color-dull-navy);
}
</style>
