import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import type { MarketVariantKey } from "./market-analytics.js";
import {
  parseWfmItemDocumentId,
  toOpenAiFetchDocument,
  toOpenAiSearchResult,
  WfmDocumentError,
} from "./openai-compat.js";
import {
  DEFAULT_MARKET_FILTERS,
  MARKET_LANGUAGES,
  MARKET_PLATFORMS,
  type MarketFilters,
  type MarketTopOrder,
  type WarframeMarketClient,
  WarframeMarketError,
  warframeMarketClient,
} from "./warframe-market.js";

const SERVICE_NAME = "warframe-mcp";
const SERVICE_VERSION = "1.0.0";

const filterInputSchema = {
  language: z
    .enum(MARKET_LANGUAGES)
    .default(DEFAULT_MARKET_FILTERS.language)
    .optional()
    .describe("Warframe Market response language"),
  platform: z
    .enum(MARKET_PLATFORMS)
    .default(DEFAULT_MARKET_FILTERS.platform)
    .optional()
    .describe("Trading platform"),
  crossplay: z
    .boolean()
    .default(DEFAULT_MARKET_FILTERS.crossplay)
    .optional()
    .describe("Include crossplay-compatible orders"),
};

const filterOutputSchema = z.object({
  language: z.enum(MARKET_LANGUAGES),
  platform: z.enum(MARKET_PLATFORMS),
  crossplay: z.boolean(),
});

const orderOutputSchema = z.object({
  id: z.string(),
  type: z.enum(["sell", "buy"]).optional(),
  platinum: z.number(),
  quantity: z.number(),
  per_trade: z.number().optional(),
  rank: z.number().optional(),
  subtype: z.string().optional(),
  charges: z.number().optional(),
  amberStars: z.number().optional(),
  cyanStars: z.number().optional(),
  visible: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  user: z.object({
    ingame_name: z.string(),
    status: z.string(),
    reputation: z.number(),
    platform: z.string(),
    crossplay: z.boolean(),
  }),
});

const variantInputSchema = {
  rank: z.number().int().min(0).optional().describe("Exact item rank"),
  subtype: z.string().trim().min(1).max(100).optional().describe("Exact item subtype"),
  charges: z.number().int().min(0).optional().describe("Exact remaining charges"),
  amberStars: z.number().int().min(0).optional().describe("Exact amber star count"),
  cyanStars: z.number().int().min(0).optional().describe("Exact cyan star count"),
};

const variantOutputSchema = z.object({
  rank: z.number().int().min(0).optional(),
  subtype: z.string().optional(),
  charges: z.number().int().min(0).optional(),
  amberStars: z.number().int().min(0).optional(),
  cyanStars: z.number().int().min(0).optional(),
});

const statisticPointOutputSchema = z.object({
  datetime: z.string(),
  volume: z.number().nullable(),
  minPrice: z.number().nullable(),
  maxPrice: z.number().nullable(),
  averagePrice: z.number().nullable(),
  weightedAveragePrice: z.number().nullable(),
  medianPrice: z.number().nullable(),
  openPrice: z.number().nullable(),
  closePrice: z.number().nullable(),
  variant: variantOutputSchema,
});

const statisticsSummaryOutputSchema = z.object({
  reportedClosedVolume: z.number(),
  bucketCount: z.number().int().min(0),
  bucketsWithVolume: z.number().int().min(0),
  averageVolumePerBucket: z.number().nullable(),
  latestMedianPrice: z.number().nullable(),
  weightedMedianPrice: z.number().nullable(),
  weightedAveragePrice: z.number().nullable(),
  firstTimestamp: z.string().nullable(),
  lastTimestamp: z.string().nullable(),
});

const statisticsVariantOutputSchema = z.object({
  variant: variantOutputSchema,
  closed: z.object({
    hours48: z.array(statisticPointOutputSchema),
    days90: z.array(statisticPointOutputSchema),
  }),
  summaries: z.object({
    hours48: statisticsSummaryOutputSchema.nullable(),
    days90: statisticsSummaryOutputSchema.nullable(),
  }),
});

const statisticsOutputSchema = {
  item: z.object({
    slug: z.string(),
    url: z.string().url(),
  }),
  filters: z.object({
    platform: z.enum(MARKET_PLATFORMS),
    crossplay: z.boolean(),
    variant: variantOutputSchema.optional(),
  }),
  status: z.enum(["available", "empty", "unsupported_variant_dimensions"]),
  variants: z.array(statisticsVariantOutputSchema),
  source: z.object({
    api: z.literal("warframe-market-v1"),
    deprecated: z.literal(true),
    description: z.string(),
  }),
  retrievedAt: z.string(),
  warnings: z.array(z.string()),
};

const liquidityVariantOutputSchema = z.object({
  variant: variantOutputSchema,
  currentMarket: z.object({
    activeSellOrders: z.number().int().min(0),
    activeBuyOrders: z.number().int().min(0),
    onlineSellOrders: z.number().int().min(0),
    onlineBuyOrders: z.number().int().min(0),
    bestSell: z.number().nullable(),
    bestBuy: z.number().nullable(),
    midpoint: z.number().nullable(),
    absoluteSpread: z.number().nullable(),
    spreadPercent: z.number().nullable(),
    sellDepthAtBestPrice: z.number().min(0),
    buyDepthAtBestPrice: z.number().min(0),
  }),
  history: z.object({
    reportedClosedVolume48h: z.number().nullable(),
    reportedClosedVolume90d: z.number().nullable(),
    averageDailyClosedVolume90d: z.number().nullable(),
    latestMedianPrice48h: z.number().nullable(),
    weightedAveragePrice48h: z.number().nullable(),
  }),
  assessment: z.object({
    score: z.number().min(0).max(100).nullable(),
    grade: z.enum(["very_high", "high", "medium", "low", "very_low", "unknown"]),
    confidence: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.string()),
  }),
});

const liquidityOutputSchema = {
  item: z.object({
    slug: z.string(),
    url: z.string().url(),
  }),
  filters: z.object({
    platform: z.enum(MARKET_PLATFORMS),
    crossplay: z.boolean(),
    variant: variantOutputSchema.optional(),
  }),
  variants: z.array(liquidityVariantOutputSchema),
  retrievedAt: z.string(),
  warnings: z.array(z.string()),
};

const openAiSearchOutputSchema = {
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      url: z.string().url(),
    }),
  ).max(10),
};

const openAiFetchOutputSchema = {
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string().url(),
  metadata: z.object({
    source: z.literal("warframe.market"),
    slug: z.string(),
    name_ru: z.string(),
    name_en: z.string(),
    language: z.enum(MARKET_LANGUAGES),
    platform: z.enum(MARKET_PLATFORMS),
    crossplay: z.boolean(),
    retrieved_at: z.string(),
    warning: z.string(),
    top_sell_orders: z.array(orderOutputSchema),
    top_buy_orders: z.array(orderOutputSchema),
  }),
};

export interface Env {}

function resolveToolFilters(input: Partial<MarketFilters>): MarketFilters {
  return {
    language: input.language ?? DEFAULT_MARKET_FILTERS.language,
    platform: input.platform ?? DEFAULT_MARKET_FILTERS.platform,
    crossplay: input.crossplay ?? DEFAULT_MARKET_FILTERS.crossplay,
  };
}

function resolveVariantFilter(input: MarketVariantKey): MarketVariantKey | undefined {
  const variant: MarketVariantKey = {};
  if (input.rank !== undefined) variant.rank = input.rank;
  if (input.subtype !== undefined) variant.subtype = input.subtype;
  if (input.charges !== undefined) variant.charges = input.charges;
  if (input.amberStars !== undefined) variant.amberStars = input.amberStars;
  if (input.cyanStars !== undefined) variant.cyanStars = input.cyanStars;
  return Object.keys(variant).length > 0 ? variant : undefined;
}

function toolError(error: unknown) {
  const message =
    error instanceof WarframeMarketError || error instanceof WfmDocumentError
      ? error.message
      : "Не удалось обработать запрос к Warframe Market.";

  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function formatOrderLine(order: MarketTopOrder): string {
  const quantity = order.quantity > 1 ? ` ×${order.quantity}` : "";
  return `${order.platinum}p${quantity} — ${order.user.ingame_name} (${order.user.status})`;
}

function formatOrders(orders: MarketTopOrder[]): string {
  return orders.length > 0 ? orders.map(formatOrderLine).join("; ") : "нет ордеров";
}

export function createWorkerMcpServer(
  client: WarframeMarketClient = warframeMarketClient,
): McpServer {
  const server = new McpServer({
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
  });

  server.registerTool(
    "wfm_search_items",
    {
      description:
        "Search Warframe Market items by Russian name, English name, or slug. Returns read-only item identifiers and absolute market URLs.",
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Item name or slug"),
        limit: z.number().int().min(1).max(20).default(10).optional(),
        ...filterInputSchema,
      },
      outputSchema: {
        query: z.string(),
        items: z.array(
          z.object({
            id: z.string(),
            slug: z.string(),
            name_ru: z.string(),
            name_en: z.string(),
            url: z.string().url(),
          }),
        ),
        filters: filterOutputSchema,
        retrieved_at: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit, language, platform, crossplay }) => {
      try {
        const result = await client.searchItems(
          query,
          limit ?? 10,
          resolveToolFilters({ language, platform, crossplay }),
        );
        const lines = result.items.map(
          (item, index) =>
            `${index + 1}. ${item.name_ru} / ${item.name_en} (${item.slug}) — ${item.url}`,
        );
        const text =
          lines.length > 0
            ? `Найдено предметов: ${result.items.length}\n${lines.join("\n")}`
            : `По запросу "${query}" предметы не найдены.`;

        return {
          content: [{ type: "text", text }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "wfm_get_top_orders",
    {
      description:
        "Get current top sell and buy orders for a Warframe Market item slug. Sell prices are ascending and buy prices descending.",
      inputSchema: {
        slug: z.string().trim().min(1).max(200).describe("Slug from wfm_search_items"),
        ...filterInputSchema,
      },
      outputSchema: {
        item: z.object({
          slug: z.string(),
          url: z.string().url(),
        }),
        sell: z.array(orderOutputSchema),
        buy: z.array(orderOutputSchema),
        filters: filterOutputSchema,
        retrieved_at: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ slug, language, platform, crossplay }) => {
      try {
        const result = await client.getTopOrders(
          slug,
          resolveToolFilters({ language, platform, crossplay }),
        );
        const text = [
          `Top orders: ${result.item.slug}`,
          `Sell: ${formatOrders(result.sell)}`,
          `Buy: ${formatOrders(result.buy)}`,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "wfm_get_item_statistics",
    {
      description:
        "Get deprecated Warframe Market v1 closed-order statistics for the last 48 hours and 90 days. Reported volume is not a complete or independently verified count of in-game trades. Rank, subtype, charges, and Ayatan star variants are never intentionally combined.",
      inputSchema: {
        slug: z.string().trim().min(1).max(200).describe("Slug from wfm_search_items"),
        platform: z
          .enum(MARKET_PLATFORMS)
          .default(DEFAULT_MARKET_FILTERS.platform)
          .optional()
          .describe("Trading platform"),
        crossplay: z
          .boolean()
          .default(DEFAULT_MARKET_FILTERS.crossplay)
          .optional()
          .describe("Include crossplay-compatible statistics"),
        ...variantInputSchema,
      },
      outputSchema: statisticsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      slug,
      platform,
      crossplay,
      rank,
      subtype,
      charges,
      amberStars,
      cyanStars,
    }) => {
      try {
        const result = await client.getItemStatistics(
          slug,
          resolveToolFilters({ platform, crossplay }),
          resolveVariantFilter({ rank, subtype, charges, amberStars, cyanStars }),
        );
        const text = [
          `Closed-order statistics: ${result.item.slug}`,
          `Status: ${result.status}`,
          `Variants: ${result.variants.length}`,
          `Retrieved at: ${result.retrievedAt}`,
          ...result.warnings.map((warning) => `Warning: ${warning}`),
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "wfm_get_item_liquidity",
    {
      description:
        "Estimate item liquidity per exact rank, subtype, charges, or Ayatan star variant from the current visible order book and deprecated closed-order statistics. Returns a deterministic 0-100 local heuristic, grade, confidence, component metrics, reasons, and explicit warnings; it does not predict execution or profit.",
      inputSchema: {
        slug: z.string().trim().min(1).max(200).describe("Slug from wfm_search_items"),
        platform: z
          .enum(MARKET_PLATFORMS)
          .default(DEFAULT_MARKET_FILTERS.platform)
          .optional()
          .describe("Trading platform"),
        crossplay: z
          .boolean()
          .default(DEFAULT_MARKET_FILTERS.crossplay)
          .optional()
          .describe("Include crossplay-compatible orders and statistics"),
        ...variantInputSchema,
      },
      outputSchema: liquidityOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      slug,
      platform,
      crossplay,
      rank,
      subtype,
      charges,
      amberStars,
      cyanStars,
    }) => {
      try {
        const result = await client.getItemLiquidity(
          slug,
          resolveToolFilters({ platform, crossplay }),
          resolveVariantFilter({ rank, subtype, charges, amberStars, cyanStars }),
        );
        const variantLines = result.variants.map(
          (entry) =>
            `${JSON.stringify(entry.variant)}: score=${entry.assessment.score ?? "unknown"}, grade=${entry.assessment.grade}, confidence=${entry.assessment.confidence}`,
        );
        const text = [
          `Liquidity estimate: ${result.item.slug}`,
          ...variantLines,
          `Retrieved at: ${result.retrievedAt}`,
          ...result.warnings.map((warning) => `Warning: ${warning}`),
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "search",
    {
      title: "Search Warframe Market",
      description:
        "Search Warframe Market items by Russian name, English name, or slug. Returns OpenAI-compatible citation results for use with fetch.",
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Item search query"),
      },
      outputSchema: openAiSearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query }) => {
      try {
        const searchResult = await client.searchItems(
          query,
          10,
          DEFAULT_MARKET_FILTERS,
        );
        const output = {
          results: searchResult.items.slice(0, 10).map(toOpenAiSearchResult),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch Warframe Market item",
      description:
        "Fetch the current Warframe Market top sell and buy orders for a stable item ID returned by search.",
      inputSchema: {
        id: z.string().min(1).max(300).describe("Stable ID returned by search"),
      },
      outputSchema: openAiFetchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      try {
        const slug = parseWfmItemDocumentId(id);
        const searchResult = await client.searchItems(
          slug,
          10,
          DEFAULT_MARKET_FILTERS,
        );
        const item = searchResult.items.find((candidate) => candidate.slug === slug);

        if (!item) {
          return toolError(
            new WfmDocumentError(
              "unknown_slug",
              `Предмет со slug "${slug}" не найден в Warframe Market.`,
            ),
          );
        }

        const orders = await client.getTopOrders(slug, DEFAULT_MARKET_FILTERS);
        const document = toOpenAiFetchDocument(item, orders);

        return {
          content: [{ type: "text", text: JSON.stringify(document) }],
          structuredContent: { ...document },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }

      return Response.json({
        status: "ok",
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
      });
    }

    if (url.pathname === "/mcp") {
      const server = createWorkerMcpServer();
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default worker;
