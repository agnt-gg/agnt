# Tool Schema Migration Guide

This guide explains how to migrate tool schemas from `toolLibrary.json` to individual tool files.

## Overview

The new ToolRegistry system allows tools to define their schemas directly in their implementation files, with automatic fallback to `toolLibrary.json` for tools that haven't been migrated yet.

## Benefits

- **Co-location**: Schema lives next to implementation code
- **Type Safety**: Easier to keep schema and implementation in sync
- **Maintainability**: Changes to a tool only require editing one file
- **Gradual Migration**: Migrate tools one at a time without breaking anything
- **Runtime Validation**: Schemas are validated when loaded

## Architecture

### Components

1. **ToolRegistry.js** - Central registry that aggregates schemas from both sources
2. **SchemaValidator.js** - Runtime validation for schema completeness
3. **BaseAction.js** - Updated to support static schema property
4. **ToolSchemaRoutes.js** - API endpoints to access schemas

### How It Works

1. On startup, ToolRegistry scans all tool files in `library/`
2. For each tool, it checks if the class has a static `schema` property
3. If yes, uses that schema; if no, falls back to `toolLibrary.json`
4. All schemas are validated before being registered
5. Schemas are cached for performance

## Migration Steps

### Step 1: Understand the Schema Structure

A tool schema has the following structure:

```javascript
{
  title: 'Tool Name',           // Display name
  category: 'action',           // Category: trigger, action, utility, widget, control, custom
  type: 'tool-type',            // Kebab-case identifier (must match filename)
  icon: 'icon-name',            // Icon identifier
  description: 'Description',   // What the tool does
  parameters: {                 // Input parameters
    paramName: {
      type: 'string',           // Data type
      inputType: 'text',        // UI input type
      inputSize: 'half',        // Optional: 'half' or 'full'
      description: 'Desc',      // Parameter description
      default: 'value',         // Optional: default value
      options: ['A', 'B'],      // Optional: for select/checkbox
      conditional: {            // Optional: conditional display
        field: 'otherParam',
        value: 'someValue'
      }
    }
  },
  outputs: {                    // Output values
    outputName: {
      type: 'string',           // Data type
      description: 'Desc'       // Output description
    }
  },
  authRequired: 'oauth',        // Optional: 'oauth' or 'apiKey'
  authProvider: 'google',       // Optional: provider name
  documentation: 'https://...'  // Optional: docs URL
}
```

### Step 2: Migrate a Tool

#### Example: Migrating `random-number.js`

**Before:**

```javascript
import BaseAction from './BaseAction.js';

class RandomNumber extends BaseAction {
  constructor() {
    super('random-number');
  }

  async execute(params, inputData, workflowEngine) {
    // implementation
  }
}

export default new RandomNumber();
```

**After:**

```javascript
import BaseAction from './BaseAction.js';

class RandomNumber extends BaseAction {
  // Add static schema property
  static schema = {
    title: 'Random Number',
    category: 'utility',
    type: 'random-number',
    icon: 'dice',
    description: 'Generates a random number within a specified range.',
    parameters: {
      min: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'The minimum value (inclusive)',
      },
      max: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'The maximum value (inclusive)',
      },
    },
    outputs: {
      randomNumber: {
        type: 'number',
        description: 'The generated random number',
      },
    },
  };

  constructor() {
    super('random-number');
  }

  async execute(params, inputData, workflowEngine) {
    // implementation (unchanged)
  }
}

export default new RandomNumber();
```

### Step 3: Copy Schema from toolLibrary.json

1. Open `toolLibrary.json`
2. Find your tool's schema in the appropriate category array
3. Copy the entire schema object
4. Paste it as the value of `static schema` in your tool class
5. Verify all fields are present

### Step 4: Test the Migration

1. Start the server
2. Check console logs for schema loading:
   - `✓ Loaded schema for tool-name from file` = Success!
   - `○ Using fallback schema for tool-name from toolLibrary.json` = Still using fallback
3. Test the tool in a workflow to ensure it works correctly
4. Check the API endpoint: `GET /api/tool-schemas/schemas/tool-name`

### Step 5: Remove from toolLibrary.json (Optional)

Once you've verified the tool works with its embedded schema:

1. Remove the tool's entry from `toolLibrary.json`
2. Test again to ensure it still works
3. The registry will now only use the file-based schema

## Validation

The SchemaValidator checks for:

### Required Fields

- `title` - Display name
- `category` - Must be valid category
- `type` - Must be kebab-case
- `description` - Tool description

### Parameter Validation

- Valid `inputType` values
- `options` array for select/checkbox inputs
- Proper conditional structure
- Valid `inputSize` values

### Output Validation

- Valid data types
- Descriptions (recommended)

## Common Issues

### Issue: Schema not loading from file

**Symptom:** Console shows "Using fallback schema"

**Solutions:**

1. Ensure `static schema = {...}` is defined before constructor
2. Check that the class extends `BaseAction`
3. Verify the schema object is valid JavaScript
4. Check for syntax errors in the schema

### Issue: Validation errors

**Symptom:** Console shows "Schema validation failed"

**Solutions:**

1. Check required fields are present
2. Verify category is valid
3. Ensure type matches filename (without .js)
4. Check parameter inputTypes are valid

### Issue: Tool not executing

**Symptom:** Tool fails when used in workflow

**Solutions:**

1. Ensure `execute()` method is still present
2. Check that schema type matches the tool type
3. Verify parameters match what execute() expects

## API Endpoints

### Get All Schemas

```
GET /api/tool-schemas/schemas
```

Returns all schemas organized by category.

### Get Specific Schema

```
GET /api/tool-schemas/schemas/:toolType
```

Returns schema for a specific tool.

### Get Schemas by Category

```
GET /api/tool-schemas/schemas/category/:category
```

Returns all schemas in a category.

### Get Registry Stats

```
GET /api/tool-schemas/stats
```

Returns statistics about schema sources:

```json
{
  "total": 50,
  "bySource": {
    "file": 5,
    "fallback": 45
  },
  "byCategory": {
    "action": 30,
    "utility": 10,
    "trigger": 8,
    "control": 2
  }
}
```

### Get Tool Metadata

```
GET /api/tool-schemas/metadata/:toolType
```

Returns metadata including source information.

### Reload Registry

```
POST /api/tool-schemas/reload
```

Reloads all schemas (useful during development).

## Migration Checklist

For each tool you migrate:

- [ ] Copy schema from `toolLibrary.json`
- [ ] Add `static schema = {...}` to tool class
- [ ] Verify schema structure is correct
- [ ] Test tool execution in a workflow
- [ ] Check console logs for successful loading
- [ ] Verify via API endpoint
- [ ] (Optional) Remove from `toolLibrary.json`
- [ ] Update any documentation

## Best Practices

1. **Migrate in batches** - Do 5-10 tools at a time
2. **Test thoroughly** - Verify each tool works before moving on
3. **Keep toolLibrary.json** - Don't delete it until all tools are migrated
4. **Use validation** - Pay attention to validation errors
5. **Document changes** - Note any schema improvements you make
6. **Check dependencies** - Some tools may reference others

## Example Migration Order

Suggested order for migration:

1. **Utilities** (simplest, good for testing)
   - random-number ✓
   - counter
   - data-transformer
2. **Simple Actions** (no auth required)

   - web-scrape
   - execute-javascript
   - execute-python

3. **Complex Actions** (with auth)

   - github-api
   - gmail-api
   - slack-api

4. **Triggers** (may need special handling)

   - webhook-listener
   - timer-trigger

5. **Controls** (workflow control)
   - delay
   - for-loop
   - parallel-execution

## Getting Help

If you encounter issues:

1. Check console logs for detailed error messages
2. Use `/api/tool-schemas/stats` to see migration progress
3. Use `/api/tool-schemas/metadata/:toolType` to check source
4. Review the SchemaValidator.js for validation rules
5. Look at `random-number.js` as a reference implementation

## Future Enhancements

Planned improvements:

- TypeScript definitions for schemas
- Automated migration script
- Schema versioning
- Hot-reload during development
- Schema documentation generator
