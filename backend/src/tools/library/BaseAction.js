import SchemaValidator from '../SchemaValidator.js';

class BaseAction {
  // Static schema property - tools can override this to define their schema
  static schema = null;

  constructor(name) {
    this.name = name;
  }

  async execute(params) {
    // AUTOMATIC RUNTIME PARAMETER VALIDATION
    // This runs for ALL tools that have a schema defined
    if (this.constructor.schema) {
      const validator = new SchemaValidator();
      const validation = validator.validateRuntimeParameters(params, this.constructor.schema);

      if (!validation.valid) {
        throw new Error(`Parameter validation failed: ${validation.errors.join('; ')}`);
      }
    }

    // If a subclass calls super.execute(), validation runs but we don't throw an error
    // The subclass will continue with its own logic after this returns
  }

  validateParams(params) {
    // Implement common parameter validation logic here
    // Note: Runtime type validation is now handled automatically in execute()
    return true;
  }

  formatOutput(output) {
    // Implement common output formatting logic here
    return output;
  }

  // Helper method to get the schema for this tool
  static getSchema() {
    return this.schema;
  }
}

export default BaseAction;
