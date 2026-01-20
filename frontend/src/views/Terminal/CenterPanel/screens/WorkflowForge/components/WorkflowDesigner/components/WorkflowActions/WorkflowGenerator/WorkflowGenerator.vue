<template>
  <div>
    <Tooltip text="Generate Workflow with AI" width="auto" position="bottom">
      <button id="workflow-magic-button" @click="workflowGenerator">
        <i class="fas fa-magic"></i>
      </button>
    </Tooltip>
    <!-- Added: SimpleModal instance for modal dialogs -->
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import generateUUID from '@/views/_utils/generateUUID.js';
import store from '@/store/state';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue'; // Added: import the modal
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowGenerator',
  components: {
    SimpleModal, // Added: register the modal component
    Tooltip,
  },
  computed: {
    ...mapGetters('userAuth', ['userName', 'userEmail']),
  },
  methods: {
    async showAlert(message, options = {}) {
      await this.$refs.modal.showModal({ message, showCancel: false, ...options });
    },
    async showPrompt(title, message, defaultValue = '', options = {}) {
      const result = await this.$refs.modal.showModal({
        title,
        message,
        isPrompt: true,
        isTextArea: options.isTextArea || false,
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: options.confirmText || 'Save',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
      return result === null ? null : result || defaultValue;
    },
    async showConfirm(title, message, options = {}) {
      return await this.$refs.modal.showModal({
        title,
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || '',
        cancelClass: options.cancelClass || '',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
    },
    async workflowGenerator() {
      // Use modal for workflow description (with textarea)
      const templateOverview = await this.showPrompt('Generate Workflow with AI', 'Please describe what the workflow should do:', '', {
        isTextArea: true,
        confirmText: 'Generate',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
      });
      if (!templateOverview) return;

      // Get user's basic info from the store
      const userInfo = this.userName && this.userEmail ? `User: ${this.userName} (Email: ${this.userEmail})` : 'Anonymous user';

      // Add user info to the template overview
      const fullTemplateOverview = `${userInfo}\n\nWorkflow description: ${templateOverview}`;

      console.log(fullTemplateOverview);

      // Use modal for including custom tools confirmation
      const includeCustomToolsResp = await this.showConfirm('Custom Tools', 'Do you want to include your custom tools in the workflow generation?', {
        isPrompt: false,
        confirmText: 'Yes',
        cancelText: 'No',
      });
      const includeCustomTools = includeCustomToolsResp ? true : false;

      // Use modal for including current workflow confirmation
      const includeCurrentWorkflowResp = await this.showConfirm(
        'Current Workflow',
        'Do you want to include your current workflow in the new generation?',
        {
          isPrompt: false,
          confirmText: 'Yes',
          cancelText: 'No',
        }
      );
      const includeCurrentWorkflow = includeCurrentWorkflowResp ? true : false;

      let currentWorkflow = null;
      if (includeCurrentWorkflow) {
        try {
          currentWorkflow = JSON.parse(localStorage.getItem('canvasState'));
        } catch (error) {
          console.error('Error parsing current workflow from localStorage:', error);
        }
      }

      try {
        const generatedTemplateData = await this.generateWorkflowViaAI(fullTemplateOverview, includeCustomTools, currentWorkflow);
        const normalized = this.removeMarkdownJson(generatedTemplateData.trim());
        const parsedData = JSON.parse(normalized);

        // Debug:
        console.log('[DEBUG] Checking workflow name:', parsedData.name);

        // If there's no name, or it's still "My Workflow," prompt for one using modal
        if (!parsedData.name || parsedData.name === 'My Workflow') {
          console.log('[DEBUG] Prompting user for a workflow name...');

          const newName = await this.showPrompt('Workflow Name', 'Give a name for your new workflow:', parsedData.name || 'My Workflow', {
            isTextArea: false,
            placeholder: 'Enter workflow name',
            defaultValue: parsedData.name || 'My Workflow',
          });
          if (newName) parsedData.name = newName;
        }

        const newWorkflowId = generateUUID();
        parsedData.id = newWorkflowId;
        localStorage.setItem('activeWorkflow', newWorkflowId);

        // Don't save to localStorage directly - let the parent component handle it with safe storage
        // The parent component will handle localStorage saving with IndexedDB references

        // Emit existing events
        this.$emit('workflow-generated', parsedData);
        this.$emit('update-active-workflow-id', newWorkflowId);

        // Ask parent to silently save (this will use the safe storage system)
        this.$emit('workflow-save-requested-silent');

        // Use modal for success alert instead of native alert
        await this.showAlert('Your AI-generated workflow has been created and is ready!', {
          confirmText: 'OK',
          confirmClass: 'btn-primary',
        });

        window.dispatchEvent(new Event('workflow-generator-complete'));
      } catch (error) {
        console.error('Error generating workflow:', error);
        await this.showAlert(error.message || 'We encountered an issue while creating your workflow. Please try again.', {
          confirmText: 'OK',
        });
      }
    },
    async generateWorkflowViaAI(templateOverview, includeCustomTools, currentWorkflow) {
      // Fetch available tools dynamically from backend (includes plugins)
      const availableTools = await this.fetchAvailableTools();

      const workflowElements = {
        overview: `[WORKFLOW OVERVIEW FROM USER]:\n${templateOverview}`,
        availableTools: `**** The system is guaranteed to fail if you use any tool types outside of the below list:
        [AVAILABLE TOOLS]:
        ${JSON.stringify(availableTools)}`,
        customTools: includeCustomTools ? await this.fetchCustomTools() : null,
        currentWorkflow: currentWorkflow ? `[CURRENT WORKFLOW]:\n${JSON.stringify(currentWorkflow)}` : null,
        instruction: `[NEW WORKFLOW OBJECT USING ONLY AVAILABLE TOOLS${includeCustomTools ? ' AND CUSTOM TOOLS' : ''}]:`,
      };

      try {
        this.showGeneratingModal();
        const authToken = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/stream/generate-workflow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            ...workflowElements,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw {
            message: errorData.error,
            provider: errorData.provider,
            type: errorData.type,
          };
        }

        const data = await response.json();
        return data.workflow;
      } catch (error) {
        console.error('Error:', error);
        throw error; // Pass the full error object up
      } finally {
        this.hideGeneratingModal();
      }
    },
    async fetchAvailableTools() {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/tools/workflow-tools`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const tools = await response.json();
        console.log('🔧 WorkflowGenerator: Fetched workflow tools from backend:', {
          triggers: tools.triggers?.length || 0,
          actions: tools.actions?.length || 0,
          utilities: tools.utilities?.length || 0,
          widgets: tools.widgets?.length || 0,
          controls: tools.controls?.length || 0,
          custom: tools.custom?.length || 0,
        });

        return tools; // Returns { triggers: [...], actions: [...], utilities: [...], etc. }
      } catch (error) {
        console.error('Error fetching workflow tools from backend:', error);
        // Return empty structure if backend fails
        return {
          triggers: [],
          actions: [],
          utilities: [],
          widgets: [],
          controls: [],
          custom: [],
        };
      }
    },
    async fetchCustomTools() {
      const userId = store.state.userAuth.user?.id;
      if (!userId) {
        console.log('No user ID found in store, skipping fetch');
        return [];
      }

      try {
        const token = localStorage.getItem('token');
        console.log('Fetching custom tools for user:', userId);
        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-tools`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Fetched custom tools:', data);

        // Check if the response has a 'tools' property
        const tools = data.tools || data;

        if (!Array.isArray(tools)) {
          console.error('Unexpected response format:', data);
          return [];
        }

        return tools.map((tool) => ({
          ...tool,
          category: 'custom',
        }));
      } catch (error) {
        console.error('Error fetching custom tools:', error);
        return [];
      }
    },
    removeMarkdownJson(str) {
      // Remove ```json and ``` markers
      const withoutMarkdown = str.replace(/```json|```/g, '');
      // Remove newlines and extra whitespace
      return withoutMarkdown.replace(/\s+/g, ' ').trim();
    },
    showGeneratingModal() {
      document.getElementById('generating-modal').style.display = 'flex';
    },
    hideGeneratingModal() {
      document.getElementById('generating-modal').style.display = 'none';
    },
    escapeJsonString(str) {
      return str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    },
  },
  mounted() {},
};
</script>

<style scoped>
button {
  padding: 10px;
  border: 1px solid rgba(1, 5, 42, 0.25);
  color: var(--Dark-Navy, #01052a);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s ease;
  cursor: pointer;
  opacity: 1;
}

button:hover {
  cursor: pointer !important;
  opacity: 0.6;
}

i {
  font-size: 16px;
  cursor: pointer !important;
}
</style>
