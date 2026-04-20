# Polymarket Plugin for AGNT

A unified workflow node that talks to all four Polymarket APIs from a single tool. Built for AGNT's plugin system.

> Polymarket is the world's largest prediction market. This plugin lets your workflows discover markets, read live orderbook data, monitor user positions and P&L, and place EIP-712 signed orders — all from one node.

---

## Features

- **One node, twenty operations** — pick the operation from a dropdown, the relevant inputs appear automatically.
- **All four Polymarket APIs covered:**
  - **Gamma** — events, markets, search, tags, trending discovery
  - **CLOB (public)** — orderbook, prices, midpoint, spread, price history
  - **CLOB (authenticated)** — derive API keys, place limit/market orders, cancel, list open orders
  - **Data** — positions, P&L, activity, trades, leaderboard
- **Native EIP-712 signing** — no Python dependency. Pure JavaScript, only `ethers@5.8.0`.
- **Built-in safety cap** — every order operation enforces a `maxNotional` USDC limit (default $5) so a misconfigured workflow can't drain your wallet.
- **Auto-resolves market params** — `tickSize` and `negRisk` default to `'auto'` and are fetched from the CLOB so you never get an `INVALID_ORDER_MIN_TICK_SIZE` error.

---

## Operations

| Operation | API | Auth | Purpose |
|---|---|---|---|
| `SEARCH_MARKETS` | Gamma | – | Search across markets/events/profiles by query or tag |
| `GET_MARKET` | Gamma | – | Fetch a market by ID, slug, or token ID (auto-detected) |
| `GET_EVENT` | Gamma | – | Fetch an event by ID or slug |
| `LIST_TRENDING` | Gamma | – | Filtered/sorted market discovery |
| `GET_ORDERBOOK` | CLOB | – | Bids + asks + midpoint + spread for a token |
| `GET_PRICE` | CLOB | – | Best bid or ask price |
| `GET_MIDPOINT` | CLOB | – | (best bid + best ask) / 2 |
| `GET_SPREAD` | CLOB | – | Bid-ask spread |
| `GET_PRICE_HISTORY` | CLOB | – | Time-series for charts/backtest |
| `GET_USER_POSITIONS` | Data | – | Current open positions for any wallet |
| `GET_USER_PNL` | Data | – | Realized + unrealized P&L + total value |
| `GET_USER_ACTIVITY` | Data | – | Activity log (trades, claims, deposits…) |
| `GET_USER_TRADES` | Data | – | Trades for a wallet |
| `GET_LEADERBOARD` | Data | – | Top traders by window |
| `DERIVE_API_KEY` | CLOB | wallet | One-time bootstrap to mint L2 credentials |
| `PLACE_LIMIT_ORDER` | CLOB | full | GTC/GTD limit (with `maxNotional` cap) |
| `PLACE_MARKET_ORDER` | CLOB | full | FOK/FAK market order with slippage cap |
| `GET_OPEN_ORDERS` | CLOB | full | Your resting orders |
| `CANCEL_ORDER` | CLOB | full | Cancel one order by ID |
| `CANCEL_ALL_ORDERS` | CLOB | full | Cancel all (or all-in-one-market) |

---

## Connecting Your Wallet

The plugin uses AGNT's `polymarket` auth provider. Store your credentials as a **JSON blob** in the connection's API-key field:

```json
{
  "privateKey":     "0xabc...",
  "funderAddress":  "0xYourPolymarketProxyAddress",
  "signatureType":  "GNOSIS_SAFE",
  "apiKey":         "",
  "apiSecret":      "",
  "passphrase":     ""
}
```

| Field | What it is |
|---|---|
| `privateKey` | Your wallet's private key (0x-prefixed, 64 hex chars). For Magic-Link / browser wallet Polymarket accounts, export it from your Polymarket settings. |
| `funderAddress` | The proxy wallet address shown on your Polymarket profile — **NOT** the EOA address derived from the private key (unless you use signatureType `EOA`). |
| `signatureType` | `GNOSIS_SAFE` (default — for browser wallets / Privy / Turnkey), `POLY_PROXY` (Magic Link email/Google), or `EOA` (standalone wallet). |
| `apiKey` / `apiSecret` / `passphrase` | Leave blank initially. Run the `DERIVE_API_KEY` operation once and paste the returned values back into the connection. |

### Bootstrap flow (one-time)

1. Connect Polymarket in Settings → Connections with the JSON above (apiKey/apiSecret/passphrase blank).
2. Build a one-step workflow with this node, set `operation` = `DERIVE_API_KEY`, and run it.
3. Copy `credentials.apiKey`, `credentials.apiSecret`, `credentials.passphrase` from the output.
4. Update your Polymarket connection JSON with those three values.
5. You can now run `PLACE_LIMIT_ORDER`, `CANCEL_ORDER`, etc.

> **Security:** `privateKey` never leaves your AGNT runtime. It is only loaded into memory when an operation needs to sign (order payloads or L1 derive).

---

## Example Workflows

### 1. Read-only research (no auth)

```
[ Trigger: cron 15m ]
       ↓
[ Polymarket: SEARCH_MARKETS, query="weather", tagSlug="weather" ]
       ↓
[ JS: filter to markets ending in <24h ]
       ↓
[ Polymarket: GET_ORDERBOOK, tokenId=<from above> ]
       ↓
[ Agent: analyze + summarize ]
       ↓
[ Slack / Email: alert ]
```

### 2. Algorithmic weather trader (full auth)

```
[ Trigger: cron 15m ]
       ↓
[ Polymarket: LIST_TRENDING, tagSlug="weather" ]
       ↓ (loop per market)
[ Visual Crossing API ]   [ Polymarket: GET_ORDERBOOK ]
              ↘                ↙
       [ Agent: forecast → fair price → edge ]
                     ↓
       [ JS: risk gate (confidence, drawdown) ]
                     ↓
       [ Polymarket: PLACE_LIMIT_ORDER, maxNotional=3 ]
                     ↓
       [ DB: INSERT INTO trades ]
```

---

## Architecture

```
polymarket-plugin/
├── manifest.json                 # AGNT plugin manifest with parameter conditionals
├── package.json                  # ESM, ethers@5.8.0 locked
├── README.md
├── polymarket-api.js             # Main entry — operation router
└── lib/
    ├── endpoints.js              # Base URLs + EIP-712 domain/type constants
    ├── http.js                   # fetch wrapper + qs helper
    ├── gamma.js                  # Gamma API (search, markets, events, trending)
    ├── dataApi.js                # Data API (positions, PnL, activity, leaderboard)
    ├── clobPublic.js             # CLOB public reads (book, price, midpoint, history)
    ├── signing.js                # L1 EIP-712 + L2 HMAC + order signing
    └── clobAuth.js               # Authenticated CLOB writes (orders, cancels)
```

---

## Implementation Notes

### EIP-712 order signing

The order payload is signed with the canonical Polymarket Exchange schema (12 fields: salt, maker, signer, taker, tokenId, makerAmount, takerAmount, expiration, nonce, feeRateBps, side, signatureType). Verifying contract is `0x4bFb…` for standard markets and `0xC5d5…` for neg-risk multi-outcome markets — the plugin auto-selects based on the market.

### HMAC L2 headers

Every authenticated request gets fresh `POLY_*` headers built from `(timestamp + METHOD + path + body)` HMAC-SHA256-signed with the base64url-decoded API secret, then re-encoded base64url. Matches the reference implementation in `@polymarket/clob-client-v2`.

### Geo-blocking

Polymarket blocks US IPs. The HTTP layer surfaces 451/403 responses with a clear message and a link to the geoblock docs.

### Error handling

Every operation returns `{ success, operation, ...payload, error }`. Errors never throw out of `execute()` — they're returned as `{ success: false, error: "…" }` so workflow conditionals can branch cleanly.

---

## References

- Polymarket API docs — <https://docs.polymarket.com/api-reference/introduction>
- CLOB authentication — <https://docs.polymarket.com/api-reference/authentication>
- Order creation — <https://docs.polymarket.com/trading/orders/create>
- Reference TS client — <https://github.com/Polymarket/clob-client-v2>
- Reference Python client — <https://github.com/Polymarket/py-clob-client-v2>
