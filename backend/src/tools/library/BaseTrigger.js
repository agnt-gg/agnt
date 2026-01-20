import SchemaValidator from '../SchemaValidator.js';

/**
 * BaseTrigger - Base class for all workflow triggers
 *
 * Triggers are responsible for:
 * 1. Setting up listeners/receivers (setup)
 * 2. Validating incoming trigger data (validate)
 * 3. Processing/transforming trigger data (process)
 * 4. Cleaning up resources (teardown)
 */
class BaseTrigger {
  // Static schema property - triggers can override this to define their schema
  static schema = null;

  constructor(name) {
    this.name = name;
    this.isListening = false;
    this.receivers = {}; // Store any receivers/listeners this trigger creates
  }

  /**
   * Setup the trigger - initialize listeners, receivers, polling, etc.
   * @param {WorkflowEngine} engine - The workflow engine instance
   * @param {Object} node - The trigger node configuration
   */
  async setup(engine, node) {
    // AUTOMATIC SCHEMA VALIDATION
    if (this.constructor.schema) {
      const validator = new SchemaValidator();
      const validation = validator.validate(this.constructor.schema);

      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join('; ')}`);
      }
    }

    // Subclasses should override this method
    // Default implementation does nothing
    this.isListening = true;
  }

  /**
   * Validate incoming trigger data
   * @param {Object} triggerData - The incoming trigger data
   * @param {Object} node - The trigger node configuration
   * @returns {boolean} - Whether the trigger data is valid for this trigger
   */
  async validate(triggerData, node) {
    // Subclasses should override this method
    // Default implementation accepts all data
    return true;
  }

  /**
   * Process and transform trigger data into workflow outputs
   * @param {Object} inputData - The raw trigger data
   * @param {WorkflowEngine} engine - The workflow engine instance
   * @returns {Object} - Processed data to pass to the workflow
   */
  async process(inputData, engine) {
    // Subclasses should override this method
    // Default implementation passes data through unchanged
    return inputData;
  }

  /**
   * Cleanup resources - stop listeners, clear intervals, unsubscribe, etc.
   */
  async teardown() {
    this.isListening = false;

    // Clean up any receivers
    for (const receiver of Object.values(this.receivers)) {
      if (receiver && typeof receiver.stop === 'function') {
        await receiver.stop();
      }
      if (receiver && typeof receiver.unsubscribe === 'function') {
        await receiver.unsubscribe();
      }
    }

    this.receivers = {};
  }

  /**
   * Helper method to get the schema for this trigger
   */
  static getSchema() {
    return this.schema;
  }

  /**
   * Helper to validate parameters at runtime
   */
  validateParams(params) {
    if (!this.constructor.schema || !this.constructor.schema.parameters) {
      return true;
    }

    const validator = new SchemaValidator();
    const validation = validator.validateRuntimeParameters(params, this.constructor.schema);

    if (!validation.valid) {
      throw new Error(`Parameter validation failed: ${validation.errors.join('; ')}`);
    }

    return true;
  }
}

export default BaseTrigger;
