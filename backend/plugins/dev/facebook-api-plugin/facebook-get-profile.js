const DEFAULT_FIELDS = 'id,name,picture';

class FacebookGetProfile {
  constructor() {
    this.name = 'facebook-get-profile';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[facebook-api-plugin] Executing facebook-get-profile with params:', JSON.stringify(params, null, 2));

    try {
      // Auth
      const AuthManagerModule = await import('../../../src/services/auth/AuthManager.js');
      const AuthManager = AuthManagerModule.default;
      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'facebook');
      if (!accessToken) {
        throw new Error('Unable to retrieve Facebook OAuth access token for the current user.');
      }

      // Extract parameters
      const { profileType = 'user', pageId, fields } = params;
      let endpoint = '';
      let queryFields = fields && fields.trim() ? fields.trim() : DEFAULT_FIELDS;

      if (profileType === 'user') {
        endpoint = `https://graph.facebook.com/v18.0/me?fields=${encodeURIComponent(queryFields)}&access_token=${encodeURIComponent(accessToken)}`;
      } else if (profileType === 'page') {
        if (!pageId || typeof pageId !== 'string' || !pageId.trim()) {
          throw new Error('The "pageId" parameter is required when profileType is "page".');
        }
        endpoint = `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}?fields=${encodeURIComponent(queryFields)}&access_token=${encodeURIComponent(accessToken)}`;
      } else {
        throw new Error(`Invalid profileType: "${profileType}". Must be "user" or "page".`);
      }

      // Fetch profile data
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      const responseBody = await response.json();

      if (!response.ok) {
        let fbError = responseBody && responseBody.error && responseBody.error.message ? responseBody.error.message : 'Facebook API error';
        throw new Error(fbError);
      }

      console.log('[facebook-api-plugin] Successfully fetched profile data for profileType:', profileType);

      return {
        profileData: responseBody,
        success: true,
        error: null
      };

    } catch (error) {
      console.error('[facebook-api-plugin] Error in facebook-get-profile:', error);
      return {
        profileData: null,
        success: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  }
}

export default new FacebookGetProfile();