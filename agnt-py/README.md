# AGNT-py - Agentic Graph Network Technology (Python)

> **Orchestrating Autonomous Workflows with Python**

### 🎯 WHAT AGNT-PY IS:

- A Python system orchestrator for managing complex workflows
- A graph-based network of nodes and edges
- A platform for defining and executing autonomous agent tasks
- A modular and extensible architecture

### 🚫 WHAT AGNT-PY IS NOT:

- A specific tool or function
- A monolithic application
- A closed or proprietary system

> 💡 **AGNT-py enables developers to create intelligent systems by orchestrating a network of Python tools and agents.**

---

## 1. CORE BELIEFS

- Everything is a Workflow
- Every Tool is a Node
- Every Execution is Tracked
- Every Developer is Empowered

## 2. CORE COMPONENTS

- **AGNT (Agentic Graph Network Technology):** Manages workflow execution
  - File: `orchestrator/AGNT.py`
- **FIRE (Fluid Instructional Runtime Engine):** Executes individual nodes
  - File: `orchestrator/FIRE.py`
- **PLUG (Parameter Lookup Utility Gateway):** Resolves parameters
  - File: `orchestrator/PLUG.py`
- **VIBE (Visual Inference Behavior Evaluator):** Evaluates conditions
  - File: `orchestrator/VIBE.py`

## 3. GETTING STARTED

### Prerequisites

- Python 3.8 or higher
- Pip (Python package manager)

### Installation

```bash
# Clone the repository
git clone [repository-url]
cd AGNT-py

# Install dependencies
pip install -r requirements.txt
```

### Quick Start

1. Run the example workflow:

```bash
python main.py
```

This will execute a simple workflow defined in `workflows/simple_workflow.json` using the basic tool.

## 4. WORKFLOW DEFINITION

Workflows are defined using a JSON format.

### Example Workflow

```json
{
  "id": "simple_workflow",
  "name": "Simple Workflow Example",
  "nodes": [
    {
      "id": "node_1",
      "type": "basic_tool",
      "category": "trigger",
      "parameters": {
        "param1": "Hello",
        "param2": "World"
      }
    },
    {
      "id": "node_2",
      "type": "basic_tool",
      "category": "action",
      "parameters": {
        "param1": "{{node_1.data.params.param1}}",
        "param2": "AGNT"
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "startNodeId": "node_1",
      "endNodeId": "node_2"
    }
  ]
}
```

### Node Structure

Each node in a workflow requires:

- `id`: Unique identifier for the node
- `type`: The type of tool to execute (must match a Python file in the `tools` directory)
- `category`: The node category (trigger, action, condition, etc.)
- `parameters`: Key-value pairs passed to the tool

### Edge Structure

Edges define the flow between nodes:

- `id`: Unique identifier for the edge
- `startNodeId`: The source node ID
- `endNodeId`: The target node ID
- `condition` (optional): Condition type for conditional edges (equals, not_equals, etc.)
- `if` (optional): The value to check
- `value` (optional): The value to compare against
- `maxIterations` (optional): Maximum number of times this edge can be traversed

## 5. EXECUTION FLOW

1. AGNT validates the workflow
2. FIRE executes trigger nodes
3. PLUG resolves parameters using template syntax `{{node_id.property.nested_property}}`
4. VIBE evaluates conditions for edges
5. AGNT tracks execution and saves summary to the `summaries` directory

## 6. CREATING CUSTOM TOOLS

Tools are Python modules executed by FIRE. Create a new file in the `tools` directory:

```python
# tools/my_custom_tool.py
async def execute(params, input_data):
    """
    Execute the tool functionality
    
    Parameters:
    - params: Dict with resolved parameters for this tool
    - input_data: Dict with input data and context from previous nodes
    
    Returns:
    - Dict containing the tool's output
    """
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

Then reference this tool in your workflow:

```json
{
  "id": "custom_node",
  "type": "my_custom_tool",
  "category": "action",
  "parameters": {
    "param1": "Custom value"
  }
}
```

## 7. FOLDER STRUCTURE
AGNT-py/
├── orchestrator/ # Core orchestration components
│ ├── init.py
│ ├── AGNT.py # Main orchestrator
│ ├── FIRE.py # Node execution engine
│ ├── PLUG.py # Parameter resolution
│ └── VIBE.py # Condition evaluation
├── tools/ # Tool implementations
│ ├── init.py
│ └── basic_tool.py # Example tool
├── utils/ # Utility functions
│ ├── init.py
│ └── ascii_art.py # ASCII art for console output
├── workflows/ # Workflow definitions
│ └── simple_workflow.json # Example workflow
├── summaries/ # Execution summaries (auto-generated)
├── examples/ # Example scripts
│ └── run_simple_workflow.py
├── main.py # Main entry point
├── requirements.txt # Dependencies
└── setup.py # Package setup


## 8. ADVANCED USAGE

### Custom Conditions

VIBE supports various conditions for edge evaluation:

- `equals`, `not_equals`: String equality
- `contains`, `not_contains`: Substring checking
- `greater_than`, `less_than`: Numeric comparison
- `greater_than_or_equal`, `less_than_or_equal`: Numeric comparison
- `between`: Range checking (format: "min,max")

### Error Handling

Tools should return an object with at least:

```python
{
    "status": "success" | "error",
    "message": "Description of the result"
}
```

### Parameter Resolution

PLUG resolves parameters using template syntax:
{{node_id.property.nested_property}}


For example, `{{node_1.data.result}}` accesses the `result` property in the `data` object of the output from node `node_1`.

## 9. TROUBLESHOOTING

### Common Issues

1. **Import Errors**: If you encounter import errors, ensure your tool modules follow the proper structure and are properly placed in the `tools` directory.

2. **Parameter Resolution**: If parameters aren't resolving correctly, check your template syntax and ensure the referenced node IDs and properties exist.

3. **Tool Execution**: If a tool fails to execute, check the error message in the workflow results.

### Debug Mode

To view detailed debug information, modify the `main.py` to print more details:

```python
import json
result = await orchestrator.execute({"trigger_data": "Example input"})
print("\nDetailed Execution Results:")
print(json.dumps(result, indent=2))
```

## 10. CONTRIBUTING

Contributions are welcome!

1. Fork the repository
2. Create a new branch
3. Implement changes
4. Write tests
5. Submit a pull request

## 11. LICENSE

MIT License