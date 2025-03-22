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
    // Try multiple search engines/approaches
    try {
      // First attempt with DuckDuckGo HTML
      const results = await searchWithDuckDuckGo(query, count);
      if (results.length > 0) {
        return results;
      }
      console.log('DuckDuckGo returned no results, trying alternative method...');
    } catch (duckError) {
      console.error('DuckDuckGo search failed:', duckError);
    }
    
    // Fallback to Bing
    return await searchWithBing(query, count);
  } catch (error) {
    console.error('All search methods failed:', error);
    throw new Error(`Failed to perform web search: ${error.message}`);
  }
}

/**
 * Search using DuckDuckGo
 */
async function searchWithDuckDuckGo(query, count = 5) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  const response = await axios.get(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });
  
  const $ = cheerio.load(response.data);
  const results = [];
  
  // Try multiple CSS selectors to adapt to potential changes in DuckDuckGo's HTML
  const selectors = [
    '.result', // Original selector
    '.web-result', // Alternative selector
    '.nrn-react-div' // Another possible selector
  ];
  
  for (const selector of selectors) {
    $(selector).slice(0, count).each((i, element) => {
      // Try various ways to extract data
      const title = $(element).find('.result__title, .title, h2, a').first().text().trim();
      const url = $(element).find('.result__url, .url, a').attr('href') || '';
      const snippet = $(element).find('.result__snippet, .snippet, .description, p').first().text().trim();
      
      if (title && (url || snippet)) {
        results.push({ title, url, snippet });
      }
    });
    
    if (results.length > 0) {
      break; // Found results with this selector, no need to try others
    }
  }
  
  return results;
}

/**
 * Search using Bing as a fallback
 */
async function searchWithBing(query, count = 5) {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  
  const response = await axios.get(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });
  
  const $ = cheerio.load(response.data);
  const results = [];
  
  // Bing search results
  $('.b_algo').slice(0, count).each((i, element) => {
    const titleElement = $(element).find('h2 a');
    const title = titleElement.text().trim();
    const url = titleElement.attr('href') || '';
    const snippet = $(element).find('.b_caption p').text().trim();
    
    if (title && url) {
      results.push({ title, url, snippet });
    }
  });
  
  return results;
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