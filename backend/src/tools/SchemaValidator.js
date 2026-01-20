class SchemaValidator {
  constructor() {
    this.requiredFields = ['title', 'category', 'type', 'description'];
    this.validCategories = ['trigger', 'action', 'utility', 'widget', 'control', 'custom'];
    this.validInputTypes = ['text', 'textarea', 'number', 'select', 'checkbox', 'readonly', 'time', 'codearea', 'agent-select', 'password'];
  }

  validate(schema) {
    const errors = [];

    if (!schema || typeof schema !== 'object') {
      return {
        valid: false,
        errors: ['Schema must be an object'],
      };
    }

    // Check required fields
    for (const field of this.requiredFields) {
      if (!schema[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate category
    if (schema.category && !this.validCategories.includes(schema.category)) {
      errors.push(`Invalid category: ${schema.category}. Must be one of: ${this.validCategories.join(', ')}`);
    }

    // Validate type format (should be kebab-case)
    if (schema.type && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(schema.type)) {
      errors.push(`Invalid type format: ${schema.type}. Should be kebab-case (e.g., 'random-number')`);
    }

    // Validate parameters if present
    if (schema.parameters) {
      const paramErrors = this.validateParameters(schema.parameters);
      errors.push(...paramErrors);
    }

    // Validate outputs if present
    if (schema.outputs) {
      const outputErrors = this.validateOutputs(schema.outputs);
      errors.push(...outputErrors);
    }

    // Validate icon if present
    if (schema.icon && typeof schema.icon !== 'string') {
      errors.push('Icon must be a string');
    }

    // Validate authRequired if present
    if (schema.authRequired && !['apiKey', 'oauth'].includes(schema.authRequired)) {
      errors.push(`Invalid authRequired: ${schema.authRequired}. Must be 'apiKey' or 'oauth'`);
    }

    // Validate authProvider if authRequired is set
    if (schema.authRequired && !schema.authProvider) {
      errors.push('authProvider is required when authRequired is set');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateParameters(parameters) {
    const errors = [];

    if (typeof parameters !== 'object') {
      return ['Parameters must be an object'];
    }

    for (const [paramName, paramDef] of Object.entries(parameters)) {
      // Check parameter definition structure
      if (typeof paramDef !== 'object') {
        errors.push(`Parameter '${paramName}' must be an object`);
        continue;
      }

      // Validate inputType if present
      if (paramDef.inputType && !this.validInputTypes.includes(paramDef.inputType)) {
        errors.push(`Invalid inputType for parameter '${paramName}': ${paramDef.inputType}. Must be one of: ${this.validInputTypes.join(', ')}`);
      }

      // Validate type if present - be lenient, just warn about unknown types
      if (paramDef.type && !['string', 'number', 'boolean', 'array', 'object', 'code', 'text'].includes(paramDef.type)) {
        console.warn(`Unknown type for parameter '${paramName}': ${paramDef.type}`);
      }

      // Validate options for select/checkbox inputs - make this a warning, not an error
      if (['select', 'checkbox'].includes(paramDef.inputType) && !paramDef.options) {
        console.warn(`Parameter '${paramName}' with inputType '${paramDef.inputType}' should have options array`);
      }

      // Validate conditional if present
      if (paramDef.conditional) {
        if (!paramDef.conditional.field || !paramDef.conditional.value) {
          errors.push(`Parameter '${paramName}' has invalid conditional structure`);
        }
      }

      // Validate inputSize if present
      if (paramDef.inputSize && !['half', 'full'].includes(paramDef.inputSize)) {
        errors.push(`Invalid inputSize for parameter '${paramName}': ${paramDef.inputSize}. Must be 'half' or 'full'`);
      }
    }

    return errors;
  }

  validateOutputs(outputs) {
    const errors = [];

    if (typeof outputs !== 'object') {
      return ['Outputs must be an object'];
    }

    for (const [outputName, outputDef] of Object.entries(outputs)) {
      // Check output definition structure
      if (typeof outputDef !== 'object') {
        errors.push(`Output '${outputName}' must be an object`);
        continue;
      }

      // Validate type if present - be lenient with capitalization
      if (outputDef.type) {
        const normalizedType = outputDef.type.toLowerCase();
        if (!['string', 'number', 'boolean', 'array', 'object', 'integer', 'any', 'null'].includes(normalizedType)) {
          console.warn(`Unknown type for output '${outputName}': ${outputDef.type}`);
        }
      }

      // Description is recommended but not required
      if (!outputDef.description) {
        // Just a warning, not an error
        console.warn(`Output '${outputName}' is missing description (recommended)`);
      }
    }

    return errors;
  }

  validateSchemaCompleteness(schema) {
    const warnings = [];

    // Check for recommended but not required fields
    if (!schema.icon) {
      warnings.push('Icon is recommended for better UI experience');
    }

    if (!schema.documentation) {
      warnings.push('Documentation URL is recommended');
    }

    if (schema.parameters && Object.keys(schema.parameters).length === 0) {
      warnings.push('Tool has no parameters defined');
    }

    if (schema.outputs && Object.keys(schema.outputs).length === 0) {
      warnings.push('Tool has no outputs defined');
    }

    return warnings;
  }

  // ============================================================================
  // RUNTIME PARAMETER VALIDATION
  // ============================================================================

  /**
   * Validates runtime parameter values against schema definitions
   * @param {Object} params - The actual parameter values from user input
   * @param {Object} schema - The tool schema containing parameter definitions
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateRuntimeParameters(params, schema) {
    const errors = [];

    if (!schema?.parameters) {
      return { valid: true, errors: [] };
    }

    for (const [paramName, paramDef] of Object.entries(schema.parameters)) {
      const value = params[paramName];

      // Skip conditional parameters if condition not met
      if (paramDef.conditional && !this.checkConditional(params, paramDef.conditional)) {
        continue;
      }

      // Check if parameter is required
      const isEmpty = this.isValueEmpty(value);
      const isRequired = paramDef.required === true || (paramDef.required !== false && !paramDef.conditional && !paramDef.default);

      if (isEmpty && isRequired) {
        errors.push(`Parameter '${paramName}' is required`);
        continue;
      }

      // Validate the value type if it's not empty
      if (!isEmpty) {
        const typeError = this.validateParameterValue(paramName, value, paramDef);
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates a single parameter value against its definition
   * @param {string} paramName - The parameter name
   * @param {any} value - The parameter value
   * @param {Object} paramDef - The parameter definition from schema
   * @returns {string|null} Error message or null if valid
   */
  validateParameterValue(paramName, value, paramDef) {
    // Use 'type' field for validation (new simplified schema format)
    // Fall back to 'inputType' for backward compatibility with old schemas
    const validationType = paramDef.type || paramDef.inputType;

    if (!validationType) {
      console.warn(`No type or inputType defined for parameter '${paramName}'`);
      return null;
    }

    // Handle type-based validation (new format)
    switch (validationType) {
      case 'number':
        // Check if value can be converted to a valid number
        const num = Number(value);
        if (isNaN(num) || value === '') {
          return `Parameter '${paramName}' must be a valid number, got: "${value}"`;
        }
        break;

      case 'string':
        // Check enum if present (replaces select options)
        if (paramDef.enum && !paramDef.enum.includes(value)) {
          return `Parameter '${paramName}' must be one of [${paramDef.enum.join(', ')}], got: "${value}"`;
        }
        // String type validation
        if (typeof value !== 'string') {
          return `Parameter '${paramName}' must be a string, got: ${typeof value}`;
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          return `Parameter '${paramName}' must be a boolean, got: "${value}"`;
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          return `Parameter '${paramName}' must be an array, got: ${typeof value}`;
        }
        break;

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return `Parameter '${paramName}' must be an object, got: ${typeof value}`;
        }
        break;

      // Legacy inputType support for backward compatibility
      case 'select':
        if (paramDef.options && !paramDef.options.includes(value)) {
          return `Parameter '${paramName}' must be one of [${paramDef.options.join(', ')}], got: "${value}"`;
        }
        break;

      case 'checkbox':
        if (paramDef.options) {
          const values = Array.isArray(value) ? value : [value];
          const invalidValues = values.filter((v) => !paramDef.options.includes(v));
          if (invalidValues.length > 0) {
            return `Parameter '${paramName}' contains invalid values: [${invalidValues.join(', ')}]. Must be from: [${paramDef.options.join(', ')}]`;
          }
        }
        break;

      case 'text':
      case 'textarea':
      case 'password':
      case 'codearea':
        if (typeof value !== 'string') {
          return `Parameter '${paramName}' must be a string, got: ${typeof value}`;
        }
        break;

      case 'time':
        if (!/^\d{2}:\d{2}$/.test(value)) {
          return `Parameter '${paramName}' must be in HH:MM format, got: "${value}"`;
        }
        break;

      case 'readonly':
      case 'agent-select':
        // No validation needed
        break;

      default:
        console.warn(`Unknown type '${validationType}' for parameter '${paramName}'`);
    }

    return null;
  }

  /**
   * Checks if a conditional parameter's condition is met
   * @param {Object} params - All parameter values
   * @param {Object} conditional - The conditional definition
   * @returns {boolean} True if condition is met
   */
  checkConditional(params, conditional) {
    if (!conditional || !conditional.field) {
      return true;
    }

    const fieldValue = params[conditional.field];
    const expectedValue = conditional.value;

    // Handle array of expected values
    if (Array.isArray(expectedValue)) {
      return expectedValue.includes(fieldValue);
    }

    // Handle single expected value
    return fieldValue === expectedValue;
  }

  /**
   * Checks if a value is considered empty
   * @param {any} value - The value to check
   * @returns {boolean} True if value is empty
   */
  isValueEmpty(value) {
    return value === undefined || value === null || value === '';
  }
}

export default SchemaValidator;
