# Execute JavaScript 💻

## Id

`execute-javascript`

## Description

Executes JavaScript code in a secure isolated environment. The code runs in a separate child process with a timeout of 60 seconds for safety. It can access input data and workflow engine database if provided.

## Tags

javascript, execution, code, utility, programming

## Input Parameters

### Required

- **code** (string): The JavaScript code to execute

## Output Format

- **success** (boolean): Indicates whether the JavaScript execution was successful
- **result** (any): The result returned by the executed JavaScript code
- **error** (string|null): Error message if the JavaScript execution failed
- **outputs** (any): The result returned by the executed JavaScript code (duplicate of result for compatibility)
