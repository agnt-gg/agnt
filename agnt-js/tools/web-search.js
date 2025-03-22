/**
 * Web Search Tool
 * Performs web searches and returns results without opening a browser
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import * as cheerio from 'cheerio';

const execPromise = promisify(exec);

export async function execute(params) {
  try {
    const { action = 'search', url, searchQuery, resultsCount = 5 } = params;
    
    // Handle different actions
    switch(action) {
      case 'open':
        if (!url) {
          return { success: false, error: "URL is required for 'open' action" };
        }
        
        // Validate URL format
        const validatedUrl = validateAndFormatUrl(url);
        const braveCommand = getBraveCommand();
        
        if (braveCommand) {
          await execPromise(`${braveCommand} ${validatedUrl}`);
          return {
            success: true,
            action: 'open',
            url: validatedUrl,
            message: `Opened ${validatedUrl} in Brave browser`
          };
        } else {
          // If we can't open the browser, fetch the content instead
          const pageContent = await fetchWebContent(validatedUrl);
          return {
            success: true,
            action: 'fetch',
            url: validatedUrl,
            title: pageContent.title,
            content: pageContent.summary,
            message: `Retrieved content from ${validatedUrl}`
          };
        }
        
      case 'search':
        if (!searchQuery) {
          return { success: false, error: "Search query is required for 'search' action" };
        }
        
        // Perform search and get results
        const searchResults = await performWebSearch(searchQuery, resultsCount);
        
        return {
          success: true,
          action: 'search',
          query: searchQuery,
          results: searchResults,
          message: `Found ${searchResults.length} results for "${searchQuery}"`
        };
      
      case 'fetch':
        if (!url) {
          return { success: false, error: "URL is required for 'fetch' action" };
        }
        
        // Validate URL format
        const validatedFetchUrl = validateAndFormatUrl(url);
        
        // Fetch the content
        const pageContent = await fetchWebContent(validatedFetchUrl);
        
        return {
          success: true,
          action: 'fetch',
          url: validatedFetchUrl,
          title: pageContent.title,
          content: pageContent.summary,
          message: `Retrieved content from ${validatedFetchUrl}`
        };
        
      default:
        return { 
          success: false, 
          error: `Unknown action: ${action}. Supported actions are: open, search, fetch` 
        };
    }
  } catch (error) {
    console.error('Error executing web search tool:', error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}

/**
 * Get the appropriate Brave browser command based on the operating system
 */
function getBraveCommand() {
  switch(process.platform) {
    case 'win32':
      return '"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"';
    case 'darwin': // macOS
      return 'open -a "Brave Browser"';
    case 'linux':
      return 'brave-browser';
    default:
      return null;
  }
}

/**
 * Validate and format URL to ensure it's properly formatted
 */
function validateAndFormatUrl(url) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Perform a web search and return results
 */
async function performWebSearch(query, count = 5) {
  try {
    // Use DuckDuckGo for searching since it doesn't block simple bots
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // Extract search results
    $('.result').slice(0, count).each((i, element) => {
      const title = $(element).find('.result__title').text().trim();
      const url = $(element).find('.result__url').text().trim();
      const snippet = $(element).find('.result__snippet').text().trim();
      
      results.push({
        title,
        url,
        snippet
      });
    });
    
    return results;
  } catch (error) {
    console.error('Search error:', error);
    throw new Error(`Failed to perform web search: ${error.message}`);
  }
}

/**
 * Fetch and summarize content from a web page
 */
async function fetchWebContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Get page title
    const title = $('title').text().trim();
    
    // Get page content (simplified)
    let content = '';
    $('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) { // Only include substantial paragraphs
        content += text + '\n\n';
      }
    });
    
    // Truncate content to a reasonable size
    const summary = content.substring(0, 10000) + (content.length > 10000 ? '...' : '');
    
    return {
      title,
      summary,
      url
    };
  } catch (error) {
    console.error('Web fetch error:', error);
    throw new Error(`Failed to fetch web content: ${error.message}`);
  }
}