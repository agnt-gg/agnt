# Run Workflow 🔄

## Id

`run-workflow`

## Description

Executes another workflow as a sub-workflow within the current workflow execution. Supports passing data between parent and child workflows, enabling modular workflow design and reusability. Automatically handles workflow ownership verification and merges input data from both workflows.

## Tags

sub-workflow, execution, modular, reusable, workflow, chaining

## Input Parameters

### Required

- **workflowId** (string): Unique identifier of the workflow to execute as a sub-workflow
- **inputData** (object|string): Input data to pass to the sub-workflow (can be JSON object or string)

## Output Format

- **success** (boolean): Indicates whether the sub-workflow execution was successful
- **outputs** (object): Combined outputs from the sub-workflow execution
- **errors** (object): Any errors encountered during sub-workflow execution
- **subWorkflowCompleted** (boolean): Always true when execution completes
- **message** (string): Status message indicating completion status
