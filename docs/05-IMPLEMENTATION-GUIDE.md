# Implementation Guide

File-by-file skeletons and logic for every source file. Read alongside `03-TOOL-SPECIFICATIONS.md` (output formats) and `04-TYPE-DEFINITIONS.md` (types).

## Implementation Order

Build in this order — each layer depends only on layers above it:

1. `src/utils/cache.ts`
2. `src/utils/formatting.ts`
3. `src/types/` (all 4 files)
4. `src/api/warframestat.ts`
5. `src/api/warframe-market.ts`
6. `src/api/profile.ts`
7. `src/tools/worldstate.ts`
8. `src/tools/items.ts`
9. `src/tools/market.ts`
10. `src/tools/drops.ts`
11. `src/tools/primeVault.ts`
12. `src/tools/simaris.ts`
13. `src/tools/enemy.ts`
14. `src/tools/profile.ts`
15. `src/index.ts`

---

## `src/utils/cache.ts`

Generic TTL cache. No external dependencies.

```typescript
export interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export const TTL = {
  WORLDSTATE:   60_000,
  DROPS:        5 * 60_000,
  MARKET_ITEMS: 24 * 60 * 60_000,
  STATIC:       24 * 60 * 60_000,
  PROFILE:      5 * 60_000,
} as const;

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttl: number): void {
    this.store.set(key, { data, expiry: Date.now() + ttl });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
```

Namespaced key pattern: `"worldstate:voidTrader:pc"`. Use one shared `TTLCache<unknown>` instance across all API files.

---

## `src/utils/formatting.ts`

Pure functions. No imports from API or types. No side effects.

```typescript
/** "2d 5h 12m" or "14m 35s" */
export function formatDuration(seconds: number): string

/** ISO 8601 → relative time from now: "13 days", "2h 30m" */
export function timeUntil(isoTimestamp: string): string

/** Alias: time until expiry ISO string */
export function timeRemaining(expiryIso: string): string

/** Time since activation ISO string */
export function timeSince(activationIso: string): string

/** True if now is between activation and expiry */
export function isActive(activation: string, expiry: string): boolean

/** 1234567 → "1,234,567" */
export function formatNumber(n: number): string

/** seconds → "340h 12m" */
export function formatPlayTime(seconds: number): string

/** "madurai" → "Madurai (=)" */
export function formatPolarity(polarity: string): string

/** xp → "Rank 30/30" */
export function formatRank(xp: number): string

/** "grineer" → "Grineer" */
export function capitalize(s: string): string

/** "Ash Prime Set" → "ash_prime_set" */
export function nameToSlug(name: string): string
```

Polarity symbol map:

```typescript
const POLARITY_SYMBOLS: Record<string, string> = {
  madurai:  "=",
  naramon:  "-",
  vazarin:  "D",
  zenurik:  "—",
  unairu:   "~",
  penjaga:  "⬡",
  umbra:    "Ω",
};
```

---

## `src/api/warframestat.ts`

```typescript
import { TTLCache, TTL } from "../utils/cache.js";
import type { /* all response types */ } from "../types/index.js";

const BASE_URL = "https://api.warframestat.us";
const HEADERS = { "Accept": "application/json", "Accept-Language": "en" };
const cache = new TTLCache<unknown>();

async function get<T>(path: string, timeout = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}
```

Caching pattern — apply to every exported method:

```typescript
export async function getVoidTrader(platform: string): Promise<VoidTrader> {
  const key = `voidTrader:${platform}`;
  const cached = cache.get(key);
  if (cached) return cached as VoidTrader;
  const data = await get<VoidTrader>(`/${platform}/voidTrader`);
  cache.set(key, data, TTL.WORLDSTATE);
  return data;
}
```

All methods to implement:

```typescript
// Worldstate (platform-scoped, TTL.WORLDSTATE)
export async function getVoidTrader(platform: string): Promise<VoidTrader>
export async function getVaultTrader(platform: string): Promise<VaultTrader>
export async function getFissures(platform: string): Promise<Fissure[]>
export async function getSortie(platform: string): Promise<Sortie>
export async function getArchonHunt(platform: string): Promise<ArchonHunt>
export async function getNightwave(platform: string): Promise<Nightwave>
export async function getInvasions(platform: string): Promise<Invasion[]>
export async function getSteelPath(platform: string): Promise<SteelPath>
export async function getCetusCycle(platform: string): Promise<CetusCycle>
export async function getVallisCycle(platform: string): Promise<VallisCycle>
export async function getCambionCycle(platform: string): Promise<CambionCycle>
export async function getEarthCycle(platform: string): Promise<EarthCycle>
export async function getEvents(platform: string): Promise<GameEvent[]>
export async function getConstructionProgress(platform: string): Promise<ConstructionProgress>
export async function getDailyDeals(platform: string): Promise<DailyDeal[]>
export async function getSimaris(platform: string): Promise<Simaris>
export async function searchRivens(platform: string, query: string): Promise<RivenSearchResult>

// Static data (no platform prefix, TTL.STATIC)
export async function searchItems(query: string): Promise<GenericItem[]>
export async function searchWarframes(query: string): Promise<WarframeItem[]>
export async function searchWeapons(query: string): Promise<WeaponItem[]>
export async function searchMods(query: string): Promise<ModItem[]>

// Drop tables (TTL.DROPS)
export async function searchDrops(query: string): Promise<DropResult[]>

// Sol nodes (TTL.STATIC)
export async function searchSolNodes(query: string): Promise<SolNodeResult[]>

// Player profile (TTL.PROFILE, timeout = 10s)
export async function getProfileStats(username: string): Promise<PlayerProfile>
```

URL patterns:
- Worldstate: `/${platform}/voidTrader`, `/${platform}/fissures`, etc.
- Static: `/warframes/${encodeURIComponent(query)}`, `/weapons/${encodeURIComponent(query)}`, `/mods/${encodeURIComponent(query)}`, `/items/${encodeURIComponent(query)}`
- Drops: `/drops/search/${encodeURIComponent(query)}`
- Sol nodes: `/solNodes/${encodeURIComponent(query)}`
- Profile: `/profile/${encodeURIComponent(username)}/stats`

---

## `worker/warframe-market.ts`

The production Worker uses a separate fetch-only client with no Node imports. It implements:

- `GET /v2/items`, cached in the Worker isolate for six hours;
- `GET /v2/orders/item/{slug}/top`, cached for 20 seconds;
- `GET /v2/orders/item/{slug}`, cached for 20 seconds and used for visible/online counts plus best-price depth;
- deprecated `GET /v1/items/{slug}/statistics`, cached for five minutes as optional closed-order history;
- an 8-second `AbortController` timeout;
- one shared sliding-window limiter with at most three external request starts per second;
- retry for `429`, `509`, temporary `5xx`, and network errors, honoring `Retry-After` before bounded exponential backoff with jitter;
- endpoint/filter-aware cache keys and in-flight promise deduplication;
- specialized safe validation, HTTP, timeout, rate-limit, and availability errors.

Every request sends `Accept`, `User-Agent`, `Language`, `Platform`, and `Crossplay`. `400`, `403`, `404`, validation failures, and timeouts are not retried. Rejected in-flight promises are removed so later calls can recover. A known v2 catalog item with a legacy statistics `404` is classified as `statistics_unavailable`, not as an unknown item. There is intentionally no authorization, filesystem access, persistent storage, or order mutation method.

Search normalization uses Unicode NFKD, lowercasing, `ё`→`е`, removal of combining marks and punctuation, separator normalization, and whitespace collapse. Matches are limited to exact or substring comparison.

## `worker/market-analytics.ts`

Statistics normalization and liquidity calculations are pure functions with no fetch, Worker, filesystem, or mutable global dependencies. The module:

- maps legacy `mod_rank`, `amber_stars`, and `cyan_stars` fields into one `MarketVariantKey`;
- keeps `rank`, `subtype`, `charges`, `amberStars`, and `cyanStars` combinations separate;
- refuses history aggregation when a v2-declared variant dimension is missing from legacy buckets;
- preserves missing numeric data as `null` and ignores unknown-field buckets with warnings;
- summarizes reported volumes and prices separately for 48-hour and 90-day windows;
- computes current visible/online counts, exact best prices, spread, and quantity depth at best price;
- computes the documented deterministic 0–100 heuristic only when usable 90-day history exists.

`getItemLiquidity` treats full current orders as required. Legacy history and exact variant `/top` calls degrade independently: unavailable history yields current metrics with `score=null`, while unavailable `/top` prices fall back to the full current-order snapshot. All fallbacks are surfaced in `warnings`.

## `src/api/warframe-market.ts` (legacy Node)

```typescript
import { TTLCache, TTL } from "../utils/cache.js";
import type { MarketItem, MarketOrder, MarketOrdersResponse, MarketPriceResult } from "../types/index.js";

const BASE_URL = "https://api.warframe.market/v2";
const HEADERS = { "Accept": "application/json" };
const cache = new TTLCache<unknown>();

class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxRequests = 3, private windowMs = 1000) {}

  async throttle(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 10;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    this.timestamps.push(Date.now());
  }
}

const rateLimiter = new RateLimiter(3, 1000);

async function get<T>(path: string): Promise<T> {
  await rateLimiter.throttle();
  const response = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return get<T>(path);
  }
  if (!response.ok) throw new Error(`warframe.market HTTP ${response.status}: ${path}`);
  return response.json() as Promise<T>;
}
```

Methods:

```typescript
/** Returns Map<normalizedName, slug>. Cached 24h. */
export async function getItemsMap(): Promise<Map<string, string>>

/** Resolves item name to market slug. Throws with suggestions if not found. */
export async function resolveSlug(itemName: string): Promise<string>

/** Fetch live orders for a slug. */
export async function getOrders(slug: string): Promise<MarketOrder[]>

/** Full price check pipeline. */
export async function priceCheck(
  itemName: string,
  options?: { modRank?: number; onlineOnly?: boolean; platform?: string }
): Promise<MarketPriceResult>
```

`getItemsMap` logic:
1. Check cache key `"market:items"`.
2. On miss: `GET /items` → `MarketItem[]`.
3. Build `Map<string, string>`: `item.i18n.en.name.toLowerCase().trim()` → `item.slug`.
4. Cache the Map, return it.

`resolveSlug` logic:
1. Load items map.
2. Try `map.get(itemName.toLowerCase().trim())` — exact match.
3. No exact match → scan entries for `key.includes(normalizedName)`.
4. Multiple contains matches → pick shortest key.
5. Zero matches → throw with 3 closest guesses (substring scoring).

`priceCheck` logic:
1. `resolveSlug(itemName)`.
2. `getOrders(slug)` → `MarketOrder[]`.
3. Filter:
   - `onlineOnly`: keep `user.status !== "offline"`.
   - `modRank` specified: keep `order.rank === modRank`.
   - `platform` specified: keep `user.platform === platform || user.crossplay`.
4. Split into `sells` / `buys`.
5. Sort sells ascending, buys descending.
6. Compute `PriceSummary` for each: min, max, median (middle index), average.
7. `cheapestSellers` = first 5 of sorted sells.

---

## `src/api/profile.ts`

Thin wrapper — error handling belongs in `src/tools/profile.ts`.

```typescript
import { getProfileStats } from "./warframestat.js";
import type { PlayerProfile } from "../types/index.js";

export async function fetchPlayerProfile(username: string): Promise<PlayerProfile> {
  return getProfileStats(username);
}
```

---

## `src/tools/worldstate.ts`

Tool registration pattern for all tool files:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ws from "../api/warframestat.js";
import * as fmt from "../utils/formatting.js";

export function registerWorldstateTools(server: McpServer): void {
  server.tool("world_state", "..description..", { /* zod schema */ }, async (args) => {
    try {
      // ... implementation
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  });
}
```

### `world_state` logic

1. Determine sections (default = all).
2. Fire only requested sections in parallel using `Promise.allSettled`.
3. Check each result — if `status === "rejected"`, show "data unavailable" for that section.
4. Build output string:
   - Header: `=== WARFRAME WORLD STATE (PC) ===`
   - Cycles: each with `isActive` + `timeRemaining`.
   - Sortie: 3 variants, show modifier descriptions.
   - Archon Hunt: 3 missions.
   - Nightwave: group challenges by `isDaily` / `isElite` / `isPermanent`.
   - Steel Path: current reward + cost + time remaining.
   - Invasions: filter `completed: false` only.
   - Events: include interim step milestones.
   - Construction: fomorian + razorback percentages.
   - Daily Deals: item + sale price + discount %.

### `baro_kiteer` logic

1. Fetch `voidTrader`.
2. `isActive(data.activation, data.expiry)`:
   - Not active → format countdown.
   - Active → categorize inventory (items with `ducats > 0` vs decorations).
3. If `show_worth_analysis: true`: for each item with `ducats > 50`, call `priceCheck`. Catch errors silently. Compute plat-per-ducat ratio. Flag: >1.0 = "Good value", 0.3–1.0 = "Decent", <0.3 = "Low value".

### `active_fissures` logic

1. Fetch fissures.
2. Apply filters: `tier`, `isHard`, `isStorm`, `missionType` (case-insensitive contains).
3. Sort: `tierNum` ascending, then `expiry` ascending.
4. Group by tier. Add count summary at top.

---

## `src/tools/items.ts`

### Name matching helper (reuse across all 4 tools)

```typescript
function bestMatch<T extends { name: string }>(results: T[], query: string): T | undefined {
  if (results.length === 0) return undefined;
  if (results.length === 1) return results[0];
  const q = query.toLowerCase();
  return results.find(r => r.name.toLowerCase() === q)
    ?? results.find(r => r.name.toLowerCase().startsWith(q))
    ?? results[0];  // API orders by relevance
}
```

### `lookup_warframe` logic

1. `searchWarframes(name)` → pick `bestMatch`.
2. Format:
   - Header + vaulted status.
   - Stats: health / shield / armor / energy / sprint.
   - Aura + polarities via `formatPolarity`.
   - Abilities (numbered list).
   - Components: for each, list drop locations. **`drops[].chance` is decimal — multiply ×100 for display.**
   - Build cost + time.
   - Introduced date.

### `lookup_weapon` logic

1. `searchWeapons(name)` → pick `bestMatch`.
2. Format:
   - Header: category, type, vaulted status.
   - Per attack in `attacks[]`: total damage (sum `damage` object), damage type breakdown, crit/status.
   - Polarities.
   - Components + drop sources.

### `lookup_mod` logic

1. `searchMods(name)` → pick `bestMatch`.
2. Format:
   - Header: type, rarity, tradeable, transmutable.
   - Polarity + base drain + max rank.
   - `levelStats` table: every rank, drain = `baseDrain + rank`.
   - Drop locations grouped by source type (Enemy / Mission rotation / Other). Sort by `chance` desc. Top 10 only.

### `lookup_item` logic

1. `searchItems(name)` → pick `bestMatch`.
2. Dynamically format present fields:
   - Always: `type`, `category`, `rarity`, `tradable`.
   - If `levelStats`: arcane progression table.
   - If `components`: list them.
   - If `drops`: top acquisition sources.

---

## `src/tools/market.ts`

### `market_price_check` logic

1. `priceCheck(item_name, { modRank, onlineOnly, platform })`.
2. On `resolveSlug` failure: catch, return friendly "item not found" with the error's suggestions.
3. Format `MarketPriceResult` per spec in `03-TOOL-SPECIFICATIONS.md`.
4. Generate trade chat messages:
   - Buy: `"WTB {name} {highestBuyOffer}p"` (or `median_sell - 10%` if no buy orders).
   - Sell: `"WTS {name} {lowestSellAsk}p"`.

---

## `src/tools/drops.ts`

### `search_drops` logic

1. `searchDrops(query)` → `DropResult[]`.
2. Filter: `result.chance >= min_chance`.
3. Sort by `chance` descending.
4. Limit to `limit` results.
5. Group by source type:
   - "Relic" if `place` contains "Relic".
   - "Mission" if `place` contains "(" and not "Relic".
   - "Enemy" if `place` has no "(" and no "Relic".
   - "Other" otherwise.

### `relic_drops` logic

1. `searchDrops(query)` → filter to entries where `place` contains "Relic".
2. Group by normalized relic name (strip refinement suffix).
3. Per relic, show all 4 refinement levels + chances.
4. If `show_relic_sources: true`: for each unique relic, call `searchDrops(relicName)`, filter to mission nodes (exclude entries where `place` contains "Relic"), show relic farming locations.
5. Add recommended farming route at end.

```typescript
function normalizeRelicName(place: string): string {
  return place.replace(/\s*\((Intact|Exceptional|Flawless|Radiant)\)\s*$/, "").trim();
}

function getRefinementLevel(place: string): "Intact" | "Exceptional" | "Flawless" | "Radiant" {
  const match = place.match(/\((Intact|Exceptional|Flawless|Radiant)\)/);
  return (match?.[1] as "Intact" | "Exceptional" | "Flawless" | "Radiant") ?? "Intact";
}
```

---

## `src/tools/primeVault.ts`

### `prime_vault_status` logic

1. `searchItems(name)` or `searchWarframes(name)` — try warframes first, fall back to items.
2. `getVaultTrader("pc")`.
3. Check `item.vaulted`.
4. Check if item name appears in Varzia inventory (partial match: "Ash Prime" matches "Ash Prime Set").
5. Determine status:
   - `vaulted: false` → FARMABLE. Show relic drop sources from `components[].drops`.
   - `vaulted: true` + in Varzia → PRIME RESURGENCE. List Varzia inventory.
   - `vaulted: true` + not in Varzia → FULLY VAULTED. Show trade recommendation.
6. Always show part ducat values at bottom.

---

## `src/tools/simaris.ts`

### `simaris_target` logic

1. `getSimaris(platform)`.
2. If `target` empty or `isTargetActive: false` with empty target → "No active target".
3. `searchDrops(target)` → filter to mission nodes (entries containing "(").
4. `searchSolNodes(target)` → find sol nodes.
5. Rank: non-endless missions first (Exterminate, Capture, Spy > Survival, Defense).
6. Format with synthesis tips.

---

## `src/tools/enemy.ts`

### `find_enemy_spawn` logic

1. `searchDrops(enemy)` → extract mission node names from `place` fields.
2. `searchSolNodes(enemy)` → additional node data.
3. Apply `mission_preference` filter if specified.
4. If `steel_path: true`: note SP versions are level 100+.
5. Format: confirmed spawns, then likely spawns.

---

## `src/tools/profile.ts`

### Error handling wrapper (use for all 5 profile tools)

```typescript
async function withProfileError<T>(
  username: string,
  fn: (profile: PlayerProfile) => T
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const profile = await fetchPlayerProfile(username);
    const result = fn(profile);
    return { content: [{ type: "text", text: String(result) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    return { content: [{ type: "text", text: formatProfileError(username, isTimeout) }] };
  }
}

function formatProfileError(username: string, isTimeout: boolean): string {
  return `Could not retrieve profile for "${username}".\n\n` +
    `Possible reasons:\n` +
    `  • Username is misspelled (case-sensitive)\n` +
    `  • Player has set their profile to private\n` +
    (isTimeout ? `  • DE's profile API timed out (try again in a moment)\n` : "") +
    `  • DE's profile API is temporarily unavailable\n` +
    `  • Profile may be on a different platform\n\n` +
    `Try again or check the username in-game.`;
}
```

### `player_profile` logic

1. Extract: `displayName`, `playerLevel`, `guildName`, `guildTier`, `accountCreated`, `deathMarks`, `activePreset`.
2. Resolve `activePreset.focus` via `FOCUS_SCHOOL_NAMES`. Unknown key → "None selected".
3. Resolve active gear: look up `activePreset.suit` in `loadout.suits[]` by `uniqueName`. Fall back to raw uniqueName.
4. Death marks: map last path component to friendly name (e.g. `StalkerCorpus` → "Stalker (Corpus)").

### `player_mastery_items` logic

1. Extract `xpInfo ?? []`.
2. Detect category from `uniqueName` prefix:
   ```
   /Lotus/Powersuits/ (not Archwing) → Warframes
   /Lotus/Weapons/Tenno/LongGuns/    → Primary
   /Lotus/Weapons/Tenno/Pistols/     → Secondary
   /Lotus/Weapons/Tenno/Melee/       → Melee
   /Lotus/Weapons/Tenno/Archwing/    → Archwing Weapon
   /Lotus/Types/Sentinels/           → Companion
   /Lotus/Types/Companions/          → Companion
   /Lotus/Powersuits/Archwing/       → Archwing
   /Lotus/Types/Player/Mechs/        → Necramech
   (other)                           → Other
   ```
3. Apply `category` filter arg.
4. Compute rank via `xpToRank`. Sort: max rank first, then by XP desc.
5. Output summary counts per category.

### `player_stats` logic

1. Extract `stats ?? {}`.
2. Format `secondsPlayed` → hours/days via `formatPlayTime`.
3. `weaponList` sorted by `equiptime` desc → top 5.
4. `enemyList` sorted by `kills` desc → top 5.
5. `abilityUseList` sorted by `used` desc → top 5.

### `player_syndicates` logic

1. Extract `syndicates ?? []`.
2. Map `tag` → display name via `SYNDICATE_NAMES`. Unknown tag → use tag as-is.
3. Group: main factions / open world / other.
4. Extract `intrinsics` → format Railjack (Piloting/Gunnery/Engineering/Tactical/Command) and Drifter (Combat/Riding/Opportunity/Endurance).

### `player_loadout` logic

1. Extract `activePreset` and `loadout`.
2. For each slot: find matching `LoadoutItem` in `loadout.*[]` by `uniqueName`.
3. Show XP as rank string + Forma count (`polarized ?? 0`).
4. Item not in loadout arrays → show uniqueName + "(details unavailable)".

---

## `src/index.ts`

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWorldstateTools } from "./tools/worldstate.js";
import { registerItemTools } from "./tools/items.js";
import { registerMarketTools } from "./tools/market.js";
import { registerDropTools } from "./tools/drops.js";
import { registerPrimeVaultTools } from "./tools/primeVault.js";
import { registerSimarisTools } from "./tools/simaris.js";
import { registerEnemyTools } from "./tools/enemy.js";
import { registerProfileTools } from "./tools/profile.js";

const server = new McpServer({
  name: "warframe-mcp",
  version: "1.0.0",
});

registerWorldstateTools(server);
registerItemTools(server);
registerMarketTools(server);
registerDropTools(server);
registerPrimeVaultTools(server);
registerSimarisTools(server);
registerEnemyTools(server);
registerProfileTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**NEVER write to `process.stdout` directly.** `StdioServerTransport` owns stdout. Use `console.error` for all debug output.

---

## Error Handling

Every tool handler MUST have a top-level try/catch:

```typescript
server.tool("tool_name", description, schema, async (args) => {
  try {
    // ... implementation
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      content: [{
        type: "text",
        text: `Error fetching data: ${msg}\n\nThe API may be temporarily unavailable. Try again in a moment.`
      }]
    };
  }
});
```

HTTP error handling:
- **404**: "No results found for {query}. Check spelling."
- **429**: Already retried in `warframe-market.ts`.
- **500/503**: "API temporarily unavailable."
- **AbortError**: "Request timed out. API may be slow or unavailable."

Empty array from search:

```typescript
if (results.length === 0) {
  return { content: [{ type: "text", text: `No results found for "${name}".\nCheck spelling. Names are case-sensitive (e.g., "Rhino Prime" not "rhino prime").` }] };
}
```

---

## Parallelism

For `world_state`, use `Promise.allSettled` so one failed endpoint doesn't block others:

```typescript
const [sortie, archon, nightwave, invasions, cetus, vallis, cambion, earth] =
  await Promise.allSettled([
    ws.getSortie(platform),
    ws.getArchonHunt(platform),
    ws.getNightwave(platform),
    ws.getInvasions(platform),
    ws.getCetusCycle(platform),
    ws.getVallisCycle(platform),
    ws.getCambionCycle(platform),
    ws.getEarthCycle(platform),
  ]);

const sortieData = sortie.status === "fulfilled" ? sortie.value : null;
// If null, show "Sortie: data unavailable" in that section
```
