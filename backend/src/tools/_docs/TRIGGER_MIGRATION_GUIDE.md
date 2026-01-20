# Trigger Migration Guide

This guide explains how to migrate triggers from `ToolConfig.js` to individual file-based triggers using the `BaseTrigger` class.

## Overview

The new trigger architecture allows triggers to be defined as individual files in the `library/` directory, similar to how actions work. This provides better organization, co-location of schema and implementation, and easier maintenance.

## Benefits

- **Consistency**: Triggers follow the same pattern as actions
- **Co-location**: Schema and implementation live together
- **Maintainability**: Each trigger is self-contained in one file
- **Discoverability**: `ToolRegistry` automatically finds all triggers
- **Type Safety**: Easier to add TypeScript later
- **Testing**: Each trigger can be tested independently
- **Backward Compatibility**: Old ToolConfig triggers still work during migration

## Architecture

### Components

1. **BaseTrigger.js** - Base class that all triggers extend
2. **ToolRegistry.js** - Automatically loads trigger schemas from files
3. **NodeExecutor.js** - Tries file-based triggers first, falls back to ToolConfig
4. **WorkflowEngine.js** - Sets up triggers from files or ToolConfig

### How It Works

1. Triggers extend `BaseTrigger` class
2. Define static `schema` property with metadata
3. Implement lifecycle methods: `setup()`, `validate()`, `process()`, `teardown()`
4. Export singleton instance: `export default new YourTrigger();`
5. System tries file-based trigger first, falls back to ToolConfig if not found

## BaseTrigger Class

### Lifecycle Methods

```javascript
class YourTrigger extends BaseTrigger {
  // 1. Setup - Initialize listeners, receivers, polling, etc.
  async setup(engine, node) {
    await super.setup(engine, node);
    // Your setup code here
  }

  // 2. Validate - Check if incoming data matches this trigger
  async validate(triggerData, node) {
    return triggerData.type === 'your-type';
  }

  // 3. Process - Transform trigger data into workflow outputs
  async process(inputData, engine) {
    return {
      // Your processed outputs
    };
  }

  // 4. Teardown - Cleanup resources
  async teardown() {
    // Your cleanup code
    await super.teardown();
  }
}
```

### Properties

- `this.name` - Trigger name (set in constructor)
- `this.isListening` - Whether trigger is actively listening
- `this.receivers` - Object to store receivers/listeners

## Migration Steps

### Step 1: Create Trigger File

Create a new file in `product/desktop/backend/src/tools/library/` named `{trigger-type}.js`

### Step 2: Copy Schema from toolLibrary.json

Find your trigger's schema in `toolLibrary.json` under the `triggers` array and copy it.

### Step 3: Implement Trigger Class

```javascript
import BaseTrigger from './BaseTrigger.js';

class YourTrigger extends BaseTrigger {
  static schema = {
    // Paste schema from toolLibrary.json here
    title: 'Your Trigger',
    category: 'trigger',
    type: 'your-trigger-type',
    icon: 'icon-name',
    description: 'Description',
    parameters: {
      // ... parameters
    },
    outputs: {
      // ... outputs
    },
  };

  constructor() {
    super('your-trigger-type');
    // Initialize any instance properties
  }

  async setup(engine, node) {
    await super.setup(engine, node);
    // Copy setup logic from ToolConfig.js
  }

  async validate(triggerData, node) {
    // Copy validate logic from ToolConfig.js
    return true;
  }

  async process(inputData, engine) {
    // Copy process logic from ToolConfig.js
    return inputData;
  }

  async teardown() {
    // Add cleanup logic
    await super.teardown();
  }
}

export default new YourTrigger();
```

### Step 4: Migrate Logic from ToolConfig.js

Copy the `setup`, `validate`, and `process` functions from `ToolConfig.js` into your trigger class methods.

### Step 5: Test the Trigger

1. Start the server
2. Check console logs for: `Using file-based trigger setup for {trigger-type}`
3. Test the trigger in a workflow
4. Verify it works correctly

### Step 6: Keep ToolConfig Entry (For Now)

**DO NOT** remove the trigger from `ToolConfig.js` yet. The system maintains backward compatibility, so both can coexist during the migration period.

## Example Migrations

### Example 1: Timer Trigger

**Before (ToolConfig.js):**

```javascript
'trigger-timer': {
  setup: async (engine, node) => {
    // Setup logic
  },
  validate: (triggerData, node) => {
    return triggerData.type === 'timer' && triggerData.nodeId === node.id;
  },
  process: (inputData) => ({
    timestamp: inputData.timestamp,
  }),
}
```

**After (trigger-timer.js):**

```javascript
import BaseTrigger from './BaseTrigger.js';

class TriggerTimer extends BaseTrigger {
  static schema = {
    title: 'Timer Trigger',
    category: 'trigger',
    type: 'trigger-timer',
    // ... rest of schema
  };

  constructor() {
    super('trigger-timer');
    this.timerId = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);
    // Setup logic from ToolConfig
  }

  async validate(triggerData, node) {
    return triggerData.type === 'timer' && triggerData.nodeId === node.id;
  }

  async process(inputData) {
    return { timestamp: inputData.timestamp };
  }

  async teardown() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    await super.teardown();
  }
}

export default new TriggerTimer();
```

### Example 2: Webhook Listener

**Before (ToolConfig.js):**

```javascript
'webhook-listener': {
  setup: async (engine, node) => {
    const webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(/*...*/);
  },
  validate: (triggerData) => triggerData.type === 'webhook',
  process: (inputData) => ({
    method: inputData.method,
    headers: inputData.headers,
    body: inputData.body,
  }),
}
```

**After (webhook-listener.js):**

```javascript
import BaseTrigger from './BaseTrigger.js';
import ProcessManager from '../../workflow/ProcessManager.js';

class WebhookListener extends BaseTrigger {
  static schema = {
    title: 'Webhook Listener',
    category: 'trigger',
    type: 'webhook-listener',
    // ... rest of schema
  };

  constructor() {
    super('webhook-listener');
  }

  async setup(engine, node) {
    await super.setup(engine, node);
    const { method, authType, authToken, username, password } = node.parameters;
    this.webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(
      engine.workflowId,
      engine.userId,
      method,
      authType,
      authToken,
      username,
      password
    );
  }

  async validate(triggerData) {
    return triggerData.type === 'webhook';
  }

  async process(inputData) {
    return {
      method: inputData.method,
      headers: inputData.headers,
      body: inputData.body,
      query: inputData.query,
      params: inputData.params,
    };
  }
}

export default new WebhookListener();
```

## Complex Triggers with Receivers

For triggers that use receiver classes (Slack, Discord, Email, Sheets), keep the receiver classes separate and import them:

```javascript
import BaseTrigger from './BaseTrigger.js';
import SlackReceiver from '../triggers/SlackReceiver.js';

class ReceiveSlackMessage extends BaseTrigger {
  static schema = {
    // ... schema
  };

  async setup(engine, node) {
    await super.setup(engine, node);

    engine.receivers.slack = SlackReceiver();
    await engine.receivers.slack.initialize(engine.userId);

    const { channelId } = node.parameters;
    await engine.receivers.slack.subscribeToChannel(channelId, (messageData) => {
      engine.processWorkflowTrigger(messageData);
    });
  }

  async validate(triggerData) {
    return 'text' in triggerData && 'user' in triggerData;
  }

  async process(inputData, engine) {
    // Process the Slack message
    return {
      user: inputData.user,
      text: inputData.text,
      timestamp: inputData.ts,
    };
  }

  async teardown() {
    // Cleanup Slack receiver if needed
    await super.teardown();
  }
}

export default new ReceiveSlackMessage();
```

## Migration Checklist

For each trigger you migrate:

- [ ] Create new file in `library/` directory
- [ ] Copy schema from `toolLibrary.json`
- [ ] Add `static schema` property to class
- [ ] Implement `constructor()` with `super(trigger-type)`
- [ ] Migrate `setup()` logic from ToolConfig
- [ ] Migrate `validate()` logic from ToolConfig
- [ ] Migrate `process()` logic from ToolConfig
- [ ] Add `teardown()` cleanup logic
- [ ] Export singleton: `export default new YourTrigger();`
- [ ] Test trigger in a workflow
- [ ] Verify console shows "Using file-based trigger"
- [ ] Keep ToolConfig entry for backward compatibility

## Testing

### Console Logs to Watch For

**Success (File-based):**

```
Using file-based trigger setup for trigger-timer
✓ Loaded schema for trigger-timer from file
```

**Fallback (ToolConfig):**

```
File-based trigger not found for old-trigger, falling back to ToolConfig
Using ToolConfig trigger setup for old-trigger
○ Using fallback schema for old-trigger from toolLibrary.json
```

### Verification Steps

1. Start the server and check console logs
2. Create a workflow with the migrated trigger
3. Activate the workflow
4. Verify trigger fires correctly
5. Check that outputs match expected schema
6. Test error handling

## Common Issues

### Issue: Import Error

**Symptom:** `File-based trigger not found for {type}, falling back to ToolConfig`

**Solution:**

- Verify file exists in `library/` directory
- Check filename matches trigger type exactly
- Ensure file exports default instance

### Issue: Schema Not Loading

**Symptom:** `⚠ No schema found for {type} in file or JSON`

**Solution:**

- Add `static schema = {...}` to class
- Verify schema has required fields (title, category, type, description)
- Check schema is valid JSON structure

### Issue: Trigger Not Firing

**Symptom:** Workflow doesn't execute when trigger should fire

**Solution:**

- Check `setup()` method is called
- Verify `validate()` returns true for incoming data
- Ensure `process()` returns correct output format
- Check for errors in console logs

## Migration Priority

### Phase 1: Simple Triggers (No External Dependencies)

1. ✅ `trigger-timer` - MIGRATED
2. ✅ `webhook-listener` - MIGRATED
3. `zapier-trigger` - Similar to webhook

### Phase 2: Triggers with Receivers

4. `receive-slack-message` - Uses SlackReceiver
5. `receive-discord-message` - Uses DiscordReceiver
6. `receive-email` - Uses SimpleIMAP
7. `google-sheets-new-row` - Uses SheetsReceiver

## Best Practices

1. **Keep Receivers Separate**: Don't merge receiver classes into triggers
2. **Use Singleton Pattern**: Export `new YourTrigger()` not the class
3. **Clean Up Resources**: Always implement `teardown()` properly
4. **Validate Parameters**: Use `this.validateParams()` if needed
5. **Error Handling**: Wrap setup logic in try/catch
6. **Console Logging**: Add helpful logs for debugging
7. **Test Thoroughly**: Test both setup and execution paths

## Future Enhancements

- TypeScript definitions for triggers
- Automated migration script
- Trigger versioning
- Hot-reload during development
- Trigger documentation generator
- Unit tests for each trigger

## Getting Help

If you encounter issues:

1. Check console logs for detailed error messages
2. Verify the trigger works in ToolConfig first
3. Compare with migrated examples (timer, webhook)
4. Review BaseTrigger class for available methods
5. Check that receiver classes are imported correctly
