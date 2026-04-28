import db from '../../models/database/index.js';

export function getToolForgeToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'generate_tool_update',
        description: 'Use AI to generate, create, or update a tool based on natural language instructions',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'Natural language instruction describing what to do with the tool',
            },
            currentToolState: {
              type: 'object',
              description: 'Current state/configuration of the tool being modified (optional)',
            },
            operationType: {
              type: 'string',
              enum: ['create', 'update', 'modify'],
              description: 'Type of operation to perform',
            },
          },
          required: ['instruction'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_tool',
        description: 'Save the current tool to the database',
        parameters: {
          type: 'object',
          properties: {
            toolData: { type: 'object', description: 'The tool data to save' },
            isShareable: { type: 'boolean', description: 'Whether the tool should be shareable' },
          },
          required: ['toolData'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_tool',
        description: 'Load a tool by its ID',
        parameters: {
          type: 'object',
          properties: {
            toolId: { type: 'string', description: 'The ID of the tool to load' },
          },
          required: ['toolId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_tool',
        description: 'Delete a tool from the database',
        parameters: {
          type: 'object',
          properties: {
            toolId: { type: 'string', description: 'The ID of the tool to delete' },
          },
          required: ['toolId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_tools',
        description: 'List all available tools',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter by category (optional)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_tool',
        description: 'Execute/run the current tool with provided parameters',
        parameters: {
          type: 'object',
          properties: {
            toolData: { type: 'object', description: 'The tool configuration to run' },
            parameters: { type: 'object', description: 'The parameters to pass to the tool' },
          },
          required: ['toolData'],
        },
      },
    },
  ];
}

export async function executeToolForgeTool(functionName, args, authToken, context) {
  const { userId, provider, model } = context;

  try {
    let result;

    switch (functionName) {
      case 'generate_tool_update': {
        const StreamEngine = (await import('../../stream/StreamEngine.js')).default;
        const streamEngine = new StreamEngine(userId);

        try {
          let enhancedInstruction = args.instruction;

          if (args.currentToolState && Object.keys(args.currentToolState).length > 0) {
            enhancedInstruction = `Current tool state: ${JSON.stringify(args.currentToolState, null, 2)}\n\nInstruction: ${
              args.instruction
            }\n\nPlease modify the existing tool according to the instruction, keeping existing fields that aren't being changed.`;
          }

          const generatedResult = await streamEngine.generateTool(enhancedInstruction, provider, model);
          const toolData = JSON.parse(generatedResult.template);

          result = {
            success: true,
            toolData,
            operationType: args.operationType || 'update',
            message: `Successfully ${args.operationType || 'updated'} tool based on instruction: "${args.instruction}"`,
            frontendEvents: generateFrontendEvents(toolData, args.operationType || 'update'),
          };
        } catch (generationError) {
          console.error('Error in tool generation:', generationError);
          result = {
            success: false,
            error: generationError.message,
            message: 'Failed to generate/update tool. Please try rephrasing your instruction.',
          };
        }
        break;
      }

      case 'save_tool':
        if (args.toolData && db) {
          const toolId = args.toolData.id || `tool-${Date.now()}`;
          const toolData = {
            ...args.toolData,
            id: toolId,
            isShareable: args.isShareable || false,
            updatedAt: new Date().toISOString(),
          };

          result = await new Promise((resolve) => {
            const query = `INSERT OR REPLACE INTO tools (id, base, title, category, type, icon, description, config, code, parameters, outputs, created_by, is_shareable, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

            const parameters = toolData.parameters || toolData.fields || {};
            const outputs = toolData.outputs || {};

            db.run(
              query,
              [
                toolId,
                toolData.base || 'AI',
                toolData.name || 'Untitled Tool',
                'custom',
                toolData.type || `custom-tool-${Date.now()}`,
                toolData.icon || 'custom',
                toolData.description || '',
                toolData.config ? JSON.stringify(toolData.config) : null,
                toolData.code || null,
                JSON.stringify(parameters),
                JSON.stringify(outputs),
                userId,
                args.isShareable ? 1 : 0,
              ],
              function (err) {
                if (err) {
                  resolve({ success: false, message: err.message });
                } else {
                  resolve({
                    success: true,
                    toolId,
                    toolData,
                    message: 'Tool saved successfully to database',
                  });
                }
              }
            );
          });
        } else {
          result = { success: false, message: 'Tool data is required for saving' };
        }
        break;

      case 'load_tool':
        if (args.toolId && db) {
          result = await new Promise((resolve) => {
            db.get('SELECT * FROM tools WHERE id = ? AND (created_by = ? OR is_shareable = 1)', [args.toolId, userId], (err, row) => {
              if (err || !row) {
                resolve({ success: false, message: err ? err.message : 'Tool not found or access denied' });
              } else {
                resolve({
                  success: true,
                  toolData: JSON.parse(row.parameters || '{}'),
                  message: 'Tool loaded successfully',
                });
              }
            });
          });
        } else {
          result = { success: false, message: 'Tool ID required' };
        }
        break;

      case 'delete_tool':
        if (args.toolId && db) {
          result = await new Promise((resolve) => {
            db.run('DELETE FROM tools WHERE id = ? AND created_by = ?', [args.toolId, userId], function (err) {
              if (err) {
                resolve({ success: false, message: err.message });
              } else {
                resolve({
                  success: this.changes > 0,
                  toolId: args.toolId,
                  message: this.changes > 0 ? 'Tool deleted successfully' : 'Tool not found or unauthorized',
                });
              }
            });
          });
        } else {
          result = { success: false, message: 'Tool ID required' };
        }
        break;

      case 'list_tools':
        if (db) {
          result = await new Promise((resolve) => {
            const query = args.category
              ? 'SELECT id, title, description, category, created_at FROM tools WHERE created_by = ? AND category = ?'
              : 'SELECT id, title, description, category, created_at FROM tools WHERE created_by = ?';
            const params = args.category ? [userId, args.category] : [userId];

            db.all(query, params, (err, rows) => {
              if (err) {
                resolve({ success: false, message: err.message });
              } else {
                const toolList = rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  description: row.description,
                  category: row.category,
                  createdAt: row.created_at,
                }));
                resolve({
                  success: true,
                  tools: toolList,
                  count: toolList.length,
                  message: `Found ${toolList.length} tools`,
                });
              }
            });
          });
        } else {
          result = { success: false, message: 'Unable to list tools - database not available' };
        }
        break;

      case 'run_tool':
        if (args.toolData) {
          result = {
            success: true,
            toolData: args.toolData,
            parameters: args.parameters || {},
            message: 'Tool execution initiated successfully',
            executionId: `exec-${Date.now()}`,
          };
        } else {
          result = { success: false, message: 'Tool data is required for execution' };
        }
        break;

      default:
        result = { success: false, message: `Unknown function: ${functionName}` };
    }

    return JSON.stringify(result);
  } catch (error) {
    console.error(`Error executing tool function ${functionName}:`, error);
    return JSON.stringify({ success: false, error: error.message });
  }
}

function generateFrontendEvents(toolData, operationType) {
  const events = [];

  if (toolData.name) {
    events.push({ type: 'tool-field-updated', data: { field: 'title', value: toolData.name } });
  }
  if (toolData.description) {
    events.push({ type: 'tool-field-updated', data: { field: 'description', value: toolData.description } });
  }
  if (toolData.base) {
    let toolType = 'AI';
    if (toolData.base.toLowerCase() === 'javascript') toolType = 'CODE_JS';
    else if (toolData.base.toLowerCase() === 'python') toolType = 'CODE_PYTHON';
    events.push({ type: 'tool-field-updated', data: { field: 'toolType', value: toolType } });
  }
  if (toolData.code) {
    events.push({ type: 'tool-field-updated', data: { field: 'code', value: toolData.code } });
  }

  const instructionsField = toolData.fields?.find((f) => f.name === 'template-instructions');
  if (instructionsField) {
    events.push({ type: 'tool-field-updated', data: { field: 'instructions', value: instructionsField.value } });
  }

  if (toolData.fields) {
    toolData.fields.forEach((field) => {
      if (['template-name', 'template-instructions'].includes(field.name)) return;
      events.push({
        type: 'tool-custom-field-added',
        data: {
          fieldName: field.name,
          fieldType: field.type || 'text',
          label: field.label || field.name,
          value: field.value || '',
        },
      });
    });
  }

  if (operationType === 'create') {
    events.unshift({ type: 'tool-fields-cleared', data: {} });
  }

  return events;
}
