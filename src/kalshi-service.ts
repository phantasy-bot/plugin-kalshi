import {
  Configuration,
  ExchangeApi,
  MarketApi,
  OrdersApi,
  PortfolioApi,
  type CreateOrderV2Request,
} from "kalshi-typescript";
import crypto from "crypto";

/** Local logger so unit tests need no @phantasy/agent install. */
const log = {
  debug: (..._args: unknown[]) => undefined,
  info: (..._args: unknown[]) => undefined,
  warn: (..._args: unknown[]) => undefined,
  error: (..._args: unknown[]) => undefined,
};

export interface KalshiServiceConfig {
  apiKey: string;
  privateKeyPem: string;
  environment?: "production" | "demo";
}

export interface ExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
  exchange_estimated_resume_time?: string | null;
  [key: string]: unknown;
}

export interface Market {
  ticker: string;
  event_ticker: string;
  series_ticker?: string;
  title: string;
  subtitle?: string;
  open_time: string;
  close_time: string;
  expiration_time: string;
  status: "open" | "closed" | "settled" | string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface Balance {
  balance: number;
  portfolio_value: number;
  updated_ts?: number;
  balance_dollars?: string;
  [key: string]: unknown;
}

export interface Position {
  ticker: string;
  /** Fixed-point contract count when available (SDK v3). */
  position_fp?: string;
  /** Numeric position when present (legacy). */
  position?: number;
  total_traded?: number;
  total_traded_dollars?: string;
  market_exposure?: number;
  market_exposure_dollars?: string;
  realized_pnl?: number;
  realized_pnl_dollars?: string;
  resting_orders_count?: number;
  last_updated_ts?: string;
  [key: string]: unknown;
}

export interface Order {
  order_id: string;
  ticker: string;
  side?: "yes" | "no" | string;
  action?: "buy" | "sell" | string;
  book_side?: "bid" | "ask" | string;
  outcome_side?: "yes" | "no" | string;
  count?: number;
  price?: number;
  status: string;
  created_time?: string;
  [key: string]: unknown;
}

export interface CreateOrderParams {
  ticker: string;
  /** Outcome side (yes/no). Mapped to Kalshi V2 book_side. */
  side: "yes" | "no";
  action: "buy" | "sell";
  /** Whole contracts (converted to fixed-point count string). */
  count: number;
  /** Limit price in cents (1–99). Converted to dollar fixed-point for V2. */
  price: number;
  type?: "market" | "limit";
}

export interface CreateOrderResult {
  order_id: string;
  client_order_id?: string;
  fill_count?: string;
  remaining_count?: string;
  average_fill_price?: string;
  ts_ms?: number;
  request: {
    book_side: "bid" | "ask";
    price_dollars: string;
    count: string;
  };
  [key: string]: unknown;
}

/**
 * Map legacy yes/no + buy/sell + cents into Kalshi V2 YES-book side + dollars.
 * V2 quotes everything from the YES book: bid = buy YES, ask = sell YES.
 */
export function mapLegacyOrderToV2(params: CreateOrderParams): {
  bookSide: "bid" | "ask";
  priceDollars: string;
  count: string;
  timeInForce: "good_till_canceled" | "immediate_or_cancel" | "fill_or_kill";
} {
  if (params.price < 1 || params.price > 99) {
    throw new Error("Price must be between 1 and 99 cents");
  }
  if (params.count < 1) {
    throw new Error("Count must be at least 1");
  }

  let yesCents = params.price;
  let bookSide: "bid" | "ask";

  if (params.side === "yes") {
    bookSide = params.action === "buy" ? "bid" : "ask";
  } else {
    // buy NO @ p¢ ≡ sell YES @ (100-p)¢; sell NO @ p¢ ≡ buy YES @ (100-p)¢
    yesCents = 100 - params.price;
    bookSide = params.action === "buy" ? "ask" : "bid";
  }

  const priceDollars = (yesCents / 100).toFixed(2);
  const count = Number.isInteger(params.count)
    ? `${params.count}.00`
    : params.count.toFixed(2);

  const timeInForce =
    params.type === "market" ? "immediate_or_cancel" : "good_till_canceled";

  return { bookSide, priceDollars, count, timeInForce };
}

/**
 * KalshiService wraps kalshi-typescript v3 (MarketApi / OrdersApi / PortfolioApi).
 */
export class KalshiService {
  private config: KalshiServiceConfig;
  private exchangeApi!: ExchangeApi;
  private marketApi!: MarketApi;
  private ordersApi!: OrdersApi;
  private portfolioApi!: PortfolioApi;
  private initialized = false;

  constructor(config: KalshiServiceConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error("Kalshi API key is required");
    }
    if (!config.privateKeyPem) {
      throw new Error("Private key PEM is required");
    }
  }

  private validateAndNormalizePrivateKey(privateKeyPem: string): {
    valid: boolean;
    normalized?: string;
    error?: string;
  } {
    try {
      let key = privateKeyPem.trim().replace(/\r\n/g, "\n");

      if (key.includes("ENCRYPTED")) {
        return {
          valid: false,
          error:
            "Encrypted private keys are not supported. Provide an unencrypted RSA private key.",
        };
      }

      const hasPKCS1Header = key.includes("-----BEGIN RSA PRIVATE KEY-----");
      const hasPKCS8Header = key.includes("-----BEGIN PRIVATE KEY-----");
      if (!hasPKCS1Header && !hasPKCS8Header) {
        return {
          valid: false,
          error:
            'Private key must have valid PEM headers (RSA PRIVATE KEY or PRIVATE KEY).',
        };
      }

      const hasPKCS1Footer = key.includes("-----END RSA PRIVATE KEY-----");
      const hasPKCS8Footer = key.includes("-----END PRIVATE KEY-----");
      if (!hasPKCS1Footer && !hasPKCS8Footer) {
        return {
          valid: false,
          error: "Private key must have valid PEM footers.",
        };
      }

      const header = hasPKCS1Header
        ? "-----BEGIN RSA PRIVATE KEY-----"
        : "-----BEGIN PRIVATE KEY-----";
      const footer = hasPKCS1Footer
        ? "-----END RSA PRIVATE KEY-----"
        : "-----END PRIVATE KEY-----";

      const base64Content = key
        .replace(header, "")
        .replace(footer, "")
        .replace(/\s/g, "");

      const lines: string[] = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }
      key = `${header}\n${lines.join("\n")}\n${footer}\n`;

      if (hasPKCS8Header) {
        try {
          const keyObject = crypto.createPrivateKey({
            key,
            format: "pem",
            type: "pkcs8",
          });
          key = keyObject.export({ format: "pem", type: "pkcs1" }) as string;
        } catch (conversionError) {
          return {
            valid: false,
            error: `Failed to convert PKCS#8 to PKCS#1: ${
              conversionError instanceof Error
                ? conversionError.message
                : "Unknown error"
            }`,
          };
        }
      }

      return { valid: true, normalized: key };
    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  async initialize(): Promise<void> {
    try {
      const validation = this.validateAndNormalizePrivateKey(
        this.config.privateKeyPem,
      );
      if (!validation.valid) {
        throw new Error(`Private key validation failed: ${validation.error}`);
      }

      const privateKeyPem = validation.normalized!;
      const basePath =
        this.config.environment === "demo"
          ? "https://demo-api.kalshi.com/trade-api/v2"
          : "https://api.elections.kalshi.com/trade-api/v2";

      log.info("Kalshi configuration", {
        environment: this.config.environment || "production",
        basePath,
      });

      const configuration = new Configuration({
        apiKey: this.config.apiKey,
        privateKeyPem,
        basePath,
      });

      this.exchangeApi = new ExchangeApi(configuration);
      this.marketApi = new MarketApi(configuration);
      this.ordersApi = new OrdersApi(configuration);
      this.portfolioApi = new PortfolioApi(configuration);

      this.initialized = true;
      log.info("Kalshi API clients initialized", {
        environment: this.config.environment || "production",
      });
    } catch (error) {
      log.error("Failed to initialize Kalshi API clients", error);
      if (error instanceof Error && error.message.includes("DECODER")) {
        throw new Error(
          `Private key format error: ensure unencrypted PEM (PKCS#1 or PKCS#8). Original: ${error.message}`,
        );
      }
      throw new Error(
        `Kalshi initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "KalshiService not initialized. Call initialize() first.",
      );
    }
  }

  async getExchangeStatus(): Promise<ExchangeStatus> {
    this.ensureInitialized();
    try {
      const response = await this.exchangeApi.getExchangeStatus();
      return response.data as ExchangeStatus;
    } catch (error) {
      log.error("Failed to get exchange status", error);
      throw new Error(
        `Failed to get exchange status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async searchMarkets(params: {
    ticker?: string;
    event_ticker?: string;
    series_ticker?: string;
    status?: "open" | "closed" | "settled" | string;
    limit?: number;
  }): Promise<Market[]> {
    this.ensureInitialized();
    try {
      // getMarkets(limit, cursor, eventTicker, seriesTicker, minCreatedTs,
      //   maxCreatedTs, minUpdatedTs, maxCloseTs, minCloseTs, minSettledTs,
      //   maxSettledTs, status, tickers, mveFilter)
      const response = await this.marketApi.getMarkets(
        params.limit || 20,
        undefined,
        params.event_ticker,
        params.series_ticker,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        params.status as
          | "unopened"
          | "open"
          | "closed"
          | "settled"
          | undefined,
        params.ticker,
      );
      return (response.data.markets || []) as unknown as Market[];
    } catch (error) {
      log.error("Failed to search markets", { params, error });
      throw new Error(
        `Failed to search markets: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getMarket(ticker: string): Promise<Market> {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getMarket(ticker);
      return response.data.market as unknown as Market;
    } catch (error) {
      log.error("Failed to get market", { ticker, error });
      throw new Error(
        `Failed to get market ${ticker}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getBalance(): Promise<Balance> {
    this.ensureInitialized();
    try {
      const response = await this.portfolioApi.getBalance();
      return response.data as Balance;
    } catch (error) {
      log.error("Failed to get balance", error);
      throw new Error(
        `Failed to get balance: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getPositions(params: {
    ticker?: string;
    event_ticker?: string;
  }): Promise<Position[]> {
    this.ensureInitialized();
    try {
      // getPositions(cursor, limit, countFilter, ticker, eventTicker, subaccount)
      const response = await this.portfolioApi.getPositions(
        undefined,
        100,
        undefined,
        params.ticker,
        params.event_ticker,
      );
      const marketPositions = response.data.market_positions || [];
      return marketPositions as unknown as Position[];
    } catch (error) {
      log.error("Failed to get positions", { params, error });
      throw new Error(
        `Failed to get positions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getOrders(params: {
    ticker?: string;
    status?: "resting" | "canceled" | "executed" | string;
  }): Promise<Order[]> {
    this.ensureInitialized();
    try {
      // getOrders(ticker, eventTicker, minTs, maxTs, status, limit, cursor, subaccount)
      const response = await this.ordersApi.getOrders(
        params.ticker,
        undefined,
        undefined,
        undefined,
        params.status,
        100,
      );
      return (response.data.orders || []) as unknown as Order[];
    } catch (error) {
      log.error("Failed to get orders", { params, error });
      throw new Error(
        `Failed to get orders: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    this.ensureInitialized();
    try {
      const mapped = mapLegacyOrderToV2(params);
      const body: CreateOrderV2Request = {
        ticker: params.ticker,
        client_order_id: `order_${Date.now()}`,
        side: mapped.bookSide,
        count: mapped.count,
        price: mapped.priceDollars,
        time_in_force: mapped.timeInForce,
        self_trade_prevention_type: "taker_at_cross",
      };

      const response = await this.ordersApi.createOrderV2(body);
      log.info("Order created", {
        ticker: params.ticker,
        bookSide: mapped.bookSide,
        price: mapped.priceDollars,
        count: mapped.count,
      });

      return {
        ...response.data,
        request: {
          book_side: mapped.bookSide,
          price_dollars: mapped.priceDollars,
          count: mapped.count,
        },
      };
    } catch (error) {
      log.error("Failed to create order", { params, error });
      throw new Error(
        `Failed to create order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async cancelOrder(orderId: string): Promise<{
    success: boolean;
    order_id?: string;
    reduced_by?: string;
  }> {
    this.ensureInitialized();
    try {
      const response = await this.ordersApi.cancelOrderV2(orderId);
      log.info("Order canceled", { orderId });
      return {
        success: true,
        order_id: response.data.order_id,
        reduced_by: response.data.reduced_by,
      };
    } catch (error) {
      log.error("Failed to cancel order", { orderId, error });
      throw new Error(
        `Failed to cancel order ${orderId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getOrderbook(ticker: string, depth?: number): Promise<unknown> {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getMarketOrderbook(
        ticker,
        depth || 10,
      );
      return response.data;
    } catch (error) {
      log.error("Failed to get orderbook", { ticker, error });
      throw new Error(
        `Failed to get orderbook for ${ticker}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async getTrades(ticker: string, limit?: number): Promise<unknown> {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getTrades(
        limit || 100,
        undefined,
        ticker,
      );
      return response.data.trades || [];
    } catch (error) {
      log.error("Failed to get trades", { ticker, error });
      throw new Error(
        `Failed to get trades for ${ticker}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }
}
