export interface MarketVariantKey {
  rank?: number;
  subtype?: string;
  charges?: number;
  amberStars?: number;
  cyanStars?: number;
}

export interface MarketItemVariantCapabilities {
  maxRank?: number;
  subtypes?: string[];
  maxCharges?: number;
  maxAmberStars?: number;
  maxCyanStars?: number;
}

export interface MarketStatisticPoint {
  datetime: string;
  volume: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  averagePrice: number | null;
  weightedAveragePrice: number | null;
  medianPrice: number | null;
  openPrice: number | null;
  closePrice: number | null;
  variant: MarketVariantKey;
}

export interface MarketStatisticsSummary {
  reportedClosedVolume: number;
  bucketCount: number;
  bucketsWithVolume: number;
  averageVolumePerBucket: number | null;
  latestMedianPrice: number | null;
  weightedMedianPrice: number | null;
  weightedAveragePrice: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface MarketStatisticsVariantResult {
  variant: MarketVariantKey;
  closed: {
    hours48: MarketStatisticPoint[];
    days90: MarketStatisticPoint[];
  };
  summaries: {
    hours48: MarketStatisticsSummary | null;
    days90: MarketStatisticsSummary | null;
  };
}

export type MarketHistoryStatus =
  | "available"
  | "empty"
  | "unsupported_variant_dimensions";

export interface NormalizedStatistics {
  status: MarketHistoryStatus;
  variants: MarketStatisticsVariantResult[];
  warnings: string[];
}

const VARIANT_FIELDS = [
  "rank",
  "subtype",
  "charges",
  "amberStars",
  "cyanStars",
] as const satisfies readonly (keyof MarketVariantKey)[];

const LEGACY_VARIANT_FIELDS = {
  rank: "mod_rank",
  subtype: "subtype",
  charges: "charges",
  amberStars: "amber_stars",
  cyanStars: "cyan_stars",
} as const satisfies Record<keyof MarketVariantKey, string>;

const KNOWN_LEGACY_STATISTIC_FIELDS = new Set([
  "avg_price",
  "closed_price",
  "datetime",
  "donch_bot",
  "donch_top",
  "id",
  "max_price",
  "median",
  "min_price",
  "mod_rank",
  "moving_avg",
  "open_price",
  "volume",
  "wa_price",
  "subtype",
  "charges",
  "amber_stars",
  "cyan_stars",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : null;
}

function variantInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeVariantFromLegacy(value: Record<string, unknown>): MarketVariantKey {
  const variant: MarketVariantKey = {};
  const rank = variantInteger(value.mod_rank);
  const charges = variantInteger(value.charges);
  const amberStars = variantInteger(value.amber_stars);
  const cyanStars = variantInteger(value.cyan_stars);

  if (rank !== undefined) variant.rank = rank;
  if (typeof value.subtype === "string" && value.subtype.trim()) {
    variant.subtype = value.subtype.trim();
  }
  if (charges !== undefined) variant.charges = charges;
  if (amberStars !== undefined) variant.amberStars = amberStars;
  if (cyanStars !== undefined) variant.cyanStars = cyanStars;

  return variant;
}

export function normalizeMarketVariant(variant: MarketVariantKey): MarketVariantKey {
  const normalized: MarketVariantKey = {};
  for (const field of VARIANT_FIELDS) {
    const value = variant[field];
    if (value !== undefined) {
      Object.assign(normalized, { [field]: value });
    }
  }
  return normalized;
}

export function marketVariantKey(variant: MarketVariantKey): string {
  return JSON.stringify(VARIANT_FIELDS.map((field) => variant[field] ?? null));
}

export function matchesMarketVariant(
  variant: MarketVariantKey,
  filter?: MarketVariantKey,
): boolean {
  if (!filter) return true;
  return VARIANT_FIELDS.every(
    (field) => filter[field] === undefined || variant[field] === filter[field],
  );
}

function declaredVariantDimensions(
  capabilities: MarketItemVariantCapabilities,
): (keyof MarketVariantKey)[] {
  const dimensions: (keyof MarketVariantKey)[] = [];
  if (capabilities.maxRank !== undefined) dimensions.push("rank");
  if (capabilities.subtypes && capabilities.subtypes.length > 0) dimensions.push("subtype");
  if (capabilities.maxCharges !== undefined) dimensions.push("charges");
  if (capabilities.maxAmberStars !== undefined) dimensions.push("amberStars");
  if (capabilities.maxCyanStars !== undefined) dimensions.push("cyanStars");
  return dimensions;
}

interface PointNormalizationResult {
  point?: MarketStatisticPoint;
  unknownFields: string[];
}

function normalizeStatisticPoint(value: unknown): PointNormalizationResult {
  if (!isRecord(value)) return { unknownFields: [] };

  const unknownFields = Object.keys(value).filter(
    (field) => !KNOWN_LEGACY_STATISTIC_FIELDS.has(field),
  );
  if (unknownFields.length > 0) return { unknownFields };

  if (typeof value.datetime !== "string" || !Number.isFinite(Date.parse(value.datetime))) {
    return { unknownFields };
  }

  return {
    unknownFields,
    point: {
      datetime: value.datetime,
      volume: finiteNumber(value.volume),
      minPrice: finiteNumber(value.min_price),
      maxPrice: finiteNumber(value.max_price),
      averagePrice: finiteNumber(value.avg_price),
      weightedAveragePrice: finiteNumber(value.wa_price),
      medianPrice: finiteNumber(value.median),
      openPrice: finiteNumber(value.open_price),
      closePrice: finiteNumber(value.closed_price),
      variant: normalizeVariantFromLegacy(value),
    },
  };
}

export function summarizeMarketStatistics(
  points: MarketStatisticPoint[],
): MarketStatisticsSummary | null {
  const sorted = [...points].sort(
    (left, right) => Date.parse(left.datetime) - Date.parse(right.datetime),
  );
  const withVolume = sorted.filter(
    (point): point is MarketStatisticPoint & { volume: number } => point.volume !== null,
  );
  if (sorted.length === 0 || withVolume.length === 0) return null;

  const reportedClosedVolume = withVolume.reduce((total, point) => total + point.volume, 0);
  const weightedAveragePoints = withVolume.filter(
    (point) => point.volume > 0 && point.weightedAveragePrice !== null,
  );
  const weightedAverageVolume = weightedAveragePoints.reduce(
    (total, point) => total + point.volume,
    0,
  );
  const weightedAveragePrice =
    weightedAverageVolume > 0
      ? weightedAveragePoints.reduce(
          (total, point) => total + (point.weightedAveragePrice ?? 0) * point.volume,
          0,
        ) / weightedAverageVolume
      : null;

  const medianPoints = withVolume
    .filter((point) => point.volume > 0 && point.medianPrice !== null)
    .sort((left, right) => (left.medianPrice ?? 0) - (right.medianPrice ?? 0));
  const medianVolume = medianPoints.reduce((total, point) => total + point.volume, 0);
  let weightedMedianPrice: number | null = null;
  if (medianVolume > 0) {
    let accumulatedVolume = 0;
    for (const point of medianPoints) {
      accumulatedVolume += point.volume;
      if (accumulatedVolume >= medianVolume / 2) {
        weightedMedianPrice = point.medianPrice;
        break;
      }
    }
  }

  const latestMedianPrice =
    [...sorted].reverse().find((point) => point.medianPrice !== null)?.medianPrice ?? null;

  return {
    reportedClosedVolume,
    bucketCount: sorted.length,
    bucketsWithVolume: withVolume.filter((point) => point.volume > 0).length,
    averageVolumePerBucket: reportedClosedVolume / withVolume.length,
    latestMedianPrice,
    weightedMedianPrice,
    weightedAveragePrice,
    firstTimestamp: sorted[0]?.datetime ?? null,
    lastTimestamp: sorted.at(-1)?.datetime ?? null,
  };
}

interface VariantAccumulator {
  variant: MarketVariantKey;
  hours48: MarketStatisticPoint[];
  days90: MarketStatisticPoint[];
}

export function normalizeLegacyStatistics(
  hours48Values: unknown[],
  days90Values: unknown[],
  capabilities: MarketItemVariantCapabilities,
  variantFilter?: MarketVariantKey,
): NormalizedStatistics {
  const warnings = new Set<string>();
  const declaredDimensions = declaredVariantDimensions(capabilities);
  const allRawValues = [...hours48Values, ...days90Values].filter(isRecord);

  if (allRawValues.length === 0) {
    return {
      status: "empty",
      variants: [],
      warnings: ["Legacy statistics returned no closed-order buckets."],
    };
  }

  const unsupportedDimensions = declaredDimensions.filter((dimension) => {
    const legacyField = LEGACY_VARIANT_FIELDS[dimension];
    return !allRawValues.some((value) => legacyField in value);
  });
  if (unsupportedDimensions.length > 0) {
    return {
      status: "unsupported_variant_dimensions",
      variants: [],
      warnings: [
        `Legacy statistics do not expose required variant dimensions: ${unsupportedDimensions.join(", ")}. History was not aggregated.`,
      ],
    };
  }

  const accumulators = new Map<string, VariantAccumulator>();
  const addPoints = (values: unknown[], range: "hours48" | "days90") => {
    for (const value of values) {
      const normalized = normalizeStatisticPoint(value);
      if (normalized.unknownFields.length > 0) {
        warnings.add(
          `Statistics points with unrecognized fields were ignored: ${normalized.unknownFields.sort().join(", ")}.`,
        );
        continue;
      }
      if (!normalized.point) {
        warnings.add("Malformed statistics points were ignored.");
        continue;
      }
      if (
        declaredDimensions.some(
          (dimension) => normalized.point?.variant[dimension] === undefined,
        )
      ) {
        warnings.add(
          "Statistics points missing required variant dimensions were ignored.",
        );
        continue;
      }
      if (!matchesMarketVariant(normalized.point.variant, variantFilter)) continue;

      const key = marketVariantKey(normalized.point.variant);
      const accumulator = accumulators.get(key) ?? {
        variant: normalizeMarketVariant(normalized.point.variant),
        hours48: [],
        days90: [],
      };
      accumulator[range].push(normalized.point);
      accumulators.set(key, accumulator);
    }
  };

  addPoints(hours48Values, "hours48");
  addPoints(days90Values, "days90");

  const variants = [...accumulators.values()]
    .sort((left, right) => marketVariantKey(left.variant).localeCompare(marketVariantKey(right.variant)))
    .map((accumulator) => {
      const hours48 = [...accumulator.hours48].sort(
        (left, right) => Date.parse(left.datetime) - Date.parse(right.datetime),
      );
      const days90 = [...accumulator.days90].sort(
        (left, right) => Date.parse(left.datetime) - Date.parse(right.datetime),
      );
      return {
        variant: accumulator.variant,
        closed: { hours48, days90 },
        summaries: {
          hours48: summarizeMarketStatistics(hours48),
          days90: summarizeMarketStatistics(days90),
        },
      };
    });

  if (!variantFilter && variants.length > 1) {
    warnings.add("Multiple item variants were returned and summarized separately.");
  }
  if (variants.length === 0) {
    warnings.add(
      variantFilter
        ? "Legacy statistics contained no closed-order buckets for the requested variant."
        : "Legacy statistics contained no usable closed-order buckets.",
    );
  }

  return {
    status: variants.length > 0 ? "available" : "empty",
    variants,
    warnings: [...warnings],
  };
}

export interface LiquidityMarketOrder {
  id: string;
  type: "sell" | "buy";
  platinum: number;
  quantity: number;
  visible: boolean;
  rank?: number;
  subtype?: string;
  charges?: number;
  amberStars?: number;
  cyanStars?: number;
  user: {
    status: string;
  };
}

export interface MarketVariantTopOrders {
  sell: LiquidityMarketOrder[];
  buy: LiquidityMarketOrder[];
}

export type LiquidityGrade =
  | "very_high"
  | "high"
  | "medium"
  | "low"
  | "very_low"
  | "unknown";

export type LiquidityConfidence = "high" | "medium" | "low";

export interface LiquidityAssessment {
  score: number | null;
  grade: LiquidityGrade;
  confidence: LiquidityConfidence;
  reasons: string[];
}

export interface LiquidityVariantResult {
  variant: MarketVariantKey;
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
  assessment: LiquidityAssessment;
}

export interface LiquidityAssessmentInput {
  averageDailyClosedVolume90d: number | null;
  hasHistory48h: boolean;
  hasHistory90d: boolean;
  onlineSellOrders: number;
  onlineBuyOrders: number;
  spreadPercent: number | null;
  historyUnavailableReason?: string;
  multipleVariants?: boolean;
}

const LIQUIDITY_VOLUME_MAX_POINTS = 50;
const LIQUIDITY_DEPTH_MAX_POINTS = 25;
const LIQUIDITY_SPREAD_MAX_POINTS = 25;
const LIQUIDITY_VOLUME_SATURATION = 50;
const LIQUIDITY_DEPTH_SATURATION = 20;
const LIQUIDITY_SPREAD_ZERO_POINTS_PERCENT = 50;
const LIQUIDITY_HIGH_VOLUME_PER_DAY = 25;
const LIQUIDITY_LOW_VOLUME_PER_DAY = 2;
const LIQUIDITY_DEEP_TWO_SIDED_ORDERS = 10;
const LIQUIDITY_TIGHT_SPREAD_PERCENT = 10;
const LIQUIDITY_WIDE_SPREAD_PERCENT = 30;
const DAYS_IN_STATISTICS_WINDOW = 90;

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function gradeLiquidityScore(score: number | null): LiquidityGrade {
  if (score === null) return "unknown";
  if (score >= 85) return "very_high";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "very_low";
}

export function calculateLiquidityAssessment(
  input: LiquidityAssessmentInput,
): LiquidityAssessment {
  const reasons: string[] = [];
  const twoSidedDepth = Math.min(input.onlineSellOrders, input.onlineBuyOrders);

  if (input.multipleVariants) reasons.push("multiple_variants");
  if (input.historyUnavailableReason) reasons.push(input.historyUnavailableReason);

  if (
    input.averageDailyClosedVolume90d !== null &&
    input.averageDailyClosedVolume90d >= LIQUIDITY_HIGH_VOLUME_PER_DAY
  ) {
    reasons.push("high_90d_volume");
  } else if (
    input.averageDailyClosedVolume90d !== null &&
    input.averageDailyClosedVolume90d < LIQUIDITY_LOW_VOLUME_PER_DAY
  ) {
    reasons.push("low_90d_volume");
  }

  if (input.onlineSellOrders === 0 || input.onlineBuyOrders === 0) {
    reasons.push("one_sided_market");
  } else if (twoSidedDepth >= LIQUIDITY_DEEP_TWO_SIDED_ORDERS) {
    reasons.push("deep_two_sided_market");
  } else {
    reasons.push("two_sided_market");
  }

  if (input.spreadPercent === null) {
    reasons.push("spread_unavailable");
  } else if (input.spreadPercent <= LIQUIDITY_TIGHT_SPREAD_PERCENT) {
    reasons.push("tight_spread");
  } else if (input.spreadPercent >= LIQUIDITY_WIDE_SPREAD_PERCENT) {
    reasons.push("wide_spread");
  }

  if (
    input.averageDailyClosedVolume90d === null ||
    !input.hasHistory90d ||
    !Number.isFinite(input.averageDailyClosedVolume90d) ||
    input.averageDailyClosedVolume90d < 0
  ) {
    return {
      score: null,
      grade: "unknown",
      confidence: "low",
      reasons,
    };
  }

  const volumeComponent =
    LIQUIDITY_VOLUME_MAX_POINTS *
    Math.min(
      1,
      Math.log1p(input.averageDailyClosedVolume90d) /
        Math.log1p(LIQUIDITY_VOLUME_SATURATION),
    );
  const depthComponent =
    LIQUIDITY_DEPTH_MAX_POINTS *
    Math.min(
      1,
      Math.log1p(twoSidedDepth) / Math.log1p(LIQUIDITY_DEPTH_SATURATION),
    );
  const spreadComponent =
    input.spreadPercent === null
      ? 0
      : LIQUIDITY_SPREAD_MAX_POINTS *
        Math.max(
          0,
          Math.min(1, 1 - input.spreadPercent / LIQUIDITY_SPREAD_ZERO_POINTS_PERCENT),
        );
  const score = roundToOneDecimal(
    Math.max(0, Math.min(100, volumeComponent + depthComponent + spreadComponent)),
  );
  const confidence: LiquidityConfidence =
    input.hasHistory48h &&
    input.hasHistory90d &&
    input.onlineSellOrders > 0 &&
    input.onlineBuyOrders > 0
      ? "high"
      : "medium";

  return {
    score,
    grade: gradeLiquidityScore(score),
    confidence,
    reasons,
  };
}

export function marketVariantFromOrder(order: LiquidityMarketOrder): MarketVariantKey {
  return normalizeMarketVariant({
    rank: order.rank,
    subtype: order.subtype,
    charges: order.charges,
    amberStars: order.amberStars,
    cyanStars: order.cyanStars,
  });
}

export function collectLiquidityVariants(
  orders: LiquidityMarketOrder[],
  statisticsVariants: MarketStatisticsVariantResult[],
  variantFilter?: MarketVariantKey,
): MarketVariantKey[] {
  const variants = new Map<string, MarketVariantKey>();
  for (const order of orders) {
    if (!order.visible) continue;
    const variant = marketVariantFromOrder(order);
    if (!matchesMarketVariant(variant, variantFilter)) continue;
    variants.set(marketVariantKey(variant), variant);
  }
  for (const statistics of statisticsVariants) {
    if (!matchesMarketVariant(statistics.variant, variantFilter)) continue;
    variants.set(marketVariantKey(statistics.variant), statistics.variant);
  }
  if (variants.size === 0) {
    const fallback = variantFilter ? normalizeMarketVariant(variantFilter) : {};
    variants.set(marketVariantKey(fallback), fallback);
  }

  return [...variants.values()].sort((left, right) =>
    marketVariantKey(left).localeCompare(marketVariantKey(right)),
  );
}

interface BuildLiquidityVariantsOptions {
  historyStatus: MarketHistoryStatus | "unavailable";
  historyUnavailableReason?: string;
  topOrdersByVariant?: ReadonlyMap<string, MarketVariantTopOrders>;
}

function bestPrice(
  orders: LiquidityMarketOrder[],
  type: "sell" | "buy",
): number | null {
  const prices = orders
    .filter((order) => order.type === type)
    .map((order) => order.platinum)
    .filter((price) => Number.isFinite(price) && price >= 0);
  if (prices.length === 0) return null;
  return type === "sell" ? Math.min(...prices) : Math.max(...prices);
}

export function buildLiquidityVariants(
  variants: MarketVariantKey[],
  orders: LiquidityMarketOrder[],
  statisticsVariants: MarketStatisticsVariantResult[],
  options: BuildLiquidityVariantsOptions,
): LiquidityVariantResult[] {
  const statisticsByVariant = new Map(
    statisticsVariants.map((statistics) => [marketVariantKey(statistics.variant), statistics]),
  );
  const multipleVariants = variants.length > 1;

  return variants.map((variant) => {
    const key = marketVariantKey(variant);
    const matchingOrders = orders.filter(
      (order) => order.visible && marketVariantKey(marketVariantFromOrder(order)) === key,
    );
    const activeSellOrders = matchingOrders.filter((order) => order.type === "sell");
    const activeBuyOrders = matchingOrders.filter((order) => order.type === "buy");
    const onlineOrders = matchingOrders.filter(
      (order) => order.user.status === "online" || order.user.status === "ingame",
    );
    const onlineSellOrders = onlineOrders.filter((order) => order.type === "sell");
    const onlineBuyOrders = onlineOrders.filter((order) => order.type === "buy");
    const topOrders = options.topOrdersByVariant?.get(key);
    const bestSell = bestPrice(topOrders?.sell ?? onlineSellOrders, "sell");
    const bestBuy = bestPrice(topOrders?.buy ?? onlineBuyOrders, "buy");
    const midpoint =
      bestSell !== null && bestBuy !== null ? (bestSell + bestBuy) / 2 : null;
    const absoluteSpread =
      bestSell !== null && bestBuy !== null ? Math.max(0, bestSell - bestBuy) : null;
    const spreadPercent =
      midpoint !== null && midpoint > 0 && absoluteSpread !== null
        ? (absoluteSpread / midpoint) * 100
        : null;
    const sellDepthAtBestPrice =
      bestSell === null
        ? 0
        : onlineSellOrders
            .filter((order) => order.platinum === bestSell)
            .reduce((total, order) => total + order.quantity, 0);
    const buyDepthAtBestPrice =
      bestBuy === null
        ? 0
        : onlineBuyOrders
            .filter((order) => order.platinum === bestBuy)
            .reduce((total, order) => total + order.quantity, 0);

    const statistics = statisticsByVariant.get(key);
    const summary48 = statistics?.summaries.hours48 ?? null;
    const summary90 = statistics?.summaries.days90 ?? null;
    const averageDailyClosedVolume90d =
      summary90 === null
        ? null
        : summary90.reportedClosedVolume / DAYS_IN_STATISTICS_WINDOW;
    const historyUnavailableReason =
      options.historyUnavailableReason ??
      (options.historyStatus === "empty"
        ? "statistics_empty"
        : options.historyStatus === "unsupported_variant_dimensions"
          ? "statistics_variant_dimensions_unavailable"
          : options.historyStatus === "available" && !statistics
            ? "statistics_unavailable_for_variant"
            : undefined);

    return {
      variant,
      currentMarket: {
        activeSellOrders: activeSellOrders.length,
        activeBuyOrders: activeBuyOrders.length,
        onlineSellOrders: onlineSellOrders.length,
        onlineBuyOrders: onlineBuyOrders.length,
        bestSell,
        bestBuy,
        midpoint,
        absoluteSpread,
        spreadPercent,
        sellDepthAtBestPrice,
        buyDepthAtBestPrice,
      },
      history: {
        reportedClosedVolume48h: summary48?.reportedClosedVolume ?? null,
        reportedClosedVolume90d: summary90?.reportedClosedVolume ?? null,
        averageDailyClosedVolume90d,
        latestMedianPrice48h: summary48?.latestMedianPrice ?? null,
        weightedAveragePrice48h: summary48?.weightedAveragePrice ?? null,
      },
      assessment: calculateLiquidityAssessment({
        averageDailyClosedVolume90d,
        hasHistory48h: summary48 !== null,
        hasHistory90d: summary90 !== null,
        onlineSellOrders: onlineSellOrders.length,
        onlineBuyOrders: onlineBuyOrders.length,
        spreadPercent,
        historyUnavailableReason,
        multipleVariants,
      }),
    };
  });
}
