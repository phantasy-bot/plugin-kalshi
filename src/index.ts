import { BasePlugin, PluginManifest, PluginTool } from "@phantasy/core";

export class UkalshiPlugin extends BasePlugin {
  readonly name = "kalshi";
  readonly version = "1.0.0";

  getManifest(): PluginManifest {
    return {
      name: this.name,
      version: this.version,
      description: "kalshi plugin for Phantasy",
      author: "Phantasy",
      license: "BUSL-1.1",
      repository: "https://github.com/phantasy-bot/plugin-kalshi",
    };
  }

  getTools(): PluginTool[] {
    return [];
  }

  async initialize(): Promise<void> {
    console.log("[UkalshiPlugin] Initialized");
  }
}

export default UkalshiPlugin;
