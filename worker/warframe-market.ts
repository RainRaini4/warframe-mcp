import {
  buildLiquidityVariants,
  collectLiquidityVariants,
  type MarketHistoryStatus,
  type MarketItemVariantCapabilities,
  type MarketVariantTopOrders,
  type MarketStatisticsVariantResult,
  type MarketVariantKey,
  type LiquidityMarketOrder,
  type LiquidityVariantResult,
  marketVariantFromOrder,
  marketVariantKey,
  normalizeLegacyStatistics,
  normalizeMarketVariant,
} from "./market-analytics.js";

export const WFM_API_BASE_URL = "https://api.warframe.market/v2";
export const WFM_LEGACY_API_BASE_URL = "https://api.warframe.market/v1";
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
  type?: "sell" | "buy";
  platinum: number;
  quantity: number;
  per_trade?: number;
  rank?: number;
  subtype?: string;
  charges?: number;
  amberStars?: number;
  cyanStars?: number;
  visible?: boolean;
  created_at?: string;
  updated_at?: string;
  user: MarketOrderUser;
}

export interface MarketOrder extends MarketTopOrder {
  type: "sell" | "buy";
  visible: boolean;
  created_at?: string;
}

export interface MarketItemDescriptor {
  id: string;
  slug: string;
  capabilities: MarketItemVariantCapabilities;
}

export interface ItemStatisticsResult {
  item: {
    slug: string;
    url: string;
  };
  filters: {
    platform: MarketPlatform;
    crossplay: boolean;
    variant?: MarketVariantKey;
  };
  status: MarketHistoryStatus;
  variants: MarketStatisticsVariantResult[];
  source: {
    api: "warframe-market-v1";
    deprecated: true;
    description: string;
  };
  retrievedAt: string;
  warnings: string[];
}

export interface OrdersResult {
  item: {
    slug: string;
    url: string;
  };
  orders: MarketOrder[];
  filters: MarketFilters;
  retrieved_at: string;
}

export interface ItemLiquidityResult {
  item: {
    slug: string;
    url: string;
  };
  filters: {
    platform: MarketPlatform;
    crossplay: boolean;
    variant?: MarketVariantKey;
  };
  variants: LiquidityVariantResult[];
  retrievedAt: string;
  warnings: string[];
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
  | "unavailable"
  | "malformed_response"
  | "statistics_unavailable";

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

export class WarframeMarketMalformedResponseError extends WarframeMarketError {
  constructor(message: string) {
    super("malformed_response", message);
    this.name = "WarframeMarketMalformedResponseError";
  }
}

export class WarframeMarketStatisticsUnavailableError extends WarframeMarketError {
  constructor(message: string) {
    super("statistics_unavailable", message);
    this.name = "WarframeMarketStatisticsUnavailableError";
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
  maxRank?: unknown;
  subtypes?: unknown;
  maxCharges?: unknown;
  maxAmberStars?: unknown;
  maxCyanStars?: unknown;
}

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

interface RequestResult<T> {
  data: T;
  retrievedAt: string;
}

interface JsonRequestResult<T> {
  body: T;
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
  legacyBaseUrl?: string;
  limiter?: MarketRequestLimiter;
  maxRetries?: number;
  now?: () => Date;
  ordersCacheTtlMs?: number;
  random?: () => number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  statisticsCacheTtlMs?: number;
  timeoutMs?: number;
  topOrdersCacheTtlMs?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ITEMS_CACHE_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_TOP_ORDERS_CACHE_TTL_MS = 20_000;
const DEFAULT_ORDERS_CACHE_TTL_MS = 20_000;
export const DEFAULT_STATISTICS_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_USER_AGENT = "warframe-mcp/1.0.0 (Cloudflare Workers; read-only)";
const LEGACY_STATISTICS_SOURCE_DESCRIPTION =
  "Deprecated and unsupported Warframe Market v1 closed-order statistics. Reported volume is not a complete or independently verified record of in-game trades.";
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
  if (value.type === "sell" || value.type === "buy") order.type = value.type;
  if (typeof value.rank === "number") order.rank = value.rank;
  if (typeof value.subtype === "string") order.subtype = value.subtype;
  if (typeof value.charges === "number") order.charges = value.charges;
  if (typeof value.amberStars === "number") order.amberStars = value.amberStars;
  if (typeof value.cyanStars === "number") order.cyanStars = value.cyanStars;
  if (typeof value.visible === "boolean") order.visible = value.visible;
  if (typeof value.createdAt === "string") order.created_at = value.createdAt;
  if (typeof value.updatedAt === "string") order.updated_at = value.updatedAt;

  return order;
}

function toMarketOrder(value: unknown): MarketOrder | undefined {
  const order = toTopOrder(value);
  if (!order || (order.type !== "sell" && order.type !== "buy")) return undefined;
  if (order.visible === undefined) return undefined;
  return order as MarketOrder;
}

function toLiquidityOrder(
  order: MarketTopOrder,
  type: "sell" | "buy",
): LiquidityMarketOrder {
  return {
    id: order.id,
    type,
    platinum: order.platinum,
    quantity: order.quantity,
    visible: order.visible ?? true,
    ...(order.rank !== undefined ? { rank: order.rank } : {}),
    ...(order.subtype !== undefined ? { subtype: order.subtype } : {}),
    ...(order.charges !== undefined ? { charges: order.charges } : {}),
    ...(order.amberStars !== undefined ? { amberStars: order.amberStars } : {}),
    ...(order.cyanStars !== undefined ? { cyanStars: order.cyanStars } : {}),
    user: { status: order.user.status },
  };
}

function variantQuery(variant?: MarketVariantKey): string {
  if (!variant) return "";
  const params = new URLSearchParams();
  if (variant.rank !== undefined) params.set("rank", String(variant.rank));
  if (variant.subtype !== undefined) params.set("subtype", variant.subtype);
  if (variant.charges !== undefined) params.set("charges", String(variant.charges));
  if (variant.amberStars !== undefined) {
    params.set("amberStars", String(variant.amberStars));
  }
  if (variant.cyanStars !== undefined) {
    params.set("cyanStars", String(variant.cyanStars));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function toItemDescriptor(item: ApiItem): MarketItemDescriptor | undefined {
  if (typeof item.id !== "string" || typeof item.slug !== "string") return undefined;

  const capabilities: MarketItemVariantCapabilities = {};
  const maxRank = optionalNonNegativeInteger(item.maxRank);
  const maxCharges = optionalNonNegativeInteger(item.maxCharges);
  const maxAmberStars = optionalNonNegativeInteger(item.maxAmberStars);
  const maxCyanStars = optionalNonNegativeInteger(item.maxCyanStars);
  const subtypes = Array.isArray(item.subtypes)
    ? item.subtypes.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];

  if (maxRank !== undefined) capabilities.maxRank = maxRank;
  if (subtypes.length > 0) capabilities.subtypes = subtypes;
  if (maxCharges !== undefined) capabilities.maxCharges = maxCharges;
  if (maxAmberStars !== undefined) capabilities.maxAmberStars = maxAmberStars;
  if (maxCyanStars !== undefined) capabilities.maxCyanStars = maxCyanStars;

  return { id: item.id, slug: item.slug, capabilities };
}

function validateVariantFilter(
  variant: MarketVariantKey | undefined,
  capabilities: MarketItemVariantCapabilities,
): MarketVariantKey | undefined {
  if (!variant) return undefined;
  const normalized = normalizeMarketVariant(variant);

  const validateBoundedField = (
    field: "rank" | "charges" | "amberStars" | "cyanStars",
    maximum: number | undefined,
  ) => {
    const value = normalized[field];
    if (value === undefined) return;
    if (maximum === undefined) {
      throw new WarframeMarketValidationError(
        `Предмет не поддерживает variant-поле ${field}.`,
      );
    }
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      throw new WarframeMarketValidationError(
        `Значение ${field} должно быть целым числом от 0 до ${maximum}.`,
      );
    }
  };

  validateBoundedField("rank", capabilities.maxRank);
  validateBoundedField("charges", capabilities.maxCharges);
  validateBoundedField("amberStars", capabilities.maxAmberStars);
  validateBoundedField("cyanStars", capabilities.maxCyanStars);

  if (normalized.subtype !== undefined) {
    if (!capabilities.subtypes?.includes(normalized.subtype)) {
      throw new WarframeMarketValidationError(
        `Предмет не поддерживает subtype "${normalized.subtype}".`,
      );
    }
  }

  return normalized;
}

export class WarframeMarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly itemsCacheTtlMs: number;
  private readonly legacyBaseUrl: string;
  private readonly limiter: MarketRequestLimiter;
  private readonly maxRetries: number;
  private readonly now: () => Date;
  private readonly ordersCacheTtlMs: number;
  private readonly random: () => number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly statisticsCacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly topOrdersCacheTtlMs: number;
  private readonly userAgent: string;

  constructor(options: WarframeMarketClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? WFM_API_BASE_URL;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.itemsCacheTtlMs = options.itemsCacheTtlMs ?? DEFAULT_ITEMS_CACHE_TTL_MS;
    this.legacyBaseUrl = options.legacyBaseUrl ?? WFM_LEGACY_API_BASE_URL;
    this.limiter = options.limiter ?? sharedRateLimiter;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.now = options.now ?? (() => new Date());
    this.ordersCacheTtlMs = options.ordersCacheTtlMs ?? DEFAULT_ORDERS_CACHE_TTL_MS;
    this.random = options.random ?? Math.random;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.sleep = options.sleep ?? wait;
    this.statisticsCacheTtlMs =
      options.statisticsCacheTtlMs ?? DEFAULT_STATISTICS_CACHE_TTL_MS;
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
    variantFilter?: MarketVariantKey,
  ): Promise<TopOrdersResult> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const path = `/orders/item/${encodeURIComponent(normalizedSlug)}/top${variantQuery(variantFilter)}`;
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

  async getOrders(
    slug: string,
    filterOverrides?: Partial<MarketFilters>,
  ): Promise<OrdersResult> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const path = `/orders/item/${encodeURIComponent(normalizedSlug)}`;
    return loadCached(
      cacheKey(this.baseUrl, path, filters),
      this.ordersCacheTtlMs,
      () => this.now().getTime(),
      async () => {
        const result = await this.request<unknown>(path, filters, normalizedSlug);
        if (!Array.isArray(result.data)) {
          throw new WarframeMarketMalformedResponseError(
            "Warframe Market API вернул некорректный формат полного списка ордеров.",
          );
        }

        const orders = result.data
          .map(toMarketOrder)
          .filter((order): order is MarketOrder => order !== undefined)
          .sort((left, right) => left.id.localeCompare(right.id));

        return {
          item: {
            slug: normalizedSlug,
            url: itemUrl(normalizedSlug),
          },
          orders,
          filters,
          retrieved_at: result.retrievedAt,
        };
      },
    );
  }

  async getItemDescriptor(
    slug: string,
    filterOverrides?: Partial<MarketFilters>,
  ): Promise<MarketItemDescriptor> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const items = await this.getItems(filters);
    const descriptor = items.items
      .map(toItemDescriptor)
      .find((item) => item?.slug === normalizedSlug);
    if (!descriptor) {
      throw new WarframeMarketNotFoundError(
        `Предмет "${normalizedSlug}" не найден в Warframe Market.`,
      );
    }
    return descriptor;
  }

  async getItemStatistics(
    slug: string,
    filterOverrides?: Partial<MarketFilters>,
    variantFilter?: MarketVariantKey,
  ): Promise<ItemStatisticsResult> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const item = await this.getItemDescriptor(normalizedSlug, filters);
    const variant = validateVariantFilter(variantFilter, item.capabilities);
    const path = `/items/${encodeURIComponent(normalizedSlug)}/statistics`;

    const statistics = await loadCached(
      cacheKey(this.legacyBaseUrl, path, filters),
      this.statisticsCacheTtlMs,
      () => this.now().getTime(),
      async () => {
        let result: JsonRequestResult<unknown>;
        try {
          result = await this.requestJson<unknown>(
            this.legacyBaseUrl,
            path,
            filters,
            normalizedSlug,
          );
        } catch (error) {
          if (error instanceof WarframeMarketNotFoundError) {
            throw new WarframeMarketStatisticsUnavailableError(
              "Legacy statistics endpoint не вернул данные для существующего предмета. Текущие ордера остаются доступны.",
            );
          }
          throw error;
        }

        if (!isRecord(result.body) || !isRecord(result.body.payload)) {
          throw new WarframeMarketMalformedResponseError(
            "Legacy statistics endpoint вернул некорректный JSON-контракт.",
          );
        }

        const closed = result.body.payload.statistics_closed;
        if (!isRecord(closed)) {
          throw new WarframeMarketMalformedResponseError(
            "Legacy statistics endpoint не вернул payload.statistics_closed.",
          );
        }

        const hours48 = closed["48hours"];
        const days90 = closed["90days"];
        if (!Array.isArray(hours48) || !Array.isArray(days90)) {
          throw new WarframeMarketMalformedResponseError(
            "Legacy statistics endpoint не вернул диапазоны 48hours и 90days.",
          );
        }

        return { hours48, days90, retrievedAt: result.retrievedAt };
      },
    );
    const normalized = normalizeLegacyStatistics(
      statistics.hours48,
      statistics.days90,
      item.capabilities,
      variant,
    );

    return {
      item: {
        slug: normalizedSlug,
        url: itemUrl(normalizedSlug),
      },
      filters: {
        platform: filters.platform,
        crossplay: filters.crossplay,
        ...(variant ? { variant } : {}),
      },
      status: normalized.status,
      variants: normalized.variants,
      source: {
        api: "warframe-market-v1",
        deprecated: true,
        description: LEGACY_STATISTICS_SOURCE_DESCRIPTION,
      },
      retrievedAt: statistics.retrievedAt,
      warnings: [
        "Legacy v1 statistics are deprecated and may become unavailable without notice.",
        "reportedClosedVolume is the volume reported by Warframe Market, not a complete or independently verified count of in-game trades.",
        ...normalized.warnings,
      ],
    };
  }

  async getItemLiquidity(
    slug: string,
    filterOverrides?: Partial<MarketFilters>,
    variantFilter?: MarketVariantKey,
  ): Promise<ItemLiquidityResult> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new WarframeMarketValidationError("Slug предмета не должен быть пустым.");
    }

    const filters = resolveFilters(filterOverrides);
    const item = await this.getItemDescriptor(normalizedSlug, filters);
    const variant = validateVariantFilter(variantFilter, item.capabilities);
    const warnings = [
      "Liquidity is a local heuristic derived from a current public-order snapshot and deprecated v1 closed-order statistics; it is not a guarantee of execution or profit.",
      "Current order counts include visible listings; online counts include users with online or ingame status.",
    ];

    const [orders, statisticsOutcome] = await Promise.all([
      this.getOrders(normalizedSlug, filters),
      this.getItemStatistics(normalizedSlug, filters, variant)
        .then((statistics) => ({ ok: true as const, statistics }))
        .catch((error: unknown) => ({ ok: false as const, error })),
    ]);

    let historyStatus: MarketHistoryStatus | "unavailable" = "unavailable";
    let historyUnavailableReason: string | undefined = "statistics_unavailable";
    let statisticsVariants: MarketStatisticsVariantResult[] = [];
    let statisticsRetrievedAt: string | undefined;

    if (statisticsOutcome.ok) {
      historyStatus = statisticsOutcome.statistics.status;
      historyUnavailableReason = undefined;
      statisticsVariants = statisticsOutcome.statistics.variants;
      statisticsRetrievedAt = statisticsOutcome.statistics.retrievedAt;
      warnings.push(...statisticsOutcome.statistics.warnings);
    } else {
      const error = statisticsOutcome.error;
      if (
        error instanceof WarframeMarketValidationError ||
        error instanceof WarframeMarketNotFoundError
      ) {
        throw error;
      }
      if (!(error instanceof WarframeMarketError)) throw error;
      warnings.push(`Historical statistics were unavailable: ${error.message}`);
    }

    const liquidityOrders = orders.orders.map((order) => toLiquidityOrder(order, order.type));
    const variants = collectLiquidityVariants(liquidityOrders, statisticsVariants, variant);
    const topResults = await Promise.allSettled(
      variants.map((entry) => this.getTopOrders(normalizedSlug, filters, entry)),
    );
    const topOrdersByVariant = new Map<string, MarketVariantTopOrders>();
    const retrievedAtValues = [orders.retrieved_at];
    if (statisticsRetrievedAt) retrievedAtValues.push(statisticsRetrievedAt);

    topResults.forEach((result, index) => {
      const entry = variants[index];
      if (!entry) return;
      const key = marketVariantKey(entry);
      if (result.status === "fulfilled") {
        const sell = result.value.sell.map((order) => toLiquidityOrder(order, "sell"));
        const buy = result.value.buy.map((order) => toLiquidityOrder(order, "buy"));
        const topOrdersMatchVariant = [...sell, ...buy].every(
          (order) => marketVariantKey(marketVariantFromOrder(order)) === key,
        );
        if (topOrdersMatchVariant) {
          topOrdersByVariant.set(key, { sell, buy });
        } else {
          warnings.push(
            `Exact top orders did not preserve variant ${key}; best prices were derived from the full current-order snapshot.`,
          );
        }
        retrievedAtValues.push(result.value.retrieved_at);
      } else {
        warnings.push(
          `Exact top orders were unavailable for variant ${key}; best prices were derived from the full current-order snapshot.`,
        );
      }
    });

    return {
      item: {
        slug: normalizedSlug,
        url: itemUrl(normalizedSlug),
      },
      filters: {
        platform: filters.platform,
        crossplay: filters.crossplay,
        ...(variant ? { variant } : {}),
      },
      variants: buildLiquidityVariants(variants, liquidityOrders, statisticsVariants, {
        historyStatus,
        historyUnavailableReason,
        topOrdersByVariant,
      }),
      retrievedAt: retrievedAtValues.sort().at(-1) ?? orders.retrieved_at,
      warnings: [...new Set(warnings)],
    };
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
    const result = await this.requestJson<ApiEnvelope<T>>(
      this.baseUrl,
      path,
      filters,
      itemSlug,
    );
    if (!isRecord(result.body) || !("data" in result.body)) {
      throw new WarframeMarketMalformedResponseError(
        "Warframe Market API вернул некорректный JSON-ответ.",
      );
    }

    const envelope = result.body as ApiEnvelope<T>;
    if (envelope.error || envelope.data === null || envelope.data === undefined) {
      throw new WarframeMarketUnavailableError(
        "Warframe Market API вернул ошибку в ответе.",
      );
    }

    return { data: envelope.data, retrievedAt: result.retrievedAt };
  }

  private async requestJson<T>(
    baseUrl: string,
    path: string,
    filters: MarketFilters,
    itemSlug?: string,
  ): Promise<JsonRequestResult<T>> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let result: JsonRequestResult<T> | Response;
      try {
        result = await this.requestJsonAttempt<T>(baseUrl, path, filters, itemSlug);
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

  private async requestJsonAttempt<T>(
    baseUrl: string,
    path: string,
    filters: MarketFilters,
    itemSlug?: string,
  ): Promise<JsonRequestResult<T> | Response> {
    await this.limiter.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetcher(`${baseUrl}${path}`, {
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

      throw new WarframeMarketMalformedResponseError(
        "Warframe Market API вернул некорректный JSON-ответ.",
      );
    } finally {
      clearTimeout(timeout);
    }

    return {
      body: body as T,
      retrievedAt: this.now().toISOString(),
    };
  }
}

export const warframeMarketClient = new WarframeMarketClient();
