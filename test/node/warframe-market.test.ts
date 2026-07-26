import { describe, expect, it, vi } from "vitest";
import {
  LegacyMarketClient,
  LegacyRateLimiter,
  computeMedian,
  computeRetryDelayMs,
  computeSummary,
  parseRetryAfterMs,
} from "../../src/api/warframe-market.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  headers: Headers;
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function marketItemsResponse(items: unknown[]): Response {
  return jsonResponse({ apiVersion: "0.25.0", data: items, error: null });
}

/** Builds a fetch that follows a scripted sequence of responses or throws. */
function createFetch(
  handler: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    attempt: number,
  ) => Response | Promise<Response>,
): typeof fetch {
  let attempt = 0;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    attempt += 1;
    return handler(input, init, attempt);
  }) as typeof fetch;
}

function noopLimiter(): LegacyRateLimiter {
  const limiter = new LegacyRateLimiter();
  limiter.reset();
  // Bypass the wait by making sleep instant.
  return new LegacyRateLimiter({ sleep: async () => {} });
}

const neverAbortingFetch = createFetch(() => marketItemsResponse([]));

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("computeMedian", () => {
  it("returns the central value for odd-length inputs", () => {
    expect(computeMedian([10])).toBe(10);
    expect(computeMedian([10, 20, 30])).toBe(20);
  });

  it("averages the two central values for even-length inputs", () => {
    expect(computeMedian([10, 20])).toBe(15);
    expect(computeMedian([10, 20, 30, 40])).toBe(25);
  });

  it("returns null for an empty array", () => {
    expect(computeMedian([])).toBeNull();
  });

  it("assumes the input is already sorted ascending", () => {
    // Caller is responsible for sorting; the function reads positions verbatim.
    // [40, 10, 30, 20] → indices 1,2 → (10 + 30) / 2 = 20
    expect(computeMedian([40, 10, 30, 20])).toBe(20);
  });
});

describe("computeSummary", () => {
  it("produces the documented median for both parity cases and an empty sample", () => {
    expect(computeSummary([])).toEqual({ min: 0, max: 0, median: 0, average: 0, count: 0 });
    expect(computeSummary([10, 20, 30])).toMatchObject({ median: 20, count: 3 });
    expect(computeSummary([10, 20, 30, 40])).toMatchObject({ median: 25, count: 4 });
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds into milliseconds", () => {
    expect(parseRetryAfterMs("2", 0)).toBe(2_000);
    expect(parseRetryAfterMs("0", 0)).toBe(0);
  });

  it("parses HTTP dates relative to the supplied clock", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const future = new Date(now + 5_000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(5_000);
  });

  it("returns undefined for missing or unrecognized headers", () => {
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs("soon", 0)).toBeUndefined();
  });
});

describe("computeRetryDelayMs", () => {
  it("bounds the delay and applies deterministic jitter", () => {
    // random=1 → jitter factor = 1.0 → full bounded delay
    expect(computeRetryDelayMs(0, 100, 1_000, () => 1)).toBe(100);
    expect(computeRetryDelayMs(1, 100, 1_000, () => 1)).toBe(200);
    expect(computeRetryDelayMs(2, 100, 1_000, () => 1)).toBe(400);
    // random=0 → jitter factor = 0.5 → half delay
    expect(computeRetryDelayMs(2, 100, 1_000, () => 0)).toBe(200);
  });

  it("never exceeds maxDelayMs", () => {
    expect(computeRetryDelayMs(20, 100, 1_000, () => 1)).toBe(1_000);
  });
});

// ─── Rate limiter ────────────────────────────────────────────────────────────

describe("LegacyRateLimiter", () => {
  it("allows at most three starts per second under parallel pressure", async () => {
    let currentMs = 0;
    let releaseWait: (() => void) | undefined;
    const waits: number[] = [];
    const starts: number[] = [];
    const limiter = new LegacyRateLimiter({
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

    const tickets = [
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ];

    await vi.waitFor(() => expect(starts.length + waits.length).toBeGreaterThan(0));
    // Three requests reserve instantly at t=0.
    await Promise.all([tickets[0], tickets[1], tickets[2]].map((t) =>
      t.then(() => starts.push(currentMs)),
    ));
    // The fourth must wait for the window to slide.
    expect(waits).toEqual([1_000]);

    releaseWait?.();
    await tickets[3].then(() => starts.push(currentMs));

    expect(starts).toEqual([0, 0, 0, 1_000]);
  });
});

// ─── LegacyMarketClient retry & timeout behaviour ────────────────────────────

describe("LegacyMarketClient retries and timeouts", () => {
  function buildClient(options: ConstructorParameters<typeof LegacyMarketClient>[0] = {}) {
    return new LegacyMarketClient({
      limiter: noopLimiter(),
      // Fake timers make the injected sleep synchronous-ish; provide a no-op so
      // retry waits don't actually block on the fake clock.
      sleep: async () => {},
      random: () => 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      maxRetries: 2,
      timeoutMs: 5,
      fetcher: neverAbortingFetch,
      ...options,
    });
  }

  it("retries a 429 then succeeds", async () => {
    const client = buildClient({
      fetcher: createFetch((_input, _init, attempt) =>
        attempt === 1 ? jsonResponse(null, 429) : marketItemsResponse([]),
      ),
    });

    await expect(client.getItemsMap()).resolves.toBeInstanceOf(Map);
  });

  it("honours Retry-After in seconds before retrying", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = buildClient({
      maxRetries: 1,
      timeoutMs: 1_000,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetcher: createFetch(() => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(null, 429, { "Retry-After": "2" })
          : marketItemsResponse([]);
      }),
    });

    await client.getItemsMap();

    expect(attempts).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  it("honours Retry-After in HTTP-date form", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = buildClient({
      maxRetries: 1,
      timeoutMs: 1_000,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetcher: createFetch(() => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(null, 429, {
              "Retry-After": new Date(Date.UTC(2026, 0, 1, 0, 0, 5)).toUTCString(),
            })
          : marketItemsResponse([]);
      }),
    });

    await client.getItemsMap();

    expect(attempts).toBe(2);
    expect(delays).toEqual([5_000]);
  });

  it("rejects after the configured number of attempts on persistent 429", async () => {
    let attempts = 0;
    const client = buildClient({
      maxRetries: 2,
      fetcher: createFetch(() => {
        attempts += 1;
        return jsonResponse(null, 429);
      }),
    });

    await expect(client.getItemsMap()).rejects.toThrow(/3 attempt\(s\)/);
    expect(attempts).toBe(3);
  });

  it("rejects on persistent 503 after exhausting retries", async () => {
    let attempts = 0;
    const client = buildClient({
      maxRetries: 1,
      fetcher: createFetch(() => {
        attempts += 1;
        return jsonResponse(null, 503);
      }),
    });

    await expect(client.getItemsMap()).rejects.toThrow(/HTTP 503/);
    expect(attempts).toBe(2);
  });

  it("aborts a hanging fetch via the per-attempt timeout", async () => {
    let requests = 0;
    const client = buildClient({
      maxRetries: 0,
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

    await expect(client.getItemsMap()).rejects.toThrow(/5 мс/);
    expect(requests).toBe(1);
  });

  it("clears the timeout timer after a successful response", async () => {
    // If the timer weren't cleared in the success path, the abort it fires
    // would have no listener to reject — but we can detect a dangling timer
    // directly: a cleared timeout does not appear in vi.getTimerCount().
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    const client = new LegacyMarketClient({
      limiter: noopLimiter(),
      maxRetries: 0,
      timeoutMs: 5,
      sleep: async () => {},
      fetcher: createFetch(() => Promise.resolve(marketItemsResponse([]))),
    });

    await client.getItemsMap();

    // Exactly one timer is created per attempt (the abort). It must be cleared
    // before the call returns, so the net change in pending timers is zero.
    expect(vi.getTimerCount() - before).toBe(0);
  });

  it("clears the timeout timer after an error response", async () => {
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    const client = new LegacyMarketClient({
      limiter: noopLimiter(),
      maxRetries: 0,
      timeoutMs: 5,
      sleep: async () => {},
      fetcher: createFetch(() => Promise.resolve(jsonResponse(null, 500))),
    });

    await expect(client.getItemsMap()).rejects.toThrow();

    expect(vi.getTimerCount() - before).toBe(0);
  });

  it("retries a transient network error", async () => {
    let attempts = 0;
    const client = buildClient({
      maxRetries: 2,
      timeoutMs: 1_000,
      fetcher: createFetch(() => {
        attempts += 1;
        if (attempts < 3) throw new TypeError("network failure");
        return marketItemsResponse([]);
      }),
    });

    await client.getItemsMap();

    expect(attempts).toBe(3);
  });

  it("does not retry a 400 response", async () => {
    let attempts = 0;
    const client = buildClient({
      maxRetries: 2,
      fetcher: createFetch(() => {
        attempts += 1;
        return jsonResponse({ error: "bad request" }, 400);
      }),
    });

    await expect(client.getItemsMap()).rejects.toThrow(/HTTP 400/);
    expect(attempts).toBe(1);
  });
});

// ─── Headers and platform handling ───────────────────────────────────────────

describe("LegacyMarketClient platform headers", () => {
  function buildClient(fetcher: typeof fetch) {
    return new LegacyMarketClient({
      limiter: noopLimiter(),
      maxRetries: 0,
      timeoutMs: 1_000,
      fetcher,
    });
  }

  it("sends Platform, Crossplay, Language, and User-Agent on order requests", async () => {
    const requests: RecordedRequest[] = [];
    const client = buildClient(
      createFetch((input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers) });
        return marketItemsResponse([]);
      }),
    );

    await client.getOrders("ash_prime", { platform: "pc", crossplay: true, language: "en" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("Platform")).toBe("pc");
    expect(requests[0]?.headers.get("Crossplay")).toBe("true");
    expect(requests[0]?.headers.get("Language")).toBe("en");
    expect(requests[0]?.headers.get("User-Agent")).toMatch(/warframe-mcp/);
    expect(requests[0]?.headers.get("Accept")).toBe("application/json");
  });

  it("requests non-PC platforms upstream instead of filtering locally", async () => {
    const requests: RecordedRequest[] = [];
    const client = buildClient(
      createFetch((input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers) });
        return jsonResponse({
          apiVersion: "0.25.0",
          data: [
            {
              id: "1",
              type: "sell",
              platinum: 10,
              quantity: 1,
              user: {
                ingameName: "SwitchSeller",
                reputation: 1,
                platform: "switch",
                crossplay: true,
                status: "ingame",
              },
            },
          ],
        });
      }),
    );

    const orders = await client.getOrders("ash_prime", {
      platform: "switch",
      crossplay: true,
    });

    expect(orders).toHaveLength(1);
    expect(requests[0]?.headers.get("Platform")).toBe("switch");
    expect(requests[0]?.headers.get("Crossplay")).toBe("true");
  });
});
