import BaseTrigger from '../BaseTrigger.js';

const calculateNextSpecificTime = (specificTime, specificDays) => {
  const now = new Date();
  const [hours, minutes] = specificTime.split(':').map(Number);
  const targetTime = new Date(now);
  targetTime.setHours(hours, minutes, 0, 0);

  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  while (!specificDays.includes(getDayName(targetTime.getDay()))) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  return targetTime.getTime() - now.getTime();
};

const getDayName = (dayIndex) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayIndex];
};

class TriggerTimer extends BaseTrigger {
  static schema = {
    title: 'Timer Trigger',
    category: 'trigger',
    type: 'trigger-timer',
    icon: 'clock',
    description: 'This trigger node fires the workflow at specified intervals or at a specific time.',
    documentation: 'https://docs.slop.ai/docs/triggers/timer-trigger',
    parameters: {
      fireOnStart: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Yes', 'No'],
        default: 'Yes',
        description: 'Fire the trigger immediately when the workflow starts',
      },
      scheduleType: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Interval', 'Specific Time'],
        default: 'Interval',
        description: 'Choose between interval-based or specific time scheduling',
      },
      schedule: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Every Minute', 'Every 5 Minutes', 'Every 15 Minutes', 'Every 30 Minutes', 'Hourly', 'Daily', 'Weekly', 'Monthly'],
        description: 'Select the interval for the timer',
        conditional: {
          field: 'scheduleType',
          value: 'Interval',
        },
      },
      specificTime: {
        type: 'string',
        inputType: 'time',
        inputSize: 'half',
        description: 'Select the specific time to run the trigger',
        conditional: {
          field: 'scheduleType',
          value: 'Specific Time',
        },
      },
      specificDays: {
        type: 'array',
        inputType: 'checkbox',
        inputSize: 'half',
        options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        description: 'Select the days to run the trigger at the specific time',
        conditional: {
          field: 'scheduleType',
          value: 'Specific Time',
        },
      },
    },
    outputs: {
      timestamp: {
        type: 'string',
        description: 'The timestamp when the trigger fired',
      },
    },
  };

  constructor() {
    super('trigger-timer');
    this.timerId = null;
    this.nodeId = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    if (!node.parameters) {
      throw new Error('Timer trigger node is missing parameters');
    }

    const { fireOnStart, scheduleType, schedule, specificTime, specificDays } = node.parameters;
    this.nodeId = node.id;

    const scheduleNextRun = () => {
      const intervalMs = this.parseSchedule(scheduleType, schedule, specificTime, specificDays);
      this.timerId = setTimeout(() => {
        engine.processWorkflowTrigger({
          type: 'timer',
          nodeId: node.id,
          timestamp: new Date().toISOString(),
        });
        scheduleNextRun(); // Schedule the next run
      }, intervalMs);

      // Store in engine's timer intervals map for cleanup
      engine.timerIntervals.set(node.id, this.timerId);
    };

    // Check if fireOnStart is "Yes" and trigger immediately if so
    if (fireOnStart === 'Yes') {
      engine.processWorkflowTrigger({
        type: 'timer',
        nodeId: node.id,
        timestamp: new Date().toISOString(),
      });
    }

    scheduleNextRun();

    console.log(`Timer trigger set up for node ${node.id} with scheduleType: ${scheduleType}, schedule: ${schedule}, fireOnStart: ${fireOnStart}`);
  }

  async validate(triggerData, node) {
    return triggerData.type === 'timer' && triggerData.nodeId === node.id;
  }

  async process(inputData) {
    return {
      timestamp: inputData.timestamp,
    };
  }

  async teardown() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    await super.teardown();
  }

  parseSchedule(scheduleType, schedule, specificTime, specificDays) {
    const now = new Date();
    if (scheduleType === 'Interval') {
      switch (schedule) {
        case 'Every Minute':
          return 60 * 1000;
        case 'Every 5 Minutes':
          return 5 * 60 * 1000;
        case 'Every 15 Minutes':
          return 15 * 60 * 1000;
        case 'Every 30 Minutes':
          return 30 * 60 * 1000;
        case 'Hourly':
          return 60 * 60 * 1000;
        case 'Daily':
          return 24 * 60 * 60 * 1000;
        case 'Weekly':
          return 7 * 24 * 60 * 60 * 1000;
        case 'Monthly': {
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          return Math.min(nextMonth.getTime() - now.getTime(), 2147483647);
        }
        default:
          throw new Error(`Invalid schedule: ${schedule}`);
      }
    } else if (scheduleType === 'Specific Time') {
      return calculateNextSpecificTime(specificTime, specificDays);
    }
    throw new Error(`Invalid scheduleType: ${scheduleType}`);
  }
}

export default new TriggerTimer();
