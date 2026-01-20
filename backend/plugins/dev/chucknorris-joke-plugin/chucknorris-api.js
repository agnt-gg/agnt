import fetch from 'node-fetch';

class ChuckNorrisJokePlugin {
  constructor() {
    this.name = 'chucknorris-get-joke';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[ChuckNorrisJokePlugin] Executing with params:', JSON.stringify(params, null, 2));

    const apiUrl = 'https://api.chucknorris.io/jokes/random';
    const queryParams = [];

    if (params && params.category) {
      queryParams.push(`category=${encodeURIComponent(params.category)}`);
    }

    const requestUrl = queryParams.length ? `${apiUrl}?${queryParams.join('&')}` : apiUrl;

    try {
      const response = await fetch(requestUrl);
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();

      return {
        joke: data.value || null,
        icon_url: data.icon_url || null,
        id: data.id || null,
        url: data.url || null,
        categories: Array.isArray(data.categories) ? data.categories : [],
        created_at: data.created_at || null,
        updated_at: data.updated_at || null,
        error: null,
      };
    } catch (error) {
      console.error('[ChuckNorrisJokePlugin] Error:', error);
      return {
        joke: null,
        icon_url: null,
        id: null,
        url: null,
        categories: [],
        created_at: null,
        updated_at: null,
        error: error.message,
      };
    }
  }
}

export default new ChuckNorrisJokePlugin();