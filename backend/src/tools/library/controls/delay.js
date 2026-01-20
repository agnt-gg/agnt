import BaseAction from '../BaseAction.js';

class Delay extends BaseAction {
  static schema = {
    title: 'Delay',
    category: 'control',
    type: 'delay',
    icon: 'timer',
    description: 'This control node introduces a delay in the workflow execution.',
    parameters: {
      duration: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'The duration of the delay in milliseconds',
      },
      unit: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['milliseconds', 'seconds', 'minutes', 'hours'],
        description: 'The unit of time for the delay duration',
      },
    },
    outputs: {
      delayedUntil: {
        type: 'string',
        description: 'The timestamp when the delay will end',
      },
    },
  };

  constructor() {
    super('delay');
  }
  async execute(params, inputData, workflowEngine) {
    // Automatic validation happens here
    await super.execute(params);
    const duration = params.duration;
    const unit = params.unit;
    let delayMs;

    switch (unit) {
      case 'milliseconds':
        delayMs = duration;
        break;
      case 'seconds':
        delayMs = duration * 1000;
        break;
      case 'minutes':
        delayMs = duration * 60000;
        break;
      case 'hours':
        delayMs = duration * 3600000;
        break;
      default:
        throw new Error('Invalid time unit for delay');
    }

    const delayedUntil = new Date(Date.now() + delayMs).toISOString();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return this.formatOutput({ delayedUntil });
  }
}

export default new Delay();
