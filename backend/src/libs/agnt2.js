import axios from 'axios';

class AGNT {
  constructor(
    apiKey,
    baseURL = 'http://localhost:3333/api',
    provider = 'anthropic',
    model = 'claude-3-5-sonnet-20240620',
    authBaseURL = 'https://api.agnt.gg'
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.provider = provider;
    this.model = model;
    this.authBaseURL = authBaseURL;

    // Ensure apiKey is a string
    if (typeof this.apiKey !== 'string') {
      console.warn('Warning: API key is not a string. Converting to string.');
      this.apiKey = String(this.apiKey);
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Add provider and model to the client for easy access
    this.client.provider = this.provider;
    this.client.model = this.model;

    // Initialize all modules
    this.workflows = new WorkflowsModule(this.client);
    this.tools = new ToolsModule(this.client);
    this.users = new UsersModule(this.client);
    this.executions = new ExecutionsModule(this.client);
    this.contentOutputs = new ContentOutputsModule(this.client);
    this.stream = new StreamModule(this.client);
    this.embeddings = new EmbeddingsModule(this.client);
    this.agents = new AgentsModule(this.client);
    this.auth = new AuthModule(this.apiKey, this.authBaseURL);
  }
  async healthCheck() {
    const response = await this.client.get('/health');
    return response.data;
  }
}

class BaseModule {
  constructor(client, resourceName) {
    this.client = client;
    this.resourceName = resourceName;
  }
  async list() {
    const response = await this.client.get(`/${this.resourceName}`);
    return response.data;
  }
  async get(id) {
    const response = await this.client.get(`/${this.resourceName}/${id}`);
    return response.data;
  }
  async create(data) {
    const response = await this.client.post(`/${this.resourceName}/save`, data);
    return response.data;
  }
  async update(id, data) {
    const response = await this.client.put(`/${this.resourceName}/${id}`, data);
    return response.data;
  }
  async delete(id) {
    await this.client.delete(`/${this.resourceName}/${id}`);
  }
}

class UsersModule extends BaseModule {
  constructor(client) {
    super(client, 'users');
  }
  async getCurrentUser() {
    const response = await this.client.get(`/${this.resourceName}/me`);
    return response.data;
  }
  async login(credentials) {
    const response = await this.client.post(`/${this.resourceName}/login`, credentials);
    return response.data;
  }
  async register(userData) {
    const response = await this.client.post(`/${this.resourceName}/register`, userData);
    return response.data;
  }
  async logout() {
    const response = await this.client.post(`/${this.resourceName}/logout`);
    return response.data;
  }
}

class WorkflowsModule extends BaseModule {
  constructor(client) {
    super(client, 'workflows');
  }
  async list() {
    const response = await this.client.get(`/${this.resourceName}`);
    return response.data.workflows;
  }
  async create(workflowData) {
    // Ensure workflowData is a proper object, not a string
    const data = typeof workflowData === 'string' ? JSON.parse(workflowData) : workflowData;
    const response = await this.client.post(`/${this.resourceName}/save`, { workflow: data });
    return response.data;
  }
  async update(id, workflowData) {
    // Ensure workflowData is a proper object, not a string
    const data = typeof workflowData === 'string' ? JSON.parse(workflowData) : workflowData;
    const response = await this.client.put(`/${this.resourceName}/${id}`, { workflow: data });
    return response.data;
  }
  async activate(id) {
    const response = await this.client.post(`/${this.resourceName}/${id}/start`);
    return response.data;
  }
  async deactivate(id) {
    const response = await this.client.post(`/${this.resourceName}/${id}/stop`);
    return response.data;
  }
  async fetchState(id) {
    const response = await this.client.get(`/${this.resourceName}/${id}/status`);
    return response.data;
  }
  async *pollState(id, interval = 5000) {
    while (true) {
      yield await this.fetchState(id);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  async detectStateChanges(workflowId, interval = 1000) {
    let previousState = null;

    for await (const state of this.pollState(workflowId, interval)) {
      console.log('State:', state);

      let currentState = state.status;

      if (previousState === null) {
        previousState = currentState;
        continue;
      }

      if (previousState !== currentState) {
        const stateChange = { from: previousState, to: currentState };

        let event = null;
        if (previousState === 'stopped' && currentState === 'listening') {
          event = 'start';
        } else if (currentState === 'stopped') {
          event = 'stop';
        } else if (previousState === 'listening' && currentState === 'running') {
          event = 'trigger';
        } else if (previousState === 'running' && currentState === 'listening') {
          event = 'complete';
        } else if (previousState === 'error' || currentState === 'error' || currentState === 'Not Found') {
          event = 'error';
        }

        return { event, stateChange, errors: state.errors };
      }

      previousState = currentState;
    }
  }
  async generate(workflowElements) {
    const response = await this.client.post(`/stream/generate-workflow`, {
      ...workflowElements,
      provider: this.client.provider,
      model: this.client.model,
    });
    return response.data.workflow;
  }
  async getBySlug(slug) {
    const response = await this.client.get(`/${this.resourceName}/slug/${slug}`);
    return response.data;
  }
  async duplicate(id) {
    const response = await this.client.post(`/${this.resourceName}/${id}/duplicate`);
    return response.data;
  }
  async trigger(id, data) {
    const response = await this.client.post(`/${this.resourceName}/${id}/trigger`, data);
    return response.data;
  }
  async generateOptimizedWorkflow(options) {
    const { templateOverview, includeCustomTools = false, currentWorkflow = null, relevantWorkflows = [], relevantTools = [] } = options;

    try {
      const workflowData = {
        overview: templateOverview,
        availableTools: relevantTools,
        customTools: includeCustomTools ? await this.client.get('/custom-tools').then((r) => r.data.tools || []) : [],
        currentWorkflow: currentWorkflow,
        relevantWorkflows: relevantWorkflows,
        provider: this.client.provider,
        model: this.client.model,
      };

      const response = await this.client.post('/stream/generate-workflow', workflowData);
      return response.data;
    } catch (error) {
      console.error('Error generating optimized workflow:', error);
      throw error;
    }
  }
  async evaluateWorkflow(options) {
    const { workflowId, userQuery, result } = options;

    try {
      const evaluationPrompt = `
        Evaluate the following workflow execution result based on the original user query:
        User Query: ${userQuery}
        Workflow ID: ${workflowId}
        Execution Result: ${JSON.stringify(result)}
        
        Analyze the workflow's performance, considering factors such as:
        1. Task completion: Did the workflow accomplish the user's request?
        2. Efficiency: Was the workflow executed in a timely manner?
        3. Resource usage: Did the workflow use an appropriate number of steps and tools?
        4. Error handling: Were there any errors or unexpected issues during execution?
        
        Return your evaluation as a JSON object with:
        {
          "score": <number from 0-100>,
          "comments": "<string>",
          "strengths": ["<string>", ...],
          "improvements": ["<string>", ...]
        }
      `;

      const response = await this.client.post('/stream/start-chat-stream', {
        messages: [
          { role: 'system', content: 'You are a workflow evaluation expert.' },
          { role: 'user', content: evaluationPrompt },
        ],
        provider: this.client.provider,
        model: this.client.model,
      });

      return JSON.parse(response.data.content);
    } catch (error) {
      console.error('Error evaluating workflow:', error);
      throw error;
    }
  }
  async improveWorkflow(options) {
    const { workflow, evaluation, userQuery, relevantTools } = options;

    try {
      const workflowData = {
        overview: userQuery,
        availableTools: relevantTools,
        currentWorkflow: workflow,
        evaluation: evaluation,
        provider: this.client.provider,
        model: this.client.model,
      };

      const response = await this.client.post('/stream/improve-workflow', workflowData);
      return response.data;
    } catch (error) {
      console.error('Error improving workflow:', error);
      throw error;
    }
  }
}

class ToolsModule extends BaseModule {
  constructor(client) {
    super(client, 'custom-tools');
  }
  async generateTool(templateOverview) {
    try {
      // Call the API directly instead of using this.client.stream
      const response = await this.client.post(`/stream/generate-tool`, {
        templateOverview,
        provider: this.client.provider,
        model: this.client.model,
      });

      if (!response.data || !response.data.template) {
        throw new Error('Failed to generate tool template - empty response');
      }

      // Parse the template and transform it to the proper format
      let rawTemplate;
      let toolTemplate;

      try {
        // First parse the template string
        rawTemplate = JSON.parse(response.data.template);

        // Extract details from the template fields
        const fields = rawTemplate.fields || [];

        // Create parameters object in the required format
        const parametersObj = {};
        fields
          .filter((f) => f.type !== 'output' && f.name !== 'description' && f.name !== 'template-name')
          .forEach((f) => {
            // Convert parameter name to proper case (ex: "email-purpose" -> "Email Purpose")
            const paramName = f.name
              .split('-')
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');

            parametersObj[paramName] = {
              type: f.type || 'textarea',
              value: '',
              label: paramName,
            };
          });

        // Create outputs object
        const outputsObj = {
          generatedText: {
            type: 'string',
            description: 'The text generated by the LLM',
          },
        };

        // Generate a unique type ID
        const typeId = `custom-tool-${Date.now().toString(36)}`;

        // Map the template format to our tool format
        toolTemplate = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: rawTemplate.name || 'Custom Tool',
          description: rawTemplate.description || templateOverview,
          category: 'custom',
          type: typeId,
          base: rawTemplate.base || 'AI',
          code: rawTemplate.code || '',
          parameters: parametersObj,
          outputs: outputsObj,
          instructions: "Act as an AI assistant that helps with tasks based on the user's requirements.",
          icon: 'custom',
          isShareable: false,
          provider: this.client.provider,
          model: this.client.model,
        };
      } catch (parseError) {
        console.error('Error parsing template:', parseError.message);

        // Fallback to a basic tool template
        toolTemplate = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: 'Custom Tool',
          description: templateOverview,
          category: 'custom',
          type: `custom-tool-${Date.now().toString(36)}`,
          parameters: {
            Input: {
              type: 'textarea',
              value: '',
              label: 'Input',
            },
          },
          outputs: {
            generatedText: {
              type: 'string',
              description: 'The text generated by the LLM',
            },
          },
          instructions: "Act as an AI assistant that helps with tasks based on the user's requirements.",
          icon: 'custom',
          isShareable: false,
          provider: this.client.provider,
          model: this.client.model,
        };
      }

      return {
        template: toolTemplate,
        rawResponse: response,
      };
    } catch (error) {
      console.error('Error generating tool:', error);
      throw error;
    }
  }
  async create(data) {
    // Check if data already has a 'tool' property, if not wrap it
    const toolData = data.tool ? data : { tool: data };
    const response = await this.client.post(`/${this.resourceName}/save`, toolData);
    return response.data;
  }
}

class ExecutionsModule extends BaseModule {
  constructor(client) {
    super(client, 'executions');
  }
  async listForWorkflow(workflowId) {
    const response = await this.client.get(`/${this.resourceName}/workflow/${workflowId}`);
    return response.data;
  }
  async getActivity(params) {
    const response = await this.client.post(`/${this.resourceName}/activity`, params);
    return response.data;
  }
  async getLogs(executionId) {
    const response = await this.client.get(`/${this.resourceName}/${executionId}/logs`);
    return response.data;
  }
  async getStats(workflowId) {
    const response = await this.client.get(`/${this.resourceName}/stats/${workflowId}`);
    return response.data;
  }
  async executeWorkflow(workflowId, parameters = {}) {
    try {
      const response = await this.client.post(`/executions/start`, {
        workflowId,
        parameters,
      });
      return response.data;
    } catch (error) {
      console.error('Error executing workflow:', error);
      throw error;
    }
  }
  async getStatus(executionId) {
    try {
      const response = await this.client.get(`/executions/${executionId}/status`);
      return response.data;
    } catch (error) {
      console.error('Error getting execution status:', error);
      throw error;
    }
  }
}

class ContentOutputsModule extends BaseModule {
  constructor(client) {
    super(client, 'content-outputs');
  }
  async listForWorkflow(workflowId) {
    const response = await this.client.get(`/${this.resourceName}/workflow/${workflowId}`);
    return response.data;
  }
  async getLatestForWorkflow(workflowId) {
    const response = await this.client.get(`/${this.resourceName}/workflow/${workflowId}/latest`);
    return response.data;
  }
}

class StreamModule {
  constructor(client) {
    this.client = client;
    this.resourceName = 'stream';
  }
  async startChatStream(chatData) {
    const response = await this.client.post(`/${this.resourceName}/start-chat-stream`, {
      ...chatData,
      provider: this.client.provider,
      model: this.client.model,
    });
    return response.data;
  }
  async generateTool(toolData) {
    const response = await this.client.post(`/${this.resourceName}/generate-tool`, {
      ...toolData,
      provider: this.client.provider,
      model: this.client.model,
    });
    return response.data;
  }
  async generateWorkflow(workflowData) {
    const response = await this.client.post(`/${this.resourceName}/generate-workflow`, {
      ...workflowData,
      provider: this.client.provider,
      model: this.client.model,
    });
    return response.data;
  }
  async completeCode(codeData) {
    const response = await this.client.post(`/${this.resourceName}/complete-code`, {
      ...codeData,
      provider: this.client.provider,
      model: this.client.model,
    });
    return response.data;
  }
}

class EmbeddingsModule {
  constructor(client) {
    this.client = client;
    this.resourceName = 'embeddings';
  }
  async generate(content) {
    try {
      const response = await this.client.post(`/${this.resourceName}/generate`, {
        content,
        provider: this.client.provider,
      });
      return response.data.embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }
  async findSimilar(options) {
    const { embedding, collection, limit = 5, threshold = 0.7 } = options;

    try {
      const response = await this.client.post(`/${this.resourceName}/find-similar`, {
        embedding,
        collection,
        limit,
        threshold,
      });
      return response.data.results;
    } catch (error) {
      console.error('Error finding similar content:', error);
      throw error;
    }
  }
}

class AgentsModule extends BaseModule {
  constructor(client) {
    super(client, 'agents');
  }
  async list() {
    const response = await this.client.get(`/${this.resourceName}`);
    return response.data.agents; // Assuming the API returns { agents: [...] }
  }
  async create(agentData) {
    // The controller expects the data to be wrapped in an 'agent' object
    const response = await this.client.post(`/${this.resourceName}/save`, { agent: agentData });
    return response.data;
  }
  async update(id, agentData) {
    // The controller expects the data to be wrapped in an 'agent' object
    const response = await this.client.put(`/${this.resourceName}/${id}`, { agent: agentData });
    return response.data;
  }
}

class AuthModule {
  constructor(apiKey, authBaseURL) {
    this.client = axios.create({
      baseURL: authBaseURL, // e.g., https://api.agnt.gg
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }
  async listProviders() {
    const response = await this.client.get(`/auth/providers`);
    return response.data;
  }
  // async createProvider(data) {
  //   const response = await this.client.post(`/auth/providers`, data);
  //   return response.data;
  // }
  // async updateProvider(providerId, data) {
  //   const response = await this.client.put(`/auth/providers/${providerId}`, data);
  //   return response.data;
  // }
  // async deleteProvider(providerId) {
  //   const response = await this.client.delete(`/auth/providers/${providerId}`);
  //   return response.data;
  // }
  // async getProvider(providerId) {
  //   const response = await this.client.get(`/auth/providers/${providerId}`);
  //   return response.data;
  // }
  async storeApiKey(providerId, apiKeyString) {
    const response = await this.client.post(`/auth/apikeys/${providerId}`, { apiKey: apiKeyString });
    return response.data;
  }
  async retrieveApiKey(providerId) {
    const response = await this.client.get(`/auth/apikeys/${providerId}`);
    return response.data; // Expected: { success: true, apiKey: "..." } or { success: false, ... }
  }
  async connectProvider(providerName) {
    const response = await this.client.get(`/auth/connect/${providerName}`);
    return response.data; // Expected: { authUrl: "..." }
  }
  async disconnectProvider(providerName) {
    const response = await this.client.post(`/auth/disconnect/${providerName}`);
    return response.data;
  }
  async handleCallback(code, state) {
    const response = await this.client.post(`/auth/callback`, { code, state });
    return response.data; // Expected: { success: true, provider: "..." }
  }
  async getConnectedApps() {
    const response = await this.client.get(`/auth/connected`);
    return response.data;
  }
  async getValidToken(providerId) {
    // Assuming backend's /auth/valid-token uses req.user.id from the bearer token
    // and providerId from query param.
    const response = await this.client.get(`/auth/valid-token?providerId=${providerId}`);
    return response.data; // Expected: { access_token: "..." }
  }
}

export default AGNT;
