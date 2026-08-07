declare module "@phantasy/agent/plugins" {
  export class BasePlugin {
    name: string;
    version: string;
    description?: string;
    protected config: Record<string, unknown>;
    protected enabled: boolean;
    protected displayName?: string;
    protected category?: string;
    protected tags?: string[];
    protected permissions?: string[];
    protected workspace?: string;
    protected extensionKind?: string;
    protected dataRetention?: unknown;
    protected adminSurface?: unknown;
    protected configSchema?: unknown;
    onInit(agentConfig: unknown, config?: Record<string, unknown>): Promise<void>;
    onConfigUpdated(newConfig: Record<string, unknown>): Promise<void>;
    getConfig(): Record<string, unknown>;
    getTools(): PluginTool[];
    handleCustomEndpoint?(request: Request, path: string): Promise<Response | null>;
  }
  export interface PluginTool {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    handler: (params: any) => Promise<any>;
  }
  export interface PluginDataDeclaration {
    stores: Array<Record<string, unknown>>;
    dataCategories: string[];
    externalServices: string[];
    retentionDefault: string;
    erasable: boolean;
  }
}
declare module "@phantasy/agent/plugin-runtime" {
  export function createPluginModuleLogger(name: string): {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
}
