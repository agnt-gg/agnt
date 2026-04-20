// Data API — public user/position/trade endpoints.
// Docs: https://docs.polymarket.com/api-reference/introduction (Data section)
//
// Note: the leaderboard lives on a separate subdomain (lb-api.polymarket.com).

import { DATA_BASE } from './endpoints.js';
import { getJSON, qs } from './http.js';

const LEADERBOARD_BASE = 'https://lb-api.polymarket.com';

/**
 * Get current open positions for a wallet.
 * https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user
 */
export async function getUserPositions({ userAddress, limit = 50, offset = 0 }) {
  if (!userAddress) throw new Error('userAddress is required');
  const url = `${DATA_BASE}/positions${qs({ user: userAddress, limit, offset })}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}

/**
 * Get total USD value of a user's positions.
 * https://docs.polymarket.com/api-reference/core/get-total-value-of-a-users-positions
 */
export async function getUserValue({ userAddress }) {
  if (!userAddress) throw new Error('userAddress is required');
  const url = `${DATA_BASE}/value${qs({ user: userAddress })}`;
  const data = await getJSON(url);
  return Array.isArray(data) && data.length > 0 ? data[0] : data;
}

/**
 * Get closed positions (used to compute realized P&L).
 * https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user
 */
export async function getUserClosedPositions({ userAddress, limit = 100 }) {
  if (!userAddress) throw new Error('userAddress is required');
  const url = `${DATA_BASE}/closed-positions${qs({ user: userAddress, limit })}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}

/**
 * Get user activity log (orders, trades, claims, deposits, etc.).
 * https://docs.polymarket.com/api-reference/core/get-user-activity
 */
export async function getUserActivity({ userAddress, limit = 50, offset = 0 }) {
  if (!userAddress) throw new Error('userAddress is required');
  const url = `${DATA_BASE}/activity${qs({ user: userAddress, limit, offset })}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}

/**
 * Get trader leaderboard rankings.
 *
 * Lives on lb-api.polymarket.com. Accepted windows: 1d, 7d, 30d, all
 * (the manifest accepts the friendlier 'day'/'week'/'month'/'all' and we
 * normalise to the API's expected values here).
 *
 * https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings
 */
export async function getLeaderboard({ window = 'week', limit = 50, by = 'profit' }) {
  const w = normaliseLeaderboardWindow(window);
  const metric = ['profit', 'volume'].includes(by) ? by : 'profit';
  const url = `${LEADERBOARD_BASE}/${metric}${qs({ window: w, limit })}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}

function normaliseLeaderboardWindow(w) {
  const v = String(w).toLowerCase();
  const map = { day: '1d', '1d': '1d', week: '7d', '7d': '7d', '1w': '7d', month: '30d', '30d': '30d', '1m': '30d', all: 'all' };
  return map[v] || '1d';
}

/**
 * Get trades for a user/market.
 * https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets
 */
export async function getUserTrades({ userAddress, limit = 50 }) {
  if (!userAddress) throw new Error('userAddress is required');
  const url = `${DATA_BASE}/trades${qs({ user: userAddress, limit })}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}
