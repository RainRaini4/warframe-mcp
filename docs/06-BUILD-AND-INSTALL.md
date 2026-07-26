# Build & Install

## Requirements

- Node.js >= 20.3.0 (required by Wrangler; also provides native `fetch` and top-level `await`)
- npm >= 9.0.0

## `package.json`

```json
{
  "name": "warframe-mcp",
  "version": "1.0.0",
  "description": "MCP server providing real-time Warframe game data to AI assistants",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p test/tsconfig.json",
    "test": "npm run build && node --test test/server.test.mjs && vitest run",
    "check": "npm run typecheck && npm test && npm run deploy:dry",
    "start": "node dist/index.js",
    "start:http": "node dist/index.js --http",
    "dev": "wrangler dev",
    "dev:stdio": "tsc --watch",
    "deploy": "wrangler deploy",
    "deploy:dry": "wrangler deploy --dry-run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.26.0",
    "agents": "0.8.0",
    "express": "^5.2.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.15.0",
    "@cloudflare/workers-types": "4.20260702.1",
    "@types/express": "^5.0.6",
    "@types/node": "^22.15.0",
    "typescript": "^5.8.3",
    "vitest": "4.1.10",
    "wrangler": "4.85.0"
  },
  "engines": {
    "node": ">=20.3.0"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`"module": "Node16"` requires `.js` extensions on all internal imports** — even when importing `.ts` source files:

```typescript
// CORRECT
import { TTLCache } from "../utils/cache.js";
// WRONG — TypeScript will error
import { TTLCache } from "../utils/cache";
```

## `.gitignore`

```
node_modules/
dist/
*.js.map
```

---

## Build

```bash
npm install         # Install dependencies
npm run typecheck   # Type-check without emitting dist
npm test            # Build and run automated tests
npm run build       # Compile to dist
npm run deploy:dry  # Build the Worker bundle without uploading
npm run deploy      # Publish with an authenticated Wrangler session
npm run dev         # Serve /healthz and /mcp through Wrangler
node dist/index.js  # Hangs on stdin — correct. Ctrl+C to stop.
```

Smoke test:

```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

Expect: JSON with all 19 tools listed.

Full tool call test:

```bash
printf '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"baro_kiteer","arguments":{}}}\n' | node dist/index.js
```

Expect: two JSON responses — initialize, then baro_kiteer result.

---

## Directory Structure

```
warframe-mcp/
├── package.json
├── tsconfig.json
├── tsconfig.worker.json
├── vitest.config.ts
├── wrangler.jsonc
├── worker/
│   └── index.ts
├── test/
│   ├── server.test.mjs
│   ├── worker.test.ts
│   └── tsconfig.json
├── src/
│   ├── index.ts
│   ├── api/
│   │   ├── warframestat.ts
│   │   ├── warframe-market.ts
│   │   └── profile.ts
│   ├── tools/
│   │   ├── worldstate.ts
│   │   ├── items.ts
│   │   ├── market.ts
│   │   ├── drops.ts
│   │   ├── primeVault.ts
│   │   ├── simaris.ts
│   │   ├── enemy.ts
│   │   └── profile.ts
│   ├── utils/
│   │   ├── cache.ts
│   │   └── formatting.ts
│   └── types/
│       ├── index.ts
│       ├── warframestat.ts
│       ├── warframe-market.ts
│       └── profile.ts
└── dist/          # Generated — do not edit
```

---

## MCP Client Configuration

### Cloudflare Worker

Run `npm run dev`, then use the public Streamable HTTP endpoint:

```text
http://127.0.0.1:8787/mcp
```

Health checks use `GET http://127.0.0.1:8787/healthz`. The MCP handler is stateless and stores no session data.

The Worker exposes:

- `wfm_search_items` — Russian/English/slug item lookup;
- `wfm_get_top_orders` — current top sell and buy orders;
- `search` — up to ten citable items with stable `wfm:item:<slug>` IDs;
- `fetch` — a current market document for an ID returned by `search`.

All tools use `language=ru`, `platform=pc`, and `crossplay=true` by default. They need no credentials or environment variables. For OpenAI-compatible clients, call `search({"query":"Титания Прайм"})` and pass a returned ID to `fetch`.

Production deployment requires an authenticated Wrangler session:

```bash
npx wrangler login
npx wrangler whoami
npm run deploy:dry
npm run deploy
```

Without an authenticated account, stop after the dry run and use `https://warframe-mcp.<YOUR_WORKERS_SUBDOMAIN>.workers.dev/mcp` as the documented URL template. The Worker configuration has no Durable Objects, KV, D1, service bindings, or secrets. `nodejs_compat` is required by transitive imports in the official Cloudflare `agents` package even though the Worker source itself uses no Node-only APIs.

### Claude Desktop

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop after saving. 19 Warframe tools will appear.

### OpenCode

```json
{
  "mcp": {
    "warframe": {
      "type": "local",
      "command": ["node", "/absolute/path/to/warframe-mcp/dist/index.js"]
    }
  }
}
```

### Any MCP client

Transport: **stdio**. No env vars. No ports. No auth.

```
command: node
args: ["/path/to/warframe-mcp/dist/index.js"]
```

---

## Common Build Errors

**`error TS2835: Relative import paths need explicit file extensions`**
→ Add `.js` to all internal imports.

**`error TS1378: Top-level 'await' expressions are only allowed when...`**
→ Ensure `tsconfig.json` has `"target": "ES2022"` and `"module": "Node16"`.

**`SyntaxError: Cannot use import statement in a module`** (runtime)
→ Check `package.json` has `"type": "module"` and `tsconfig.json` has `"module": "Node16"`.

**`Error: Cannot find module`** (runtime)
→ Stale dist. Run `npm run build` again.

---

## Debugging

`process.stdout` is owned by the MCP transport. **NEVER use `console.log`.**

```typescript
// Safe — writes to stderr only
console.error("[DEBUG] fetchVoidTrader:", JSON.stringify(data, null, 2));
```

---

## Notes

- The production target is the stateless Cloudflare Worker at `/mcp`; it has no auth, Durable Objects, KV, D1, or persistent storage.
- The legacy Node entrypoint remains available as a local stdio subprocess or Express HTTP server.
- Item search reuses the in-isolate six-hour catalog cache, while top orders use a 20-second cache. Cold or expired requests require Warframe Market API access.
- No environment variables required.
