import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

export default class PlaidProvider {
  constructor(config) {
    this.id = 'plaid';
    this.config = config;

    // Plaid uses PLAID_CLIENT_ID and PLAID_SECRET from .env
    // (AuthManager maps PLAID_CLIENT_ID → config.clientId, PLAID_CLIENT_SECRET → config.clientSecret)
    this.clientId = config.clientId || process.env.PLAID_CLIENT_ID;
    this.secret = config.clientSecret || process.env.PLAID_SECRET;
    this.environment = process.env.PLAID_ENV || 'sandbox';

    this.client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[this.environment],
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': this.clientId,
            'PLAID-SECRET': this.secret,
          },
        },
      }),
    );
  }

  /**
   * Plaid doesn't have a traditional OAuth authorization URL.
   * Instead, it uses Link tokens. This generates a Link token URL
   * that the frontend can use to open the Plaid Link UI.
   *
   * The "state" is passed through so the callback can identify the user.
   */
  getAuthorizationUrl(state) {
    // Return a custom URL that the frontend intercepts to open Plaid Link
    // The frontend should:
    //   1. Call POST /auth/plaid/link-token to get a link_token
    //   2. Open Plaid Link with that token
    //   3. On success, send the public_token to /auth/callback/plaid
    const params = new URLSearchParams({
      provider: 'plaid',
      state: `plaid:${state}`,
      redirect_uri: this.config.redirectUri,
    });

    return `${process.env.FRONTEND_URL || process.env.REMOTE_URL}/connect/plaid?${params.toString()}`;
  }

  /**
   * Exchange a Plaid public_token for a permanent access_token.
   *
   * In Plaid's flow, the "code" is actually the public_token
   * returned by Plaid Link after a user connects their bank.
   */
  async exchangeCodeForTokens(code) {
    try {
      const response = await this.client.itemPublicTokenExchange({
        public_token: code,
      });

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.item_id, // Store item_id as "refresh_token" for reference
        expires_at: null, // Plaid access tokens don't expire
      };
    } catch (error) {
      console.error('Error exchanging Plaid public_token:', error.response?.data || error.message);
      throw new Error('Failed to exchange Plaid public_token for access_token');
    }
  }

  /**
   * Plaid access tokens don't expire and don't need refreshing.
   * If a token becomes invalid, the user must re-link via Plaid Link.
   */
  async refreshTokens(refreshToken) {
    console.log('Plaid access tokens do not expire and do not require refresh.');
    return {
      access_token: refreshToken,
      refresh_token: null,
      expires_at: null,
    };
  }

  /**
   * Helper: Create a Link token for initiating the Plaid Link flow.
   * Call this from a route like POST /auth/plaid/link-token
   */
  async createLinkToken(userId, products = ['auth', 'transactions']) {
    try {
      const response = await this.client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'AGNT',
        products,
        country_codes: ['US'],
        language: 'en',
        redirect_uri: this.config.redirectUri,
      });

      return response.data;
    } catch (error) {
      console.error('Error creating Plaid Link token:', error.response?.data || error.message);
      throw new Error('Failed to create Plaid Link token');
    }
  }
}
