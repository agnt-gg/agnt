# Adding New OAuth Providers and API Keys

This guide outlines the essential steps to add a new OAuth provider or API key integration to the AGNT system.

## 1. Create Provider Class

Create a new file in `backend/src/oauth/providers/` named `[ProviderName]Provider.js`.

```javascript:backend/src/oauth/providers/[ProviderName]Provider.js
import axios from 'axios';

export default class [ProviderName]Provider {
  constructor(config) {
    this.id = '[provider-id]';
    this.config = config;
  }

  getAuthorizationUrl(state) {
    // Implement provider-specific authorization URL generation
  }

  async exchangeCodeForTokens(code) {
    // Implement code exchange for access and refresh tokens
  }

  async refreshTokens(refreshToken) {
    // Implement token refresh logic
  }
}
```

## 2. Update AuthManager

Modify `backend/src/oauth/AuthManager.js` to include the new provider:

```javascript:backend/src/oauth/AuthManager.js
import [ProviderName]Provider from './providers/[ProviderName]Provider.js';

const configs = {
  [provider-id]: {
    clientId: process.env.[PROVIDER_NAME]_CLIENT_ID,
    clientSecret: process.env.[PROVIDER_NAME]_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/settings`,
    scope: '[required scopes]'
  },
};

class AuthManager {
  registerProviders() {
    this.registerProvider(new [ProviderName]Provider(configs.[provider-id]));
  }
}
```

## 3. Implement Backend Action

Create a new file in `backend/src/tools/library/` named `[provider-id]-api.js`:

```javascript:backend/src/tools/library/[provider-id]-api.js
import BaseAction from "./BaseAction.js";
import AuthManager from "../../oauth/AuthManager.js";
import axios from "axios";

class [ProviderName]API extends BaseAction {
  constructor() {
    super("[provider-id]-api");
    this.baseUrl = "https://api.[provider-domain].com/v1";
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const accessToken = await AuthManager.getValidAccessToken(
        workflowEngine.userId,
        "[provider-id]"
      );
      if (!accessToken) {
        throw new Error("No valid access token found. Please reconnect to [ProviderName].");
      }

      // Implement provider-specific actions using the accessToken
    } catch (error) {
      console.error("Error executing [ProviderName] API:", error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }
}

export default new [ProviderName]API();
```

## 4. Using OAuth or API Key in Actions

The `getValidAccessToken` method from AuthManager will return either the OAuth access token or the API key, depending on what's available for the user and provider. This allows your action to work with both OAuth and API key authentication seamlessly.

## 5. Test the Integration

Thoroughly test the new provider integration, including:
- Authorization flow
- Token exchange and refreshing (for OAuth)
- API key storage and retrieval (for API key auth)
- Using the provider in workflows

Remember to handle errors gracefully and provide clear error messages to users.