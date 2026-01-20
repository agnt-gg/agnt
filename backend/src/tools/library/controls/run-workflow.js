import BaseAction from '../BaseAction.js';
import WorkflowEngine from '../../../workflow/WorkflowEngine.js';
import WorkflowModel from '../../../models/WorkflowModel.js';

class RunWorkflow extends BaseAction {
  static schema = {
    title: 'Run Workflow',
    category: 'control',
    type: 'run-workflow',
    icon: 'flow-3',
    description: 'This action node executes another complete workflow within the current workflow.',
    parameters: {
      workflowId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the workflow to run',
      },
      inputData: {
        type: 'object',
        inputType: 'codearea',
        description: 'JSON object containing input data for the sub-workflow',
      },
      waitForCompletion: {
        type: 'boolean',
        inputType: 'checkbox',
        options: ['true'],
        description: 'Wait for the sub-workflow to complete before continuing',
        default: 'true',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the sub-workflow execution was successful',
      },
      subWorkflowCompleted: {
        type: 'boolean',
        description: 'Indicates whether the sub-workflow has completed execution',
      },
      outputs: {
        type: 'object',
        description: 'The output data from the executed sub-workflow',
      },
      errors: {
        type: 'object',
        description: 'Any errors that occurred during sub-workflow execution',
      },
    },
  };

  constructor() {
    super('run-workflow');
  }

  async execute(params, inputData, workflowEngine) {
    const { workflowId, inputData: subWorkflowInputData } = params;

    try {
      // Fetch the sub-workflow
      const subWorkflow = await WorkflowModel.findOne(workflowId);
      if (!subWorkflow) {
        throw new Error(`Workflow with ID ${workflowId} not found`);
      }

      // Check if the current user owns the workflow
      if (subWorkflow.user_id !== workflowEngine.userId) {
        throw new Error(`You do not have permission to run workflow ${workflowId}`);
      }

      // Parse the workflow data
      const workflowData = JSON.parse(subWorkflow.workflow_data);

      // Merge inputData from the parent workflow with the specified subWorkflowInputData
      let mergedInputData = { ...inputData };

      if (subWorkflowInputData) {
        try {
          const parsedSubWorkflowInputData = typeof subWorkflowInputData === 'string' ? JSON.parse(subWorkflowInputData) : subWorkflowInputData;
          mergedInputData = {
            ...mergedInputData,
            ...parsedSubWorkflowInputData,
          };
        } catch (parseError) {
          console.warn(`Failed to parse subWorkflowInputData: ${parseError.message}`);
        }
      }

      // Create a new WorkflowEngine instance for the sub-workflow
      const subWorkflowEngine = new WorkflowEngine(
        workflowData,
        workflowId,
        workflowEngine.userId,
        true, // isSubWorkflow = true
        mergedInputData
      );

      // Execute the workflow and get the result
      const result = await subWorkflowEngine._executeWorkflow(mergedInputData);

      // Immediately stop the sub-workflow engine to prevent any lingering executions
      await subWorkflowEngine.stopWorkflowListeners();
      await subWorkflowEngine._updateWorkflowStatus('stopped');

      // Return a single, clean result
      return {
        success: result.success,
        outputs: {
          success: result.success,
          outputs: result.outputs,
          errors: result.errors,
          subWorkflowCompleted: true,
        },
        errors: result.errors,
        message: result.success ? 'Sub-workflow execution completed successfully' : 'Sub-workflow execution completed with errors',
      };
    } catch (error) {
      console.error(`Error executing sub-workflow: ${error.message}`);
      return {
        success: false,
        outputs: { subWorkflowCompleted: false },
        errors: { subWorkflow: error.message },
      };
    }
  }
}

export default new RunWorkflow();
