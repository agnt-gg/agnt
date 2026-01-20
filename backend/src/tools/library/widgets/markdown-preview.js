import BaseAction from '../BaseAction.js';

class MarkdownPreview extends BaseAction {
  static schema = {
    title: 'Markdown Preview',
    category: 'utility',
    type: 'markdown-preview',
    icon: 'text',
    description: 'Renders markdown content with preview/source toggle. Supports headers, bold, italic, links, code blocks, inline code, and lists.',
    parameters: {
      markdownSource: {
        type: 'string',
        inputType: 'textarea',
        description: 'Markdown content to render. Supports drag & drop of .md files.',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the markdown was successfully processed',
      },
      markdownContent: {
        type: 'string',
        description: 'The original markdown content',
      },
      htmlContent: {
        type: 'string',
        description: 'The rendered HTML from markdown',
      },
      metadata: {
        type: 'object',
        description: 'Markdown metadata including line count, word count, and detected features (headers, links, images, code blocks, tables, lists)',
      },
      error: {
        type: 'string',
        description: 'Error message if markdown processing failed',
      },
    },
  };

  constructor() {
    super('markdown-preview');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('📝 MarkdownPreview execute called with params:', JSON.stringify(params).substring(0, 200) + '...');
    try {
      // Validate input
      if (!params.markdownSource) {
        console.error('❌ MarkdownPreview: No markdown source provided');
        return {
          success: false,
          error: 'No markdown source provided',
          markdownContent: null,
          htmlContent: null,
          metadata: null,
        };
      }

      const markdownSource = params.markdownSource.trim();

      console.log('🔍 MarkdownPreview: Processing markdown source:', {
        type: typeof markdownSource,
        length: markdownSource.length,
      });

      // Initialize result object
      const result = {
        success: true,
        markdownContent: markdownSource,
        htmlContent: null,
        metadata: {
          lineCount: 0,
          characterCount: 0,
          wordCount: 0,
          hasHeaders: false,
          hasLinks: false,
          hasImages: false,
          hasCodeBlocks: false,
          hasTables: false,
          hasLists: false,
        },
        error: null,
      };

      // Convert markdown to HTML (basic implementation)
      result.htmlContent = this.markdownToHtml(markdownSource);

      // Extract metadata
      result.metadata = this.extractMarkdownMetadata(markdownSource);

      return result;
    } catch (error) {
      console.error('❌ MarkdownPreview error:', error);
      return {
        success: false,
        error: error.message,
        markdownContent: null,
        htmlContent: null,
        metadata: null,
      };
    }
  }

  markdownToHtml(markdown) {
    let html = markdown;

    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/gim, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    html = html.replace(/_(.*?)_/gim, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1" />');

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');

    // Lists
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = '<p>' + html + '</p>';

    return html;
  }

  extractMarkdownMetadata(markdown) {
    const metadata = {
      lineCount: 0,
      characterCount: markdown.length,
      wordCount: 0,
      hasHeaders: false,
      hasLinks: false,
      hasImages: false,
      hasCodeBlocks: false,
      hasTables: false,
      hasLists: false,
      headerCount: 0,
      linkCount: 0,
      imageCount: 0,
      codeBlockCount: 0,
    };

    try {
      // Count lines
      const lines = markdown.split('\n');
      metadata.lineCount = lines.length;

      // Count words
      const words = markdown.split(/\s+/).filter((word) => word.length > 0);
      metadata.wordCount = words.length;

      // Detect headers
      const headerMatches = markdown.match(/^#{1,6}\s+.+$/gm);
      metadata.hasHeaders = headerMatches && headerMatches.length > 0;
      metadata.headerCount = headerMatches ? headerMatches.length : 0;

      // Detect links
      const linkMatches = markdown.match(/\[([^\]]+)\]\(([^)]+)\)/g);
      metadata.hasLinks = linkMatches && linkMatches.length > 0;
      metadata.linkCount = linkMatches ? linkMatches.length : 0;

      // Detect images
      const imageMatches = markdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g);
      metadata.hasImages = imageMatches && imageMatches.length > 0;
      metadata.imageCount = imageMatches ? imageMatches.length : 0;

      // Detect code blocks
      const codeBlockMatches = markdown.match(/```[\s\S]*?```/g);
      metadata.hasCodeBlocks = codeBlockMatches && codeBlockMatches.length > 0;
      metadata.codeBlockCount = codeBlockMatches ? codeBlockMatches.length : 0;

      // Detect tables
      metadata.hasTables = /\|.*\|/.test(markdown);

      // Detect lists
      metadata.hasLists = /^[\*\-]\s+/m.test(markdown);

      console.log('📊 Markdown Metadata extracted:', metadata);
    } catch (error) {
      console.warn('⚠️ Error extracting markdown metadata:', error);
    }

    return metadata;
  }
}

export default new MarkdownPreview();
