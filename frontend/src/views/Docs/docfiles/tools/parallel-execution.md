# Parallel Execution ⚡

## Id

`parallel-execution`

## Description

Executes multiple workflow nodes simultaneously in parallel, significantly reducing execution time for independent tasks. Supports complex workflows by executing connected nodes following each parallel task and aggregating results from all parallel branches.

## Tags

parallel, execution, performance, concurrent, workflow, optimization

## Input Parameters

### Required

- **tasks** (string): Comma-separated list of node names to execute in parallel

## Output Format

- **results** (array): Array of results from each parallel task execution
- **error** (string|null): Combined error messages from any failed parallel executions
