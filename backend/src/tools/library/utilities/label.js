import BaseAction from '../BaseAction.js';

class Label extends BaseAction {
  static schema = {
    title: 'Text Label',
    category: 'utility',
    type: 'label',
    icon: 'text',
    description: 'This utility node displays a text label in the workflow, providing additional context or information.',
    parameters: {},
    outputs: {},
  };

  constructor() {
    super('label');
  }

  async execute(_params, _inputData, _workflowEngine) {
    return {
      success: true,
      message: 'Label node - no action needed',
    };
  }
}

export default new Label();
