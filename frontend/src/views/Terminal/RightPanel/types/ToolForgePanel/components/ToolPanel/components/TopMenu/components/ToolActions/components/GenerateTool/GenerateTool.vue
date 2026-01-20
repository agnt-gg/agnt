<template>
  <div>
    <Tooltip text="Make Tool Template with AI" width="auto">
      <button
        id="magic-template"
        class="icon"
        tabindex="0"
        @click="toolGenerator"
        :disabled="isGenerating"
      >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M4.99859 2.74254L6.90313 3.80908L5.83659 1.90454L6.90313 0L4.99859 1.06654L3.09405 0L4.16059 1.90454L3.09405 3.80908L4.99859 2.74254ZM14.1404 10.2083L12.2358 9.14179L13.3024 11.0463L12.2358 12.9509L14.1404 11.8843L16.0449 12.9509L14.9784 11.0463L16.0449 9.14179L14.1404 10.2083ZM16.0449 0L14.1404 1.06654L12.2358 0L13.3024 1.90454L12.2358 3.80908L14.1404 2.74254L16.0449 3.80908L14.9784 1.90454L16.0449 0ZM10.2323 4.03001C10.1618 3.95938 10.0781 3.90335 9.98591 3.86513C9.89375 3.8269 9.79496 3.80722 9.69519 3.80722C9.59541 3.80722 9.49662 3.8269 9.40446 3.86513C9.3123 3.90335 9.22858 3.95938 9.15811 4.03001L0.26771 12.9204C0.197087 12.9909 0.141058 13.0746 0.102829 13.1668C0.0645996 13.2589 0.0449219 13.3577 0.0449219 13.4575C0.0449219 13.5573 0.0645996 13.6561 0.102829 13.7482C0.141058 13.8404 0.197087 13.9241 0.26771 13.9946L2.05036 15.7772C2.34747 16.0743 2.82741 16.0743 3.12452 15.7772L12.0073 6.89444C12.0779 6.82396 12.134 6.74024 12.1722 6.64808C12.2104 6.55592 12.2301 6.45713 12.2301 6.35736C12.2301 6.25758 12.2104 6.15879 12.1722 6.06663C12.134 5.97447 12.0779 5.89075 12.0073 5.82028L10.2323 4.03001ZM9.4476 8.21238L7.83255 6.59733L9.69138 4.7385L11.3064 6.35355L9.4476 8.21238Z"
          fill="#01052A"
          fill-opacity="0.75"
        />
      </svg>
      </button>
    </Tooltip>
    <SimpleModal ref="modal" />
    <div
      id="generating-tool-modal"
      class="modal"
      style="display: none; user-select: none"
    >
      <div class="modal-content">
        <p>Generating Tool, Please Wait...</p>
      </div>
    </div>
  </div>
</template>

<script>
import { inject, ref } from "vue";
import store from "@/store/state";
import { API_CONFIG } from "@/tt.config.js";
import SimpleModal from "@/views/_components/common/SimpleModal.vue";
import Tooltip from "@/views/Terminal/_components/Tooltip.vue";

export default {
  name: "ToolGenerator",
  components: {
    SimpleModal,
    Tooltip,
  },
  setup() {
    const { onToolGenerated } = inject("toolActions");
    const isGenerating = ref(false);
    const modal = ref(null);

    return {
      onToolGenerated,
      isGenerating,
      modal,
    };
  },
  methods: {
    async showAlert(message, options = {}) {
      await this.$refs.modal.showModal({ message, showCancel: false, ...options });
    },
    async showPrompt(title, message, defaultValue = "", options = {}) {
      const result = await this.$refs.modal.showModal({
        title,
        message,
        isPrompt: true,
        isTextArea: options.isTextArea || false,
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: options.confirmText || "Save",
        cancelText: options.cancelText || "Cancel",
        confirmClass: options.confirmClass || "btn-primary",
        cancelClass: options.cancelClass || "btn-secondary",
        showCancel: options.showCancel !== undefined ? options.showCancel : true
      });
      return result === null ? null : (result || defaultValue);
    },
    async toolGenerator() {
      const selectedProvider = store.state.aiProvider.selectedProvider;
      const selectedModel = store.state.aiProvider.selectedModel;
      console.log("Selected Provider:", selectedProvider);
      console.log("Selected Model:", selectedModel);

      const templateOverview = await this.promptUserForOverview();
      if (!templateOverview) return;

      try {
        this.isGenerating = true;
        this.showGeneratingModal();

        const generatedTemplateData = await this.generateTemplateViaApi(
          templateOverview,
          selectedProvider,
          selectedModel
        );
        console.log("Generated Tool Template:", generatedTemplateData);
        this.handleGenerationSuccess(generatedTemplateData);
      } catch (error) {
        this.handleGenerationError(error);
      } finally {
        this.isGenerating = false;
        this.hideGeneratingModal();
      }
    },
    async promptUserForOverview() {
      return await this.showPrompt(
        "Generate Tool Template with AI",
        "Please provide an overview of what the template should do:",
        "",
        {
          isTextArea: true,
          placeholder: "Enter tool overview",
          confirmText: "Generate",
          cancelText: "Cancel",
          confirmClass: "btn-primary",
          cancelClass: "btn-secondary"
        }
      );
    },
    async generateTemplateViaApi(templateOverview, provider, model) {
      const authToken = localStorage.getItem("token");
      const response = await fetch(`${API_CONFIG.BASE_URL}/stream/generate-tool`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ templateOverview, provider, model }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      const data = await response.json();
      return data.template;
    },
    async handleGenerationSuccess(generatedTemplateData) {
      const parsedData = JSON.parse(generatedTemplateData);
      console.log("Generated tool data:", parsedData);
      this.onToolGenerated(parsedData);
      await this.showAlert("Magic Template has been generated and populated successfully!", { showCancel: false });
    },
    async handleGenerationError(error) {
      console.error("Error generating magic template:", error);
      await this.showAlert(error.message || "Failed to generate magic template. Please try again.", { showCancel: false });
    },
    showGeneratingModal() {
      const modal = document.getElementById("generating-tool-modal");
      if (modal) modal.style.display = "flex";
    },
    hideGeneratingModal() {
      const modal = document.getElementById("generating-tool-modal");
      if (modal) modal.style.display = "none";
    },
  },
};
</script>

<style scoped>
.generating-indicator {
  position: absolute;
  top: 100%;
  left: 25%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 0.8em;
  color: #666;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
}

.modal-content {
  background: var(--color-dark-navy, #01052a);
  color: var(--color-light-green, #9fef00);
  padding: 20px 40px;
  border-radius: 8px;
  border: 1px solid var(--color-green, #19ef83);
  text-align: center;
}

body.light .modal-content {
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
}

.modal-content p {
  margin: 0;
  font-size: 1.1em;
}
</style>