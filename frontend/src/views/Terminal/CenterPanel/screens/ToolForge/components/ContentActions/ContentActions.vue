<template>
  <div class="content-actions-wrapper">
    <div class="content-actions">
      <Tooltip text="Import" width="auto">
      <button class="icon" @click="onImportOutputClick()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <defs>
            <linearGradient id="SVG-Gradient" gradientTransform="rotate(-45)">
              <stop offset="0%" stop-color="var(--svg-gradient-start, #E53d8F)" />
              <stop offset="50%" stop-color="var(--svg-gradient-end, #E53DE3)" />
            </linearGradient>
            <linearGradient id="SVG-Gradient-Dark" gradientTransform="rotate(-45)">
              <stop offset="0%" stop-color="var(--svg-gradient-start, #12FFC4)" />
              <stop offset="50%" stop-color="var(--svg-gradient-end, #12E0FF)" />
            </linearGradient>
          </defs>
          <path
            d="M4 12H12V10.4H4V12ZM8 9.6L11.2 6.4L10.08 5.28L8.8 6.52V3.2H7.2V6.52L5.92 5.28L4.8 6.4L8 9.6ZM8 16C6.89333 16 5.85333 15.7899 4.88 15.3696C3.90667 14.9493 3.06 14.3795 2.34 13.66C1.62 12.94 1.05013 12.0933 0.6304 11.12C0.210667 10.1467 0.000533333 9.10667 0 8C0 6.89333 0.210133 5.85333 0.6304 4.88C1.05067 3.90667 1.62053 3.06 2.34 2.34C3.06 1.62 3.90667 1.05013 4.88 0.6304C5.85333 0.210667 6.89333 0.000533333 8 0C9.10667 0 10.1467 0.210133 11.12 0.6304C12.0933 1.05067 12.94 1.62053 13.66 2.34C14.38 3.06 14.9501 3.90667 15.3704 4.88C15.7907 5.85333 16.0005 6.89333 16 8C16 9.10667 15.7899 10.1467 15.3696 11.12C14.9493 12.0933 14.3795 12.94 13.66 13.66C12.94 14.38 12.0933 14.9501 11.12 15.3704C10.1467 15.7907 9.10667 16.0005 8 16Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
    </div>
    <div id="content-actions" class="content-actions" style="display: none">
      <Tooltip text="Copy" width="auto">
      <button class="icon" @click="copyOutputToClipboard()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M15.3333 0H4.66667C4.48986 0 4.32029 0.070238 4.19526 0.195262C4.07024 0.320287 4 0.489856 4 0.666667V4H0.666667C0.489856 4 0.320287 4.07024 0.195262 4.19526C0.070238 4.32029 0 4.48986 0 4.66667V15.3333C0 15.5101 0.070238 15.6797 0.195262 15.8047C0.320287 15.9298 0.489856 16 0.666667 16H11.3333C11.5101 16 11.6797 15.9298 11.8047 15.8047C11.9298 15.6797 12 15.5101 12 15.3333V12H15.3333C15.5101 12 15.6797 11.9298 15.8047 11.8047C15.9298 11.6797 16 11.5101 16 11.3333V0.666667C16 0.489856 15.9298 0.320287 15.8047 0.195262C15.6797 0.070238 15.5101 0 15.3333 0ZM14.6667 10.6667H12V4.66667C12 4.48986 11.9298 4.32029 11.8047 4.19526C11.6797 4.07024 11.5101 4 11.3333 4H5.33333V1.33333H14.6667V10.6667Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
      <Tooltip text="Download PDF" width="auto">
      <button class="icon" @click="downloadPDF()">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16" fill="none">
          <path
            d="M1.66666 1.60001H9.99998V4.8H13.3333V14.4H1.66666V1.60001ZM0.832499 6.44724e-06C0.723541 -0.00041453 0.615565 0.0197844 0.514744 0.0594486C0.413923 0.0991127 0.322234 0.157464 0.244918 0.231167C0.167602 0.304871 0.106176 0.39248 0.0641516 0.488987C0.0221269 0.585494 0.000327636 0.689006 0 0.793606V15.2064C0.00174554 15.4165 0.0895148 15.6175 0.244348 15.766C0.39918 15.9145 0.608647 15.9985 0.827499 16H14.1725C14.282 15.9993 14.3903 15.9778 14.4911 15.9369C14.592 15.896 14.6835 15.8363 14.7603 15.7614C14.8372 15.6866 14.8979 15.5979 14.939 15.5004C14.9801 15.403 15.0009 15.2987 15 15.1936V4.00001L10.8333 6.44724e-06H0.832499ZM6.24916 4.4C6.24916 5.6616 5.86999 7.1496 5.22916 8.5224C4.58582 9.9008 3.71749 11.08 2.81249 11.7752L3.79583 13.0656C6.23499 11.504 8.93582 10.4336 11.5491 10.792L11.93 9.2408C9.70332 8.5288 7.91665 6.392 7.91665 4.4H6.24999M6.74999 9.1776C6.97332 8.7 7.17082 8.2048 7.33749 7.7032C7.73529 8.28664 8.21352 8.81571 8.75915 9.276C7.94082 9.4168 7.13915 9.648 6.36332 9.9424C6.50082 9.6912 6.62915 9.436 6.74999 9.1776Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
      <Tooltip text="Share" width="auto">
      <button class="icon" @click="shareOutputById()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M13.3333 16C12.5926 16 11.963 15.7667 11.4444 15.3C10.9259 14.8333 10.6667 14.2667 10.6667 13.6C10.6667 13.5067 10.6741 13.4099 10.6889 13.3096C10.7037 13.2093 10.7259 13.1195 10.7556 13.04L4.48889 9.76C4.23704 9.96 3.95556 10.1168 3.64444 10.2304C3.33333 10.344 3.00741 10.4005 2.66667 10.4C1.92593 10.4 1.2963 10.1667 0.777778 9.7C0.259259 9.23333 0 8.66667 0 8C0 7.33333 0.259259 6.76667 0.777778 6.3C1.2963 5.83333 1.92593 5.6 2.66667 5.6C3.00741 5.6 3.33333 5.6568 3.64444 5.7704C3.95556 5.884 4.23704 6.04053 4.48889 6.24L10.7556 2.96C10.7259 2.88 10.7037 2.79013 10.6889 2.6904C10.6741 2.59067 10.6667 2.49387 10.6667 2.4C10.6667 1.73333 10.9259 1.16667 11.4444 0.7C11.963 0.233333 12.5926 0 13.3333 0C14.0741 0 14.7037 0.233333 15.2222 0.7C15.7407 1.16667 16 1.73333 16 2.4C16 3.06667 15.7407 3.63333 15.2222 4.1C14.7037 4.56667 14.0741 4.8 13.3333 4.8C12.9926 4.8 12.6667 4.74347 12.3556 4.6304C12.0444 4.51733 11.763 4.36053 11.5111 4.16L5.24444 7.44C5.27407 7.52 5.2963 7.61013 5.31111 7.7104C5.32593 7.81067 5.33333 7.9072 5.33333 8C5.33333 8.09333 5.32593 8.19013 5.31111 8.2904C5.2963 8.39067 5.27407 8.48053 5.24444 8.56L11.5111 11.84C11.763 11.64 12.0444 11.4835 12.3556 11.3704C12.6667 11.2573 12.9926 11.2005 13.3333 11.2C14.0741 11.2 14.7037 11.4333 15.2222 11.9C15.7407 12.3667 16 12.9333 16 13.6C16 14.2667 15.7407 14.8333 15.2222 15.3C14.7037 15.7667 14.0741 16 13.3333 16Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
      <Tooltip text="Save" width="auto">
      <button class="icon" @click="onSaveOutputClick()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M16 3.55556V14.2222C16 14.7111 15.8258 15.1298 15.4773 15.4782C15.1289 15.8267 14.7105 16.0006 14.2222 16H1.77778C1.28889 16 0.870223 15.8258 0.521779 15.4773C0.173335 15.1289 -0.000591083 14.7105 1.50915e-06 14.2222V1.77778C1.50915e-06 1.28889 0.174224 0.870224 0.522668 0.521779C0.871113 0.173335 1.28948 -0.000591083 1.77778 1.50915e-06H12.4444L16 3.55556ZM8 13.3333C8.74074 13.3333 9.37037 13.0741 9.88889 12.5556C10.4074 12.037 10.6667 11.4074 10.6667 10.6667C10.6667 9.92593 10.4074 9.2963 9.88889 8.77778C9.37037 8.25926 8.74074 8 8 8C7.25926 8 6.62963 8.25926 6.11111 8.77778C5.59259 9.2963 5.33333 9.92593 5.33333 10.6667C5.33333 11.4074 5.59259 12.037 6.11111 12.5556C6.62963 13.0741 7.25926 13.3333 8 13.3333ZM2.66667 6.22222H10.6667V2.66667H2.66667V6.22222Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
      <Tooltip text="Clear Content" width="auto">
      <button class="icon" @click="clearResponseArea()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 0C5 0 2.4 1.6 1.1 4.1L0 3V7H4L2.5 5.5C3.5 3.5 5.6 2 8 2C11.3 2 14 4.7 14 8C14 11.3 11.3 14 8 14C6.2 14 4.6 13.2 3.5 11.9L2 13.2C3.4 14.9 5.6 16 8 16C12.4 16 16 12.4 16 8C16 3.6 12.4 0 8 0Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
      <Tooltip text="Delete Content" width="auto">
      <button class="icon" @click="deleteOutput()">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16" fill="none">
          <path
            d="M1.42857 14.2222C1.42857 15.2 2.26429 16 3.28571 16H10.7143C11.7357 16 12.5714 15.2 12.5714 14.2222V3.55556H1.42857V14.2222ZM3.71286 7.89333L5.02214 6.64L7 8.52444L8.96857 6.64L10.2779 7.89333L8.30929 9.77778L10.2779 11.6622L8.96857 12.9156L7 11.0311L5.03143 12.9156L3.72214 11.6622L5.69071 9.77778L3.71286 7.89333ZM10.25 0.888889L9.32143 0H4.67857L3.75 0.888889H0.5V2.66667H13.5V0.888889H10.25Z"
            fill="#E53D8F"
          />
        </svg>
      </button>
      </Tooltip>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref, onBeforeUnmount } from 'vue';
import { useCleanup } from '@/composables/useCleanup';
import store from '@/store/state';
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'SharedContentActions',
  components: {
    SimpleModal,
    Tooltip,
  },
  setup() {
    const cleanup = useCleanup();
    const modal = ref(null);

    return {
      cleanup,
      modal,
    };
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
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: options.showCancel !== undefined ? options.showCancel : true,
      });
      return result === null ? null : result || defaultValue;
    },
    async showConfirm(title, message, options = {}) {
      const result = await this.$refs.modal.showModal({
        title,
        message,
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        confirmClass: options.confirmClass || 'btn-primary',
        cancelClass: options.cancelClass || 'btn-secondary',
        showCancel: true,
      });
      return result !== null;
    },
    async copyOutputToClipboard() {
      const contentEl = document.getElementById('response-area');
      if (contentEl) {
        try {
          await navigator.clipboard.writeText(contentEl.innerText);
          this.showAlert('Content copied to clipboard!');
        } catch (err) {
          console.error('Error copying to clipboard: ', err);
          this.showAlert('Unable to copy. Please try again.');
        }
      } else {
        this.showAlert('Nothing to copy!');
      }
    },
    async shareOutputById() {
      try {
        // Save the output first
        const newOutputId = await this.onSaveOutputClick();

        if (newOutputId) {
          await navigator.clipboard.writeText(newOutputId);
        } else {
          this.showAlert('Failed to save and generate an Output ID. Please try again.');
        }
      } catch (error) {
        console.error('Error in shareOutputById:', error);
        this.showAlert('An error occurred while trying to share the output. Please try again.');
      }
    },
    async clearResponseArea() {
      const overwrite = await this.showConfirm('Clear Content', 'Are you sure you want clear the text area?', {
        confirmText: 'Clear',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
        cancelClass: 'btn-secondary',
      });

      if (!overwrite) return;

      const responseArea = document.getElementById('response-area');

      if (store.state.chat.page === 'chat') {
        // Reset the chat state to initial
        store.commit('chat/RESET_CHAT');

        // Explicitly set the initial assistant message back into the response area
        const initialMessage = store.state.chat.messages.find((msg) => msg.role === 'assistant');

        if (initialMessage) {
          responseArea.innerHTML = `<div class="system-message">${initialMessage.content}</div>`;
        } else {
          responseArea.innerHTML = '';
        }
      } else {
        // For other pages, just clear the response area
        responseArea.innerHTML = '';
      }

      // Hide content actions again
      document.getElementById('content-actions').style.display = 'none';
    },
    async deleteOutput() {
      let outputId = document.getElementById('response-area').getAttribute('data-output-id');
      const confirmed = await this.showConfirm('Delete Content', 'Are you sure you want delete this content?', {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
        cancelClass: 'btn-secondary',
      });
      if (confirmed) {
        try {
          await axios.delete(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`);
          this.showAlert(`Output deleted successfully.`);
          this.clearResponseArea();
        } catch (error) {
          console.error('Error deleting output:', error);
          this.showAlert('Failed to delete output.');
        }
      } else {
        console.log('Deletion canceled by the user.');
      }
    },
    async onSaveOutputClick() {
      console.log('onSaveOutputClick called');
      const responseArea = document.getElementById('response-area');
      const outputContent = responseArea.innerHTML;
      const outputId = responseArea.getAttribute('data-output-id');
      const workflowId = responseArea.getAttribute('data-workflow-id');
      const toolId = responseArea.getAttribute('data-tool-id');
      const isShareable = await this.showConfirm('Share Content', 'Do you want to make this content shareable?', {
        confirmText: 'Share',
        cancelText: "Don't Share",
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
      });
      try {
        const outputData = {
          id: outputId,
          content: outputContent,
          workflowId,
          toolId,
          isShareable,
        };

        let response;
        const baseUrl = isShareable ? API_CONFIG.REMOTE_URL : API_CONFIG.BASE_URL;

        if (outputId) {
          console.log('Updating existing output');
          response = await axios.put(`${baseUrl}/content-outputs/${outputId}`, outputData);
        } else {
          response = await axios.post(`${baseUrl}/content-outputs/save`, outputData);
        }

        if (response && response.data && response.data.id) {
          const newOutputId = response.data.id;
          responseArea.setAttribute('data-output-id', newOutputId);

          // Save locally as well
          await axios.post(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
            ...outputData,
            id: newOutputId,
          });

          this.showAlert(outputId ? 'Output updated successfully!' : 'Output saved successfully!');

          if (isShareable) {
            await navigator.clipboard.writeText(newOutputId);
            this.showAlert(`Output ID copied to clipboard: ${newOutputId}`);
          }

          // Update the UI to show the content actions
          document.getElementById('content-actions').style.display = 'flex';

          return newOutputId;
        } else {
          throw new Error('Invalid response from server');
        }
      } catch (error) {
        console.error('Error saving/updating output:', error);
        this.showAlert('Failed to save/update output. Please try again.');
      }
    },
    async onImportOutputClick() {
      const outputId = await this.showPrompt('Import Output', 'Please enter the output ID you wish to import:', '', {
        isTextArea: false,
        placeholder: 'Enter output ID',
        defaultValue: '',
        confirmText: 'Import',
        cancelText: 'Cancel',
      });
      if (outputId) {
        try {
          let response;
          let isFromRemote = false;

          // Try to fetch from local database first
          try {
            response = await axios.get(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
              },
            });
            console.log('Content found in local database');
          } catch (localError) {
            // If not found locally (404) and REMOTE_URL is configured, try remote
            if (localError.response && localError.response.status === 404 && API_CONFIG.REMOTE_URL) {
              console.log('Content not found locally, trying remote...');
              try {
                response = await axios.get(`${API_CONFIG.REMOTE_URL}/content-outputs/${outputId}`);
                isFromRemote = true;
                console.log('Content found in remote database');
              } catch (remoteError) {
                // If remote also fails, throw the remote error
                throw remoteError;
              }
            } else {
              // If it's not a 404 or no REMOTE_URL configured, throw the local error
              throw localError;
            }
          }

          // Create a new copy of the imported content
          const outputData = {
            content: response.data.content,
            workflowId: response.data.workflow_id,
            toolId: response.data.tool_id,
            isShareable: false, // Default to not shareable for imported content
          };

          // Save as new content to local database (or update if it already exists locally)
          const saveResponse = await axios.post(`${API_CONFIG.BASE_URL}/content-outputs/save`, outputData);

          const newOutputId = saveResponse.data.id;
          const responseArea = document.getElementById('response-area');

          // Update UI with the content and new ID
          responseArea.innerHTML = response.data.content;
          responseArea.setAttribute('data-output-id', newOutputId);
          responseArea.setAttribute('data-workflow-id', response.data.workflow_id);
          responseArea.setAttribute('data-tool-id', response.data.tool_id);
          document.getElementById('content-actions').style.display = 'flex';

          // Highlight code blocks
          responseArea.querySelectorAll('pre code:not([highlighted])').forEach((el) => {
            hljs.highlightElement(el);
            el.setAttribute('highlighted', 'true');
          });

          // Set spellcheck to false for code elements
          responseArea.querySelectorAll('code').forEach((el) => {
            el.setAttribute('spellcheck', 'false');
          });

          // Render MathJax content
          if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            try {
              await MathJax.typesetPromise([responseArea]);
            } catch (error) {
              console.error('Error in MathJax typesetting:', error);
            }
          } else {
            console.warn('MathJax is not available or not fully loaded');
          }

          // Add copy buttons to pre elements
          this.addCopyButtonsToPre();

          const sourceMessage = isFromRemote ? ' from remote server' : ' from local database';
          this.showAlert(`Output imported${sourceMessage} and saved as a new copy successfully!`);
        } catch (error) {
          console.error('Error importing output:', error);
          if (error.response && error.response.status === 403) {
            this.showAlert("You don't have permission to access this output. It might not be shared.");
          } else if (error.response && error.response.status === 404) {
            this.showAlert('Output not found. Please check the ID and try again.');
          } else {
            this.showAlert('Failed to import output. Please check the ID and try again.');
          }
        }
      }
    },
    addCopyButtonsToPre() {
      document.querySelectorAll('pre').forEach((pre, index) => {
        let button = pre.querySelector('.copy-button');

        if (!button) {
          button = document.createElement('button');
          button.classList.add('copy-button');
          button.innerHTML = '<i class="fas fa-copy"></i>';
          button.style.position = 'absolute';
          button.style.top = '0';
          button.style.right = '0';
          button.style.zIndex = 2;
          button.style.padding = '16px';
          pre.style.position = 'relative';
          pre.appendChild(button);
        }

        const clickHandler = () => {
          const code = pre.querySelector('code').innerText;
          navigator.clipboard
            .writeText(code)
            .then(() => {
              button.innerHTML = '<i class="fas fa-check"></i>';
              this.cleanup.setTimeout(() => {
                button.innerHTML = '<i class="fas fa-copy"></i>';
              }, 1000);
            })
            .catch((err) => {
              console.error('Failed to copy text: ', err);
            });
        };

        // Remove old listener if exists by cloning and replacing
        const oldButton = button;
        button = button.cloneNode(true);
        oldButton.replaceWith(button);

        // Use cleanup composable to track the event listener
        this.cleanup.addEventListener(button, 'click', clickHandler);
      });
    },
    downloadPDF() {
      const responseArea = document.getElementById('response-area');
      const pdfDownloadLoaderDiv = document.createElement('div');
      const spinner = document.createElement('div'); // Create a new div element for the spinner

      // Style the spinner div, these styles are examples and can be modified
      spinner.innerHTML = `<div class="modal-content"><p>Generating PDF, Please Wait...</p></div>`; // Placeholder text or could be an actual spinner image/gif
      spinner.style.position = 'absolute';
      spinner.style.top = '50%';
      spinner.style.left = '50%';
      spinner.style.transform = 'translate(-50%, -50%)';
      spinner.style.zIndex = '1000';

      // Append the spinner to the loader div
      pdfDownloadLoaderDiv.appendChild(spinner);
      pdfDownloadLoaderDiv.classList.add('pdf-download-loader');
      pdfDownloadLoaderDiv.style.display = 'flex';
      pdfDownloadLoaderDiv.style.justifyContent = 'center'; // Center spinner horizontally
      pdfDownloadLoaderDiv.style.alignItems = 'center'; // Center spinner vertically
      pdfDownloadLoaderDiv.style.position = 'fixed';
      pdfDownloadLoaderDiv.style.width = '100%';
      pdfDownloadLoaderDiv.style.height = '100%';
      pdfDownloadLoaderDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; // Semi-transparent background
      pdfDownloadLoaderDiv.style.top = '0';
      pdfDownloadLoaderDiv.style.left = '0';

      // Show the loading spinner overlay by adding it to the body
      document.body.appendChild(pdfDownloadLoaderDiv);

      const clonedResponseArea = responseArea.cloneNode(true);
      document.body.appendChild(clonedResponseArea);
      clonedResponseArea.classList.add('pdf-download');
      clonedResponseArea.style.display = 'block';

      // Use html2canvas to take a snapshot of the entire content
      html2canvas(clonedResponseArea, {
        scale: 1.25,
        scrollY: -window.scrollY,
        windowWidth: clonedResponseArea.scrollWidth,
        windowHeight: clonedResponseArea.scrollHeight,
      })
        .then((canvas) => {
          // Convert canvas to image
          const imgData = canvas.toDataURL('image/png');

          // Initialize jsPDF
          const pdf = new jspdf.jsPDF({
            orientation: 'p',
            unit: 'pt',
            format: [canvas.width, canvas.height],
          });

          // Add the image to PDF
          pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);

          // Save the PDF
          pdf.save('response-area-content.pdf');

          // Remove the loading spinner overlay by removing it from the body
          document.body.removeChild(pdfDownloadLoaderDiv);

          // Clean up the cloned response area after saving PDF
          document.body.removeChild(clonedResponseArea);
        })
        .catch((err) => {
          // In case of error, remove the loading spinner and clean up
          document.body.removeChild(pdfDownloadLoaderDiv);
          console.error('Error generating PDF: ', err);
        });
    },
  },
};
</script>

<style scoped>
button.icon svg path {
  fill: url(#SVG-Gradient) !important;
}
body.dark button.icon svg path {
  fill: url(#SVG-Gradient-Dark) !important;
}
</style>
