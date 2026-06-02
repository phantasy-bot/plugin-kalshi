import {
  BasePlugin,
  type PluginDataDeclaration,
  type PluginTool,
} from "@phantasy/agent/plugins";

export class KalshiPlugin extends BasePlugin {
  name = "kalshi";
  version = "0.1.0-beta";
  description = "Kalshi prediction-market integration for Phantasy.";

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
      {
        name: "revenue_events",
        kind: "postgres",
        description: "Financial events linked to prediction-market activity when synced.",
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
      environment: { type: "string", default: "demo" },
    },
  };

  getTools(): PluginTool[] {
    return [];
  }

  async handleCustomEndpoint(
    _request: Request,
    path: string,
  ): Promise<Response | null> {
    if (path === "/status" || path === "" || path === "/") {
      return new Response(
        JSON.stringify({
          configured: false,
          migrated: false,
          message:
            "Kalshi is installable as a standalone plugin surface, but richer runtime actions are still being migrated out of the core repo.",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return null;
  }
}

export default KalshiPlugin;
