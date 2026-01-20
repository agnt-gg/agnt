import { Client } from '@notionhq/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Notion API Tool
 * Unified tool for interacting with Notion - search, query databases, get pages, and create pages.
 */
class NotionAPI {
  constructor() {
    this.name = 'notion-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[NotionPlugin] Executing Notion API with params:', JSON.stringify(params, null, 2));

    try {
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'notion');
      if (!accessToken) {
        throw new Error('No valid access token found. Please connect to Notion in Settings.');
      }

      const notion = new Client({ auth: accessToken });
      const { operation } = params;

      switch (operation) {
        case 'search':
          return await this.search(notion, params);
        case 'getDatabases':
          return await this.getDatabases(notion, params);
        case 'queryDatabase':
          return await this.queryDatabase(notion, params);
        case 'getPage':
          return await this.getPage(notion, params);
        case 'createPage':
          return await this.createPage(notion, params);
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      console.error('[NotionPlugin] Error executing Notion API:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ==================== SEARCH ====================
  async search(notion, params) {
    const { query = '', filterType = 'all', pageSize = 10 } = params;

    const searchParams = {
      query,
      page_size: pageSize,
    };

    if (filterType !== 'all') {
      searchParams.filter = { property: 'object', value: filterType };
    }

    const response = await notion.search(searchParams);

    const results = response.results.map((item) => ({
      id: item.id,
      type: item.object,
      title: this.extractTitle(item),
      url: item.url,
      lastEdited: item.last_edited_time,
    }));

    return {
      success: true,
      results,
      count: results.length,
      hasMore: response.has_more,
      error: null,
    };
  }

  // ==================== GET DATABASES ====================
  async getDatabases(notion, params) {
    const { pageSize = 100 } = params;

    const response = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: pageSize,
    });

    const databases = response.results.map((db) => ({
      id: db.id,
      title: this.extractTitle(db),
      url: db.url,
      properties: Object.keys(db.properties || {}),
      lastEdited: db.last_edited_time,
    }));

    return {
      success: true,
      databases,
      count: databases.length,
      hasMore: response.has_more,
      error: null,
    };
  }

  // ==================== QUERY DATABASE ====================
  async queryDatabase(notion, params) {
    const {
      databaseId,
      enableFilter,
      enableSort,
      filterProperty,
      filterType,
      filterValue,
      sortProperty,
      sortDirection = 'descending',
      pageSize = 100,
    } = params;

    if (!databaseId) {
      throw new Error('Database ID is required');
    }

    const queryOptions = {
      database_id: databaseId,
      page_size: pageSize,
    };

    // Add filter if enabled
    if (enableFilter === 'Yes' && filterProperty && filterProperty.trim()) {
      queryOptions.filter = this.buildFilter(filterProperty, filterType, filterValue);
    }

    // Add sort if enabled
    if (enableSort === 'Yes' && sortProperty && sortProperty.trim()) {
      queryOptions.sorts = [{ property: sortProperty, direction: sortDirection }];
    }

    const response = await notion.databases.query(queryOptions);

    const results = response.results.map((page) => {
      const processedPage = {
        id: page.id,
        url: page.url,
        createdTime: page.created_time,
        lastEditedTime: page.last_edited_time,
        icon: page.icon?.emoji || page.icon?.external?.url || null,
        properties: {},
      };

      Object.entries(page.properties || {}).forEach(([name, prop]) => {
        processedPage.properties[name] = this.extractPropertyValue(prop);
      });

      return processedPage;
    });

    return {
      success: true,
      results,
      count: results.length,
      hasMore: response.has_more,
      error: null,
    };
  }

  // ==================== GET PAGE ====================
  async getPage(notion, params) {
    const { pageId, includeContent = 'Yes' } = params;

    if (!pageId) {
      throw new Error('Page ID is required');
    }

    const page = await notion.pages.retrieve({ page_id: pageId });

    const pageData = {
      id: page.id,
      url: page.url,
      title: this.extractTitle(page),
      icon: page.icon?.emoji || page.icon?.external?.url || null,
      cover: page.cover?.external?.url || page.cover?.file?.url || null,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      properties: {},
    };

    Object.entries(page.properties || {}).forEach(([name, prop]) => {
      pageData.properties[name] = this.extractPropertyValue(prop);
    });

    let content = [];
    let plainText = '';

    if (includeContent === 'Yes') {
      const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });

      content = blocks.results.map((block) => ({
        id: block.id,
        type: block.type,
        content: this.extractBlockContent(block),
      }));

      plainText = content
        .map((block) => block.content)
        .filter((text) => text)
        .join('\n');
    }

    return {
      success: true,
      page: pageData,
      content,
      plainText,
      error: null,
    };
  }

  // ==================== CREATE PAGE ====================
  async createPage(notion, params) {
    const { parentType = 'database', parentId, title, icon, content } = params;

    if (!parentId) {
      throw new Error('Parent ID is required');
    }

    const parent = parentType === 'database' ? { database_id: parentId } : { page_id: parentId };

    // Build properties
    let properties = {};
    if (parentType === 'database') {
      try {
        const dbSchema = await notion.databases.retrieve({ database_id: parentId });
        const titleProp = Object.entries(dbSchema.properties).find(([_, prop]) => prop.type === 'title');
        if (titleProp) {
          properties[titleProp[0]] = { title: [{ text: { content: title || 'Untitled' } }] };
        }
      } catch (e) {
        properties['Name'] = { title: [{ text: { content: title || 'Untitled' } }] };
      }
    } else {
      properties = { title: { title: [{ text: { content: title || 'Untitled' } }] } };
    }

    // Build children blocks from content
    const children = content ? this.parseContentToBlocks(content) : [];

    // Build page object
    const pageData = { parent, properties };

    if (icon) {
      pageData.icon = { type: 'emoji', emoji: icon };
    }

    if (children.length > 0) {
      pageData.children = children;
    }

    const result = await notion.pages.create(pageData);

    return {
      success: true,
      pageId: result.id,
      pageUrl: result.url,
      error: null,
    };
  }

  // ==================== HELPER METHODS ====================

  extractTitle(item) {
    if (item.title) {
      if (Array.isArray(item.title)) {
        return item.title.map((t) => t.plain_text).join('');
      }
    }
    if (item.properties) {
      const titleProp = Object.values(item.properties).find((p) => p.type === 'title');
      if (titleProp?.title) {
        return titleProp.title.map((t) => t.plain_text).join('');
      }
    }
    return 'Untitled';
  }

  buildFilter(property, filterType, value) {
    const filterMap = {
      equals: { rich_text: { equals: value } },
      does_not_equal: { rich_text: { does_not_equal: value } },
      contains: { rich_text: { contains: value } },
      does_not_contain: { rich_text: { does_not_contain: value } },
      starts_with: { rich_text: { starts_with: value } },
      ends_with: { rich_text: { ends_with: value } },
      is_empty: { rich_text: { is_empty: true } },
      is_not_empty: { rich_text: { is_not_empty: true } },
    };

    return { property, ...(filterMap[filterType] || filterMap.contains) };
  }

  extractPropertyValue(prop) {
    switch (prop.type) {
      case 'title':
        return prop.title?.map((t) => t.plain_text).join('') || '';
      case 'rich_text':
        return prop.rich_text?.map((t) => t.plain_text).join('') || '';
      case 'number':
        return prop.number;
      case 'select':
        return prop.select?.name || null;
      case 'multi_select':
        return prop.multi_select?.map((s) => s.name) || [];
      case 'date':
        return prop.date ? { start: prop.date.start, end: prop.date.end } : null;
      case 'checkbox':
        return prop.checkbox;
      case 'url':
        return prop.url;
      case 'email':
        return prop.email;
      case 'phone_number':
        return prop.phone_number;
      case 'status':
        return prop.status?.name || null;
      case 'created_time':
        return prop.created_time;
      case 'last_edited_time':
        return prop.last_edited_time;
      default:
        return prop[prop.type] || null;
    }
  }

  extractBlockContent(block) {
    const type = block.type;
    const content = block[type];

    if (content?.rich_text) {
      return content.rich_text.map((t) => t.plain_text).join('');
    }
    if (content?.text) {
      return content.text.map((t) => t.plain_text).join('');
    }
    return null;
  }

  parseContentToBlocks(content) {
    if (!content) return [];

    const lines = content.split('\n');
    const blocks = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      // Heading 1: # text
      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      }
      // Heading 2: ## text
      else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
        });
      }
      // Heading 3: ### text
      else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] },
        });
      }
      // Bullet list: - text
      else if (line.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      }
      // Numbered list: 1. text
      else if (/^\d+\.\s/.test(line)) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }] },
        });
      }
      // Todo unchecked: [ ] text
      else if (line.startsWith('[ ] ')) {
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }], checked: false },
        });
      }
      // Todo checked: [x] text
      else if (line.startsWith('[x] ') || line.startsWith('[X] ')) {
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }], checked: true },
        });
      }
      // Quote: > text
      else if (line.startsWith('> ')) {
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      }
      // Divider: ---
      else if (line.trim() === '---') {
        blocks.push({ object: 'block', type: 'divider', divider: {} });
      }
      // Callout: emoji text (starts with emoji)
      else if (/^[\u{1F300}-\u{1F9FF}]/u.test(line)) {
        const emoji = line.match(/^[\u{1F300}-\u{1F9FF}]/u)?.[0] || '💡';
        const text = line.slice(emoji.length).trim();
        blocks.push({
          object: 'block',
          type: 'callout',
          callout: { rich_text: [{ type: 'text', text: { content: text } }], icon: { type: 'emoji', emoji } },
        });
      }
      // Default: paragraph
      else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
        });
      }
    }

    return blocks;
  }
}

export default new NotionAPI();
