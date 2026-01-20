import axios from 'axios';

class EthereumPriceChecker {
  constructor() {
    this.name = 'get-ethereum-price';
  }

  /**
   * Executes the tool logic
   * @param {Object} params - The resolved parameters from the workflow node
   * @param {Object} inputData - Output from the previous node
   * @param {Object} workflowEngine - Context about the user and workflow
   */
  async execute(params, inputData, workflowEngine) {
    console.log('[EthereumPriceChecker] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Validate and normalize parameters
      const currency = (params.currency || 'usd').toLowerCase();
      const validCurrencies = ['usd', 'eur', 'gbp', 'jpy', 'aud', 'cad'];
      
      if (!validCurrencies.includes(currency)) {
        console.warn(`[EthereumPriceChecker] Currency '${currency}' is not explicitly valid, but attempting fetch anyway.`);
      }

      // Fetch price from CoinGecko API
      // Using CoinGecko free API (no key required for low volume)
      const apiUrl = 'https://api.coingecko.com/api/v3/simple/price';
      const response = await axios.get(apiUrl, {
        params: {
          ids: 'ethereum',
          vs_currencies: currency
        },
        timeout: 5000 // 5 second timeout
      });

      // Parse response
      // Expected format: { "ethereum": { "usd": 2000.50 } }
      if (!response.data || !response.data.ethereum) {
        throw new Error('Received unexpected response format from API provider.');
      }

      const price = response.data.ethereum[currency];

      if (price === undefined) {
        throw new Error(`Price information not found for currency: ${currency}`);
      }

      console.log(`[EthereumPriceChecker] Successfully fetched price: ${price} ${currency}`);

      // Return object matching schema outputs
      return {
        price: Number(price),
        currency: currency,
        success: true,
        error: null
      };

    } catch (error) {
      console.error('[EthereumPriceChecker] Error fetching price:', error.message);
      
      // Handle axios errors specifically for better messages
      let errorMessage = error.message;
      if (error.response) {
        errorMessage = `API Error: ${error.response.status} ${error.response.statusText}`;
      } else if (error.request) {
        errorMessage = 'No response received from pricing API';
      }

      return {
        price: null,
        currency: params.currency || 'usd',
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new EthereumPriceChecker();