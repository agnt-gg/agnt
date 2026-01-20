# Using the showPrompt Component

This guide explains how to use the modal prompt functionality in your Vue components.

## Overview

The `showPrompt` feature provides a clean way to gather user input through a modal dialog. It's a wrapper around the SimpleModal component that simplifies collecting user input.

## Setup Instructions

### 1. Import and Reference the SimpleModal Component

```vue
<template>
  <div>
    <!-- Your component UI -->
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import SimpleModal from "@/views/_components/common/SimpleModal.vue";

export default {
  components: {
    SimpleModal,
  }
}
</script>
```

### 2. Add the showPrompt Method

```javascript
methods: {
  async showPrompt(title, message, defaultValue = "", options = {}) {
    const result = await this.$refs.modal.showModal({
      title,
      message,
      isPrompt: true,
      isTextArea: options.isTextArea || false,
      placeholder: defaultValue,
      defaultValue: defaultValue,
      confirmText: options.confirmText || "Save",
      cancelText: options.cancelText || "Cancel",
      confirmClass: options.confirmClass || "btn-primary",
      cancelClass: options.cancelClass || "btn-secondary",
      showCancel: options.showCancel !== undefined ? options.showCancel : true
    });
    return result === null ? null : (result || defaultValue);
  }
}
```

## Usage Examples

### Basic Usage

```javascript
async getUserName() {
  const name = await this.showPrompt(
    "Enter Name", 
    "Please enter your full name:",
    "John Doe"
  );
  
  if (name === null) {
    // User clicked cancel
    return;
  }
  
  console.log("User entered:", name);
}
```

### Using a Textarea for Longer Content

```javascript
async getDescription() {
  const description = await this.showPrompt(
    "Project Description",
    "Describe your project in detail:",
    "",
    { isTextArea: true }
  );
  
  if (description !== null) {
    // Process the description
    this.projectDescription = description;
  }
}
```

### Custom Button Text and Styling

```javascript
async confirmDeletion() {
  const reason = await this.showPrompt(
    "Confirm Deletion",
    "Please explain why you're deleting this item:",
    "",
    {
      confirmText: "Delete",
      cancelText: "Keep",
      confirmClass: "btn-danger",
      isTextArea: true
    }
  );
  
  if (reason !== null) {
    // User confirmed deletion
    this.deleteItem(reason);
  }
}
```

## Return Values

The `showPrompt` method returns:
- The text entered by the user if they confirm
- The default value if the user confirms without entering text
- `null` if the user cancels the prompt

## Available Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isTextArea` | boolean | false | Show a multiline text area instead of a single-line input |
| `confirmText` | string | "Save" | Text for the confirm button |
| `cancelText` | string | "Cancel" | Text for the cancel button |
| `confirmClass` | string | "btn-primary" | CSS class for the confirm button |
| `cancelClass` | string | "btn-secondary" | CSS class for the cancel button |
| `showCancel` | boolean | true | Whether to show the cancel button |

## Multi-step Example

```javascript
async createCustomNode() {
  const nodeName = await this.showPrompt(
    "New Custom Node",
    "Enter a name for your custom node:",
    "My Custom Node"
  );
  
  if (nodeName === null) return; // User cancelled
  
  const nodeDescription = await this.showPrompt(
    "Node Description",
    "Enter a description for your node:",
    "",
    { isTextArea: true }
  );
  
  // Create node with gathered information
  this.addCustomNode({
    name: nodeName,
    description: nodeDescription || "No description provided"
  });
}
```
