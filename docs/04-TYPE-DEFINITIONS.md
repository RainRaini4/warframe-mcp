# Type Definitions

Copy these verbatim into `src/types/`. Do not modify field names — they match API JSON keys exactly.

The production Worker keeps its smaller public market types in `worker/warframe-market.ts` and its OpenAI compatibility types in `worker/openai-compat.ts`. Its MCP shapes are:

```typescript
interface MarketFilters {
  language: MarketLanguage;
  platform: MarketPlatform;
  crossplay: boolean;
}

interface MarketSearchItem {
  id: string;
  slug: string;
  name_ru: string;
  name_en: string;
  url: string;
}

interface SearchItemsResult {
  query: string;
  items: MarketSearchItem[];
  filters: MarketFilters;
  retrieved_at: string;
}

interface TopOrdersResult {
  item: { slug: string; url: string };
  sell: MarketTopOrder[];
  buy: MarketTopOrder[];
  filters: MarketFilters;
  retrieved_at: string;
}

type WarframeMarketErrorCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "timeout"
  | "rate_limited"
  | "unavailable";

interface OpenAiSearchOutput {
  results: Array<{
    id: string;       // wfm:item:<slug>
    title: string;
    text: string;
    url: string;
  }>;
}

interface OpenAiFetchDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    source: "warframe.market";
    slug: string;
    name_ru: string;
    name_en: string;
    language: MarketLanguage;
    platform: MarketPlatform;
    crossplay: boolean;
    retrieved_at: string;
    warning: string;
    top_sell_orders: MarketTopOrder[];
    top_buy_orders: MarketTopOrder[];
  };
}
```

The API response types below are retained for the legacy Node client.

---

## `src/types/warframestat.ts`

```typescript
// ─── Shared primitives ────────────────────────────────────────────────────────

export interface TimedEvent {
  id: string;
  activation: string;   // ISO 8601
  expiry: string;       // ISO 8601
}

export interface CountedItem {
  count: number;
  type: string;
  key: string;
}

export interface Reward {
  items: string[];
  countedItems: CountedItem[];
  credits: number;
}

// ─── Void Trader (Baro Ki'Teer) ───────────────────────────────────────────────

export interface VoidTraderInventoryItem {
  uniqueName: string;
  item: string;
  ducats: number;
  credits: number;
}

export interface VoidTrader extends TimedEvent {
  character: string;            // "Baro Ki'Teer"
  location: string;             // "Kronia Relay (Saturn)"
  inventory: VoidTraderInventoryItem[];
}

// ─── Vault Trader (Varzia / Prime Resurgence) ─────────────────────────────────

export interface VaultTraderInventoryItem {
  uniqueName: string;
  item: string;
  ducats: number | null;        // Aya cost (NOT ducats). null for credit-only relics.
  credits: number | null;
}

export interface VaultTrader extends TimedEvent {
  character: string;            // "Varzia"
  location: string;             // "Maroo's Bazaar (Mars)"
  inventory: VaultTraderInventoryItem[];
}

// ─── Void Fissures ────────────────────────────────────────────────────────────

export type FissureTier = "Lith" | "Meso" | "Neo" | "Axi" | "Requiem" | "Omnia";

export interface Fissure extends TimedEvent {
  node: string;                 // "Adaro (Sedna)"
  missionType: string;          // "Extermination"
  missionTypeKey: string;
  enemy: string;                // "Grineer"
  enemyKey: string;
  nodeKey: string;
  tier: FissureTier;
  tierNum: number;              // 1–6
  isStorm: boolean;             // Void Storm (Railjack)
  isHard: boolean;              // Steel Path
}

// ─── Sortie ───────────────────────────────────────────────────────────────────

export interface SortieVariant {
  missionType: string;
  missionTypeKey: string;
  modifier: string;
  modifierDescription: string;
  node: string;
  nodeKey: string;
}

export interface Sortie extends TimedEvent {
  rewardPool: string;
  variants: SortieVariant[];
  boss: string;
  faction: string;
  factionKey: string;
}

// ─── Archon Hunt ──────────────────────────────────────────────────────────────

export interface ArchonMission {
  node: string;
  nodeKey: string;
  type: string;
  typeKey: string;
}

export interface ArchonHunt extends TimedEvent {
  rewardPool: string;
  variants: unknown[];          // Always empty array
  missions: ArchonMission[];
  boss: string;
  faction: string;
  factionKey: string;
}

// ─── Nightwave ────────────────────────────────────────────────────────────────

export interface NightwaveChallenge extends TimedEvent {
  isDaily: boolean;
  isElite: boolean;
  desc: string;
  title: string;
  reputation: number;
  isPermanent: boolean;
}

export interface Nightwave extends TimedEvent {
  season: number;
  tag: string;
  phase: number;
  activeChallenges: NightwaveChallenge[];
}

// ─── Invasions ────────────────────────────────────────────────────────────────

export interface InvasionFaction {
  reward: Reward;
  faction: string;
  factionKey: string;
}

export interface Invasion extends TimedEvent {
  node: string;
  nodeKey: string;
  desc: string;
  attacker: InvasionFaction;
  defender: InvasionFaction;
  vsInfestation: boolean;
  count: number;
  requiredRuns: number;
  completion: number;           // Percentage 0–100
  completed: boolean;
  rewardTypes: string[];        // e.g. ["vandal", "wraith"]
}

// ─── Steel Path ───────────────────────────────────────────────────────────────

export interface SteelPathReward {
  name: string;
  cost: number;
}

export interface SteelPathIncursions extends TimedEvent {
  // Has id, activation, expiry only
}

export interface SteelPath {
  currentReward: SteelPathReward;
  activation: string;
  expiry: string;
  remaining: string;
  rotation: SteelPathReward[];
  evergreens: SteelPathReward[];
  incursions: SteelPathIncursions;
}

// ─── Open World Cycles ────────────────────────────────────────────────────────

export interface CetusCycle extends TimedEvent {
  isDay: boolean;
  state: "day" | "night";
  timeLeft: string;
  isCetus: boolean;
}

export interface VallisCycle extends TimedEvent {
  isWarm: boolean;
  state: "warm" | "cold";
}

export interface CambionCycle extends TimedEvent {
  timeLeft: string;
  state: "fass" | "vome";
}

export interface EarthCycle extends TimedEvent {
  isDay: boolean;
  state: "day" | "night";
  timeLeft: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface EventInterimStep {
  goal: number;
  reward: Reward;
}

export interface GameEvent extends TimedEvent {
  description: string;
  tooltip: string;
  node: string;
  health: number;
  rewards: Reward[];
  interimSteps: EventInterimStep[];
  isPersonal: boolean;
  isCommunity: boolean;
}

// ─── Construction Progress ────────────────────────────────────────────────────

export interface ConstructionProgress {
  id: string;
  fomorianProgress: string;    // "45.08"
  razorbackProgress: string;   // "46.22"
  unknownProgress: string;     // "0.00"
}

// ─── Daily Deals ─────────────────────────────────────────────────────────────

export interface DailyDeal extends TimedEvent {
  item: string;
  uniqueName: string;
  originalPrice: number;
  salePrice: number;
  total: number;
  sold: number;
  discount: number;
}

// ─── Simaris ──────────────────────────────────────────────────────────────────

export interface Simaris {
  target: string;
  isTargetActive: boolean;
}

// ─── Rivens ───────────────────────────────────────────────────────────────────

export interface RivenStats {
  itemType: string;
  compatibility: string;
  rerolled: boolean;
  avg: number;
  stddev: number;
  min: number;
  max: number;
  pop: number;
  median: number;
}

export interface RivenEntry {
  rerolled: RivenStats;
  unrolled: RivenStats;
}

export type RivenSearchResult = Record<string, RivenEntry>;

// ─── Drop Tables ──────────────────────────────────────────────────────────────

export interface DropResult {
  place: string;               // "Axi A7 Relic (Radiant)" or "Draco (Ceres) — Survival"
  item: string;                // "Ash Prime Systems Blueprint"
  rarity: "Common" | "Uncommon" | "Rare" | "Legendary";
  chance: number;              // PERCENTAGE (e.g. 25.33 = 25.33%). NOT a decimal.
}

// ─── Sol Nodes ────────────────────────────────────────────────────────────────

export interface SolNode {
  value: string;               // "Hydron (Sedna)"
  enemy: string;               // "Grineer"
  type: string;                // "Defense"
}

export interface SolNodeResult {
  keys: string[];
  nodes: SolNode[];
}

// ─── Item Database (warframes, weapons, mods, items) ─────────────────────────

export interface ItemIntroduced {
  name: string;                // "Update 12.4"
  url?: string;
  date: string;                // "2014-03-05"
}

export interface ItemDrop {
  chance: number;              // DECIMAL (0.02 = 2%). Different scale from DropResult.chance.
  location: string;            // "Axi R1 Relic" or "Kuva Scorpion"
  rarity: string;
  type: string;
}

export interface ItemComponent {
  uniqueName?: string;
  name: string;
  description?: string;
  itemCount?: number;
  primeSellingPrice?: number;  // Ducat value
  tradable?: boolean;
  ducats?: number;
  drops?: ItemDrop[];
}

export interface WarframeAbility {
  uniqueName?: string;
  name: string;
  description: string;
  imageName?: string;
}

export interface WarframeItem {
  uniqueName: string;
  name: string;
  description?: string;
  type: string;                // "Warframe"
  category: string;            // "Warframes"
  abilities?: WarframeAbility[];
  health?: number;
  shield?: number;
  armor?: number;
  energy?: number;
  power?: number;
  sprint?: number;
  stamina?: number;
  aura?: string;               // Polarity name: "madurai"
  polarities?: string[];
  passiveDescription?: string;
  components?: ItemComponent[];
  buildPrice?: number;
  buildQuantity?: number;
  buildTime?: number;          // Seconds
  masteryReq?: number;
  isPrime?: boolean;
  vaulted?: boolean;
  tradable?: boolean;
  introduced?: ItemIntroduced;
  wikiaThumbnail?: string;
  imageName?: string;
}

export interface WeaponAttack {
  name: string;                // "Fully Spooled" or "Incarnon Form"
  speed?: number;              // Fire rate
  crit_chance?: number;        // Percentage (30 = 30%)
  crit_mult?: number;          // Multiplier (3 = 3.0x)
  status_chance?: number;
  shot_type?: string;          // "Hit-Scan" or "Projectile"
  damage?: Record<string, number>;  // { impact: 1.2, slash: 6, ... }
}

export interface WeaponItem {
  uniqueName: string;
  name: string;
  description?: string;
  type: string;                // "Primary", "Secondary", "Melee"
  category: string;
  attacks?: WeaponAttack[];
  accuracy?: number;
  magazineSize?: number;
  masteryReq?: number;
  noise?: string;              // "ALARMING" or "SILENT"
  trigger?: string;            // "AUTO", "SEMI", "BURST", etc.
  polarities?: string[];
  components?: ItemComponent[];
  buildPrice?: number;
  buildTime?: number;
  slot?: number;
  isPrime?: boolean;
  vaulted?: boolean;
  tradable?: boolean;
  releaseDate?: string;
  introduced?: ItemIntroduced;
  wikiaThumbnail?: string;
  imageName?: string;
}

export interface ModLevelStat {
  stats: string[];             // ["+15% Damage"]
}

export interface ModItem {
  uniqueName: string;
  name: string;
  type: string;                // "Rifle Mod", "Pistol Mod", "Warframe Mod", etc.
  category: string;            // "Mods"
  compatName: string;          // "Rifle", "Pistol", "Warframe", etc.
  polarity: string;            // "madurai", "vazarin", etc.
  rarity: string;
  baseDrain: number;
  fusionLimit: number;         // Max rank
  levelStats?: ModLevelStat[];
  drops?: ItemDrop[];
  tradable?: boolean;
  transmutable?: boolean;
  isPrime?: boolean;
  introduced?: ItemIntroduced;
  imageName?: string;
}

export interface GenericItem {
  uniqueName: string;
  name: string;
  description?: string;
  type?: string;
  category?: string;
  drops?: ItemDrop[];
  components?: ItemComponent[];
  levelStats?: ModLevelStat[];   // For arcanes
  tradable?: boolean;
  masterable?: boolean;
  vaulted?: boolean;
  rarity?: string;
  fusionLimit?: number;          // For arcanes: max rank
  introduced?: ItemIntroduced;
  wikiaThumbnail?: string;
  imageName?: string;
}
```

---

## `src/types/warframe-market.ts`

```typescript
export interface MarketItemI18n {
  name: string;
  icon: string;
  thumb: string;
  description?: string;
  wikiLink?: string;
}

export interface MarketItem {
  id: string;
  slug: string;                // URL-safe identifier used in order queries
  gameRef?: string;            // "/Lotus/Powersuits/Ninja/AshPrime"
  tags: string[];              // ["set", "prime", "warframe"]
  ducats?: number;
  maxRank?: number;            // For mods/arcanes
  setRoot?: boolean;
  setParts?: string[];
  tradingTax?: number;
  tradable?: boolean;
  reqMasteryRank?: number;
  i18n: {
    en: MarketItemI18n;
    [lang: string]: MarketItemI18n;
  };
}

export type MarketItemsResponse = MarketItem[];

export interface MarketItemDetailResponse {
  apiVersion: string;
  data: MarketItem;
}

export type OrderType = "sell" | "buy";
export type UserStatus = "ingame" | "online" | "offline";
export type MarketPlatform = "pc" | "ps4" | "xbox" | "switch";

export interface MarketOrderUser {
  id?: string;
  ingameName: string;
  slug?: string;
  avatar?: string;
  reputation: number;
  platform: MarketPlatform;
  crossplay: boolean;
  locale?: string;
  status: UserStatus;
  lastSeen?: string;
}

export interface MarketOrder {
  id: string;
  type: OrderType;
  platinum: number;
  quantity: number;
  perTrade?: number;
  visible?: boolean;
  rank?: number;               // Mod/arcane rank. 0 = unranked. Only on rankable items.
  createdAt?: string;
  updatedAt?: string;
  itemId?: string;
  user: MarketOrderUser;
}

export interface MarketOrdersResponse {
  apiVersion: string;
  data: MarketOrder[];
}

// Computed locally — not from API
export interface PriceSummary {
  min: number;
  max: number;
  median: number;
  average: number;
  count: number;
}

export interface MarketPriceResult {
  itemName: string;
  slug: string;
  sell: PriceSummary;
  buy: PriceSummary;
  cheapestSellers: Array<{
    ingameName: string;
    platinum: number;
    quantity: number;
    status: UserStatus;
    rank?: number;
  }>;
}
```

---

## `src/types/profile.ts`

```typescript
export interface XPItem {
  uniqueName: string;
  xp: number;                  // 450000 = rank 30, 900000 = rank 40
}

export interface SyndicateStanding {
  tag: string;                 // e.g. "CephalonSudaSyndicate"
  title: number;               // 0–5
  standing?: number;
  freelancer?: boolean;
}

export interface Intrinsics {
  Piloting?: number;
  Gunnery?: number;
  Engineering?: number;
  Tactical?: number;
  Command?: number;
  Combat?: number;
  Riding?: number;
  Opportunity?: number;
  Endurance?: number;
}

export interface LoadoutItem {
  uniqueName: string;
  xp?: number;
  polarized?: number;          // Forma count
  fingerprint?: string;        // Encoded riven data
}

export interface LoadoutPreset {
  ItemIndex?: number;
  suit?: string;               // uniqueName of active Warframe
  longGun?: string;
  pistol?: string;
  melee?: string;
  companion?: string;
  focus?: string;              // e.g. "AP_POWER" = Madurai
  name?: string;
}

export interface PlayerLoadout {
  suits?: LoadoutItem[];
  longGuns?: LoadoutItem[];
  pistols?: LoadoutItem[];
  melees?: LoadoutItem[];
}

export interface WeaponStat {
  type: string;                // Weapon uniqueName
  xp?: number;
  kills?: number;
  headshots?: number;
  equiptime?: number;          // Seconds equipped
  credits?: number;
}

export interface EnemyStat {
  type: string;                // Enemy uniqueName
  kills?: number;
  assists?: number;
}

export interface AbilityUsageStat {
  uniqueName: string;
  used: number;
}

export interface PlayerStats {
  secondsPlayed?: number;
  missionsCompleted?: number;
  missionsQuit?: number;
  missionsFailed?: number;
  totalKills?: number;
  totalDeaths?: number;
  totalRevived?: number;
  crewmateRevived?: number;
  creditsTotal?: number;
  weaponList?: WeaponStat[];
  enemyList?: EnemyStat[];
  abilityUseList?: AbilityUsageStat[];
}

export interface PlayerProfile {
  displayName?: string;
  playerLevel?: number;        // Mastery rank
  accountCreated?: string;     // ISO 8601
  guildName?: string;
  guildTier?: string;          // "Ghost" | "Shadow" | "Storm" | "Mountain" | "Moon"
  deathMarks?: string[];       // uniqueNames of assassin enemies marking this player
  activePreset?: LoadoutPreset;
  loadout?: PlayerLoadout;
  xpInfo?: XPItem[];
  syndicates?: SyndicateStanding[];
  stats?: PlayerStats;
  intrinsics?: Intrinsics;
}

export const FOCUS_SCHOOL_NAMES: Record<string, string> = {
  AP_POWER:    "Madurai",
  AP_TACTIC:   "Naramon",
  AP_DEFENSE:  "Vazarin",
  AP_UMBRA:    "Umbra",
  AP_WARD:     "Unairu",
  AP_PRECEPT:  "Zenurik",
};

export const SYNDICATE_NAMES: Record<string, string> = {
  SteelMeridianSyndicate:      "Steel Meridian",
  ArbitersOfHexisSyndicate:    "Arbiters of Hexis",
  CephalonSudaSyndicate:       "Cephalon Suda",
  NewLokaSyndicate:            "New Loka",
  PerrinSequenceSyndicate:     "Perrin Sequence",
  RedVeilSyndicate:            "Red Veil",
  OstronSyndicate:             "Ostron",
  SolarisUnitedSyndicate:      "Solaris United",
  EntratiSyndicate:            "Entrati",
  NecraloidSyndicate:          "Necraloid",
  ZarimanSyndicate:            "The Holdfasts",
  CaviaSyndicate:              "Cavia",
  NightWaveSyndicate:          "Nightwave",
};

/** Standard items: max rank 30 at 450,000 XP. Primed/special: max rank 40 at 900,000 XP. */
export function xpToRank(xp: number): { rank: number; maxRank: number } {
  const XP_PER_RANK = 15000;
  if (xp >= 900000) {
    return { rank: Math.min(40, Math.floor(xp / XP_PER_RANK)), maxRank: 40 };
  }
  return { rank: Math.min(30, Math.floor(xp / XP_PER_RANK)), maxRank: 30 };
}
```

---

## `src/types/index.ts`

```typescript
export * from "./warframestat.js";
export * from "./warframe-market.js";
export * from "./profile.js";
```

---

## Cache types (`src/utils/cache.ts` — inline, no separate types file)

```typescript
export interface CacheEntry<T> {
  data: T;
  expiry: number;              // Unix timestamp ms
}

/** TTL constants in milliseconds */
export const TTL = {
  WORLDSTATE:   60_000,
  DROPS:        5 * 60_000,
  MARKET_ITEMS: 24 * 60 * 60_000,
  STATIC:       24 * 60 * 60_000,
  PROFILE:      5 * 60_000,
} as const;
```

---

## Critical scale difference — DO NOT CONFUSE

| Source | Field | Scale | Example |
|--------|-------|-------|---------|
| `/drops/search/` | `DropResult.chance` | **Percentage** | `25.33` = 25.33% |
| `/items/{query}` components | `ItemDrop.chance` | **Decimal** | `0.02` = 2% |

When displaying `ItemDrop.chance`, multiply by 100: `(drop.chance * 100).toFixed(2) + "%"`.
When displaying `DropResult.chance`, use directly: `drop.chance.toFixed(2) + "%"`.

---

## Optional field policy

Always use optional chaining + nullish coalescing. Never assume a field is present:

```typescript
const rank = warframe.masteryReq ?? 0;
const vaulted = warframe.vaulted ?? false;
const timeLeft = cycle.timeLeft ?? "unknown";
const xpItems = profile.xpInfo ?? [];
```
