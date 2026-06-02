"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  KalshiPlugin: () => KalshiPlugin,
  KalshiService: () => KalshiService,
  default: () => kalshi_plugin_default
});
module.exports = __toCommonJS(index_exports);

// src/kalshi-plugin.ts
var import_plugins = require("@phantasy/agent/plugins");
var KalshiPlugin = class extends import_plugins.BasePlugin {
  name = "kalshi";
  version = "0.1.0-beta";
  description = "Kalshi prediction-market integration for Phantasy.";
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
      },
      {
        name: "revenue_events",
        kind: "postgres",
        description: "Financial events linked to prediction-market activity when synced.",
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
    keywords: ["kalshi", "prediction markets", "finance"]
  };
  configSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true },
      apiKey: { type: "string" },
      environment: { type: "string", default: "demo" }
    }
  };
  getTools() {
    return [];
  }
  async handleCustomEndpoint(_request, path) {
    if (path === "/status" || path === "" || path === "/") {
      return new Response(
        JSON.stringify({
          configured: false,
          migrated: false,
          message: "Kalshi is installable as a standalone plugin surface, but richer runtime actions are still being migrated out of the core repo."
        }),
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    return null;
  }
};
var kalshi_plugin_default = KalshiPlugin;

// src/kalshi-service.ts
var import_kalshi_typescript = require("kalshi-typescript");
var import_plugin_runtime = require("@phantasy/agent/plugin-runtime");
var import_crypto = __toESM(require("crypto"), 1);
var log = (0, import_plugin_runtime.createPluginModuleLogger)("KalshiService");
var KalshiService = class {
  config;
  exchangeApi;
  marketsApi;
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
  /**
   * Validate and normalize private key PEM format
   * Converts PKCS#8 to PKCS#1 if needed (Kalshi SDK requires PKCS#1)
   * Fixes missing line breaks in the key
   */
  validateAndNormalizePrivateKey(privateKeyPem) {
    try {
      let key = privateKeyPem.trim();
      key = key.replace(/\r\n/g, "\n");
      if (key.includes("ENCRYPTED")) {
        return {
          valid: false,
          error: "Encrypted private keys are not supported. Please provide an unencrypted RSA private key."
        };
      }
      const hasPKCS1Header = key.includes("-----BEGIN RSA PRIVATE KEY-----");
      const hasPKCS8Header = key.includes("-----BEGIN PRIVATE KEY-----");
      if (!hasPKCS1Header && !hasPKCS8Header) {
        return {
          valid: false,
          error: 'Private key must have valid PEM headers. Expected "-----BEGIN RSA PRIVATE KEY-----" or "-----BEGIN PRIVATE KEY-----"'
        };
      }
      const hasPKCS1Footer = key.includes("-----END RSA PRIVATE KEY-----");
      const hasPKCS8Footer = key.includes("-----END PRIVATE KEY-----");
      if (!hasPKCS1Footer && !hasPKCS8Footer) {
        return {
          valid: false,
          error: 'Private key must have valid PEM footers. Expected "-----END RSA PRIVATE KEY-----" or "-----END PRIVATE KEY-----"'
        };
      }
      const header = hasPKCS1Header ? "-----BEGIN RSA PRIVATE KEY-----" : "-----BEGIN PRIVATE KEY-----";
      const footer = hasPKCS1Footer ? "-----END RSA PRIVATE KEY-----" : "-----END PRIVATE KEY-----";
      let base64Content = key.replace(header, "").replace(footer, "").replace(/\s/g, "");
      const lines = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }
      key = header + "\n" + lines.join("\n") + "\n" + footer + "\n";
      log.info("Normalized PEM formatting (added proper line breaks)");
      if (hasPKCS8Header) {
        log.info("Converting PKCS#8 private key to PKCS#1 format");
        try {
          const keyObject = import_crypto.default.createPrivateKey({
            key,
            format: "pem",
            type: "pkcs8"
          });
          const pkcs1Key = keyObject.export({
            format: "pem",
            type: "pkcs1"
          });
          log.info("Successfully converted PKCS#8 to PKCS#1");
          key = pkcs1Key;
        } catch (conversionError) {
          log.error("Failed to convert PKCS#8 to PKCS#1:", conversionError);
          return {
            valid: false,
            error: `Failed to convert PKCS#8 key to PKCS#1 format: ${conversionError instanceof Error ? conversionError.message : "Unknown error"}`
          };
        }
      } else {
        log.info("Private key is already in PKCS#1 format");
      }
      return {
        valid: true,
        normalized: key
      };
    } catch (error) {
      log.error("Error validating private key:", error);
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  /**
   * Initialize the Kalshi API clients with credentials
   */
  async initialize() {
    try {
      const validation = this.validateAndNormalizePrivateKey(
        this.config.privateKeyPem
      );
      if (!validation.valid) {
        throw new Error(`Private key validation failed: ${validation.error}`);
      }
      const privateKeyPem = validation.normalized;
      log.info("Private key validated and normalized successfully");
      const basePath = this.config.environment === "demo" ? "https://demo-api.kalshi.com/trade-api/v2" : "https://api.elections.kalshi.com/trade-api/v2";
      log.info("Kalshi configuration:", {
        environment: this.config.environment || "production",
        basePath,
        keyFormat: "PKCS#1 PEM"
      });
      const configuration = new import_kalshi_typescript.Configuration({
        apiKey: this.config.apiKey,
        privateKeyPem,
        basePath
      });
      this.exchangeApi = new import_kalshi_typescript.ExchangeApi(configuration);
      this.marketsApi = new import_kalshi_typescript.MarketsApi(configuration);
      this.portfolioApi = new import_kalshi_typescript.PortfolioApi(configuration);
      this.initialized = true;
      log.info("Kalshi API clients initialized successfully", {
        environment: this.config.environment || "production"
      });
    } catch (error) {
      log.error("Failed to initialize Kalshi API clients", error);
      if (error instanceof Error && error.message.includes("DECODER")) {
        throw new Error(
          `Private key format error: The RSA private key could not be decoded. Please ensure your private key is in PEM format (PKCS#1 or PKCS#8), not encrypted, and has proper headers/footers. Original error: ${error.message}`
        );
      }
      throw new Error(
        `Kalshi initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Ensures the service is initialized before making API calls
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "KalshiService not initialized. Call initialize() first."
      );
    }
  }
  /**
   * Get the current operational status of the Kalshi exchange
   */
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
  /**
   * Search for markets with optional filters
   */
  async searchMarkets(params) {
    this.ensureInitialized();
    try {
      const response = await this.marketsApi.getMarkets(
        params.limit || 20,
        void 0,
        // cursor
        params.event_ticker,
        params.series_ticker,
        void 0,
        // maxCloseTs
        void 0,
        // minCloseTs
        params.status,
        params.ticker
        // tickers
      );
      return response.data.markets || [];
    } catch (error) {
      log.error("Failed to search markets", { params, error });
      throw new Error(
        `Failed to search markets: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get detailed information about a specific market
   */
  async getMarket(ticker) {
    this.ensureInitialized();
    try {
      const response = await this.marketsApi.getMarket(ticker);
      return response.data.market;
    } catch (error) {
      log.error("Failed to get market", { ticker, error });
      throw new Error(
        `Failed to get market ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get the current balance of the portfolio
   */
  async getBalance() {
    this.ensureInitialized();
    try {
      log.info("Calling Kalshi API: getBalance");
      const response = await this.portfolioApi.getBalance();
      log.info("Kalshi API getBalance successful");
      return response.data;
    } catch (error) {
      log.error("Failed to get balance - Full error details:", {
        error,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : void 0
      });
      throw new Error(
        `Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get current positions in the portfolio
   */
  async getPositions(params) {
    this.ensureInitialized();
    try {
      const response = await this.portfolioApi.getPositions(
        params.ticker,
        params.event_ticker
      );
      const responseData = response.data;
      log.info("Kalshi getPositions raw response:", {
        responseData: response.data,
        responseDataKeys: Object.keys(response.data || {}),
        hasMarketPositions: !!responseData.market_positions,
        marketPositionsLength: (Array.isArray(responseData.market_positions) ? responseData.market_positions : []).length,
        hasEventPositions: !!responseData.event_positions,
        eventPositionsLength: (Array.isArray(responseData.event_positions) ? responseData.event_positions : []).length
      });
      const marketPositions = Array.isArray(responseData.market_positions) ? responseData.market_positions : [];
      log.info(
        `Kalshi getPositions returning ${marketPositions.length} market positions`
      );
      return marketPositions;
    } catch (error) {
      log.error("Failed to get positions", { params, error });
      throw new Error(
        `Failed to get positions: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get orders from the portfolio
   */
  async getOrders(params) {
    this.ensureInitialized();
    try {
      const response = await this.portfolioApi.getOrders(
        params.ticker,
        void 0,
        // eventTicker
        void 0,
        // limit
        void 0,
        // cursor
        params.status
      );
      return response.data.orders || [];
    } catch (error) {
      log.error("Failed to get orders", { params, error });
      throw new Error(
        `Failed to get orders: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Create a new order on a market
   */
  async createOrder(params) {
    this.ensureInitialized();
    try {
      if (params.price < 1 || params.price > 99) {
        throw new Error("Price must be between 1 and 99 cents");
      }
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
        yes_price: params.side === "yes" ? params.price : void 0,
        no_price: params.side === "no" ? params.price : void 0
      });
      log.info("Order created successfully", {
        ticker: params.ticker,
        side: params.side,
        action: params.action,
        count: params.count,
        price: params.price
      });
      return response.data.order;
    } catch (error) {
      log.error("Failed to create order", { params, error });
      throw new Error(
        `Failed to create order: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId) {
    this.ensureInitialized();
    try {
      await this.portfolioApi.cancelOrder(orderId);
      log.info("Order canceled successfully", { orderId });
      return { success: true };
    } catch (error) {
      log.error("Failed to cancel order", { orderId, error });
      throw new Error(
        `Failed to cancel order ${orderId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get the order book for a market
   */
  async getOrderbook(ticker, depth) {
    this.ensureInitialized();
    try {
      const response = await this.marketsApi.getMarketOrderbook(
        ticker,
        depth || 10
      );
      return response;
    } catch (error) {
      log.error("Failed to get orderbook", { ticker, error });
      throw new Error(
        `Failed to get orderbook for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  /**
   * Get recent trades for a market
   */
  async getTrades(ticker, limit) {
    this.ensureInitialized();
    try {
      const response = await this.marketsApi.getTrades(
        limit || 100,
        void 0,
        // cursor
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KalshiPlugin,
  KalshiService
});
//# sourceMappingURL=index.cjs.map