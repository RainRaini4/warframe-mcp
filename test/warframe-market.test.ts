import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MarketRequestLimiter,
  SlidingWindowRateLimiter,
  WarframeMarketClient,
  clearMarketItemsCache,
} from "../worker/warframe-market.js";

const ITEM = {
  id: "item-titania",
  slug: "titania_prime",
  maxRank: 5,
  i18n: {
    ru: { name: "Титания Прайм" },
    en: { name: "Titania Prime" },
  },
};

const LEGACY_STATISTICS = {
  payload: {
    statistics_closed: {
      "48hours": [
        {
          datetime: "2026-07-26T08:00:00.000Z",
          volume: 3,
          min_price: 4,
          max_price: 6,
          open_price: 5,
          closed_price: 6,
          avg_price: 5,
          wa_price: 5.5,
          median: 5,
          mod_rank: 0,
        },
        {
          datetime: "2026-07-26T08:00:00.000Z",
          volume: 1,
          min_price: 100,
          max_price: 100,
          open_price: 100,
          closed_price: 100,
          avg_price: 100,
          wa_price: 100,
          median: 100,
          mod_rank: 5,
        },
      ],
      "90days": [
        {
          datetime: "2026-07-25T00:00:00.000Z",
          volume: 9,
          min_price: 90,
          max_price: 110,
          open_price: 95,
          closed_price: 105,
          avg_price: 100,
          wa_price: 101,
          median: 100,
          mod_rank: 5,
        },
      ],
    },
    statistics_live: {
      "48hours": [],
      "90days": [],
    },
  },
};

const TOP_ORDERS = {
  sell: [],
  buy: [],
};

const FULL_ORDERS = [
  {
    id: "sell-online",
    type: "sell",
    platinum: 100,
    quantity: 2,
    visible: true,
    rank: 5,
    user: {
      ingameName: "Seller",
      status: "online",
      reputation: 10,
      platform: "pc",
      crossplay: true,
    },
  },
  {
    id: "sell-offline",
    type: "sell",
    platinum: 95,
    quantity: 1,
    visible: true,
    rank: 5,
    user: {
      ingameName: "OfflineSeller",
      status: "offline",
      reputation: 1,
      platform: "pc",
      crossplay: true,
    },
  },
  {
    id: "buy-online",
    type: "buy",
    platinum: 90,
    quantity: 3,
    visible: true,
    rank: 5,
    user: {
      ingameName: "Buyer",
      status: "ingame",
      reputation: 20,
      platform: "pc",
      crossplay: true,
    },
  },
];

const RANK_FIVE_TOP_ORDERS = {
  sell: [FULL_ORDERS[0]],
  buy: [FULL_ORDERS[2]],
};

const noLimiter: MarketRequestLimiter = {
  async acquire() {},
};

function createFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return handler as typeof fetch;
}

function apiResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ apiVersion: "0.25.0", data, error: null }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

beforeEach(() => {
  clearMarketItemsCache();
});

describe("Warframe Market request reliability", () => {
  it("limits parallel external requests to three starts per second", async () => {
    let currentMs = 0;
    let releaseWait: (() => void) | undefined;
    const waits: number[] = [];
    const starts: number[] = [];
    const limiter = new SlidingWindowRateLimiter({
      nowMs: () => currentMs,
      sleep: (delayMs) => {
        waits.push(delayMs);
        return new Promise<void>((resolve) => {
          releaseWait = () => {
            currentMs += delayMs;
            resolve();
          };
        });
      },
    });
    const client = new WarframeMarketClient({
      limiter,
      fetcher: createFetch(() => {
        starts.push(currentMs);
        return apiResponse(TOP_ORDERS);
      }),
    });

    const requests = ["one", "two", "three", "four"].map((slug) =>
      client.getTopOrders(slug),
    );

    await vi.waitFor(() => expect(starts).toHaveLength(3));
    expect(starts).toEqual([0, 0, 0]);
    expect(waits).toEqual([1_000]);

    releaseWait?.();
    await Promise.all(requests);

    expect(starts).toEqual([0, 0, 0, 1_000]);
  });

  it("uses Retry-After before retrying a rate-limited response", async () => {
    let requests = 0;
    const delays: number[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetcher: createFetch(() => {
        requests += 1;
        return requests === 1
          ? apiResponse(null, 429, { "Retry-After": "2" })
          : apiResponse(TOP_ORDERS);
      }),
    });

    await client.getTopOrders("titania_prime");

    expect(requests).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  it("uses bounded exponential backoff with jitter for network errors", async () => {
    let requests = 0;
    const delays: number[] = [];
    const randomValues = [0, 1];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 150,
      random: () => randomValues.shift() ?? 0.5,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetcher: createFetch(() => {
        requests += 1;
        if (requests < 3) throw new TypeError("network failure");
        return apiResponse(TOP_ORDERS);
      }),
    });

    await client.getTopOrders("titania_prime");

    expect(requests).toBe(3);
    expect(delays).toEqual([50, 150]);
  });

  it.each([503, 509])("retries temporary HTTP %i responses", async (status) => {
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      retryBaseDelayMs: 1,
      random: () => 1,
      sleep: async () => {},
      fetcher: createFetch(() => {
        requests += 1;
        return requests === 1 ? apiResponse(null, status) : apiResponse(TOP_ORDERS);
      }),
    });

    await client.getTopOrders("titania_prime");

    expect(requests).toBe(2);
  });

  it.each([
    [400, "validation"],
    [403, "forbidden"],
    [404, "not_found"],
  ] as const)("does not retry HTTP %i", async (status, code) => {
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch(() => {
        requests += 1;
        return apiResponse(null, status);
      }),
    });

    await expect(client.getTopOrders("missing_item")).rejects.toMatchObject({ code });
    expect(requests).toBe(1);
  });

  it("returns a specialized timeout without retrying", async () => {
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      timeoutMs: 5,
      fetcher: createFetch((_input, init) => {
        requests += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    });

    await expect(client.getTopOrders("titania_prime")).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringContaining("5 мс"),
    });
    expect(requests).toBe(1);
  });

  it("caches the item catalog for six hours", async () => {
    let currentMs = 0;
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      now: () => new Date(currentMs),
      fetcher: createFetch(() => {
        requests += 1;
        return apiResponse([ITEM]);
      }),
    });

    await client.searchItems("Titania");
    currentMs = 6 * 60 * 60_000 - 1;
    await client.searchItems("Titania");
    expect(requests).toBe(1);

    currentMs += 1;
    await client.searchItems("Titania");
    expect(requests).toBe(2);
  });

  it("caches top orders for twenty seconds", async () => {
    let currentMs = 0;
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      now: () => new Date(currentMs),
      fetcher: createFetch(() => {
        requests += 1;
        return apiResponse(TOP_ORDERS);
      }),
    });

    await client.getTopOrders("titania_prime");
    currentMs = 19_999;
    await client.getTopOrders("titania_prime");
    expect(requests).toBe(1);

    currentMs = 20_000;
    await client.getTopOrders("titania_prime");
    expect(requests).toBe(2);
  });

  it("uses separate cache keys for language, platform, and crossplay", async () => {
    const headers: Headers[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((_input, init) => {
        headers.push(new Headers(init?.headers));
        return apiResponse(TOP_ORDERS);
      }),
    });

    await client.getTopOrders("titania_prime");
    await client.getTopOrders("titania_prime", { language: "en" });
    await client.getTopOrders("titania_prime", { platform: "xbox" });
    await client.getTopOrders("titania_prime", { crossplay: false });

    expect(headers.map((value) => [
      value.get("Language"),
      value.get("Platform"),
      value.get("Crossplay"),
    ])).toEqual([
      ["ru", "pc", "true"],
      ["en", "pc", "true"],
      ["ru", "xbox", "true"],
      ["ru", "pc", "false"],
    ]);
  });

  it("deduplicates identical parallel requests", async () => {
    let requests = 0;
    let resolveResponse: ((response: Response) => void) | undefined;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch(() => {
        requests += 1;
        return new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
      }),
    });

    const first = client.getTopOrders("titania_prime");
    const second = client.getTopOrders("titania_prime");
    await vi.waitFor(() => expect(requests).toBe(1));

    resolveResponse?.(apiResponse(TOP_ORDERS));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(requests).toBe(1);
    expect(secondResult).toEqual(firstResult);
  });

  it("removes a rejected in-flight promise before the next request", async () => {
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      maxRetries: 0,
      fetcher: createFetch(() => {
        requests += 1;
        if (requests === 1) throw new TypeError("network failure");
        return apiResponse(TOP_ORDERS);
      }),
    });

    const rejected = await Promise.allSettled([
      client.getTopOrders("titania_prime"),
      client.getTopOrders("titania_prime"),
    ]);
    expect(rejected.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(requests).toBe(1);

    await expect(client.getTopOrders("titania_prime")).resolves.toMatchObject({
      item: { slug: "titania_prime" },
    });
    expect(requests).toBe(2);
  });

  it("rejects validation errors before making an external request", async () => {
    let requests = 0;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch(() => {
        requests += 1;
        return apiResponse([ITEM]);
      }),
    });

    await expect(client.searchItems("   ")).rejects.toMatchObject({ code: "validation" });
    expect(requests).toBe(0);
  });
});

describe("Warframe Market legacy statistics", () => {
  it("normalizes both ranges, keeps ranks separate, and applies exact rank filters", async () => {
    const requests: string[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      now: () => new Date("2026-07-26T10:00:00.000Z"),
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push(url);
        if (url === "https://api.warframe.market/v2/items") return apiResponse([ITEM]);
        if (url === "https://api.warframe.market/v1/items/titania_prime/statistics") {
          return new Response(JSON.stringify(LEGACY_STATISTICS), {
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const all = await client.getItemStatistics("titania_prime");
    const rankFive = await client.getItemStatistics(
      "titania_prime",
      undefined,
      { rank: 5 },
    );

    expect(all.status).toBe("available");
    expect(all.variants.map((variant) => variant.variant)).toEqual([
      { rank: 0 },
      { rank: 5 },
    ]);
    expect(all.source).toMatchObject({ api: "warframe-market-v1", deprecated: true });
    expect(all.warnings.join(" ")).toContain("deprecated");
    expect(rankFive.variants).toHaveLength(1);
    expect(rankFive.variants[0]?.variant).toEqual({ rank: 5 });
    expect(rankFive.variants[0]?.closed.hours48).toHaveLength(1);
    expect(rankFive.variants[0]?.closed.days90).toHaveLength(1);
    expect(requests).toEqual([
      "https://api.warframe.market/v2/items",
      "https://api.warframe.market/v1/items/titania_prime/statistics",
    ]);
  });

  it("returns an explicit empty result", async () => {
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.endsWith("/v2/items")
          ? apiResponse([ITEM])
          : new Response(
              JSON.stringify({
                payload: {
                  statistics_closed: { "48hours": [], "90days": [] },
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            );
      }),
    });

    const result = await client.getItemStatistics("titania_prime");

    expect(result.status).toBe("empty");
    expect(result.variants).toEqual([]);
    expect(result.warnings.join(" ")).toContain("no closed-order buckets");
  });

  it("distinguishes an unknown slug before requesting legacy statistics", async () => {
    const requests: string[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push(url);
        return apiResponse([]);
      }),
    });

    await expect(client.getItemStatistics("missing_item")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(requests).toEqual(["https://api.warframe.market/v2/items"]);
  });

  it("distinguishes a removed legacy route from an unknown item", async () => {
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.endsWith("/v2/items")
          ? apiResponse([ITEM])
          : new Response(JSON.stringify({ error: "missing" }), { status: 404 });
      }),
    });

    await expect(client.getItemStatistics("titania_prime")).rejects.toMatchObject({
      code: "statistics_unavailable",
      message: expect.stringContaining("Текущие ордера остаются доступны"),
    });
  });

  it("distinguishes malformed JSON", async () => {
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.endsWith("/v2/items")
          ? apiResponse([ITEM])
          : new Response("{", { headers: { "Content-Type": "application/json" } });
      }),
    });

    await expect(client.getItemStatistics("titania_prime")).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("retries 429 with Retry-After and transient 5xx responses", async () => {
    let statisticsRequests = 0;
    const delays: number[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      retryBaseDelayMs: 1,
      random: () => 1,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/v2/items")) return apiResponse([ITEM]);
        statisticsRequests += 1;
        if (statisticsRequests === 1) {
          return new Response(null, { status: 429, headers: { "Retry-After": "2" } });
        }
        if (statisticsRequests === 2) return new Response(null, { status: 503 });
        return new Response(JSON.stringify(LEGACY_STATISTICS));
      }),
    });

    await client.getItemStatistics("titania_prime");

    expect(statisticsRequests).toBe(3);
    expect(delays).toEqual([2_000, 2]);
  });

  it("caches and deduplicates statistics independently of exact variant filtering", async () => {
    let statisticsRequests = 0;
    let resolveStatistics: ((response: Response) => void) | undefined;
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/v2/items")) return apiResponse([ITEM]);
        statisticsRequests += 1;
        return new Promise<Response>((resolve) => {
          resolveStatistics = resolve;
        });
      }),
    });

    const rankZero = client.getItemStatistics("titania_prime", undefined, { rank: 0 });
    const rankFive = client.getItemStatistics("titania_prime", undefined, { rank: 5 });
    await vi.waitFor(() => expect(statisticsRequests).toBe(1));
    resolveStatistics?.(new Response(JSON.stringify(LEGACY_STATISTICS)));

    const [zeroResult, fiveResult] = await Promise.all([rankZero, rankFive]);
    const cached = await client.getItemStatistics("titania_prime");

    expect(statisticsRequests).toBe(1);
    expect(zeroResult.variants[0]?.variant).toEqual({ rank: 0 });
    expect(fiveResult.variants[0]?.variant).toEqual({ rank: 5 });
    expect(cached.variants).toHaveLength(2);
  });

  it("refuses subtype aggregation when legacy statistics omit subtype", async () => {
    const subtypeItem = {
      ...ITEM,
      subtypes: ["regular", "atragraph"],
    };
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.endsWith("/v2/items")
          ? apiResponse([subtypeItem])
          : new Response(JSON.stringify(LEGACY_STATISTICS));
      }),
    });

    const result = await client.getItemStatistics("titania_prime");

    expect(result.status).toBe("unsupported_variant_dimensions");
    expect(result.variants).toEqual([]);
    expect(result.warnings.join(" ")).toContain("subtype");
  });
});

describe("Warframe Market liquidity", () => {
  it("combines the full order snapshot, exact top orders, and exact-rank history", async () => {
    const requests: string[] = [];
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      now: () => new Date("2026-07-26T10:00:00.000Z"),
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push(url);
        if (url === "https://api.warframe.market/v2/items") return apiResponse([ITEM]);
        if (url === "https://api.warframe.market/v2/orders/item/titania_prime") {
          return apiResponse(FULL_ORDERS);
        }
        if (url === "https://api.warframe.market/v1/items/titania_prime/statistics") {
          return new Response(JSON.stringify(LEGACY_STATISTICS));
        }
        if (
          url === "https://api.warframe.market/v2/orders/item/titania_prime/top?rank=5"
        ) {
          return apiResponse(RANK_FIVE_TOP_ORDERS);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const result = await client.getItemLiquidity("titania_prime", undefined, { rank: 5 });

    expect(result.filters.variant).toEqual({ rank: 5 });
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({
      variant: { rank: 5 },
      currentMarket: {
        activeSellOrders: 2,
        activeBuyOrders: 1,
        onlineSellOrders: 1,
        onlineBuyOrders: 1,
        bestSell: 100,
        bestBuy: 90,
        sellDepthAtBestPrice: 2,
        buyDepthAtBestPrice: 3,
      },
      history: {
        reportedClosedVolume48h: 1,
        reportedClosedVolume90d: 9,
        averageDailyClosedVolume90d: 0.1,
      },
      assessment: {
        score: expect.any(Number),
        grade: expect.any(String),
        confidence: "high",
      },
    });
    expect(result.warnings.join(" ")).toContain("local heuristic");
    expect(requests).toContain(
      "https://api.warframe.market/v2/orders/item/titania_prime/top?rank=5",
    );
  });

  it("degrades to current orders when deprecated history is unavailable", async () => {
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      maxRetries: 0,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://api.warframe.market/v2/items") return apiResponse([ITEM]);
        if (url === "https://api.warframe.market/v2/orders/item/titania_prime") {
          return apiResponse(FULL_ORDERS);
        }
        if (url === "https://api.warframe.market/v1/items/titania_prime/statistics") {
          return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
        }
        if (
          url === "https://api.warframe.market/v2/orders/item/titania_prime/top?rank=5"
        ) {
          return apiResponse(RANK_FIVE_TOP_ORDERS);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const result = await client.getItemLiquidity("titania_prime", undefined, { rank: 5 });

    expect(result.variants[0]?.currentMarket).toMatchObject({ bestSell: 100, bestBuy: 90 });
    expect(result.variants[0]?.history.averageDailyClosedVolume90d).toBeNull();
    expect(result.variants[0]?.assessment).toMatchObject({
      score: null,
      grade: "unknown",
      confidence: "low",
    });
    expect(result.variants[0]?.assessment.reasons).toContain("statistics_unavailable");
    expect(result.warnings.join(" ")).toContain("Historical statistics were unavailable");
  });

  it("falls back to the full order snapshot when exact top orders fail", async () => {
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      maxRetries: 0,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://api.warframe.market/v2/items") return apiResponse([ITEM]);
        if (url === "https://api.warframe.market/v2/orders/item/titania_prime") {
          return apiResponse(FULL_ORDERS);
        }
        if (url === "https://api.warframe.market/v1/items/titania_prime/statistics") {
          return new Response(JSON.stringify(LEGACY_STATISTICS));
        }
        if (url.includes("/top?rank=5")) return apiResponse(null, 503);
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const result = await client.getItemLiquidity("titania_prime", undefined, { rank: 5 });

    expect(result.variants[0]?.currentMarket).toMatchObject({ bestSell: 100, bestBuy: 90 });
    expect(result.warnings.join(" ")).toContain("Exact top orders were unavailable");
  });

  it("never uses a top order from a different rank", async () => {
    const wrongRankTop = {
      sell: [
        {
          ...FULL_ORDERS[0],
          id: "wrong-rank-sell",
          rank: 0,
          platinum: 1,
        },
      ],
      buy: [
        {
          ...FULL_ORDERS[2],
          id: "wrong-rank-buy",
          rank: 0,
          platinum: 999,
        },
      ],
    };
    const client = new WarframeMarketClient({
      limiter: noLimiter,
      fetcher: createFetch((input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://api.warframe.market/v2/items") return apiResponse([ITEM]);
        if (url === "https://api.warframe.market/v2/orders/item/titania_prime") {
          return apiResponse(FULL_ORDERS);
        }
        if (url === "https://api.warframe.market/v1/items/titania_prime/statistics") {
          return new Response(JSON.stringify(LEGACY_STATISTICS));
        }
        if (url.includes("/top?rank=5")) return apiResponse(wrongRankTop);
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const result = await client.getItemLiquidity("titania_prime", undefined, { rank: 5 });

    expect(result.variants[0]?.currentMarket).toMatchObject({ bestSell: 100, bestBuy: 90 });
    expect(result.warnings.join(" ")).toContain("did not preserve variant");
  });
});
