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
  i18n: {
    ru: { name: "Титания Прайм" },
    en: { name: "Titania Prime" },
  },
};

const TOP_ORDERS = {
  sell: [],
  buy: [],
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
