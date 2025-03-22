import crypto from 'crypto';

// In-memory storage for shortened URLs (in a real-world scenario, use a database)
const urlDatabase = new Map();

/**
 * URL Shortener Tool
 * Shortens long URLs and retrieves information about shortened URLs
 */
export async function execute(params, inputData) {
  try {
    if (!params.action || !params.url) {
      return { error: "Both action and url parameters are required" };
    }

    const action = params.action.toLowerCase();
    const url = params.url.trim();

    if (action === 'shorten') {
      return shortenUrl(url);
    } else if (action === 'info') {
      return getUrlInfo(url);
    } else {
      return { error: "Invalid action. Use 'shorten' or 'info'" };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}

function shortenUrl(longUrl) {
  // Generate a short code
  const shortCode = generateShortCode();
  const shortUrl = `https://short.url/${shortCode}`;

  // Store the URL information
  urlDatabase.set(shortCode, {
    originalUrl: longUrl,
    createdAt: new Date().toISOString(),
    clicks: 0
  });

  return {
    success: true,
    shortUrl: shortUrl
  };
}

function getUrlInfo(shortUrl) {
  const shortCode = shortUrl.split('/').pop();
  const urlInfo = urlDatabase.get(shortCode);

  if (!urlInfo) {
    return {
      success: false,
      error: "Shortened URL not found"
    };
  }

  return {
    success: true,
    originalUrl: urlInfo.originalUrl,
    createdAt: urlInfo.createdAt,
    clicks: urlInfo.clicks
  };
}

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}