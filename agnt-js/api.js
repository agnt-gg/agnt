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

// Simple function to get available tools with schemas from cache
async function getAvailableTools() {
  try {
    const toolsDir = path.join(__dirname, 'tools');
    const schemaDir = path.join(__dirname, 'schema-cache');
    const files = await fs.readdir(toolsDir);
    
    // Process each tool file
    const toolPromises = files
      .filter(file => file.endsWith('.js'))
      .map(async (file) => {
        const toolName = file.replace('.js', '');
        const schemaPath = path.join(schemaDir, `${toolName}-schema.json`);
        
        // Default minimal tool definition
        let toolDef = {
          type: 'function',
          function: {
            name: toolName,
            description: `${toolName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} tool`,
            parameters: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        };
        
        // Try to load schema if it exists
        try {
          const schemaContent = await fs.readFile(schemaPath, 'utf-8');
          const schema = JSON.parse(schemaContent);
          
          // Update tool definition with schema data
          toolDef.function.description = schema.description || toolDef.function.description;
          toolDef.function.parameters.properties = schema.properties || {};
          toolDef.function.parameters.required = schema.required || [];
        } catch (err) {
          console.log(`Using default definition for ${toolName}, no schema found: ${err.message}`);
        }
        
        return toolDef;
      });
    
    return await Promise.all(toolPromises);
  } catch (error) {
    console.error('Error loading available tools:', error);
    return [];
  }
}

// Helper function to execute a tool by name
async function executeToolByName(toolName, params) {
  try {
    const toolPath = path.join(__dirname, 'tools', `${toolName}.js`);
    
    // Check if tool exists
    await fs.access(toolPath);
    
    // Log parameters before execution
    console.log(`Executing tool ${toolName} with params:`, params);
    
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
    
    // Get available tools for OpenAI (now with schemas included)
    const availableTools = await getAvailableTools();
    console.log(`[DEBUG] Got ${availableTools.length} available tools for function calling`);
    
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
    
    // Stronger system message that explicitly encourages using multiple tools in sequence
    const systemMessage = `You are a helpful assistant that can use tools to answer user questions. IMPORTANT: When a user request can be solved with multiple tools, you should use them in sequence. For example, if asked to "generate a random number and log it", you should use the random-number tool FOLLOWED BY the log-message tool. Chain tools together to complete multi-step tasks.`;
    
    // Add tool_choice parameter to encourage multiple tool selection
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemMessage
        },
        ...formattedHistory
      ],
      tools: availableTools,
      tool_choice: "auto"
    });
    
    const responseMessage = completion.choices[0].message;
    
    // Check if the model wants to use tools
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      console.log(`[DEBUG] Model decided to use ${responseMessage.tool_calls.length} tools`);
      
      // Process all tool calls
      const toolCallPromises = responseMessage.tool_calls.map(async (toolCall) => {
        const toolName = toolCall.function.name;
        let toolParams = {};
        
        try {
          // Parse the tool parameters
          toolParams = JSON.parse(toolCall.function.arguments);
          console.log(`Tool params for ${toolName}:`, toolParams);
        } catch (e) {
          console.error('Error parsing tool arguments:', e);
        }
        
        // Execute the tool
        const toolResult = await executeToolByName(toolName, toolParams);
        
        // Return tool call and result
        return {
          tool_call_id: toolCall.id,
          name: toolName,
          result: toolResult,
          displayName: toolName.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ')
        };
      });
      
      // Wait for all tool executions to complete
      const toolResults = await Promise.all(toolCallPromises);
      
      // Prepare messages for final completion
      const toolMessages = toolResults.map(result => ({
        role: "tool",
        tool_call_id: result.tool_call_id,
        name: result.name,
        content: JSON.stringify(result.result)
      }));
      
      // Get final response with all tool results
      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: systemMessage
          },
          ...formattedHistory,
          responseMessage,
          ...toolMessages
        ]
      });
      
      // Modified response format that the frontend can handle
      // This format adds a property to display all tool results
      // while maintaining backward compatibility
      return res.json({
        response: finalResponse.choices[0].message.content,
        toolExecuted: true,
        toolName: toolResults[0].displayName,
        toolResult: toolResults[0].result,
        // New property for multiple tools with more detail
        allTools: toolResults.map(tool => ({
          name: tool.displayName,
          result: tool.result
        }))
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