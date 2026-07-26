import type {
  MarketSearchItem,
  MarketTopOrder,
  TopOrdersResult,
} from "./warframe-market.js";

const DOCUMENT_ID_PREFIX = "wfm:item:";
const MARKET_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const MARKET_SNAPSHOT_WARNING =
  "Это текущий снимок рынка; цены и доступность ордеров могут измениться.";

export type WfmDocumentErrorCode = "invalid_id" | "unsupported_type" | "unknown_slug";

export class WfmDocumentError extends Error {
  constructor(
    public readonly code: WfmDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WfmDocumentError";
  }
}

export interface OpenAiSearchResult {
  id: string;
  title: string;
  text: string;
  url: string;
}

export interface OpenAiSearchOutput {
  results: OpenAiSearchResult[];
}

export interface OpenAiFetchMetadata {
  source: "warframe.market";
  slug: string;
  name_ru: string;
  name_en: string;
  language: string;
  platform: string;
  crossplay: boolean;
  retrieved_at: string;
  warning: string;
  top_sell_orders: MarketTopOrder[];
  top_buy_orders: MarketTopOrder[];
}

export interface OpenAiFetchDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: OpenAiFetchMetadata;
}

export function toWfmItemDocumentId(slug: string): string {
  const normalizedSlug = slug.trim();
  if (!MARKET_SLUG_PATTERN.test(normalizedSlug)) {
    throw new WfmDocumentError(
      "invalid_id",
      `Некорректный slug предмета "${slug}".`,
    );
  }

  return `${DOCUMENT_ID_PREFIX}${normalizedSlug}`;
}

export function parseWfmItemDocumentId(id: string): string {
  const parts = id.split(":");
  if (parts.length >= 2 && (parts[0] !== "wfm" || parts[1] !== "item")) {
    throw new WfmDocumentError(
      "unsupported_type",
      `Неподдерживаемый тип ID "${id}". Ожидается wfm:item:<slug>.`,
    );
  }

  if (
    parts.length !== 3 ||
    !parts[2] ||
    !MARKET_SLUG_PATTERN.test(parts[2])
  ) {
    throw new WfmDocumentError(
      "invalid_id",
      `Некорректный ID "${id}". Ожидается wfm:item:<slug>.`,
    );
  }

  return parts[2];
}

export function toOpenAiSearchResult(item: MarketSearchItem): OpenAiSearchResult {
  return {
    id: toWfmItemDocumentId(item.slug),
    title: `${item.name_ru} / ${item.name_en}`,
    text: `Предмет Warframe Market: ${item.name_ru} / ${item.name_en}; slug: ${item.slug}.`,
    url: item.url,
  };
}

function formatDocumentOrder(order: MarketTopOrder, index: number): string {
  return `${index + 1}. ${order.platinum} platinum; quantity ${order.quantity}; ${order.user.ingame_name} (${order.user.status})`;
}

function formatDocumentOrders(orders: MarketTopOrder[]): string {
  return orders.length > 0
    ? orders.map(formatDocumentOrder).join("\n")
    : "Нет активных ордеров в текущем снимке.";
}

export function toOpenAiFetchDocument(
  item: MarketSearchItem,
  orders: TopOrdersResult,
): OpenAiFetchDocument {
  const title = `${item.name_ru} / ${item.name_en}`;
  const metadata: OpenAiFetchMetadata = {
    source: "warframe.market",
    slug: item.slug,
    name_ru: item.name_ru,
    name_en: item.name_en,
    language: orders.filters.language,
    platform: orders.filters.platform,
    crossplay: orders.filters.crossplay,
    retrieved_at: orders.retrieved_at,
    warning: MARKET_SNAPSHOT_WARNING,
    top_sell_orders: orders.sell,
    top_buy_orders: orders.buy,
  };
  const text = [
    `Warframe Market: ${title}`,
    `Русское имя: ${item.name_ru}`,
    `English name: ${item.name_en}`,
    `Slug: ${item.slug}`,
    `URL: ${item.url}`,
    `Platform: ${orders.filters.platform}`,
    `Crossplay: ${String(orders.filters.crossplay)}`,
    `Retrieved at: ${orders.retrieved_at}`,
    `Warning: ${MARKET_SNAPSHOT_WARNING}`,
    "",
    "Top sell orders (lowest price first):",
    formatDocumentOrders(orders.sell),
    "",
    "Top buy orders (highest price first):",
    formatDocumentOrders(orders.buy),
  ].join("\n");

  return {
    id: toWfmItemDocumentId(item.slug),
    title,
    text,
    url: item.url,
    metadata,
  };
}
