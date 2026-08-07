import { BasePlugin, PluginDataDeclaration, PluginTool } from '@phantasy/agent/plugins';

declare class KalshiPlugin extends BasePlugin {
    name: string;
    version: string;
    description: string;
    protected displayName: string;
    protected category: string;
    protected tags: string[];
    protected permissions: string[];
    protected workspace: "business";
    protected extensionKind: "integration";
    protected dataRetention: PluginDataDeclaration;
    protected adminSurface: {
        readonly tabId: "kalshi";
        readonly label: "Kalshi";
        readonly workspace: "business";
        readonly kind: "generic";
        readonly advancedModule: "prediction-markets";
        readonly keywords: readonly ["kalshi", "prediction markets", "finance"];
    };
    protected configSchema: {
        type: string;
        properties: {
            enabled: {
                type: string;
                default: boolean;
            };
            apiKey: {
                type: string;
            };
            privateKeyPem: {
                type: string;
            };
            environment: {
                type: string;
                enum: string[];
                default: string;
            };
            allowTrading: {
                type: string;
                default: boolean;
            };
        };
    };
    private service;
    private initError;
    private credentials;
    private ensureService;
    onInit(agentConfig: Parameters<BasePlugin["onInit"]>[0], config?: Parameters<BasePlugin["onInit"]>[1]): Promise<void>;
    getTools(): PluginTool[];
    handleCustomEndpoint(request: Request, path: string): Promise<Response | null>;
}

interface KalshiServiceConfig {
    apiKey: string;
    privateKeyPem: string;
    environment?: "production" | "demo";
}
interface ExchangeStatus {
    exchange_active: boolean;
    trading_active: boolean;
    exchange_estimated_resume_time?: string | null;
    [key: string]: unknown;
}
interface Market {
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
interface Balance {
    balance: number;
    portfolio_value: number;
    updated_ts?: number;
    balance_dollars?: string;
    [key: string]: unknown;
}
interface Position {
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
interface Order {
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
interface CreateOrderParams {
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
interface CreateOrderResult {
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
declare function mapLegacyOrderToV2(params: CreateOrderParams): {
    bookSide: "bid" | "ask";
    priceDollars: string;
    count: string;
    timeInForce: "good_till_canceled" | "immediate_or_cancel" | "fill_or_kill";
};
/**
 * KalshiService wraps kalshi-typescript v3 (MarketApi / OrdersApi / PortfolioApi).
 */
declare class KalshiService {
    private config;
    private exchangeApi;
    private marketApi;
    private ordersApi;
    private portfolioApi;
    private initialized;
    constructor(config: KalshiServiceConfig);
    private validateAndNormalizePrivateKey;
    initialize(): Promise<void>;
    private ensureInitialized;
    getExchangeStatus(): Promise<ExchangeStatus>;
    searchMarkets(params: {
        ticker?: string;
        event_ticker?: string;
        series_ticker?: string;
        status?: "open" | "closed" | "settled" | string;
        limit?: number;
    }): Promise<Market[]>;
    getMarket(ticker: string): Promise<Market>;
    getBalance(): Promise<Balance>;
    getPositions(params: {
        ticker?: string;
        event_ticker?: string;
    }): Promise<Position[]>;
    getOrders(params: {
        ticker?: string;
        status?: "resting" | "canceled" | "executed" | string;
    }): Promise<Order[]>;
    createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
    cancelOrder(orderId: string): Promise<{
        success: boolean;
        order_id?: string;
        reduced_by?: string;
    }>;
    getOrderbook(ticker: string, depth?: number): Promise<unknown>;
    getTrades(ticker: string, limit?: number): Promise<unknown>;
}

export { type Balance, type CreateOrderParams, type CreateOrderResult, type ExchangeStatus, KalshiPlugin, KalshiService, type KalshiServiceConfig, type Market, type Order, type Position, KalshiPlugin as default, mapLegacyOrderToV2 };
