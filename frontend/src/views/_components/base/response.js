import { removeStreamId } from './stream';
import { useRoute } from 'vue-router';
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

// Track all event listeners for cleanup
const eventListeners = new Map();

export function getContentFromQueryParam() {
  const route = useRoute();
  const contentId = route.query['content-id'];
  if (contentId) {
    importOutputById(contentId);
  }
}

// export function updateContentArea(fullMarkdownContent, message) {
//   const responseArea = document.getElementById("response-area");

//   let converter = new showdown.Converter({
//     tables: true,
//     strikethrough: true,
//     literalMidWordUnderscores: true,
//     omitExtraWLInCodeBlocks: true,
//     simpleLineBreaks: true,
//     ghCodeBlocks: true
//   });
//   let htmlText = converter.makeHtml(removeStreamId(fullMarkdownContent));

//   // Remove extra newlines from <pre><code> blocks
//   htmlText = htmlText.replace(/<pre><code([^>]*)>\n/g, '<pre><code$1>');
//   htmlText = htmlText.replace(/<\/code><\/pre>\n/g, '</code></pre>');

//   message.innerHTML = htmlText.trim();

//   responseArea.setAttribute("contenteditable", "true");

//   responseArea.querySelectorAll("pre code:not([highlighted])").forEach((el) => {
//     hljs.highlightElement(el);
//     el.setAttribute("highlighted", "true");
//   });

//   responseArea.querySelectorAll("code").forEach((el) => {
//     el.setAttribute("spellcheck", "false");
//   });

//   // Modified MathJax handling
//   if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
//     MathJax.typesetPromise()
//       .then(() => {
//         responseArea.querySelectorAll("mjx-container").forEach((el) => {
//           MathJax.typesetClear([el]);
//         });
//       })
//       .catch((error) => {
//         console.error("Error in MathJax typesetting:", error);
//       });
//   } else {
//     console.warn("MathJax is not available or not fully loaded");
//   }

//   _addCopyButtonsToPre();
// }

export function updateContentArea(fullMarkdownContent, message) {
  let htmlText;

  // Check if content has think tags
  if (fullMarkdownContent.includes('<think>')) {
    // Split content at think tags
    const [thinkContent, ...restContent] = fullMarkdownContent.split('</think>');

    // Extract the actual think content (everything after <think>)
    let actualThinkContent = thinkContent.replace('<think>', '');

    // Remove stream object from think content
    actualThinkContent = actualThinkContent.replace(/{\s*streamId:\s*[^}]+\s*}\s*/, '');

    // Create think block with single p tag
    const thinkBlock = `<think>${actualThinkContent}</think>`;

    // Only convert the rest with showdown
    let converter = new showdown.Converter({
      tables: true,
      strikethrough: true,
      literalMidWordUnderscores: true,
      omitExtraWLInCodeBlocks: true,
      simpleLineBreaks: true,
      ghCodeBlocks: true,
    });

    // Convert rest of content and combine
    htmlText = thinkBlock + converter.makeHtml(removeStreamId(restContent.join('')));
  } else {
    // No think tags, process normally
    let converter = new showdown.Converter({
      tables: true,
      strikethrough: true,
      literalMidWordUnderscores: true,
      omitExtraWLInCodeBlocks: true,
      simpleLineBreaks: true,
      ghCodeBlocks: true,
    });
    htmlText = converter.makeHtml(removeStreamId(fullMarkdownContent));
  }

  // Remove extra newlines from <pre><code> blocks
  htmlText = htmlText.replace(/<pre><code([^>]*)>\n/g, '<pre><code$1>');
  htmlText = htmlText.replace(/<\/code><\/pre>\n/g, '</code></pre>');

  message.innerHTML = htmlText.trim();
  message.setAttribute('contenteditable', 'true');

  message.querySelectorAll('pre code:not([highlighted])').forEach((el) => {
    hljs.highlightElement(el);
    el.setAttribute('highlighted', 'true');
  });

  message.querySelectorAll('code').forEach((el) => {
    el.setAttribute('spellcheck', 'false');
  });

  // Modified MathJax handling
  if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
    MathJax.typesetPromise()
      .then(() => {
        message.querySelectorAll('mjx-container').forEach((el) => {
          MathJax.typesetClear([el]);
        });
      })
      .catch((error) => {
        console.error('Error in MathJax typesetting:', error);
      });
  } else {
    console.warn('MathJax is not available or not fully loaded');
  }

  // Add this new code to handle link clicks
  const linkClickHandler = (e) => {
    const link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      // Dispatch a custom event
      const event = new CustomEvent('open-link-modal', {
        detail: { href: link.href },
        bubbles: true, // This allows the event to bubble up through the DOM
      });
      message.dispatchEvent(event);
    }
  };

  // Remove old listener if exists
  const oldLinkListener = eventListeners.get('message_link_click');
  if (oldLinkListener) {
    message.removeEventListener('click', oldLinkListener);
  }

  message.addEventListener('click', linkClickHandler);
  eventListeners.set('message_link_click', linkClickHandler);

  _addCopyButtonsToPre();
}

// TODO: THIS NEEDS UPDATED TO ADD PLACEHOLDER WHEN CLICK AWAY IF NO OTHER CONTENT IS PRESENT
export function addPlaceholderEventListeners() {
  const innerEditorArea = document.querySelector('inner-editor-area');
  if (!innerEditorArea) return;

  const focusHandler = function () {
    let innerEditorArea = document.querySelector('inner-editor-area');
    let placeholder = document.getElementById('placeholder-text');

    if (placeholder) {
      placeholder.style.display = 'none';

      // Set the cursor at the start of the div
      let range = document.createRange();
      let selection = window.getSelection();
      range.setStart(innerEditorArea, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const blurHandler = function () {
    let responseArea = document.getElementById('response-area');
    let placeholder = document.getElementById('placeholder-text');

    if (placeholder) {
      // If only includes the placeholder text and no other content
      if (responseArea.innerHTML.trim() === placeholder.outerHTML.trim()) {
        placeholder.style.display = 'flex';
      }
    }

    responseArea.blur();
  };

  // Remove old listeners if they exist
  const oldFocusListener = eventListeners.get('innerEditor_focus');
  const oldBlurListener = eventListeners.get('innerEditor_blur');

  if (oldFocusListener) {
    innerEditorArea.removeEventListener('focus', oldFocusListener);
  }
  if (oldBlurListener) {
    innerEditorArea.removeEventListener('blur', oldBlurListener);
  }

  innerEditorArea.addEventListener('focus', focusHandler);
  innerEditorArea.addEventListener('blur', blurHandler);

  eventListeners.set('innerEditor_focus', focusHandler);
  eventListeners.set('innerEditor_blur', blurHandler);
}

export async function importOutputById(outputId) {
  try {
    const response = await axios.get(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    });

    const outputContent = response.data.content;

    if (outputContent) {
      const responseArea = document.getElementById('response-area');
      responseArea.setAttribute('data-output-id', outputId);
      responseArea.innerHTML = outputContent;
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

      // Handle MathJax rendering
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise()
          .then(() => {
            responseArea.querySelectorAll('mjx-container').forEach((el) => {
              MathJax.typesetClear([el]);
            });
          })
          .catch((error) => {
            console.error('Error in MathJax typesetting:', error);
          });
      } else {
        console.warn('MathJax is not available or not fully loaded');
      }

      // Add copy buttons to pre elements
      _addCopyButtonsToPre();

      responseArea.setAttribute('contenteditable', 'true');
      console.log('Output content successfully imported.');
    } else {
      console.log(`No content found for output ID: ${outputId}`);
    }
  } catch (error) {
    console.error('Error importing output:', error);
    await SimpleModal.methods.showModal({
      title: 'Error',
      message: `Failed to import output with ID: ${outputId}`,
      confirmText: 'OK',
      showCancel: false,
    });
  }
}

export function addCopyEventListenerToPreButtons() {
  document.querySelectorAll('pre').forEach((pre) => {
    const button = pre.querySelector('.copy-button');
    const listenerIdentifier = 'click-listener-added';
    if (button && !button.hasAttribute(listenerIdentifier)) {
      button.addEventListener('click', () => {
        const code = pre.querySelector('code').innerText;
        _copyToClipboard(code);
        button.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          button.innerHTML = '<i class="fas fa-copy"></i>';
        }, 1000);
      });
      button.setAttribute(listenerIdentifier, 'true');
    }
  });
}

async function _copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    console.log('Text copied to clipboard');
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
}

function _addCopyButtonsToPre() {
  document.querySelectorAll('pre').forEach((pre, index) => {
    let button = pre.querySelector('.copy-button');

    // If the button doesn't exist, create it
    if (!button) {
      button = document.createElement('button');
      button.classList.add('copy-button');
      button.innerHTML = '<i class="fas fa-copy"></i>'; // Font Awesome copy icon

      // Position the button in the top right corner of the pre element
      button.style.position = 'absolute';
      button.style.top = '0';
      button.style.right = '0';
      button.style.zIndex = 2;
      button.style.padding = '16px';
      pre.style.position = 'relative'; // Ensure pre is relative for absolute positioning of button

      pre.appendChild(button);
    }

    // Create click handler
    const clickHandler = () => {
      const code = pre.querySelector('code').innerText;
      _copyToClipboard(code);
      button.innerHTML = '<i class="fas fa-check"></i>'; // Change icon to checkmark
      setTimeout(() => {
        button.innerHTML = '<i class="fas fa-copy"></i>'; // Change back after 1s
      }, 1000);
    };

    // Remove old listener if exists
    const oldListener = eventListeners.get(`copyBtn_${index}_click`);
    if (oldListener) {
      button.removeEventListener('click', oldListener);
    }

    // Add the event listener
    button.addEventListener('click', clickHandler);
    eventListeners.set(`copyBtn_${index}_click`, clickHandler);
  });
}

/**
 * Clean up all event listeners
 * Call this when the component using these response utilities is unmounted
 */
export function cleanupResponseEventListeners() {
  // Remove all tracked event listeners
  eventListeners.forEach((handler, key) => {
    if (key === 'message_link_click') {
      // This is handled per-message, so we skip it here
      // It will be cleaned up when the message element is removed
    } else if (key === 'innerEditor_focus' || key === 'innerEditor_blur') {
      const innerEditorArea = document.querySelector('inner-editor-area');
      if (innerEditorArea && handler) {
        const eventType = key.split('_')[1];
        innerEditorArea.removeEventListener(eventType, handler);
      }
    } else if (key.startsWith('copyBtn_')) {
      const [, index, eventType] = key.split('_');
      const preElements = document.querySelectorAll('pre');
      const pre = preElements[parseInt(index)];
      if (pre) {
        const button = pre.querySelector('.copy-button');
        if (button && handler) {
          button.removeEventListener(eventType, handler);
        }
      }
    }
  });

  eventListeners.clear();
}
