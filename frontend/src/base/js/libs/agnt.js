import axios from "axios";
import { API_CONFIG } from "@/tt.config.js";

class AGNT {
  constructor(apiKey, baseURL = API_CONFIG.BASE_URL, provider = "anthropic", model = "claude-3-5-sonnet-20240620") {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.provider = provider;
    this.model = model;
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    // Add provider and model to the client for easy access
    this.client.provider = this.provider;
    this.client.model = this.model;

    this.workflows = new WorkflowsModule(this.client);
    this.tools = new ToolsModule(this.client);
    this.agents = new AgentsModule(this.client);
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

class AgentsModule extends BaseModule {
  constructor(client) {
    super(client, "agents");
  }
}

class WorkflowsModule extends BaseModule {
  constructor(client) {
    super(client, "workflows");
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
    const response = await this.client.post(
      `/${this.resourceName}/${id}/start`
    );
    return response.data;
  }

  async deactivate(id) {
    const response = await this.client.post(`/${this.resourceName}/${id}/stop`);
    return response.data;
  }

  async fetchState(id) {
    const response = await this.client.get(
      `/${this.resourceName}/${id}/status`
    );
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

      console.log("State:", state);

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
      model: this.client.model
    });
    return response.data.workflow;
  }
}

class ToolsModule extends BaseModule {
  constructor(client) {
    super(client, "custom-tools");
  }
}

export default AGNT;
