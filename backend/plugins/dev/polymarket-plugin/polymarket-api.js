// Polymarket API — unified AGNT plugin tool.
//
// One node, twenty operations, three Polymarket APIs:
//   • Gamma  — discovery (search, markets, events, trending)
//   • CLOB   — orderbook & prices (public) + signed order placement (auth)
//   • Data   — user positions, P&L, trades, leaderboard
//
// Auth model:
//   `params.__auth?.token` is injected by AGNT when `authProvider: "polymarket"`
//   is configured. We expect the token to be a JSON string containing:
//     { privateKey, funderAddress, signatureType, apiKey, apiSecret, passphrase }
//
//   Public ops work without any of these fields.
//   Trading ops require the full set — run DERIVE_API_KEY once to mint them.
//
// References:
//   https://docs.polymarket.com/api-reference/introduction
//   https://docs.polymarket.com/trading/overview

import { ethers } from 'ethers';

import * as gamma     from './lib/gamma.js';
import * as data      from './lib/dataApi.js';
import * as clob      from './lib/clobPublic.js';
import * as clobAuth  from './lib/clobAuth.js';

class PolymarketAPI {
  constructor() {
    this.name = 'polymarket-api';
  }

  // ─── Main execute ────────────────────────────────────────────────────────

  async execute(params, inputData, workflowEngine) {
    const op = (params.operation || 'SEARCH_MARKETS').toUpperCase();
    console.log(`[PolymarketPlugin] Executing operation: ${op}`);

    try {
      switch (op) {
        // ─── Gamma (public) ─────────────────────────────────────
        case 'SEARCH_MARKETS':    return await this.searchMarkets(params);
        case 'GET_MARKET':        return await this.getMarket(params);
        case 'GET_EVENT':         return await this.getEvent(params);
        case 'LIST_TRENDING':     return await this.listTrending(params);

        // ─── CLOB public reads ───────────────────────────────────
        case 'GET_ORDERBOOK':     return await this.getOrderbook(params);
        case 'GET_PRICE':         return await this.getPrice(params);
        case 'GET_PRICE_HISTORY': return await this.getPriceHistory(params);
        case 'GET_MIDPOINT':      return await this.getMidpoint(params);
        case 'GET_SPREAD':        return await this.getSpread(params);

        // ─── Data API (public) ───────────────────────────────────
        case 'GET_USER_POSITIONS': return await this.getUserPositions(params);
        case 'GET_USER_PNL':       return await this.getUserPnL(params);
        case 'GET_USER_ACTIVITY':  return await this.getUserActivity(params);
        case 'GET_LEADERBOARD':    return await this.getLeaderboard(params);
        case 'GET_USER_TRADES':    return await this.getUserTrades(params);

        // ─── CLOB authenticated ──────────────────────────────────
        case 'DERIVE_API_KEY':     return await this.deriveApiKey(params);
        case 'PLACE_LIMIT_ORDER':  return await this.placeLimitOrder(params);
        case 'PLACE_MARKET_ORDER': return await this.placeMarketOrder(params);
        case 'GET_OPEN_ORDERS':    return await this.getOpenOrders(params);
        case 'CANCEL_ORDER':       return await this.cancelOrder(params);
        case 'CANCEL_ALL_ORDERS':  return await this.cancelAllOrders(params);

        default:
          throw new Error(
            `Unsupported operation: ${op}. ` +
            'See manifest for the full list of supported operations.'
          );
      }
    } catch (error) {
      console.error(`[PolymarketPlugin] Error (${op}):`, error.message);
      return {
        success:   false,
        operation: op,
        error:     error.message,
      };
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Gamma API — discovery
  // ────────────────────────────────────────────────────────────────────────

  async searchMarkets(params) {
    const { query, tagSlug, active, closed, limit, offset } = params;
    if (!query && !tagSlug) {
      throw new Error('SEARCH_MARKETS requires either a query or a tagSlug');
    }
    const result = await gamma.searchMarkets({
      query: query || '',
      tagSlug,
      active: active || 'true',
      closed: closed || 'false',
      limit:  Number(limit)  || 20,
      offset: Number(offset) || 0,
    });

    const slim = result.markets.map(slimMarket);
    return {
      success:   true,
      operation: 'SEARCH_MARKETS',
      markets:   slim,
      events:    result.events,
      count:     slim.length,
      data:      result,
    };
  }

  async getMarket(params) {
    const { marketId } = params;
    if (!marketId) throw new Error('marketId is required');
    const market = await gamma.getMarket(marketId);
    return {
      success:   true,
      operation: 'GET_MARKET',
      market:    market,
      data:      market,
    };
  }

  async getEvent(params) {
    const { eventId } = params;
    if (!eventId) throw new Error('eventId is required');
    const event = await gamma.getEvent(eventId);
    return {
      success:   true,
      operation: 'GET_EVENT',
      event:     event,
      data:      event,
    };
  }

  async listTrending(params) {
    const { tagSlug, active, closed, orderBy, limit, offset } = params;
    const markets = await gamma.listTrending({
      tagSlug,
      active:  active  || 'true',
      closed:  closed  || 'false',
      orderBy: orderBy || 'volume24hr',
      limit:   Number(limit)  || 20,
      offset:  Number(offset) || 0,
    });
    const slim = markets.map(slimMarket);
    return {
      success:   true,
      operation: 'LIST_TRENDING',
      markets:   slim,
      count:     slim.length,
      data:      markets,
    };
  }

  // ───────────────────────��────────────────────────────────────────────────
  // CLOB — public reads
  // ────────────────────────────────────────────────────────────────────────

  async getOrderbook(params) {
    const { tokenId } = params;
    if (!tokenId) throw new Error('tokenId is required');
    const [book, midpoint, spread] = await Promise.all([
      clob.getOrderbook(tokenId),
      clob.getMidpoint(tokenId).catch(() => null),
      clob.getSpread(tokenId).catch(() => null),
    ]);
    return {
      success:   true,
      operation: 'GET_ORDERBOOK',
      orderbook: { ...book, midpoint, spread },
      data:      book,
    };
  }

  async getPrice(params) {
    const { tokenId, side } = params;
    const price = await clob.getPrice(tokenId, side || 'BUY');
    return {
      success:   true,
      operation: 'GET_PRICE',
      price,
      data:      { tokenId, side, price },
    };
  }

  async getMidpoint(params) {
    const { tokenId } = params;
    const price = await clob.getMidpoint(tokenId);
    return {
      success:   true,
      operation: 'GET_MIDPOINT',
      price,
      data:      { tokenId, midpoint: price },
    };
  }

  async getSpread(params) {
    const { tokenId } = params;
    const spread = await clob.getSpread(tokenId);
    return {
      success:   true,
      operation: 'GET_SPREAD',
      spread,
      data:      { tokenId, spread },
    };
  }

  async getPriceHistory(params) {
    const { tokenId, interval, fidelity } = params;
    const history = await clob.getPriceHistory(tokenId, {
      interval: interval || '1d',
      fidelity: Number(fidelity) || 60,
    });
    return {
      success:   true,
      operation: 'GET_PRICE_HISTORY',
      history,
      count:     history.length,
      data:      { tokenId, interval, fidelity, history },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Data API — user-level reads
  // ────────────────────────────────────────────────────────────────────────

  async getUserPositions(params) {
    const userAddress = await this.resolveAddress(params);
    const positions = await data.getUserPositions({
      userAddress,
      limit:  Number(params.limit)  || 50,
      offset: Number(params.offset) || 0,
    });
    return {
      success:   true,
      operation: 'GET_USER_POSITIONS',
      positions,
      count:     positions.length,
      data:      positions,
    };
  }

  async getUserPnL(params) {
    const userAddress = await this.resolveAddress(params);

    const [positions, value, closed] = await Promise.all([
      data.getUserPositions({ userAddress, limit: 500 }),
      data.getUserValue({ userAddress }).catch(() => null),
      data.getUserClosedPositions({ userAddress, limit: 500 }).catch(() => []),
    ]);

    // Compute realized P&L from closed positions where available
    const realizedPnl = closed.reduce((sum, p) => sum + (Number(p.realizedPnl ?? p.pnl ?? 0)), 0);

    // Compute unrealized P&L from open positions
    const unrealizedPnl = positions.reduce((sum, p) => {
      const cost = Number(p.initialValue ?? p.cost ?? 0);
      const cur  = Number(p.currentValue ?? p.value ?? 0);
      return sum + (cur - cost);
    }, 0);

    const totalValue = Number(value?.value ?? value?.user_value ?? positions.reduce((s, p) => s + Number(p.currentValue ?? p.value ?? 0), 0));

    return {
      success:       true,
      operation:     'GET_USER_PNL',
      totalValue,
      realizedPnl,
      unrealizedPnl,
      data: {
        userAddress,
        totalValue,
        realizedPnl,
        unrealizedPnl,
        openPositions:    positions.length,
        closedPositions:  closed.length,
      },
    };
  }

  async getUserActivity(params) {
    const userAddress = await this.resolveAddress(params);
    const activity = await data.getUserActivity({
      userAddress,
      limit:  Number(params.limit)  || 50,
      offset: Number(params.offset) || 0,
    });
    return {
      success:   true,
      operation: 'GET_USER_ACTIVITY',
      activity,
      count:     activity.length,
      data:      activity,
    };
  }

  async getLeaderboard(params) {
    const leaderboard = await data.getLeaderboard({
      window: params.leaderboardWindow || 'week',
      limit:  Number(params.limit) || 50,
    });
    return {
      success:   true,
      operation: 'GET_LEADERBOARD',
      leaderboard,
      count:     leaderboard.length,
      data:      leaderboard,
    };
  }

  async getUserTrades(params) {
    const userAddress = await this.resolveAddress(params);
    const trades = await data.getUserTrades({
      userAddress,
      limit: Number(params.limit) || 50,
    });
    return {
      success:   true,
      operation: 'GET_USER_TRADES',
      trades,
      count:     trades.length,
      data:      trades,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // CLOB — authenticated writes
  // ────────────────────────────────────────────────────────────────────────

  /**
   * One-time bootstrap: take the wallet private key from connected creds,
   * derive (or create) L2 API credentials, return them so the user can
   * paste them into the connection settings.
   */
  async deriveApiKey(params) {
    const creds = parseCreds(params);
    if (!creds.privateKey) {
      throw new Error('privateKey is required in your Polymarket connection settings.');
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(creds.privateKey)) {
      throw new Error('privateKey must be a 0x-prefixed 32-byte hex string.');
    }

    const signer = new ethers.Wallet(creds.privateKey);
    console.log(`[PolymarketPlugin] Deriving API key for ${signer.address}`);

    const apiCreds = await clobAuth.deriveOrCreateApiKey(signer);

    return {
      success:   true,
      operation: 'DERIVE_API_KEY',
      credentials: {
        apiKey:     apiCreds.apiKey,
        apiSecret:  apiCreds.secret,
        passphrase: apiCreds.passphrase,
      },
      data: {
        signerAddress: signer.address,
        message: 'Save these three values into your Polymarket connection (apiKey, apiSecret, passphrase). Trading operations will then work.',
        ...apiCreds,
      },
    };
  }

  async placeLimitOrder(params) {
    const creds = parseCreds(params);
    const { tokenId, price, size, side, orderType, expiration, tickSize, negRisk, maxNotional } = params;

    if (!tokenId)             throw new Error('tokenId is required');
    if (!price || price <= 0) throw new Error('price is required and must be > 0');
    if (!size  || size  <= 0) throw new Error('size is required and must be > 0');

    const cap = Number(maxNotional ?? 5);
    const notional = Number(price) * Number(size);
    if (notional > cap) {
      throw new Error(
        `Order notional $${notional.toFixed(2)} exceeds maxNotional cap $${cap.toFixed(2)}. ` +
        `Increase maxNotional in the workflow node parameters to allow larger orders.`
      );
    }

    console.log(`[PolymarketPlugin] Placing ${side} ${size}@${price} (${orderType || 'GTC'}) on token ${tokenId.slice(0, 10)}…`);

    const resp = await clobAuth.placeLimitOrder({
      creds,
      tokenId,
      price:      Number(price),
      size:       Number(size),
      side:       (side || 'BUY').toUpperCase(),
      orderType:  (orderType || 'GTC').toUpperCase(),
      expiration: expiration ? Number(expiration) : 0,
      tickSize:   tickSize || 'auto',
      negRisk:    negRisk  || 'auto',
    });

    return {
      success:   resp?.success !== false,
      operation: 'PLACE_LIMIT_ORDER',
      orderId:   resp?.orderID || resp?.orderId || null,
      status:    resp?.status  || 'unknown',
      filled:    Number(resp?.takingAmount ?? 0),
      data:      resp,
      error:     resp?.errorMsg || null,
    };
  }

  async placeMarketOrder(params) {
    const creds = parseCreds(params);
    const { tokenId, price, size, side, orderType, tickSize, negRisk, maxNotional } = params;

    if (!tokenId)             throw new Error('tokenId is required');
    if (!price || price <= 0) throw new Error('price (slippage cap) is required and must be > 0');
    if (!size  || size  <= 0) throw new Error('size is required and must be > 0');

    const sideUpper = (side || 'BUY').toUpperCase();
    // For BUY, size is USDC. For SELL, size is shares → notional ≈ size*price.
    const notional = sideUpper === 'BUY' ? Number(size) : Number(size) * Number(price);
    const cap = Number(maxNotional ?? 5);
    if (notional > cap) {
      throw new Error(
        `Order notional $${notional.toFixed(2)} exceeds maxNotional cap $${cap.toFixed(2)}.`
      );
    }

    console.log(`[PolymarketPlugin] Market ${sideUpper} ${size} @ ≤${price} (${orderType || 'FOK'}) on token ${tokenId.slice(0, 10)}…`);

    const resp = await clobAuth.placeMarketOrder({
      creds,
      tokenId,
      side:      sideUpper,
      size:      Number(size),
      price:     Number(price),
      orderType: (orderType || 'FOK').toUpperCase(),
      tickSize:  tickSize || 'auto',
      negRisk:   negRisk  || 'auto',
    });

    return {
      success:   resp?.success !== false,
      operation: 'PLACE_MARKET_ORDER',
      orderId:   resp?.orderID || resp?.orderId || null,
      status:    resp?.status  || 'unknown',
      filled:    Number(resp?.takingAmount ?? 0),
      data:      resp,
      error:     resp?.errorMsg || null,
    };
  }

  async getOpenOrders(params) {
    const creds = parseCreds(params);
    const orders = await clobAuth.getOpenOrders({
      creds,
      market: params.openOrdersMarket,
      limit:  Number(params.limit) || 50,
    });
    return {
      success:    true,
      operation:  'GET_OPEN_ORDERS',
      openOrders: orders,
      count:      orders.length,
      data:       orders,
    };
  }

  async cancelOrder(params) {
    const creds = parseCreds(params);
    const { orderId } = params;
    if (!orderId) throw new Error('orderId is required');

    const resp = await clobAuth.cancelOrder({ creds, orderId });
    return {
      success:   resp?.canceled?.length > 0 || resp?.success !== false,
      operation: 'CANCEL_ORDER',
      cancelled: resp?.canceled || resp?.cancelled || [orderId],
      status:    'cancelled',
      data:      resp,
    };
  }

  async cancelAllOrders(params) {
    const creds = parseCreds(params);
    const { tokenId } = params; // optional — scopes to one market

    const resp = await clobAuth.cancelAllOrders({ creds, tokenId });
    return {
      success:   true,
      operation: 'CANCEL_ALL_ORDERS',
      cancelled: resp?.canceled || resp?.cancelled || [],
      status:    'cancelled',
      data:      resp,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the user address: explicit param > funderAddress from creds.
   */
  async resolveAddress(params) {
    if (params.userAddress) return params.userAddress.trim();
    try {
      const creds = parseCreds(params, /* allowMissing */ true);
      if (creds?.funderAddress) return creds.funderAddress;
      if (creds?.privateKey)    return new ethers.Wallet(creds.privateKey).address;
    } catch { /* fall through */ }
    throw new Error(
      'userAddress is required for this operation, or connect a Polymarket wallet to use your funder address by default.'
    );
  }
}

// ─── Credential parsing ──────────────────────────────────────────────────

/**
 * Parse the credentials blob from `params.__auth?.token`.
 *
 * AGNT injects a single string. We support two formats:
 *   1. JSON object with all 6 fields (preferred)
 *   2. Raw private key string (privateKey only — limits which ops will work)
 */
function parseCreds(params, allowMissing = false) {
  const token = params.__auth?.token;
  if (!token) {
    if (allowMissing) return null;
    throw new Error(
      'Not connected to Polymarket. Connect in Settings → Connections and store ' +
      'a JSON blob with { privateKey, funderAddress, signatureType, apiKey, apiSecret, passphrase }.'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(token);
  } catch {
    // Raw private-key-only mode
    if (/^0x[0-9a-fA-F]{64}$/.test(token.trim())) {
      parsed = { privateKey: token.trim() };
    } else {
      throw new Error('Polymarket credentials must be a JSON object or a raw private key.');
    }
  }

  return {
    privateKey:     parsed.privateKey,
    funderAddress:  parsed.funderAddress || parsed.funder || null,
    signatureType:  parsed.signatureType || 'GNOSIS_SAFE',
    apiKey:         parsed.apiKey,
    apiSecret:      parsed.apiSecret || parsed.secret,
    passphrase:     parsed.passphrase,
  };
}

/**
 * Trim a Gamma market object down to the fields most useful for downstream nodes.
 */
function slimMarket(m) {
  if (!m || typeof m !== 'object') return m;
  return {
    id:               m.id,
    slug:             m.slug,
    question:         m.question,
    description:      m.description,
    outcomes:         safeJsonArray(m.outcomes),
    outcomePrices:    safeJsonArray(m.outcomePrices)?.map(Number),
    clobTokenIds:     safeJsonArray(m.clobTokenIds),
    conditionId:      m.conditionId,
    volume:           Number(m.volume) || 0,
    volume24hr:       Number(m.volume24hr) || 0,
    liquidity:        Number(m.liquidity) || 0,
    active:           Boolean(m.active),
    closed:           Boolean(m.closed),
    enableOrderBook:  Boolean(m.enableOrderBook),
    startDate:        m.startDate,
    endDate:          m.endDate,
    eventSlug:        m.event?.slug || m.eventSlug,
    image:            m.image,
    icon:             m.icon,
  };
}

function safeJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const arr = JSON.parse(v); return Array.isArray(arr) ? arr : null; } catch { return null; }
  }
  return null;
}

export default new PolymarketAPI();
