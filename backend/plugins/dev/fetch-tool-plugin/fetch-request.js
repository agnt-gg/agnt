class FetchRequestTool {
  constructor() {
    this.name = 'fetch-request';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[fetch-tool-plugin] Executing fetch-request with params:', JSON.stringify(params, null, 2));

    let controller;
    let timeoutId;

    try {
      // Required parameters
      const url = params.url;
      const method = (params.method || 'GET').toUpperCase();
      const responseType = params.responseType || 'json';
      const timeout = params.timeout || 10000;

      if (!url) {
        throw new Error('Missing required parameter: url');
      }
      if (!method) {
        throw new Error('Missing required parameter: method');
      }

      // Build headers
      let headers = {};
      if (params.headers && typeof params.headers === 'object') {
        headers = { ...params.headers };
      }

      // Build fetch options
      const fetchOptions = {
        method,
        headers,
      };

      // Attach body if applicable
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        if (params.body !== undefined && params.body !== null && params.body !== '') {
          // Try to parse to JSON if it's stringified and Content-Type is application/json
          if (
            (!headers['Content-Type'] && !headers['content-type']) ||
            (headers['Content-Type'] === 'application/json' || headers['content-type'] === 'application/json')
          ) {
            fetchOptions.body = params.body;
            if (!headers['Content-Type'] && !headers['content-type']) {
              fetchOptions.headers['Content-Type'] = 'application/json';
            }
          } else {
            fetchOptions.body = params.body;
          }
        }
      }

      // Setup AbortController for timeout
      controller = new AbortController();
      fetchOptions.signal = controller.signal;
      timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      // Perform the fetch
      const response = await fetch(url, fetchOptions);

      // Clear the timeout
      clearTimeout(timeoutId);

      // Prepare response headers object
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Parse response data as specified
      let data = null;
      if (responseType === 'json') {
        try {
          data = await response.json();
        } catch (e) {
          data = null;
        }
      } else if (responseType === 'text') {
        data = await response.text();
      } else if (responseType === 'blob') {
        data = await response.blob();
      } else {
        data = null;
      }

      const success = response.ok;

      return {
        status: response.status,
        headers: responseHeaders,
        data: data,
        success: success,
        error: success ? null : `HTTP Error: ${response.status} ${response.statusText}`,
      };

    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      let errMsg = error.message;
      if (error.name === 'AbortError') {
        errMsg = 'Fetch request timed out';
      }
      console.error('[fetch-tool-plugin] Error:', errMsg);
      return {
        status: 0,
        headers: {},
        data: null,
        success: false,
        error: errMsg,
      };
    }
  }
}

export default new FetchRequestTool();