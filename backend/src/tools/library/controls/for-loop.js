import BaseAction from '../BaseAction.js';

class ForLoop extends BaseAction {
  static schema = {
    title: 'For Loop',
    category: 'control',
    type: 'for-loop',
    icon: 'loop',
    description: 'Executes a set of actions repeatedly for a specified number of iterations or over a list of items.',
    parameters: {
      loopType: {
        type: 'string',
        inputType: 'select',
        options: ['Range', 'List'],
        description: 'The type of loop to execute',
      },
      initialValue: {
        type: 'number',
        inputType: 'number',
        description: 'The initial value for the iteration counter',
        default: 0,
      },
      start: {
        type: 'number',
        inputType: 'number',
        description: 'The starting value for range-based loops',
        conditional: {
          field: 'loopType',
          value: 'Range',
        },
      },
      end: {
        type: 'number',
        inputType: 'number',
        description: 'The ending value (exclusive) for range-based loops',
        conditional: {
          field: 'loopType',
          value: 'Range',
        },
      },
      step: {
        type: 'number',
        inputType: 'number',
        description: 'The step value for range-based loops',
        default: 1,
        conditional: {
          field: 'loopType',
          value: 'Range',
        },
      },
      list: {
        type: 'string',
        inputType: 'textarea',
        description: 'Comma-separated list of items to iterate over',
        conditional: {
          field: 'loopType',
          value: 'List',
        },
      },
      actions: {
        type: 'string',
        inputType: 'textarea',
        description: 'Comma-separated list of action node IDs to execute in each iteration',
      },
    },
    outputs: {
      iterations: {
        type: 'number',
        description: 'The total number of iterations executed',
      },
      currentIteration: {
        type: 'number',
        description: 'The current iteration count',
      },
      results: {
        type: 'array',
        description: 'An array of results from each iteration',
      },
    },
  };

  constructor() {
    super('forLoop');
  }
  async execute(params, inputData, workflowEngine) {
    // Create a new instance-specific context for this execution
    const loopContext = {
      currentIteration: parseInt(params.initialValue) || 0,
      nodeId: workflowEngine.currentNodeId,
    };

    const generator = this.executeGenerator(params, inputData, workflowEngine, loopContext);
    let result;
    for await (const iterationResult of generator) {
      result = iterationResult;
    }
    return result;
  }
  async *executeGenerator(params, inputData, workflowEngine, loopContext) {
    this.validateParams(params);

    const loopType = params.loopType;
    const actions = params.actions.split(',').map((action) => action.trim());
    let iterations = [];

    if (loopType === 'Range') {
      const start = parseInt(params.start);
      const end = parseInt(params.end);
      const step = parseInt(params.step) || 1;
      for (let i = start; i < end; i += step) {
        iterations.push(i);
      }
    } else if (loopType === 'List') {
      iterations = this.parseList(params.list);
    }

    const results = [];

    // Find the current node to get its name
    const currentNode = workflowEngine.workflow.nodes.find((n) => n.id === loopContext.nodeId);
    const nodeName = currentNode ? currentNode.text.replace(/\s+/g, '') : 'forLoop';
    const nodeNameLowercase = nodeName.toLowerCase();

    for (const iteration of iterations) {
      const iterationResults = {};

      // Create intermediate results to yield
      const outputData = {
        iterations: iterations.length,
        currentIteration: loopContext.currentIteration,
        results: results,
      };

      // Store in multiple ways to ensure accessibility
      workflowEngine.outputs[loopContext.nodeId] = outputData;
      workflowEngine.outputs[nodeName] = outputData; // Store with camelCase node name
      workflowEngine.outputs[nodeNameLowercase] = outputData; // Store with lowercase name

      // Yield the intermediate results before each iteration
      yield this.formatOutput(outputData);

      // Execute all actions and their connected nodes for this iteration
      for (const actionName of actions) {
        try {
          const actionNode = workflowEngine.workflow.nodes.find(
            (n) => n.text.toLowerCase().replace(/\s+/g, '') === actionName.toLowerCase().replace(/\s+/g, '')
          );
          if (!actionNode) {
            throw new Error(`Node "${actionName}" not found in workflow`);
          }

          const result = await this.executeNodeAndConnected(
            actionNode,
            {
              ...inputData,
              loopValue: iteration,
              loopIndex: iterations.indexOf(iteration),
              currentIteration: loopContext.currentIteration,
            },
            workflowEngine,
            loopContext
          );

          iterationResults[actionName] = result;
        } catch (error) {
          console.error(`Error in for loop iteration ${loopContext.currentIteration} for action ${actionName}:`, error);
          iterationResults[actionName] = { error: error.message };
        }
      }

      results.push(iterationResults);

      // Increment the currentIteration at the end of each loop
      loopContext.currentIteration++;
    }

    // Yield the final results after all iterations are complete
    return this.formatOutput({
      iterations: iterations.length,
      currentIteration: loopContext.currentIteration,
      results: results,
    });
  }
  async executeNodeAndConnected(node, inputData, workflowEngine, loopContext) {
    // Store the current node ID temporarily
    const previousNodeId = workflowEngine.currentNodeId;
    workflowEngine.currentNodeId = node.id;

    const result = await workflowEngine.nodeExecutor.executeNode(node, inputData);

    // Restore the previous node ID
    workflowEngine.currentNodeId = previousNodeId;

    const connectedEdges = workflowEngine.workflow.edges.filter((edge) => edge.start.id === node.id);

    for (const edge of connectedEdges) {
      if (workflowEngine.edgeEvaluator.evaluateEdgeCondition(edge, result)) {
        workflowEngine.activeEdges.add(edge.id);
        const connectedNode = workflowEngine.workflow.nodes.find((n) => n.id === edge.end.id);
        const connectedResult = await this.executeNodeAndConnected(
          connectedNode,
          {
            ...result,
            currentIteration: loopContext.currentIteration,
          },
          workflowEngine,
          loopContext
        );
        result[connectedNode.text] = connectedResult;
      }
    }

    return result;
  }
  validateParams(params) {
    if (!params.loopType) {
      throw new Error('Loop type is required');
    }
    if (params.loopType === 'Range') {
      if (!params.start || !params.end) {
        throw new Error('Start and end values are required for range-based loops');
      }
      if (parseInt(params.start) >= parseInt(params.end)) {
        throw new Error('Start value must be less than end value');
      }
    } else if (params.loopType === 'List') {
      if (!params.list || params.list.trim().length === 0) {
        throw new Error('List of items is required for list-based loops');
      }
    }
    if (!params.actions || params.actions.trim().length === 0) {
      throw new Error('At least one action is required for the loop');
    }
    if (params.initialValue && isNaN(parseInt(params.initialValue))) {
      throw new Error('Initial value must be a number');
    }
  }
  parseList(list) {
    try {
      // First, try to parse the entire list as JSON
      const parsedList = JSON.parse(list);
      return this.flattenArray(parsedList);
    } catch (e) {
      // If parsing as JSON fails, split by comma and try to parse each item
      return list.split(',').map((item) => {
        item = item.trim();
        try {
          return JSON.parse(item);
        } catch (e) {
          return item;
        }
      });
    }
  }
  flattenArray(arr) {
    return arr.reduce((flat, item) => {
      if (Array.isArray(item)) {
        return flat.concat(this.flattenArray(item));
      } else {
        return flat.concat(item);
      }
    }, []);
  }
}

export default new ForLoop();
