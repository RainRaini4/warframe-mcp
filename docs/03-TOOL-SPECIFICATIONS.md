# MCP Tool Specifications

The Cloudflare Worker publishes six read-only tools: four direct market tools and the OpenAI-compatible `search`/`fetch` pair. The numbered sections retain specifications for the legacy Node tool set.

All direct `wfm_*` tools accept optional `platform` and `crossplay` filters. Search and top-orders also expose `language`:

```typescript
{
  language: "ru",
  platform: "pc",
  crossplay: true
}
```

Every successful `wfm_*` response includes short text `content`, matching `structuredContent`, applied `filters`, and an ISO 8601 retrieval timestamp (`retrieved_at` for search/top orders, `retrievedAt` for statistics/liquidity). All six Worker tools set `readOnlyHint=true`, `destructiveHint=false`, and make no authenticated or mutating requests.

The shared Worker client limits external request starts to three per second per isolate. It retries `429`, `509`, temporary `5xx`, and network failures, honors `Retry-After`, and otherwise uses bounded exponential backoff with jitter. It does not retry `400`, `403`, `404`, validation errors, or timeouts. Identical concurrent endpoint/filter requests are deduplicated.

## Worker: `wfm_search_items`

```typescript
z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(10).optional(),
  language: MarketLanguage.default("ru").optional(),
  platform: MarketPlatform.default("pc").optional(),
  crossplay: z.boolean().default(true).optional()
})
```

Search fields are Russian name, English name, and slug. Normalization covers case, Unicode decomposition, `ё`/`е`, punctuation, hyphens, underscores, and repeated whitespace. Exact normalized matches rank above substring matches; no fuzzy edit-distance search is performed.

Each result contains `id`, `slug`, `name_ru`, `name_en`, and an absolute `https://warframe.market/items/{slug}` URL. The catalog cache TTL is six hours. When a non-Russian API language is requested, the client also obtains the cached Russian catalog so both required names remain available.

## Worker: `wfm_get_top_orders`

```typescript
z.object({
  slug: z.string().trim().min(1).max(200),
  language: MarketLanguage.default("ru").optional(),
  platform: MarketPlatform.default("pc").optional(),
  crossplay: z.boolean().default(true).optional()
})
```

Calls `GET /v2/orders/item/{slug}/top`, cached for 20 seconds. The `sell` list is sorted by platinum ascending and `buy` by platinum descending. Each compact order includes its ID, price, quantity, available item qualifiers, update time, and public user summary.

## Worker: `wfm_get_item_statistics`

```typescript
z.object({
  slug: z.string().trim().min(1).max(200),
  platform: MarketPlatform.default("pc").optional(),
  crossplay: z.boolean().default(true).optional(),
  rank: z.number().int().min(0).optional(),
  subtype: z.string().trim().min(1).max(100).optional(),
  charges: z.number().int().min(0).optional(),
  amberStars: z.number().int().min(0).optional(),
  cyanStars: z.number().int().min(0).optional()
})
```

The item must exist in the v2 catalog, and supplied variant values must be supported by its declared limits. The tool then reads deprecated v1 closed-order buckets for `48hours` and `90days`, cached for five minutes. Raw history is cached independently of the requested exact variant and normalized after retrieval.

Each result variant contains normalized closed buckets and summaries with reported volume, bucket counts, average bucket volume, latest median, volume-weighted median, volume-weighted average price, and time bounds. Status is `available`, `empty`, or `unsupported_variant_dimensions`. Missing values remain `null`; unknown legacy fields are skipped with warnings.

Rank, subtype, charges, amber stars, and cyan stars are never intentionally combined across variants. If the current catalog declares a dimension absent from the legacy response, the tool returns `unsupported_variant_dimensions` rather than a misleading aggregate. Every result marks its source as deprecated and explains that reported closed volume is not a complete or independently verified record of in-game trades.

## Worker: `wfm_get_item_liquidity`

Input is the same as `wfm_get_item_statistics`. The result contains one entry per exact variant, or only the requested variant when a filter is supplied:

```typescript
interface LiquidityVariantResult {
  variant: { rank?: number; subtype?: string; charges?: number; amberStars?: number; cyanStars?: number };
  currentMarket: {
    activeSellOrders: number;
    activeBuyOrders: number;
    onlineSellOrders: number;
    onlineBuyOrders: number;
    bestSell: number | null;
    bestBuy: number | null;
    midpoint: number | null;
    absoluteSpread: number | null;
    spreadPercent: number | null;
    sellDepthAtBestPrice: number;
    buyDepthAtBestPrice: number;
  };
  history: {
    reportedClosedVolume48h: number | null;
    reportedClosedVolume90d: number | null;
    averageDailyClosedVolume90d: number | null;
    latestMedianPrice48h: number | null;
    weightedAveragePrice48h: number | null;
  };
  assessment: {
    score: number | null;
    grade: "very_high" | "high" | "medium" | "low" | "very_low" | "unknown";
    confidence: "high" | "medium" | "low";
    reasons: string[];
  };
}
```

Current counts and best-price depth come from the full visible `/v2/orders/item/{slug}` snapshot; online means `online` or `ingame`. Exact variant-filtered `/top` calls supply current best prices and fall back to the full snapshot with a warning on failure. Midpoint is `(bestSell + bestBuy) / 2`; spread percent is `(bestSell - bestBuy) / midpoint × 100`, clamped to a non-negative absolute spread. A missing side produces `null` midpoint and spread.

The deterministic local score is:

```text
volume = 50 × min(1, log1p(averageDailyClosedVolume90d) / log1p(50))
depth  = 25 × min(1, log1p(min(onlineSellOrders, onlineBuyOrders)) / log1p(20))
spread = 25 × max(0, min(1, 1 - spreadPercent / 50))
score  = round-to-0.1(clamp(volume + depth + spread, 0, 100))
```

Grades are `very_high` for 85–100, `high` for 70–84.9, `medium` for 50–69.9, `low` for 25–49.9, and `very_low` below 25. Confidence is `high` only when both history windows and both online order sides exist; it is `medium` with usable 90-day history but incomplete supporting signals. Without usable 90-day history, score is `null`, grade is `unknown`, and confidence is `low`.

Reasons are stable machine-readable labels such as `high_90d_volume`, `low_90d_volume`, `deep_two_sided_market`, `one_sided_market`, `tight_spread`, `wide_spread`, `spread_unavailable`, and history-degradation reasons. This score is a local heuristic, not a guarantee of execution speed, executable price, or profit.

## Worker: `search`

The schema follows the [OpenAI MCP compatibility contract](https://developers.openai.com/api/docs/mcp):

```typescript
// Input
z.object({ query: z.string().trim().min(1).max(200) })

// Output
z.object({
  results: z.array(z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.string().url()
  })).max(10)
})
```

The tool delegates to the existing Russian/English/slug item search with the default filters. IDs are deterministic `wfm:item:<slug>` values. `id`, `title`, and absolute `url` are the standard compatibility fields; the short `text` field is an additive item summary. The output object is returned in `structuredContent` and duplicated as a JSON-encoded string in text `content`.

## Worker: `fetch`

```typescript
// Input
z.object({ id: z.string() })

// Output
z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string().url(),
  metadata: z.object({
    source: z.literal("warframe.market"),
    slug: z.string(),
    name_ru: z.string(),
    name_en: z.string(),
    language: MarketLanguage,
    platform: MarketPlatform,
    crossplay: z.boolean(),
    retrieved_at: z.string(),
    warning: z.string(),
    top_sell_orders: z.array(MarketTopOrder),
    top_buy_orders: z.array(MarketTopOrder)
  })
})
```

Only IDs matching `wfm:item:<slug>` are accepted. The tool confirms that the slug exists through the item search service before requesting top orders. The document text and metadata include both localized names, the item URL, current sell/buy orders, actual platform/crossplay filters, retrieval time, and a warning that the data is a current market snapshot. As required by the OpenAI contract, `structuredContent` is duplicated as JSON in text `content`.

## Legacy Node tools

| # | Tool | API |
|---|------|-----|
| 1 | `world_state` | warframestat.us |
| 2 | `baro_kiteer` | warframestat.us + warframe.market |
| 3 | `active_fissures` | warframestat.us |
| 4 | `lookup_warframe` | warframestat.us |
| 5 | `lookup_weapon` | warframestat.us |
| 6 | `lookup_mod` | warframestat.us |
| 7 | `lookup_item` | warframestat.us |
| 8 | `market_price_check` | warframe.market v2 |
| 9 | `search_drops` | warframestat.us |
| 10 | `relic_drops` | warframestat.us |
| 11 | `prime_vault_status` | warframestat.us |
| 12 | `simaris_target` | warframestat.us |
| 13 | `find_enemy_spawn` | warframestat.us |
| 14 | `player_profile` | warframestat.us |
| 15 | `player_mastery_items` | warframestat.us |
| 16 | `player_stats` | warframestat.us |
| 17 | `player_syndicates` | warframestat.us |
| 18 | `player_loadout` | warframestat.us |

---

## 1. `world_state`

```typescript
z.object({
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional(),
  sections: z.array(z.enum([
    "sortie", "archon_hunt", "nightwave", "invasions",
    "cycles", "events", "steel_path", "construction", "daily_deals"
  ])).optional()
})
```

Fire all requested sections in parallel with `Promise.allSettled`. Default = all sections.

| Section | Endpoint |
|---------|----------|
| sortie | `GET /{platform}/sortie` |
| archon_hunt | `GET /{platform}/archonHunt` |
| nightwave | `GET /{platform}/nightwave` |
| invasions | `GET /{platform}/invasions` |
| cycles | `/cetusCycle`, `/vallisCycle`, `/cambionCycle`, `/earthCycle` |
| events | `GET /{platform}/events` |
| steel_path | `GET /{platform}/steelPath` |
| construction | `GET /{platform}/constructionProgress` |
| daily_deals | `GET /{platform}/dailyDeals` |

- Nightwave: group challenges by `isDaily` / `isElite` / `isPermanent`.
- Invasions: show only `completed: false`.
- Any failed endpoint: show "data unavailable" for that section — do not fail the whole response.

```
=== WARFRAME WORLD STATE (PC) ===
Updated: 2026-03-06T18:48:00Z

--- OPEN WORLD CYCLES ---
Plains of Eidolon (Cetus): NIGHT — 14m 35s remaining
Orb Vallis (Fortuna): COLD — 20m 8s remaining
Cambion Drift (Necralisk): VOME — 14m 35s remaining
Earth: DAY — 51m 35s remaining

--- DAILY SORTIE (Grineer | Kela De Thaym) ---
  1. Interception — Umbriel (Uranus) | Modifier: Eximus Stronghold
  2. Rescue — Grimaldi (Lua) | Modifier: Energy Reduction
  3. Assassination — Merrow (Sedna) | Modifier: Enemy Elemental Enhancement: Magnetic
Resets in: 22h 12m

--- ARCHON HUNT (Narmer | Archon Wolf) ---
  1. Extermination — Olympus (Mars)
  2. Disruption — Spear (Mars)
  3. Assassination — War (Mars)
Resets in: 2d 5h 12m

--- NIGHTWAVE: Radio Legion Intermission (Season 16) ---
  Daily:
    • Arsonist — Kill 150 Enemies with Heat Damage (1,000 rep) — expires in 8h
  Weekly:
    • Mission Complete XIX — Complete any 15 missions (4,500 rep) — expires in 2d 5h
  Elite Weekly:
    • Hold Your Breath — Survive 20+ min in Kuva Survival (7,000 rep)

--- STEEL PATH HONORS ---
  Current Rotating Reward: Zaw Riven Mod (75 Steel Essence)
  Resets in: 2d 4h 51m

--- ACTIVE INVASIONS ---
  • Kappa (Sedna): Corpus vs Grineer — 4.7% complete
    Attacker (Corpus): Dera Vandal Barrel
    Defender (Grineer): Strun Wraith Stock

--- ACTIVE EVENTS ---
  • Thermia Fractures — Orb Vallis (Venus) — expires 2026-03-12
    Progress: 11/100 | Final reward: Opticor Vandal

--- DARVO DAILY DEALS ---
  • Vasto — 152p (was 190p, 20% off) — 9/200 sold — expires 2026-03-07

--- CONSTRUCTION PROGRESS ---
  Fomorian: 45.08%  |  Razorback: 46.22%
```

---

## 2. `baro_kiteer`

```typescript
z.object({
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional(),
  show_worth_analysis: z.boolean().default(true).optional()
})
```

1. `GET /{platform}/voidTrader`
2. If active + `show_worth_analysis: true`: `GET /v2/orders/item/{slug}` for each tradeable item. Resolve slugs from market items cache. Catch errors silently — not all Baro items exist on market.

- Active check: `new Date() >= new Date(activation) && new Date() <= new Date(expiry)`
- Worth: median plat / ducat cost. >1.0 = "Good value", 0.3–1.0 = "Decent", <0.3 = "Low value".

**Active:**
```
=== BARO KI'TEER — CURRENTLY ACTIVE ===
Location: Kronia Relay (Saturn)
Departs in: 1d 19h 12m

PRIMED MODS:
  • Primed Slip Magazine — 280 ducats + 200,000 credits
    Market: ~45p median — 0.16 plat/ducat ⚠ Low value

COSMETICS / DECORATIONS:
  • Horse2026 Badge Item — 0 ducats + 1 credit
```

**Inactive:**
```
=== BARO KI'TEER — NOT CURRENTLY ACTIVE ===
Next arrival: 2026-03-20T14:00:00Z (13 days from now)
Last known location: Kronia Relay (Saturn)

Baro Ki'Teer visits every 2 weeks, staying for 48 hours.
```

---

## 3. `active_fissures`

```typescript
z.object({
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional(),
  tier: z.enum(["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"]).optional(),
  steel_path: z.boolean().optional(),
  void_storm: z.boolean().optional(),
  mission_type: z.string().optional()
})
```

`GET /{platform}/fissures`. Filter: `tier` (exact), `isHard` (steel_path), `isStorm` (void_storm), `missionType` (case-insensitive contains). Sort: `tierNum` asc, then `expiry` asc. Group by tier.

```
=== ACTIVE VOID FISSURES (PC) ===
Total active: 12

LITH (Tier 1):
  [none currently active]

NEO (Tier 3):
  • Umbriel (Uranus) — Interception | Grineer — expires in 21m
  • Paimon (Europa) — Defense | Corpus — expires in 22m [STEEL PATH]

AXI (Tier 4):
  • Adaro (Sedna) — Extermination | Grineer — expires in 2h 0m

OMNIA (Any Relic):
  • Everview Arc (Zariman) — Void Flood | Crossfire — expires in 1h 1m [VOID STORM]
```

---

## 4. `lookup_warframe`

```typescript
z.object({ name: z.string() })
```

`GET /warframes/{name}`. Pick best match. `components[].drops[].chance` is **decimal** — multiply ×100 for display.

```
=== RHINO PRIME ===
Type: Warframe | Prime: Yes | VAULTED
Mastery Requirement: 0

STATS:
  Health: 100    Shield: 150    Armor: 290
  Energy: 150    Sprint: 0.95
Passive: Rhino's heavy landing sends enemies stumbling.

AURA POLARITY: Madurai (=)
MOD POLARITIES: Madurai (=), Madurai (=)

ABILITIES:
  1. Rhino Charge — Rhino charges towards a target...
  2. Iron Skin — Rhino hardens his skin...
  3. Roar — Grants all nearby Warframes increased damage...
  4. Rhino Stomp — Rhino stomps with force sufficient to disrupt time...

COMPONENTS:
  Blueprint (100 ducats if sold to Baro):
    • Axi R1 Relic — Rare (2% / 4% / 6% / 10% by refinement)
  Chassis (65 ducats):
    • Lith E1 Relic — Uncommon (11% / 13% / 17% / 20%)

Build Cost: 25,000 credits | Build Time: 3 days
Introduced: Update 12.4 (2014-03-05)
```

---

## 5. `lookup_weapon`

```typescript
z.object({ name: z.string() })
```

`GET /weapons/{name}`. Per attack: compute total damage (sum all `damage` object values). List only non-zero damage types.

```
=== SOMA PRIME ===
Category: Primary | VAULTED
Mastery Requirement: 7

FIRE MODE: Fully Spooled (Auto)
  Damage: 12.0 total (Impact 1.2 / Slash 6.0 / Puncture 4.8)
  Crit Chance: 30%  |  Crit Multiplier: 3.0x
  Status Chance: 10%
  Fire Rate: 15 rounds/sec
  Magazine: 200  |  Noise: Alarming

FIRE MODE: Incarnon Form (Auto)
  Damage: 18.0 total (Impact 1.08 / Slash 11.88 / Puncture 5.04)
  Crit Chance: 10%  |  Crit Multiplier: 3.4x

MOD POLARITIES: Madurai (=), Madurai (=), Naramon (-)

COMPONENTS:
  Blueprint (15 ducats):
    • Lith M1 Relic — Uncommon (11% / 13% / 17% / 20%)
  Barrel (15 ducats):
    • Lith M2 Relic — Uncommon (25.33% / 23.33% / 20% / 16.67%)

Build Cost: 15,000 credits | Build Time: 12 hours
```

---

## 6. `lookup_mod`

```typescript
z.object({ name: z.string() })
```

`GET /mods/{name}`. `levelStats` drain = `baseDrain + rank`. Group drops: Enemies / Missions / Other. Sort by `chance` desc. Top 10.

```
=== SERRATION ===
Type: Rifle Mod | Rarity: Rare | Tradeable: Yes | Transmutable: Yes
Polarity: Madurai (=) | Base Drain: 4 | Max Rank: 10

STATS PROGRESSION:
  Rank 0:  +15% Damage  (drain: 4)
  Rank 5:  +90% Damage  (drain: 9)
  Rank 10: +165% Damage (drain: 14)  ← MAX

BEST DROP LOCATIONS (top 10):
  Missions:
    • Saturn/Aegaeon (Spy), Rotation B — 5.56% (Rare)
  Enemies:
    • Nauseous Crawler — 0.33% (Uncommon)
```

---

## 7. `lookup_item`

```typescript
z.object({ name: z.string() })
```

`GET /items/{name}`. Dynamically format only present fields. If `levelStats`: arcane progression. If `components`: list them. If `drops`: top sources.

```
=== ARCANE ENERGIZE ===
Category: Arcane Enhancement | Rarity: Legendary | Tradeable: Yes
Max Rank: 5

STATS PROGRESSION:
  Rank 0: 15% chance on Energy Pickup to grant 150 Energy...
  Rank 5: 60% chance on Energy Pickup to grant 150 Energy...

ACQUISITION:
  • Dropped by Eidolon Hydrolyst (Plains of Eidolon, night)

Introduced: Update 22.0 (2017-10-12)
```

---

## 8. `market_price_check`

```typescript
z.object({
  item_name: z.string(),
  platform: z.enum(["pc", "ps4", "xbox", "switch"]).default("pc").optional(),
  mod_rank: z.number().int().min(0).max(10).optional(),
  online_only: z.boolean().default(true).optional()
})
```

1. `GET /v2/items` (24h cache) — resolve `item_name` to slug: exact match → contains match (shortest) → throw with 3 closest suggestions.
2. `GET /v2/orders/item/{slug}`
3. Filter: drop `user.status === "offline"` if `online_only`; keep `rank === mod_rank` if specified.
4. Split sell/buy. Sort sell asc, buy desc. Compute min/max/median/average/count. Cheapest sellers = first 5 of sorted sell.

```
=== MARKET PRICE: Ash Prime Set (PC) ===
Online sellers only

SELL ORDERS:
  Lowest: 45p    Median: 72p    Average: 78p    Highest: 150p
  Active sellers: 23

BUY ORDERS:
  Highest: 40p    Median: 30p    Average: 28p    Lowest: 10p
  Active buyers: 8

CHEAPEST ONLINE SELLERS:
  1. NicolaiBM — 45p (qty: 6) — in-game
  2. Evinari — 75p (qty: 3) — online

TRADE CHAT:
  Buying: "WTB Ash Prime Set 40p"
  Selling: "WTS Ash Prime Set 45p"
```

---

## 9. `search_drops`

```typescript
z.object({
  query: z.string(),
  min_chance: z.number().min(0).max(100).default(0).optional(),
  limit: z.number().int().min(1).max(50).default(20).optional()
})
```

`GET /drops/search/{query}`. Filter `chance >= min_chance`. Sort by `chance` desc. Limit. Group: Relic (`place` contains "Relic"), Mission (`place` contains "("), Enemy (no "(" and no "Relic"), Other.

```
=== DROP TABLE SEARCH: "ash prime systems" ===
Found 18 results (showing top 20)

FROM RELICS:
  • Axi A7 Relic (Radiant) — Ash Prime Systems Blueprint — 10% (Uncommon)
  • Axi A7 Relic (Flawless) — Ash Prime Systems Blueprint — 6% (Rare)
  • Axi A7 Relic (Intact) — Ash Prime Systems Blueprint — 2% (Rare)

FROM ENEMIES:
  [none]
```

---

## 10. `relic_drops`

```typescript
z.object({
  query: z.string(),
  show_relic_sources: z.boolean().default(true).optional()
})
```

1. `GET /drops/search/{query}` — filter to entries where `place` contains "Relic".
2. Group by base relic name: `place.replace(/\s*\((Intact|Exceptional|Flawless|Radiant)\)\s*$/, "").trim()`
3. Show all 4 refinement levels per relic.
4. If `show_relic_sources`: for each unique relic, `GET /drops/search/{relicName}` — filter to mission nodes (exclude entries where `place` contains "Relic").

```
=== RELIC DROPS: "Ash Prime Systems Blueprint" ===

RELICS CONTAINING THIS PART:
  Axi A7 Relic (RARE slot):
    Intact: 2%  |  Exceptional: 4%  |  Flawless: 6%  |  Radiant: 10%

WHERE TO GET Axi A7 RELICS:
  • Xini (Eris) — Interception, Rotation B — 7.69%
  • Hieracon (Pluto) — Excavation, Rotation B — 7.69%

RECOMMENDED:
  1. Farm Axi relics from Xini (Eris) Interception.
  2. Refine to Radiant (10% on Rare slot).
  3. Crack at any active Axi fissure (use active_fissures tool).
```

---

## 11. `prime_vault_status`

```typescript
z.object({ name: z.string() })
```

1. `GET /warframes/{name}` (fall back to `/items/{name}`) — check `vaulted` field.
2. `GET /pc/vaultTrader` — check Varzia inventory (case-insensitive partial match on item name).
3. Status:
   - `vaulted: false` → **FARMABLE** (show relic sources from `components[].drops`)
   - `vaulted: true` + in Varzia → **PRIME RESURGENCE** (list Varzia inventory)
   - `vaulted: true` + not in Varzia → **FULLY VAULTED** (trade recommendation)
4. Always show part ducat values.

```
=== PRIME VAULT STATUS: Ash Prime ===
Status: FULLY VAULTED
Not available in Varzia's current rotation.

To obtain: trade with other players (use market_price_check).
Current Prime Resurgence: Atlas Prime + Vauban Prime — active until 2026-03-19

PARTS & DUCAT VALUES:
  Blueprint: 100 ducats  |  Chassis: 65  |  Neuroptics: 45  |  Systems: 45
```

---

## 12. `simaris_target`

```typescript
z.object({
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

1. `GET /{platform}/simaris` — if `target` empty: return "No active target."
2. `GET /drops/search/{targetName}` — filter to entries where `place` contains "(" (mission nodes).
3. `GET /solNodes/search/{targetName}`
4. Prefer Capture/Exterminate over Survival/Defense for scan runs.

```
=== CEPHALON SIMARIS SYNTHESIS TARGET ===
Today's Target: Guardsman
Status: Active for scanning

RECOMMENDED NODES:
  • Draco (Ceres) — Survival, Grineer
  • Kappa (Sedna) — Defense, Grineer

SYNTHESIS TIPS:
  • Use Synthesis Scanner (not Codex Scanner)
  • Carrier with Investigator precept auto-scans
  • 5,000 Simaris standing per full synthesis (4 scans)
```

---

## 13. `find_enemy_spawn`

```typescript
z.object({
  enemy: z.string(),
  mission_preference: z.enum(["any", "survival", "defense", "extermination", "capture", "interception"]).default("any").optional(),
  steel_path: z.boolean().default(false).optional()
})
```

1. `GET /drops/search/{enemy}` — extract mission nodes (place contains "(").
2. `GET /solNodes/search/{enemy}` — cross-reference faction nodes.
3. Filter by `mission_preference`. Rank: confirmed (drop table) > likely (faction match).
4. If `steel_path: true`: note SP versions are level 100+.

```
=== ENEMY SPAWN FINDER: "Nox" ===

CONFIRMED (from drop tables):
  • Taveuni (Kuva Fortress) — Survival, Grineer
  • Kappa (Sedna) — Defense, Grineer

LIKELY (Grineer faction nodes):
  • Adaro (Sedna) — Extermination — level 40-50
  • Kuva Fortress — any mission
```

---

## 14. `player_profile`

```typescript
z.object({
  username: z.string(),
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

`GET /profile/{username}/stats` (10s timeout). Resolve `activePreset.focus` via `FOCUS_SCHOOL_NAMES`. Resolve `suit/longGun/pistol/melee` uniqueNames via `loadout.*` arrays. Map `deathMarks` to display names.

```
=== PLAYER PROFILE: TennoBoss ===
Platform: PC | Account Created: 2018-04-12

PROGRESSION:
  Mastery Rank: 28
  Clan: Void Hunters (Storm tier)

CURRENT LOADOUT:
  Warframe: Wisp Prime
  Primary: Felarx | Secondary: Laetum | Melee: Praedos
  Focus School: Zenurik

ACTIVE DEATH MARKS:
  ⚠ Stalker
```

**On failure:**
```
Could not retrieve profile for "TennoBoss".

Possible reasons:
  • Username misspelled (case-sensitive)
  • Profile set to private
  • DE's profile API temporarily unavailable (common)
  • Different platform
```

---

## 15. `player_mastery_items`

```typescript
z.object({
  username: z.string(),
  category: z.enum(["all","Warframes","Primary","Secondary","Melee","Companions","Archwing","Mechs"]).default("all").optional(),
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

`GET /profile/{username}/stats`. Extract `xpInfo`. Detect category from `uniqueName` prefix (see `07-PLAYER-DATA.md`). `xpToRank(xp)`: 450,000 = rank 30, 900,000 = rank 40. Sort: fully ranked first, then by XP desc.

**ALWAYS include:** "This list shows items with any XP. It does not confirm current ownership — items may have been sold. Items never used (0 XP) are absent."

```
=== MASTERY ITEMS: TennoBoss ===
Category: All | Items with XP: 347

WARFRAMES (45):
  Fully Ranked: Wisp Prime ✓, Mesa Prime ✓ ... (38 frames)
  In Progress:
    Caliban — Rank 15/30

NOTE: Items with 0 XP and sold items do not appear.
```

---

## 16. `player_stats`

```typescript
z.object({
  username: z.string(),
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

`GET /profile/{username}/stats`. `secondsPlayed` → hours/days. `weaponList` by `equiptime` desc → top 5. `enemyList` by `kills` desc → top 5. `abilityUseList` by `used` desc → top 5.

```
=== PLAYER STATS: TennoBoss ===

CAREER SUMMARY:
  Play Time: 2,340 hours
  Missions: 15,847 completed | 312 quit | 89 failed
  Total Kills: 8,432,150
  Deaths: 4,821 | Revives: 11,204

TOP WEAPONS (by equip time):
  1. Felarx — 340h, 892,450 kills
  2. Kuva Zarr — 280h, 1,240,000 kills

TOP ENEMIES KILLED:
  1. Grineer Lancer — 842,150 kills
```

---

## 17. `player_syndicates`

```typescript
z.object({
  username: z.string(),
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

`GET /profile/{username}/stats`. Map `tag` → display name via `SYNDICATE_NAMES`. `title` 0–5; 5 = Maxed. Group: Main / Open World / Other.

```
=== PLAYER SYNDICATES: TennoBoss ===

MAIN SYNDICATES:
  Steel Meridian          | 5/5 | Maxed
  New Loka                | 2/5 | 12,400 standing

OPEN WORLD:
  Ostron (Cetus)          | 5/5 | Maxed

RAILJACK INTRINSICS:
  Piloting: 10  |  Gunnery: 10  |  Engineering: 10  |  Tactical: 10  |  Command: 10

DRIFTER INTRINSICS:
  Combat: 10  |  Riding: 10  |  Opportunity: 8  |  Endurance: 7
```

---

## 18. `player_loadout`

```typescript
z.object({
  username: z.string(),
  platform: z.enum(["pc", "ps4", "xb1", "swi"]).default("pc").optional()
})
```

`GET /profile/{username}/stats`. For each slot in `activePreset`, find matching `LoadoutItem` in `loadout.*[]` by `uniqueName`. Show `xpToRank(xp)` and `polarized` (Forma count).

**Always include:** "Mod configurations, color palettes, and skins are not available through the public profile API."

```
=== ACTIVE LOADOUT: TennoBoss ===
Focus School: Zenurik

WARFRAME: Wisp Prime
  Rank 40/40 (fully ranked) | Forma: 6

PRIMARY: Felarx
  Rank 30/30 | Forma: 5

SECONDARY: Laetum
  Rank 30/30 | Forma: 4

MELEE: Praedos
  Rank 30/30 | Forma: 3

NOTE: Mod configs and colors not available via public profile API.
```
