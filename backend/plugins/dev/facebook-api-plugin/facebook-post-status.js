import fetch from 'node-fetch';

class FacebookPostStatusTool {
  constructor() {
    this.name = 'facebook-post-status';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[facebook-api-plugin] Executing FacebookPostStatusTool with params:', JSON.stringify(params, null, 2));

    try {
      const AuthManagerModule = await import('../../../src/services/auth/AuthManager.js');
      const AuthManager = AuthManagerModule.default;
      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'facebook');

      if (!accessToken) {
        throw new Error('No valid Facebook OAuth token found for user.');
      }

      const { recipientType, pageId, message, link } = params;

      if (!recipientType || (recipientType !== 'user' && recipientType !== 'page')) {
        throw new Error('Invalid or missing recipientType (must be "user" or "page").');
      }
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Message parameter is required and must be a non-empty string.');
      }

      let finalAccessToken = accessToken;
      let postUrl = '';
      let pageToken = null;

      if (recipientType === 'user') {
        postUrl = `https://graph.facebook.com/v18.0/me/feed`;
      } else if (recipientType === 'page') {
        if (!pageId || typeof pageId !== 'string' || pageId.trim().length === 0) {
          throw new Error('pageId is required when recipientType is "page".');
        }
        // Get page access token
        const pageTokenUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`;
        const pageTokenResp = await fetch(pageTokenUrl, { method: 'GET' });
        const pageTokenData = await pageTokenResp.json();
        if (!pageTokenResp.ok || !pageTokenData.access_token) {
          throw new Error(`Unable to retrieve page access token: ${pageTokenData.error && pageTokenData.error.message ? pageTokenData.error.message : 'Unknown error'}`);
        }
        pageToken = pageTokenData.access_token;
        finalAccessToken = pageToken;
        postUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/feed`;
      } else {
        throw new Error('Invalid recipientType. Must be "user" or "page".');
      }

      const body = new URLSearchParams();
      body.append('message', message);
      if (link && typeof link === 'string' && link.trim().length > 0) {
        body.append('link', link);
      }
      body.append('access_token', finalAccessToken);

      const postResp = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      const postData = await postResp.json();
      if (!postResp.ok || !postData.id) {
        let errorMsg = (postData && postData.error && postData.error.message) ? postData.error.message : `Facebook API error: ${JSON.stringify(postData)}`;
        throw new Error(errorMsg);
      }

      return {
        postId: postData.id,
        success: true,
        error: null
      };
    } catch (error) {
      console.error('[facebook-api-plugin] Error:', error);
      return {
        postId: null,
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }
}

export default new FacebookPostStatusTool();