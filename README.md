# @phantasy/plugin-kalshi

Kalshi prediction-market integration for Phantasy.

## Features

- Exchange status
- Market search / detail / order book / trades
- Portfolio balance and positions
- Order list, gated create (V2 book-side API), and cancel
- Demo or production environment

## Install

```bash
phantasy extensions install plugin kalshi
# or
npm install @phantasy/plugin-kalshi
```

## Configuration

| Key | Env | Description |
| --- | --- | --- |
| `apiKey` | `KALSHI_API_KEY` | API key id from Kalshi developer console |
| `privateKeyPem` | `KALSHI_PRIVATE_KEY_PEM` | Unencrypted RSA private key PEM |
| `environment` | `KALSHI_ENVIRONMENT` | `demo` (default) or `production` |
| `allowTrading` | `KALSHI_ALLOW_TRADING` | Must be `true` to place/cancel orders |

## Agent tools

- `kalshi_status`
- `kalshi_search_markets`
- `kalshi_get_market`
- `kalshi_get_balance`
- `kalshi_get_positions`
- `kalshi_get_orders`
- `kalshi_create_order` (requires `allowTrading`)
- `kalshi_cancel_order` (requires `allowTrading`)
- `kalshi_get_orderbook`

Orders accept legacy `side` (`yes`/`no`) + `action` (`buy`/`sell`) + price in **cents** (1–99). The service maps these to Kalshi Trade API V2 YES-book `bid`/`ask` + dollar fixed-point prices.

## Safety

Trading is off by default. Use demo credentials first. Never commit private keys.

## Presets

See Phantasy presets: `prediction-markets`, `kalshi-trader`.

## Allow trading (Admin UI)

1. Open **Admin → Plugins** (or **Business → Kalshi/Polymarket** tab).
2. Toggle **Allow trading** on or off.
3. Click **Save**.

Plugin form values override env defaults. No restart required.
