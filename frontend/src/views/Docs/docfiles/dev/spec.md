# AGNT: Open Source Tool Spec

## System Overview

AGNT is an open source workflow automation platform that enables users to create powerful automated workflows by connecting various tools, triggers, and actions. The system is designed with extensibility in mind, making it easy for developers to contribute new tools and integrations.

## Core Architecture

### Key Components

- **Tool Library**: Collection of triggers, actions, utilities, and controls that can be used in workflows
- **Workflow Engine**: Executes workflows and handles data flow between tools
- **Auth System**: Manages API keys and OAuth connections for external services
- **Frontend Editor**: Visual editor for creating and managing workflows

## Extending the System

AGNT is designed to be easily extensible. Here's how you can add new capabilities:

### Adding a New Tool

1. Define the tool in the `toolLibrary.json` file
2. Create a JavaScript implementation file in the backend
3. Add necessary icons and UI elements to the frontend

## MVP Getting Started Example

Let's create a super simple "Hello World" tool:

### 1. Define the Tool in toolLibrary.json

<pre><code>{
  "title": "Hello World",
  "category": "action",
  "type": "hello-world",
  "icon": "smile",
  "description": "Outputs a simple greeting message",
  "parameters": {
    "name": {
      "type": "string",
      "inputType": "text",
      "description": "The name to greet"
    }
  },
  "outputs": {
    "greeting": {
      "type": "string",
      "description": "The greeting message"
    }
  }
}</code></pre>

### 2. Create Backend Implementation

Create a file at `backend/workflow/tools/actions/hello-world.js`:

<pre><code>import BaseAction from "./BaseAction.js";

class HelloWorld extends BaseAction {
  constructor() {
    super("hello-world");
  }
  
  async execute(params, inputData, workflowEngine) {
    // Create a simple greeting
    const name = params.name || "World";
    return { greeting: `Hello, ${name}!` };
  }
}

export default new HelloWorld();</code></pre>

### 3. Use in a Workflow

With just these two simple files, users can now include your tool in their workflows:

1. Drag the "Hello World" action into the workflow canvas
2. Enter a name in the parameter field
3. Connect the output to other tools in the workflow

That's it! Your tool is now ready to use in any workflow.

## Core Principles for Contributors

- **Simplicity First**: Keep tool implementations simple and focused
- **Reusability**: Design tools that can be used in multiple contexts
- **Clear Documentation**: Document parameters, outputs, and examples
- **Error Handling**: Implement robust error handling in all tools
- **Performance**: Consider the performance impact of your implementations

## Next Steps

For more advanced customization:

- Add OAuth integrations for external services
- Create custom triggers that listen for specific events
- Develop domain-specific utility tools
- Contribute to the core workflow engine

This specification provides a foundation for understanding and extending the AGNT platform. The simple "Hello World" example demonstrates how quickly new capabilities can be added to the system, making it ideal for open source collaboration and community contributions.