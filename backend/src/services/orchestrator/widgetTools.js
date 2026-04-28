import { randomUUID } from 'crypto';
import db from '../../models/database/index.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from './llmAdapters.js';

export function getWidgetToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'edit_widget_code',
        description: 'Apply surgical search/replace edits to the current widget source code. Use this for bug fixes, style tweaks, adding features, or any targeted modification. Each edit is a { search, replace } pair applied sequentially.',
        parameters: {
          type: 'object',
          properties: {
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  search: { type: 'string', description: 'Exact string to find in the current source code' },
                  replace: { type: 'string', description: 'Replacement string' },
                },
                required: ['search', 'replace'],
              },
              description: 'Array of search/replace pairs to apply sequentially',
            },
            description: { type: 'string', description: 'Brief summary of what these edits accomplish' },
          },
          required: ['edits', 'description'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_widget',
        description: 'Generate a complete self-contained HTML widget from scratch via a specialized code-generation LLM. Use this when creating a brand new widget or doing a complete rewrite. For smaller edits to existing code, prefer edit_widget_code instead.',
        parameters: {
          type: 'object',
          properties: {
            instruction: { type: 'string', description: 'Natural language instruction describing what to build' },
            operationType: {
              type: 'string',
              enum: ['create', 'rewrite'],
              description: 'Whether this is a new widget or a complete rewrite of an existing one',
            },
            useThemeStyles: {
              type: 'boolean',
              description: "When true, the widget uses the app's CSS theme variables for styling. Default to true unless the user explicitly wants custom/standalone styling.",
            },
          },
          required: ['instruction'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_widget_config',
        description: 'Update widget metadata/configuration without touching the source code. Use this for renaming, changing icon, category, description, size constraints, or widget type.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'New widget name' },
            description: { type: 'string', description: 'New widget description' },
            icon: { type: 'string', description: 'New FontAwesome icon class (e.g. "fas fa-chart-bar")' },
            category: { type: 'string', enum: ['custom', 'dashboard', 'home', 'assets', 'system'], description: 'New category' },
            widget_type: { type: 'string', enum: ['html', 'template', 'iframe', 'markdown'], description: 'New widget type' },
            default_size: { type: 'object', properties: { cols: { type: 'integer' }, rows: { type: 'integer' } }, description: 'New default grid size' },
            min_size: { type: 'object', properties: { cols: { type: 'integer' }, rows: { type: 'integer' } }, description: 'New minimum grid size' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_widget',
        description: 'Save the current widget definition to the database',
        parameters: {
          type: 'object',
          properties: {
            widgetData: { type: 'object', description: 'The widget data to save' },
          },
          required: ['widgetData'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_widget',
        description: 'Load a widget definition by its ID',
        parameters: {
          type: 'object',
          properties: {
            widgetId: { type: 'string', description: 'The ID of the widget to load' },
          },
          required: ['widgetId'],
        },
      },
    },
  ];
}

export async function executeWidgetTool(functionName, args, authToken, context) {
  const { userId, widgetState } = context;

  try {
    let result;

    switch (functionName) {
      case 'edit_widget_code': {
        try {
          const currentSource = widgetState?.source_code || '';
          if (!currentSource) {
            result = {
              success: false,
              error: 'No source code exists yet. Use generate_widget to create the initial widget first.',
              message: 'Cannot apply edits - no source code found.',
            };
            break;
          }

          let updatedSource = currentSource;
          const applied = [];
          const failed = [];

          for (let i = 0; i < args.edits.length; i++) {
            const edit = args.edits[i];
            const match = fuzzyFind(updatedSource, edit.search);
            if (match) {
              updatedSource = updatedSource.substring(0, match.start) + edit.replace + updatedSource.substring(match.end);
              applied.push({ index: i, search: edit.search.substring(0, 80) });
            } else {
              failed.push({ index: i, search: edit.search.substring(0, 80), reason: 'Search string not found in source code' });
            }
          }

          if (applied.length === 0) {
            result = {
              success: false,
              error: 'None of the search strings were found in the current source code.',
              failed,
              message: 'No edits could be applied. Check that your search strings exactly match the current source code.',
            };
            break;
          }

          const widgetData = { source_code: updatedSource };
          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';

          try {
            if (db && isExistingWidget) {
              await new Promise((resolve, reject) => {
                db.run(
                  'UPDATE widget_definitions SET source_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [updatedSource, existingId],
                  (err) => (err ? reject(err) : resolve())
                );
              });
              widgetData.id = existingId;
            }
          } catch (saveErr) {
            console.error('Widget auto-save failed:', saveErr.message);
          }

          if (widgetState) widgetState.source_code = updatedSource;

          const frontendEvents = generateWidgetFrontendEvents(widgetData, 'update');
          if (existingId && existingId !== 'widget-forge') {
            frontendEvents.push({
              type: 'widget-autosaved',
              data: { id: existingId, widgetData: { ...widgetState, source_code: updatedSource } },
            });
          }

          result = {
            success: true,
            applied,
            failed: failed.length > 0 ? failed : undefined,
            description: args.description,
            message: `Applied ${applied.length}/${args.edits.length} edits: ${args.description}`,
            frontendEvents,
          };
        } catch (editError) {
          console.error('Error in edit_widget_code:', editError);
          result = { success: false, error: editError.message, message: 'Failed to apply edits to widget code.' };
        }
        break;
      }

      case 'generate_widget': {
        try {
          let enhancedInstruction = args.instruction;
          if (args.operationType === 'rewrite' && widgetState?.source_code) {
            enhancedInstruction = `Current widget source code:\n${widgetState.source_code}\n\nInstruction: ${args.instruction}\n\nCompletely rewrite the widget according to the instruction.`;
          }

          const client = await createLlmClient(context.provider || 'openai', userId);
          const adapter = await createLlmAdapter(context.provider || 'openai', client, context.model || 'gpt-4');
          const useTheme = args.useThemeStyles !== undefined ? args.useThemeStyles !== false : widgetState?.useThemeStyles !== false;
          const widgetGenPrompt = buildWidgetGenerationPrompt(enhancedInstruction, useTheme);

          const { responseMessage } = await adapter.call(
            [
              {
                role: 'system',
                content: 'You generate widget HTML. Return ONLY the raw HTML document. No markdown, no JSON, no explanation - just the HTML starting with <!DOCTYPE html>.',
              },
              { role: 'user', content: widgetGenPrompt },
            ],
            []
          );

          let content = extractText(responseMessage).trim();
          if (content.startsWith('```html')) content = content.substring(7);
          else if (content.startsWith('```')) content = content.substring(3);
          if (content.endsWith('```')) content = content.substring(0, content.length - 3);
          content = content.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

          const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
          const widgetName = titleMatch ? titleMatch[1].trim() : args.instruction.substring(0, 50) + (args.instruction.length > 50 ? '...' : '');
          const widgetData = {
            name: widgetName,
            description: args.instruction.substring(0, 200),
            widget_type: 'html',
            source_code: content,
          };

          const operationType = args.operationType || 'create';
          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';
          let savedWidgetId = existingId;

          try {
            if (db) {
              if (isExistingWidget) {
                await new Promise((resolve, reject) => {
                  db.run(
                    'UPDATE widget_definitions SET name = ?, description = ?, source_code = ?, widget_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [widgetData.name, widgetData.description, widgetData.source_code, widgetData.widget_type, existingId],
                    (err) => (err ? reject(err) : resolve())
                  );
                });
              } else {
                savedWidgetId = 'cw_' + randomUUID().replace(/-/g, '').slice(0, 12);
                await new Promise((resolve, reject) => {
                  db.run(
                    `INSERT INTO widget_definitions (id, user_id, name, description, icon, category, widget_type, source_code, config, data_bindings, default_size, min_size)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      savedWidgetId,
                      userId || 'anonymous',
                      widgetData.name,
                      widgetData.description,
                      'fas fa-puzzle-piece',
                      'custom',
                      widgetData.widget_type,
                      widgetData.source_code,
                      '{}',
                      '[]',
                      '{"cols":4,"rows":3}',
                      '{"cols":2,"rows":2}',
                    ],
                    (err) => (err ? reject(err) : resolve())
                  );
                });
              }
              widgetData.id = savedWidgetId;
            }
          } catch (saveErr) {
            console.error('Widget auto-save failed:', saveErr.message);
          }

          if (widgetState) {
            widgetState.source_code = content;
            widgetState.name = widgetData.name;
            widgetState.description = widgetData.description;
            widgetState.widget_type = widgetData.widget_type;
            if (savedWidgetId) widgetState.id = savedWidgetId;
          }

          const frontendEvents = generateWidgetFrontendEvents(widgetData, operationType);
          if (savedWidgetId && savedWidgetId !== 'widget-forge') {
            frontendEvents.push({ type: 'widget-autosaved', data: { id: savedWidgetId, widgetData } });
          }

          const { source_code: _sourceCode, ...widgetDataSummary } = widgetData;
          result = {
            success: true,
            widgetData: { ...widgetDataSummary, source_code_length: content.length },
            operationType,
            message: `Successfully generated widget: "${widgetData.name}"`,
            frontendEvents,
          };
        } catch (generationError) {
          console.error('Error in generate_widget:', generationError);
          result = {
            success: false,
            error: generationError.message,
            message: 'Failed to generate widget. Please try rephrasing your instruction.',
          };
        }
        break;
      }

      case 'update_widget_config': {
        try {
          const validCategories = ['custom', 'dashboard', 'home', 'assets', 'system'];
          const configFields = ['name', 'description', 'icon', 'category', 'widget_type', 'default_size', 'min_size'];
          const updates = {};
          for (const field of configFields) {
            if (args[field] !== undefined) updates[field] = args[field];
          }
          if (updates.category && !validCategories.includes(updates.category)) updates.category = 'custom';

          if (Object.keys(updates).length === 0) {
            result = {
              success: false,
              error: 'No fields provided to update.',
              message: 'Please specify at least one field to update (name, description, icon, category, widget_type, default_size, min_size).',
            };
            break;
          }

          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';
          if (db && isExistingWidget) {
            const setClauses = [];
            const params = [];
            for (const [field, value] of Object.entries(updates)) {
              setClauses.push(`${field} = ?`);
              params.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
            setClauses.push('updated_at = CURRENT_TIMESTAMP');
            params.push(existingId);
            await new Promise((resolve, reject) => {
              db.run(`UPDATE widget_definitions SET ${setClauses.join(', ')} WHERE id = ?`, params, (err) => (err ? reject(err) : resolve()));
            });
          }

          if (widgetState) Object.assign(widgetState, updates);
          const frontendEvents = Object.entries(updates).map(([field, value]) => ({
            type: 'widget-field-updated',
            data: { field, value },
          }));
          if (isExistingWidget) {
            frontendEvents.push({ type: 'widget-autosaved', data: { id: existingId, widgetData: { ...widgetState, ...updates } } });
          }

          result = {
            success: true,
            updated: updates,
            message: `Updated widget config: ${Object.keys(updates).join(', ')}`,
            frontendEvents,
          };
        } catch (configError) {
          console.error('Error in update_widget_config:', configError);
          result = { success: false, error: configError.message, message: 'Failed to update widget configuration.' };
        }
        break;
      }

      case 'save_widget':
        if (args.widgetData && db) {
          const validCategories = ['custom', 'dashboard', 'home', 'assets', 'system'];
          const widgetId = args.widgetData.id || `widget-def-${Date.now()}`;
          const sanitizedCategory = validCategories.includes(args.widgetData.category) ? args.widgetData.category : 'custom';
          const widgetData = { ...args.widgetData, id: widgetId, category: sanitizedCategory, updatedAt: new Date().toISOString() };

          result = await new Promise((resolve) => {
            const query = `INSERT OR REPLACE INTO widget_definitions (id, name, description, icon, category, widget_type, source_code, config, default_size, min_size, created_by, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
            db.run(
              query,
              [
                widgetId,
                widgetData.name || 'Untitled Widget',
                widgetData.description || '',
                widgetData.icon || 'fas fa-puzzle-piece',
                widgetData.category || 'custom',
                widgetData.widget_type || 'html',
                widgetData.source_code || null,
                widgetData.config ? JSON.stringify(widgetData.config) : null,
                widgetData.default_size ? JSON.stringify(widgetData.default_size) : '{"cols":4,"rows":3}',
                widgetData.min_size ? JSON.stringify(widgetData.min_size) : '{"cols":2,"rows":2}',
                userId,
              ],
              function (err) {
                if (err) resolve({ success: false, message: err.message });
                else {
                  resolve({
                    success: true,
                    widgetId,
                    widgetData,
                    message: 'Widget saved successfully to database',
                    frontendEvents: [{ type: 'widget-saved', data: { widgetId, widgetData } }],
                  });
                }
              }
            );
          });
        } else {
          result = { success: false, message: 'Widget data is required for saving' };
        }
        break;

      case 'load_widget':
        if (args.widgetId && db) {
          result = await new Promise((resolve) => {
            db.get('SELECT * FROM widget_definitions WHERE id = ?', [args.widgetId], (err, row) => {
              if (err || !row) resolve({ success: false, message: err ? err.message : 'Widget not found' });
              else resolve({ success: true, widgetData: row, message: 'Widget loaded successfully' });
            });
          });
        } else {
          result = { success: false, message: 'Widget ID required' };
        }
        break;

      default:
        result = { success: false, message: `Unknown function: ${functionName}` };
    }

    return JSON.stringify(result);
  } catch (error) {
    console.error(`Error executing widget function ${functionName}:`, error);
    return JSON.stringify({ success: false, error: error.message });
  }
}

function fuzzyFind(source, search) {
  const exactIdx = source.indexOf(search);
  if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + search.length };

  const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();
  const normSearch = normalizeWS(search);
  if (!normSearch) return null;

  for (let srcPos = 0; srcPos < source.length; srcPos++) {
    let normWindow = '';
    let windowEnd = srcPos;
    while (windowEnd < source.length) {
      const ch = source[windowEnd];
      if (/\s/.test(ch)) {
        if (!normWindow.endsWith(' ') && normWindow.length > 0) normWindow += ' ';
      } else {
        normWindow += ch;
      }
      windowEnd++;

      const trimmedWindow = normWindow.trim();
      if (trimmedWindow === normSearch) return { start: srcPos, end: windowEnd };
      if (trimmedWindow.length > normSearch.length + 10) break;
    }
  }
  return null;
}

function extractText(responseMessage) {
  if (Array.isArray(responseMessage.content)) {
    const textBlock = responseMessage.content.find((c) => c.type === 'text');
    return textBlock ? textBlock.text : '';
  }
  return responseMessage.content || '';
}

function buildWidgetGenerationPrompt(enhancedInstruction, useTheme) {
  const themeSection = useTheme ? `
THEME STYLING:
The widget iframe is pre-loaded with CSS custom properties that match the user's active theme.
Use var(--color-text), var(--color-text-muted), var(--color-primary), var(--color-secondary), var(--color-background), var(--color-darker-1), var(--terminal-border-color), spacing, font, radius, shadow, and transition variables.
Do NOT define :root variables yourself and do NOT hardcode colors unless the user explicitly asks for standalone styling.` : '';

  return `Generate a complete, self-contained HTML document for a dashboard widget.

RULES:
- Return ONLY the raw HTML document - no markdown fences, no JSON wrapper, no explanation
- Start with <!DOCTYPE html> and end with </html>
- Include ALL CSS inside <style> tags
- Include ALL JavaScript inside <script> tags
- The HTML must render directly in an iframe with srcdoc
- Use inline/hardcoded demo data unless the user requests live AGNT data
- Use var(--font-family-primary) for UI text and var(--font-family-mono) for code/monospace text
${useTheme ? '- Use the theme CSS variables provided below for ALL styling' : '- Dark theme preferred unless the user specifies otherwise'}

DESIGN QUALITY:
- Make the widget polished, distinctive, and production-ready
- Use a base-2 spacing scale: 2, 4, 8, 16, 24, 32, 48, 64px
- Establish clear hierarchy, generous whitespace, consistent alignment, and polished interactive states
${themeSection}

USER REQUEST: ${enhancedInstruction}`;
}

function generateWidgetFrontendEvents(widgetData, operationType) {
  const events = [];
  const fieldsToPush = ['name', 'description', 'widget_type', 'icon', 'category', 'config', 'default_size', 'min_size'];
  for (const field of fieldsToPush) {
    if (widgetData[field] !== undefined) {
      events.push({ type: 'widget-field-updated', data: { field, value: widgetData[field] } });
    }
  }
  if (widgetData.source_code || widgetData.code) {
    events.push({ type: 'widget-field-updated', data: { field: 'source_code', value: widgetData.source_code || widgetData.code } });
  }
  if (operationType === 'create') {
    events.unshift({ type: 'widget-fields-cleared', data: {} });
  }
  return events;
}
