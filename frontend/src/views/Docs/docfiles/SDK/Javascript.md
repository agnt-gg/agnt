# AGNT SDK Documentation

## Introduction
The AGNT SDK is a powerful tool for interacting with the AGNT API. It provides a simple and intuitive interface for managing workflows, tools, and agents programmatically.

## Installation
To install the AGNT SDK, use npm:

```bash
npm install agnt
```

## Getting Started
First, import the AGNT class from the SDK:

```javascript
import { AGNT } from 'agnt';
```

Then, create an instance of the AGNT class with your API key:

```javascript
const agnt = new AGNT('your-api-key');
```

## AGNT Class
The AGNT class is the main entry point for the SDK. It initializes the API client and provides access to various modules.

### Constructor
```javascript
new AGNT(apiKey: string, baseURL?: string)
```
- `apiKey`: Your AGNT API key
- `baseURL`: (Optional) Custom base URL for the API (default: 'http://localhost:3333/api')

### Properties
- `workflows`: Access to the Workflows module
- `tools`: Access to the Tools module
- `agents`: Access to the Agents module

## Modules
All modules (Workflows, Tools, and Agents) extend the BaseModule class, which provides common CRUD operations.

### Common Methods
These methods are available for all modules:
- `list()`: Fetch all resources
- `get(id)`: Fetch a specific resource by ID
- `create(data)`: Create a new resource
- `update(id, data)`: Update an existing resource
- `delete(id)`: Delete a resource

### Agents Module
The Agents module provides functionality for managing agents.

#### Example: Listing All Agents
```javascript
const agents = await agnt.agents.list();
console.log(agents);
```

### Workflows Module

The AGNT SDK provides a powerful interface for creating and managing workflows programmatically.

### Workflow Structure

A workflow consists of the following main components:
- `id`: Unique identifier for the workflow (generated automatically)
- `name`: Name of the workflow
- `nodes`: Array of node objects representing different actions and utilities
- `edges`: Array of edge objects connecting the nodes

### Creating a Workflow

To create a workflow, you'll need to construct an object with these components:

```javascript
const newWorkflow = {
  name: "Discord - Role Manager Bot",
  nodes: [
    // Array of node objects
  ],
  edges: [
    // Array of edge objects
  ]
};

const createdWorkflow = await agnt.workflows.create(newWorkflow);
```

### Defining Nodes

Each node in the workflow represents an action or utility. Here's an example of how to define different types of nodes:

```javascript
const nodes = [
  {
    id: "getMembers",
    text: "Get Members",
    type: "discord-api",
    icon: "discord",
    category: "action",
    parameters: {
      action: "GET_MEMBERS",
      guildId: "1291267165327986720"
    },
    x: 240,
    y: 192
  },
  {
    id: "processMembers",
    text: "Process Members",
    type: "execute-javascript",
    icon: "javascript",
    category: "utility",
    parameters: {
      code: `
        const members = {{getMembers.result.members}};
        const processedMembers = members.map(member => [
          member.id,
          member.username,
          member.displayName,
          member.joinedAt,
          member.roles.map(role => role.name).join(', ')
        ]);
        return processedMembers;
      `
    },
    x: 240,
    y: 256
  },
  // ... other nodes ...
];
```

### Defining Edges

Edges connect the nodes in your workflow. Here's how to define them:

```javascript
const edges = [
  {
    id: "edge2",
    start: { id: "getMembers", type: "output" },
    end: { id: "processMembers", type: "input" }
  },
  // ... other edges ...
];
```

### Complete Workflow Example

Here's a complete example of creating a workflow that manages Discord roles and saves data to Google Sheets:

```javascript
const newWorkflow = {
  name: "Discord - Role Manager Bot",
  nodes: [
    {
      id: "getMembers",
      text: "Get Members",
      type: "discord-api",
      icon: "discord",
      category: "action",
      parameters: {
        action: "GET_MEMBERS",
        guildId: "1291267165327986720"
      },
      x: 240,
      y: 192
    },
    {
      id: "processMembers",
      text: "Process Members",
      type: "execute-javascript",
      icon: "javascript",
      category: "utility",
      parameters: {
        code: `
          const members = {{getMembers.result.members}};
          const processedMembers = members.map(member => [
            member.id,
            member.username,
            member.displayName,
            member.joinedAt,
            member.roles.map(role => role.name).join(', ')
          ]);
          return processedMembers;
        `
      },
      x: 240,
      y: 256
    },
    {
      id: "saveToSheet",
      text: "Save to Google Sheet",
      type: "google-sheets-api",
      icon: "table",
      category: "action",
      parameters: {
        operation: "Append",
        spreadsheetId: "1bT_ykk1ZRENfJwCM2LVHK_pXUcCYW_zSsYDzAxE3fvE",
        range: "Discord Members",
        values: "{{processMembers.result}}"
      },
      x: 240,
      y: 320
    },
    {
      id: "timerTrigger",
      text: "Timer Trigger",
      type: "trigger-timer",
      icon: "clock",
      category: "trigger",
      parameters: {
        fireOnStart: "Yes",
        schedule: "Daily"
      },
      x: 240,
      y: 128
    }
  ],
  edges: [
    {
      id: "edge1",
      start: { id: "timerTrigger", type: "output" },
      end: { id: "getMembers", type: "input" }
    },
    {
      id: "edge2",
      start: { id: "getMembers", type: "output" },
      end: { id: "processMembers", type: "input" }
    },
    {
      id: "edge3",
      start: { id: "processMembers", type: "output" },
      end: { id: "saveToSheet", type: "input" }
    }
  ]
};

try {
  const createdWorkflow = await agnt.workflows.create(newWorkflow);
  console.log('Created workflow:', createdWorkflow);

  // Activate the workflow
  const activatedWorkflow = await agnt.workflows.activate(createdWorkflow.id);
  console.log('Activated workflow:', activatedWorkflow);
} catch (error) {
  console.error('An error occurred:', error);
}
```

This example creates a workflow that retrieves Discord members, processes their data, and saves it to a Google Sheet on a daily schedule. Remember to handle errors appropriately and ensure you have the necessary permissions for the APIs you're using in your workflow.

#### Additional Methods
The Workflows module provides additional methods for managing workflows:
- `activate(id)`: Activate a workflow
- `deactivate(id)`: Deactivate a workflow
- `fetchState(id)`: Fetch the current state of a workflow
- `pollState(id, interval)`: Generator function to continuously poll the workflow state

#### Example: Activating a Workflow
```javascript
const workflowId = 'workflow-123';
const result = await agnt.workflows.activate(workflowId);
console.log(result);
```

#### Example: Deactivating a Workflow
```javascript
const workflowId = 'workflow-123';
const result = await agnt.workflows.deactivate(workflowId);
console.log(result);
```

### Fetch Workflow State
```javascript
const workflowId = 'workflow-123';
const state = await agnt.workflows.fetchState(workflowId);
console.log('Current workflow state:', state);
```

#### Example: Polling Workflow State
The `pollState` method in the WorkflowsModule is a generator function that continuously fetches the state of a workflow at regular intervals. Here's what it does:

1. It takes two parameters:
--- `id`: The ID of the workflow to poll
--- `interval`: The time in milliseconds between each poll (default is 5000ms or 5 seconds)
2. It enters an infinite loop, which means it will keep running until you stop it.

3. In each iteration of the loop, it:
--- Calls the `fetchState` method to get the current state of the workflow
--- Yields this state (so you can access it in your code)
--- Waits for the specified interval before the next iteration

4. Because it's a generator function, you can use it with a `for...of` loop or by calling `.next()` on the returned generator object.

The states it returns will be one of: `running`, `stopped`, `queued`, or `listening`. These states indicate whether the workflow is actively executing (`running`), has been stopped (`stopped`), is waiting to be executed (`queued`), or is waiting for triggers/events (`listening`).

To use this method, you'd typically set up an asynchronous loop in your code to handle the yielded states, allowing you to react to state changes in real-time without constantly making separate API calls.

#### Example Usage:

```javascript
const workflowId = 'workflow-123';
for await (const state of agnt.workflows.pollState(workflowId)) {
    console.log('Current state:', state);
    if (state.status === 'completed') {
        console.log('Workflow completed!');
        break;
    }
}
```

This example polls the state of the workflow every 5 seconds (default interval) and logs each state. It stops polling when the workflow status is 'completed'.

### Tools Module
The Tools module allows you to manage custom tools.

#### Example: Creating a Custom Tool
```javascript
const newTool = {
    name: 'My Custom Tool',
    description: 'A tool for doing awesome things',
    // … other tool properties
};
const createdTool = await agnt.tools.create(newTool);
console.log(createdTool);
```

## Event Handling
The AGNT class includes an `on` method for event handling:

```javascript
agnt.on('event-name', (data) => {
    console.log('Event received:', data);
});
```

Note: The current implementation only logs the event registration. You may need to implement the actual event handling logic based on your specific requirements.

## Error Handling
The SDK uses axios for HTTP requests. You can catch and handle errors as follows:

```javascript
try {
    const workflow = await agnt.workflows.get('non-existent-id');
} catch (error) {
    if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error('Error data:', error.response.data);
        console.error('Error status:', error.response.status);
    } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received:', error.request);
    } else {
        // Something happened in setting up the request that triggered an Error
        console.error('Error message:', error.message);
    }
}
```

## Examples

### Creating and Activating a Workflow
```javascript
const newWorkflow = {
    name: 'My Workflow',
    description: 'A sample workflow',
    // … other workflow properties
};

try {
    // Create the workflow
    const createdWorkflow = await agnt.workflows.create(newWorkflow);
    console.log('Created workflow:', createdWorkflow);

    // Activate the workflow
    const activatedWorkflow = await agnt.workflows.activate(createdWorkflow.id);
    console.log('Activated workflow:', activatedWorkflow);

    // Poll the workflow state
    for await (const state of agnt.workflows.pollState(createdWorkflow.id)) {
        console.log('Current state:', state);
        if (state.status === 'completed') {
            console.log('Workflow completed!');
            break;
        }
    }
} catch (error) {
    console.error('An error occurred:', error);
}
```

This documentation provides a comprehensive guide to using the AGNT SDK. Remember to handle errors appropriately and refer to the API documentation for specific details on request and response formats for each endpoint.