# Warframe MCP Server — Overview

The target runtime is a stateless Cloudflare Worker with Streamable HTTP at `/mcp` and health checks at `/healthz`. The Worker exposes the read-only `wfm_search_items`, `wfm_get_top_orders`, `wfm_get_item_statistics`, `wfm_get_item_liquidity`, `search`, and `fetch` tools. The legacy Node entrypoint remains available with stdio, Express Streamable HTTP, and 19 Warframe tools.

## External Data Sources

| Source | Base URL | Provides |
|--------|----------|----------|
| warframestat.us | `https://api.warframestat.us` | Worldstate, items, weapons, mods, drops, player profiles |
| warframe.market v2 | `https://api.warframe.market/v2` | Item catalog and current public P2P platinum orders |
| warframe.market legacy v1 | `https://api.warframe.market/v1` | Deprecated closed-order statistics used as an optional, degrading source |

**DO NOT** add `@wfcd/items`, `warframe-worldstate-data`, `warframe-nexus-query`, or `node-fetch`. Game and market data comes from public HTTP APIs rather than bundled data packages.

## Directory Structure

```
warframe-mcp/
├── wrangler.jsonc                # Cloudflare Worker configuration
├── tsconfig.worker.json          # Worker TypeScript configuration
├── vitest.config.ts              # Workers runtime test configuration
├── package.json
├── tsconfig.json
├── worker/
│   ├── index.ts                  # Stateless /mcp + /healthz + MCP tool registration
│   ├── market-analytics.ts       # Pure variant-safe statistics and liquidity calculations
│   ├── openai-compat.ts          # Stable IDs and OpenAI search/fetch result mapping
│   └── warframe-market.ts        # Worker-safe Market API client, reliability, and caches
├── test/
│   ├── server.test.mjs           # Legacy stdio MCP regression test
│   ├── market-analytics.test.ts  # Statistics normalization and liquidity scenario tests
│   ├── warframe-market.test.ts   # Worker client limiter, retry, cache, and deduplication tests
│   ├── worker.test.ts            # Worker health and MCP tests
│   └── tsconfig.json
├── src/
│   ├── index.ts                   # Legacy Node stdio/HTTP entrypoint
│   ├── api/
│   │   ├── warframestat.ts        # HTTP client for api.warframestat.us
│   │   ├── warframe-market.ts     # HTTP client for api.warframe.market/v2
│   │   ├── overframe.ts           # Overframe.gg client
│   │   └── wiki.ts                # Warframe Wiki client
│   ├── tools/
│   │   ├── worldstate.ts          # world_state, baro_kiteer, active_fissures
│   │   ├── items.ts               # lookup_warframe, lookup_weapon, lookup_mod, lookup_item
│   │   ├── market.ts              # market_price_check
│   │   ├── drops.ts               # search_drops, relic_drops
│   │   ├── primeVault.ts          # prime_vault_status
│   │   ├── simaris.ts             # simaris_target
│   │   ├── enemy.ts               # find_enemy_spawn
│   │   ├── builds.ts              # lookup_builds
│   │   ├── crafting.ts            # crafting_requirements, crafting_usage
│   │   ├── farmOptimizer.ts       # farm_route_optimizer
│   │   ├── synergy.ts             # task_synergy_planner
│   │   └── colors.ts              # color_palette_finder
│   ├── utils/
│   │   ├── cache.ts               # TTLCache<T> — Map-based in-memory TTL cache
│   │   ├── formatting.ts          # Pure text formatting helpers
│   │   └── lua-parser.ts          # Wiki Lua data parser
│   └── types/
│       ├── warframestat.ts        # Types for api.warframestat.us responses
│       ├── warframe-market.ts     # Types for api.warframe.market/v2 responses
│       ├── overframe.ts           # Types for Overframe responses
│       └── index.ts               # Re-export barrel
└── dist/                          # Compiled output (gitignored)
```

## Cache TTLs

| Data type | TTL |
|-----------|-----|
| Worldstate (fissures, sortie, etc.) | 60s |
| Drop tables | 5 min |
| Worker market items list (`/v2/items`) | 6h |
| Worker full orders (`/v2/orders/item/{slug}`) | 20s |
| Worker market top orders (`/v2/orders/item/{slug}/top`) | 20s |
| Worker legacy statistics (`/v1/items/{slug}/statistics`) | 5 min |
| Static item/weapon/mod data | 24h |
| Player profile | 5 min |

## Legacy Node Tool Summary

| File | Tools | Count |
|------|-------|-------|
| `worldstate.ts` | `world_state`, `baro_kiteer`, `active_fissures` | 3 |
| `items.ts` | `lookup_warframe`, `lookup_weapon`, `lookup_mod`, `lookup_item` | 4 |
| `market.ts` | `market_price_check` | 1 |
| `drops.ts` | `search_drops`, `relic_drops` | 2 |
| `primeVault.ts` | `prime_vault_status` | 1 |
| `simaris.ts` | `simaris_target` | 1 |
| `enemy.ts` | `find_enemy_spawn` | 1 |
| `builds.ts` | `lookup_builds` | 1 |
| `crafting.ts` | `crafting_requirements`, `crafting_usage` | 2 |
| `farmOptimizer.ts` | `farm_route_optimizer` | 1 |
| `synergy.ts` | `task_synergy_planner` | 1 |
| `colors.ts` | `color_palette_finder` | 1 |
| **Total** | | **19** |

The production Worker publishes only `wfm_search_items`, `wfm_get_top_orders`, `wfm_get_item_statistics`, `wfm_get_item_liquidity`, `search`, and `fetch`.

## Design Decisions

| Decision | Reason |
|----------|--------|
| Stateless `createMcpHandler()` | The pilot tools keep no per-client state, so the Worker needs no Durable Objects, KV, D1, or in-memory session map |
| New `McpServer` per Worker request | MCP SDK 1.26+ prohibits reconnecting a server instance and per-request instances prevent cross-client response leakage |
| No npm data packages | warframestat.us is backed by the same packages server-side; HTTP keeps install <5MB and data always fresh |
| Separate Worker market client | The Worker imports no legacy Node client or transport; reliability uses only Worker Web APIs |
| Shared isolate request coordination | One sliding-window limiter allows at most three external request starts per second; identical in-flight requests share one promise |
| Worker market caches | `/v2/items` responses are cached for 6h, current full/top orders for 20s, and legacy statistics for 5 min; endpoint and all market filters are part of the key |
| Stable OpenAI document IDs | `search` returns `wfm:item:<slug>` and `fetch` accepts only that item ID type |
| v2 primary, legacy v1 optional | v2 supplies the catalog and current orders. The deprecated v1 statistics route is isolated behind explicit warnings and liquidity degrades to current metrics with an unknown score if it disappears |
| Variant-safe analytics | Rank, subtype, charges, and Ayatan star variants are keyed and summarized independently. Missing upstream variant dimensions are reported instead of silently aggregated |
| warframestat.us profile proxy | Preferred over raw DE endpoint — normalizes inconsistent response structure |
| Default platform: `pc` | All worldstate endpoints are platform-scoped; `platform` param is optional |
| `"module": "Node16"` for legacy Node code | All internal imports MUST use `.js` extensions |
| `NEVER console.log` in stdio code | stdout is the JSON-RPC channel; use `console.error` only |
| `Accept-Language: en` on every request | Without it, some warframestat.us endpoints return localized strings (Chinese observed on archon hunt) |
