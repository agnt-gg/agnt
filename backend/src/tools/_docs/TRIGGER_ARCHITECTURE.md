# Trigger Architecture Documentation

## Overview

This document describes the new file-based trigger architecture that makes triggers consistent with actions, using the `BaseTrigger` class pattern.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Workflow Engine                          │
│  - Manages workflow execution                                │
│  - Sets up trigger listeners                                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              _setupTriggerListeners()                        │
│  1. Try to load trigger from file (new)                     │
│  2. Fall back to ToolConfig (backward compatibility)        │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌──────────────────┐      ┌──────────────────┐
│  File-Based      │      │  ToolConfig      │
│  Trigger         │      │  (Legacy)        │
│                  │      │                  │
│  trigger-timer   │      │  receive-email   │
│  webhook-listener│      │  receive-slack   │
└──────────────────┘      └──────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    BaseTrigger Class                         │
│  - setup(engine, node)    - Initialize listeners            │
│  - validate(data, node)   - Check if data matches           │
│  - process(data, engine)  - Transform data                  │
│  - teardown()             - Cleanup resources               │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    ToolRegistry                              │
│  - Loads schemas from files                                 │
│  - Falls back to toolLibrary.json                           │
│  - Validates schemas                                        │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. BaseTrigger Class

**Location:** `product/desktop/backend/src/tools/library/BaseTrigger.js`

**Purpose:** Base class that all triggers extend, providing common functionality and lifecycle methods.

**Key Features:**

- Schema validation
- Lifecycle management (setup, validate, process, teardown)
- Resource cleanup helpers
- Parameter validation

**Lifecycle:**

```javascript
1. constructor()     - Initialize trigger instance
2. setup()          - Set up listeners/receivers
3. validate()       - Check incoming trigger data
4. process()        - Transform data for workflow
5. teardown()       - Clean up resources
```

### 2. File-Based Triggers

**Location:** `product/desktop/backend/src/tools/library/{trigger-type}.js`

**Structure:**

```javascript
import BaseTrigger from './BaseTrigger.js';

class TriggerName extends BaseTrigger {
  static schema = {
    title: 'Trigger Title',
    category: 'trigger',
    type: 'trigger-type',
    icon: 'icon-name',
    description: 'Description',
    parameters: {
      /* ... */
    },
    outputs: {
      /* ... */
    },
  };

  constructor() {
    super('trigger-type');
  }

  async setup(engine, node) {
    /* ... */
  }
  async validate(triggerData, node) {
    /* ... */
  }
  async process(inputData, engine) {
    /* ... */
  }
  async teardown() {
    /* ... */
  }
}

export default new TriggerName();
```

### 3. ToolRegistry Integration

**Location:** `product/desktop/backend/src/tools/ToolRegistry.js`

**Changes:**

- Filters out `BaseTrigger.js` when scanning library
- Loads trigger schemas from files
- Falls back to `toolLibrary.json` if no file schema found

**Loading Priority:**

1. Check for `static schema` in trigger file
2. Fall back to `toolLibrary.json`
3. Validate schema
4. Store with metadata

### 4. WorkflowEngine Integration

**Location:** `product/desktop/backend/src/workflow/WorkflowEngine.js`

**Changes in `_setupTriggerListeners()`:**

```javascript
for (const node of triggerNodes) {
  let triggerSetup = false;

  // Try file-based trigger first
  try {
    const triggerModule = await import(`../tools/library/${node.type}.js`);
    const trigger = triggerModule.default;
    if (trigger && typeof trigger.setup === 'function') {
      await trigger.setup(this, node);
      triggerSetup = true;
    }
  } catch (importError) {
    // Fall back to ToolConfig
  }

  // Backward compatibility
  if (!triggerSetup) {
    const triggerConfig = ToolConfig.triggers[node.type];
    if (triggerConfig && triggerConfig.setup) {
      await triggerConfig.setup(this, node);
    }
  }
}
```

### 5. NodeExecutor Integration

**Location:** `product/desktop/backend/src/workflow/NodeExecutor.js`

**Changes in `executeNode()`:**

```javascript
if (node.category === 'trigger') {
  let triggerProcessed = false;

  // Try file-based trigger first
  try {
    const triggerModule = await import(`../tools/library/${node.type}.js`);
    const trigger = triggerModule.default;
    if (trigger && typeof trigger.process === 'function') {
      output = await trigger.process(inputData, this.workflowEngine);
      triggerProcessed = true;
    }
  } catch (importError) {
    // Fall back to ToolConfig
  }

  // Backward compatibility
  if (!triggerProcessed) {
    const triggerConfig = ToolConfig.triggers[node.type];
    if (triggerConfig && triggerConfig.process) {
      output = await triggerConfig.process(inputData, this.workflowEngine);
    }
  }
}
```

## Backward Compatibility

The system maintains full backward compatibility during the migration:

### Dual Support

- **File-based triggers** are tried first
- **ToolConfig triggers** are used as fallback
- Both can coexist in the same system

### Migration Path

1. Create file-based trigger
2. Test thoroughly
3. Keep ToolConfig entry
4. Once all triggers migrated, remove ToolConfig entries

### Console Logging

```
✓ Using file-based trigger setup for trigger-timer
○ Using ToolConfig trigger setup for receive-email
```

## Migrated Triggers

### ✅ All Completed!

1. **trigger-timer** - Interval and specific time scheduling
2. **webhook-listener** - HTTP webhook receiver
3. **receive-email** - Email receiver (IMAP) - HARDEST
4. **google-sheets-new-row** - Google Sheets row watcher
5. **receive-slack-message** - Slack message listener
6. **receive-discord-message** - Discord message listener
7. **zapier-trigger** - Zapier webhook integration - EASIEST

## Benefits

### 1. Consistency

- Triggers follow same pattern as actions
- Unified architecture across all tools
- Easier to understand and maintain

### 2. Co-location

- Schema lives with implementation
- No need to sync between files
- Single source of truth

### 3. Maintainability

- Each trigger is self-contained
- Clear separation of concerns
- Easier to test and debug

### 4. Discoverability

- ToolRegistry automatically finds triggers
- No manual registration needed
- Schema validation built-in

### 5. Type Safety

- Easier to add TypeScript later
- Better IDE support
- Compile-time checking possible

## Receiver Classes

Some triggers use separate receiver classes for external service integration:

### Existing Receivers

- **SlackReceiver** - Slack API integration
- **DiscordReceiver** - Discord API integration
- **SheetsReceiver** - Google Sheets API integration
- **EmailReceiver** - Email polling
- **WebhookReceiver** - HTTP webhook handling

### Integration Pattern

```javascript
import BaseTrigger from './BaseTrigger.js';
import SlackReceiver from '../triggers/SlackReceiver.js';

class ReceiveSlackMessage extends BaseTrigger {
  async setup(engine, node) {
    await super.setup(engine, node);

    // Use existing receiver
    engine.receivers.slack = SlackReceiver();
    await engine.receivers.slack.initialize(engine.userId);

    // Subscribe to events
    await engine.receivers.slack.subscribeToChannel(node.parameters.channelId, (data) => engine.processWorkflowTrigger(data));
  }
}
```

## Testing

### Unit Tests

```javascript
import TriggerTimer from './trigger-timer.js';

describe('TriggerTimer', () => {
  it('should have valid schema', () => {
    expect(TriggerTimer.constructor.schema).toBeDefined();
    expect(TriggerTimer.constructor.schema.type).toBe('trigger-timer');
  });

  it('should validate timer trigger data', async () => {
    const data = { type: 'timer', nodeId: 'node-1', timestamp: '2024-01-01' };
    const node = { id: 'node-1' };
    const isValid = await TriggerTimer.validate(data, node);
    expect(isValid).toBe(true);
  });

  it('should process trigger data', async () => {
    const data = { timestamp: '2024-01-01T00:00:00Z' };
    const result = await TriggerTimer.process(data);
    expect(result.timestamp).toBe('2024-01-01T00:00:00Z');
  });
});
```

### Integration Tests

```javascript
describe('Trigger Integration', () => {
  it('should load file-based trigger', async () => {
    const engine = new WorkflowEngine(workflow, workflowId, userId);
    await engine.setupWorkflowListeners();
    // Verify trigger was loaded from file
  });

  it('should fall back to ToolConfig', async () => {
    // Test with non-migrated trigger
    const engine = new WorkflowEngine(workflow, workflowId, userId);
    await engine.setupWorkflowListeners();
    // Verify ToolConfig was used
  });
});
```

## Performance Considerations

### Lazy Loading

- Triggers are loaded only when needed
- Dynamic imports reduce initial load time
- Memory efficient

### Caching

- ToolRegistry caches schemas
- Trigger instances are singletons
- Minimal overhead

### Resource Management

- `teardown()` ensures cleanup
- No memory leaks
- Proper event listener removal

## Future Enhancements

### Short Term

- [ ] Migrate remaining triggers
- [ ] Add comprehensive tests
- [ ] Update documentation
- [ ] Remove ToolConfig dependencies

### Medium Term

- [ ] TypeScript definitions
- [ ] Automated migration tool
- [ ] Hot-reload support
- [ ] Performance monitoring

### Long Term

- [ ] Trigger versioning
- [ ] Plugin system
- [ ] Visual trigger builder
- [ ] Trigger marketplace

## Migration Status

| Trigger                 | Status      | File | ToolConfig | Notes                |
| ----------------------- | ----------- | ---- | ---------- | -------------------- |
| trigger-timer           | ✅ Migrated | ✓    | ✓          | Fully tested         |
| webhook-listener        | ✅ Migrated | ✓    | ✓          | Fully tested         |
| receive-email           | ✅ Migrated | ✓    | ✓          | Uses SimpleIMAP      |
| google-sheets-new-row   | ✅ Migrated | ✓    | ✓          | Uses SheetsReceiver  |
| receive-slack-message   | ✅ Migrated | ✓    | ✓          | Uses SlackReceiver   |
| receive-discord-message | ✅ Migrated | ✓    | ✓          | Uses DiscordReceiver |
| zapier-trigger          | ✅ Migrated | ✓    | ✓          | Similar to webhook   |

## References

- [Trigger Migration Guide](./TRIGGER_MIGRATION_GUIDE.md)
- [Action Migration Guide](./MIGRATION_GUIDE.md)
- [BaseTrigger Source](./library/BaseTrigger.js)
- [ToolRegistry Source](./ToolRegistry.js)
