import { TTLCache, TTL } from "../utils/cache.js";
import type {
  MarketItem,
  MarketOrder,
  MarketOrdersResponse,
  MarketPriceResult,
  PriceSummary,
} from "../types/index.js";

const BASE_URL = "https://api.warframe.market/v2";

// ─── Reliability constants ───────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_USER_AGENT = "warframe-mcp/1.0.0 (legacy Node; read-only)";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_PLATFORM = "pc";
// Switch orders are exposed via the crossplay index, so crossplay must be on
// for non-PC platforms to receive the upstream data the caller asked for.
const DEFAULT_CROSSPLAY = true;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504, 509]);

// ─── Pure helpers (exported for unit testing) ────────────────────────────────

/**
 * Median of an already-sorted ascending array. Returns null for empty input.
 * Odd length → central element; even length → average of the two central ones.
 */
export function computeMedian(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[mid];
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

/** Min/max/median/average/count for a price sample. Empty input → zeroed summary. */
export function computeSummary(prices: number[]): PriceSummary {
  if (prices.length === 0) {
    return { min: 0, max: 0, median: 0, average: 0, count: 0 };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const median = computeMedian(sorted);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: median ?? 0,
    average: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    count: sorted.length,
  };
}

/**
 * Parse a `Retry-After` header into a delay in milliseconds.
 * Supports plain seconds and HTTP-date forms. Returns undefined when the
 * header is missing or does not look like a value the upstream would accept.
 */
export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number,
): number | undefined {
  if (!headerValue) return undefined;

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0 && /^\s*\d+(\.\d+)?\s*$/.test(headerValue)) {
    return Math.ceil(seconds * 1_000);
  }

  const dateMs = Date.parse(headerValue);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

/**
 * Bounded exponential backoff with [0.5×, 1×] jitter, capped at maxDelayMs.
 * Pure: callers inject the RNG so tests stay deterministic.
 */
export function computeRetryDelayMs(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const boundedDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  const jitter = 0.5 + Math.max(0, Math.min(1, random())) * 0.5;
  return Math.round(boundedDelay * jitter);
}

// ─── Serialized sliding-window rate limiter ──────────────────────────────────

export interface LegacyRateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  nowMs?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

/**
 * Serialized sliding-window limiter: at most `maxRequests` request starts per
 * `windowMs`. A promise tail serializes reservations so parallel callers cannot
 * compute the same slack simultaneously or wake in a burst above the limit.
 */
export class LegacyRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly nowMs: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private timestamps: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(options: LegacyRateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 3;
    this.windowMs = options.windowMs ?? 1_000;
    this.nowMs = options.nowMs ?? Date.now;
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  acquire(): Promise<void> {
    const ticket = this.tail.then(() => this.reserve());
    // Swallow rejection on the tail so one failing reservation cannot break the
    // chain for unrelated callers; the original error still propagates via the
    // returned ticket.
    this.tail = ticket.catch(() => undefined);
    return ticket;
  }

  reset(): void {
    this.timestamps = [];
    this.tail = Promise.resolve();
  }

  private async reserve(): Promise<void> {
    while (true) {
      const current = this.nowMs();
      this.timestamps = this.timestamps.filter(
        (timestamp) => current - timestamp < this.windowMs,
      );

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps = [...this.timestamps, current];
        return;
      }

      const oldest = this.timestamps[0] ?? current;
      await this.sleep(Math.max(0, this.windowMs - (current - oldest)));
    }
  }
}

// ─── Client options ──────────────────────────────────────────────────────────

export interface LegacyMarketFilters {
  language: string;
  platform: string;
  crossplay: boolean;
}

export interface LegacyMarketClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  limiter?: LegacyRateLimiter;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  defaultLanguage?: string;
  defaultPlatform?: string;
  defaultCrossplay?: boolean;
  userAgent?: string;
  itemsCacheTtlMs?: number;
}

interface GetOrdersOptions {
  platform?: string;
  crossplay?: boolean;
  language?: string;
}

interface PriceCheckOptions {
  modRank?: number;
  onlineOnly?: boolean;
  platform?: string;
  crossplay?: boolean;
  language?: string;
}

class RetryableLegacyNetworkError extends Error {
  constructor() {
    super("Retryable Warframe Market network error");
    this.name = "RetryableLegacyNetworkError";
  }
}

// ─── Legacy client ───────────────────────────────────────────────────────────

export class LegacyMarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private readonly limiter: LegacyRateLimiter;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly defaultFilters: LegacyMarketFilters;
  private readonly userAgent: string;
  private readonly itemsCache: TTLCache<unknown>;

  constructor(options: LegacyMarketClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.random = options.random ?? Math.random;
    this.limiter = options.limiter ?? new LegacyRateLimiter();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.defaultFilters = {
      language: options.defaultLanguage ?? DEFAULT_LANGUAGE,
      platform: options.defaultPlatform ?? DEFAULT_PLATFORM,
      crossplay: options.defaultCrossplay ?? DEFAULT_CROSSPLAY,
    };
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.itemsCache = new TTLCache<unknown>();
  }

  /** Returns Map<normalizedName, slug>. Cached for the configured TTL. */
  async getItemsMap(): Promise<Map<string, string>> {
    const cacheKey = "market:items";
    const hit = this.itemsCache.get(cacheKey) as Map<string, string> | undefined;
    if (hit) return hit;

    const response = await this.get<{ data: MarketItem[] }>("/items", this.defaultFilters);
    const items = response.data ?? (response as unknown as MarketItem[]);
    const map = new Map<string, string>();

    for (const item of items) {
      const name = item.i18n?.en?.name;
      if (name && item.slug) {
        map.set(name.toLowerCase().trim(), item.slug);
      }
    }

    this.itemsCache.set(cacheKey, map, TTL.MARKET_ITEMS);
    return map;
  }

  /** Resolves item name to market slug. Throws with suggestions if not found. */
  async resolveSlug(itemName: string): Promise<string> {
    const map = await this.getItemsMap();
    const normalized = itemName.toLowerCase().trim();

    // Exact match
    const exact = map.get(normalized);
    if (exact) return exact;

    // Contains match — pick shortest key
    const containsMatches: Array<[string, string]> = [];
    for (const [key, slug] of map) {
      if (key.includes(normalized)) {
        containsMatches.push([key, slug]);
      }
    }
    if (containsMatches.length > 0) {
      containsMatches.sort((a, b) => a[0].length - b[0].length);
      return containsMatches[0][1];
    }

    // No match — suggest closest
    const allKeys = Array.from(map.keys());
    const scored = allKeys
      .map((key) => ({ key, score: substringScore(key, normalized) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const suggestions =
      scored.length > 0
        ? scored.map((s) => `  • ${s.key}`).join("\n")
        : "  (no similar items found)";

    throw new Error(
      `Item "${itemName}" not found on warframe.market.\nDid you mean:\n${suggestions}`,
    );
  }

  /** Fetch live orders for a slug, filtered upstream by platform/crossplay/language. */
  async getOrders(slug: string, options?: GetOrdersOptions): Promise<MarketOrder[]> {
    const filters = this.resolveFilters(options);
    const response = await this.get<MarketOrdersResponse>(
      `/orders/item/${slug}`,
      filters,
    );
    return response.data ?? [];
  }

  /** Full price check pipeline. */
  async priceCheck(
    itemName: string,
    options?: PriceCheckOptions,
  ): Promise<MarketPriceResult> {
    const onlineOnly = options?.onlineOnly ?? true;
    const modRank = options?.modRank;
    const filters = this.resolveFilters(options);
    const platform = filters.platform;

    const slug = await this.resolveSlug(itemName);
    let orders = await this.getOrders(slug, filters);

    // Filter offline
    if (onlineOnly) {
      orders = orders.filter((o) => o.user.status !== "offline");
    }

    // Filter by mod rank
    if (modRank !== undefined) {
      orders = orders.filter((o) => o.rank === modRank);
    }

    // Defensive post-filter: upstream headers already scope the order book to
    // the requested platform, but crossplay orders can still carry a different
    // platform marker and must remain visible to the caller.
    orders = orders.filter(
      (o) => o.user.platform === platform || o.user.crossplay,
    );

    const sells = orders
      .filter((o) => o.type === "sell")
      .sort((a, b) => a.platinum - b.platinum);
    const buys = orders
      .filter((o) => o.type === "buy")
      .sort((a, b) => b.platinum - a.platinum);

    const sellSummary = computeSummary(sells.map((o) => o.platinum));
    const buySummary = computeSummary(buys.map((o) => o.platinum));

    const cheapestSellers = sells.slice(0, 5).map((o) => ({
      ingameName: o.user.ingameName,
      platinum: o.platinum,
      quantity: o.quantity,
      status: o.user.status,
      rank: o.rank,
    }));

    // Resolve display name from items map
    const map = await this.getItemsMap();
    let displayName = itemName;
    for (const [key, s] of map) {
      if (s === slug) {
        displayName = key
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        break;
      }
    }

    return {
      itemName: displayName,
      slug,
      sell: sellSummary,
      buy: buySummary,
      cheapestSellers,
    };
  }

  private resolveFilters(overrides?: GetOrdersOptions | PriceCheckOptions): LegacyMarketFilters {
    return {
      language: overrides?.language ?? this.defaultFilters.language,
      platform: overrides?.platform ?? this.defaultFilters.platform,
      crossplay: overrides?.crossplay ?? this.defaultFilters.crossplay,
    };
  }

  private buildHeaders(filters: LegacyMarketFilters): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": this.userAgent,
      Language: filters.language,
      Platform: filters.platform,
      Crossplay: String(filters.crossplay),
    };
  }

  /**
   * Bounded HTTP GET with timeout, Retry-After / backoff, and a finite retry
   * loop. Replaces the previous unbounded recursion on 429.
   */
  private async get<T>(path: string, filters: LegacyMarketFilters): Promise<T> {
    let lastFailure: { kind: "http" | "network" | "timeout"; detail: string } | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.limiter.acquire();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          headers: this.buildHeaders(filters),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        if (aborted) {
          lastFailure = { kind: "timeout", detail: `${this.timeoutMs} мс` };
        } else {
          lastFailure = { kind: "network", detail: error instanceof Error ? error.name : "network error" };
        }

        if (attempt < this.maxRetries && lastFailure.kind !== "timeout") {
          await this.sleep(
            computeRetryDelayMs(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs, this.random),
          );
          continue;
        }
        break;
      }

      clearTimeout(timer);

      if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
        lastFailure = { kind: "http", detail: `HTTP ${response.status}` };
        if (attempt < this.maxRetries) {
          const retryAfter = parseRetryAfterMs(response.headers.get("Retry-After"), this.now().getTime());
          const delay = retryAfter ??
            computeRetryDelayMs(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs, this.random);
          await this.sleep(delay);
          continue;
        }
        break;
      }

      if (!response.ok) {
        throw new Error(`warframe.market HTTP ${response.status}: ${path}`);
      }

      return (await response.json()) as T;
    }

    const attempts = this.maxRetries + 1;
    const detail = lastFailure
      ? lastFailure.kind === "http" || lastFailure.kind === "timeout"
        ? lastFailure.detail
        : lastFailure.detail
      : "unknown error";
    throw new Error(
      `warframe.market request failed after ${attempts} attempt(s): ${path} (${detail})`,
    );
  }

  /** Test-only escape hatch to reset the items cache between unit tests. */
  resetItemsCache(): void {
    this.itemsCache.clear();
  }
}

function substringScore(candidate: string, query: string): number {
  let score = 0;
  const words = query.split(/\s+/);
  for (const word of words) {
    if (candidate.includes(word)) score += word.length;
  }
  return score;
}

// ─── Singleton + thin wrappers (backward-compatible public API) ──────────────

export const legacyMarketClient = new LegacyMarketClient();

export async function getItemsMap(): Promise<Map<string, string>> {
  return legacyMarketClient.getItemsMap();
}

export async function resolveSlug(itemName: string): Promise<string> {
  return legacyMarketClient.resolveSlug(itemName);
}

export async function getOrders(slug: string): Promise<MarketOrder[]> {
  return legacyMarketClient.getOrders(slug);
}

export async function priceCheck(
  itemName: string,
  options?: { modRank?: number; onlineOnly?: boolean; platform?: string },
): Promise<MarketPriceResult> {
  return legacyMarketClient.priceCheck(itemName, options);
}
