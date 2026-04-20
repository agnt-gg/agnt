// Polymarket API base URLs.
// All four are documented at https://docs.polymarket.com/api-reference/introduction

export const GAMMA_BASE = 'https://gamma-api.polymarket.com';
export const DATA_BASE  = 'https://data-api.polymarket.com';
export const CLOB_BASE  = 'https://clob.polymarket.com';
export const BRIDGE_BASE = 'https://bridge.polymarket.com';

// EIP-712 domain used for L1 (CLOB auth) signatures.
// https://docs.polymarket.com/api-reference/authentication
export const CLOB_AUTH_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137, // Polygon mainnet
};

export const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

export const CLOB_AUTH_MESSAGE = 'This message attests that I control the given wallet';

// EIP-712 domain for the Polymarket Exchange (order signing).
// https://docs.polymarket.com/resources/contracts
export const EXCHANGE_ADDRESS         = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const NEG_RISK_EXCHANGE_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

export const ORDER_DOMAIN_NAME    = 'Polymarket CTF Exchange';
export const ORDER_DOMAIN_VERSION = '1';
export const POLYGON_CHAIN_ID     = 137;

// Order EIP-712 type definition (matches @polymarket/clob-client-v2)
export const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

// Side enum (matches CLOB)
export const SIDE = { BUY: 0, SELL: 1 };

// Signature type enum
export const SIG_TYPE = {
  EOA:         0,
  POLY_PROXY:  1,
  GNOSIS_SAFE: 2,
};
