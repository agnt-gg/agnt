import BaseAction from '../BaseAction.js';
import axios from 'axios';

class CustomApiRequest extends BaseAction {
  static schema = {
    title: 'Custom API Request',
    category: 'action',
    type: 'custom-api',
    icon: 'connect',
    description: 'This action node makes a custom API request to any endpoint with configurable method, headers, and authentication.',
    parameters: {
      url: {
        type: 'string',
        inputType: 'text',
        description: 'The URL of the API endpoint',
      },
      method: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        description: 'The HTTP method for the request',
      },
      authType: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['None', 'Basic', 'Bearer', 'Webhook'],
        description: 'The type of authentication',
      },
      query: {
        type: 'string',
        inputType: 'text',
        description: "Query parameters for the request (e.g., 'key1=value1&key2=value2')",
      },
      headers: {
        type: 'string',
        inputType: 'codearea',
        description: 'Optional headers for the request. e.g., {"Content-Type": "application/json"}',
      },
      body: {
        type: 'object',
        inputType: 'codearea',
        description: 'Optional data to send with the request. Often JSON for APIs, but could be other formats depending on the API requirements.',
        conditional: {
          field: 'method',
          value: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
      },
      authToken: {
        type: 'string',
        inputType: 'text',
        description: 'Authentication token or credentials',
        conditional: {
          field: 'authType',
          value: ['Bearer', 'Webhook'],
        },
      },
      username: {
        type: 'string',
        inputType: 'text',
        description: 'Username for Basic authentication',
        conditional: {
          field: 'authType',
          value: 'Basic',
        },
      },
      password: {
        type: 'string',
        inputType: 'password',
        description: 'Password for Basic authentication',
        conditional: {
          field: 'authType',
          value: 'Basic',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the API request was successful',
      },
      status: {
        type: 'number',
        description: 'The HTTP status code of the response',
      },
      result: {
        type: 'object',
        description: 'The data returned by the API',
      },
      headers: {
        type: 'object',
        description: 'The headers of the API response',
      },
      error: {
        type: 'string',
        description: 'Error message if the API request failed',
      },
    },
  };

  constructor() {
    super('customApiRequest');
  }
  async execute(params) {
    this.validateParams(params);

    console.log('CustomApiRequest params:', JSON.stringify(params, null, 2));

    try {
      const { url, method, query, headers, body, authType, authToken, username, password } = params;

      // Remove angle brackets from URL if present
      const cleanUrl = url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;

      const config = {
        url: cleanUrl,
        method: method.toLowerCase(),
        headers: typeof headers === 'string' ? JSON.parse(headers || '{}') : headers || {},
      };

      if (query) {
        const queryParams = new URLSearchParams(query);
        config.url += (config.url.includes('?') ? '&' : '?') + queryParams.toString();
      }

      if (body !== undefined && body !== null) {
        if (typeof body === 'string') {
          try {
            // Try to parse as JSON
            config.data = JSON.parse(body);
            config.headers['Content-Type'] = 'application/json';
          } catch (error) {
            // If parsing fails, send as plain text
            config.data = body;
            config.headers['Content-Type'] = 'text/plain';
          }
        } else if (typeof body === 'object') {
          // If it's an object, stringify it and set Content-Type to application/json
          config.data = JSON.stringify(body);
          config.headers['Content-Type'] = 'application/json';
        } else {
          // For any other type, convert to string and send as plain text
          config.data = String(body);
          config.headers['Content-Type'] = 'text/plain';
        }
      }

      if (authType) {
        console.log('Auth configuration:', JSON.stringify({ authType, authToken, username, password }, null, 2));
        const authTypeLower = authType.toLowerCase();
        if (authTypeLower === 'basic') {
          config.auth = {
            username,
            password,
          };
        } else if (authTypeLower === 'bearer') {
          config.headers['Authorization'] = `Bearer ${authToken}`;
        } else if (authTypeLower === 'webhook') {
          config.headers['x-webhook-token'] = authToken;
        }
      }

      console.log('Final request config:', JSON.stringify(config, null, 2));

      try {
        const response = await axios(config);

        return this.formatOutput({
          success: true,
          status: response.status,
          result: response.data,
          headers: response.headers,
          error: null,
        });
      } catch (error) {
        console.error('Error making custom API request:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });

        return this.formatOutput({
          success: false,
          status: error.response ? error.response.status : null,
          result: null,
          headers: null,
          error: error.response?.data?.error || error.message,
          errorDetails: error.response?.data?.details || null,
        });
      }
    } catch (error) {
      console.error('Error making custom API request:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      return this.formatOutput({
        success: false,
        status: error.response ? error.response.status : null,
        result: null,
        headers: null,
        error: error.message,
      });
    }
  }
  validateParams(params) {
    if (!params.url || !params.method) {
      throw new Error('URL and method are required for custom API requests');
    }
    if (params.authType) {
      const authTypeLower = params.authType.toLowerCase();
      if (authTypeLower === 'basic' && (!params.username || !params.password)) {
        throw new Error('Username and password are required for Basic authentication');
      }
      if ((authTypeLower === 'bearer' || authTypeLower === 'webhook') && !params.authToken) {
        throw new Error('Auth token is required for Bearer or Webhook authentication');
      }
    }
  }
}

export default new CustomApiRequest();
