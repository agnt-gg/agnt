import BaseAction from '../BaseAction.js';

class HtmlPreview extends BaseAction {
  static schema = {
    title: 'HTML Preview',
    category: 'utility',
    type: 'html-preview',
    icon: 'code',
    description:
      'Renders HTML content in a sandboxed preview window. Supports raw HTML strings, URLs, base64-encoded HTML, and drag & drop .html files. Automatically extracts metadata about scripts, styles, and external resources.',
    parameters: {
      htmlSource: {
        type: 'string',
        inputType: 'textarea',
        description:
          'HTML content to preview. Can be raw HTML string, URL to fetch HTML from, base64-encoded HTML (data:text/html;base64,...), or blob URL. Supports drag & drop of .html files.',
      },
      sandboxMode: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Strict', 'Allow Scripts', 'Full Access'],
        default: 'Strict',
        description:
          'Security sandbox level: Strict (blocks all scripts), Allow Scripts (allows scripts but blocks inline event handlers), Full Access (no restrictions)',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the HTML was successfully processed',
      },
      htmlContent: {
        type: 'string',
        description: 'The processed HTML content ready for rendering',
      },
      metadata: {
        type: 'object',
        description: 'Extracted HTML metadata including character count, script/style detection, external resources, and source type',
      },
      error: {
        type: 'string',
        description: 'Error message if HTML processing failed',
      },
    },
  };

  constructor() {
    super('html-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('📄 HtmlPreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.htmlSource) {
        console.error('❌ HtmlPreview: No HTML source provided');
        return {
          success: false,
          error: 'No HTML source provided',
          htmlContent: null,
          metadata: null,
        };
      }

      const htmlSource = params.htmlSource.trim();
      const sandboxMode = params.sandboxMode || 'Strict';

      console.log('🔍 HtmlPreview: Processing HTML source type and length:', {
        type: typeof htmlSource,
        length: htmlSource.length,
        starts: htmlSource.substring(0, 50),
        sandboxMode,
      });

      // Check for IndexedDB references that weren't resolved
      if (htmlSource.startsWith('idb://')) {
        console.error('❌ HtmlPreview: IndexedDB reference found - this should have been resolved by frontend:', htmlSource);
        return {
          success: false,
          error: 'IndexedDB reference found but not resolved. This indicates a frontend resolution failure.',
          htmlContent: null,
          metadata: null,
        };
      }

      // Initialize result object
      const result = {
        success: true,
        htmlContent: null,
        metadata: {
          sandboxMode,
          sourceType: null,
          characterCount: 0,
          hasScripts: false,
          hasStyles: false,
          externalResources: [],
        },
        error: null,
      };

      // Determine source type and process accordingly
      const isUrl = htmlSource.startsWith('http://') || htmlSource.startsWith('https://');
      const isBlobUrl = htmlSource.startsWith('blob:');
      const isBase64 = htmlSource.startsWith('data:text/html;base64,');
      const isRawHtml = !isUrl && !isBlobUrl && !isBase64;

      if (isUrl) {
        // Fetch HTML from URL
        result.metadata.sourceType = 'url';
        try {
          const fetchedHtml = await this.fetchHtmlFromUrl(htmlSource);
          result.htmlContent = fetchedHtml;
        } catch (error) {
          result.error = `Failed to fetch HTML from URL: ${error.message}`;
          result.success = false;
          return result;
        }
      } else if (isBase64) {
        // Decode base64 HTML
        result.metadata.sourceType = 'base64';
        try {
          const base64Data = htmlSource.split(',')[1];
          result.htmlContent = atob(base64Data);
        } catch (error) {
          result.error = `Failed to decode base64 HTML: ${error.message}`;
          result.success = false;
          return result;
        }
      } else if (isBlobUrl) {
        // Blob URLs should be resolved by frontend, but we'll try to fetch
        result.metadata.sourceType = 'blob';
        try {
          const fetchedHtml = await this.fetchHtmlFromUrl(htmlSource);
          result.htmlContent = fetchedHtml;
        } catch (error) {
          result.error = `Failed to fetch HTML from blob URL: ${error.message}`;
          result.success = false;
          return result;
        }
      } else if (isRawHtml) {
        // Raw HTML string
        result.metadata.sourceType = 'raw';
        result.htmlContent = htmlSource;
      }

      // Extract metadata from HTML content
      if (result.htmlContent) {
        result.metadata = {
          ...result.metadata,
          ...this.extractMetadata(result.htmlContent),
        };
      }

      return result;
    } catch (error) {
      console.error('❌ HtmlPreview error:', error);
      return {
        success: false,
        error: error.message,
        htmlContent: null,
        metadata: null,
      };
    }
  }

  async fetchHtmlFromUrl(url) {
    try {
      console.log(`📥 Fetching HTML from: ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        console.warn(`⚠️ Content-Type is ${contentType}, expected text/html`);
      }

      const html = await response.text();
      console.log(`✅ Successfully fetched HTML (${html.length} characters)`);

      return html;
    } catch (error) {
      console.error('❌ Error fetching HTML from URL:', error);
      throw error;
    }
  }

  extractMetadata(html) {
    const metadata = {
      characterCount: html.length,
      hasScripts: false,
      hasStyles: false,
      externalResources: [],
      hasInlineStyles: false,
      hasInlineScripts: false,
    };

    try {
      // Check for script tags
      const scriptMatches = html.match(/<script[^>]*>/gi);
      metadata.hasScripts = scriptMatches && scriptMatches.length > 0;
      metadata.scriptCount = scriptMatches ? scriptMatches.length : 0;

      // Check for inline scripts
      const inlineScriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi);
      metadata.hasInlineScripts = inlineScriptMatches && inlineScriptMatches.length > 0;

      // Check for style tags
      const styleMatches = html.match(/<style[^>]*>/gi);
      metadata.hasStyles = styleMatches && styleMatches.length > 0;
      metadata.styleCount = styleMatches ? styleMatches.length : 0;

      // Check for inline styles
      const inlineStyleMatches = html.match(/style\s*=\s*["'][^"']*["']/gi);
      metadata.hasInlineStyles = inlineStyleMatches && inlineStyleMatches.length > 0;

      // Extract external resources (scripts, stylesheets, images)
      const externalResources = [];

      // External scripts
      const externalScripts = html.match(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi);
      if (externalScripts) {
        externalScripts.forEach((match) => {
          const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
          if (srcMatch) {
            externalResources.push({ type: 'script', url: srcMatch[1] });
          }
        });
      }

      // External stylesheets
      const externalStyles = html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi);
      if (externalStyles) {
        externalStyles.forEach((match) => {
          if (match.includes('stylesheet')) {
            const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
            if (hrefMatch) {
              externalResources.push({ type: 'stylesheet', url: hrefMatch[1] });
            }
          }
        });
      }

      // External images
      const externalImages = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi);
      if (externalImages) {
        externalImages.forEach((match) => {
          const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
          if (srcMatch && (srcMatch[1].startsWith('http://') || srcMatch[1].startsWith('https://'))) {
            externalResources.push({ type: 'image', url: srcMatch[1] });
          }
        });
      }

      metadata.externalResources = externalResources;
      metadata.externalResourceCount = externalResources.length;

      // Check for common HTML elements
      metadata.hasTitle = /<title[^>]*>[\s\S]*?<\/title>/i.test(html);
      metadata.hasBody = /<body[^>]*>/i.test(html);
      metadata.hasHead = /<head[^>]*>/i.test(html);

      console.log('📊 HTML Metadata extracted:', metadata);
    } catch (error) {
      console.warn('⚠️ Error extracting HTML metadata:', error);
    }

    return metadata;
  }

  sanitizeHtml(html, sandboxMode) {
    // Basic sanitization based on sandbox mode
    // For production, consider using a library like DOMPurify

    if (sandboxMode === 'Strict') {
      // Remove all script tags and event handlers
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      html = html.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
      html = html.replace(/javascript:/gi, '');
    } else if (sandboxMode === 'Allow Scripts') {
      // Remove only dangerous event handlers
      html = html.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    }
    // 'Full Access' mode - no sanitization

    return html;
  }
}

export default new HtmlPreview();
