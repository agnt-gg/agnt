import { VM } from 'vm2';
import fetch from 'node-fetch';
import { Blob } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'util';
import crypto from 'crypto';
import AuthManager from '../../../services/auth/AuthManager.js';

const sendResult = (result) => {
  process.send(result);
  process.exit(0);
};

const handleError = (error) => {
  console.error('Error in child process:', error);
  sendResult({
    success: false,
    result: null,
    error: error.message || String(error),
  });
};

process.on('message', (message) => {
  const { code, inputData = {}, workflowContext = {} } = message;

  const vm = new VM({
    timeout: 55000,
    sandbox: {
      console: {
        log: (...args) => console.log('Script log:', ...args),
        error: (...args) => console.error('Script error:', ...args),
      },
      context: {
        ...(workflowContext.DB || {}),
        resolveTemplate: (template) => {
          return template.replace(/{{(.*?)}}/g, (match, p1) => {
            return inputData[p1.trim()] || null;
          });
        },
      },
      workflowContext,
      inputData,
      fetch,
      btoa: (data) => Buffer.from(data).toString('base64'),
      atob: (data) => Buffer.from(data, 'base64').toString(),
      Blob,
      TextEncoder,
      TextDecoder,
      FileReader: class FileReader {
        constructor() {
          this.onload = null;
        }
        readAsText(blob) {
          blob.text().then((text) => {
            if (this.onload) this.onload({ target: { result: text } });
          });
        }
        readAsArrayBuffer(blob) {
          blob.arrayBuffer().then((buffer) => {
            if (this.onload) this.onload({ target: { result: buffer } });
          });
        }
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      URLSearchParams,
      Uint8Array,
      ArrayBuffer,
      crypto,
      AuthManager,
    },
  });

  const wrappedCode = `
    (async () => {
      try {
        ${code}
      } catch (error) {
        throw new Error('Execution Error: ' + (error.message || String(error)));
      }
    })()
  `;

  vm.run(wrappedCode)
    .then((result) => {
      sendResult({
        success: true,
        result: result,
        error: null,
      });
    })
    .catch(handleError);
});

process.on('uncaughtException', handleError);
process.on('unhandledRejection', handleError);
process.on('disconnect', () => process.exit());

setTimeout(() => {
  handleError(new Error('Execution timed out'));
}, 58000);
