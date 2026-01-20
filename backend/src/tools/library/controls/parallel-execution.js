import BaseAction from '../BaseAction.js';

class ParallelExecution extends BaseAction {
  static schema = {
    title: 'Parallel Execution',
    category: 'control',
    type: 'parallel-execution',
    icon: 'flow-2',
    description: 'This control node executes multiple tasks in parallel.',
    parameters: {
      tasks: {
        type: 'string',
        inputType: 'text',
        description:
          "Comma-separated list of node ids to be executed in parallel (e.g., 'webSearch, sendEmail'). Names are case-insensitive and spaces are ignored.",
      },
    },
    outputs: {
      results: {
        type: 'array',
        description: 'Array of results from parallel execution',
      },
    },
  };

  constructor() {
    super('parallelExecution');
  }
  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    const nodeNames = params.tasks.split(',').map((name) => name.trim());

    const executeNodeAndConnected = async (nodeName, inputData) => {
      try {
        const taskNode = workflowEngine.workflow.nodes.find(
          (n) => n.text.toLowerCase().replace(/\s+/g, '') === nodeName.toLowerCase().replace(/\s+/g, '')
        );
        if (!taskNode) {
          throw new Error(`Node "${nodeName}" not found in workflow`);
        }

        const result = await workflowEngine.nodeExecutor.executeNode(taskNode, inputData);

        const connectedEdges = workflowEngine.workflow.edges.filter((edge) => edge.start.id === taskNode.id);
        const connectedResults = await Promise.all(
          connectedEdges.map(async (edge) => {
            if (workflowEngine.edgeEvaluator.evaluateEdgeCondition(edge, result)) {
              workflowEngine.activeEdges.add(edge.id);
              const connectedNode = workflowEngine.workflow.nodes.find((n) => n.id === edge.end.id);
              return executeNodeAndConnected(connectedNode.text, result);
            }
            return null;
          })
        );

        return {
          [nodeName]: result,
          connectedResults: connectedResults.filter((r) => r !== null),
          error: null,
        };
      } catch (error) {
        console.error(`Error in parallel execution task ${nodeName}:`, error);
        return {
          [nodeName]: null,
          connectedResults: [],
          error: error.message,
        };
      }
    };

    const tasks = nodeNames.map((nodeName) => executeNodeAndConnected(nodeName, inputData));
    const allResults = await Promise.all(tasks);

    const errors = allResults.filter((result) => result.error !== null);

    return this.formatOutput({
      results: allResults,
      error: errors.length > 0 ? errors.map((e) => e.error).join('; ') : null,
    });
  }
  validateParams(params) {
    if (!params.tasks || params.tasks.length === 0) {
      throw new Error('At least one task is required for parallel execution');
    }
  }
}

export default new ParallelExecution();
