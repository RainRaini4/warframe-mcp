# API Reference

All examples are live production data.

---

## warframestat.us

**Base URL:** `https://api.warframestat.us`

**Required headers on every request:**
```
Accept: application/json
Accept-Language: en
```

**NEVER omit `Accept-Language: en`** — archon hunt boss name and other strings return localized (Chinese observed).

**Platform prefix:** Worldstate endpoints require `/{platform}/` — values: `pc`, `ps4`, `xb1`, `swi`. Default: `pc`.
Static data endpoints (items, weapons, mods, drops) have **no** platform prefix.

---

### `GET /{platform}/voidTrader`

```json
{
  "id": "5d1e07a0a38e4a4fdd7cefca",
  "activation": "2026-03-06T14:00:00.000Z",
  "expiry": "2026-03-08T14:00:00.000Z",
  "character": "Baro Ki'Teer",
  "location": "Kronia Relay (Saturn)",
  "inventory": [
    { "uniqueName": "/Lotus/StoreItems/Upgrades/Mods/Pistol/Expert/WeaponClipMaxModExpert", "item": "Primed Slip Magazine", "ducats": 280, "credits": 200000 }
  ]
}
```

- `inventory` is `[]` when Baro is not active.
- Active: `now >= activation && now <= expiry`.

---

### `GET /{platform}/vaultTrader`

Varzia (Prime Resurgence) at Maroo's Bazaar.

```json
{
  "id": "631f8c4ac36af423770eaa97",
  "activation": "2026-02-19T19:00:00.000Z",
  "expiry": "2026-03-19T18:00:00.000Z",
  "character": "Varzia",
  "location": "Maroo's Bazaar (Mars)",
  "inventory": [
    { "uniqueName": "/Lotus/StoreItems/Powersuits/Brawler/AtlasPrime", "item": "Atlas Prime", "ducats": 3, "credits": null },
    { "uniqueName": "/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionAtlasVaubanVaultABronze", "item": "T1 Void Projection Atlas Vauban Vault A Bronze", "ducats": null, "credits": 1 }
  ]
}
```

- **`ducats` = Aya cost, NOT actual ducats.**
- `ducats: null, credits: 1` = relic purchasable with credits.

---

### `GET /{platform}/fissures`

```json
[
  {
    "id": "69ab093ef1cc84e90a8ce5b1",
    "activation": "2026-03-06T17:05:02.768Z",
    "expiry": "2026-03-06T19:04:51.497Z",
    "node": "Adaro (Sedna)",
    "missionType": "Extermination",
    "missionTypeKey": "Extermination",
    "enemy": "Grineer",
    "tier": "Axi",
    "tierNum": 4,
    "isStorm": false,
    "isHard": false
  }
]
```

- `tier`: `"Lith"` (1) / `"Meso"` (2) / `"Neo"` (3) / `"Axi"` (4) / `"Requiem"` (5) / `"Omnia"` (6)
- `isHard: true` = Steel Path; `isStorm: true` = Void Storm (Railjack)

---

### `GET /{platform}/sortie`

```json
{
  "id": "69ab048ff6a757c9d88ce5b1",
  "activation": "2026-03-06T17:00:00.000Z",
  "expiry": "2026-03-07T17:00:00.000Z",
  "rewardPool": "Sortie Rewards",
  "variants": [
    { "missionType": "Interception", "modifier": "Eximus Stronghold", "modifierDescription": "Eximus units have a much higher spawn rate in this mission.", "node": "Umbriel (Uranus)" },
    { "missionType": "Rescue", "modifier": "Energy Reduction", "modifierDescription": "Maximum Warframe Energy capacity is quartered.", "node": "Grimaldi (Lua)" },
    { "missionType": "Assassination", "modifier": "Enemy Elemental Enhancement: Magnetic", "modifierDescription": "Enemies deal increased Magnetic damage.", "node": "Merrow (Sedna)" }
  ],
  "boss": "Kela De Thaym",
  "faction": "Grineer"
}
```

---

### `GET /{platform}/archonHunt`

**MUST send `Accept-Language: en`** — `boss` field returns Chinese without it.

```json
{
  "id": "69a4cf7ed82a87bf088ce5b3",
  "activation": "2026-03-02T00:00:00.000Z",
  "expiry": "2026-03-09T00:00:00.000Z",
  "missions": [
    { "node": "Olympus (Mars)", "type": "Extermination" },
    { "node": "Spear (Mars)", "type": "Disruption" },
    { "node": "War (Mars)", "type": "Assassination" }
  ],
  "boss": "Archon Wolf",
  "faction": "Narmer"
}
```

---

### `GET /{platform}/nightwave`

```json
{
  "season": 16,
  "tag": "Radio Legion Intermission14 Syndicate",
  "activation": "2025-10-27T18:19:59.000Z",
  "expiry": "2026-05-25T00:00:00.000Z",
  "activeChallenges": [
    { "id": "...", "activation": "2026-03-04T00:00:00.000Z", "expiry": "2026-03-07T00:00:00.000Z", "isDaily": true, "isElite": false, "desc": "Kill 150 Enemies with Heat Damage", "title": "Arsonist", "reputation": 1000, "isPermanent": false },
    { "id": "...", "isDaily": false, "isElite": true, "desc": "Survive for over 20 minutes in Kuva Survival", "title": "Hold Your Breath", "reputation": 7000, "isPermanent": false }
  ]
}
```

- `isDaily: true` = 1,000 standing daily
- `isElite: true` = 7,000 standing elite weekly
- `isElite: false, isDaily: false` = 4,500 standing regular weekly
- `isPermanent: true` = recovered/catchup challenge

---

### `GET /{platform}/invasions`

```json
[
  {
    "id": "69a88ceb5ac6e775418ce5b1",
    "node": "Kappa (Sedna)",
    "attacker": {
      "reward": { "items": [], "countedItems": [{ "count": 1, "type": "Dera Vandal Barrel" }], "credits": 0 },
      "faction": "Corpus"
    },
    "defender": {
      "reward": { "items": [], "countedItems": [{ "count": 1, "type": "Strun Wraith Stock" }], "credits": 0 },
      "faction": "Grineer"
    },
    "vsInfestation": false,
    "completion": 4.73,
    "completed": false
  }
]
```

- `vsInfestation: true` = only defender has rewards.
- `completed: true` = skip (over).
- `completion` = percentage 0–100.

---

### `GET /{platform}/steelPath`

```json
{
  "currentReward": { "name": "Zaw Riven Mod", "cost": 75 },
  "activation": "2026-03-02T00:00:00.000Z",
  "expiry": "2026-03-08T23:59:59.000Z",
  "remaining": "2d 4h 51m 33s",
  "rotation": [
    { "name": "Umbra Forma Blueprint", "cost": 150 },
    { "name": "50,000 Kuva", "cost": 55 }
  ],
  "evergreens": [
    { "name": "Veiled Riven Cipher", "cost": 20 }
  ],
  "incursions": { "id": "spi:1772755200000", "activation": "2026-03-06T00:00:00.000Z", "expiry": "2026-03-06T23:59:59.000Z" }
}
```

---

### Open World Cycles

`GET /{platform}/cetusCycle`
```json
{ "activation": "2026-03-06T18:33:00.000Z", "expiry": "2026-03-06T19:23:00.000Z", "isDay": false, "state": "night", "timeLeft": "14m 35s", "isCetus": true }
```

`GET /{platform}/vallisCycle`
```json
{ "activation": "2026-03-06T19:00:00.000Z", "expiry": "2026-03-06T19:20:08.000Z", "isWarm": false, "state": "cold" }
```

`GET /{platform}/cambionCycle`
```json
{ "activation": "2026-03-06T18:33:00.000Z", "expiry": "2026-03-06T19:23:00.000Z", "timeLeft": "14m 35s", "state": "vome" }
```

`GET /{platform}/earthCycle`
```json
{ "activation": "2026-03-06T16:00:00.603Z", "expiry": "2026-03-06T20:00:00.603Z", "isDay": true, "state": "day", "timeLeft": "51m 35s" }
```

---

### `GET /{platform}/simaris`
```json
{ "target": "Guardsman", "isTargetActive": false }
```

---

### `GET /{platform}/events`
```json
[
  {
    "activation": "2026-02-26T17:00:00.000Z",
    "expiry": "2026-03-12T17:00:00.000Z",
    "description": "Thermia Fractures",
    "tooltip": "Seal fractures across the Orb Vallis",
    "node": "Orb Vallis (Venus)",
    "health": 11,
    "rewards": [{ "items": ["Opticor Vandal"], "countedItems": [], "credits": 0 }],
    "interimSteps": [
      { "goal": 5, "reward": { "items": ["Buried Debts Emblem"], "countedItems": [], "credits": 0 } },
      { "goal": 25, "reward": { "items": ["Amalgam Shotgun Spazz", "Amalgam Serration"], "countedItems": [], "credits": 0 } }
    ],
    "isPersonal": true
  }
]
```

---

### `GET /{platform}/constructionProgress`
```json
{ "fomorianProgress": "45.08", "razorbackProgress": "46.22", "unknownProgress": "0.00" }
```

---

### `GET /{platform}/dailyDeals`
```json
[{ "activation": "2026-03-06T15:00:00.000Z", "expiry": "2026-03-07T17:00:00.000Z", "item": "Vasto", "originalPrice": 190, "salePrice": 152, "total": 200, "sold": 9, "discount": 20 }]
```

---

### `GET /items/{query}` — Generic items

Returns array. **`components[].drops[].chance` is DECIMAL** — `0.02` = 2%. Multiply ×100 for display. Different from `/drops/search/`.

```json
[
  {
    "name": "Rhino Prime",
    "type": "Warframe",
    "category": "Warframes",
    "uniqueName": "/Lotus/Powersuits/Rhino/RhinoPrime",
    "isPrime": true,
    "vaulted": true,
    "abilities": [
      { "name": "Rhino Charge", "description": "Rhino charges towards a target..." },
      { "name": "Iron Skin", "description": "Rhino hardens his skin..." },
      { "name": "Roar", "description": "Grants all nearby Warframes increased damage..." },
      { "name": "Rhino Stomp", "description": "Rhino stomps with force sufficient to disrupt time..." }
    ],
    "health": 100, "shield": 150, "armor": 290, "power": 150, "sprint": 0.95,
    "aura": "madurai",
    "polarities": ["madurai", "madurai"],
    "masteryReq": 0,
    "buildPrice": 25000,
    "buildTime": 259200,
    "components": [
      {
        "name": "Blueprint",
        "primeSellingPrice": 100,
        "tradable": true,
        "ducats": 100,
        "drops": [
          { "chance": 0.02, "location": "Axi R1 Relic", "rarity": "Rare", "type": "Rhino Prime Blueprint" },
          { "chance": 0.10, "location": "Axi R1 Relic (Radiant)", "rarity": "Uncommon", "type": "Rhino Prime Blueprint" }
        ]
      }
    ],
    "introduced": { "name": "Update 12.4", "date": "2014-03-05" }
  }
]
```

---

### `GET /warframes/{query}`

Same structure as `/items/` but filtered to warframes. Prefer this over `/items/` for warframe lookups.

---

### `GET /weapons/{query}`

```json
[
  {
    "name": "Soma Prime",
    "type": "Primary",
    "category": "Primary",
    "isPrime": true,
    "vaulted": true,
    "attacks": [
      {
        "name": "Fully Spooled",
        "speed": 15,
        "crit_chance": 30,
        "crit_mult": 3,
        "status_chance": 10,
        "shot_type": "Hit-Scan",
        "damage": { "impact": 1.2, "slash": 6, "puncture": 4.8 }
      },
      {
        "name": "Incarnon Form",
        "speed": 7,
        "crit_chance": 10,
        "crit_mult": 3.4,
        "status_chance": 3,
        "damage": { "impact": 1.08, "slash": 11.88, "puncture": 5.04 }
      }
    ],
    "magazineSize": 200,
    "masteryReq": 7,
    "noise": "ALARMING",
    "trigger": "AUTO",
    "polarities": ["madurai", "madurai", "naramon"],
    "accuracy": 28.57,
    "buildPrice": 15000,
    "buildTime": 43200,
    "components": [{ "name": "Barrel", "primeSellingPrice": 15, "tradable": true, "ducats": 15 }]
  }
]
```

- `attacks[]`: one entry per fire mode. Incarnon weapons have 2+ entries.
- `damage` keys: `impact`, `puncture`, `slash`, `heat`, `cold`, `electricity`, `toxin`, `blast`, `radiation`, `magnetic`, `gas`, `viral`, `corrosive`, `void`.
- `crit_chance`/`status_chance`: percentages (30 = 30%).

---

### `GET /mods/{query}`

```json
[
  {
    "name": "Serration",
    "type": "Rifle Mod",
    "category": "Mods",
    "compatName": "Rifle",
    "polarity": "madurai",
    "rarity": "Rare",
    "baseDrain": 4,
    "fusionLimit": 10,
    "tradable": true,
    "transmutable": true,
    "levelStats": [
      { "stats": ["+15% Damage"] },
      { "stats": ["+30% Damage"] },
      { "stats": ["+165% Damage"] }
    ],
    "drops": [
      { "chance": 0.0017, "location": "Electric Crawler", "rarity": "Rare", "type": "Serration" },
      { "chance": 0.0556, "location": "Saturn/Aegaeon (Spy), Rotation B", "rarity": "Rare", "type": "Serration" }
    ]
  }
]
```

- `levelStats[0]` = rank 0, `levelStats[fusionLimit]` = max rank.
- `drops[].chance` is **decimal** (same scale as `/items/`). `0.0556` = 5.56%.

---

### `GET /drops/search/{query}`

**`chance` is PERCENTAGE.** `25.33` = 25.33%, `2` = 2%. NOT a decimal. Different scale from `/items/` and `/mods/`.

```json
[
  { "place": "Axi A7 Relic", "item": "Ash Prime Systems Blueprint", "rarity": "Rare", "chance": 2 },
  { "place": "Axi A7 Relic (Exceptional)", "item": "Ash Prime Systems Blueprint", "rarity": "Rare", "chance": 4 },
  { "place": "Axi A7 Relic (Flawless)", "item": "Ash Prime Systems Blueprint", "rarity": "Rare", "chance": 6 },
  { "place": "Axi A7 Relic (Radiant)", "item": "Ash Prime Systems Blueprint", "rarity": "Uncommon", "chance": 10 },
  { "place": "Axi B1 Relic", "item": "Ash Prime Chassis Blueprint", "rarity": "Uncommon", "chance": 25.33 },
  { "place": "Lith S3 Relic", "item": "Ash Prime Neuroptics Blueprint", "rarity": "Common", "chance": 25.33 }
]
```

`place` format patterns:
- Relic: `"Axi A7 Relic"` or `"Axi A7 Relic (Radiant)"`
- Mission: `"Ceres/Draco (Survival), Rotation B"`
- Enemy: `"Electric Crawler"` (no parentheses, no slash)

---

### `GET /solNodes/search/{query}`

```json
[
  {
    "keys": [],
    "nodes": [
      { "value": "Hydron (Sedna)", "enemy": "Grineer", "type": "Defense" }
    ]
  }
]
```

---

### `GET /{platform}/rivens/search/{query}`

```json
{
  "Soma": {
    "rerolled": { "avg": 206.42, "stddev": 180.1, "min": 3, "max": 3000, "median": 100, "pop": 10, "itemType": "Rifle Riven Mod", "compatibility": "Soma", "rerolled": true },
    "unrolled": { "avg": 73.91, "min": 10, "max": 2000, "median": 30, "pop": 11, "rerolled": false }
  }
}
```

- `pop` = sample size. Low `pop` = unreliable pricing.

---

### `GET /profile/{username}/stats`

See `docs/07-PLAYER-DATA.md` for full schema.

---

## warframe.market v2

**Base URL:** `https://api.warframe.market/v2`

**NEVER use `/v1/`** — returns 403.

**Rate limit:** 3 req/sec. The Worker uses one sliding-window limiter per isolate. `429`, `509`, temporary `5xx`, and network failures are retried up to two times. `Retry-After` takes precedence over bounded exponential backoff with jitter.

**Worker headers:**

```text
Accept: application/json
User-Agent: warframe-mcp/1.0.0 (Cloudflare Workers; read-only)
Language: ru
Platform: pc
Crossplay: true
```

The final three values can be overridden by MCP tool arguments. Defaults are shown above.

---

### `GET /v2/items`

All tradeable items. ~2MB. **Worker cache: 6h.** With `Language: ru`, `i18n` contains Russian data in addition to English. The Worker searches normalized `i18n.ru.name`, `i18n.en.name`, and `slug`.

```json
{
  "id": "56783f24cbfa8f0432dd898f",
  "slug": "ash_prime_set",
  "tags": ["set", "prime", "warframe"],
  "ducats": 170,
  "maxRank": null,
  "i18n": {
    "en": {
      "name": "Ash Prime Set",
      "icon": "items/images/en/ash_prime_set.png",
      "thumb": "items/images/en/thumbs/ash_prime_set.128x128.png"
    }
  }
}
```

- `slug` = URL-safe ID for order queries.
- `maxRank` present on mods/arcanes.
- Build map: `i18n.en.name.toLowerCase()` → `slug`.

---

### `GET /v2/orders/item/{slug}/top`

Returns up to five current sell orders and five current buy orders from online users:

```json
{
  "apiVersion": "0.25.0",
  "data": {
    "sell": [],
    "buy": []
  },
  "error": null
}
```

The Worker sorts `sell` by `platinum` ascending and `buy` by `platinum` descending before returning the MCP result. Top orders are cached in the isolate for 20 seconds.

---

### `GET /v2/orders/item/{slug}`

```json
{
  "apiVersion": "0.22.7",
  "data": [
    {
      "id": "5cc3249eaf75ea11830de387",
      "type": "sell",
      "platinum": 45,
      "quantity": 6,
      "rank": 0,
      "updatedAt": "2026-01-21T18:23:24Z",
      "user": {
        "ingameName": "NicolaiBM",
        "reputation": 18,
        "platform": "pc",
        "crossplay": true,
        "status": "offline",
        "lastSeen": "2026-03-06T18:10:02Z"
      }
    }
  ]
}
```

- `type`: `"sell"` | `"buy"`
- `rank`: mod/arcane rank. `0` = unranked. Only present on rankable items.
- `user.status`: `"ingame"` | `"online"` | `"offline"`. **Filter out `"offline"` for live pricing.**
- `user.crossplay`: trades cross-platform if true.

Price logic:
1. Filter `type === "sell"`, `user.status !== "offline"` → sort ascending → min/max/median/average.
2. Filter `type === "buy"`, `user.status !== "offline"` → sort descending → min/max/median/average.
3. Cheapest sellers = first 5 of sorted sell array.
