# AGNT - Agentic Graph Network Technology

> **Orchestrating Autonomous Workflows**

### 🎯 WHAT AGNT IS:

- A system orchestrator for managing complex workflows
- A graph-based network of nodes and edges
- A platform for defining and executing autonomous agent tasks
- A modular and extensible architecture

### 🚫 WHAT AGNT IS NOT:

- A specific tool or function
- A monolithic application
- A closed or proprietary system

> 💡 **AGNT enables developers to create intelligent systems by orchestrating a network of tools and agents.**

---

## 1. CORE BELIEFS

- Everything is a Workflow
- Every Tool is a Node
- Every Execution is Tracked
- Every Developer is Empowered

## 2. IMPLEMENTATIONS

AGNT is available in two language implementations:

### JavaScript (AGNT-JS)
- Modern ES modules architecture
- Runs in Node.js environments
- Perfect for web and serverless applications

### Python (AGNT-PY)
- Fully async architecture
- Compatible with Python 3.8+
- Ideal for data science and ML workflows

Both implementations share the same core concepts, workflow structure, and orchestration principles.

## 3. CORE COMPONENTS

- **AGNT (Agentic Graph Network Technology):** Manages workflow execution
- **FIRE (Functional Instruction Runtime Engine):** Executes individual nodes
- **PLUG (Parameter Lookup Utility Gateway):** Resolves parameters
- **VIBE (Visual Inference Behavior Evaluator):** Evaluates conditions
- **SPRK (Spontaneous Process & Route Kinetics):** Generates tools and workflows.

## 4. GETTING STARTED

### JavaScript Implementation

```bash
# Clone the repository
git clone https://github.com/agnt-gg/agnt
cd agnt-js

# Install dependencies
npm install

# Run example
node examples/simple-workflow.js

# Start the server
node server.js
# Server will be available at http://localhost:3000
```

#### Using the Web Interface

1. After starting the server, open your browser to `http://localhost:3000`
2. The interface allows you to:
   - Generate new tools and workflows
   - Browse available workflows
   - View workflow details and flowcharts
   - Run workflows and see execution results
   - Watch animated workflow execution

### Python Implementation

```bash
# Clone the repository
git clone https://github.com/agnt-gg/agnt
cd agnt-py

# Install dependencies
pip install -r requirements.txt

# Run example
python main.py
```

## 5. WORKFLOW DEFINITION

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

## 6. EXECUTION FLOW

1. Define workflow in JSON
2. AGNT validates the workflow
3. FIRE executes trigger nodes
4. PLUG resolves parameters
5. VIBE evaluates conditions
6. AGNT tracks execution and saves summary

## 7. CREATING CUSTOM TOOLS

### JavaScript Tools
```javascript
// tools/ExampleTool.js
export async function execute(params, inputData) {
  console.log('Executing ExampleTool with params:', params);
  console.log('Input data:', inputData);
  const result = `Processed input: ${inputData.input} with param: ${params.param1}`;
  return { result };
}
```

### Python Tools
```python
# tools/example_tool.py
async def execute(params, input_data):
    """Execute the tool functionality"""
    try:
        # Your custom logic here
        result = f"Processed input using {params['param1']}"
        
        return {
            "status": "success",
            "message": "Tool executed successfully",
            "data": {
                "result": result,
                "params": params
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
```

## 8. DOCUMENTATION

For detailed documentation on each implementation:

- [JavaScript Documentation](./AGNT-JS/README.md)
- [Python Documentation](./AGNT-py/README.md)

## 9. CONTRIBUTING

Contributions are welcome!

1. Fork the repository
2. Create a new branch
3. Implement changes
4. Write tests
5. Submit a pull request

## 10. LICENSE

MIT