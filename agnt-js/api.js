import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// Load available tools for OpenAI to use
async function getAvailableTools() {
  try {
    const toolsDir = path.join(__dirname, 'tools');
    const files = await fs.readdir(toolsDir);
    
    const tools = [];
    for (const file of files) {
      if (file.endsWith('.js')) {
        const toolName = file.replace('.js', '');
        const displayName = toolName.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        
        const toolPath = path.join(toolsDir, file);
        
        // Custom definition for execute-javascript
        if (toolName === 'execute-javascript') {
          tools.push({
            type: 'function',
            function: {
              name: toolName,
              description: 'Executes JavaScript code and returns the result.',
              parameters: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description: 'Valid JavaScript code to execute. Can be a simple expression like "Math.PI" or a more complex block of code.'
                  }
                },
                required: ['code']
              }
            }
          });
          continue;
        }
        
        // Process other tools normally
        // Try to get description and parameters from tool file
        let description = `Use the ${displayName} tool`;
        try {
          const fileContent = await fs.readFile(toolPath, 'utf-8');
          const docCommentMatch = fileContent.match(/\/\*\*([\s\S]*?)\*\//);
          if (docCommentMatch) {
            description = docCommentMatch[1]
              .replace(/\n \*/g, '')
              .trim();
          }
        } catch (e) {
          console.warn(`Could not read description for ${toolName}:`, e);
        }
        
        // Extract parameter information
        const { properties, required } = await extractToolParameters(toolPath);
        
        // Create tool definition
        tools.push({
          type: 'function',
          function: {
            name: toolName,
            description: description,
            parameters: {
              type: 'object',
              properties: properties,
              required: required
            }
          }
        });
      }
    }
    
    return tools;
  } catch (error) {
    console.error('Error loading available tools:', error);
    return [];
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
    
    // Call OpenAI API with tools
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that can use tools to answer user questions. If the user's request can be helped by using a tool, use the appropriate tool with appropriate parameters. Always pass all required parameters to tools."
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
        model: "gpt-3.5-turbo",
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

// Helper function to execute a tool by name
async function executeToolByName(toolName, params) {
  try {
    // Log parameters before execution
    console.log(`Executing tool ${toolName} with params:`, params);
    
    // Convert the tool name to file path
    const toolPath = path.join(__dirname, 'tools', `${toolName}.js`);
    
    // Check if tool exists
    await fs.access(toolPath);
    
    // Import and execute the tool
    const toolModule = await import(`file://${toolPath}`);
    
    // In case params is undefined, use an empty object
    const safeParams = params || {};
    
    return await toolModule.execute(safeParams);
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    return { error: error.message };
  }
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