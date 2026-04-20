// CLOB API — public (no-auth) read endpoints.
// Docs: https://docs.polymarket.com/market-data/overview

import { CLOB_BASE } from './endpoints.js';
import { getJSON, qs } from './http.js';

/**
 * Order book (bids + asks) for a single token.
 * https://docs.polymarket.com/api-reference/market-data/get-order-book
 */
export async function getOrderbook(tokenId) {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/book${qs({ token_id: tokenId })}`;
  return await getJSON(url);
}

/**
 * Best bid or ask price for a token.
 * https://docs.polymarket.com/api-reference/market-data/get-market-price
 */
export async function getPrice(tokenId, side = 'BUY') {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/price${qs({ token_id: tokenId, side: side.toLowerCase() })}`;
  const data = await getJSON(url);
  return parseFloat(data?.price ?? data);
}

/**
 * Midpoint price (avg of best bid and best ask).
 * https://docs.polymarket.com/api-reference/data/get-midpoint-price
 */
export async function getMidpoint(tokenId) {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/midpoint${qs({ token_id: tokenId })}`;
  const data = await getJSON(url);
  return parseFloat(data?.mid ?? data?.midpoint ?? data);
}

/**
 * Bid-ask spread.
 * https://docs.polymarket.com/api-reference/market-data/get-spread
 */
export async function getSpread(tokenId) {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/spread${qs({ token_id: tokenId })}`;
  const data = await getJSON(url);
  return parseFloat(data?.spread ?? data);
}

/**
 * Historical price points for a token.
 * https://docs.polymarket.com/api-reference/markets/get-prices-history
 */
export async function getPriceHistory(tokenId, { interval = '1d', fidelity = 60 } = {}) {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/prices-history${qs({ market: tokenId, interval, fidelity })}`;
  const data = await getJSON(url);
  return Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
}

/**
 * Get the required tick size for a market token.
 * https://docs.polymarket.com/api-reference/market-data/get-tick-size
 */
export async function getTickSize(tokenId) {
  if (!tokenId) throw new Error('tokenId is required');
  const url = `${CLOB_BASE}/tick-size${qs({ token_id: tokenId })}`;
  const data = await getJSON(url);
  return data?.minimum_tick_size ?? data?.tick_size ?? '0.01';
}

/**
 * Whether a market uses the Neg Risk CTF Exchange (multi-outcome).
 * https://docs.polymarket.com/api-reference/markets/get-clob-market-info
 */
export async function getNegRisk(tokenId) {
  if (!tokenId) throw new Error('tokenId is required');
  // The clob market endpoint returns full market info including neg_risk flag
  const url = `${CLOB_BASE}/markets/${encodeURIComponent(tokenId)}`;
  try {
    const data = await getJSON(url);
    return Boolean(data?.neg_risk);
  } catch {
    return false; // default: standard exchange
  }
}

/**
 * Fee rate (basis points) for a token.
 * https://docs.polymarket.com/api-reference/market-data/get-fee-rate
 */
export async function getFeeRateBps(tokenId) {
  if (!tokenId) return 0;
  try {
    const url = `${CLOB_BASE}/fee-rate-bps${qs({ token_id: tokenId })}`;
    const data = await getJSON(url);
    return Number(data?.fee_rate_bps ?? data ?? 0);
  } catch {
    return 0;
  }
}
