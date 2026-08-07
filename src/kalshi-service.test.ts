import { describe, expect, it } from "vitest";

import { KalshiService, mapLegacyOrderToV2 } from "./kalshi-service.js";

describe("KalshiService", () => {
  it("requires api key and private key", () => {
    expect(
      () =>
        new KalshiService({
          apiKey: "",
          privateKeyPem: "x",
        }),
    ).toThrow(/API key/);
    expect(
      () =>
        new KalshiService({
          apiKey: "key",
          privateKeyPem: "",
        }),
    ).toThrow(/Private key/);
  });

  it("constructs with credentials without network", () => {
    const service = new KalshiService({
      apiKey: "test-key",
      privateKeyPem:
        "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n",
      environment: "demo",
    });
    expect(service).toBeTruthy();
  });
});

describe("mapLegacyOrderToV2", () => {
  it("maps buy yes to bid at same price", () => {
    const m = mapLegacyOrderToV2({
      ticker: "TEST",
      side: "yes",
      action: "buy",
      count: 5,
      price: 40,
      type: "limit",
    });
    expect(m.bookSide).toBe("bid");
    expect(m.priceDollars).toBe("0.40");
    expect(m.count).toBe("5.00");
    expect(m.timeInForce).toBe("good_till_canceled");
  });

  it("maps buy no to ask at complement price", () => {
    const m = mapLegacyOrderToV2({
      ticker: "TEST",
      side: "no",
      action: "buy",
      count: 2,
      price: 40,
    });
    expect(m.bookSide).toBe("ask");
    expect(m.priceDollars).toBe("0.60");
  });

  it("maps market type to IOC", () => {
    const m = mapLegacyOrderToV2({
      ticker: "TEST",
      side: "yes",
      action: "sell",
      count: 1,
      price: 55,
      type: "market",
    });
    expect(m.bookSide).toBe("ask");
    expect(m.timeInForce).toBe("immediate_or_cancel");
  });

  it("rejects invalid price and count", () => {
    expect(() =>
      mapLegacyOrderToV2({
        ticker: "T",
        side: "yes",
        action: "buy",
        count: 1,
        price: 0,
      }),
    ).toThrow(/1 and 99/);
    expect(() =>
      mapLegacyOrderToV2({
        ticker: "T",
        side: "yes",
        action: "buy",
        count: 0,
        price: 50,
      }),
    ).toThrow(/at least 1/);
  });
});
