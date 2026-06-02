import {
  Configuration,
  ExchangeApi,
  MarketsApi,
  PortfolioApi,
} from "kalshi-typescript";
import { createPluginModuleLogger } from "@phantasy/agent/plugin-runtime";
import crypto from "crypto";

const log = createPluginModuleLogger("KalshiService");

export interface KalshiServiceConfig {
  apiKey: string;
  privateKeyPem: string;
  environment?: "production" | "demo";
}

export interface ExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
  exchange_estimated_resume_time?: string | null;
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
  status: "open" | "closed" | "settled";
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface Balance {
  balance: number; // Account balance in cents
  portfolio_value: number; // Total portfolio value in cents (includes positions)
  updated_ts?: number; // Last update timestamp
  payout?: number; // Total payout in cents (computed field, may not exist in API)
  [key: string]: unknown;
}

export interface Position {
  ticker: string;
  position: number; // Number of contracts held (current position)
  total_traded?: number; // Total traded in cents
  total_traded_dollars?: string; // Total traded as dollar string
  market_exposure?: number; // Current market value in cents
  market_exposure_dollars?: string; // Market exposure as dollar string
  realized_pnl?: number; // Realized profit/loss in cents
  realized_pnl_dollars?: string; // Realized PnL as dollar string
  resting_orders_count?: number; // Number of resting orders
  fees_paid?: number; // Fees paid in cents
  fees_paid_dollars?: string; // Fees paid as dollar string
  last_updated_ts?: string; // ISO 8601 timestamp
  [key: string]: unknown;
}

export interface Order {
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  price: number;
  status: "resting" | "canceled" | "executed";
  created_time: string;
  [key: string]: unknown;
}

export interface CreateOrderParams {
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  price: number;
  type?: "market" | "limit";
}

/**
 * KalshiService provides a clean interface to the Kalshi prediction markets API
 * Wraps the official Kalshi TypeScript SDK with error handling and logging
 */
export class KalshiService {
  private config: KalshiServiceConfig;
  private exchangeApi!: ExchangeApi;
  private marketsApi!: MarketsApi;
  private portfolioApi!: PortfolioApi;
  private initialized = false;

  constructor(config: KalshiServiceConfig) {
    this.config = config;

    // Validate required credentials
    if (!config.apiKey) {
      throw new Error("Kalshi API key is required");
    }
    if (!config.privateKeyPem) {
      throw new Error("Private key PEM is required");
    }
  }

  /**
   * Validate and normalize private key PEM format
   * Converts PKCS#8 to PKCS#1 if needed (Kalshi SDK requires PKCS#1)
   * Fixes missing line breaks in the key
   */
  private validateAndNormalizePrivateKey(privateKeyPem: string): {
    valid: boolean;
    normalized?: string;
    error?: string;
  } {
    try {
      // Trim whitespace
      let key = privateKeyPem.trim();

      // Normalize line endings (CRLF -> LF)
      key = key.replace(/\r\n/g, "\n");

      // Check for encrypted key (not supported by SDK)
      if (key.includes("ENCRYPTED")) {
        return {
          valid: false,
          error:
            "Encrypted private keys are not supported. Please provide an unencrypted RSA private key.",
        };
      }

      // Check for valid PEM headers
      const hasPKCS1Header = key.includes("-----BEGIN RSA PRIVATE KEY-----");
      const hasPKCS8Header = key.includes("-----BEGIN PRIVATE KEY-----");

      if (!hasPKCS1Header && !hasPKCS8Header) {
        return {
          valid: false,
          error:
            'Private key must have valid PEM headers. Expected "-----BEGIN RSA PRIVATE KEY-----" or "-----BEGIN PRIVATE KEY-----"',
        };
      }

      // Check for valid PEM footers
      const hasPKCS1Footer = key.includes("-----END RSA PRIVATE KEY-----");
      const hasPKCS8Footer = key.includes("-----END PRIVATE KEY-----");

      if (!hasPKCS1Footer && !hasPKCS8Footer) {
        return {
          valid: false,
          error:
            'Private key must have valid PEM footers. Expected "-----END RSA PRIVATE KEY-----" or "-----END PRIVATE KEY-----"',
        };
      }

      // Fix missing line breaks in the key (common when copy-pasting)
      // PEM format requires newlines after header and every 64 chars of base64
      const header = hasPKCS1Header
        ? "-----BEGIN RSA PRIVATE KEY-----"
        : "-----BEGIN PRIVATE KEY-----";
      const footer = hasPKCS1Footer
        ? "-----END RSA PRIVATE KEY-----"
        : "-----END PRIVATE KEY-----";

      // Extract just the base64 content (remove header, footer, and all whitespace)
      let base64Content = key
        .replace(header, "")
        .replace(footer, "")
        .replace(/\s/g, "");

      // Split into 64-character lines
      const lines = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }

      // Reconstruct properly formatted key
      key = header + "\n" + lines.join("\n") + "\n" + footer + "\n";
      log.info("Normalized PEM formatting (added proper line breaks)");

      // If it's PKCS#8 format, convert to PKCS#1 (Kalshi SDK requires PKCS#1)
      if (hasPKCS8Header) {
        log.info("Converting PKCS#8 private key to PKCS#1 format");
        try {
          const keyObject = crypto.createPrivateKey({
            key: key,
            format: "pem",
            type: "pkcs8",
          });

          // Export as PKCS#1 (RSA private key format)
          const pkcs1Key = keyObject.export({
            format: "pem",
            type: "pkcs1",
          }) as string;

          log.info("Successfully converted PKCS#8 to PKCS#1");
          key = pkcs1Key;
        } catch (conversionError) {
          log.error("Failed to convert PKCS#8 to PKCS#1:", conversionError);
          return {
            valid: false,
            error: `Failed to convert PKCS#8 key to PKCS#1 format: ${conversionError instanceof Error ? conversionError.message : "Unknown error"}`,
          };
        }
      } else {
        log.info("Private key is already in PKCS#1 format");
      }

      return {
        valid: true,
        normalized: key,
      };
    } catch (error) {
      log.error("Error validating private key:", error);
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Initialize the Kalshi API clients with credentials
   */
  async initialize(): Promise<void> {
    try {
      // Validate and normalize private key
      const validation = this.validateAndNormalizePrivateKey(
        this.config.privateKeyPem,
      );
      if (!validation.valid) {
        throw new Error(`Private key validation failed: ${validation.error}`);
      }

      const privateKeyPem = validation.normalized!;
      log.info("Private key validated and normalized successfully");

      const basePath =
        this.config.environment === "demo"
          ? "https://demo-api.kalshi.com/trade-api/v2"
          : "https://api.elections.kalshi.com/trade-api/v2";

      log.info("Kalshi configuration:", {
        environment: this.config.environment || "production",
        basePath,
        keyFormat: "PKCS#1 PEM",
      });

      const configuration = new Configuration({
        apiKey: this.config.apiKey,
        privateKeyPem: privateKeyPem,
        basePath,
      });

      this.exchangeApi = new ExchangeApi(configuration);
      this.marketsApi = new MarketsApi(configuration);
      this.portfolioApi = new PortfolioApi(configuration);

      this.initialized = true;
      log.info("Kalshi API clients initialized successfully", {
        environment: this.config.environment || "production",
      });
    } catch (error) {
      log.error("Failed to initialize Kalshi API clients", error);

      // Provide more helpful error message for decoder errors
      if (error instanceof Error && error.message.includes("DECODER")) {
        throw new Error(
          `Private key format error: The RSA private key could not be decoded. ` +
            `Please ensure your private key is in PEM format (PKCS#1 or PKCS#8), ` +
            `not encrypted, and has proper headers/footers. ` +
            `Original error: ${error.message}`,
        );
      }

      throw new Error(
        `Kalshi initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Ensures the service is initialized before making API calls
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "KalshiService not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Get the current operational status of the Kalshi exchange
   */
  async getExchangeStatus(): Promise<ExchangeStatus> {
    this.ensureInitialized();

    try {
      const response = await this.exchangeApi.getExchangeStatus();
      return response.data as ExchangeStatus;
    } catch (error) {
      log.error("Failed to get exchange status", error);
      throw new Error(
        `Failed to get exchange status: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Search for markets with optional filters
   */
  async searchMarkets(params: {
    ticker?: string;
    event_ticker?: string;
    series_ticker?: string;
    status?: "open" | "closed" | "settled";
    limit?: number;
  }): Promise<Market[]> {
    this.ensureInitialized();

    try {
      const response = await this.marketsApi.getMarkets(
        params.limit || 20,
        undefined, // cursor
        params.event_ticker,
        params.series_ticker,
        undefined, // maxCloseTs
        undefined, // minCloseTs
        params.status,
        params.ticker, // tickers
      );

      return (response.data.markets || []) as Market[];
    } catch (error) {
      log.error("Failed to search markets", { params, error });
      throw new Error(
        `Failed to search markets: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get detailed information about a specific market
   */
  async getMarket(ticker: string): Promise<Market> {
    this.ensureInitialized();

    try {
      const response = await this.marketsApi.getMarket(ticker);
      return response.data.market as Market;
    } catch (error) {
      log.error("Failed to get market", { ticker, error });
      throw new Error(
        `Failed to get market ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get the current balance of the portfolio
   */
  async getBalance(): Promise<Balance> {
    this.ensureInitialized();

    try {
      log.info("Calling Kalshi API: getBalance");
      const response = await this.portfolioApi.getBalance();
      log.info("Kalshi API getBalance successful");
      return response.data as Balance;
    } catch (error) {
      log.error("Failed to get balance - Full error details:", {
        error,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get current positions in the portfolio
   */
  async getPositions(params: {
    ticker?: string;
    event_ticker?: string;
  }): Promise<Position[]> {
    this.ensureInitialized();

    try {
      const response = await this.portfolioApi.getPositions(
        params.ticker,
        params.event_ticker,
      );

      const responseData = response.data as Record<string, unknown>;
      log.info("Kalshi getPositions raw response:", {
        responseData: response.data,
        responseDataKeys: Object.keys(response.data || {}),
        hasMarketPositions: !!responseData.market_positions,
        marketPositionsLength: (Array.isArray(responseData.market_positions) ? responseData.market_positions : [])
          .length,
        hasEventPositions: !!responseData.event_positions,
        eventPositionsLength: (Array.isArray(responseData.event_positions) ? responseData.event_positions : [])
          .length,
      });

      // Kalshi API returns positions in 'market_positions' field
      const marketPositions = (Array.isArray(responseData.market_positions) ? responseData.market_positions : []);
      log.info(
        `Kalshi getPositions returning ${marketPositions.length} market positions`,
      );
      return marketPositions as Position[];
    } catch (error) {
      log.error("Failed to get positions", { params, error });
      throw new Error(
        `Failed to get positions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get orders from the portfolio
   */
  async getOrders(params: {
    ticker?: string;
    status?: "resting" | "canceled" | "executed";
  }): Promise<Order[]> {
    this.ensureInitialized();

    try {
      const response = await this.portfolioApi.getOrders(
        params.ticker,
        undefined, // eventTicker
        undefined, // limit
        undefined, // cursor
        params.status,
      );

      return (response.data.orders || []) as Order[];
    } catch (error) {
      log.error("Failed to get orders", { params, error });
      throw new Error(
        `Failed to get orders: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Create a new order on a market
   */
  async createOrder(params: CreateOrderParams): Promise<Order> {
    this.ensureInitialized();

    try {
      // Validate price range (1-99 cents)
      if (params.price < 1 || params.price > 99) {
        throw new Error("Price must be between 1 and 99 cents");
      }

      // Validate count
      if (params.count < 1) {
        throw new Error("Count must be at least 1");
      }

      const response = await this.portfolioApi.createOrder({
        ticker: params.ticker,
        client_order_id: `order_${Date.now()}`,
        side: params.side,
        action: params.action,
        count: params.count,
        type: params.type || "limit",
        yes_price: params.side === "yes" ? params.price : undefined,
        no_price: params.side === "no" ? params.price : undefined,
      });

      log.info("Order created successfully", {
        ticker: params.ticker,
        side: params.side,
        action: params.action,
        count: params.count,
        price: params.price,
      });

      return response.data.order as Order;
    } catch (error) {
      log.error("Failed to create order", { params, error });
      throw new Error(
        `Failed to create order: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    this.ensureInitialized();

    try {
      await this.portfolioApi.cancelOrder(orderId);

      log.info("Order canceled successfully", { orderId });

      return { success: true };
    } catch (error) {
      log.error("Failed to cancel order", { orderId, error });
      throw new Error(
        `Failed to cancel order ${orderId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get the order book for a market
   */
  async getOrderbook(ticker: string, depth?: number): Promise<unknown> {
    this.ensureInitialized();

    try {
      const response = await this.marketsApi.getMarketOrderbook(
        ticker,
        depth || 10,
      );

      return response;
    } catch (error) {
      log.error("Failed to get orderbook", { ticker, error });
      throw new Error(
        `Failed to get orderbook for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get recent trades for a market
   */
  async getTrades(ticker: string, limit?: number): Promise<unknown> {
    this.ensureInitialized();

    try {
      const response = await this.marketsApi.getTrades(
        limit || 100,
        undefined, // cursor
        ticker,
      );

      return response.data.trades || [];
    } catch (error) {
      log.error("Failed to get trades", { ticker, error });
      throw new Error(
        `Failed to get trades for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
