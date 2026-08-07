// src/kalshi-plugin.ts
import {
  BasePlugin
} from "@phantasy/agent/plugins";
import { createPluginModuleLogger } from "@phantasy/agent/plugin-runtime";

// src/config-resolve.ts
function resolveAllowTrading(configValue, envValue) {
  if (typeof configValue === "boolean") return configValue;
  if (configValue === "true" || configValue === "1") return true;
  if (configValue === "false" || configValue === "0") return false;
  return envValue === "true" || envValue === "1";
}

// src/kalshi-service.ts
import {
  Configuration,
  ExchangeApi,
  MarketApi,
  OrdersApi,
  PortfolioApi
} from "kalshi-typescript";
import crypto from "crypto";
var log = {
  debug: (..._args) => void 0,
  info: (..._args) => void 0,
  warn: (..._args) => void 0,
  error: (..._args) => void 0
};
function mapLegacyOrderToV2(params) {
  if (params.price < 1 || params.price > 99) {
    throw new Error("Price must be between 1 and 99 cents");
  }
  if (params.count < 1) {
    throw new Error("Count must be at least 1");
  }
  let yesCents = params.price;
  let bookSide;
  if (params.side === "yes") {
    bookSide = params.action === "buy" ? "bid" : "ask";
  } else {
    yesCents = 100 - params.price;
    bookSide = params.action === "buy" ? "ask" : "bid";
  }
  const priceDollars = (yesCents / 100).toFixed(2);
  const count = Number.isInteger(params.count) ? `${params.count}.00` : params.count.toFixed(2);
  const timeInForce = params.type === "market" ? "immediate_or_cancel" : "good_till_canceled";
  return { bookSide, priceDollars, count, timeInForce };
}
var KalshiService = class {
  config;
  exchangeApi;
  marketApi;
  ordersApi;
  portfolioApi;
  initialized = false;
  constructor(config) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error("Kalshi API key is required");
    }
    if (!config.privateKeyPem) {
      throw new Error("Private key PEM is required");
    }
  }
  validateAndNormalizePrivateKey(privateKeyPem) {
    try {
      let key = privateKeyPem.trim().replace(/\r\n/g, "\n");
      if (key.includes("ENCRYPTED")) {
        return {
          valid: false,
          error: "Encrypted private keys are not supported. Provide an unencrypted RSA private key."
        };
      }
      const hasPKCS1Header = key.includes("-----BEGIN RSA PRIVATE KEY-----");
      const hasPKCS8Header = key.includes("-----BEGIN PRIVATE KEY-----");
      if (!hasPKCS1Header && !hasPKCS8Header) {
        return {
          valid: false,
          error: "Private key must have valid PEM headers (RSA PRIVATE KEY or PRIVATE KEY)."
        };
      }
      const hasPKCS1Footer = key.includes("-----END RSA PRIVATE KEY-----");
      const hasPKCS8Footer = key.includes("-----END PRIVATE KEY-----");
      if (!hasPKCS1Footer && !hasPKCS8Footer) {
        return {
          valid: false,
          error: "Private key must have valid PEM footers."
        };
      }
      const header = hasPKCS1Header ? "-----BEGIN RSA PRIVATE KEY-----" : "-----BEGIN PRIVATE KEY-----";
      const footer = hasPKCS1Footer ? "-----END RSA PRIVATE KEY-----" : "-----END PRIVATE KEY-----";
      const base64Content = key.replace(header, "").replace(footer, "").replace(/\s/g, "");
      const lines = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }
      key = `${header}
${lines.join("\n")}
${footer}
`;
      if (hasPKCS8Header) {
        try {
          const keyObject = crypto.createPrivateKey({
            key,
            format: "pem",
            type: "pkcs8"
          });
          key = keyObject.export({ format: "pem", type: "pkcs1" });
        } catch (conversionError) {
          return {
            valid: false,
            error: `Failed to convert PKCS#8 to PKCS#1: ${conversionError instanceof Error ? conversionError.message : "Unknown error"}`
          };
        }
      }
      return { valid: true, normalized: key };
    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  async initialize() {
    try {
      const validation = this.validateAndNormalizePrivateKey(
        this.config.privateKeyPem
      );
      if (!validation.valid) {
        throw new Error(`Private key validation failed: ${validation.error}`);
      }
      const privateKeyPem = validation.normalized;
      const basePath = this.config.environment === "demo" ? "https://demo-api.kalshi.com/trade-api/v2" : "https://api.elections.kalshi.com/trade-api/v2";
      log.info("Kalshi configuration", {
        environment: this.config.environment || "production",
        basePath
      });
      const configuration = new Configuration({
        apiKey: this.config.apiKey,
        privateKeyPem,
        basePath
      });
      this.exchangeApi = new ExchangeApi(configuration);
      this.marketApi = new MarketApi(configuration);
      this.ordersApi = new OrdersApi(configuration);
      this.portfolioApi = new PortfolioApi(configuration);
      this.initialized = true;
      log.info("Kalshi API clients initialized", {
        environment: this.config.environment || "production"
      });
    } catch (error) {
      log.error("Failed to initialize Kalshi API clients", error);
      if (error instanceof Error && error.message.includes("DECODER")) {
        throw new Error(
          `Private key format error: ensure unencrypted PEM (PKCS#1 or PKCS#8). Original: ${error.message}`
        );
      }
      throw new Error(
        `Kalshi initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "KalshiService not initialized. Call initialize() first."
      );
    }
  }
  async getExchangeStatus() {
    this.ensureInitialized();
    try {
      const response = await this.exchangeApi.getExchangeStatus();
      return response.data;
    } catch (error) {
      log.error("Failed to get exchange status", error);
      throw new Error(
        `Failed to get exchange status: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async searchMarkets(params) {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getMarkets(
        params.limit || 20,
        void 0,
        params.event_ticker,
        params.series_ticker,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        params.status,
        params.ticker
      );
      return response.data.markets || [];
    } catch (error) {
      log.error("Failed to search markets", { params, error });
      throw new Error(
        `Failed to search markets: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getMarket(ticker) {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getMarket(ticker);
      return response.data.market;
    } catch (error) {
      log.error("Failed to get market", { ticker, error });
      throw new Error(
        `Failed to get market ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getBalance() {
    this.ensureInitialized();
    try {
      const response = await this.portfolioApi.getBalance();
      return response.data;
    } catch (error) {
      log.error("Failed to get balance", error);
      throw new Error(
        `Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getPositions(params) {
    this.ensureInitialized();
    try {
      const response = await this.portfolioApi.getPositions(
        void 0,
        100,
        void 0,
        params.ticker,
        params.event_ticker
      );
      const marketPositions = response.data.market_positions || [];
      return marketPositions;
    } catch (error) {
      log.error("Failed to get positions", { params, error });
      throw new Error(
        `Failed to get positions: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getOrders(params) {
    this.ensureInitialized();
    try {
      const response = await this.ordersApi.getOrders(
        params.ticker,
        void 0,
        void 0,
        void 0,
        params.status,
        100
      );
      return response.data.orders || [];
    } catch (error) {
      log.error("Failed to get orders", { params, error });
      throw new Error(
        `Failed to get orders: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async createOrder(params) {
    this.ensureInitialized();
    try {
      const mapped = mapLegacyOrderToV2(params);
      const body = {
        ticker: params.ticker,
        client_order_id: `order_${Date.now()}`,
        side: mapped.bookSide,
        count: mapped.count,
        price: mapped.priceDollars,
        time_in_force: mapped.timeInForce,
        self_trade_prevention_type: "taker_at_cross"
      };
      const response = await this.ordersApi.createOrderV2(body);
      log.info("Order created", {
        ticker: params.ticker,
        bookSide: mapped.bookSide,
        price: mapped.priceDollars,
        count: mapped.count
      });
      return {
        ...response.data,
        request: {
          book_side: mapped.bookSide,
          price_dollars: mapped.priceDollars,
          count: mapped.count
        }
      };
    } catch (error) {
      log.error("Failed to create order", { params, error });
      throw new Error(
        `Failed to create order: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async cancelOrder(orderId) {
    this.ensureInitialized();
    try {
      const response = await this.ordersApi.cancelOrderV2(orderId);
      log.info("Order canceled", { orderId });
      return {
        success: true,
        order_id: response.data.order_id,
        reduced_by: response.data.reduced_by
      };
    } catch (error) {
      log.error("Failed to cancel order", { orderId, error });
      throw new Error(
        `Failed to cancel order ${orderId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getOrderbook(ticker, depth) {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getMarketOrderbook(
        ticker,
        depth || 10
      );
      return response.data;
    } catch (error) {
      log.error("Failed to get orderbook", { ticker, error });
      throw new Error(
        `Failed to get orderbook for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  async getTrades(ticker, limit) {
    this.ensureInitialized();
    try {
      const response = await this.marketApi.getTrades(
        limit || 100,
        void 0,
        ticker
      );
      return response.data.trades || [];
    } catch (error) {
      log.error("Failed to get trades", { ticker, error });
      throw new Error(
        `Failed to get trades for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
};

// src/kalshi-plugin.ts
var log2 = createPluginModuleLogger("KalshiPlugin");
function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : void 0;
  }
  return void 0;
}
var KalshiPlugin = class extends BasePlugin {
  name = "kalshi";
  version = "0.2.1-beta";
  description = "Kalshi prediction markets: search, prices, portfolio, and gated order placement.";
  displayName = "Kalshi";
  category = "markets";
  tags = ["kalshi", "prediction-markets", "trading", "finance"];
  permissions = ["internet"];
  workspace = "business";
  extensionKind = "integration";
  dataRetention = {
    stores: [
      {
        name: "agent_configs.kalshiConfig",
        kind: "config",
        description: "Kalshi API environment and operator configuration.",
        erasable: false
      }
    ],
    dataCategories: [
      "prediction market account metadata",
      "market orders",
      "positions",
      "financial activity"
    ],
    externalServices: ["Kalshi API"],
    retentionDefault: "persist",
    erasable: false
  };
  adminSurface = {
    tabId: "kalshi",
    label: "Kalshi",
    workspace: "business",
    kind: "generic",
    advancedModule: "prediction-markets",
    keywords: ["kalshi", "prediction markets", "finance", "allow trading"]
  };
  configSchema = {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        default: true,
        title: "Enabled",
        description: "Load Kalshi tools and admin surface."
      },
      allowTrading: {
        type: "boolean",
        default: false,
        title: "Allow trading",
        description: "When on, order tools may place and cancel live orders. Toggle anytime in this plugin form \u2014 no restart required. Leave off for research-only agents. Prefer demo environment until you intend real risk."
      },
      environment: {
        type: "string",
        enum: ["demo", "production"],
        default: "demo",
        title: "Environment",
        description: "Use demo for practice; production places real orders when trading is allowed."
      },
      apiKey: {
        type: "string",
        title: "API key ID",
        description: "Kalshi API key id from the developer console. Can also be set via env for bootstrap only.",
        format: "password"
      },
      privateKeyPem: {
        type: "string",
        title: "RSA private key (PEM)",
        description: "Unencrypted RSA private key PEM paired with the API key. Paste here in Admin \u2192 Plugins \u2192 Kalshi, or bootstrap via KALSHI_PRIVATE_KEY_PEM.",
        format: "pem"
      }
    }
  };
  service = null;
  initError = null;
  credentials() {
    const cfg = this.getConfig();
    const envFromConfig = str(cfg.environment);
    const environment = envFromConfig === "production" || envFromConfig === "demo" ? envFromConfig : process.env.KALSHI_ENVIRONMENT === "production" ? "production" : "demo";
    return {
      apiKey: str(cfg.apiKey) || process.env.KALSHI_API_KEY,
      privateKeyPem: str(cfg.privateKeyPem) || process.env.KALSHI_PRIVATE_KEY_PEM || process.env.KALSHI_PRIVATE_KEY,
      environment,
      allowTrading: resolveAllowTrading(
        cfg.allowTrading,
        process.env.KALSHI_ALLOW_TRADING
      )
    };
  }
  async ensureService() {
    if (this.service) return this.service;
    const creds = this.credentials();
    if (!creds.apiKey || !creds.privateKeyPem) {
      throw new Error(
        "Kalshi credentials missing. Set API key + RSA private key in Admin \u2192 Plugins \u2192 Kalshi (or bootstrap with KALSHI_API_KEY + KALSHI_PRIVATE_KEY_PEM)."
      );
    }
    const service = new KalshiService({
      apiKey: creds.apiKey,
      privateKeyPem: creds.privateKeyPem,
      environment: creds.environment
    });
    await service.initialize();
    this.service = service;
    this.initError = null;
    return service;
  }
  resetService() {
    this.service = null;
    this.initError = null;
  }
  async onInit(agentConfig, config) {
    await super.onInit(agentConfig, config);
    try {
      const creds = this.credentials();
      if (creds.apiKey && creds.privateKeyPem) {
        await this.ensureService();
        log2.info("Kalshi service ready", {
          environment: creds.environment,
          allowTrading: creds.allowTrading
        });
      } else {
        log2.info(
          "Kalshi plugin loaded without credentials (configure in Admin \u2192 Plugins \u2192 Kalshi)"
        );
      }
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      log2.warn("Kalshi init deferred", { error: this.initError });
    }
  }
  async onConfigUpdated(newConfig) {
    await super.onConfigUpdated(newConfig);
    this.resetService();
    try {
      const creds = this.credentials();
      if (creds.apiKey && creds.privateKeyPem) {
        await this.ensureService();
      }
      log2.info("Kalshi config updated from admin UI", {
        environment: creds.environment,
        allowTrading: creds.allowTrading,
        hasCredentials: Boolean(creds.apiKey && creds.privateKeyPem)
      });
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      log2.warn("Kalshi re-init after config update failed", {
        error: this.initError
      });
    }
  }
  getTools() {
    return [
      {
        name: "kalshi_status",
        description: "Kalshi plugin configuration and exchange status.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          const creds = this.credentials();
          const base = {
            hasApiKey: Boolean(creds.apiKey),
            hasPrivateKey: Boolean(creds.privateKeyPem),
            environment: creds.environment,
            allowTrading: creds.allowTrading,
            initError: this.initError
          };
          try {
            const service = await this.ensureService();
            const exchange = await service.getExchangeStatus();
            return { ...base, exchange };
          } catch (error) {
            return {
              ...base,
              exchange: null,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        }
      },
      {
        name: "kalshi_search_markets",
        description: "Search Kalshi markets by ticker, series, event, or status.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            event_ticker: { type: "string" },
            series_ticker: { type: "string" },
            status: {
              type: "string",
              description: "open | closed | settled"
            },
            limit: { type: "number" }
          }
        },
        handler: async (params) => {
          const service = await this.ensureService();
          const status = str(params.status);
          const markets = await service.searchMarkets({
            ticker: str(params.ticker),
            event_ticker: str(params.event_ticker),
            series_ticker: str(params.series_ticker),
            status,
            limit: num(params.limit)
          });
          return { count: markets.length, markets };
        }
      },
      {
        name: "kalshi_get_market",
        description: "Get a Kalshi market by ticker.",
        parameters: {
          type: "object",
          properties: { ticker: { type: "string" } },
          required: ["ticker"]
        },
        handler: async (params) => {
          const ticker = str(params.ticker);
          if (!ticker) throw new Error("ticker is required");
          return (await this.ensureService()).getMarket(ticker);
        }
      },
      {
        name: "kalshi_get_balance",
        description: "Get Kalshi account balance and portfolio value (cents).",
        parameters: { type: "object", properties: {} },
        handler: async () => (await this.ensureService()).getBalance()
      },
      {
        name: "kalshi_get_positions",
        description: "List Kalshi positions, optionally filtered by ticker.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            event_ticker: { type: "string" }
          }
        },
        handler: async (params) => {
          const positions = await (await this.ensureService()).getPositions({
            ticker: str(params.ticker),
            event_ticker: str(params.event_ticker)
          });
          return { count: positions.length, positions };
        }
      },
      {
        name: "kalshi_get_orders",
        description: "List Kalshi orders.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            status: {
              type: "string",
              description: "resting | canceled | executed"
            }
          }
        },
        handler: async (params) => {
          const status = str(params.status);
          const orders = await (await this.ensureService()).getOrders({
            ticker: str(params.ticker),
            status
          });
          return { count: orders.length, orders };
        }
      },
      {
        name: "kalshi_create_order",
        description: "Place a Kalshi limit order. Requires allowTrading=true. Price is 1-99 cents.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            side: { type: "string", description: "yes | no" },
            action: { type: "string", description: "buy | sell" },
            count: { type: "number" },
            price: { type: "number", description: "1-99 cents" },
            type: { type: "string", description: "limit | market" }
          },
          required: ["ticker", "side", "action", "count", "price"]
        },
        handler: async (params) => {
          const creds = this.credentials();
          if (!creds.allowTrading) {
            throw new Error(
              "Trading disabled. Turn on \u201CAllow trading\u201D in Admin \u2192 Plugins \u2192 Kalshi (or Business \u2192 Kalshi), then Save."
            );
          }
          const order = {
            ticker: str(params.ticker) || "",
            side: str(params.side) === "no" ? "no" : "yes",
            action: str(params.action) === "sell" ? "sell" : "buy",
            count: num(params.count) || 0,
            price: num(params.price) || 0,
            type: str(params.type) === "market" ? "market" : "limit"
          };
          if (!order.ticker) throw new Error("ticker is required");
          return (await this.ensureService()).createOrder(order);
        }
      },
      {
        name: "kalshi_cancel_order",
        description: "Cancel a Kalshi order by id. Requires allowTrading=true.",
        parameters: {
          type: "object",
          properties: { orderId: { type: "string" } },
          required: ["orderId"]
        },
        handler: async (params) => {
          if (!this.credentials().allowTrading) {
            throw new Error(
              "Trading disabled. Turn on \u201CAllow trading\u201D in Admin \u2192 Plugins \u2192 Kalshi, then Save."
            );
          }
          const orderId = str(params.orderId);
          if (!orderId) throw new Error("orderId is required");
          return (await this.ensureService()).cancelOrder(orderId);
        }
      },
      {
        name: "kalshi_get_orderbook",
        description: "Get Kalshi market order book.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            depth: { type: "number" }
          },
          required: ["ticker"]
        },
        handler: async (params) => {
          const ticker = str(params.ticker);
          if (!ticker) throw new Error("ticker is required");
          return (await this.ensureService()).getOrderbook(ticker, num(params.depth));
        }
      }
    ];
  }
  async handleCustomEndpoint(request, path) {
    const normalized = path.replace(/^\//, "");
    try {
      if (normalized === "status" || normalized === "" || normalized === "/") {
        const creds = this.credentials();
        let exchange = null;
        let error = this.initError;
        try {
          if (creds.apiKey && creds.privateKeyPem) {
            exchange = await (await this.ensureService()).getExchangeStatus();
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        return Response.json({
          ok: true,
          data: {
            configured: Boolean(creds.apiKey && creds.privateKeyPem),
            environment: creds.environment,
            allowTrading: creds.allowTrading,
            exchange,
            error
          }
        });
      }
      if (normalized === "markets" && request.method === "GET") {
        const url = new URL(request.url);
        const markets = await (await this.ensureService()).searchMarkets({
          ticker: url.searchParams.get("ticker") || void 0,
          status: url.searchParams.get("status") || "open",
          limit: Number(url.searchParams.get("limit") || 20)
        });
        return Response.json({ ok: true, data: markets });
      }
      if (normalized === "balance" && request.method === "GET") {
        const balance = await (await this.ensureService()).getBalance();
        return Response.json({ ok: true, data: balance });
      }
      return null;
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
  }
};
var kalshi_plugin_default = KalshiPlugin;
export {
  KalshiPlugin,
  KalshiService,
  kalshi_plugin_default as default,
  mapLegacyOrderToV2
};
//# sourceMappingURL=index.js.map