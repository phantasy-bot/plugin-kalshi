import {
  BasePlugin,
  type PluginDataDeclaration,
  type PluginTool,
} from "@phantasy/agent/plugins";
import { createPluginModuleLogger } from "@phantasy/agent/plugin-runtime";

import { KalshiService, type CreateOrderParams } from "./kalshi-service.js";

const log = createPluginModuleLogger("KalshiPlugin");

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export class KalshiPlugin extends BasePlugin {
  name = "kalshi";
  version = "0.2.0-beta";
  description =
    "Kalshi prediction markets: search, prices, portfolio, and gated order placement.";

  protected displayName = "Kalshi";
  protected category = "markets";
  protected tags = ["kalshi", "prediction-markets", "trading", "finance"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected dataRetention: PluginDataDeclaration = {
    stores: [
      {
        name: "agent_configs.kalshiConfig",
        kind: "config",
        description: "Kalshi API environment and operator configuration.",
        erasable: false,
      },
    ],
    dataCategories: [
      "prediction market account metadata",
      "market orders",
      "positions",
      "financial activity",
    ],
    externalServices: ["Kalshi API"],
    retentionDefault: "persist",
    erasable: false,
  };
  protected adminSurface = {
    tabId: "kalshi",
    label: "Kalshi",
    workspace: "business",
    kind: "generic",
    advancedModule: "prediction-markets",
    keywords: ["kalshi", "prediction markets", "finance"],
  } as const;
  protected configSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true },
      apiKey: { type: "string" },
      privateKeyPem: { type: "string" },
      environment: {
        type: "string",
        enum: ["demo", "production"],
        default: "demo",
      },
      allowTrading: { type: "boolean", default: false },
    },
  };

  private service: KalshiService | null = null;
  private initError: string | null = null;

  private credentials(): {
    apiKey?: string;
    privateKeyPem?: string;
    environment: "demo" | "production";
    allowTrading: boolean;
  } {
    const cfg = this.getConfig() as Record<string, unknown>;
    const environment =
      str(cfg.environment) === "production" ||
      process.env.KALSHI_ENVIRONMENT === "production"
        ? "production"
        : "demo";
    return {
      apiKey: str(cfg.apiKey) || process.env.KALSHI_API_KEY,
      privateKeyPem:
        str(cfg.privateKeyPem) ||
        process.env.KALSHI_PRIVATE_KEY_PEM ||
        process.env.KALSHI_PRIVATE_KEY,
      environment,
      allowTrading:
        cfg.allowTrading === true || process.env.KALSHI_ALLOW_TRADING === "true",
    };
  }

  private async ensureService(): Promise<KalshiService> {
    if (this.service) return this.service;
    const creds = this.credentials();
    if (!creds.apiKey || !creds.privateKeyPem) {
      throw new Error(
        "Kalshi credentials missing. Set apiKey + privateKeyPem (or KALSHI_API_KEY + KALSHI_PRIVATE_KEY_PEM).",
      );
    }
    const service = new KalshiService({
      apiKey: creds.apiKey,
      privateKeyPem: creds.privateKeyPem,
      environment: creds.environment,
    });
    await service.initialize();
    this.service = service;
    this.initError = null;
    return service;
  }

  override async onInit(
    agentConfig: Parameters<BasePlugin["onInit"]>[0],
    config?: Parameters<BasePlugin["onInit"]>[1],
  ): Promise<void> {
    await super.onInit(agentConfig, config);
    try {
      const creds = this.credentials();
      if (creds.apiKey && creds.privateKeyPem) {
        await this.ensureService();
        log.info("Kalshi service ready", { environment: creds.environment });
      } else {
        log.info("Kalshi plugin loaded without credentials (tools will error until configured)");
      }
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      log.warn("Kalshi init deferred", { error: this.initError });
    }
  }

  getTools(): PluginTool[] {
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
            initError: this.initError,
          };
          try {
            const service = await this.ensureService();
            const exchange = await service.getExchangeStatus();
            return { ...base, exchange };
          } catch (error) {
            return {
              ...base,
              exchange: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
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
              description: "open | closed | settled",
            },
            limit: { type: "number" },
          },
        },
        handler: async (params) => {
          const service = await this.ensureService();
          const status = str(params.status) as "open" | "closed" | "settled" | undefined;
          const markets = await service.searchMarkets({
            ticker: str(params.ticker),
            event_ticker: str(params.event_ticker),
            series_ticker: str(params.series_ticker),
            status,
            limit: num(params.limit),
          });
          return { count: markets.length, markets };
        },
      },
      {
        name: "kalshi_get_market",
        description: "Get a Kalshi market by ticker.",
        parameters: {
          type: "object",
          properties: { ticker: { type: "string" } },
          required: ["ticker"],
        },
        handler: async (params) => {
          const ticker = str(params.ticker);
          if (!ticker) throw new Error("ticker is required");
          return (await this.ensureService()).getMarket(ticker);
        },
      },
      {
        name: "kalshi_get_balance",
        description: "Get Kalshi account balance and portfolio value (cents).",
        parameters: { type: "object", properties: {} },
        handler: async () => (await this.ensureService()).getBalance(),
      },
      {
        name: "kalshi_get_positions",
        description: "List Kalshi positions, optionally filtered by ticker.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            event_ticker: { type: "string" },
          },
        },
        handler: async (params) => {
          const positions = await (await this.ensureService()).getPositions({
            ticker: str(params.ticker),
            event_ticker: str(params.event_ticker),
          });
          return { count: positions.length, positions };
        },
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
              description: "resting | canceled | executed",
            },
          },
        },
        handler: async (params) => {
          const status = str(params.status) as
            | "resting"
            | "canceled"
            | "executed"
            | undefined;
          const orders = await (await this.ensureService()).getOrders({
            ticker: str(params.ticker),
            status,
          });
          return { count: orders.length, orders };
        },
      },
      {
        name: "kalshi_create_order",
        description:
          "Place a Kalshi limit order. Requires allowTrading=true. Price is 1-99 cents.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            side: { type: "string", description: "yes | no" },
            action: { type: "string", description: "buy | sell" },
            count: { type: "number" },
            price: { type: "number", description: "1-99 cents" },
            type: { type: "string", description: "limit | market" },
          },
          required: ["ticker", "side", "action", "count", "price"],
        },
        handler: async (params) => {
          const creds = this.credentials();
          if (!creds.allowTrading) {
            throw new Error(
              "Trading disabled. Set allowTrading=true (or KALSHI_ALLOW_TRADING=true).",
            );
          }
          const order: CreateOrderParams = {
            ticker: str(params.ticker) || "",
            side: str(params.side) === "no" ? "no" : "yes",
            action: str(params.action) === "sell" ? "sell" : "buy",
            count: num(params.count) || 0,
            price: num(params.price) || 0,
            type: str(params.type) === "market" ? "market" : "limit",
          };
          if (!order.ticker) throw new Error("ticker is required");
          return (await this.ensureService()).createOrder(order);
        },
      },
      {
        name: "kalshi_cancel_order",
        description: "Cancel a Kalshi order by id. Requires allowTrading=true.",
        parameters: {
          type: "object",
          properties: { orderId: { type: "string" } },
          required: ["orderId"],
        },
        handler: async (params) => {
          if (!this.credentials().allowTrading) {
            throw new Error("Trading disabled. Set allowTrading=true.");
          }
          const orderId = str(params.orderId);
          if (!orderId) throw new Error("orderId is required");
          return (await this.ensureService()).cancelOrder(orderId);
        },
      },
      {
        name: "kalshi_get_orderbook",
        description: "Get Kalshi market order book.",
        parameters: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            depth: { type: "number" },
          },
          required: ["ticker"],
        },
        handler: async (params) => {
          const ticker = str(params.ticker);
          if (!ticker) throw new Error("ticker is required");
          return (await this.ensureService()).getOrderbook(ticker, num(params.depth));
        },
      },
    ];
  }

  async handleCustomEndpoint(
    request: Request,
    path: string,
  ): Promise<Response | null> {
    const normalized = path.replace(/^\//, "");
    try {
      if (normalized === "status" || normalized === "" || normalized === "/") {
        const creds = this.credentials();
        let exchange = null;
        let error: string | null = this.initError;
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
            error,
          },
        });
      }
      if (normalized === "markets" && request.method === "GET") {
        const url = new URL(request.url);
        const markets = await (await this.ensureService()).searchMarkets({
          ticker: url.searchParams.get("ticker") || undefined,
          status: (url.searchParams.get("status") as "open" | null) || "open",
          limit: Number(url.searchParams.get("limit") || 20),
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
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }
}

export default KalshiPlugin;
