# AGNT - Agentic Graph Network Technology

> **Orchestrating Autonomous Workflows**

### 🎯 WHAT AGNT IS:

-   A system orchestrator for managing complex workflows.
-   A graph-based network of nodes and edges.
-   A platform for defining and executing autonomous agent tasks.
-   A modular and extensible architecture.

### 🚫 WHAT AGNT IS NOT:

-   A specific tool or function.
-   A monolithic application.
-   A closed or proprietary system.

> 💡 **AGNT enables developers to create intelligent systems by orchestrating a network of tools and agents.**

---

## 1. CORE BELIEFS

-   Everything is a Workflow
-   Every Tool is a Node
-   Every Execution is Tracked
-   Every Developer is Empowered

## 2. CORE COMPONENTS

-   **AGNT (Agentic Graph Network Technology):** Manages workflow execution
    -   File: `orchestrator/AGNT.js`
-   **FIRE (Fluid Instructional Runtime Engine):** Executes individual nodes.
    -   File: `orchestrator/FIRE.js`
-   **PLUG (Parameter Lookup Utility Gateway):** Resolves parameters.
    -   File: `orchestrator/PLUG.js`
-   **VIBE (Visual Inference Behavior Evaluator):** Evaluates conditions.
    -   File: `orchestrator/VIBE.js`
-   **SPRK (Spontaneous Process & Route Kinetics):** Generates tools and workflows.
    -   File: `orchestrator/SPRK.js`

## 3. EXECUTION FLOW

1.  Define workflow in JSON.
2.  AGNT validates the workflow.
3.  FIRE executes trigger nodes.
4.  PLUG resolves parameters.
5.  VIBE evaluates conditions.
6.  AGNT tracks execution and saves summary.

## 4. WORKFLOW DEFINITION

Workflows are defined using a JSON format.

### Example Workflow

```json
{
  "id": "example-workflow",
  "name": "Example Workflow",
  "nodes": [
    {
      "id": "start",
      "type": "StartNode",
      "category": "trigger",
      "parameters": {}
    },
    {
      "id": "task1",
      "type": "TaskNode",
      "category": "task",
      "parameters": {
        "input": "{{start.output}}"
      }
    },
    {
      "id": "end",
      "type": "EndNode",
      "category": "utility",
      "parameters": {
        "result": "{{task1.result}}"
      }
    }
  ],
  "edges": [
    {
      "id": "edge1",
      "startNodeId": "start",
      "endNodeId": "task1"
    },
    {
      "id": "edge2",
      "startNodeId": "task1",
      "endNodeId": "end",
      "condition": "equals",
      "if": "{{task1.status}}",
      "value": "success"
    }
  ]
}
```

### Node Types

Nodes represent tasks in the workflow.

### Edges

Edges define connections between nodes.

## 5. GETTING STARTED

### Installation

```bash
git clone https://github.com/agnt-gg/agnt
cd AGNT-JS
npm install
```

### Starting the Server

Make sure you have your environment variables set up in a `.env` file (including your OpenAI API key for SPRK if you plan to use it).

```bash
# Start the server
node server.js

# Output should show:
# Server running on http://localhost:3000
```

#### Using the Web Interface

1. After starting the server, open your browser to `http://localhost:3000`
2. The interface allows you to:
   - Generate new tools and workflows
   - Browse available workflows
   - View workflow details and flowcharts
   - Run workflows and see execution results
   - Watch animated workflow execution

![Web Interface](your-screenshot-url-here)

### Running Workflows

1. Select a workflow from the list on the left
2. The workflow details will appear on the right
3. Click "Run Workflow" to execute it
4. View the execution results in the "Output" tab
5. Watch the execution animation in the "Flowchart" tab

### Generating Tools & Workflows with SPRK

You can use the SPRK system to generate new tools and workflows:

#### Via API:

```javascript
// Generate a new tool
fetch('/api/generate/tool', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    description: "A tool that fetches current weather data for a location",
    options: {
      category: "utility"
    }
  })
})
.then(response => response.json())
.then(data => console.log(data));

// Generate a new workflow
fetch('/api/generate/workflow', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    description: "A workflow that checks weather and sends an alert if it's raining"
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

## 6. TOOLS

Tools are JavaScript modules executed by FIRE.

### Example Tool

```javascript
// tools/ExampleTool.js
export async function execute(params, inputData) {
  console.log('Executing ExampleTool with params:', params);
  console.log('Input data:', inputData);
  const result = `Processed input: ${inputData.input} with param: ${params.param1}`;
  return { result };
}
```

## 7. CONTRIBUTING

Contributions are welcome!

1.  Fork the repository.
2.  Create a new branch.
3.  Implement changes.
4.  Write tests.
5.  Submit a pull request.

## 8. LICENSE

MIT

