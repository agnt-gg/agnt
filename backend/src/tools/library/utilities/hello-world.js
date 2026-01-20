import BaseAction from '../BaseAction.js';

class HelloWorld extends BaseAction {
  static schema = {
    title: 'Hello World',
    category: 'utility',
    type: 'hello-world',
    icon: 'text',
    description: 'A simple demonstration tool that returns a greeting message.',
    parameters: {
      name: {
        type: 'string',
        inputType: 'text',
        description: 'The name to greet',
        default: 'World',
      },
    },
    outputs: {
      greeting: {
        type: 'string',
        description: 'The greeting message',
      },
    },
  };

  constructor() {
    super('hello-world');
  }

  async execute(params, inputData, workflowEngine) {
    // Automatic validation happens here
    await super.execute(params);

    const name = params.name || 'World';
    return { greeting: `Hello, ${name}!` };
  }
}

export default new HelloWorld();
