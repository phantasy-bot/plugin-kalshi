import {
  BasePlugin,
  type PluginDataDeclaration,
  type PluginTool,
} from "@phantasy/agent/plugins";
import { createPluginModuleLogger } from "@phantasy/agent/plugin-runtime";

import {
  parseBuySellAction,
  parseYesNoSide,
  resolveAllowTrading,
} from "./config-resolve.js";
import { KalshiService, type CreateOrderParams } from "./kalshi-service.js";

export {
  parseBuySellAction,
  parseYesNoSide,
  resolveAllowTrading,
} from "./config-resolve.js";

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
  version = "0.2.2-beta";
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
    keywords: ["kalshi", "prediction markets", "finance", "allow trading"],
  } as const;
  protected configSchema = {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        default: true,
        title: "Enabled",
        description: "Load Kalshi tools and admin surface.",
      },
      allowTrading: {
        type: "boolean",
        default: false,
        title: "Allow trading",
        description:
          "When on, order tools may place and cancel live orders. Toggle anytime in this plugin form — no restart required. Leave off for research-only agents. Prefer demo environment until you intend real risk.",
      },
      environment: {
        type: "string",
        enum: ["demo", "production"],
        default: "demo",
        title: "Environment",
        description: "Use demo for practice; production places real orders when trading is allowed.",
      },
      apiKey: {
        type: "string",
        title: "API key ID",
        description: "Kalshi API key id from the developer console. Can also be set via env for bootstrap only.",
        format: "password",
      },
      privateKeyPem: {
        type: "string",
        title: "RSA private key (PEM)",
        description:
          "Unencrypted RSA private key PEM paired with the API key. Paste here in Admin → Plugins → Kalshi, or bootstrap via KALSHI_PRIVATE_KEY_PEM.",
        format: "pem",
      },
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
    const envFromConfig = str(cfg.environment);
    const environment: "demo" | "production" =
      envFromConfig === "production" || envFromConfig === "demo"
        ? envFromConfig
        : process.env.KALSHI_ENVIRONMENT === "production"
          ? "production"
          : "demo";
    return {
      apiKey: str(cfg.apiKey) || process.env.KALSHI_API_KEY,
      privateKeyPem:
        str(cfg.privateKeyPem) ||
        process.env.KALSHI_PRIVATE_KEY_PEM ||
        process.env.KALSHI_PRIVATE_KEY,
      environment,
      allowTrading: resolveAllowTrading(
        cfg,
        "allowTrading",
        process.env.KALSHI_ALLOW_TRADING,
      ),
    };
  }

  private async ensureService(): Promise<KalshiService> {
    if (this.service) return this.service;
    const creds = this.credentials();
    if (!creds.apiKey || !creds.privateKeyPem) {
      throw new Error(
        "Kalshi credentials missing. Set API key + RSA private key in Admin → Plugins → Kalshi (or bootstrap with KALSHI_API_KEY + KALSHI_PRIVATE_KEY_PEM).",
      );
    }
    const service = new KalshiService({
      apiKey: creds.apiKey,
      privateKeyPem: creds.privateKeyPem,
      environment: creds.environment,
      allowTrading: creds.allowTrading,
    });
    await service.initialize();
    this.service = service;
    this.initError = null;
    return service;
  }

  private resetService(): void {
    this.service = null;
    this.initError = null;
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
        log.info("Kalshi service ready", {
          environment: creds.environment,
          allowTrading: creds.allowTrading,
        });
      } else {
        log.info(
          "Kalshi plugin loaded without credentials (configure in Admin → Plugins → Kalshi)",
        );
      }
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      log.warn("Kalshi init deferred", { error: this.initError });
    }
  }

  override async onConfigUpdated(
    newConfig: Parameters<BasePlugin["onConfigUpdated"]>[0],
  ): Promise<void> {
    await super.onConfigUpdated(newConfig);
    this.resetService();
    try {
      const creds = this.credentials();
      if (creds.apiKey && creds.privateKeyPem) {
        await this.ensureService();
      }
      log.info("Kalshi config updated from admin UI", {
        environment: creds.environment,
        allowTrading: creds.allowTrading,
        hasCredentials: Boolean(creds.apiKey && creds.privateKeyPem),
      });
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      log.warn("Kalshi re-init after config update failed", {
        error: this.initError,
      });
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
        name: "kalshi_list_short_crypto",
        description:
          "List open Kalshi 15m BTC/ETH (and other *15M) crypto up/down markets. No public 5m series.",
        parameters: {
          type: "object",
          properties: {
            series: {
              type: "string",
              description: "Comma series tickers (default KXBTC15M,KXETH15M)",
            },
          },
        },
        handler: async (params) => {
          const service = await this.ensureService();
          const seriesList = (str(params.series) || "KXBTC15M,KXETH15M")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const markets: unknown[] = [];
          for (const series_ticker of seriesList) {
            try {
              const page = await service.searchMarkets({
                series_ticker,
                status: "open",
                limit: 5,
              });
              markets.push(...page);
            } catch (error) {
              markets.push({
                series_ticker,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return {
            count: markets.length,
            markets,
            note: "Kalshi short crypto is 15m (KXBTC15M/KXETH15M). Polymarket also has 5m.",
          };
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
              "Trading disabled. Turn on “Allow trading” in Admin → Plugins → Kalshi (or Business → Kalshi), then Save.",
            );
          }
          const order: CreateOrderParams = {
            ticker: str(params.ticker) || "",
            side: parseYesNoSide(params.side),
            action: parseBuySellAction(params.action),
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
            throw new Error(
              "Trading disabled. Turn on “Allow trading” in Admin → Plugins → Kalshi, then Save.",
            );
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
