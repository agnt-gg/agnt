import BaseAction from '../BaseAction.js';
import WebSocket from 'ws';

class SLOPConnector extends BaseAction {
  static schema = {
    title: 'SLOP Connector',
    category: 'action',
    type: 'slop-connector',
    icon: 'custom',
    description: 'Connect to any SLOP-compatible API endpoints',
    parameters: {
      baseUrl: {
        type: 'string',
        inputType: 'text',
        description: 'Base URL of the SLOP API (e.g., https://api.example.com)',
      },
      endpoint: {
        type: 'string',
        inputType: 'select',
        options: ['info', 'chat', 'memory', 'tools', 'resources', 'pay'],
        description: 'SLOP endpoint to connect to',
        default: 'info',
      },
      method: {
        type: 'string',
        inputType: 'select',
        options: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'HTTP method to use',
        default: 'GET',
        conditional: {
          field: 'endpoint',
          value: ['chat', 'memory', 'tools', 'resources', 'pay'],
        },
      },
      authToken: {
        type: 'string',
        inputType: 'password',
        description: 'Authentication token (if required by the SLOP API)',
        default: '',
      },
      streamMode: {
        type: 'string',
        inputType: 'select',
        options: ['none', 'sse', 'websocket'],
        description: 'Streaming mode (if supported by endpoint)',
        default: 'none',
        conditional: {
          field: 'endpoint',
          value: ['chat'],
        },
      },
      resourceId: {
        type: 'string',
        inputType: 'text',
        description: 'ID of the specific resource to access',
        conditional: {
          field: 'endpoint',
          value: ['memory', 'resources', 'pay'],
        },
      },
      toolId: {
        type: 'string',
        inputType: 'text',
        description: 'ID of the specific tool to use',
        conditional: {
          field: 'endpoint',
          value: 'tools',
        },
      },
      payload: {
        type: 'string',
        inputType: 'codearea',
        description: 'JSON payload to send with the request',
        conditional: {
          field: 'method',
          value: ['POST', 'PUT'],
        },
      },
      queryParams: {
        type: 'string',
        inputType: 'codearea',
        description: 'JSON object of query parameters',
        conditional: {
          field: 'method',
          value: 'GET',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the request was successful',
      },
      result: {
        type: 'object',
        description: 'The result data from the SLOP endpoint',
      },
      error: {
        type: 'string',
        description: 'Error message if the request failed',
      },
      status: {
        type: 'number',
        description: 'HTTP status code of the response',
      },
    },
  };

  constructor() {
    super('slop-connector');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('Executing SLOP Connector with params:', JSON.stringify(params, null, 2));

    try {
      this.validateParams(params);

      const userId = workflowEngine.userId;
      console.log('Attempting to perform SLOP action for user:', userId);

      // Get auth token directly from params
      const authToken = params.authToken;

      // Fix the baseUrl if it includes the endpoint
      let { baseUrl } = params;
      // Remove trailing slash if present
      baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

      // Extract any endpoint that might be in the baseUrl
      const urlParts = baseUrl.split('/');
      const possibleEndpoint = urlParts[urlParts.length - 1];

      if (['info', 'chat', 'memory', 'tools', 'resources', 'pay'].includes(possibleEndpoint)) {
        baseUrl = urlParts.slice(0, -1).join('/');
        // Only use endpoint from URL if no endpoint was specified
        if (!params.endpoint || params.endpoint === 'info') {
          params.endpoint = possibleEndpoint;
        }
      }

      // Prepare the request
      const { endpoint, method, resourceId, toolId } = params;

      // Build the endpoint URL
      let url = `${baseUrl}/${endpoint}`;

      // Add resource or tool ID if specified
      if (resourceId && ['memory', 'resources', 'pay'].includes(endpoint)) {
        url += `/${resourceId}`;
      } else if (toolId && endpoint === 'tools') {
        url += `/${toolId}`;
      }

      // Add query parameters if provided and method is GET
      if (params.queryParams && method === 'GET') {
        let queryObj;
        try {
          queryObj = JSON.parse(params.queryParams);
          const queryString = new URLSearchParams(queryObj).toString();
          url += `?${queryString}`;
        } catch (error) {
          console.error('Error parsing query parameters:', error);
          throw new Error('Invalid query parameters JSON format');
        }
      }

      // Handle different connection types
      if (params.streamMode === 'websocket' && endpoint === 'chat') {
        return await this.handleWebSocketConnection(url, params, authToken);
      } else if (params.streamMode === 'sse' && endpoint === 'chat') {
        return await this.handleSSEConnection(url, params, authToken);
      } else {
        return await this.handleRESTConnection(url, params, authToken);
      }
    } catch (error) {
      console.error('SLOP Connector Error:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
        status: error.status || 500,
      });
    }
  }

  async handleRESTConnection(url, params, authToken) {
    const { method } = params;

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Add authorization if token is provided
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Prepare request options
    const options = {
      method,
      headers,
    };

    // Add payload for POST/PUT methods
    if (['POST', 'PUT'].includes(method) && params.payload) {
      try {
        options.body = params.payload;
        // Try to parse as JSON to validate, but keep as string for the request
        JSON.parse(params.payload);
      } catch (error) {
        throw new Error('Invalid JSON payload format');
      }
    }

    // Set timeout for the request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout
    options.signal = controller.signal;

    try {
      // Make the request
      console.log(`Making ${method} request to: ${url}`);
      const response = await fetch(url, options);
      clearTimeout(timeout);

      // Handle response
      const status = response.status;

      try {
        // Get text once and store it
        const text = await response.text();
        let result;

        // Try to parse as JSON if the text isn't empty
        if (text) {
          try {
            result = JSON.parse(text);
          } catch (parseError) {
            console.error('Error parsing JSON response:', parseError);
            // If JSON parsing fails, return the raw text
            result = { rawResponse: text };
          }
        } else {
          result = {};
        }

        return this.formatOutput({
          success: response.ok,
          result,
          error: response.ok ? null : `HTTP Error ${status}`,
          status,
        });
      } catch (error) {
        console.error('Error reading response:', error);
        return this.formatOutput({
          success: false,
          result: null,
          error: `Error reading response: ${error.message}`,
          status,
        });
      }
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  async handleSSEConnection(url, params, authToken) {
    // For SSE, we need to append /stream to the URL if it doesn't already have it
    if (!url.endsWith('/stream')) {
      url += '/stream';
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    // Add authorization if token is provided
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Prepare request options
    const options = {
      method: 'POST',
      headers,
    };

    // Add payload
    if (params.payload) {
      try {
        options.body = params.payload;
        // Try to parse as JSON to validate, but keep as string for the request
        JSON.parse(params.payload);
      } catch (error) {
        throw new Error('Invalid JSON payload format');
      }
    }

    try {
      // Make the SSE request
      console.log(`Making SSE connection to: ${url}`);
      const response = await fetch(url, options);

      if (!response.ok) {
        return this.formatOutput({
          success: false,
          result: null,
          error: `HTTP Error ${response.status}`,
          status: response.status,
        });
      }

      // Read and accumulate the SSE stream
      const reader = response.body.getReader();
      let streamData = '';
      let complete = false;
      let accumulatedContent = '';

      while (!complete) {
        const { done, value } = await reader.read();

        if (done) {
          complete = true;
          break;
        }

        // Convert the chunk to text and add to streamData
        const chunk = new TextDecoder().decode(value);
        streamData += chunk;

        // Parse the SSE format (data: {...}\n\n) and extract the JSON
        const events = streamData.split('\n\n');
        streamData = events.pop() || ''; // Keep the last incomplete chunk

        for (const event of events) {
          if (event.trim() === '') continue;

          // Check for the done event
          if (event.includes('data: [DONE]')) {
            complete = true;
            break;
          }

          // Extract the data part
          const dataMatch = event.match(/data: (.+)/);
          if (dataMatch && dataMatch[1]) {
            try {
              const data = JSON.parse(dataMatch[1]);
              if (data.content) {
                accumulatedContent += data.content;
              }
            } catch (e) {
              console.error('Error parsing SSE event JSON:', e);
            }
          }
        }
      }

      // Return the accumulated content
      return this.formatOutput({
        success: true,
        result: { content: accumulatedContent },
        error: null,
        status: 200,
      });
    } catch (error) {
      throw error;
    }
  }

  async handleWebSocketConnection(url, params, authToken) {
    // For WebSocket, we need to replace http(s) with ws(s) and append /ws if needed
    const wsUrl = url.replace(/^http/, 'ws').replace(/^https/, 'wss');

    const finalWsUrl = wsUrl.endsWith('/ws') ? wsUrl : `${wsUrl}/ws`;

    return new Promise((resolve, reject) => {
      try {
        console.log(`Establishing WebSocket connection to: ${finalWsUrl}`);
        const socket = new WebSocket(finalWsUrl);

        let accumulatedContent = '';
        let timeout;

        // Set a connection timeout
        timeout = setTimeout(() => {
          socket.terminate();
          reject(new Error('WebSocket connection timeout'));
        }, 10000); // 10 seconds timeout

        socket.onopen = () => {
          clearTimeout(timeout);
          console.log('WebSocket connection established');

          // Send the payload
          if (params.payload) {
            socket.send(params.payload);
          }

          // Set a response timeout
          timeout = setTimeout(() => {
            socket.close();
            resolve(
              this.formatOutput({
                success: true,
                result: { content: accumulatedContent },
                error: 'WebSocket response timeout',
                status: 200,
              })
            );
          }, 30000); // 30 seconds response timeout
        };

        socket.onmessage = (event) => {
          clearTimeout(timeout);

          try {
            const data = JSON.parse(event.data);

            // If we get content, add it to accumulated content
            if (data.content) {
              accumulatedContent += data.content;
            }

            // If we get a completion signal, close the connection
            if (data.status === 'complete') {
              socket.close();
              resolve(
                this.formatOutput({
                  success: true,
                  result: { content: accumulatedContent },
                  error: null,
                  status: 200,
                })
              );
            }

            // Reset the timeout for the next message
            timeout = setTimeout(() => {
              socket.close();
              resolve(
                this.formatOutput({
                  success: true,
                  result: { content: accumulatedContent },
                  error: 'WebSocket response timeout',
                  status: 200,
                })
              );
            }, 30000); // 30 seconds response timeout
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        socket.onerror = (error) => {
          clearTimeout(timeout);
          console.error('WebSocket error:', error);
          socket.close();
          reject(new Error('WebSocket connection error'));
        };

        socket.onclose = () => {
          clearTimeout(timeout);
          console.log('WebSocket connection closed');

          // If the connection closes without resolving, resolve with what we have
          resolve(
            this.formatOutput({
              success: true,
              result: { content: accumulatedContent },
              error: null,
              status: 200,
            })
          );
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  validateParams(params) {
    if (!params.baseUrl) {
      throw new Error('Base URL is required');
    }

    if (!params.endpoint) {
      throw new Error('Endpoint is required');
    }

    if (!['info', 'chat', 'memory', 'tools', 'resources', 'pay'].includes(params.endpoint)) {
      throw new Error('Invalid endpoint - must be one of info, chat, memory, tools, resources, pay');
    }

    if (!params.method) {
      throw new Error('HTTP method is required');
    }

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(params.method)) {
      throw new Error('Invalid HTTP method - must be GET, POST, PUT, or DELETE');
    }

    // Validate that resourceId is provided for specific endpoints
    if (['memory', 'resources', 'pay'].includes(params.endpoint) && ['GET', 'PUT', 'DELETE'].includes(params.method) && !params.resourceId) {
      throw new Error(`Resource ID is required for ${params.method} requests to /${params.endpoint}`);
    }

    // Validate that toolId is provided for tool specific endpoints
    if (params.endpoint === 'tools' && ['GET', 'POST'].includes(params.method) && params.method !== 'GET' && !params.toolId) {
      throw new Error('Tool ID is required for accessing specific tools');
    }

    // Validate payload is present for POST and PUT requests
    if (['POST', 'PUT'].includes(params.method) && !params.payload) {
      throw new Error(`Payload is required for ${params.method} requests`);
    }

    // Validate that streaming mode is supported only for chat endpoint
    if (params.streamMode && params.streamMode !== 'none' && params.endpoint !== 'chat') {
      throw new Error('Streaming is only supported for the chat endpoint');
    }
  }

  formatOutput(output) {
    return {
      success: output.success,
      result: output.result,
      error: output.error,
      status: output.status,
    };
  }
}

export default new SLOPConnector();
