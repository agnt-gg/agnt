import BaseAction from '../BaseAction.js';

class DataTransformer extends BaseAction {
  static schema = {
    title: 'Data Transformer',
    category: 'utility',
    type: 'data-transformer',
    icon: 'transform',
    description: 'This utility node allows you to transform and manipulate data using common transformation functions.',
    parameters: {
      input: {
        type: 'string',
        inputType: 'codearea',
        description: 'The input data to be transformed',
      },
      operation: {
        type: 'string',
        inputType: 'select',
        options: [
          'Parse',
          'Stringify',
          'ToBase64',
          'Trim',
          'Uppercase',
          'Lowercase',
          'Capitalize',
          'Replace',
          'Split',
          'Join',
          'Slice',
          'Substring',
          'PadStart',
          'PadEnd',
          'Round',
          'Floor',
          'Ceil',
          'ToFixed',
        ],
        description: 'The transformation operation to apply',
      },
      arg1: {
        type: 'string',
        inputType: 'text',
        description: 'First argument for the transformation',
        conditional: {
          field: 'operation',
          value: ['Replace', 'Split', 'Join', 'Slice', 'Substring', 'PadStart', 'PadEnd', 'ToFixed'],
        },
      },
      arg2: {
        type: 'string',
        inputType: 'text',
        description: 'Second argument for the transformation',
        conditional: {
          field: 'operation',
          value: ['Replace', 'Slice', 'Substring', 'PadStart', 'PadEnd'],
        },
      },
    },
    outputs: {
      result: {
        type: 'any',
        description: 'The transformed data',
      },
      error: {
        type: 'string',
        description: 'Error message if the transformation failed',
      },
    },
  };

  constructor() {
    super('data-transformer');
  }
  async execute(params, inputData, workflowEngine) {
    try {
      const result = this.applyTransformation(params.input, params.operation.toLowerCase(), params.arg1, params.arg2);
      return { result };
    } catch (error) {
      return { error: error.message };
    }
  }
  convertToBase64(data) {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        // If it's not JSON, use the string as-is
      }
    }

    if (Array.isArray(data)) {
      return Buffer.from(data).toString('base64');
    } else if (typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
      return Buffer.from(data.data).toString('base64');
    } else {
      throw new Error('Unsupported data type for Base64 conversion');
    }
  }
  applyTransformation(data, operation, arg1, arg2) {
    switch (operation) {
      case 'parse':
        return JSON.parse(data);
      case 'stringify':
        return typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
      case 'tobase64':
        return this.convertToBase64(data);
      case 'trim':
        return data.trim();
      case 'uppercase':
        return data.toUpperCase();
      case 'lowercase':
        return data.toLowerCase();
      case 'capitalize':
        return data.charAt(0).toUpperCase() + data.slice(1);
      case 'replace':
        return data.replace(new RegExp(arg1, 'g'), arg2);
      case 'split':
        return data.split(arg1);
      case 'join':
        return Array.isArray(data) ? data.join(arg1) : data;
      case 'slice':
        return data.slice(parseInt(arg1), arg2 ? parseInt(arg2) : undefined);
      case 'substring':
        return data.substring(parseInt(arg1), arg2 ? parseInt(arg2) : undefined);
      case 'padstart':
        return data.padStart(parseInt(arg1), arg2);
      case 'padend':
        return data.padEnd(parseInt(arg1), arg2);
      case 'round':
        return Math.round(parseFloat(data));
      case 'floor':
        return Math.floor(parseFloat(data));
      case 'ceil':
        return Math.ceil(parseFloat(data));
      case 'tofixed':
        return parseFloat(data).toFixed(parseInt(arg1));
      default:
        throw new Error(`Unknown transformation operation: ${operation}`);
    }
  }
}

export default new DataTransformer();
