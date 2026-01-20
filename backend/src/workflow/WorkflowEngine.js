import EventEmitter from 'events';
import dotenv from 'dotenv';
import WorkflowModel from '../models/WorkflowModel.js';
import ToolConfig from '../tools/ToolConfig.js';
import NodeExecutor from './NodeExecutor.js';
import EdgeEvaluator from './EdgeEvaluator.js';
import ParameterResolver from './ParameterResolver.js';
import Counter from '../tools/library/utilities/counter.js';
import ExecutionModel from '../models/ExecutionModel.js';
import runWorkflowAction from '../tools/library/controls/run-workflow.js';

dotenv.config();

class WorkflowEngine extends EventEmitter {
  constructor(workflow, workflowId, userId, isSubWorkflow = false, parentInputData = {}) {
    super();
    this.workflow = workflow;
    this.workflowId = workflowId;
    this.userId = userId;
    this.receivers = {};
    this.isListening = false;
    this.stopRequested = false;
    this.triggerQueue = [];
    this.outputs = {};
    this.errors = {};
    this.currentTriggerData = null;
    this.sheetsReceiver = null;
    this.triggerListeners = new Map();
    this.timerIntervals = new Map();
    this.activeEdges = new Set();
    this.nodeExecutionCounts = new Map();
    this.edgeIterations = new Map();
    this.globalMaxIterations = 100;
    this.nodeNameToId = new Map();
    this.DB = {};
    this._initializeNodeNameMapping();
    this.nodeExecutor = new NodeExecutor(this);
    this.edgeEvaluator = new EdgeEvaluator(this);
    this.parameterResolver = new ParameterResolver(this);
    this.isSubWorkflow = isSubWorkflow;
    this.parentInputData = parentInputData;
  }

  // PUBLIC METHODS
  async setupWorkflowListeners() {
    if (!this.workflow?.nodes) {
      throw new Error(`Invalid workflow data for workflow ${this.workflowId}`);
    }
    // Set isListening BEFORE setup to handle race condition where webhooks
    // can arrive during trigger registration
    this.isListening = true;
    await this._setupTriggerListeners();
    console.log(`Workflow ${this.workflowId} is now listening for events`);
  }
  async processWorkflowTrigger(triggerData, options = {}) {
    console.log(`Received trigger for workflow ${this.workflowId}`);

    if (options.waitForCompletion) {
      console.log(`Processing synchronous trigger for workflow ${this.workflowId}`);
      return await this._executeWorkflow(triggerData);
    }

    this.triggerQueue.push(triggerData);
    if (!this.isRunning) {
      return await this._handleTriggerQueue();
    }
  }
  async stopWorkflowListeners() {
    this.stopRequested = true;
    this.isListening = false;
    this.isRunning = false;
    for (const receiver of Object.values(this.receivers)) {
      if (receiver.unsubscribe) {
        await receiver.unsubscribe();
      }
      if (receiver.stop) {
        await receiver.stop();
      }
    }
    for (const timerId of this.timerIntervals.values()) {
      clearInterval(timerId);
    }
    this.timerIntervals.clear();

    Counter.reset();

    await this._updateWorkflowStatus('stopped');
  }
  async updateWorkflowStatus(status) {
    await this._updateWorkflowStatus(status);
  }

  // PRIVATE METHODS
  async _setupTriggerListeners() {
    const triggerNodes = this.workflow.nodes.filter((node) => node.category === 'trigger');

    for (const node of triggerNodes) {
      let triggerSetup = false;

      // Try file-based trigger first (from triggers subdirectory)
      try {
        const triggerModule = await import(`../tools/library/triggers/${node.type}.js`);
        const trigger = triggerModule.default;
        if (trigger && typeof trigger.setup === 'function') {
          await trigger.setup(this, node);
          triggerSetup = true;
          console.log(`✓ Using file-based trigger setup for ${node.type}`);
        }
      } catch (importError) {
        // File-based trigger not found, will fall back to ToolConfig
        console.log(`○ File-based trigger not found for ${node.type}, trying ToolConfig`);
        console.log(`Import error details:`, importError.message);
      }

      // Backward compatibility: fall back to ToolConfig
      if (!triggerSetup) {
        const triggerConfig = ToolConfig.triggers[node.type];
        if (triggerConfig && triggerConfig.setup) {
          try {
            await triggerConfig.setup(this, node);
            console.log(`○ Using ToolConfig trigger setup for ${node.type}`);
          } catch (error) {
            console.error(`Error setting up trigger node ${node.id}: ${error.message}`);
            this._updateNodeError(node.id, error.message);
            this.emit('workflowError', { nodeId: node.id, error: error.message });
            await this._updateWorkflowStatus('error');
          }
        } else {
          console.warn(`No setup function found for trigger type: ${node.type}`);
        }
      }
    }

    // After setting up all triggers, check if there are any errors
    if (Object.keys(this.errors).length > 0) {
      const errorMessage = Object.values(this.errors).join('; ');
      this.emit('workflowError', {
        globalError: errorMessage,
        nodeErrors: this.errors,
      });
      await this._updateWorkflowStatus('error');
      // Set isListening to false on error since we set it to true before setup
      this.isListening = false;
    }
  }
  async _executeWorkflow(triggerData) {
    console.log(`Executing workflow ${this.workflowId} with trigger data:`, JSON.stringify(triggerData));

    const executionId = await ExecutionModel.create(this.workflowId, this.userId, this.workflow.name);
    this.currentExecutionId = executionId;
    let executionLog = '';
    let totalCreditsUsed = 0;

    try {
      await this._updateWorkflowStatus('running');
      executionLog += `Workflow execution started.\n`;

      this.outputs = {};
      this.errors = {};
      this.currentTriggerData = triggerData;
      this.activeEdges.clear();

      // Merge triggerData with parentInputData for sub-workflows
      // You can use {{trigger}} and {{input}} in the sub-workflow to access the merged data
      if (this.isSubWorkflow) {
        const mergedData = { ...this.parentInputData, ...triggerData };
        this.currentTriggerData = {
          trigger: mergedData,
          input: mergedData,
        };
      } else {
        this.currentTriggerData = {
          trigger: triggerData,
          input: triggerData,
        };
      }

      const nodeMap = new Map(this.workflow.nodes.map((node) => [node.id, node]));
      const edgeMap = new Map();

      for (const edge of this.workflow.edges) {
        if (!edgeMap.has(edge.start.id)) {
          edgeMap.set(edge.start.id, []);
        }
        edgeMap.get(edge.start.id).push(edge);
      }

      let startNodes;
      if (this.isSubWorkflow) {
        startNodes = this._findStartNodes();
        if (startNodes.length === 0) {
          throw new Error('No valid start nodes found for sub-workflow');
        }
      } else {
        // For main workflows, find matching trigger nodes using file-based validation
        startNodes = [];
        for (const node of this.workflow.nodes) {
          if (node.category !== 'trigger') continue;

          let isValid = false;

          // Try file-based trigger validation first
          try {
            const triggerModule = await import(`../tools/library/triggers/${node.type}.js`);
            const trigger = triggerModule.default;
            if (trigger && typeof trigger.validate === 'function') {
              isValid = await trigger.validate(triggerData, node);
            }
          } catch (error) {
            // Fall back to ToolConfig validation for backward compatibility
            const triggerConfig = ToolConfig.triggers[node.type];
            if (triggerConfig && triggerConfig.validate) {
              isValid = triggerConfig.validate(triggerData, node);
            } else {
              // No validation available, assume valid
              isValid = true;
            }
          }

          if (isValid) {
            startNodes.push(node);
          }
        }

        if (startNodes.length === 0) {
          console.warn('No matching trigger node found for the incoming data. Using first node as start.');
          startNodes.push(this.workflow.nodes[0]);
        }
      }

      for (const startNode of startNodes) {
        executionLog += `Starting execution with node: ${startNode.id} (${startNode.text})\n`;

        const startNodeResult = await this.nodeExecutor.executeNode(startNode, triggerData);
        if (startNodeResult.error) {
          this._updateNodeError(startNode.id, startNodeResult.error);
        }

        console.log('START NODE RESULT', startNodeResult);

        // IF CREDITS ARE INSUFFICIENT, UPDATE EXECUTION STATUS AND RETURN ERROR
        if (startNodeResult.error && startNodeResult.error.includes('Insufficient credits')) {
          await ExecutionModel.update(this.currentExecutionId, 'insufficient-credits', executionLog, totalCreditsUsed);

          // stop any trigger listeners
          await this.stopWorkflowListeners();

          await this._updateWorkflowStatus('insufficient-credits');

          return {
            success: false,
            outputs: {},
            errors: { globalError: 'Insufficient credits' },
            creditsUsed: totalCreditsUsed,
          };
        }

        let currentNodeData = startNodeResult;
        const executionQueue = [startNode.id];

        // // Initialize with trigger data directly
        // let currentNodeData = this.currentTriggerData;
        // const executionQueue = [startNode.id];

        this.nodeExecutionCounts.clear();
        this.edgeIterations.clear();

        // Track time for adaptive yielding
        let lastYieldTime = Date.now();

        while (executionQueue.length > 0) {
          // Yield to event loop every 50ms OR at each node (whichever comes first)
          const now = Date.now();
          if (now - lastYieldTime >= 50) {
            await new Promise((resolve) => setImmediate(resolve));
            lastYieldTime = Date.now();
          }

          const nodeId = executionQueue.shift();
          const node = nodeMap.get(nodeId);
          executionLog += `Executing node: ${node.id} (${node.text})\n`;

          let nodeResult;

          if (this.stopRequested) {
            console.log(`Workflow stopped: ${this.stopReason}`);
            executionLog += `Workflow stopped: ${this.stopReason}\n`;
            await this.stopWorkflowListeners();
            await this._updateWorkflowStatus('stopped');
            await ExecutionModel.update(this.currentExecutionId, this.stopReason, executionLog, totalCreditsUsed);
            return {
              success: true,
              outputs: this.outputs,
              errors: this.errors,
              stopped: true,
              reason: this.stopReason,
              creditsUsed: totalCreditsUsed,
            };
          }

          if (node.type === 'stop-workflow') {
            console.log(`Stop Workflow node encountered: ${node.id}`);
            executionLog += `Stop Workflow node encountered: ${node.id}\n`;
            this.stopRequested = true;
            this.stopReason = 'Stop Workflow node encountered';

            // Execute the stop-workflow node
            nodeResult = await this.nodeExecutor.executeNode(node, currentNodeData);

            // Break the execution loop
            break;
          } else if (node.type === 'run-workflow') {
            nodeResult = await runWorkflowAction.execute(
              {
                ...this.parameterResolver.resolveParameters(node.parameters),
                nodeId: node.id,
              },
              currentNodeData,
              this
            );
            // Store the entire sub-workflow result
            this.outputs[node.id] = nodeResult.outputs;
            if (nodeResult.errors && Object.keys(nodeResult.errors).length > 0) {
              this.errors[node.id] = nodeResult.errors;
            }
            executionLog += `Sub-workflow execution completed for node ${node.id}: ${nodeResult.message || 'No message'}\n`;
            currentNodeData = nodeResult.outputs; // Pass sub-workflow outputs to next node
          } else {
            nodeResult = await this.nodeExecutor.executeNode(node, currentNodeData);
          }

          if (nodeResult.error) {
            this._updateNodeError(node.id, nodeResult.error);
            executionLog += `Error in node ${node.id}: ${nodeResult.error}\n`;

            // Check for insufficient credits and stop the workflow if detected
            if (nodeResult.error.includes('Insufficient credits')) {
              await this._updateWorkflowStatus('insufficient-credits');
              await ExecutionModel.update(this.currentExecutionId, 'insufficient-credits', executionLog, totalCreditsUsed);
              return {
                success: false,
                outputs: this.outputs,
                errors: this.errors,
                creditsUsed: totalCreditsUsed,
              };
            }
          }
          currentNodeData = nodeResult;

          const edges = edgeMap.get(nodeId) || [];
          for (const edge of edges) {
            const edgeIterations = this.edgeIterations.get(edge.id) || 0;
            executionLog += `Edge ${edge.id} iterations: ${edgeIterations}\n`;

            const resolvedMaxIterations = edge.maxIterations ? this.parameterResolver.resolveTemplate(edge.maxIterations) : 'Infinity';
            const edgeMaxIterations = resolvedMaxIterations === 'Infinity' ? Infinity : parseInt(resolvedMaxIterations) || Infinity;

            executionLog += `Edge ${edge.id} max iterations: ${edgeMaxIterations}\n`;
            if (edgeMaxIterations !== Infinity && edgeIterations >= edgeMaxIterations) {
              executionLog += `Max iterations (${edgeMaxIterations}) reached for edge ${edge.id}. Skipping.\n`;
              continue;
            }

            if (this.edgeEvaluator.evaluateEdgeCondition(edge, currentNodeData)) {
              executionQueue.push(edge.end.id);
              this.activeEdges.add(edge.id);
              this.edgeIterations.set(edge.id, edgeIterations + 1);
              executionLog += `Edge ${edge.id} condition met. Queuing next node: ${edge.end.id}\n`;
            }
          }

          if (this.edgeIterations.size > 0 && Math.max(...this.edgeIterations.values()) > this.globalMaxIterations) {
            executionLog += `Global max iterations (${this.globalMaxIterations}) reached. Stopping execution.\n`;
            break;
          }
        }

        if (this.stopRequested) {
          console.log(`Workflow stopped: ${this.stopReason}`);
          executionLog += `Workflow stopped: ${this.stopReason}\n`;
          await this.stopWorkflowListeners();
          await this._updateWorkflowStatus('stopped');
          await ExecutionModel.update(this.currentExecutionId, this.stopReason, executionLog, totalCreditsUsed);
          return {
            success: true,
            outputs: this.outputs,
            errors: this.errors,
            stopped: true,
            reason: this.stopReason,
            creditsUsed: totalCreditsUsed,
          };
        }
      }

      totalCreditsUsed = await ExecutionModel.getTotalCreditsUsed(executionId);

      if (Object.keys(this.errors).length > 0) {
        this.emit('workflowError', this.errors);
        await this._updateWorkflowStatus('error');
        executionLog += `Workflow completed with errors.\n`;
      } else if (!this.stopRequested) {
        await this._updateWorkflowStatus('listening');
        executionLog += `Workflow completed successfully.\n`;
      }

      // Update the workflow execution with the total credits used
      await ExecutionModel.update(executionId, Object.keys(this.errors).length > 0 ? 'error' : 'completed', executionLog, totalCreditsUsed);

      return {
        success: Object.keys(this.errors).length === 0,
        outputs: this.outputs,
        errors: this.errors,
        creditsUsed: totalCreditsUsed,
      };
    } catch (error) {
      console.error(`Error executing workflow ${this.workflowId}:`, error);
      executionLog += `Fatal error: ${error.message}\n`;
      totalCreditsUsed = await ExecutionModel.getTotalCreditsUsed(executionId);
      await ExecutionModel.update(executionId, 'error', executionLog, totalCreditsUsed);
      await this._updateWorkflowStatus('error');
      return {
        success: false,
        outputs: {},
        errors: { globalError: error.message },
        creditsUsed: totalCreditsUsed,
      };
    }
  }
  async _handleTriggerQueue() {
    if (this.isRunning || this.triggerQueue.length === 0) return;

    this.isRunning = true;

    // Process queue without blocking - run asynchronously
    (async () => {
      while (this.triggerQueue.length > 0 && !this.stopRequested) {
        const triggerData = this.triggerQueue.shift();
        try {
          await this._executeWorkflow(triggerData);
        } catch (error) {
          console.error(`Error processing trigger for workflow ${this.workflowId}:`, error);
          this.emit('workflowError', { globalError: error.message });
        }
      }
      this.isRunning = false;

      // Check if more items were added while processing
      if (this.triggerQueue.length > 0) {
        setImmediate(() => this._handleTriggerQueue());
      }
    })();

    // Return immediately without waiting
    return { success: true, message: 'Trigger queued for processing' };
  }
  async _updateWorkflowStatus(status) {
    try {
      await WorkflowModel.updateStatus(this.workflowId, status);
    } catch (error) {
      console.error(`Error updating workflow status: ${error.message}`);
      throw error;
    }
  }
  _initializeNodeNameMapping() {
    this.workflow.nodes.forEach((node) => {
      this.nodeNameToId.set(node.text.toLowerCase().replace(/\s+/g, ''), node.id);
    });
  }
  _updateNodeError(nodeId, error) {
    this.errors[nodeId] = error;
  }
  _findStartNodes() {
    const incomingEdges = new Set(this.workflow.edges.map((edge) => edge.end.id));
    return this.workflow.nodes.filter((node) => !incomingEdges.has(node.id));
  }
}

export default WorkflowEngine;
