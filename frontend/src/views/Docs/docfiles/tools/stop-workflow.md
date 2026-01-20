# Stop Workflow 🛑

## Id

`stop-workflow`

## Description

Immediately terminates the current workflow execution with a customizable stop reason. Useful for conditional workflow termination, error handling, or early exit scenarios. Provides clear feedback about why the workflow was stopped.

## Tags

stop, terminate, exit, control, workflow, termination

## Input Parameters

### Required

- **reason** (string, default='Workflow stopped by Stop Workflow node'): Custom message explaining why the workflow was stopped

## Output Format

- **stopped** (boolean): Always true to indicate successful workflow termination
- **reason** (string): The provided stop reason message
