const FACEBOOK_API_URL = 'https://graph.facebook.com/v19.0/me/accounts';

class FacebookListPagesTool {
  constructor() {
    this.name = 'facebook-list-pages';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[facebook-api-plugin] Executing facebook-list-pages');

    let accessToken = null;

    try {
      const AuthManagerModule = await import('../../../src/services/auth/AuthManager.js');
      const AuthManager = AuthManagerModule.default;
      accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'facebook');

      if (!accessToken) {
        throw new Error('Failed to retrieve Facebook access token for this user.');
      }
    } catch (authError) {
      console.error('[facebook-api-plugin] Auth Error:', authError);
      return {
        pages: [],
        success: false,
        error: 'Authentication failed: ' + (authError.message || authError.toString())
      };
    }

    try {
      const url = new URL(FACEBOOK_API_URL);
      url.searchParams.append('access_token', accessToken);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.error && data.error.message ? data.error.message : 'Unknown error from Facebook API.';
        throw new Error(errorMsg);
      }

      // Facebook returns { data: [ {pageObj}, ... ], ... }
      const pages = Array.isArray(data.data) ? data.data : [];

      console.log(`[facebook-api-plugin] Retrieved ${pages.length} managed pages.`);

      return {
        pages,
        success: true,
        error: null
      };
    } catch (fetchError) {
      console.error('[facebook-api-plugin] Fetch Error:', fetchError);
      return {
        pages: [],
        success: false,
        error: fetchError.message || 'Unknown error during Facebook pages retrieval.'
      };
    }
  }
}

export default new FacebookListPagesTool();