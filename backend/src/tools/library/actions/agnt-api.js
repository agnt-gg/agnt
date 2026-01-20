import BaseAction from '../BaseAction.js';
import AGNT from '../../../libs/agnt2.js';
import AuthManager from '../../../services/auth/AuthManager.js';

class AGNTAPITool extends BaseAction {
  static schema = {
    title: 'AGNT API',
    category: 'action',
    type: 'agnt-api',
    icon: 'agent',
    description: 'Interact with the AGNT API to manage workflows, tools, and agents programmatically.',
    authRequired: 'apiKey',
    authProvider: 'agnt',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: ['List', 'Get', 'Create', 'Update', 'Delete', 'Generate'],
        description: 'The action to perform',
      },
      resourceType: {
        type: 'string',
        inputType: 'select',
        options: ['Workflows', 'Tools', 'Agents'],
        description: 'The type of resource to interact with',
      },
      id: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the resource (for Get, Update, Delete actions)',
        conditional: {
          field: 'action',
          value: ['Get', 'Update', 'Delete'],
        },
      },
      data: {
        type: 'object',
        inputType: 'codearea',
        description: 'The data for the resource (for Create, Update, Generate actions)',
        conditional: {
          field: 'action',
          value: ['Create', 'Update', 'Generate'],
        },
      },
      provider: {
        type: 'string',
        inputType: 'text',
        description: 'LLM provider for Generate action',
        conditional: {
          field: 'action',
          value: 'Generate',
        },
      },
      model: {
        type: 'string',
        inputType: 'text',
        description: 'LLM model for Generate action',
        conditional: {
          field: 'action',
          value: 'Generate',
        },
      },
    },
    outputs: {
      result: {
        type: 'object',
        description: 'The result of the API action',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('agnt-api');
  }
  async execute(params, inputData, workflowEngine) {
    params.userId = workflowEngine.userId;

    this.validateParams(params);

    const apiKey = await AuthManager.getValidAccessToken(params.userId, 'agnt');
    if (!apiKey) {
      throw new Error('AGNT API key not found for this user');
    }

    const agnt = new AGNT(apiKey);

    const { action, resourceType, id, data, provider, model, userId } = params;
    const lowercaseResourceType = resourceType.toLowerCase();

    try {
      let result;
      switch (action) {
        case 'List':
          result = await agnt[lowercaseResourceType].list();
          break;
        case 'Get':
          result = await agnt[lowercaseResourceType].get(id);
          break;
        case 'Create':
          result = await agnt[lowercaseResourceType].create(data);
          break;
        case 'Update':
          result = await agnt[lowercaseResourceType].update(id, data);
          break;
        case 'Delete':
          await agnt[lowercaseResourceType].delete(id);
          result = { success: true, message: `${resourceType} deleted successfully` };
          break;
        case 'Generate':
          if (lowercaseResourceType !== 'workflows') {
            throw new Error('Generate action is only available for Workflows currently');
          }
          result = await agnt.workflows.generate(data, provider, model);
          break;
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
      return { result };
    } catch (error) {
      console.error('Error executing AGNT API action:', error);
      return { error: error.message };
    }
  }
  validateParams(params) {
    if (!params.userId) throw new Error('User ID is required');
    if (!params.action) throw new Error('Action is required');
    if (!params.resourceType) throw new Error('Resource type is required');
    if (['Get', 'Update', 'Delete'].includes(params.action) && !params.id) {
      throw new Error('ID is required for Get, Update, and Delete actions');
    }
    if (['Create', 'Update', 'Generate'].includes(params.action) && !params.data) {
      throw new Error('Data is required for Create, Update, and Generate actions');
    }
    if (!['Workflows', 'Tools', 'Agents'].includes(params.resourceType)) {
      throw new Error('Invalid resource type');
    }
  }
}

export default new AGNTAPITool();
