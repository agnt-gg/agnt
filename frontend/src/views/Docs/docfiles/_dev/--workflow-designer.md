# 🎨 Mastering the Workflow Designer

![Workflow Designer Main Screen](/images/workflow-designer.png)

The Workflow Designer is a powerful and intuitive interface for creating, editing, and managing automated agentic workflows in TaskTitan.ai. This guide will walk you through the main features and how to use them effectively.

## 🚀 Quick Start Guide

1. **Add Nodes**: Drag nodes from the sidebar onto the canvas.
2. **Connect Nodes**: Click and drag from one node's output to another node's input to create connections.
3. **Configure Nodes**: Click on a node to open its settings in the panel.
4. **Start Workflow**: Click the start workflow button in the toolbar to run the workflow.

## 🌐 Workflow Designer Overview

The Workflow Designer consists of several key components:

- **Sidebar**: Contains tools and nodes you can drag onto the canvas.
- **Canvas**: The main area where you build your workflow by adding and connecting nodes.
- **Panel**: Displays details and settings for selected nodes or edges.
- **Toolbar**: Provides actions like saving, running, and managing your workflow.

## 🔗 Integration with Tool Forge

The Workflow Designer seamlessly integrates with the Tool Forge, allowing you to incorporate custom AI tools into your workflows. This integration enhances the flexibility and functionality of your automated processes.

- **Custom Tool Nodes**: Add nodes created in the Tool Forge directly to your workflow.
- **Reusable Logic**: Utilize custom tools across multiple workflows for consistent automation.
- **Enhanced Capabilities**: Extend the functionality of your workflows with specialized tools.
- **Collaboration**: Share and import custom tools with other TaskTitan.ai users to enhance collaboration.

## 🧩 Node Types

<details open>
<summary><strong>Available Node Types</strong></summary>

| Node Type | Description | Example |
|-----------|-------------|---------|
| **Trigger** | Starts your workflow | On schedule, When data changes |
| **Action** | Performs a specific task | Send an email, Update a database |
| **Controls** | Controls the flow of your workflow | Conditions, Loops |
| **Custom** | User-created tools with specific functionality | Custom tools from Tool Forge |

</details>

## 🔗 Parameter Interpolation with {{}}

TaskTitan.ai's workflow system uses a powerful parameter interpolation system that allows you to reference data from other nodes in your workflow using the double curly bracket {{}} syntax.

### How it works:

- **Basic Syntax**: `{{nodeName.property}}`
- **Nested Properties**: `{{nodeName.object.nestedProperty}}`
- **Array Access**: `{{nodeName.arrayProperty[0]}}`

### Usage:

- **Node Configuration**: Use this syntax in text fields to dynamically pull in data from previous nodes.
- **Custom JavaScript**: Use within your code in custom JavaScript nodes.

### Examples:

- `{{receiveEmail.from}}` - Accesses the sender's email address from a "Receive Email" node.
- `{{parseCommand.result.args}}` - Retrieves the arguments array from a "Parse Command" node's result.
- `{{receiveSlackMessage.response.blocks[0].type}}` - Gets the type of the first block from a "Receive Slack Message" node's response.

### Interpolation Tips:

- The system automatically handles data types.
- If a referenced property doesn't exist, it returns the curly bracket param as a string.
- Use the output panel to inspect the data available at each node.

## 🧰 Toolbar Functions

<details open>
<summary><strong>Toolbar Options</strong></summary>

| Function | Description |
|----------|-------------|
| **Generate** | Uses AI to generate workflow automations based on your description. |
| **Start / Stop** | Toggles the workflow between active and inactive states. |
| **Save** | Saves your current workflow configuration to the server. |
| **Delete** | Permanently removes the current workflow from your account. |
| **Share** | Allows you to share your workflow with other TaskTitan.ai users. |
| **Import** | Enables you to import a workflow shared by another user. |

</details>

## 💡 Tips and Best Practices

1. **Name your nodes**: Give unique, descriptive names to your nodes for better readability.
2. **Test incrementally**: Run your workflow frequently as you build to catch issues early.
3. **Use loops carefully**: Ensure your loops have proper exit conditions to avoid infinite execution.
4. **Leverage custom tools**: Create reusable custom tools for frequently used sequences of actions.

## 🐛 Troubleshooting

> 💡 **Pro Tip**: Check node errors throughout your workflow to identify where issues occur.

- If a node isn't working as expected, check its configuration in the panel.
- Check the console for any error messages that might provide more information.

## 🔗 Related Resources

- [Tool Forge Essentials](/docs/dev/--tool-forge)
- [Coding Your Own Advanced Tools](/docs/dev/coding-new-tools)

Happy workflow crafting! 🛠️💻