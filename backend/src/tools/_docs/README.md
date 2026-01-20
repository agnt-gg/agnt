# Tool Registry System

A flexible tool schema management system that allows tools to define their schemas directly in their implementation files, with automatic fallback to `toolLibrary.json`.

## Quick Start

### Running the Test

```bash
cd product/desktop/backend
node src/tools/test-registry.js
```

### Using the API

```bash
# Get all schemas
curl http://localhost:3000/api/tool-schemas/schemas

# Get specific tool schema
curl http://localhost:3000/api/tool-schemas/schemas/random-number

# Get registry statistics
curl http://localhost:3000/api/tool-schemas/stats
```

## Architecture

### Components

```
src/tools/
├── ToolRegistry.js          # Central schema registry (singleton)
├── SchemaValidator.js       # Runtime schema validation
├── toolLibrary.json         # Fallback schema source
├── library/
│   ├── BaseAction.js        # Base class with schema support
│   ├── random-number.js     # Example migrated tool ✓
│   └── ...                  # Other tools (using fallback)
└── routes/
    └── ToolSchemaRoutes.js  # API endpoints
```

### How It Works

```
┌─────────────────┐
│  Tool File      │
│  (e.g., foo.js) │
└────────┬────────┘
         │
         ▼
    Has static
    schema?
         │
    ┌────┴────┐
    │         │
   Yes       No
    │         │
    ▼         ▼
┌───────┐  ┌──────────────┐
│ Use   │  │ Fallback to  │
│ File  │  │ toolLibrary  │
│ Schema│  │ .json        │
└───┬───┘  └──────┬───────┘
    │             │
    └──────┬──────┘
           ▼
    ┌──────────────┐
    │  Validate    │
    │  Schema      │
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │  Register in │
    │  ToolRegistry│
    └──────────────┘
```

## Features

### ✅ Implemented

- **Hybrid Schema Loading** - File-first with JSON fallback
- **Runtime Validation** - Comprehensive schema validation
- **Singleton Registry** - Single source of truth for schemas
- **API Endpoints** - RESTful access to schemas
- **Migration Support** - Gradual migration path
- **Statistics** - Track migration progress
- **Error Handling** - Graceful degradation on errors

### 🔄 Current Status

- **Migrated Tools**: 1 (random-number)
- **Fallback Tools**: ~50+
- **Migration Progress**: ~2%

## API Reference

### Endpoints

| Method | Endpoint                                  | Description                     |
| ------ | ----------------------------------------- | ------------------------------- |
| GET    | `/api/tool-schemas/schemas`               | Get all schemas by category     |
| GET    | `/api/tool-schemas/schemas/:toolType`     | Get specific tool schema        |
| GET    | `/api/tool-schemas/schemas/category/:cat` | Get schemas by category         |
| GET    | `/api/tool-schemas/stats`                 | Get registry statistics         |
| GET    | `/api/tool-schemas/metadata/:toolType`    | Get tool metadata (with source) |
| POST   | `/api/tool-schemas/reload`                | Reload registry (dev only)      |

### Response Examples

#### Get All Schemas

```json
{
  "triggers": [...],
  "actions": [...],
  "utilities": [
    {
      "title": "Random Number",
      "category": "utility",
      "type": "random-number",
      "icon": "dice",
      "description": "Generates a random number...",
      "parameters": {...},
      "outputs": {...}
    }
  ],
  "widgets": [...],
  "controls": [...],
  "custom": [...]
}
```

#### Get Statistics

```json
{
  "total": 51,
  "bySource": {
    "file": 1,
    "fallback": 50
  },
  "byCategory": {
    "trigger": 8,
    "action": 30,
    "utility": 9,
    "widget": 7,
    "control": 5,
    "custom": 1
  }
}
```

#### Get Metadata

```json
{
  "schema": {...},
  "source": "file",
  "toolType": "random-number",
  "category": "utility",
  "validated": true
}
```

## Migration Guide

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for detailed instructions.

### Quick Migration Steps

1. **Copy schema from toolLibrary.json**
2. **Add to tool class:**

```javascript
class MyTool extends BaseAction {
  static schema = {
    // paste schema here
  };

  // rest of implementation
}
```

3. **Test and verify**
4. **(Optional) Remove from toolLibrary.json**

## Schema Structure

### Required Fields

```javascript
{
  title: 'Tool Name',        // Display name
  category: 'action',        // Category
  type: 'tool-type',         // Kebab-case identifier
  description: 'What it does' // Description
}
```

### Optional Fields

```javascript
{
  icon: 'icon-name',         // Icon identifier
  documentation: 'https://...', // Docs URL
  authRequired: 'oauth',     // Auth type
  authProvider: 'google',    // Auth provider
  parameters: {...},         // Input parameters
  outputs: {...}             // Output values
}
```

### Parameter Definition

```javascript
parameters: {
  paramName: {
    type: 'string',          // Data type
    inputType: 'text',       // UI input type
    inputSize: 'half',       // 'half' or 'full'
    description: 'Desc',     // Description
    default: 'value',        // Default value
    options: ['A', 'B'],     // For select/checkbox
    conditional: {           // Conditional display
      field: 'otherParam',
      value: 'someValue'
    }
  }
}
```

### Output Definition

```javascript
outputs: {
  outputName: {
    type: 'string',          // Data type
    description: 'Desc'      // Description
  }
}
```

## Validation Rules

### Schema Validation

- ✓ Required fields present
- ✓ Valid category
- ✓ Kebab-case type
- ✓ Valid parameter types
- ✓ Valid input types
- ✓ Options for select/checkbox
- ✓ Valid conditional structure

### Parameter Validation

Valid `inputType` values:

- `text`, `textarea`, `number`
- `select`, `checkbox`
- `readonly`, `time`
- `codearea`, `agent-select`
- `password`

Valid `type` values:

- `string`, `number`, `boolean`
- `array`, `object`, `code`

## Development

### Testing

```bash
# Run test script
node src/tools/test-registry.js

# Expected output:
# ✓ Registry initialized
# ✓ Schema found: Random Number
#   Source: file
# ✓ SUCCESS: At least one tool is using file-based schema!
```

### Debugging

Enable detailed logging:

```javascript
// In ToolRegistry.js
console.log('Loading schema for:', toolType);
console.log('Schema source:', source);
console.log('Validation result:', validation);
```

### Common Issues

**Issue**: Schema not loading from file

```
○ Using fallback schema for tool-name from toolLibrary.json
```

**Fix**: Ensure `static schema = {...}` is defined before constructor

**Issue**: Validation errors

```
Schema validation failed for tool-name: Missing required field: title
```

**Fix**: Check schema has all required fields

## Performance

### Caching

- Schemas loaded once on initialization
- Cached in memory for fast access
- No disk I/O after initial load

### Benchmarks

- Registry initialization: ~100-200ms
- Schema lookup: <1ms (cached)
- Validation: ~1-5ms per schema

## Future Enhancements

### Planned

- [ ] TypeScript definitions for schemas
- [ ] Automated migration script
- [ ] Schema versioning
- [ ] Hot-reload during development
- [ ] Schema documentation generator
- [ ] Visual schema editor
- [ ] Schema diff tool
- [ ] Migration progress dashboard

### Ideas

- Schema inheritance for similar tools
- Schema composition for complex tools
- Schema templates for common patterns
- Automated schema generation from code
- Schema validation in CI/CD

## Contributing

### Adding a New Tool

1. Create tool file in `library/`
2. Extend `BaseAction`
3. Define `static schema`
4. Implement `execute()` method
5. Export singleton instance
6. Test with test script

### Migrating an Existing Tool

1. Find schema in `toolLibrary.json`
2. Copy to tool file as `static schema`
3. Test execution
4. Verify via API
5. (Optional) Remove from JSON

## Examples

### Simple Tool (No Parameters)

```javascript
class HelloWorld extends BaseAction {
  static schema = {
    title: 'Hello World',
    category: 'utility',
    type: 'hello-world',
    icon: 'wave',
    description: 'Says hello',
    outputs: {
      message: {
        type: 'string',
        description: 'The greeting message',
      },
    },
  };

  async execute(params, inputData, workflowEngine) {
    return { message: 'Hello, World!' };
  }
}
```

### Tool with Parameters

```javascript
class Greeter extends BaseAction {
  static schema = {
    title: 'Greeter',
    category: 'utility',
    type: 'greeter',
    icon: 'wave',
    description: 'Greets a person',
    parameters: {
      name: {
        type: 'string',
        inputType: 'text',
        description: 'Name to greet',
      },
    },
    outputs: {
      greeting: {
        type: 'string',
        description: 'The greeting',
      },
    },
  };

  async execute(params, inputData, workflowEngine) {
    return { greeting: `Hello, ${params.name}!` };
  }
}
```

### Tool with Auth

```javascript
class GitHubTool extends BaseAction {
  static schema = {
    title: 'GitHub Tool',
    category: 'action',
    type: 'github-tool',
    icon: 'github',
    description: 'Interacts with GitHub',
    authRequired: 'oauth',
    authProvider: 'github',
    parameters: {
      repo: {
        type: 'string',
        inputType: 'text',
        description: 'Repository name',
      },
    },
    outputs: {
      result: {
        type: 'object',
        description: 'API response',
      },
    },
  };

  async execute(params, inputData, workflowEngine) {
    // Auth token available in params.accessToken
    // Implementation here
  }
}
```

## Support

- **Documentation**: See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- **Test Script**: Run `node src/tools/test-registry.js`
- **API Docs**: Check `/api/tool-schemas/` endpoints
- **Examples**: See `random-number.js` for reference

## License

Same as parent project.
