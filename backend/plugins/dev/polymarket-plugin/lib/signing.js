// CLOB authentication & order signing helpers.
//
// Implements both auth levels:
//   L1 — EIP-712 signature with the wallet's private key
//        (used to derive L2 credentials, and to sign order payloads)
//   L2 — HMAC-SHA256 signature over (timestamp + method + path + body)
//        (used as POLY_SIGNATURE on every authenticated request)
//
// These match the canonical implementations in @polymarket/clob-client-v2
// and py-clob-client-v2. See:
//   https://docs.polymarket.com/api-reference/authentication
//   https://github.com/Polymarket/clob-client-v2/blob/main/src/signing/eip712.ts
//   https://github.com/Polymarket/clob-client-v2/blob/main/src/signing/hmac.ts

import crypto from 'crypto';
import { ethers } from 'ethers';
import {
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_TYPES,
  CLOB_AUTH_MESSAGE,
  EXCHANGE_ADDRESS,
  NEG_RISK_EXCHANGE_ADDRESS,
  ORDER_DOMAIN_NAME,
  ORDER_DOMAIN_VERSION,
  ORDER_TYPES,
  POLYGON_CHAIN_ID,
} from './endpoints.js';

// ─── L1: build the auth headers used to derive/create API keys ────────────

/**
 * Build the four POLY_* L1 headers for a CLOB request.
 * @param {ethers.Wallet} signer
 * @param {number} [nonce=0]
 * @returns {Promise<{ POLY_ADDRESS: string, POLY_SIGNATURE: string, POLY_TIMESTAMP: string, POLY_NONCE: string }>}
 */
export async function buildL1Headers(signer, nonce = 0) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const value = {
    address:   signer.address,
    timestamp,
    nonce,
    message:   CLOB_AUTH_MESSAGE,
  };

  // ethers v5 syntax: _signTypedData
  const signature = await signer._signTypedData(CLOB_AUTH_DOMAIN, CLOB_AUTH_TYPES, value);

  return {
    POLY_ADDRESS:   signer.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE:     String(nonce),
  };
}

// ─── L2: HMAC headers for authenticated trading requests ───────────────────

/**
 * Build the five POLY_* L2 headers for an authenticated CLOB request.
 *
 * The HMAC string-to-sign is:   `${timestamp}${METHOD}${path}${body}`
 *
 * @param {string} address       Wallet address (signer)
 * @param {object} creds         { apiKey, secret, passphrase }
 * @param {string} method        e.g. 'GET' / 'POST' / 'DELETE'
 * @param {string} requestPath   The path including query, e.g. '/orders/abc'
 * @param {string} [body='']     The raw JSON body, or '' for GETs/DELETEs without body
 */
export function buildL2Headers(address, creds, method, requestPath, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = `${timestamp}${method.toUpperCase()}${requestPath}${body || ''}`;

  // Polymarket's HMAC convention: secret is base64url; signature is base64url(HMAC-SHA256(secret, message))
  const decodedSecret = Buffer.from(toBase64FromBase64Url(creds.secret), 'base64');
  const hmac = crypto.createHmac('sha256', decodedSecret).update(message).digest('base64');
  const signature = toBase64Url(hmac);

  return {
    POLY_ADDRESS:    address,
    POLY_SIGNATURE:  signature,
    POLY_TIMESTAMP:  timestamp,
    POLY_API_KEY:    creds.apiKey,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function toBase64FromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return b64;
}

// ─── Order signing (EIP-712) ───────────────────────────────────────────────

/**
 * Build a signed order ready to POST to /orders.
 *
 * @param {object} args
 * @param {ethers.Wallet} args.signer
 * @param {string}  args.tokenId
 * @param {number}  args.price       0.001 .. 0.999
 * @param {number}  args.size        shares (BUY/SELL limit) OR USDC amount (BUY market) OR shares (SELL market)
 * @param {'BUY'|'SELL'} args.side
 * @param {number}  args.feeRateBps  Maker fee in bps (typically 0 right now)
 * @param {number}  args.nonce       Order nonce (default 0)
 * @param {number}  args.expiration  Unix seconds (0 for non-GTD)
 * @param {string}  args.maker       Funder address (proxy or EOA)
 * @param {0|1|2}   args.signatureType
 * @param {boolean} args.negRisk     Whether to use the neg-risk exchange
 * @param {string}  args.tickSize    e.g. '0.01' — used to round price
 *
 * @returns {Promise<{ order: object, hash: string, signature: string }>}
 */
export async function buildSignedOrder({
  signer,
  tokenId,
  price,
  size,
  side,
  feeRateBps = 0,
  nonce = 0,
  expiration = 0,
  maker,
  signatureType,
  negRisk = false,
  tickSize = '0.01',
}) {
  if (!signer)  throw new Error('signer is required');
  if (!tokenId) throw new Error('tokenId is required');
  if (!maker)   throw new Error('maker (funderAddress) is required');

  // Round price to the tick size
  const tickDecimals = (tickSize.split('.')[1] || '').length;
  const priceRounded = Number(price.toFixed(tickDecimals));
  if (priceRounded <= 0 || priceRounded >= 1) {
    throw new Error(`Price ${priceRounded} out of range (must be 0 < p < 1)`);
  }

  // Convert price+size to maker/taker amounts in 6-decimal USDC units.
  // BUY:  maker spends USDC, takes shares  → makerAmount = price*size USDC, takerAmount = size shares (also 6 dp)
  // SELL: maker spends shares, takes USDC  → makerAmount = size shares,    takerAmount = price*size USDC
  const sizeShares = Math.floor(size * 1e6);          // shares are 6-decimal
  const usdcAmount = Math.floor(price * size * 1e6);  // USDC is 6-decimal
  if (sizeShares <= 0)  throw new Error('Size must be > 0');
  if (usdcAmount <= 0)  throw new Error('Notional (price*size) must be > 0');

  const sideEnum = side.toUpperCase() === 'BUY' ? 0 : 1;

  const makerAmount = sideEnum === 0 ? usdcAmount : sizeShares;
  const takerAmount = sideEnum === 0 ? sizeShares  : usdcAmount;

  // Random salt
  const salt = ethers.BigNumber.from(ethers.utils.randomBytes(8)).toString();

  const order = {
    salt,
    maker,
    signer:        signer.address,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       tokenId,
    makerAmount:   makerAmount.toString(),
    takerAmount:   takerAmount.toString(),
    expiration:    String(expiration || 0),
    nonce:         String(nonce),
    feeRateBps:    String(feeRateBps),
    side:          sideEnum,
    signatureType,
  };

  const verifyingContract = negRisk ? NEG_RISK_EXCHANGE_ADDRESS : EXCHANGE_ADDRESS;

  const domain = {
    name:              ORDER_DOMAIN_NAME,
    version:           ORDER_DOMAIN_VERSION,
    chainId:           POLYGON_CHAIN_ID,
    verifyingContract,
  };

  const signature = await signer._signTypedData(domain, ORDER_TYPES, order);
  const hash = ethers.utils._TypedDataEncoder.hash(domain, ORDER_TYPES, order);

  return { order, hash, signature };
}
