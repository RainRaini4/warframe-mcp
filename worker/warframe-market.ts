export const WFM_API_BASE_URL = "https://api.warframe.market/v2";
export const WFM_ITEM_BASE_URL = "https://warframe.market/items/";

export const MARKET_LANGUAGES = [
  "ko",
  "ru",
  "de",
  "fr",
  "pt",
  "zh-hans",
  "zh-hant",
  "es",
  "it",
  "pl",
  "uk",
  "tr",
  "ja",
  "en",
] as const;
export const MARKET_PLATFORMS = ["pc", "ps4", "xbox", "switch", "mobile"] as const;

export type MarketLanguage = (typeof MARKET_LANGUAGES)[number];
export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];

export interface MarketFilters {
  language: MarketLanguage;
  platform: MarketPlatform;
  crossplay: boolean;
}

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  language: "ru",
  platform: "pc",
  crossplay: true,
};

export interface MarketSearchItem {
  id: string;
  slug: string;
  name_ru: string;
  name_en: string;
  url: string;
}

export interface MarketOrderUser {
  ingame_name: string;
  status: string;
  reputation: number;
  platform: string;
  crossplay: boolean;
}

export interface MarketTopOrder {
  id: string;
  platinum: number;
  quantity: number;
  per_trade?: number;
  rank?: number;
  subtype?: string;
  updated_at?: string;
  user: MarketOrderUser;
}

export interface SearchItemsResult {
  query: string;
  items: MarketSearchItem[];
  filters: MarketFilters;
  retrieved_at: string;
}

export interface TopOrdersResult {
  item: {
    slug: string;
    url: string;
  };
  sell: MarketTopOrder[];
  buy: MarketTopOrder[];
  filters: MarketFilters;
  retrieved_at: string;
}

export type WarframeMarketErrorCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "timeout"
  | "rate_limited"
  | "unavailable";

export class WarframeMarketError extends Error {
  constructor(
    public readonly code: WarframeMarketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WarframeMarketError";
  }
}

export class WarframeMarketValidationError extends WarframeMarketError {
  constructor(message: string) {
    super("validation", message);
    this.name = "WarframeMarketValidationError";
  }
}

export class WarframeMarketNotFoundError extends WarframeMarketError {
  constructor(message: string) {
    super("not_found", message);
    this.name = "WarframeMarketNotFoundError";
  }
}

export class WarframeMarketForbiddenError extends WarframeMarketError {
  constructor(message: string) {
    super("forbidden", message);
    this.name = "WarframeMarketForbiddenError";
  }
}

export class WarframeMarketTimeoutError extends WarframeMarketError {
  constructor(message: string) {
    super("timeout", message);
    this.name = "WarframeMarketTimeoutError";
  }
}

export class WarframeMarketRateLimitError extends WarframeMarketError {
  constructor(message: string) {
    super("rate_limited", message);
    this.name = "WarframeMarketRateLimitError";
  }
}

export class WarframeMarketUnavailableError extends WarframeMarketError {
  constructor(message: string) {
    super("unavailable", message);
    this.name = "WarframeMarketUnavailableError";
  }
}

interface ApiEnvelope<T> {
  data?: T | null;
  error?: unknown;
}

interface ApiItemI18n {
  name?: unknown;
}

interface ApiItem {
  id?: unknown;
  slug?: unknown;
  i18n?: Record<string, ApiItemI18n | undefined>;
}

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

interface RequestResult<T> {
  data: T;
  retrievedAt: string;
}

interface ItemsResult {
  items: ApiItem[];
  retrievedAt: string;
}

export interface MarketRequestLimiter {
  acquire(): Promise<void>;
}

interface SlidingWindowRateLimiterOptions {
  maxRequests?: number;
  nowMs?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  windowMs?: number;
}

export class SlidingWindowRateLimiter implements MarketRequestLimiter {
  private readonly maxRequests: number;
  private readonly nowMs: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly windowMs: number;
  private timestamps: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(options: SlidingWindowRateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 3;
    this.nowMs = options.nowMs ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.windowMs = options.windowMs ?? 1_000;
  }

  acquire(): Promise<void> {
    const ticket = this.tail.then(() => this.reserve());
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

export interface WarframeMarketClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  itemsCacheTtlMs?: number;
  limiter?: MarketRequestLimiter;
  maxRetries?: number;
  now?: () => Date;
  random?: () => number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
  topOrdersCacheTtlMs?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ITEMS_CACHE_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_TOP_ORDERS_CACHE_TTL_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_USER_AGENT = "warframe-mcp/1.0.0 (Cloudflare Workers; read-only)";
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504, 509]);
const responseCache = new Map<string, CachedValue<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const sharedRateLimiter = new SlidingWindowRateLimiter();

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function clearMarketItemsCache(): void {
  responseCache.clear();
  inFlightRequests.clear();
  sharedRateLimiter.reset();
}

export function normalizeMarketSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\p{M}+/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function itemUrl(slug: string): string {
  return new URL(encodeURIComponent(slug), WFM_ITEM_BASE_URL).toString();
}

function cacheKey(baseUrl: string, path: string, filters: MarketFilters): string {
  return JSON.stringify([
    `${baseUrl}${path}`,
    filters.language,
    filters.platform,
    filters.crossplay,
  ]);
}

function retryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

function exponentialBackoffMs(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const boundedDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  const jitter = 0.5 + Math.max(0, Math.min(1, random())) * 0.5;
  return Math.round(boundedDelay * jitter);
}

class RetryableNetworkError extends Error {
  constructor() {
    super("Retryable Warframe Market network error");
    this.name = "RetryableNetworkError";
  }
}

async function loadCached<T>(
  key: string,
  ttlMs: number,
  nowMs: () => number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = responseCache.get(key) as CachedValue<T> | undefined;
  if (cached && cached.expiresAt > nowMs()) return cached.value;
  if (cached) responseCache.delete(key);

  const pending = inFlightRequests.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  let request: Promise<T>;
  request = loader()
    .then((value) => {
      responseCache.set(key, {
        expiresAt: nowMs() + ttlMs,
        value,
      });
      return value;
    })
    .finally(() => {
      if (inFlightRequests.get(key) === request) {
        inFlightRequests.delete(key);
      }
    });
  inFlightRequests.set(key, request);
  return request;
}

function resolveFilters(overrides?: Partial<MarketFilters>): MarketFilters {
  return {
    language: overrides?.language ?? DEFAULT_MARKET_FILTERS.language,
    platform: overrides?.platform ?? DEFAULT_MARKET_FILTERS.platform,
    crossplay: overrides?.crossplay ?? DEFAULT_MARKET_FILTERS.crossplay,
  };
}

function readName(item: ApiItem, language: MarketLanguage): string | undefined {
  const name = item.i18n?.[language]?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function mergeLocalizedItems(primary: ApiItem[], russian: ApiItem[]): ApiItem[] {
  const russianById = new Map(
    russian
      .filter((item) => typeof item.id === "string")
      .map((item) => [item.id as string, item]),
  );

  return primary.map((item) => {
    const localized = typeof item.id === "string" ? russianById.get(item.id) : undefined;
    const ru = localized?.i18n?.ru;

    if (!ru) return item;

    return {
      ...item,
      i18n: {
        ...item.i18n,
        ru,
      },
    };
  });
}

function toSearchItem(item: ApiItem): MarketSearchItem | undefined {
  if (typeof item.id !== "string" || typeof item.slug !== "string") return undefined;

  const nameRu = readName(item, "ru");
  const nameEn = readName(item, "en");
  if (!nameRu || !nameEn) return undefined;

  return {
    id: item.id,
    slug: item.slug,
    name_ru: nameRu,
    name_en: nameEn,
    url: itemUrl(item.slug),
  };
}

function matchRank(item: MarketSearchItem, query: string): { kind: number; length: number } | undefined {
  const candidates = [item.name_ru, item.name_en, item.slug].map(normalizeMarketSearchText);
  let bestKind = Number.POSITIVE_INFINITY;
  let bestLength = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === query) {
      bestKind = 0;
      bestLength = Math.min(bestLength, candidate.length);
    } else if (candidate.includes(query) && bestKind > 0) {
      bestKind = 1;
      bestLength = Math.min(bestLength, candidate.length);
    }
  }

  return Number.isFinite(bestKind) ? { kind: bestKind, length: bestLength } : undefined;
}

function toTopOrder(value: unknown): MarketTopOrder | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string") return undefined;
  if (typeof value.platinum !== "number" || !Number.isFinite(value.platinum)) return undefined;
  if (typeof value.quantity !== "number" || !Number.isFinite(value.quantity)) return undefined;

  const user = isRecord(value.user) ? value.user : {};
  const order: MarketTopOrder = {
    id: value.id,
    platinum: value.platinum,
    quantity: value.quantity,
    user: {
      ingame_name: typeof user.ingameName === "string" ? user.ingameName : "unknown",
      status: typeof user.status === "string" ? user.status : "unknown",
      reputation: typeof user.reputation === "number" ? user.reputation : 0,
      platform: typeof user.platform === "string" ? user.platform : "unknown",
      crossplay: typeof user.crossplay === "boolean" ? user.crossplay : false,
    },
  };

  if (typeof value.perTrade === "number") order.per_trade = value.perTrade;
  if (typeof value.rank === "number") order.rank = value.rank;
  if (typeof value.subtype === "string") order.subtype = value.subtype;
  if (typeof value.updatedAt === "string") order.updated_at = value.updatedAt;

  return order;
}

export class WarframeMarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly itemsCacheTtlMs: number;
  private readonly limiter: MarketRequestLimiter;
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly topOrdersCacheTtlMs: number;
  private readonly userAgent: string;

  constructor(options: WarframeMarketClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? WFM_API_BASE_URL;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.itemsCacheTtlMs = options.itemsCacheTtlMs ?? DEFAULT_ITEMS_CACHE_TTL_MS;
    this.limiter = options.limiter ?? sharedRateLimiter;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.sleep = options.sleep ?? wait;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.topOrdersCacheTtlMs =
      options.topOrdersCacheTtlMs ?? DEFAULT_TOP_ORDERS_CACHE_TTL_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async searchItems(
    query: string,
    limit = 10,
    filterOverrides?: Partial<MarketFilters>,
  ): Promise<SearchItemsResult> {
    const normalizedQuery = normalizeMarketSearchText(query);
    if (!normalizedQuery) {
      throw new WarframeMarketValidationError("Поисковый запрос не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const primary = await this.getItems(filters);
    let items = primary.items;
    let retrievedAt = primary.retrievedAt;

    if (filters.language !== "ru") {
      const russian = await this.getItems({ ...filters, language: "ru" });
      items = mergeLocalizedItems(items, russian.items);
      retrievedAt = [retrievedAt, russian.retrievedAt].sort().at(-1) ?? retrievedAt;
    }

    const matches = items
      .map(toSearchItem)
      .filter((item): item is MarketSearchItem => item !== undefined)
      .map((item) => ({ item, rank: matchRank(item, normalizedQuery) }))
      .filter((entry): entry is { item: MarketSearchItem; rank: { kind: number; length: number } } => entry.rank !== undefined)
      .sort((left, right) =>
        left.rank.kind - right.rank.kind ||
        left.rank.length - right.rank.length ||
        left.item.name_en.localeCompare(right.item.name_en),
      )
      .slice(0, limit)
      .map((entry) => entry.item);

    return {
      query,
      items: matches,
      filters,
      retrieved_at: retrievedAt,
    };
  }

  async getTopOrders(
    slug: string,
    filterOverrides?: Partial<MarketFilters>,
  ): Promise<TopOrdersResult> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const path = `/orders/item/${encodeURIComponent(normalizedSlug)}/top`;
    return loadCached(
      cacheKey(this.baseUrl, path, filters),
      this.topOrdersCacheTtlMs,
      () => this.now().getTime(),
      async () => {
        const result = await this.request<unknown>(path, filters, normalizedSlug);

        if (
          !isRecord(result.data) ||
          !Array.isArray(result.data.sell) ||
          !Array.isArray(result.data.buy)
        ) {
          throw new WarframeMarketUnavailableError(
            "Warframe Market API вернул некорректный формат top orders.",
          );
        }

        const sell = result.data.sell
          .map(toTopOrder)
          .filter((order): order is MarketTopOrder => order !== undefined)
          .sort(
            (left, right) =>
              left.platinum - right.platinum || left.id.localeCompare(right.id),
          );
        const buy = result.data.buy
          .map(toTopOrder)
          .filter((order): order is MarketTopOrder => order !== undefined)
          .sort(
            (left, right) =>
              right.platinum - left.platinum || left.id.localeCompare(right.id),
          );

        return {
          item: {
            slug: normalizedSlug,
            url: itemUrl(normalizedSlug),
          },
          sell,
          buy,
          filters,
          retrieved_at: result.retrievedAt,
        };
      },
    );
  }

  private async getItems(filters: MarketFilters): Promise<ItemsResult> {
    const path = "/items";
    return loadCached(
      cacheKey(this.baseUrl, path, filters),
      this.itemsCacheTtlMs,
      () => this.now().getTime(),
      async () => {
        const result = await this.request<unknown>(path, filters);
        if (!Array.isArray(result.data)) {
          throw new WarframeMarketUnavailableError(
            "Warframe Market API вернул некорректный формат списка предметов.",
          );
        }

        return {
          items: result.data.filter(isRecord) as ApiItem[],
          retrievedAt: result.retrievedAt,
        };
      },
    );
  }

  private async request<T>(
    path: string,
    filters: MarketFilters,
    itemSlug?: string,
  ): Promise<RequestResult<T>> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let result: RequestResult<T> | Response;
      try {
        result = await this.requestAttempt<T>(path, filters, itemSlug);
      } catch (error) {
        if (!(error instanceof RetryableNetworkError)) throw error;

        if (attempt < this.maxRetries) {
          await this.sleep(
            exponentialBackoffMs(
              attempt,
              this.retryBaseDelayMs,
              this.retryMaxDelayMs,
              this.random,
            ),
          );
          continue;
        }

        throw new WarframeMarketUnavailableError(
          "Warframe Market API временно недоступен из-за сетевой ошибки.",
        );
      }

      if (!(result instanceof Response)) return result;

      if (attempt < this.maxRetries) {
        const delay =
          retryAfterMs(result.headers.get("Retry-After"), this.now().getTime()) ??
          exponentialBackoffMs(
            attempt,
            this.retryBaseDelayMs,
            this.retryMaxDelayMs,
            this.random,
          );
        await this.sleep(delay);
        continue;
      }

      if (result.status === 429) {
        throw new WarframeMarketRateLimitError(
          "Warframe Market API временно ограничил частоту запросов (HTTP 429).",
        );
      }

      throw new WarframeMarketUnavailableError(
        `Warframe Market API временно недоступен (HTTP ${result.status}).`,
      );
    }

    throw new WarframeMarketUnavailableError("Warframe Market API временно недоступен.");
  }

  private async requestAttempt<T>(
    path: string,
    filters: MarketFilters,
    itemSlug?: string,
  ): Promise<RequestResult<T> | Response> {
    await this.limiter.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
          Language: filters.language,
          Platform: filters.platform,
          Crossplay: String(filters.crossplay),
        },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new WarframeMarketTimeoutError(
          `Warframe Market API не ответил за ${this.timeoutMs} мс.`,
        );
      }

      throw new RetryableNetworkError();
    }

    if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
      clearTimeout(timeout);
      return response;
    }

    if (response.status === 400) {
      clearTimeout(timeout);
      throw new WarframeMarketValidationError(
        "Warframe Market API отклонил параметры запроса (HTTP 400).",
      );
    }

    if (response.status === 403) {
      clearTimeout(timeout);
      throw new WarframeMarketForbiddenError(
        "Warframe Market API запретил доступ к ресурсу (HTTP 403).",
      );
    }

    if (response.status === 404) {
      clearTimeout(timeout);
      throw new WarframeMarketNotFoundError(
        itemSlug
          ? `Предмет "${itemSlug}" не найден в Warframe Market (404).`
          : "Ресурс Warframe Market не найден (404).",
      );
    }

    if (!response.ok) {
      clearTimeout(timeout);
      throw new WarframeMarketUnavailableError(
        `Warframe Market API недоступен (HTTP ${response.status}).`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new WarframeMarketTimeoutError(
          `Warframe Market API не ответил за ${this.timeoutMs} мс.`,
        );
      }

      throw new WarframeMarketUnavailableError(
        "Warframe Market API вернул некорректный JSON-ответ.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!isRecord(body) || !("data" in body)) {
      throw new WarframeMarketUnavailableError(
        "Warframe Market API вернул некорректный JSON-ответ.",
      );
    }

    const envelope = body as ApiEnvelope<T>;
    if (envelope.error || envelope.data === null || envelope.data === undefined) {
      throw new WarframeMarketUnavailableError(
        "Warframe Market API вернул ошибку в ответе.",
      );
    }

    return {
      data: envelope.data,
      retrievedAt: this.now().toISOString(),
    };
  }
}

export const warframeMarketClient = new WarframeMarketClient();
