import BaseAction from '../BaseAction.js';
import scrapeUtil from '../../../utils/webScrape.js';

/**
 * Web Scrape node: the same local scraper as the chat tool (utils/webScrape.js), which runs
 * scrape.agnt.gg's pipeline in the user's own Chrome.
 *
 * The node returns only the formats it is asked for, each as ONE flat output, so no content
 * is ever returned twice. text and code keep the output names saved workflows already use.
 */
const OUTPUT_FOR_FORMAT = Object.freeze({
  markdown: 'markdown',
  text: 'textContent',
  links: 'links',
  code: 'codeContent',
  html: 'html',
  screenshot: 'screenshot',
  bytes: 'bytes',
});

// What this node has always returned, and what saved workflows reference as
// {{Node.textContent}}, .links and .codeContent. It is the DEFAULT, visible and editable,
// rather than a rule for "old" nodes, because there is no such thing as an old node to the
// editor: opening a workflow writes every parameter's default into every node
// (WorkflowDesigner.vue, node initialisation), so a markdown default would silently turn a
// saved node into a markdown-only one the next time its workflow was saved.
const DEFAULT_FORMATS = 'text,links,code';

class WebScrape extends BaseAction {
  static schema = {
    title: 'Web Scrape',
    category: 'action',
    type: 'web-scrape',
    icon: 'web',
    description:
      'Reads a web page or a file at a URL (PDF, Word, Excel, PowerPoint, CSV, JSON, RSS, Markdown, source code, images...) in your own Chrome and converts it exactly as scrape.agnt.gg does. Only the formats you choose are returned.',
    parameters: {
      url: {
        type: 'string',
        inputType: 'text',
        description: 'The URL of the page or file to scrape.',
      },
      formats: {
        type: 'string',
        inputType: 'text',
        default: DEFAULT_FORMATS,
        // Explicit: a falsy default ('' or 0) otherwise reads as REQUIRED to SchemaValidator and
        // orchestrator/toolRegistry, which makes the node uncallable for an agent.
        required: false,
        description:
          'Comma-separated outputs to return: markdown, text, links, code, html, screenshot, bytes. Only these outputs are filled; ask for just what the workflow uses (e.g. "markdown").',
      },
      mainContentOnly: {
        type: 'boolean',
        inputType: 'checkbox',
        default: true,
        required: false,
        description: 'Drop navigation, headers, footers and sidebars.',
      },
      waitForMs: {
        type: 'number',
        inputType: 'number',
        default: 0,
        required: false,
        description: 'Extra wait after the page loads, for content that renders late (0-10000 ms).',
      },
      pageRange: {
        type: 'string',
        inputType: 'text',
        default: '',
        required: false,
        description: 'PDF pages to convert, e.g. "5" or "2-9". Empty converts every page (up to 500).',
      },
      allowLocal: {
        type: 'boolean',
        inputType: 'checkbox',
        default: false,
        required: false,
        description: 'Allow addresses on this computer or a private network (localhost, 192.168.x...). Off by default.',
      },
    },
    outputs: {
      markdown: { type: 'string', description: 'The content as markdown (format: markdown)' },
      textContent: { type: 'string', description: 'The content as plain text (format: text)' },
      links: { type: 'array', description: 'Every absolute link (format: links)' },
      codeContent: { type: 'string', description: 'Every code block, fenced (format: code)' },
      html: { type: 'string', description: 'The cleaned main-content HTML (format: html)' },
      screenshot: { type: 'string', description: 'A JPEG of the page as a data URI (format: screenshot)' },
      bytes: { type: 'string', description: 'The original response as a data URI, up to 4 MB (format: bytes)' },
      title: { type: 'string', description: 'The page or document title' },
      finalUrl: { type: 'string', description: 'The URL after redirects' },
      statusCode: { type: 'number', description: 'The HTTP status of the page or file' },
      document: { type: 'object', description: 'Files only: type, content type, size and pages, sheets or slides' },
      isPartial: { type: 'boolean', description: 'True when some requested format could not be produced' },
      errorCode: { type: 'string', description: 'Why the scrape failed, as a code (e.g. page_blocked, destination_not_allowed)' },
      error: { type: 'string', description: 'Why the scrape failed, in a sentence' },
    },
  };

  constructor() {
    super('web-scrape');
  }

  async execute(params = {}) {
    const formats = params.formats === undefined || params.formats === null || params.formats === '' ? DEFAULT_FORMATS : params.formats;
    const result = await scrapeUtil.execute({
      url: params.url,
      formats,
      mainContentOnly: params.mainContentOnly,
      waitForMs: params.waitForMs,
      // The editor stores an untouched optional field as ''.
      pageRange: params.pageRange === '' ? undefined : params.pageRange,
      allowLocal: params.allowLocal,
    });
    if (!result.success) {
      return this.formatOutput({ success: false, error: result.message, errorCode: result.error });
    }
    const outputs = {
      success: true,
      title: result.title,
      finalUrl: result.finalUrl,
      statusCode: result.statusCode,
      isPartial: result.isPartial,
      ...(result.document ? { document: result.document } : {}),
      error: null,
    };
    for (const [format, { data }] of Object.entries(result.formats)) outputs[OUTPUT_FOR_FORMAT[format]] = data;
    return this.formatOutput(outputs);
  }
}

export default new WebScrape();
