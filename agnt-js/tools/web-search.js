/**
 * Web Search Tool
 * Performs web searches and returns results or opens URLs in the default browser
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import open from 'open';  // Add this to package.json if not already installed

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
        
        try {
          // Open URL in default browser using 'open' package
          await open(validatedUrl);
          return {
            success: true,
            action: 'open',
            url: validatedUrl,
            message: `Opened ${validatedUrl} in default browser`
          };
        } catch (browserError) {
          console.error('Error opening browser:', browserError);
          
          // Fallback to fetch content if browser opening fails
          try {
            const response = await axios.get(validatedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            });
            
            return {
              success: true,
              action: 'fetch',
              url: validatedUrl,
              contentType: response.headers['content-type'],
              statusCode: response.status,
              message: `Retrieved URL ${validatedUrl} (Status: ${response.status})`
            };
          } catch (fetchError) {
            return {
              success: false,
              action: 'fetch',
              url: validatedUrl,
              error: fetchError.message,
              message: `Failed to fetch URL: ${fetchError.message}`
            };
          }
        }
        
      case 'search':
        if (!searchQuery) {
          return { success: false, error: "Search query is required for 'search' action" };
        }
        
        // Option 1: Open search in default browser
        if (params.openResults === 'true') {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
          try {
            await open(searchUrl);
            return {
              success: true,
              action: 'search',
              query: searchQuery,
              url: searchUrl,
              message: `Opened search for "${searchQuery}" in default browser`
            };
          } catch (err) {
            console.error('Error opening browser for search:', err);
            // Continue with mock results if browser fails
          }
        }
        
        // Option 2: Return mock search results
        try {
          // Mock search results for demonstration
          const mockResults = [
            {
              title: "JavaScript Tutorial - W3Schools",
              url: "https://www.w3schools.com/js/",
              snippet: "JavaScript is the world's most popular programming language. JavaScript is the programming language of the Web. JavaScript is easy to learn."
            },
            {
              title: "JavaScript - MDN Web Docs",
              url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
              snippet: "JavaScript (JS) is a lightweight, interpreted, or just-in-time compiled programming language with first-class functions."
            },
            {
              title: "Learn JavaScript - Codecademy",
              url: "https://www.codecademy.com/learn/introduction-to-javascript",
              snippet: "Learn the JavaScript fundamentals you'll need for front-end or back-end development."
            },
            {
              title: "JavaScript.info – The Modern JavaScript Tutorial",
              url: "https://javascript.info/",
              snippet: "Modern JavaScript Tutorial: simple, but detailed explanations with examples and tasks, including closures, document and events, object-oriented programming."
            },
            {
              title: "JavaScript - YouTube",
              url: "https://www.youtube.com/playlist?list=PLW3GfRiBCHOiEkjvQj0uaUB1Q-RckYnj9",
              snippet: "Learn JavaScript programming with this comprehensive free tutorial series. Perfect for beginners and intermediate developers."
            }
          ];
          
          // Customize results based on the search query
          const customizedResults = mockResults.map(result => {
            return {
              ...result,
              title: result.title.replace("JavaScript", searchQuery.includes("JavaScript") ? "JavaScript" : searchQuery),
              snippet: result.snippet.replace(/JavaScript/g, searchQuery.includes("JavaScript") ? "JavaScript" : searchQuery)
            };
          });
          
          // Filter results to match requested count
          const count = parseInt(resultsCount) || 5;
          const results = customizedResults.slice(0, count);
          
          return {
            success: true,
            action: 'search',
            query: searchQuery,
            results: results,
            message: `Found ${results.length} results for "${searchQuery}"`,
            note: "These are example results. For production use, you'll need to integrate with a real search API."
          };
        } catch (searchError) {
          return {
            success: false,
            error: `Search error: ${searchError.message}`,
            message: `Failed to search: ${searchError.message}`
          };
        }
        
      default:
        return { 
          success: false, 
          error: `Unknown action: ${action}. Supported actions are: open, search` 
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
 * Validate and format URL to ensure it's properly formatted
 */
function validateAndFormatUrl(url) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}