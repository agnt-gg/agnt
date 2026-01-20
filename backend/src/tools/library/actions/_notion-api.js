import BaseAction from '../BaseAction.js';
import AuthManager from '../../../services/auth/AuthManager.js';
import axios from 'axios';
import { Client } from '@notionhq/client';

class NotionAPI extends BaseAction {
  static schema = {
    title: 'Notion API',
    category: 'action',
    type: 'notion-api',
    icon: 'notion',
    description: 'Interact with Notion databases, pages, and blocks.',
    parameters: {
      operation: {
        type: 'string',
        inputType: 'select',
        description: 'Operation to perform',
        options: ['search', 'getDatabaseList', 'queryDatabase', 'getPageContent', 'createPage'],
        default: 'search',
      },
      query: {
        type: 'string',
        inputType: 'text',
        description: 'Search query',
        conditional: {
          field: 'operation',
          value: 'search',
        },
      },
      databaseId: {
        type: 'string',
        inputType: 'text',
        description: 'ID of the database to query',
        conditional: {
          field: 'operation',
          value: 'queryDatabase',
        },
      },
      pageId: {
        type: 'string',
        inputType: 'text',
        description: 'ID of the page to retrieve',
        conditional: {
          field: 'operation',
          value: 'getPageContent',
        },
      },
      parentId: {
        type: 'string',
        inputType: 'text',
        description: 'ID of the parent database or page',
        conditional: {
          field: 'operation',
          value: 'createPage',
        },
      },
      parentType: {
        type: 'string',
        inputType: 'select',
        options: ['database', 'page'],
        default: 'database',
        description: 'Type of parent (database or page)',
        conditional: {
          field: 'operation',
          value: 'createPage',
        },
      },
      properties: {
        type: 'string',
        inputType: 'codearea',
        description:
          'Properties for the new page (JSON format). Example:\n{\n  "Name": { "title": [{ "text": { "content": "Page Title" } }] },\n  "Tags": { "multi_select": [{ "name": "Tag1" }, { "name": "Tag2" }] },\n  "Date": { "date": { "start": "2023-04-22" } }\n}',
        conditional: {
          field: 'operation',
          value: 'createPage',
        },
      },
      content: {
        type: 'string',
        inputType: 'codearea',
        description:
          'Content blocks for the new page (JSON format). Example:\n[\n  {\n    "object": "block",\n    "type": "paragraph",\n    "paragraph": {\n      "rich_text": [{ "type": "text", "text": { "content": "Hello, world!" } }]\n    }\n  },\n  {\n    "object": "block",\n    "type": "heading_1",\n    "heading_1": {\n      "rich_text": [{ "type": "text", "text": { "content": "Heading 1" } }]\n    }\n  }\n]',
        conditional: {
          field: 'operation',
          value: 'createPage',
        },
      },
      filter: {
        type: 'string',
        inputType: 'codearea',
        description: 'Filter criteria (JSON format). Example:\n{\n  "property": "Status",\n  "select": {\n    "equals": "Done"\n  }\n}',
        conditional: {
          field: 'operation',
          value: ['search', 'queryDatabase'],
        },
      },
      sorts: {
        type: 'string',
        inputType: 'codearea',
        description: 'Sort criteria (JSON format). Example:\n[\n  {\n    "property": "Date",\n    "direction": "descending"\n  }\n]',
        conditional: {
          field: 'operation',
          value: 'queryDatabase',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the operation was successful',
      },
      result: {
        type: 'object',
        description: 'The result of the operation',
      },
      error: {
        type: 'string',
        description: 'Error message if operation failed',
      },
    },
  };

  constructor() {
    super('notion-api');
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'notion');

      if (!accessToken) {
        throw new Error('No valid access token found. Please connect to Notion in Settings.');
      }

      // Initialize the Notion client with the access token
      const notion = new Client({
        auth: accessToken,
      });

      // Determine which operation to perform
      const operation = params.operation || 'search';
      let result = null;

      switch (operation) {
        case 'search':
          result = await notion.search({
            query: params.query || '',
            filter: params.filter || {},
            sort: params.sort || {},
          });
          break;

        case 'getDatabaseList':
          result = await notion.search({
            filter: { property: 'object', value: 'database' },
          });
          break;

        case 'queryDatabase':
          if (!params.databaseId) {
            throw new Error('Database ID is required');
          }
          let queryParams = {
            database_id: params.databaseId,
          };

          if (params.filter && Object.keys(params.filter).length > 0) {
            queryParams.filter = params.filter;
          }

          if (params.sorts && params.sorts.length > 0) {
            queryParams.sorts = params.sorts;
          }

          result = await notion.databases.query(queryParams);
          break;

        case 'getPageContent':
          if (!params.pageId) {
            throw new Error('Page ID is required');
          }
          result = await notion.pages.retrieve({
            page_id: params.pageId,
          });
          break;

        case 'createPage':
          if (!params.parentId) {
            throw new Error('Parent ID is required');
          }

          const parent = params.parentType === 'database' ? { database_id: params.parentId } : { page_id: params.parentId };

          // Parse properties from string to object if needed
          let properties = {};
          try {
            properties = typeof params.properties === 'string' ? JSON.parse(params.properties) : params.properties || {};

            // Database property validation check - optional but helpful
            if (params.parentType === 'database') {
              try {
                // First get the database schema to see available properties
                const dbSchema = await notion.databases.retrieve({
                  database_id: params.parentId,
                });

                // Extract property names from database schema
                const availableProps = Object.keys(dbSchema.properties);

                // Filter properties to only include those that exist in the database
                const filteredProps = {};
                Object.keys(properties).forEach((key) => {
                  if (availableProps.includes(key)) {
                    filteredProps[key] = properties[key];
                  }
                });

                properties = filteredProps;
              } catch (dbError) {
                console.warn('Unable to validate database properties:', dbError.message);
                // Continue with user-provided properties if db validation fails
              }
            }
          } catch (parseError) {
            console.error('Error parsing properties:', parseError);
            throw new Error('Invalid properties JSON format');
          }

          // Parse content blocks from string to object if needed
          let children = undefined;
          if (params.content) {
            if (typeof params.content === 'string') {
              try {
                // Parse the content JSON
                const contentObj = JSON.parse(params.content);
                // Get the children array
                const childrenArray = contentObj.children || contentObj;

                // Process all blocks to ensure text content is properly formatted
                children = this._processContentBlocks(childrenArray);
              } catch (e) {
                console.error('Error parsing content JSON:', e);
                throw new Error('Invalid content JSON format');
              }
            } else {
              // If it's already an object, process it
              children = this._processContentBlocks(params.content.children || params.content);
            }
          }

          // Create page with properly processed objects
          try {
            result = await notion.pages.create({
              parent,
              properties,
              children,
            });
          } catch (error) {
            // Enhanced error handling
            if (error.code === 'validation_error' && error.message.includes('is not a property that exists')) {
              throw new Error(`Database schema validation error: ${error.message}. Please check that your properties match the database schema.`);
            }
            throw error;
          }
          break;

        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      return this.formatOutput({
        success: true,
        result: result,
      });
    } catch (error) {
      console.error('Error executing Notion API:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }

  // Helper method to process content blocks and ensure correct format
  _processContentBlocks(blocks) {
    if (!Array.isArray(blocks)) {
      return blocks;
    }

    return blocks.map((block) => {
      // Create a deep copy to avoid modifying the original
      const processedBlock = JSON.parse(JSON.stringify(block));

      // Process different block types
      Object.keys(processedBlock).forEach((key) => {
        // Skip object and type properties
        if (key === 'object' || key === 'type') return;

        const blockContent = processedBlock[key];

        // Process rich_text arrays in any block type
        if (blockContent && blockContent.rich_text && Array.isArray(blockContent.rich_text)) {
          blockContent.rich_text.forEach((textItem) => {
            if (textItem.text && typeof textItem.text.content === 'object') {
              // Convert object to string for text content
              textItem.text.content = JSON.stringify(textItem.text.content);
            }
          });
        }

        // Recursively process any other nested objects
        if (blockContent && typeof blockContent === 'object') {
          // Recursively handle nested objects
          this._processNestedContent(blockContent);
        }
      });

      return processedBlock;
    });
  }

  // Add a new helper method to recursively process nested content
  _processNestedContent(obj) {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach((key) => {
      // Process rich_text specially
      if (key === 'rich_text' && Array.isArray(obj[key])) {
        obj[key].forEach((textItem) => {
          if (textItem.text && typeof textItem.text.content === 'object') {
            textItem.text.content = JSON.stringify(textItem.text.content);
          }
        });
      }
      // Recursively process nested objects
      else if (obj[key] && typeof obj[key] === 'object') {
        this._processNestedContent(obj[key]);
      }
    });
  }

  formatOutput(output) {
    return {
      success: output.success,
      result: output.result,
      error: output.error,
      outputs: {
        success: output.success,
        result: output.result,
        error: output.error,
      },
    };
  }
}

export default new NotionAPI();
