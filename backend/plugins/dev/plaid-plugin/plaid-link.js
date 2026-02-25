import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

/**
 * Plaid Link Plugin Tool
 *
 * Handles the Plaid Link flow for connecting bank accounts:
 * - Create link tokens to initialize Plaid Link UI
 * - Exchange public tokens for permanent access tokens
 * - Manage connected Items (get info, update, remove)
 * - Search and get info about financial institutions
 */
class PlaidLink {
  constructor() {
    this.name = 'plaid-link';
  }

  /**
   * Create an authenticated Plaid API client using stored credentials
   */
  async getClient(userId) {
    const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
    const AuthManagerModule = await import(`file://${authManagerPath.replace(/\\/g, '/')}`);
    const AuthManager = AuthManagerModule.default;

    // Plaid requires both client_id and secret stored as a JSON object in the auth provider
    // Expected format: { "clientId": "...", "secret": "...", "environment": "sandbox|production" }
    const credentials = await AuthManager.getValidAccessToken(userId, 'plaid');
    if (!credentials) {
      throw new Error('Plaid credentials not found. Please add your Plaid API keys in Settings > Connected Apps.');
    }

    // Support both string (just secret) and JSON object formats
    let clientId, secret, environment;
    if (typeof credentials === 'string') {
      try {
        const parsed = JSON.parse(credentials);
        clientId = parsed.clientId || parsed.client_id;
        secret = parsed.secret;
        environment = parsed.environment || 'sandbox';
      } catch {
        // If it's just a plain string, assume it's the secret and clientId is stored separately
        throw new Error(
          'Plaid credentials must be stored as JSON: {"clientId": "your_client_id", "secret": "your_secret", "environment": "sandbox"}',
        );
      }
    } else if (typeof credentials === 'object') {
      clientId = credentials.clientId || credentials.client_id;
      secret = credentials.secret;
      environment = credentials.environment || 'sandbox';
    }

    if (!clientId || !secret) {
      throw new Error(
        'Invalid Plaid credentials. Expected JSON with clientId and secret: {"clientId": "...", "secret": "...", "environment": "sandbox"}',
      );
    }

    const config = new Configuration({
      basePath: PlaidEnvironments[environment] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
          'Plaid-Version': '2020-09-14',
        },
      },
    });

    return { client: new PlaidApi(config), clientId, environment };
  }

  /**
   * Parse comma-separated product strings into Plaid Product enums
   */
  parseProducts(productsStr) {
    if (!productsStr) return [Products.Auth, Products.Transactions];
    const productMap = {
      auth: Products.Auth,
      transactions: Products.Transactions,
      balance: Products.Balance,
      identity: Products.Identity,
      investments: Products.Investments,
      liabilities: Products.Liabilities,
      transfer: Products.Transfer,
      assets: Products.Assets,
    };
    return productsStr
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => productMap[p])
      .map((p) => productMap[p]);
  }

  /**
   * Parse comma-separated country code strings into Plaid CountryCode enums
   */
  parseCountryCodes(codesStr) {
    if (!codesStr) return [CountryCode.Us];
    const codeMap = {
      us: CountryCode.Us,
      ca: CountryCode.Ca,
      gb: CountryCode.Gb,
      ie: CountryCode.Ie,
      fr: CountryCode.Fr,
      es: CountryCode.Es,
      nl: CountryCode.Nl,
      de: CountryCode.De,
    };
    return codesStr
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => codeMap[c])
      .map((c) => codeMap[c]);
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[PlaidPlugin] Executing Plaid Link with action:', params.action);

    try {
      params.userId = workflowEngine.userId;
      const { client, clientId, environment } = await this.getClient(params.userId);

      let result;
      switch (params.action) {
        case 'CREATE_LINK_TOKEN':
          result = await this.createLinkToken(client, clientId, params);
          break;
        case 'EXCHANGE_PUBLIC_TOKEN':
          result = await this.exchangePublicToken(client, params);
          break;
        case 'GET_ITEM':
          result = await this.getItem(client, params);
          break;
        case 'UPDATE_ITEM':
          result = await this.updateItem(client, clientId, params);
          break;
        case 'REMOVE_ITEM':
          result = await this.removeItem(client, params);
          break;
        case 'SEARCH_INSTITUTIONS':
          result = await this.searchInstitutions(client, params);
          break;
        case 'GET_INSTITUTION':
          result = await this.getInstitution(client, params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return {
        success: true,
        result,
        environment,
        error: null,
      };
    } catch (error) {
      console.error('[PlaidPlugin] Error in Plaid Link:', error);
      const plaidError = error?.response?.data;
      return {
        success: false,
        result: null,
        error: plaidError
          ? `[${plaidError.error_type}] ${plaidError.error_code}: ${plaidError.error_message}`
          : error.message,
      };
    }
  }

  /**
   * CREATE_LINK_TOKEN
   * Creates a link_token to initialize Plaid Link in the frontend.
   * The link_token is short-lived (30 min) and configures which products and countries are available.
   */
  async createLinkToken(client, clientId, params) {
    const products = this.parseProducts(params.products);
    const countryCodes = this.parseCountryCodes(params.countryCodes);

    const request = {
      user: {
        client_user_id: params.userId,
      },
      client_name: 'AGNT',
      products,
      country_codes: countryCodes,
      language: params.language || 'en',
    };

    // If a webhook URL is configured, include it
    if (params.webhookUrl) {
      request.webhook = params.webhookUrl;
    }

    const response = await client.linkTokenCreate(request);

    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
      requestId: response.data.request_id,
      products: products.map((p) => p.toString()),
      countryCodes: countryCodes.map((c) => c.toString()),
    };
  }

  /**
   * EXCHANGE_PUBLIC_TOKEN
   * Exchanges a short-lived public_token (from Plaid Link) for a permanent access_token.
   * The access_token is used for all subsequent API calls for this Item.
   * IMPORTANT: Store the access_token securely - it provides ongoing access to the user's financial data.
   */
  async exchangePublicToken(client, params) {
    if (!params.publicToken) {
      throw new Error('publicToken is required for EXCHANGE_PUBLIC_TOKEN action');
    }

    const response = await client.itemPublicTokenExchange({
      public_token: params.publicToken,
    });

    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
      requestId: response.data.request_id,
      _note: 'Store the accessToken securely. It provides ongoing access to this bank connection.',
    };
  }

  /**
   * GET_ITEM
   * Retrieves information about a connected bank Item including:
   * available products, billed products, institution info, consent status, etc.
   */
  async getItem(client, params) {
    if (!params.accessToken) {
      throw new Error('accessToken is required for GET_ITEM action');
    }

    const response = await client.itemGet({
      access_token: params.accessToken,
    });

    const item = response.data.item;
    return {
      itemId: item.item_id,
      institutionId: item.institution_id,
      availableProducts: item.available_products,
      billedProducts: item.billed_products,
      consentExpirationTime: item.consent_expiration_time,
      updateType: item.update_type,
      webhook: item.webhook,
      error: item.error,
      requestId: response.data.request_id,
    };
  }

  /**
   * UPDATE_ITEM
   * Creates a new link_token in update mode to fix or update an existing Item connection.
   * Useful when user needs to re-authenticate (e.g., changed bank password).
   */
  async updateItem(client, clientId, params) {
    if (!params.accessToken) {
      throw new Error('accessToken is required for UPDATE_ITEM action');
    }

    const request = {
      user: {
        client_user_id: params.userId,
      },
      client_name: 'AGNT',
      country_codes: this.parseCountryCodes(params.countryCodes),
      language: params.language || 'en',
      access_token: params.accessToken,
    };

    const response = await client.linkTokenCreate(request);

    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
      requestId: response.data.request_id,
      _note: 'Use this link_token to re-initialize Plaid Link in update mode for the user to re-authenticate.',
    };
  }

  /**
   * REMOVE_ITEM
   * Removes a connected bank Item. This invalidates the access_token and
   * deletes all associated data from Plaid's systems.
   */
  async removeItem(client, params) {
    if (!params.accessToken) {
      throw new Error('accessToken is required for REMOVE_ITEM action');
    }

    const response = await client.itemRemove({
      access_token: params.accessToken,
    });

    return {
      removed: true,
      requestId: response.data.request_id,
      _note: 'The Item has been removed. The access_token is now invalid.',
    };
  }

  /**
   * SEARCH_INSTITUTIONS
   * Search for financial institutions by name. Returns institution IDs, names,
   * supported products, routing numbers, and logo/branding info.
   */
  async searchInstitutions(client, params) {
    if (!params.query) {
      throw new Error('query is required for SEARCH_INSTITUTIONS action');
    }

    const countryCodes = this.parseCountryCodes(params.countryCodes);
    const request = {
      query: params.query,
      products: params.products ? this.parseProducts(params.products) : null,
      country_codes: countryCodes,
      options: {
        include_optional_metadata: true,
      },
    };

    // Remove null products to avoid API error
    if (!request.products) {
      delete request.products;
    }

    const response = await client.institutionsSearch(request);

    return {
      institutions: response.data.institutions.map((inst) => ({
        institutionId: inst.institution_id,
        name: inst.name,
        products: inst.products,
        countryCodes: inst.country_codes,
        url: inst.url,
        logo: inst.logo,
        primaryColor: inst.primary_color,
        routingNumbers: inst.routing_numbers,
      })),
      totalResults: response.data.institutions.length,
      requestId: response.data.request_id,
    };
  }

  /**
   * GET_INSTITUTION
   * Get detailed information about a specific financial institution by its ID.
   */
  async getInstitution(client, params) {
    if (!params.institutionId) {
      throw new Error('institutionId is required for GET_INSTITUTION action');
    }

    const countryCodes = this.parseCountryCodes(params.countryCodes || 'US');
    const response = await client.institutionsGetById({
      institution_id: params.institutionId,
      country_codes: countryCodes,
      options: {
        include_optional_metadata: true,
      },
    });

    const inst = response.data.institution;
    return {
      institutionId: inst.institution_id,
      name: inst.name,
      products: inst.products,
      countryCodes: inst.country_codes,
      url: inst.url,
      logo: inst.logo,
      primaryColor: inst.primary_color,
      routingNumbers: inst.routing_numbers,
      oauth: inst.oauth,
      requestId: response.data.request_id,
    };
  }
}

export default new PlaidLink();
