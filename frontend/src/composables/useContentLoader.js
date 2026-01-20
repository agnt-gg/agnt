import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Composable to load content from query parameters
 * Used in Chat and ToolForge screens to load saved outputs
 */
export function useContentLoader() {
  const route = useRoute();

  const loadContentFromQuery = async () => {
    const contentId = route.query['content-id'];
    if (!contentId) return false;

    try {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/content-outputs/${contentId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      const outputContent = response.data.content;

      if (outputContent) {
        const responseArea = document.getElementById('response-area');
        if (responseArea) {
          responseArea.setAttribute('data-output-id', contentId);
          responseArea.innerHTML = outputContent;
          responseArea.setAttribute('contenteditable', 'true');

          // Show content actions
          const contentActions = document.getElementById('content-actions');
          if (contentActions) {
            contentActions.style.display = 'flex';
          }

          // Highlight code blocks
          responseArea.querySelectorAll('pre code:not([highlighted])').forEach((el) => {
            if (typeof hljs !== 'undefined') {
              hljs.highlightElement(el);
              el.setAttribute('highlighted', 'true');
            }
          });

          // Set spellcheck to false for code elements
          responseArea.querySelectorAll('code').forEach((el) => {
            el.setAttribute('spellcheck', 'false');
          });

          // Handle MathJax rendering
          if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            try {
              await MathJax.typesetPromise([responseArea]);
            } catch (error) {
              console.error('Error in MathJax typesetting:', error);
            }
          }

          // Add copy buttons to pre elements
          addCopyButtonsToPre();

          console.log('Output content successfully imported from query parameter.');
          return true;
        }
      }
    } catch (error) {
      console.error('Error loading content from query parameter:', error);
    }

    return false;
  };

  const addCopyButtonsToPre = () => {
    document.querySelectorAll('pre').forEach((pre) => {
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
            setTimeout(() => {
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
      button.addEventListener('click', clickHandler);
    });
  };

  return {
    loadContentFromQuery,
  };
}
