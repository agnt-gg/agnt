// CLOB API — authenticated (L1 + L2) endpoints.
// Order placement, cancellation, and user-order queries.
//
// All write requests need:
//   - L2 HMAC headers (built fresh per request)
//   - For order creation, the order body must additionally be EIP-712 signed (see signing.js)

import { ethers } from 'ethers';
import { CLOB_BASE, SIG_TYPE } from './endpoints.js';
import { getJSON, postJSON, deleteJSON, qs } from './http.js';
import { buildL1Headers, buildL2Headers, buildSignedOrder } from './signing.js';
import { getTickSize, getNegRisk, getFeeRateBps } from './clobPublic.js';

/**
 * Derive (or create) L2 API credentials from L1 (private key) auth.
 * https://docs.polymarket.com/api-reference/authentication
 *
 * @param {ethers.Wallet} signer
 * @returns {Promise<{ apiKey: string, secret: string, passphrase: string }>}
 */
export async function deriveOrCreateApiKey(signer) {
  // Try to derive existing first (idempotent — safer than create)
  const headers = await buildL1Headers(signer, 0);
  try {
    const data = await getJSON(`${CLOB_BASE}/auth/derive-api-key`, headers);
    if (data?.apiKey) return data;
  } catch (err) {
    if (err.status !== 404) {
      // 404 means none exist yet — fall through to create
      // Anything else: rethrow
      if (err.status && err.status !== 404) throw err;
    }
  }

  // Create new credentials
  const created = await postJSON(`${CLOB_BASE}/auth/api-key`, {}, headers);
  if (!created?.apiKey) {
    throw new Error('Polymarket did not return apiKey from /auth/api-key. Response: ' + JSON.stringify(created));
  }
  return created;
}

/**
 * Resolve sig type string → numeric enum.
 */
export function resolveSigType(sigTypeStr) {
  const t = (sigTypeStr || 'GNOSIS_SAFE').toUpperCase();
  if (!(t in SIG_TYPE)) throw new Error(`Invalid signatureType "${sigTypeStr}". Use EOA, POLY_PROXY, or GNOSIS_SAFE.`);
  return SIG_TYPE[t];
}

// ─── Place a limit order ──────────────────────────────────────────────────

/**
 * Sign and POST a limit order to the CLOB.
 *
 * @param {object} args
 * @param {object} args.creds            { privateKey, funderAddress, signatureType, apiKey, apiSecret, passphrase }
 * @param {string} args.tokenId
 * @param {number} args.price
 * @param {number} args.size
 * @param {'BUY'|'SELL'} args.side
 * @param {'GTC'|'GTD'|'FOK'|'FAK'} args.orderType
 * @param {number} [args.expiration]
 * @param {string} [args.tickSize='auto']
 * @param {string} [args.negRisk='auto']
 */
export async function placeLimitOrder({ creds, tokenId, price, size, side, orderType = 'GTC', expiration, tickSize = 'auto', negRisk = 'auto' }) {
  validateCreds(creds, true);

  const signer = new ethers.Wallet(creds.privateKey);
  const sigTypeNum = resolveSigType(creds.signatureType);

  // Resolve market params if 'auto'
  const resolvedTickSize = tickSize === 'auto' ? await getTickSize(tokenId) : tickSize;
  const resolvedNegRisk  = negRisk === 'auto' ? await getNegRisk(tokenId) : (negRisk === 'true' || negRisk === true);
  const feeRateBps       = await getFeeRateBps(tokenId);

  // Sign the order
  const { order, signature } = await buildSignedOrder({
    signer,
    tokenId,
    price,
    size,
    side,
    feeRateBps,
    nonce: 0,
    expiration: expiration || 0,
    maker: creds.funderAddress,
    signatureType: sigTypeNum,
    negRisk: resolvedNegRisk,
    tickSize: resolvedTickSize,
  });

  const requestBody = {
    order:     { ...order, signature },
    owner:     creds.apiKey,
    orderType,
  };

  const path = '/order';
  const bodyStr = JSON.stringify(requestBody);
  const headers = buildL2Headers(
    signer.address,
    { apiKey: creds.apiKey, secret: creds.apiSecret, passphrase: creds.passphrase },
    'POST',
    path,
    bodyStr
  );

  const res = await postJSON(`${CLOB_BASE}${path}`, requestBody, headers);
  return res;
}

// ─── Place a market order (FOK / FAK) ─────────────────────────────────────

/**
 * Place a market order. For BUY: 'size' is interpreted as a USDC dollar amount.
 * For SELL: 'size' is interpreted as a number of shares.
 * The 'price' arg becomes the worst-price slippage cap.
 */
export async function placeMarketOrder({ creds, tokenId, side, size, price, orderType = 'FOK', tickSize = 'auto', negRisk = 'auto' }) {
  validateCreds(creds, true);
  if (!['FOK', 'FAK'].includes(orderType)) {
    throw new Error('Market orders must use orderType FOK or FAK');
  }

  const signer = new ethers.Wallet(creds.privateKey);
  const sigTypeNum = resolveSigType(creds.signatureType);

  const resolvedTickSize = tickSize === 'auto' ? await getTickSize(tokenId) : tickSize;
  const resolvedNegRisk  = negRisk === 'auto' ? await getNegRisk(tokenId) : (negRisk === 'true' || negRisk === true);
  const feeRateBps       = await getFeeRateBps(tokenId);

  // For market BUY, convert dollar amount → shares at the slippage cap price
  // (The CLOB will fill at better prices when available.)
  let computedSize = size;
  if (side.toUpperCase() === 'BUY') {
    computedSize = size / price;
  }

  const { order, signature } = await buildSignedOrder({
    signer,
    tokenId,
    price,
    size: computedSize,
    side,
    feeRateBps,
    nonce: 0,
    expiration: 0,
    maker: creds.funderAddress,
    signatureType: sigTypeNum,
    negRisk: resolvedNegRisk,
    tickSize: resolvedTickSize,
  });

  const requestBody = {
    order:     { ...order, signature },
    owner:     creds.apiKey,
    orderType,
  };

  const path = '/order';
  const bodyStr = JSON.stringify(requestBody);
  const headers = buildL2Headers(
    signer.address,
    { apiKey: creds.apiKey, secret: creds.apiSecret, passphrase: creds.passphrase },
    'POST',
    path,
    bodyStr
  );

  return await postJSON(`${CLOB_BASE}${path}`, requestBody, headers);
}

// ─── Open orders ──────────────────────────────────────────────────────────

export async function getOpenOrders({ creds, market, limit = 50 }) {
  validateCreds(creds, false);
  const signer = new ethers.Wallet(creds.privateKey);
  const params = { limit };
  if (market) params.market = market;

  const path = `/data/orders${qs(params)}`;
  const headers = buildL2Headers(
    signer.address,
    { apiKey: creds.apiKey, secret: creds.apiSecret, passphrase: creds.passphrase },
    'GET',
    path,
    ''
  );

  const data = await getJSON(`${CLOB_BASE}${path}`, headers);
  return Array.isArray(data) ? data : (data?.data || []);
}

// ─── Cancel ───────────────────────────────────────────────────────────────

export async function cancelOrder({ creds, orderId }) {
  validateCreds(creds, false);
  if (!orderId) throw new Error('orderId is required');

  const signer = new ethers.Wallet(creds.privateKey);
  const path = '/order';
  const body = { orderID: orderId };
  const bodyStr = JSON.stringify(body);

  const headers = buildL2Headers(
    signer.address,
    { apiKey: creds.apiKey, secret: creds.apiSecret, passphrase: creds.passphrase },
    'DELETE',
    path,
    bodyStr
  );

  return await deleteJSON(`${CLOB_BASE}${path}`, body, headers);
}

export async function cancelAllOrders({ creds, tokenId }) {
  validateCreds(creds, false);
  const signer = new ethers.Wallet(creds.privateKey);

  // If tokenId given → cancel-by-market endpoint; else → cancel-all
  const path = tokenId ? '/cancel-market-orders' : '/cancel-all';
  const body = tokenId ? { market: tokenId } : {};
  const bodyStr = tokenId ? JSON.stringify(body) : '';

  const headers = buildL2Headers(
    signer.address,
    { apiKey: creds.apiKey, secret: creds.apiSecret, passphrase: creds.passphrase },
    'DELETE',
    path,
    bodyStr
  );

  return await deleteJSON(`${CLOB_BASE}${path}`, tokenId ? body : null, headers);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function validateCreds(creds, requireFunder) {
  if (!creds || typeof creds !== 'object') {
    throw new Error('Polymarket credentials missing. Connect your wallet in Settings → Connections.');
  }
  if (!creds.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(creds.privateKey)) {
    throw new Error('Invalid or missing privateKey in Polymarket credentials.');
  }
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) {
    throw new Error('Missing L2 credentials. Run the DERIVE_API_KEY operation first to populate apiKey/apiSecret/passphrase.');
  }
  if (requireFunder && !creds.funderAddress) {
    throw new Error('Missing funderAddress. Set it to your Polymarket proxy wallet address (visible in your Polymarket profile).');
  }
}
