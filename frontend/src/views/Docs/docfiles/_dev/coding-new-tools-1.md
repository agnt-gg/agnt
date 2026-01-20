# 🚀 Coding Your Own Advanced Tools

The tool system is a crucial part of the AGNT ecosystem, providing an expandable range of actions, triggers, and utilities that users can incorporate into their agentic workflows.

## 🛠️ Adding a Custom Tool

To add a custom tool to the AGNT system, follow these steps:

1. Define the tool in the `/frontend/src/views/WorkflowDesigner/tools/toolLibrary.json` file
2. Create a corresponding backend JavaScript file for the tool's functionality in `/backend/workflow/tools/actions/`
3. If custom tool is a trigger, update the `/backend/workflow/tools/ToolConfig.js` file to include the new tool. This step is not needed for action type tools.
4. Ensure the icon for the custom tool is placed in the `/frontend/src/assets/icons` folder of the frontend

Let's walk through a detailed example of adding a custom "Random Number Generator" tool:

## Step 1: Define the Tool in toolLibrary.json

Define a new tool by adding the following JSON object to the array of your choice (`triggers`, `actions`, `custom`, etc..) within the `/frontend/src/views/WorkflowDesigner/tools/toolLibrary.json` file: 

This defines the tool's frontend interface, including its input properties and outputs.
```json
// add your new tool JSON to the array of your choice within toolLibrary.json:
// `triggers`, `actions`, `controls`, `utilities`, or `custom`.
// this will determine where your tool shows up on the front end

{
  "title": "Random Number Generator",
  "category": "utility", // 'trigger', 'action', 'utility', 'custom'
  "type": "random-number",
  "icon": "dice",
  "description": "Generates a random number within a specified range.",
  "parameters": {
    "min": {
      "type": "string", // 'string', 'number', 'boolean', 'object'
      "inputType": "text", // 'text', 'textarea', 'codearea', 'select', 'number'
      "description": "The minimum value (inclusive)"
    },
    "max": {
      "type": "string",
      "inputType": "text",
      "description": "The maximum value (inclusive)"
    }
  },
  "outputs": {
    "randomNumber": {
      "type": "number",
      "description": "The generated random number"
    }
  }
}
```

### 🧰 Tool Categories

Tools within the tool system can be categorized into one of five main categories:

<details open>
<summary><strong>Tool Categories</strong></summary>

1. **Triggers**: These are the starting points of workflows, listening for events or conditions to initiate the workflow.
2. **Actions**: These perform specific tasks or operations within the workflow.
3. **Controls**: These manage the flow and execution of the workflow.
4. **Utilities**: These provide additional functionality or information within the workflow.
5. **Custom** User-created tools with specific functionality. Tools created in the Tool Forge show up here.

</details>

### 🏗️ Tool Structure

Each tool in the system is defined with the following properties:

<details open>
<summary><strong>Tool Properties / Types</strong></summary>

| Property      | Type   | Description                                                       |
| ------------- | ------ | ----------------------------------------------------------------- |
| `title`       | string | The display name of the tool                                      |
| `category`    | string | The category it belongs to (trigger, action, control, or utility) |
| `type`        | string | A unique identifier for the tool                                  |
| `icon`        | string | An icon to represent the tool visually                            |
| `description` | string | A brief explanation of what the tool does                         |
| `parameters`  | object | Input fields that the user can configure                          |
| `outputs`     | object | The data that the tool produces after execution                   |

</details>

## Step 2: Create the JavaScript File

Create a new file named `random-number.js` in the `/backend/workflow/tools/actions/` directory:

**IMPORTANT:** The backend file name must match the frontend "type" property exactly (e.g. a tool with the "type" property of "random-number" would have a backend file "random-number.js")

```javascript
import BaseAction from "./BaseAction.js";
class RandomNumber extends BaseAction {
  // required constructor to extend base action 
  constructor() {
    super("random-number"); // pass tool name as param for identification
  }
  // required execute method with user defined logic
  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);
    const min = parseInt(params.min);
    const max = parseInt(params.max);
    const randomNumber = Math.floor(Math.random()(max - min + 1)) + min;
    return { randomNumber };
  }
  // optional validate method to validate params as needed
  validateParams(params) {
    if (!params.min || !params.max) {
      throw new Error("Both min and max parameters are required");
    }
    if (parseInt(params.min) >= parseInt(params.max)) {
      throw new Error("Min must be less than max");
    }
  }
  // optional formatOutput method to format your tool nodes output
  formatOutput(output) {
    return {
      ...output,
      outputs: output.result,
    };
  }
}
export default new RandomNumber();
```

## Step 3: Update ToolConfig.js (if necessary)

If your custom tool is a trigger, you'll need to update the `/frontend/src/components/tools/ToolConfig.js` file to include it.

## Step 4: Add Icon to Frontend

Ensure that the icon specified in the `icon` field of your tool definition (in this case, "dice") is placed in the `/frontend/src/assets/icons` folder of the frontend.

## 🔧 Advanced toolLibrary.json Configuration Options

For more complex tools, you can use additional configuration options in the `toolLibrary.json` file. Here's an example of a more advanced tool configuration:

<details open>
<summary><strong>Advanced Tool Configuration Example</strong></summary>

```json
{
  "title": "Advanced Data Processor",
  "category": "action",
  "type": "advanced-data-processor",
  "icon": "data",
  "description": "This action node processes data with various options and returns the result.",
  "parameters": {
    "inputData": {
      "type": "string",
      "inputType": "codearea",
      "description": "The input data to be processed"
    },
    "processingType": {
      "type": "string",
      "inputType": "select",
      "options": ["parse", "transform", "analyze"],
      "description": "The type of processing to perform",
      "default": "parse",
      "inputSize": "half"
    },
    "outputFormat": {
      "type": "string",
      "inputType": "select",
      "options": ["json", "xml", "csv"],
      "description": "The format of the output data",
      "default": "json",
      "inputSize": "half"
    },
    "advancedOptions": {
      "type": "boolean",
      "inputType": "checkbox",
      "description": "Enable advanced options",
      "default": false
    },
    "customFunction": {
      "type": "string",
      "inputType": "codearea",
      "description": "Custom processing function (JavaScript)",
      "conditional": {
        "field": "advancedOptions",
        "value": true
      }
    },
    "apiKey": {
      "type": "string",
      "inputType": "password",
      "description": "API key for external service (if needed)",
      "conditional": {
        "field": "advancedOptions",
        "value": true
      }
    },
    "maxResults": {
      "type": "number",
      "inputType": "number",
      "description": "Maximum number of results to return",
      "default": 10,
      "conditional": {
        "field": "advancedOptions",
        "value": true
      }
    }
  },
  "outputs": {
    "success": {
      "type": "boolean",
      "description": "Indicates whether the processing was successful"
    },
    "result": {
      "type": "object",
      "description": "The processed data"
    },
    "metadata": {
      "type": "object",
      "description": "Additional metadata about the processing"
    },
    "error": {
      "type": "string",
      "description": "Error message if the processing failed"
    }
  }
}
```

</details>

This advanced configuration includes:

- `inputType`: Specifies the type of input field (e.g., "text", "select", "codearea", "password", "checkbox", "number")
- `inputSize`: Defines the size of the input field (e.g., "half" for a half-width field)
- `options`: Array of available options for select inputs
- `conditional`: Allows fields to be shown or hidden based on the value of another field
- `default`: Specifies the default value for a parameter

---

## 💡 Tips for Custom Tool Development

1. **Modularity**: Design your tools to be modular and reusable across different workflows.
2. **Error Handling**: Implement robust error handling in your tool's JavaScript code.
3. **Documentation**: Provide clear descriptions for your tool's parameters and outputs.
4. **Testing**: Thoroughly test your custom tools with various inputs before deploying.
5. **Performance**: Consider the performance implications of your tool, especially for actions that may be called frequently.

> 🚀 **Pro Tip**: Prototype your custom tool ideas in a Workflow JavaScript node before implementing them fully!

## 🔗 Related Resources

- [Contribution Guidelines](/docs/dev/contribution-guidelines)
- [Tool Forge Essentials](/docs/dev/--tool-forge)
- [Mastering the Workflow Designer](/docs/dev/--workflow-designer)

Happy tool building! 🛠️💻
