//                                __       
//                               /  |      
//   _______   ______    ______  $$ |   __ 
//  /       | /      \  /      \ $$ |  /  |
// /$$$$$$$/ /$$$$$$  |/$$$$$$  |$$ |_/$$/ 
// $$      \ $$ |  $$ |$$ |  $$/ $$   $$<  
//  $$$$$$  |$$ |__$$ |$$ |      $$$$$$  \ 
// /     $$/ $$    $$/ $$ |      $$ | $$  |
// $$$$$$$/  $$$$$$$/  $$/       $$/   $$/ 
//           $$ |                          
//           $$ |                          
//           $$/                                
// 
//
// SPONTANEOUS PROCESS & ROUTE KINETICS
// THE PRIMARY TOOL & WORKFLOW GENERATOR SYSTEM

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPRK_EXECUTION, displayColoredArt, COLORS } from '../utils/ascii-art.js';
import { OpenAI } from 'openai';

// Get the directory name properly in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class SPRK {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Load schemas
    this.schemas = this.loadSchemas();
  }
  
  // Load all relevant schemas
  loadSchemas() {
    try {
      const schemaDir = path.resolve(__dirname, '../schema-patterns');
      const schemas = {};
      
      // Load tool schema
      const toolSchemaPath = path.join(schemaDir, 'toolSchema.json');
      if (fs.existsSync(toolSchemaPath)) {
        schemas.tool = JSON.parse(fs.readFileSync(toolSchemaPath, 'utf8'));
      }
      
      // Load workflow schema
      const workflowSchemaPath = path.join(schemaDir, 'workflowSchema.json');
      if (fs.existsSync(workflowSchemaPath)) {
        schemas.workflow = JSON.parse(fs.readFileSync(workflowSchemaPath, 'utf8'));
      }
      
      return schemas;
    } catch (error) {
      console.error('Error loading schemas:', error);
      return {};
    }
  }

  // Generate a new tool based on description
  async generateTool(description, options = {}) {
    displayColoredArt(SPRK_EXECUTION, COLORS.FG_CYAN);
    console.log(`Generating tool from description: "${description}"`);
    
    try {
      const prompt = this.createToolGenerationPrompt(description, options);
      const response = await this.callLLM(prompt);
      
      if (!response) {
        throw new Error('Failed to generate tool');
      }
      
      // Parse and validate the generated tool
      const tool = this.parseToolResponse(response);
      
      // Save the tool
      const saved = this.saveTool(tool);
      
      return {
        success: true,
        tool,
        files: saved
      };
    } catch (error) {
      console.error('Error generating tool:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Generate a new workflow based on description
  async generateWorkflow(description, options = {}) {
    displayColoredArt(SPRK_EXECUTION, COLORS.FG_CYAN);
    console.log(`Generating workflow from description: "${description}"`);
    
    try {
      const prompt = this.createWorkflowGenerationPrompt(description, options);
      const response = await this.callLLM(prompt);
      
      if (!response) {
        throw new Error('Failed to generate workflow');
      }
      
      // Parse and validate the generated workflow
      const workflow = this.parseWorkflowResponse(response);
      
      // Save the workflow
      const saved = this.saveWorkflow(workflow);
      
      return {
        success: true,
        workflow,
        files: saved
      };
    } catch (error) {
      console.error('Error generating workflow:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Create prompt for tool generation
  createToolGenerationPrompt(description, options) {
    return `You are a code generator specialized in creating tools for the AGNT system.
I need you to create a new tool based on this description: "${description}"

This tool should follow our toolSchema.json structure:
${JSON.stringify(this.schemas.tool, null, 2)}

IMPORTANT:
- This is an ES Module environment, not CommonJS
- Use ES Module syntax (export default or named exports)
- DO NOT use module.exports or require()
- Use "import" instead of "require"
- Use "export" instead of "module.exports"
- Always export an "execute" function

Please generate:
1. A tool configuration JSON object that matches our schema
2. A JavaScript implementation file that exports an execute() function using ES Module syntax

Example of correct export syntax:
\`\`\`javascript
export async function execute(params, context) {
  // Function implementation
  return result;
}
\`\`\`

DO NOT use this incorrect syntax:
\`\`\`javascript
// WRONG - DO NOT USE THIS:
module.exports = {
  execute: async function(params, context) {
    // Function implementation
  }
};
\`\`\`

The tool should be named appropriately based on its function.
${options.category ? `The tool should be in the "${options.category}" category.` : ''}
${options.constraints ? `Additional constraints: ${options.constraints}` : ''}

Format your response as:
\`\`\`json:toolConfig
{TOOL CONFIG JSON HERE}
\`\`\`

\`\`\`javascript:implementation
// ES Module implementation
export async function execute(params, context) {
  // Your implementation here
  return result;
}
\`\`\`

Be thorough and practical in your implementation.`;
  }
  
  // Create prompt for workflow generation
  createWorkflowGenerationPrompt(description, options) {
    // Gather available tools to inform the workflow creation
    const availableTools = this.getAvailableTools();
    
    return `You are a workflow generator specialized in creating workflows for the AGNT system.
I need you to create a new workflow based on this description: "${description}"

This workflow should follow our workflowSchema.json structure:
${JSON.stringify(this.schemas.workflow, null, 2)}

Here are the available tools you can use in this workflow:
${JSON.stringify(availableTools, null, 2)}

Please generate a complete workflow JSON that:
1. Has a unique ID and descriptive name
2. Uses the appropriate tools from the available list
3. Contains logical edges between nodes with proper conditions
${options.constraints ? `Additional constraints: ${options.constraints}` : ''}

Format your response as:
\`\`\`json:workflow
{WORKFLOW JSON HERE}
\`\`\`

Make sure connections between nodes are logical and the workflow accomplishes the described task.`;
  }
  
  // Get available tools for workflow generation
  getAvailableTools() {
    try {
      const toolsDir = path.resolve(__dirname, '../tools');
      const toolConfigs = [];
      
      // Read all JSON files in the tools config directory
      const configDir = path.resolve(__dirname, '../config/tools');
      if (fs.existsSync(configDir)) {
        const files = fs.readdirSync(configDir);
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const configPath = path.join(configDir, file);
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            toolConfigs.push({
              type: config.type,
              title: config.title,
              category: config.category,
              description: config.description,
              parameters: Object.keys(config.parameters || {})
            });
          }
        }
      }
      
      return toolConfigs;
    } catch (error) {
      console.error('Error getting available tools:', error);
      return [];
    }
  }
  
  // Call the LLM (OpenAI GPT)
  async callLLM(prompt) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a code generator for the AGNT workflow system." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
      });
      
      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Error calling OpenAI:', error);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
  
  // Parse tool response from LLM
  parseToolResponse(response) {
    try {
      // Extract the JSON config
      const configMatch = response.match(/```json:toolConfig\n([\s\S]*?)\n```/);
      if (!configMatch) throw new Error('Tool config not found in response');
      
      const config = JSON.parse(configMatch[1]);
      
      // Extract the implementation code
      const codeMatch = response.match(/```javascript:implementation\n([\s\S]*?)\n```/);
      if (!codeMatch) throw new Error('Tool implementation not found in response');
      
      const code = codeMatch[1];
      
      return {
        config,
        code
      };
    } catch (error) {
      throw new Error(`Error parsing tool response: ${error.message}`);
    }
  }
  
  // Parse workflow response from LLM
  parseWorkflowResponse(response) {
    try {
      // Extract the JSON workflow
      const match = response.match(/```json:workflow\n([\s\S]*?)\n```/);
      if (!match) throw new Error('Workflow JSON not found in response');
      
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`Error parsing workflow response: ${error.message}`);
    }
  }
  
  // Save generated tool
  saveTool(tool) {
    try {
      // Ensure directories exist
      const toolsDir = path.resolve(__dirname, '../tools');
      const configDir = path.resolve(__dirname, '../config/tools');
      
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Generate filenames based on tool type
      const toolType = tool.config.type;
      const jsFilename = path.join(toolsDir, `${toolType}.js`);
      const configFilename = path.join(configDir, `${toolType}.json`);
      
      // Save the tool implementation
      fs.writeFileSync(jsFilename, tool.code, 'utf8');
      
      // Save the tool config
      fs.writeFileSync(configFilename, JSON.stringify(tool.config, null, 2), 'utf8');
      
      return {
        implementation: jsFilename,
        config: configFilename
      };
    } catch (error) {
      throw new Error(`Error saving tool: ${error.message}`);
    }
  }
  
  // Save generated workflow
  saveWorkflow(workflow) {
    try {
      // Ensure directory exists
      const workflowsDir = path.resolve(__dirname, '../workflows');
      
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
      }
      
      // Generate filename
      const filename = path.join(workflowsDir, `${workflow.id}.json`);
      
      // Save the workflow
      fs.writeFileSync(filename, JSON.stringify(workflow, null, 2), 'utf8');
      
      return { workflow: filename };
    } catch (error) {
      throw new Error(`Error saving workflow: ${error.message}`);
    }
  }
}

// EXAMPLE USAGE:

// import SPRK from './orchestrator/SPRK.js';

// // Create an instance
// const sprk = new SPRK();

// // Generate a new tool **********************************************
// // Basic tool generation
// const toolResult = await sprk.generateTool("A tool that fetches the current weather for a given location");

// // Tool generation with options
// const advancedToolResult = await sprk.generateTool(
//   "A tool that summarizes long text using NLP techniques", 
//   {
//     category: "utility", // Specify the category (trigger, action, utility, control)
//     constraints: "Make sure it handles at least 3 different languages and has a max character limit option"
//   }
// );

// // Check the result
// if (toolResult.success) {
//   console.log("Tool generated successfully!");
//   console.log("Tool config:", toolResult.tool.config);
//   console.log("Files created:", toolResult.files);
// } else {
//   console.error("Failed to generate tool:", toolResult.error);
// }

// // Generate a new workflow **********************************************

// // Basic workflow generation
// const workflowResult = await sprk.generateWorkflow(
//     "Create a workflow that fetches weather data and sends an email alert if it's going to rain"
//   );
  
//   // Workflow with options
//   const advancedWorkflowResult = await sprk.generateWorkflow(
//     "Create a workflow that monitors a website for changes and sends notifications", 
//     {
//       constraints: "Use existing HTTP request and notification tools, check every 6 hours"
//     }
//   );
  
//   // Check the result
//   if (workflowResult.success) {
//     console.log("Workflow generated successfully!");
//     console.log("Workflow ID:", workflowResult.workflow.id);
//     console.log("File created:", workflowResult.files.workflow);
//   } else {
//     console.error("Failed to generate workflow:", workflowResult.error);
//   }
