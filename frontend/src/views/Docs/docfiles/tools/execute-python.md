# Execute Python 🐍

## Id

`execute-python`

## Description

Executes Python code in a secure sandboxed environment with built-in safety restrictions. Supports standard Python libraries and provides access to workflow data. Features 60-second timeout protection and comprehensive error handling for safe code execution.

## Tags

python, execution, code, utility, sandbox

## Input Parameters

### Required

- **code** (string): The Python code to execute (must define a 'result' variable)

## Output Format

- **success** (boolean): Indicates whether the Python execution was successful
- **result** (any): The value of the 'result' variable from executed code
- **output** (string): Console output from the Python execution
- **error** (string|null): Error message if Python execution failed
