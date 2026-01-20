import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { URL } from 'url';
import { getBestChromePath, getChromeNotFoundMessage } from './chrome-detector.js';

// Apply the stealth plugin to hide that we're using a headless browser
puppeteer.use(StealthPlugin());

/**
 * Scrapes a URL, aggressively cleans the DOM, extracts main content, all code snippets, and finds all links on the page.
 * @param {string} url The URL to scrape.
 * @returns {Promise<{textContent: string, links: string[], codeContent: string}>} A promise that resolves to the text content, links, and all found code snippets.
 */
async function scrape(url) {
  // Get the best available Chrome executable path
  const chromePath = getBestChromePath();
  if (!chromePath) {
    const errorMsg = getChromeNotFoundMessage();
    console.error(`[Web Scrape] Browser not found: ${errorMsg}`);
    throw new Error(`Browser not found: ${errorMsg}`);
  }

  let browser;
  try {
    // 1. Launch a headless browser instance using puppeteer-extra.
    console.log(`[Web Scrape] Launching browser from: ${chromePath}`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    // Set a standard viewport to appear more like a real user.
    await page.setViewport({ width: 1280, height: 800 });

    // 2. Set a common user agent to prevent being blocked.
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

    // 3. Navigate to the URL. 'networkidle2' is a robust waiting strategy.
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 4. Get the fully rendered HTML from the page.
    const html = await page.content();

    // 5. Parse the rendered HTML using JSDOM
    const doc = new JSDOM(html, {
      url: url, // Provide the URL for resolving relative paths
    });

    const document = doc.window.document;

    // 6. Extract code snippets FIRST, to ensure they are preserved perfectly.
    const codeBlocks = Array.from(document.querySelectorAll('pre'));
    const codeContent = codeBlocks
      .map((pre) => {
        const codeElement = pre.querySelector('code');
        const lang = codeElement ? (codeElement.className.match(/language-(\w+)/) || [])[1] || '' : '';
        const code = pre.textContent || '';
        return `\`\`\`${lang}\n${code.trim()}\n\`\`\``;
      })
      .join('\n\n');

    // 7. Aggressively remove all known UI, nav, and junk elements before text extraction.
    const selectorsToRemove = [
      'header',
      'footer',
      'nav',
      'aside',
      'script',
      'style',
      'noscript',
      'link',
      'pre',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]',
      '[role="search"]',
      '.devsite-header',
      '.devsite-book-nav',
      '.devsite-footer',
      '.devsite-page-nav', // Google specific junk
      '#sidenav',
      '#sidebar',
      '.sidebar', // Common sidebars
      '.breadcrumb',
      '.toc',
      '.table-of-contents', // Tables of Contents
      '.cookie-banner',
      '#cookie-consent', // Banners
      '.ad',
      '.advertisement', // Ads
      '[aria-hidden="true"]',
      '.noprint',
    ];
    document.querySelectorAll(selectorsToRemove.join(', ')).forEach((el) => el.remove());

    // 8. Find the best content container. Fallback to the (now-cleaned) body.
    const mainContentElement = document.querySelector('article, [role="main"], #main-content, #main, .main, #content, .content') || document.body;

    // 9. Extract text content from the now-cleaned and targeted container.
    let textContent = mainContentElement.textContent || '';

    // 10. Perform a ruthless cleanup of the extracted text to remove garbage whitespace.
    textContent = textContent
      .replace(/\s\s+/g, ' ') // Collapse multiple spaces into one
      .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines into one
      .trim();

    if (!textContent) {
      textContent = 'ERROR: Could not extract main content from the page.';
    }

    // 11. Extract all links from the original document to ensure we can crawl everywhere.
    const links = Array.from(doc.window.document.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((href) => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:'))
      .map((href) => new URL(href, url).href) // Resolve relative URLs
      .filter((value, index, self) => self.indexOf(value) === index); // Get unique links

    // 12. Return the cleaned text content, links, and pristine code
    return { textContent, links, codeContent };
  } catch (error) {
    console.error(`[Web Scrape] Error scraping ${url}:`, error);
    throw error;
  } finally {
    // 13. Ensure the browser is closed, even if errors occurred.
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Main function to run the scraper from the command line.
 */
async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('Please provide a URL as a command-line argument.');
    console.error('Usage: node scrape.js <URL>');
    process.exit(1);
  }

  try {
    console.log(`Scraping content from: ${url}\n`);
    const { textContent, links, codeContent } = await scrape(url);
    console.log('--- Extracted Content ---');
    console.log(textContent);
    console.log('--- End of Content ---');
    console.log('--- Extracted Links ---');
    console.log(links);
    console.log('--- End of Links ---');
    console.log('--- Extracted Code ---');
    console.log(codeContent);
    console.log('--- End of Code ---');
  } catch (error) {
    // Error is already logged in the scrape function
  }
}

// Check if the script is being run directly from the command line.
// This is the ES Module equivalent of 'require.main === module'.
const isRunAsScript = fileURLToPath(import.meta.url) === process.argv[1];

if (isRunAsScript) {
  main();
}

export default {
  description:
    'Scrapes a URL to extract main text content, all links, AND all code snippets on the page. Use the returned `links` array for recursive research and `codeContent` to build documentation.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to scrape.',
      },
    },
    required: ['url'],
  },
  execute: async ({ url }) => scrape(url),
};
