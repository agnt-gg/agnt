import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define a directory for saving tool schemas
const SCHEMA_CACHE_DIR = path.join(__dirname, 'schema-cache');

// Define a directory for saving parameter corrections
const PARAM_FIXES_CACHE_DIR = path.join(__dirname, 'param-fixes-cache');

// Ensure the schema cache directory exists
async function ensureSchemaCacheDir() {
  try {
    await fs.mkdir(SCHEMA_CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating schema cache directory:', error);
  }
}

// Ensure the parameter fixes cache directory exists
async function ensureParamFixesCacheDir() {
  try {
    await fs.mkdir(PARAM_FIXES_CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating parameter fixes cache directory:', error);
  }
}

// Initialize the schema directory on startup
ensureSchemaCacheDir();

// Initialize the parameter fixes directory on startup
ensureParamFixesCacheDir();

// Get all available tools
router.get('/tools', async (req, res) => {
  try {
    const toolsDir = path.join(__dirname, 'tools');
    const files = await fs.readdir(toolsDir);
    
    const tools = files
      .filter(file => file.endsWith('.js'))
      .map(file => {
        const toolName = file.replace('.js', '');
        return {
          id: toolName,
          name: toolName.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ')
        };
      });
    
    res.json({ tools });
  } catch (error) {
    console.error('Error fetching tools:', error);
    res.status(500).json({ error: 'Failed to load tools' });
  }
});

// Extract parameter information from tool code
async function extractToolParameters(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    
    // Extract JSDoc comments for parameter descriptions
    const docCommentMatch = fileContent.match(/\/\*\*([\s\S]*?)\*\//);
    let docComment = '';
    if (docCommentMatch) {
      docComment = docCommentMatch[1].trim();
    }
    
    // Extract @param JSDoc tags for better parameter documentation
    const paramDocs = {};
    const paramTagRegex = /@param\s+{([^}]+)}\s+([^\s]+)\s+(.*)/g;
    let paramMatch;
    while ((paramMatch = paramTagRegex.exec(docComment)) !== null) {
      const [_, type, name, description] = paramMatch;
      paramDocs[name] = { type, description };
    }
    
    // Default properties for all tools
    const properties = {};
    const required = [];
    
    // Look for parameter references in the code
    const paramChecks = fileContent.match(/params\.([a-zA-Z0-9_]+)/g) || [];
    
    // Extract unique parameter names
    const uniqueParams = [...new Set(paramChecks.map(p => p.replace('params.', '')))];
    
    // Check which parameters are accessed with || for default values (optional)
    uniqueParams.forEach(param => {
      if (fileContent.includes(`params.${param} ||`) || 
          fileContent.includes(`params.${param} ??`) ||
          fileContent.includes(`params.${param} === undefined`) ||
          fileContent.includes(`params.${param} || `) ||
          fileContent.includes(`params.${param} ?? `) ||
          fileContent.includes(`|| params.${param}`) ||
          fileContent.includes(`?? params.${param}`)) {
        // This is an optional parameter
      } else if (fileContent.includes(`if (!params.${param})`)) {
        required.push(param);
      } else {
        required.push(param);
      }
    });
    
    // Build parameter definitions
    uniqueParams.forEach(param => {
      let paramType = 'string';
      let description = `${param} parameter for this tool`;
      
      // Use JSDoc info if available
      if (paramDocs[param]) {
        paramType = paramDocs[param].type.toLowerCase();
        description = paramDocs[param].description;
      } else {
        // Try to infer parameter types from context
        if (fileContent.includes(`parseInt(params.${param}`)) {
          paramType = 'number';
        } else if (fileContent.includes(`parseFloat(params.${param}`)) {
          paramType = 'number';
        } else if (fileContent.includes(`params.${param} === true`) || 
                  fileContent.includes(`params.${param} === false`)) {
          paramType = 'boolean';
        }
      }
      
      // Create property definition
      properties[param] = {
        type: paramType,
        description: description
      };
      
      // Add extra description for special cases if not already provided
      if (param === 'expression' && !paramDocs[param]) {
        properties[param].description = 'Mathematical expression to evaluate';
      } else if ((param === 'min' || param === 'max') && !paramDocs[param]) {
        properties[param].description = `${param === 'min' ? 'Minimum' : 'Maximum'} value for random number generation`;
      } else if (param === 'message' && !paramDocs[param]) {
        properties[param].description = 'Message content';
      } else if (param === 'code' && !paramDocs[param]) {
        properties[param].description = 'JavaScript code to execute';
      } else if (param === 'prompt' && !paramDocs[param]) {
        properties[param].description = 'Text prompt for the AI model';
      }
    });
    
    return {
      properties,
      required
    };
  } catch (error) {
    console.error('Error extracting parameters:', error);
    return {
      properties: {},
      required: []
    };
  }
}

// Load available tools for OpenAI to use - with schema caching
async function getAvailableTools() {
  try {
    const toolsDir = path.join(__dirname, 'tools');
    const files = await fs.readdir(toolsDir);
    
    // Process each tool file
    const toolPromises = files
      .filter(file => file.endsWith('.js'))
      .map(async (file) => {
        const toolName = file.replace('.js', '');
        const toolPath = path.join(toolsDir, file);
        const schemaPath = path.join(SCHEMA_CACHE_DIR, `${toolName}-schema.json`);
        
        // Check if we need to regenerate the schema
        const shouldRegenerate = await shouldRegenerateSchema(toolPath, schemaPath);
        
        let toolSchema;
        
        if (!shouldRegenerate) {
          // Load from cache
          try {
            const cachedSchema = await fs.readFile(schemaPath, 'utf-8');
            toolSchema = JSON.parse(cachedSchema);
            console.log(`Loaded cached schema for ${toolName}`);
          } catch (cacheError) {
            console.warn(`Error loading cached schema for ${toolName}:`, cacheError);
            toolSchema = await generateToolSchemaFromSource(toolPath, toolName);
          }
        } else {
          // Generate fresh schema
          toolSchema = await generateToolSchemaFromSource(toolPath, toolName);
          
          // Save to cache
          try {
            await fs.writeFile(schemaPath, JSON.stringify(toolSchema, null, 2));
            console.log(`Saved schema for ${toolName} to cache`);
          } catch (saveError) {
            console.warn(`Error saving schema for ${toolName}:`, saveError);
          }
        }
        
        // Validate and sanitize the schema
        const validatedSchema = validateSchemaForOpenAI(toolSchema);
        
        return {
            type: 'function',
            function: {
              name: toolName,
            description: validatedSchema.description,
              parameters: {
                type: 'object',
              properties: validatedSchema.properties,
              required: validatedSchema.required
            }
          }
        };
      });
    
    return await Promise.all(toolPromises);
  } catch (error) {
    console.error('Error loading available tools:', error);
    return [];
  }
}

/**
 * Checks if we need to regenerate a schema based on modification times
 */
async function shouldRegenerateSchema(toolPath, schemaPath) {
  try {
    // If schema doesn't exist, we need to generate it
    if (!existsSync(schemaPath)) {
      return true;
    }
    
    // Compare modification times
    const toolStats = await fs.stat(toolPath);
    const schemaStats = await fs.stat(schemaPath);
    
    // If tool file is newer than schema, regenerate
    return toolStats.mtime > schemaStats.mtime;
  } catch (error) {
    console.warn(`Error checking modification times:`, error);
    return true; // When in doubt, regenerate
  }
}

/**
 * Generate a tool schema from the source file
 */
async function generateToolSchemaFromSource(toolPath, toolName) {
  try {
    // Read the source code
    const sourceCode = await fs.readFile(toolPath, 'utf-8');
    
    // Use OpenAI to analyze the tool and generate a schema
    return await generateToolSchemaWithAI(sourceCode, toolName);
  } catch (error) {
    console.error(`Error generating schema for ${toolName}:`, error);
    // Fallback to basic extraction
    return extractBasicSchema(await fs.readFile(toolPath, 'utf-8'), toolName);
  }
}

/**
 * Validates and sanitizes a schema to ensure it meets OpenAI's requirements
 */
function validateSchemaForOpenAI(schema) {
  // Create a validated copy of the schema
  const validatedSchema = {
    description: schema.description || "",
    properties: {},
    required: Array.isArray(schema.required) ? schema.required : []
  };
  
  // Process each property to ensure valid types
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    // Deep clone the property to avoid modifying the original
    const validatedProp = { ...prop };
    
    // Ensure the type is a valid JSON Schema type accepted by OpenAI
    if (!validatedProp.type || !isValidOpenAIType(validatedProp.type)) {
      // Default to string for invalid or missing types
      validatedProp.type = 'string';
    }
    
    // If it's an object type with nested properties, validate those too
    if (validatedProp.type === 'object' && validatedProp.properties) {
      const nestedProps = {};
      
      for (const [nestedKey, nestedProp] of Object.entries(validatedProp.properties)) {
        if (typeof nestedProp === 'object') {
          const validatedNestedProp = { ...nestedProp };
          
          if (!validatedNestedProp.type || !isValidOpenAIType(validatedNestedProp.type)) {
            validatedNestedProp.type = 'string';
          }
          
          nestedProps[nestedKey] = validatedNestedProp;
        }
      }
      
      validatedProp.properties = nestedProps;
    }
    
    // Add the validated property to the schema
    validatedSchema.properties[key] = validatedProp;
  }
  
  // Ensure required properties actually exist in properties
  validatedSchema.required = validatedSchema.required.filter(req => 
    validatedSchema.properties[req] !== undefined
  );
  
  return validatedSchema;
}

/**
 * Check if a type is valid for OpenAI's API
 */
function isValidOpenAIType(type) {
  const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
  return validTypes.includes(type.toLowerCase());
}

/**
 * Use OpenAI to analyze tool code and generate a schema
 */
async function generateToolSchemaWithAI(sourceCode, toolName) {
  try {
    // Create a prompt for OpenAI to analyze the tool
    const prompt = `
You are an expert JavaScript developer. Analyze this JavaScript tool file and create a JSON Schema that accurately describes its parameters.

Tool name: ${toolName}

Source code:
\`\`\`javascript
${sourceCode}
\`\`\`

Your task is to:
1. Identify all parameters used by the 'execute' function
2. Determine which parameters are required vs optional
3. Infer the data type of each parameter (use only: string, number, integer, boolean, array, object)
4. Extract or create a description for each parameter
5. Identify the overall purpose of this tool

IMPORTANT: Use ONLY these valid JSON Schema types: string, number, integer, boolean, array, object. DO NOT use types like "any" or custom types.

Return ONLY a JSON object with this structure:
{
  "description": "Overall tool description",
  "properties": {
    "paramName1": {
      "type": "string|number|integer|boolean|array|object",
      "description": "Parameter description"
    },
    ...more parameters
  },
  "required": ["list", "of", "required", "parameter", "names"]
}
`;

    // Call OpenAI API to analyze the code
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You create precise JSON schemas following OpenAI Function Calling API requirements." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2 // Low temperature for more deterministic results
    });

    // Extract the schema from the response
    const schemaText = completion.choices[0].message.content.trim();
    
    // Extract just the JSON part (in case there's surrounding text)
    const jsonMatch = schemaText.match(/({[\s\S]*})/);
    const jsonText = jsonMatch ? jsonMatch[1] : schemaText;
    
    // Parse the JSON schema
    try {
      const schema = JSON.parse(jsonText);
      console.log(`Generated schema for ${toolName}:`, schema);
      return schema;
    } catch (parseError) {
      console.error(`Error parsing schema for ${toolName}:`, parseError);
      console.log("Raw schema text:", jsonText);
      
      // Fallback to basic schema extraction
      return extractBasicSchema(sourceCode, toolName);
    }
  } catch (error) {
    console.error(`Error generating AI schema for ${toolName}:`, error);
    // Fallback to basic extraction in case of API failures
    return extractBasicSchema(sourceCode, toolName);
  }
}

/**
 * Basic fallback schema extraction if OpenAI fails
 */
function extractBasicSchema(sourceCode, toolName) {
  // Extract parameters from destructuring
  const destructuringMatch = sourceCode.match(/const\s+{([^}]+)}\s*=\s*params/);
  const properties = {};
  const required = [];
  
  if (destructuringMatch) {
    destructuringMatch[1].split(',').forEach(p => {
      const paramParts = p.trim().split('=');
      const paramName = paramParts[0].trim();
      const hasDefault = paramParts.length > 1;
      
      properties[paramName] = {
        type: "string",
        description: `${paramName} parameter for ${toolName}`
      };
      
      if (!hasDefault) {
        required.push(paramName);
      }
    });
  }
  
  // Get tool description
  const docCommentMatch = sourceCode.match(/\/\*\*([\s\S]*?)\*\//);
  let description = `${toolName} tool`;
          if (docCommentMatch) {
            description = docCommentMatch[1]
      .replace(/\n\s*\*/g, ' ')
      .replace(/\s+/g, ' ')
              .trim();
          }
  
  return { description, properties, required };
}

// Helper function to execute a tool by name - with parameter fix caching
async function executeToolByName(toolName, params) {
  try {
    const toolPath = path.join(__dirname, 'tools', `${toolName}.js`);
    
    // Check if tool exists
    await fs.access(toolPath);
    
    // Read the source code
    const sourceCode = await fs.readFile(toolPath, 'utf-8');
    
    // Use cached parameter fixes where possible
    const fixedParams = await fixParametersWithCache(sourceCode, toolName, params);
    
    // Log parameters before execution
    console.log(`Executing tool ${toolName} with params:`, fixedParams);
    
    // Import and execute the tool
    const toolModule = await import(`file://${toolPath}`);
    
    // In case params is undefined, use an empty object
    const safeParams = fixedParams || {};
    
    return await toolModule.execute(safeParams);
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    return { error: error.message };
  }
}

/**
 * Fix parameters using cached fixes where possible
 */
async function fixParametersWithCache(sourceCode, toolName, params) {
  // For performance reasons, only do this if we have parameters that might need fixing
  if (!params || Object.keys(params).length === 0) {
    return params;
  }
  
  // Generate a hash of the parameters to use as a cache key
  const paramsHash = generateParamsHash(params);
  const cacheFilePath = path.join(PARAM_FIXES_CACHE_DIR, `${toolName}-${paramsHash}.json`);
  
  // Try to load from cache first
  try {
    if (existsSync(cacheFilePath)) {
      const cachedFixes = JSON.parse(await fs.readFile(cacheFilePath, 'utf-8'));
      console.log(`Using cached parameter fixes for ${toolName}`);
      return cachedFixes;
    }
  } catch (cacheError) {
    console.warn(`Error loading cached parameter fixes:`, cacheError);
  }
  
  // If not in cache, use AI to fix parameters
  const fixedParams = await fixParametersWithAI(sourceCode, toolName, params);
  
  // If the parameters were changed, save to cache
  if (JSON.stringify(params) !== JSON.stringify(fixedParams)) {
    try {
      await fs.writeFile(cacheFilePath, JSON.stringify(fixedParams, null, 2));
      console.log(`Saved parameter fixes for ${toolName} to cache`);
    } catch (saveError) {
      console.warn(`Error saving parameter fixes:`, saveError);
    }
  }
  
  return fixedParams;
}

/**
 * Generate a simple hash of parameters object to use as a cache key
 */
function generateParamsHash(params) {
  const paramsStr = JSON.stringify(params);
  let hash = 0;
  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Use OpenAI to fix parameter mapping issues
 */
async function fixParametersWithAI(sourceCode, toolName, params) {
  // For performance reasons, only do this if we have parameters that might need fixing
  if (!params || Object.keys(params).length === 0) {
    return params;
  }
  
  try {
    // Create a prompt for OpenAI to analyze the parameters
    const prompt = `
You are an expert JavaScript developer. I'm trying to execute this tool but the parameters might be incorrect.

Tool name: ${toolName}

Source code:
\`\`\`javascript
${sourceCode}
\`\`\`

Provided parameters:
\`\`\`json
${JSON.stringify(params, null, 2)}
\`\`\`

Your task is to:
1. Analyze the tool's execute function to identify what parameters it expects
2. Compare with the provided parameters and fix any mapping issues
3. Return the corrected parameters

For example, if the tool expects 'searchQuery' but received 'query', map query's value to searchQuery.
Similarly, if 'prompt' is expected but 'key' was provided with text, the value should be mapped to prompt.

Return ONLY a JSON object with the corrected parameters. Do not include any explanation.
`;

    // Call OpenAI API to fix parameters
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a parameter correction assistant that returns only valid JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2 // Low temperature for more deterministic results
    });

    // Extract the corrected parameters from the response
    const correctedParamsText = completion.choices[0].message.content.trim();
    
    try {
      // Extract just the JSON part (in case there's surrounding text)
      const jsonMatch = correctedParamsText.match(/({[\s\S]*})/);
      const jsonText = jsonMatch ? jsonMatch[1] : correctedParamsText;
      
      // Parse the JSON
      const correctedParams = JSON.parse(jsonText);
      
      // Log if we made any changes
      const changedParams = [];
      for (const [key, value] of Object.entries(correctedParams)) {
        if (params[key] !== value) {
          changedParams.push(`${key}: ${params[key]} → ${value}`);
        }
      }
      
      if (changedParams.length > 0) {
        console.log(`AI fixed parameters for ${toolName}:`, changedParams);
      }
      
      return correctedParams;
    } catch (parseError) {
      console.error(`Error parsing corrected parameters for ${toolName}:`, parseError);
      console.log("Raw corrected parameters:", correctedParamsText);
      return params; // Return original params if parsing fails
    }
  } catch (error) {
    console.error(`Error fixing parameters with AI for ${toolName}:`, error);
    return params; // Return original params in case of API errors
  }
}

// Handle chat messages
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    
    // If it's a direct tool execution command, don't process with AI
    if (message.startsWith('/run ')) {
      return res.json({ 
        response: "I'll execute that tool for you."
      });
    }
    
    // Get available tools for OpenAI
    const availableTools = await getAvailableTools();
    
    // Dynamically generate tool documentation by reading and analyzing all tool files
    const toolDocumentation = await generateToolDocumentation();
    
    // Format conversation history for OpenAI
    const formattedHistory = conversationHistory.map(msg => ({
      role: msg.role || (msg.isUser ? 'user' : 'assistant'),
      content: msg.content
    }));
    
    // Add current message
    formattedHistory.push({
      role: 'user',
      content: message
    });
    
    // Call OpenAI API with tools and dynamic system message
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that can use tools to answer user questions. ${toolDocumentation}`
        },
        ...formattedHistory
      ],
      tools: availableTools,
      tool_choice: "auto"
    });
    
    const responseMessage = completion.choices[0].message;
    
    // Check if the model wants to use a tool
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const toolName = toolCall.function.name;
      let toolParams = {};
      
      try {
        // Parse the tool parameters from the OpenAI response
        toolParams = JSON.parse(toolCall.function.arguments);
        console.log(`Tool params for ${toolName}:`, toolParams);
        
        // Special handling for execute-javascript
        if (toolName === 'execute-javascript' && toolParams.code) {
          // Let the tool handle the code formatting now
          console.log(`JavaScript code to execute: ${toolParams.code}`);
        }
      } catch (e) {
        console.error('Error parsing tool arguments:', e);
      }
      
      // Execute the tool with the parsed parameters
      const toolResult = await executeToolByName(toolName, toolParams);
      
      // Get a response that includes the tool result
      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that can use tools to answer user questions. When reporting results, always explicitly mention the specific values returned by the tool."
          },
          ...formattedHistory,
          responseMessage,
          {
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult)
          }
        ]
      });
      
      // Display name for the tool
      const displayToolName = toolName.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      // Return both the assistant's response and the tool execution info
      return res.json({
        response: finalResponse.choices[0].message.content,
        toolExecuted: true,
        toolName: displayToolName,
        toolResult: toolResult
      });
    }
    
    // If no tool was called, just return the response
    return res.json({
      response: responseMessage.content
    });
    
  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      details: error.message
    });
  }
});

/**
 * Dynamically generates comprehensive documentation for all available tools
 */
async function generateToolDocumentation() {
  try {
    const toolsDir = path.join(__dirname, 'tools');
    const files = await fs.readdir(toolsDir);
    
    // Only process JS files
    const toolFiles = files.filter(file => file.endsWith('.js'));
    
    // Process each tool file
    const toolsInfo = await Promise.all(toolFiles.map(async (file) => {
      const toolName = file.replace('.js', '');
      const toolPath = path.join(toolsDir, file);
      
      try {
        // Read and analyze the source code
        const sourceCode = await fs.readFile(toolPath, 'utf-8');
        
        // Extract parameter information by analyzing the code
        return analyzeToolSource(sourceCode, toolName);
      } catch (err) {
        console.warn(`Could not analyze tool ${toolName}:`, err);
        return {
          name: toolName,
          description: `Error analyzing ${toolName}`,
          parameters: []
        };
      }
    }));
    
    // Convert tool info into a concise documentation string
    let documentation = "When using tools, please pay attention to each tool's required parameters:\n\n";
    
    // Add documentation for each tool
    toolsInfo.forEach(tool => {
      const formattedName = tool.name.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      documentation += `- ${formattedName}: ${tool.description}\n`;
      
      if (tool.parameters.length > 0) {
        documentation += `  Required parameters: ${tool.parameters.join(', ')}\n`;
      }
      
      if (tool.conditionalParams.length > 0) {
        documentation += `  Conditional parameters: ${tool.conditionalParams.join(', ')}\n`;
      }
    });
    
    return documentation;
  } catch (error) {
    console.error('Error generating tool documentation:', error);
    return "";
  }
}

/**
 * Analyzes tool source code to extract information without any hardcoding
 */
function analyzeToolSource(sourceCode, toolName) {
  // Extract the description from JSDoc comments
  const docCommentMatch = sourceCode.match(/\/\*\*([\s\S]*?)\*\//);
  let description = `${toolName} tool`;
  if (docCommentMatch) {
    description = docCommentMatch[1]
      .replace(/\n\s*\*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Find parameter usage patterns
  const requiredParams = [];
  const conditionalParams = [];
  const paramMap = {};
  
  // Extract parameter destructuring
  const destructuringMatch = sourceCode.match(/const\s+{([^}]+)}\s*=\s*params/);
  if (destructuringMatch) {
    destructuringMatch[1].split(',').forEach(p => {
      // Clean up parameter definition
      const paramParts = p.trim().split('=');
      const paramName = paramParts[0].trim();
      const hasDefault = paramParts.length > 1;
      
      paramMap[paramName] = { hasDefault };
      
      // Parameters without defaults are potentially required
      if (!hasDefault) {
        requiredParams.push(paramName);
      }
    });
  }
  
  // Find explicit parameter checks
  const requiredChecks = sourceCode.match(/if\s*\(\s*!\s*params\.([a-zA-Z0-9_]+)\s*\)/g);
  if (requiredChecks) {
    requiredChecks.forEach(match => {
      const param = match.match(/params\.([a-zA-Z0-9_]+)/)[1];
      if (!requiredParams.includes(param)) {
        requiredParams.push(param);
      }
    });
  }
  
  // Find error messages mentioning required parameters
  const errorMatches = sourceCode.match(/error:\s*["']([^"']*(?:required|missing)[^"']*)["']/gi);
  if (errorMatches) {
    errorMatches.forEach(match => {
      // Extract parameter names from error messages
      const paramMatch = match.match(/["']([^"']*(?:required|missing)[^"']*)["']/i);
      if (paramMatch) {
        const errorMsg = paramMatch[1].toLowerCase();
        
        // Try to extract parameter names from the error message
        const paramNameMatch = errorMsg.match(/(\w+)(?:\s+is|\s+parameter is|\s+are)\s+required/i);
        if (paramNameMatch && !requiredParams.includes(paramNameMatch[1])) {
          requiredParams.push(paramNameMatch[1]);
        }
      }
    });
  }
  
  // Find switch statements for conditional parameters
  const switchMatches = sourceCode.match(/switch\s*\(\s*([^)]+)\s*\)[^{]*{([^]*?)}/g);
  if (switchMatches) {
    switchMatches.forEach(switchBlock => {
      const switchVarMatch = switchBlock.match(/switch\s*\(\s*([^)]+)\s*\)/);
      if (switchVarMatch) {
        const switchVar = switchVarMatch[1].trim();
        
        // If switching on a parameter
        if (switchVar === 'action' || switchVar.includes('params.')) {
          const paramName = switchVar.includes('params.') ? 
                            switchVar.replace('params.', '') : switchVar;
          
          // Find all case statements
          const caseMatches = switchBlock.match(/case\s+['"]([^'"]+)['"]/g);
          if (caseMatches && caseMatches.length > 0) {
            const caseValues = caseMatches.map(c => 
              c.match(/case\s+['"]([^'"]+)['"]/)[1]);
            
            conditionalParams.push(`${paramName} (values: ${caseValues.join(', ')})`);
            
            // Analyze each case block for conditional parameter requirements
            caseValues.forEach(caseValue => {
              const caseMatch = switchBlock.match(
                new RegExp(`case\\s+['"]${caseValue}['"]:[^]*?(?=case\\s+['"]|$)`, 's')
              );
              
              if (caseMatch) {
                const caseBlock = caseMatch[0];
                const caseRequiredChecks = caseBlock.match(/if\s*\(\s*!\s*params\.([a-zA-Z0-9_]+)\s*\)/g);
                
                if (caseRequiredChecks) {
                  caseRequiredChecks.forEach(check => {
                    const param = check.match(/params\.([a-zA-Z0-9_]+)/)[1];
                    conditionalParams.push(`${param} (when ${paramName}=${caseValue})`);
                  });
                }
              }
            });
          }
        }
      }
    });
  }
  
  return {
    name: toolName,
    description,
    parameters: requiredParams,
    conditionalParams
  };
}

// Run a specific tool (from manual /run command)
router.post('/run-tool', async (req, res) => {
  try {
    const { toolName, params = {} } = req.body;
    
    console.log(`Running tool ${toolName} with params:`, params);
    
    // Convert the display name to the file name
    const toolFileName = toolName.toLowerCase().replace(/\s+/g, '-');
    const toolPath = path.join(__dirname, 'tools', `${toolFileName}.js`);
    
    // Check if tool exists
    try {
      await fs.access(toolPath);
    } catch (error) {
      return res.status(404).json({ 
        success: false, 
        error: `Tool "${toolName}" not found (looked for ${toolFileName}.js)` 
      });
    }
    
    // Special handling for execute-javascript without code
    if (toolFileName === 'execute-javascript' && !params.code) {
      return res.json({
        success: false,
        result: { 
          error: "No JavaScript code provided. Please provide code to execute.",
          executed: false 
        }
      });
    }
    
    // Import the tool dynamically
    const toolUrl = `file://${toolPath}`;
    const toolModule = await import(toolUrl);
    
    // Execute the tool with the provided parameters
    const result = await toolModule.execute(params);
    
    console.log(`Tool ${toolName} returned:`, result);
    
    res.json({
      success: true,
      result: result
    });
  } catch (error) {
    console.error('Error running tool:', error);
    res.status(500).json({ 
      success: false,
      error: `Failed to run tool: ${error.message}` 
    });
  }
});

export default router;