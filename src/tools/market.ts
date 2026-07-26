import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as market from "../api/warframe-market.js";
import * as fmt from "../utils/formatting.js";
import { MARKET_PLATFORM_VALUES, normalizeMarketPlatform } from "../utils/platform.js";

function formatPriceCheck(
  result: Awaited<ReturnType<typeof market.priceCheck>>,
  platform: string,
  onlineOnly: boolean
): string {
  const onlineLabel = onlineOnly ? "Online sellers only" : "All sellers (including offline)";
  const lines: string[] = [
    `=== MARKET PRICE: ${result.itemName} (${platform.toUpperCase()}) ===`,
    onlineLabel,
  ];

  // Sell orders
  lines.push("\nSELL ORDERS:");
  if (result.sell.count > 0) {
    lines.push(
      `  Lowest: ${result.sell.min}p    Median: ${result.sell.median}p    Average: ${result.sell.average}p    Highest: ${result.sell.max}p`
    );
    lines.push(`  Active sellers: ${result.sell.count}`);
  } else {
    lines.push("  No active sell orders");
  }

  // Buy orders
  lines.push("\nBUY ORDERS:");
  if (result.buy.count > 0) {
    lines.push(
      `  Highest: ${result.buy.max}p    Median: ${result.buy.median}p    Average: ${result.buy.average}p    Lowest: ${result.buy.min}p`
    );
    lines.push(`  Active buyers: ${result.buy.count}`);
  } else {
    lines.push("  No active buy orders");
  }

  // Cheapest sellers
  if (result.cheapestSellers.length > 0) {
    lines.push("\nCHEAPEST ONLINE SELLERS:");
    result.cheapestSellers.forEach((s, i) => {
      const rankStr =
        s.rank !== undefined ? ` R${s.rank}` : "";
      lines.push(
        `  ${i + 1}. ${s.ingameName} — ${s.platinum}p${rankStr} (qty: ${s.quantity}) — ${s.status === "ingame" ? "in-game" : s.status}`
      );
    });
  }

  // Trade chat suggestions
  lines.push("\nTRADE CHAT:");
  const buyPrice =
    result.buy.count > 0
      ? result.buy.max
      : Math.round(result.sell.median * 0.9);
  const sellPrice =
    result.sell.count > 0 ? result.sell.min : 0;
  if (buyPrice > 0)
    lines.push(`  Buying: "WTB ${result.itemName} ${buyPrice}p"`);
  if (sellPrice > 0)
    lines.push(`  Selling: "WTS ${result.itemName} ${sellPrice}p"`);

  return lines.join("\n");
}

export function registerMarketTools(server: McpServer): void {
  server.tool(
    "market_price_check",
    "Check live trading prices for one or more tradeable items on warframe.market: sell/buy stats, cheapest sellers, and trade chat messages.",
    {
      item_names: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe("Item name(s) (e.g. ['Ash Prime Set', 'Serration'])"),
      platform: z
        .enum(MARKET_PLATFORM_VALUES)
        .default("pc")
        .optional()
        .describe(
          "Trading platform. Canonical values: pc, ps4, xbox, switch, mobile. Legacy aliases accepted: xb1 → xbox, swi/ns → switch, psn → ps4.",
        ),
      mod_rank: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("Filter by mod/arcane rank"),
      online_only: z
        .boolean()
        .default(true)
        .optional()
        .describe("Only show orders from online/in-game players"),
    },
    async (args) => {
      const platform = normalizeMarketPlatform(args.platform ?? "pc");
      const onlineOnly = args.online_only ?? true;
      const results: string[] = [];

      for (const itemName of args.item_names) {
        try {
          const result = await market.priceCheck(itemName.trim(), {
            modRank: args.mod_rank,
            onlineOnly,
            platform,
          });
          results.push(formatPriceCheck(result, platform, onlineOnly));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          results.push(
            `=== MARKET PRICE: ${itemName.toUpperCase()} ===\nError checking market price: ${msg}`
          );
        }
      }

      return { content: [{ type: "text", text: results.join("\n\n") }] };
    }
  );
}
