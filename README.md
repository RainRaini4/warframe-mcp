# Warframe MCP Server

> **Warning:** This project was 100% vibecoded and exists purely for my personal needs. Use at your own risk.

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants real-time access to Warframe data. The production Cloudflare Worker exposes a minimal read-only Warframe Market search and top-orders flow, including OpenAI-compatible `search` and `fetch` tools. The legacy Node entrypoint retains 19 broader game-data tools.

## Cloudflare Worker Tools

| Tool | Description |
|------|-------------|
| `wfm_search_items` | Search tradable items by Russian name, English name, or slug |
| `wfm_get_top_orders` | Get up to five current sell and buy orders for an item slug |
| `search` | Return up to ten OpenAI-compatible citation results with stable `wfm:item:<slug>` IDs |
| `fetch` | Resolve a stable item ID to a current market document with top sell and buy orders |

The `wfm_*` tools return short text plus `structuredContent`, the applied `language`/`platform`/`crossplay` filters, and `retrieved_at`. The standard `search` and `fetch` tools return the OpenAI compatibility shape in `structuredContent` and duplicate the same object as JSON in text `content`.

## Legacy Node Tools

| Tool | Description |
|------|-------------|
| `world_state` | Current sortie, archon hunt, nightwave, invasions, open world cycles, events, Steel Path, construction progress, daily deals |
| `baro_kiteer` | Baro Ki'Teer status, inventory, and plat-per-ducat value analysis |
| `active_fissures` | Void Fissure listings with tier/Steel Path/Void Storm/mission type filters |
| `lookup_warframe` | Warframe stats, abilities, component drops, build cost, vault status |
| `lookup_weapon` | Weapon damage per fire mode, crit/status, components, build info |
| `lookup_mod` | Mod stats at all ranks, polarity, drain, rarity, drop locations |
| `lookup_item` | Generic item lookup (arcanes, resources, blueprints, companions) |
| `market_price_check` | Live warframe.market prices — sell/buy stats, cheapest sellers, trade chat messages |
| `search_drops` | Drop table search — relics, missions, enemies, with drop chances |
| `relic_drops` | Which relics contain a prime part, refinement chances, relic farm locations |
| `prime_vault_status` | Vaulted / farmable / Varzia resurgence status for prime items |
| `simaris_target` | Today's Cephalon Simaris synthesis target and scan locations |
| `find_enemy_spawn` | Where specific enemies spawn — confirmed locations from drop tables |
| `lookup_builds` | Top community mod builds from Overframe.gg with mod lists and stats |
| `crafting_requirements` | Full crafting recipes — components, credits, build time, sub-recipes |
| `crafting_usage` | Reverse ingredient lookup — "what uses this?" / "safe to sell?" |
| `farm_route_optimizer` | Best nodes to farm multiple resources — dark sector bonuses, overlap scoring |
| `task_synergy_planner` | Cross-reference Nightwave with fissures/invasions/sortie for max efficiency |
| `color_palette_finder` | Find closest in-game color palette match for any hex color (Fashion Frame) |

Most lookup tools accept **arrays** (batch mode) to handle multiple items in a single call.

## Quick Start

### npm

```bash
git clone https://github.com/YOUR_USER/warframe-mcp.git
cd warframe-mcp
npm install
npm run build
```

**Cloudflare Worker** (target production runtime):

```bash
npm run dev
# Health: http://127.0.0.1:8787/healthz
# MCP:    http://127.0.0.1:8787/mcp
```

**Stdio mode** (for MCP clients like Claude Desktop, OpenCode, Cursor):

```bash
npm start
```

**Legacy Node HTTP mode** (Streamable HTTP transport for remote/web clients):

```bash
npm run start:http
# Listening on http://127.0.0.1:3000/mcp
```

### Docker

```bash
docker build -t warframe-mcp .

# HTTP mode (default)
docker run -p 3000:3000 warframe-mcp

# Stdio mode
docker run -i warframe-mcp node dist/index.js
```

## Configuration

The Cloudflare Worker requires no environment variables. Market tool arguments default to `language=ru`, `platform=pc`, and `crossplay=true`.

The Worker also requires no secrets, KV namespaces, D1 databases, Durable Objects, or service bindings. Its own source uses Worker Web APIs; `nodejs_compat` remains enabled because the official Cloudflare `agents` dependency imports Node compatibility modules and the bundle does not build without the flag.

The environment variables below apply only to the legacy Node HTTP entrypoint. None are required.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN/container access |
| `ALLOWED_HOSTS` | — | Comma-separated hostnames/IPs allowed through DNS rebinding protection (only needed when `HOST=0.0.0.0`) |

**Example — LAN-accessible server:**

```bash
HOST=0.0.0.0 PORT=3000 ALLOWED_HOSTS=192.168.1.100,mypc.local npm run start:http
```

## Cloudflare Deployment

Check the bundle without publishing:

```bash
npm run deploy:dry
```

For the first deployment, authenticate Wrangler and publish:

```bash
npx wrangler login
npx wrangler whoami
npm run deploy
```

Wrangler prints the exact deployment URL. With the configured Worker name and a standard `workers.dev` subdomain, the endpoints have this form:

```text
Health: https://warframe-mcp.<YOUR_WORKERS_SUBDOMAIN>.workers.dev/healthz
MCP:    https://warframe-mcp.<YOUR_WORKERS_SUBDOMAIN>.workers.dev/mcp
```

Replace the placeholder with the subdomain shown by Wrangler. A configured Cloudflare custom domain can be used instead.

## Client Setup

### ChatGPT

ChatGPT requires a reachable HTTPS remote MCP endpoint; it cannot connect directly to `localhost`. The current setup flow is documented in [ChatGPT Developer mode](https://developers.openai.com/api/docs/guides/developer-mode):

1. In ChatGPT on the web, enable Developer mode under **Settings → Security and login**.
2. Open **Settings → Plugins**, select the plus button, and create a developer-mode app.
3. Set the server URL to `https://warframe-mcp.<YOUR_WORKERS_SUBDOMAIN>.workers.dev/mcp`.
4. Select **No Authentication**. The pilot exposes only public read-only data.
5. Refresh or scan the tools and confirm that `wfm_search_items`, `wfm_get_top_orders`, `search`, and `fetch` are visible.
6. In a conversation, select Developer mode and enable the created app.

Use the ready-to-paste project guidance from [`docs/chatgpt-project-instructions.md`](docs/chatgpt-project-instructions.md) so price questions always use current MCP data.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "warframe": {
      "command": "node",
      "args": ["/absolute/path/to/warframe-mcp/dist/index.js"]
    }
  }
}
```

### Claude Desktop (Docker)

```json
{
  "mcpServers": {
    "warframe": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "warframe-mcp", "node", "dist/index.js"]
    }
  }
}
```

### OpenCode

Add to `opencode.json`:

```json
{
  "mcpServers": {
    "warframe": {
      "command": "node",
      "args": ["/absolute/path/to/warframe-mcp/dist/index.js"]
    }
  }
}
```

### Cloudflare Worker clients (Streamable HTTP)

Run the Worker locally, then connect to `http://127.0.0.1:8787/mcp`:

```bash
npm run dev

# GET  /healthz — service health
# POST /mcp     — stateless MCP JSON-RPC requests
```

The Worker creates a fresh MCP server and transport for every request. It does not store HTTP sessions and requires no authentication.

Warframe Market access is coordinated per Worker isolate: at most three external requests start per second, transient failures are retried with `Retry-After` or bounded jittered backoff, identical concurrent requests are deduplicated, the item catalog is cached for six hours, and top orders for 20 seconds.

Typical flow:

1. Call `search` with `{"query":"Титания Прайм"}`.
2. Pass the returned `wfm:item:<slug>` ID to `fetch`.

The direct market flow remains available through `wfm_search_items` followed by `wfm_get_top_orders`.

### Legacy Node HTTP clients

Start the server in HTTP mode, then connect to `http://localhost:3000/mcp`:

```bash
npm run start:http

# POST /mcp — JSON-RPC requests (initialize, tools/list, tools/call)
# GET  /mcp — SSE stream for server-to-client notifications
# DELETE /mcp — Session termination
```

Sessions are managed via the `Mcp-Session-Id` header. Send an `initialize` request without a session ID to start a new session.

## Smoke Test

```bash
# Stdio — should return JSON with 19 tools
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js

# HTTP — initialize a session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}},"id":1}'
```

## System Prompt

`SYSTEM_PROMPT.md` contains a ready-to-use system prompt for an AI assistant that uses this MCP server. It includes tool documentation, a decision tree for tool selection, multi-tool chaining strategies, batching guidance, and Warframe domain knowledge (relics, rotations, trading, modding, Steel Path, open world cycles).

## Architecture

```
worker/
├── index.ts              # Cloudflare Worker: /healthz + stateless /mcp tools
├── openai-compat.ts      # Stable document IDs and OpenAI search/fetch documents
└── warframe-market.ts    # Worker-safe API v2 client, reliability, cache, and search
wrangler.jsonc            # Worker entrypoint and compatibility settings
tsconfig.worker.json      # Worker-only TypeScript configuration
vitest.config.ts          # Tests executed in the Workers runtime

src/
├── index.ts              # Entry point — stdio or HTTP transport
├── api/
│   ├── warframestat.ts   # warframestat.us client (items, drops, worldstate)
│   ├── warframe-market.ts # warframe.market v2 client (prices, orders)
│   ├── overframe.ts      # Overframe.gg scraper (community builds)
│   └── wiki.ts           # Fandom wiki API client (crafting recipes)
├── tools/
│   ├── worldstate.ts     # world_state, baro_kiteer, active_fissures
│   ├── items.ts          # lookup_warframe, lookup_weapon, lookup_mod, lookup_item
│   ├── market.ts         # market_price_check
│   ├── drops.ts          # search_drops, relic_drops
│   ├── primeVault.ts     # prime_vault_status
│   ├── simaris.ts        # simaris_target
│   ├── enemy.ts          # find_enemy_spawn
│   ├── builds.ts         # lookup_builds
│   ├── crafting.ts       # crafting_requirements, crafting_usage
│   ├── farmOptimizer.ts  # farm_route_optimizer
│   ├── synergy.ts        # task_synergy_planner
│   └── colors.ts         # color_palette_finder
├── types/
│   ├── warframestat.ts   # warframestat.us API types
│   ├── warframe-market.ts # warframe.market v2 types
│   ├── overframe.ts      # Overframe build types
│   └── index.ts          # Re-exports
├── data/
│   ├── color-palettes.ts # 31 Warframe color palettes (2,790 colors)
│   └── planet-resources.ts # Planet resource drops, dark sector nodes & bonuses
└── utils/
    ├── cache.ts          # TTL cache (60s–24h depending on data type)
    ├── formatting.ts     # Number/time formatting helpers
    └── lua-parser.ts     # Lua table parser for wiki blueprint data
```

### Data Sources

| API | Base URL | Auth | Used For |
|-----|----------|------|----------|
| [warframestat.us](https://warframestat.us) | `https://api.warframestat.us` | None | World state, items, drops, mods, weapons, warframes |
| [warframe.market](https://warframe.market) | `https://api.warframe.market/v2` | None | Tradable item catalog and current top orders |
| [Overframe.gg](https://overframe.gg) | `https://overframe.gg` | None (HTML scraping) | Community mod builds |
| [Warframe Wiki](https://warframe.fandom.com) | MediaWiki API | None | Crafting recipes (blueprint data) |
| Bundled static data | — | — | Planet resources, dark sector bonuses, 31 color palettes (2,790 colors) |

### Caching

| Data Type | TTL | Examples |
|-----------|-----|---------|
| World state | 60 seconds | Fissures, invasions, cycles |
| Drop tables | 5 minutes | Drop search results |
| Worker market items | 6 hours | Item listing catalog |
| Worker top orders | 20 seconds | Current buy/sell snapshot |
| Static data | 24 hours | Warframe/weapon/mod stats |
| Wiki data | 24 hours | Crafting recipes |
| Overframe builds | 6 hours | Community builds |

## Pilot Limitations

- The production Worker exposes only `wfm_search_items`, `wfm_get_top_orders`, `search`, and `fetch`.
- It is read-only: there is no Warframe Market login, private profile access, or order mutation.
- Prices are current snapshots from the public Warframe Market API, not historical statistics or guarantees of an executable trade.
- Cache, request limiting, and request deduplication are isolate-local and reset on a cold start.
- The public endpoint has no application authentication or per-user authorization.
- Availability depends on Cloudflare Workers and the public Warframe Market API; the pilot has no SLA.
- ChatGPT developer-mode availability and workspace permissions depend on the current ChatGPT plan and admin policy.

## Development

```bash
npm run dev        # Run the Cloudflare Worker locally
npm run dev:stdio  # Watch-compile the legacy Node entrypoint
npm run typecheck  # Type-check without emitting dist
npm test           # Build and run automated tests
npm run build      # One-shot compile
npm run deploy:dry # Build the Worker deployment bundle without uploading
npm run deploy     # Publish through the authenticated Wrangler account
npm run check      # Type-check, test, and dry-run the Worker bundle
npm start          # Run stdio mode
```

### Requirements

- Node.js >= 20.3 (required by Wrangler)
- TypeScript 5.x
- Worker runtime dependencies: `@modelcontextprotocol/sdk`, `agents`, and `zod`
- Express is used only by the legacy Node HTTP entrypoint and is not bundled into the Worker

## License

MIT
