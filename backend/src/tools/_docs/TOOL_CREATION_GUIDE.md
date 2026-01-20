# Tool Creation Guide

## Quick Reference: Creating a New Tool

### 1. Create the Tool File

Create a new file in `product/desktop/backend/src/tools/library/your-tool-name.js`

### 2. Basic Tool Template

```javascript
import BaseAction from './BaseAction.js';

class YourToolName extends BaseAction {
  // Define schema for backend validation
  static schema = {
    parameters: {
      paramName: {
        type: 'string', // 'string' | 'number' | 'boolean' | 'object' | 'array'
        required: true, // true | false
        default: 'value', // optional - default value if not provided
        enum: ['opt1', 'opt2'], // optional - for string validation
      },
    },
    outputs: {
      resultName: {
        type: 'string', // 'string' | 'number' | 'boolean' | 'object' | 'array'
      },
    },
  };

  constructor() {
    super('your-tool-name'); // Must match the type in toolLibrary.json
  }

  async execute(params, inputData, workflowEngine) {
    // Automatic validation happens here
    await super.execute(params);

    // Your tool logic here
    const result = doSomething(params.paramName);

    // Return output matching the schema
    return { resultName: result };
  }
}

export default new YourToolName();
```

### 3. Add UI Definition to toolLibrary.json

Add your tool to the appropriate section in `product/desktop/backend/src/tools/toolLibrary.json`:

```json
{
  "actions": [
    {
      "title": "Your Tool Name",
      "category": "action",
      "type": "your-tool-name",
      "icon": "icon-name",
      "description": "What your tool does",
      "parameters": {
        "paramName": {
          "type": "string",
          "inputType": "text",
          "inputSize": "half",
          "description": "Parameter description for UI"
        }
      },
      "outputs": {
        "resultName": {
          "type": "string",
          "description": "Output description for UI"
        }
      }
    }
  ]
}
```

---

## Schema Field Reference

### Parameter Schema (Backend - in .js file)

| Field      | Type    | Required | Description                   | Example                                                    |
| ---------- | ------- | -------- | ----------------------------- | ---------------------------------------------------------- |
| `type`     | string  | ✅ Yes   | Data type for validation      | `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` |
| `required` | boolean | ❌ No    | Whether parameter is required | `true`, `false`                                            |
| `default`  | any     | ❌ No    | Default value if not provided | `0`, `'default'`, `[]`                                     |
| `enum`     | array   | ❌ No    | Allowed values (for strings)  | `['option1', 'option2']`                                   |

### Parameter Schema (Frontend - in toolLibrary.json)

| Field         | Type   | Required | Description                 | Example                                                      |
| ------------- | ------ | -------- | --------------------------- | ------------------------------------------------------------ |
| `type`        | string | ✅ Yes   | Data type (for reference)   | `'string'`, `'number'`, `'boolean'`                          |
| `inputType`   | string | ✅ Yes   | UI input type               | `'text'`, `'textarea'`, `'number'`, `'select'`, `'checkbox'` |
| `inputSize`   | string | ❌ No    | Input width                 | `'half'`, `'full'`                                           |
| `description` | string | ✅ Yes   | Help text for users         | `'Enter a value between 1-100'`                              |
| `options`     | array  | ❌ No    | Options for select/checkbox | `['Option 1', 'Option 2']`                                   |
| `default`     | any    | ❌ No    | Default value shown in UI   | `'default value'`                                            |
| `conditional` | object | ❌ No    | Show only if condition met  | `{ "field": "mode", "value": "advanced" }`                   |

---

## Complete Examples

### Example 1: Simple Tool (Random Number)

**File: `random-number.js`**

```javascript
import BaseAction from './BaseAction.js';

class RandomNumber extends BaseAction {
  static schema = {
    parameters: {
      min: {
        type: 'number',
        required: true,
      },
      max: {
        type: 'number',
        required: true,
      },
    },
    outputs: {
      randomNumber: {
        type: 'number',
      },
    },
  };

  constructor() {
    super('random-number');
  }

  async execute(params, inputData, workflowEngine) {
    await super.execute(params);

    const min = parseInt(params.min);
    const max = parseInt(params.max);

    if (min >= max) {
      throw new Error('Min must be less than max');
    }

    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    return { randomNumber };
  }
}

export default new RandomNumber();
```

**toolLibrary.json entry:**

```json
{
  "title": "Random Number",
  "category": "utility",
  "type": "random-number",
  "icon": "dice",
  "description": "Generates a random number within a specified range.",
  "parameters": {
    "min": {
      "type": "string",
      "inputType": "number",
      "inputSize": "half",
      "description": "The minimum value (inclusive)"
    },
    "max": {
      "type": "string",
      "inputType": "number",
      "inputSize": "half",
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

### Example 2: Tool with Enum Validation (Delay)

**File: `delay.js`**

```javascript
import BaseAction from './BaseAction.js';

class Delay extends BaseAction {
  static schema = {
    parameters: {
      duration: {
        type: 'number',
        required: true,
      },
      unit: {
        type: 'string',
        required: true,
        enum: ['milliseconds', 'seconds', 'minutes', 'hours'],
      },
    },
    outputs: {
      delayedUntil: {
        type: 'string',
      },
    },
  };

  constructor() {
    super('delay');
  }

  async execute(params, inputData, workflowEngine) {
    await super.execute(params);

    const duration = params.duration;
    const unit = params.unit;
    let delayMs;

    switch (unit) {
      case 'milliseconds':
        delayMs = duration;
        break;
      case 'seconds':
        delayMs = duration * 1000;
        break;
      case 'minutes':
        delayMs = duration * 60000;
        break;
      case 'hours':
        delayMs = duration * 3600000;
        break;
      default:
        throw new Error('Invalid time unit for delay');
    }

    const delayedUntil = new Date(Date.now() + delayMs).toISOString();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return this.formatOutput({ delayedUntil });
  }
}

export default new Delay();
```

**toolLibrary.json entry:**

```json
{
  "title": "Delay",
  "category": "control",
  "type": "delay",
  "icon": "timer",
  "description": "This control node introduces a delay in the workflow execution.",
  "parameters": {
    "duration": {
      "type": "string",
      "inputType": "text",
      "inputSize": "half",
      "description": "The duration of the delay in milliseconds"
    },
    "unit": {
      "type": "string",
      "inputType": "select",
      "inputSize": "half",
      "options": ["milliseconds", "seconds", "minutes", "hours"],
      "description": "The unit of time for the delay duration"
    }
  },
  "outputs": {
    "delayedUntil": {
      "type": "string",
      "description": "The timestamp when the delay will end"
    }
  }
}
```

### Example 3: Tool with Optional Parameters (Counter)

**File: `counter.js`**

```javascript
import BaseAction from './BaseAction.js';

class Counter extends BaseAction {
  static schema = {
    parameters: {
      initialValue: {
        type: 'number',
        required: false,
        default: 0,
      },
    },
    outputs: {
      count: {
        type: 'number',
      },
    },
  };

  constructor() {
    super('counter');
    this.count = 0;
  }

  async execute(params, inputData, workflowEngine) {
    await super.execute(params);

    const initialValue = Number(params.initialValue) || 0;
    this.count = Number(inputData.count) || this.count || initialValue;
    this.count++;
    return { count: this.count };
  }

  reset() {
    this.count = 0;
  }
}

export default new Counter();
```

---

## Validation Behavior

### Type Validation

The `SchemaValidator` automatically validates parameter types:

| Type      | Validates           | Example Error                                         |
| --------- | ------------------- | ----------------------------------------------------- |
| `number`  | Value is numeric    | `Parameter 'min' must be a valid number, got: "abc"`  |
| `string`  | Value is a string   | `Parameter 'name' must be a string, got: number`      |
| `boolean` | Value is true/false | `Parameter 'enabled' must be a boolean, got: "maybe"` |
| `array`   | Value is an array   | `Parameter 'items' must be an array, got: object`     |
| `object`  | Value is an object  | `Parameter 'config' must be an object, got: string`   |

### Enum Validation

When you specify `enum`, the validator checks if the value is in the allowed list:

```javascript
unit: {
  type: 'string',
  enum: ['small', 'medium', 'large']
}
```

Error: `Parameter 'unit' must be one of [small, medium, large], got: "extra-large"`

### Required Validation

Parameters are required if:

- `required: true` is explicitly set, OR
- No `default` value is provided

```javascript
// Required (no default)
name: {
  type: 'string',
  required: true
}

// Optional (has default)
count: {
  type: 'number',
  default: 0
}
```

---

## Best Practices

### ✅ DO

1. **Always call `await super.execute(params)`** at the start of your execute method
2. **Match the constructor name** to the type in toolLibrary.json
3. **Use clear, descriptive parameter names**
4. **Provide helpful error messages** for custom validation
5. **Return objects matching your output schema**
6. **Use `enum` for string parameters** with limited options
7. **Set appropriate `required` and `default` values**

### ❌ DON'T

1. **Don't skip `await super.execute(params)`** - validation won't run
2. **Don't use `inputType` in backend schema** - use `type` instead
3. **Don't duplicate validation** - let the schema handle type checking
4. **Don't forget to export** - use `export default new YourTool();`
5. **Don't use UI fields in backend schema** - keep them in toolLibrary.json

---

## Common Patterns

### Pattern 1: Simple Utility Tool

```javascript
static schema = {
  parameters: {
    input: { type: 'string', required: true }
  },
  outputs: {
    result: { type: 'string' }
  }
};
```

### Pattern 2: Tool with Options

```javascript
static schema = {
  parameters: {
    mode: {
      type: 'string',
      required: true,
      enum: ['fast', 'accurate', 'balanced']
    }
  },
  outputs: {
    result: { type: 'object' }
  }
};
```

### Pattern 3: Tool with Optional Config

```javascript
static schema = {
  parameters: {
    input: { type: 'string', required: true },
    timeout: { type: 'number', default: 5000 },
    retries: { type: 'number', default: 3 }
  },
  outputs: {
    success: { type: 'boolean' },
    data: { type: 'object' }
  }
};
```

---

## Troubleshooting

### Error: "Parameter 'X' is required"

- Add `required: false` or provide a `default` value

### Error: "Parameter 'X' must be a valid number"

- User entered non-numeric value in a number field
- Check your UI uses `inputType: 'number'` in toolLibrary.json

### Error: "Unknown type 'undefined' for parameter 'X'"

- You forgot to add `type` field in the backend schema
- Add `type: 'string'` (or appropriate type)

### Tool not showing in UI

- Check toolLibrary.json has the correct entry
- Verify `type` matches between .js file and toolLibrary.json
- Restart the backend server

---

## Migration Checklist

Migrating an old tool to the new schema format:

- [ ] Add `static schema = {...}` to the class
- [ ] Define `parameters` with `type`, `required`, `default`, `enum`
- [ ] Define `outputs` with `type`
- [ ] Add `await super.execute(params)` at start of execute()
- [ ] Remove redundant `validateParams()` type checking
- [ ] Keep UI fields in toolLibrary.json only
- [ ] Test with valid inputs
- [ ] Test with invalid inputs (should show clear errors)
