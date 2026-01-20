import Ajv from 'ajv';

const ajv = new Ajv({
  strict: false,
  validateFormats: false,
  allErrors: true,
});

/**
 * Pre-validates tool call arguments against the tool's JSON schema BEFORE sending to LLM SDK.
 * This prevents the SDK from throwing errors on malformed tool calls.
 *
 * @param {Object} toolCall - The tool call object with function.name and function.arguments
 * @param {Array} availableTools - Array of tool schemas in OpenAI format
 * @returns {Object} - { valid: boolean, errors: Array, sanitizedArgs: Object }
 */
export function validateToolCall(toolCall, availableTools) {
  try {
    // Find the tool schema
    const toolSchema = availableTools.find((t) => t.function.name === toolCall.function.name);

    if (!toolSchema) {
      return {
        valid: false,
        errors: [`Tool '${toolCall.function.name}' not found in available tools`],
        sanitizedArgs: null,
      };
    }

    // Parse the arguments
    let parsedArgs;
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      return {
        valid: false,
        errors: [`Invalid JSON in tool arguments: ${parseError.message}`],
        sanitizedArgs: null,
      };
    }

    // Validate against schema
    const schema = toolSchema.function.parameters;
    const validate = ajv.compile(schema);
    const isValid = validate(parsedArgs);

    if (!isValid) {
      const errors = validate.errors.map((err) => {
        const path = err.instancePath || err.dataPath || 'root';
        return `${path}: ${err.message}`;
      });

      return {
        valid: false,
        errors: errors,
        sanitizedArgs: parsedArgs,
        schema: schema,
      };
    }

    return {
      valid: true,
      errors: [],
      sanitizedArgs: parsedArgs,
    };
  } catch (error) {
    console.error('Tool validation error:', error);
    return {
      valid: false,
      errors: [`Validation system error: ${error.message}`],
      sanitizedArgs: null,
    };
  }
}

/**
 * Validates multiple tool calls and separates valid from invalid
 *
 * @param {Array} toolCalls - Array of tool call objects
 * @param {Array} availableTools - Array of tool schemas
 * @returns {Object} - { valid: Array, invalid: Array }
 */
export function validateToolCalls(toolCalls, availableTools) {
  if (!toolCalls || toolCalls.length === 0) {
    return { valid: [], invalid: [] };
  }

  const valid = [];
  const invalid = [];

  for (const toolCall of toolCalls) {
    const validation = validateToolCall(toolCall, availableTools);

    if (validation.valid) {
      valid.push(toolCall);
    } else {
      invalid.push({
        toolCall,
        errors: validation.errors,
        schema: validation.schema,
      });
    }
  }

  return { valid, invalid };
}

/**
 * Creates a detailed error message for retry guidance
 *
 * @param {Array} invalidToolCalls - Array of invalid tool call objects with errors
 * @param {Array} availableTools - Array of tool schemas
 * @returns {string} - Detailed error message for the LLM
 */
export function createRetryGuidance(invalidToolCalls, availableTools) {
  const errorDetails = invalidToolCalls
    .map(({ toolCall, errors, schema }) => {
      const toolName = toolCall.function?.name || 'unknown';
      const errorList = errors.join('; ');

      let schemaInfo = '';
      if (schema) {
        schemaInfo = `\n\nCorrect schema for ${toolName}:\n${JSON.stringify(schema, null, 2)}`;
      }

      return `Tool "${toolName}":\n  Errors: ${errorList}${schemaInfo}`;
    })
    .join('\n\n');

  return `Your previous tool call(s) failed validation:

${errorDetails}

CRITICAL REQUIREMENTS:
1. Use EXACT tool names from the available tools list
2. Provide ALL required parameters
3. Match parameter types exactly (string, number, boolean, array, object)
4. For enum parameters, use ONLY the allowed values from the schema
5. Ensure all JSON is properly formatted

Available tools: ${availableTools.map((t) => t.function.name).join(', ')}`;
}
