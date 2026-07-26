import { SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseWfmItemDocumentId,
  toWfmItemDocumentId,
} from "../worker/openai-compat.js";
import {
  WarframeMarketClient,
  clearMarketItemsCache,
  normalizeMarketSearchText,
} from "../worker/warframe-market.js";

const RETRIEVED_AT = "2026-07-26T08:00:00.000Z";

const ITEMS = [
  {
    id: "item-titania",
    slug: "titania_prime",
    i18n: {
      ru: { name: "Титания Прайм" },
      en: { name: "Titania Prime" },
    },
  },
  {
    id: "item-titania-blueprint",
    slug: "titania_prime_blueprint",
    i18n: {
      ru: { name: "Титания Прайм: Чертёж" },
      en: { name: "Titania Prime Blueprint" },
    },
  },
  {
    id: "item-capacity",
    slug: "void_capacity",
    i18n: {
      ru: { name: "Ёмкость-Бездны" },
      en: { name: "Void Capacity" },
    },
  },
];

const TOP_ORDERS = {
  sell: [
    {
      id: "sell-48",
      type: "sell",
      platinum: 48,
      quantity: 1,
      updatedAt: "2026-07-26T07:50:00Z",
      user: {
        ingameName: "Seller48",
        status: "online",
        reputation: 12,
        platform: "pc",
        crossplay: true,
      },
    },
    {
      id: "sell-42",
      type: "sell",
      platinum: 42,
      quantity: 2,
      perTrade: 1,
      user: {
        ingameName: "Seller42",
        status: "ingame",
        reputation: 25,
        platform: "pc",
        crossplay: true,
      },
    },
  ],
  buy: [
    {
      id: "buy-35",
      type: "buy",
      platinum: 35,
      quantity: 1,
      user: {
        ingameName: "Buyer35",
        status: "online",
        reputation: 8,
        platform: "pc",
        crossplay: true,
      },
    },
    {
      id: "buy-40",
      type: "buy",
      platinum: 40,
      quantity: 3,
      user: {
        ingameName: "Buyer40",
        status: "ingame",
        reputation: 31,
        platform: "pc",
        crossplay: true,
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return handler as typeof fetch;
}

function mockWorkerApi(path: string, body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    createFetch((input) => {
      expect(requestUrl(input)).toBe(`https://api.warframe.market/v2${path}`);
      return jsonResponse(body, status);
    }),
  );
}

async function withMcpClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("https://example.com/mcp"),
    { fetch: (input, init) => SELF.fetch(input, init) },
  );
  const client = new Client({
    name: "warframe-worker-test",
    version: "1.0.0",
  });

  await client.connect(transport);

  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

beforeEach(() => {
  clearMarketItemsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Warframe Market client", () => {
  it("normalizes Unicode, case, ё/е, separators, punctuation, and whitespace", () => {
    expect(normalizeMarketSearchText("  ЁМКОСТЬ__Бездны—Prime!!!  ")).toBe(
      "емкость бездны prime",
    );
    expect(normalizeMarketSearchText("Е\u0308мкость-бездны")).toBe("емкость бездны");
  });

  it("searches Russian, English, and slug with exact matches ranked first", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const client = new WarframeMarketClient({
      fetcher: createFetch((input, init) => {
        requests.push({ url: requestUrl(input), headers: new Headers(init?.headers) });
        return jsonResponse({ apiVersion: "0.25.0", data: ITEMS, error: null });
      }),
      now: () => new Date(RETRIEVED_AT),
    });

    const russian = await client.searchItems("ТИТАНИЯ прайм");
    const english = await client.searchItems("Titania Prime");
    const slug = await client.searchItems("titania-prime_blueprint");
    const yo = await client.searchItems("емкость  бездны!!!");

    expect(russian.items.map((item) => item.slug)).toEqual([
      "titania_prime",
      "titania_prime_blueprint",
    ]);
    expect(english.items[0]?.slug).toBe("titania_prime");
    expect(slug.items[0]?.slug).toBe("titania_prime_blueprint");
    expect(yo.items[0]?.slug).toBe("void_capacity");
    expect(russian.items[0]).toEqual({
      id: "item-titania",
      slug: "titania_prime",
      name_ru: "Титания Прайм",
      name_en: "Titania Prime",
      url: "https://warframe.market/items/titania_prime",
    });
    expect(russian.retrieved_at).toBe(RETRIEVED_AT);
    expect(russian.filters).toEqual({ language: "ru", platform: "pc", crossplay: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.warframe.market/v2/items");
    expect(Object.fromEntries(requests[0]?.headers.entries() ?? [])).toMatchObject({
      accept: "application/json",
      crossplay: "true",
      language: "ru",
      platform: "pc",
      "user-agent": "warframe-mcp/1.0.0 (Cloudflare Workers; read-only)",
    });
  });

  it("merges a Russian catalog request when another response language is selected", async () => {
    const languages: string[] = [];
    const client = new WarframeMarketClient({
      fetcher: createFetch((_input, init) => {
        const language = new Headers(init?.headers).get("Language") ?? "";
        languages.push(language);
        const data = ITEMS.map((item) => ({
          ...item,
          i18n: language === "ru" ? item.i18n : { en: item.i18n.en },
        }));
        return jsonResponse({ apiVersion: "0.25.0", data, error: null });
      }),
      now: () => new Date(RETRIEVED_AT),
    });

    const result = await client.searchItems("Titania Prime", 10, { language: "en" });

    expect(languages).toEqual(["en", "ru"]);
    expect(result.items[0]).toMatchObject({
      name_ru: "Титания Прайм",
      name_en: "Titania Prime",
    });
    expect(result.filters.language).toBe("en");
  });

  it("formats and price-sorts top sell and buy orders", async () => {
    let requestHeaders: Headers | undefined;
    const client = new WarframeMarketClient({
      fetcher: createFetch((input, init) => {
        expect(requestUrl(input)).toBe(
          "https://api.warframe.market/v2/orders/item/titania_prime/top",
        );
        requestHeaders = new Headers(init?.headers);
        return jsonResponse({ apiVersion: "0.25.0", data: TOP_ORDERS, error: null });
      }),
      now: () => new Date(RETRIEVED_AT),
    });

    const result = await client.getTopOrders("titania_prime");

    expect(result.sell.map((order) => order.platinum)).toEqual([42, 48]);
    expect(result.buy.map((order) => order.platinum)).toEqual([40, 35]);
    expect(result.sell[0]).toMatchObject({
      id: "sell-42",
      quantity: 2,
      per_trade: 1,
      user: { ingame_name: "Seller42", status: "ingame" },
    });
    expect(result.item.url).toBe("https://warframe.market/items/titania_prime");
    expect(result.retrieved_at).toBe(RETRIEVED_AT);
    expect(Object.fromEntries(requestHeaders?.entries() ?? [])).toMatchObject({
      accept: "application/json",
      crossplay: "true",
      language: "ru",
      platform: "pc",
      "user-agent": "warframe-mcp/1.0.0 (Cloudflare Workers; read-only)",
    });
  });

  it("returns clear errors for 404 and unavailable API responses", async () => {
    const notFound = new WarframeMarketClient({
      fetcher: createFetch(() => jsonResponse({ error: null, data: null }, 404)),
    });
    const unavailable = new WarframeMarketClient({
      maxRetries: 0,
      fetcher: createFetch(() =>
        jsonResponse({ error: { request: ["temporarily_unavailable"] }, data: null }, 503),
      ),
    });

    await expect(notFound.getTopOrders("missing_item")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("404"),
    });
    await expect(unavailable.getTopOrders("titania_prime")).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("HTTP 503"),
    });
  });

  it("aborts requests that exceed the configured timeout", async () => {
    const client = new WarframeMarketClient({
      timeoutMs: 5,
      fetcher: createFetch((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      ),
    });

    await expect(client.searchItems("Titania")).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringContaining("5 мс"),
    });
  });
});

describe("OpenAI-compatible document IDs", () => {
  it("creates stable item IDs and parses their slug", () => {
    const first = toWfmItemDocumentId("titania_prime");
    const second = toWfmItemDocumentId("titania_prime");

    expect(first).toBe("wfm:item:titania_prime");
    expect(second).toBe(first);
    expect(parseWfmItemDocumentId(first)).toBe("titania_prime");
  });

  it("rejects unsupported ID types and malformed item IDs", () => {
    expect(() => parseWfmItemDocumentId("wfm:profile:titania_prime")).toThrow(
      /Неподдерживаемый тип ID/,
    );
    expect(() => parseWfmItemDocumentId("wfm:item:")).toThrow(/Некорректный ID/);
  });
});

describe("Cloudflare Worker", () => {
  it("returns health status", async () => {
    const response = await SELF.fetch("https://example.com/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      name: "warframe-mcp",
      version: "1.0.0",
    });
  });

  it("completes MCP initialize", async () => {
    await withMcpClient(async (client) => {
      expect(client.getServerVersion()).toEqual({
        name: "warframe-mcp",
        version: "1.0.0",
      });
    });
  });

  it("lists the market and OpenAI-compatible tools with read-only schemas", async () => {
    await withMcpClient(async (client) => {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual([
        "wfm_search_items",
        "wfm_get_top_orders",
        "search",
        "fetch",
      ]);
      expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

      const search = result.tools.find((tool) => tool.name === "search");
      const fetch = result.tools.find((tool) => tool.name === "fetch");

      expect(search?.inputSchema).toMatchObject({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
      expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual(["query"]);
      expect(search?.outputSchema).toMatchObject({
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "title", "text", "url"],
            },
          },
        },
        required: ["results"],
      });
      expect(fetch?.inputSchema).toMatchObject({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      });
      expect(Object.keys(fetch?.inputSchema.properties ?? {})).toEqual(["id"]);
      expect(fetch?.outputSchema).toMatchObject({
        type: "object",
        required: ["id", "title", "text", "url", "metadata"],
      });
    });
  });

  it("searches a Russian item name through MCP with mocked fetch", async () => {
    mockWorkerApi("/items", { apiVersion: "0.25.0", data: ITEMS, error: null });

    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "wfm_search_items",
        arguments: { query: "Титания Прайм" },
      });
      const data = result.structuredContent as {
        items: Array<{ slug: string; url: string }>;
        retrieved_at: string;
        filters: { language: string; platform: string; crossplay: boolean };
      };

      expect(result.isError).not.toBe(true);
      expect(data.items[0]).toEqual({
        id: "item-titania",
        slug: "titania_prime",
        name_ru: "Титания Прайм",
        name_en: "Titania Prime",
        url: "https://warframe.market/items/titania_prime",
      });
      expect(new Date(data.retrieved_at).toISOString()).toBe(data.retrieved_at);
      expect(data.filters).toEqual({ language: "ru", platform: "pc", crossplay: true });
    });
  });

  it("gets sorted top orders through MCP with mocked fetch", async () => {
    mockWorkerApi("/orders/item/titania_prime/top", {
      apiVersion: "0.25.0",
      data: TOP_ORDERS,
      error: null,
    });

    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "wfm_get_top_orders",
        arguments: { slug: "titania_prime" },
      });
      const data = result.structuredContent as {
        item: { slug: string; url: string };
        sell: Array<{ platinum: number }>;
        buy: Array<{ platinum: number }>;
        retrieved_at: string;
      };

      expect(result.isError).not.toBe(true);
      expect(data.item).toEqual({
        slug: "titania_prime",
        url: "https://warframe.market/items/titania_prime",
      });
      expect(data.sell.map((order) => order.platinum)).toEqual([42, 48]);
      expect(data.buy.map((order) => order.platinum)).toEqual([40, 35]);
      expect(new Date(data.retrieved_at).toISOString()).toBe(data.retrieved_at);
    });
  });

  it("returns no more than ten standard search results with stable IDs", async () => {
    const manyItems = Array.from({ length: 12 }, (_, index) => ({
      id: `item-titania-${index}`,
      slug: `titania_prime_part_${index}`,
      i18n: {
        ru: { name: `Титания Прайм Деталь ${index}` },
        en: { name: `Titania Prime Part ${index}` },
      },
    }));
    mockWorkerApi("/items", {
      apiVersion: "0.25.0",
      data: manyItems,
      error: null,
    });

    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "search",
        arguments: { query: "Titania Prime" },
      });
      const data = result.structuredContent as {
        results: Array<{ id: string; title: string; text: string; url: string }>;
      };
      const content = (result.content as Array<{ type: "text"; text: string }>)[0];

      expect(result.isError).not.toBe(true);
      expect(data.results).toHaveLength(10);
      expect(data.results[0]).toEqual({
        id: "wfm:item:titania_prime_part_0",
        title: "Титания Прайм Деталь 0 / Titania Prime Part 0",
        text: "Предмет Warframe Market: Титания Прайм Деталь 0 / Titania Prime Part 0; slug: titania_prime_part_0.",
        url: "https://warframe.market/items/titania_prime_part_0",
      });
      expect(JSON.parse(content.text)).toEqual(data);
      expect(data.results.every((item) => new URL(item.url).protocol === "https:")).toBe(
        true,
      );
    });
  });

  it("passes a search ID to fetch and returns the standard market document", async () => {
    vi.stubGlobal(
      "fetch",
      createFetch((input) => {
        const url = requestUrl(input);
        if (url === "https://api.warframe.market/v2/items") {
          return jsonResponse({ apiVersion: "0.25.0", data: ITEMS, error: null });
        }
        if (url === "https://api.warframe.market/v2/orders/item/titania_prime/top") {
          return jsonResponse({ apiVersion: "0.25.0", data: TOP_ORDERS, error: null });
        }

        throw new Error(`Unexpected Warframe Market request: ${url}`);
      }),
    );

    await withMcpClient(async (client) => {
      const searchResult = await client.callTool({
        name: "search",
        arguments: { query: "Титания Прайм" },
      });
      const searchData = searchResult.structuredContent as {
        results: Array<{ id: string; url: string }>;
      };
      const id = searchData.results[0]?.id;

      expect(id).toBe("wfm:item:titania_prime");

      const fetchResult = await client.callTool({
        name: "fetch",
        arguments: { id },
      });
      const document = fetchResult.structuredContent as {
        id: string;
        title: string;
        text: string;
        url: string;
        metadata: {
          slug: string;
          name_ru: string;
          name_en: string;
          platform: string;
          crossplay: boolean;
          retrieved_at: string;
          warning: string;
          top_sell_orders: Array<{ platinum: number }>;
          top_buy_orders: Array<{ platinum: number }>;
        };
      };
      const content = (fetchResult.content as Array<{ type: "text"; text: string }>)[0];

      expect(fetchResult.isError).not.toBe(true);
      expect(document).toMatchObject({
        id: "wfm:item:titania_prime",
        title: "Титания Прайм / Titania Prime",
        url: "https://warframe.market/items/titania_prime",
        metadata: {
          slug: "titania_prime",
          name_ru: "Титания Прайм",
          name_en: "Titania Prime",
          platform: "pc",
          crossplay: true,
          warning: expect.stringContaining("текущий снимок рынка"),
        },
      });
      expect(document.metadata.top_sell_orders.map((order) => order.platinum)).toEqual([
        42,
        48,
      ]);
      expect(document.metadata.top_buy_orders.map((order) => order.platinum)).toEqual([
        40,
        35,
      ]);
      expect(new URL(document.url).protocol).toBe("https:");
      expect(new Date(document.metadata.retrieved_at).toISOString()).toBe(
        document.metadata.retrieved_at,
      );
      expect(document.text).toContain("Top sell orders");
      expect(document.text).toContain("Top buy orders");
      expect(JSON.parse(content.text)).toEqual(document);
    });
  });

  it("returns an MCP error for an unsupported document ID type", async () => {
    vi.stubGlobal(
      "fetch",
      createFetch(() => {
        throw new Error("Warframe Market API must not be called for an invalid ID");
      }),
    );

    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "fetch",
        arguments: { id: "wfm:profile:titania_prime" },
      });
      const content = (result.content as Array<{ type: "text"; text: string }>)[0];

      expect(result.isError).toBe(true);
      expect(content.text).toContain("Неподдерживаемый тип ID");
    });
  });

  it("returns an MCP error for an unknown item slug without requesting orders", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      createFetch((input) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({ apiVersion: "0.25.0", data: ITEMS, error: null });
      }),
    );

    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: "fetch",
        arguments: { id: "wfm:item:missing_item" },
      });
      const content = (result.content as Array<{ type: "text"; text: string }>)[0];

      expect(result.isError).toBe(true);
      expect(content.text).toContain('slug "missing_item" не найден');
      expect(requests).toEqual(["https://api.warframe.market/v2/items"]);
    });
  });
});
