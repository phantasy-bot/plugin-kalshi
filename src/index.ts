import { BasePlugin, type PluginTool } from "@phantasy/agent/plugins";

export class KalshiPlugin extends BasePlugin {
  name = "kalshi";
  version = "2.0.0";
  description = "Kalshi prediction-market integration plugin for Phantasy.";

  protected displayName = "Kalshi";
  protected category = "markets";
  protected tags = ["kalshi","prediction-markets","trading","finance"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected adminSurface =   {
    "tabId": "kalshi",
    "label": "Kalshi",
    "section": "business",
    "workspace": "business",
    "kind": "generic",
    "keywords": [
      "kalshi",
      "prediction-markets",
      "trading",
      "finance"
    ]
  } as const;
  protected configSchema =   {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true
      }
    }
  };

  getTools(): PluginTool[] {
    return [];
  }
}

export default KalshiPlugin;
