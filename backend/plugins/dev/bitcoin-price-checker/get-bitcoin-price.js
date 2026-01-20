class BitcoinPriceChecker {
  constructor() {
    this.name = 'get-bitcoin-price';
    this.apiUrl = 'https://api.coingecko.com/api/v3/simple/price';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[bitcoin-price-checker] Executing with params:', JSON.stringify(params, null, 2));

    const currency = (params && typeof params.currency === 'string' ? params.currency : 'usd').toLowerCase();

    try {
      const url = `${this.apiUrl}?ids=bitcoin&vs_currencies=${encodeURIComponent(currency)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`CoinGecko API returned status ${response.status}`);
      }

      const data = await response.json();

      if (
        !data ||
        !data.bitcoin ||
        typeof data.bitcoin[currency] !== 'number'
      ) {
        throw new Error('Invalid API response structure.');
      }

      const bitcoinPrice = data.bitcoin[currency];

      return {
        bitcoinPrice,
        currency,
        success: true,
        error: null
      };
    } catch (error) {
      console.error('[bitcoin-price-checker] Error:', error);
      return {
        bitcoinPrice: null,
        currency,
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }
}

export default new BitcoinPriceChecker();