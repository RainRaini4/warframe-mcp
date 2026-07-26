import { describe, expect, it } from "vitest";
import {
  buildLiquidityVariants,
  calculateLiquidityAssessment,
  collectLiquidityVariants,
  gradeLiquidityScore,
  normalizeLegacyStatistics,
  summarizeMarketStatistics,
  type LiquidityMarketOrder,
  type MarketStatisticPoint,
} from "../worker/market-analytics.js";

function statisticPoint(
  overrides: Partial<MarketStatisticPoint> = {},
): MarketStatisticPoint {
  return {
    datetime: "2026-07-26T08:00:00.000Z",
    volume: 2,
    minPrice: 8,
    maxPrice: 12,
    averagePrice: 10,
    weightedAveragePrice: 11,
    medianPrice: 10,
    openPrice: 9,
    closePrice: 11,
    variant: { rank: 0 },
    ...overrides,
  };
}

function liquidityOrder(
  id: string,
  type: "sell" | "buy",
  platinum: number,
  overrides: Partial<LiquidityMarketOrder> = {},
): LiquidityMarketOrder {
  return {
    id,
    type,
    platinum,
    quantity: 1,
    visible: true,
    rank: 0,
    user: { status: "online" },
    ...overrides,
  };
}

describe("market statistics analytics", () => {
  it("computes volume-weighted summaries without replacing missing values with zero", () => {
    const summary = summarizeMarketStatistics([
      statisticPoint({
        datetime: "2026-07-26T08:00:00.000Z",
        volume: 2,
        weightedAveragePrice: 10,
        medianPrice: 9,
      }),
      statisticPoint({
        datetime: "2026-07-26T09:00:00.000Z",
        volume: 6,
        weightedAveragePrice: 20,
        medianPrice: 20,
      }),
      statisticPoint({
        datetime: "2026-07-26T10:00:00.000Z",
        volume: null,
        weightedAveragePrice: 1,
        medianPrice: null,
      }),
    ]);

    expect(summary).toEqual({
      reportedClosedVolume: 8,
      bucketCount: 3,
      bucketsWithVolume: 2,
      averageVolumePerBucket: 4,
      latestMedianPrice: 20,
      weightedMedianPrice: 20,
      weightedAveragePrice: 17.5,
      firstTimestamp: "2026-07-26T08:00:00.000Z",
      lastTimestamp: "2026-07-26T10:00:00.000Z",
    });
  });

  it("returns no summary when every bucket has missing volume", () => {
    expect(summarizeMarketStatistics([statisticPoint({ volume: null })])).toBeNull();
  });

  it("keeps rank variants separate and applies an exact rank filter", () => {
    const values = [
      {
        datetime: "2026-07-26T08:00:00.000Z",
        volume: 3,
        median: 5,
        wa_price: 5,
        mod_rank: 0,
      },
      {
        datetime: "2026-07-26T08:00:00.000Z",
        volume: 1,
        median: 100,
        wa_price: 100,
        mod_rank: 5,
      },
    ];

    const all = normalizeLegacyStatistics(values, values, { maxRank: 5 });
    const rankFive = normalizeLegacyStatistics(values, values, { maxRank: 5 }, { rank: 5 });

    expect(all.variants.map((variant) => variant.variant)).toEqual([
      { rank: 0 },
      { rank: 5 },
    ]);
    expect(all.warnings).toContain(
      "Multiple item variants were returned and summarized separately.",
    );
    expect(rankFive.variants).toHaveLength(1);
    expect(rankFive.variants[0]?.variant).toEqual({ rank: 5 });
    expect(rankFive.variants[0]?.summaries.hours48?.reportedClosedVolume).toBe(1);
  });

  it("refuses to aggregate history when a catalog variant dimension is absent", () => {
    const result = normalizeLegacyStatistics(
      [
        {
          datetime: "2026-07-26T08:00:00.000Z",
          volume: 4,
          median: 3,
          wa_price: 3,
          mod_rank: 5,
        },
      ],
      [],
      { maxRank: 5, subtypes: ["regular", "atragraph"] },
    );

    expect(result.status).toBe("unsupported_variant_dimensions");
    expect(result.variants).toEqual([]);
    expect(result.warnings[0]).toContain("subtype");
  });

  it("normalizes Ayatan star fields and preserves null numeric metrics", () => {
    const result = normalizeLegacyStatistics(
      [
        {
          datetime: "2026-07-26T08:00:00.000Z",
          volume: 4,
          median: null,
          wa_price: 9,
          amber_stars: 2,
          cyan_stars: 2,
        },
      ],
      [],
      { maxAmberStars: 2, maxCyanStars: 2 },
    );

    expect(result.variants[0]?.variant).toEqual({ amberStars: 2, cyanStars: 2 });
    expect(result.variants[0]?.closed.hours48[0]).toMatchObject({
      medianPrice: null,
      minPrice: null,
      maxPrice: null,
    });
  });

  it("keeps subtype variants separate and filters one exact subtype", () => {
    const values = [
      {
        datetime: "2026-07-26T08:00:00.000Z",
        volume: 4,
        median: 10,
        subtype: "regular",
      },
      {
        datetime: "2026-07-26T08:00:00.000Z",
        volume: 2,
        median: 40,
        subtype: "atragraph",
      },
    ];

    const all = normalizeLegacyStatistics(values, values, {
      subtypes: ["regular", "atragraph"],
    });
    const exact = normalizeLegacyStatistics(
      values,
      values,
      { subtypes: ["regular", "atragraph"] },
      { subtype: "atragraph" },
    );

    expect(all.variants.map((entry) => entry.variant)).toEqual([
      { subtype: "atragraph" },
      { subtype: "regular" },
    ]);
    expect(exact.variants).toHaveLength(1);
    expect(exact.variants[0]?.variant).toEqual({ subtype: "atragraph" });
    expect(exact.variants[0]?.summaries.days90?.reportedClosedVolume).toBe(2);
  });

  it("ignores points with unrecognized fields instead of silently aggregating them", () => {
    const result = normalizeLegacyStatistics(
      [
        {
          datetime: "2026-07-26T08:00:00.000Z",
          volume: 4,
          median: 9,
          future_variant: "unknown",
        },
      ],
      [],
      {},
    );

    expect(result.status).toBe("empty");
    expect(result.variants).toEqual([]);
    expect(result.warnings.join(" ")).toContain("future_variant");
  });
});

describe("market liquidity analytics", () => {
  it("uses documented score boundaries and clamps the heuristic to 0-100", () => {
    expect(gradeLiquidityScore(null)).toBe("unknown");
    expect([24.9, 25, 50, 70, 85].map(gradeLiquidityScore)).toEqual([
      "very_low",
      "low",
      "medium",
      "high",
      "very_high",
    ]);

    const liquid = calculateLiquidityAssessment({
      averageDailyClosedVolume90d: 50,
      hasHistory48h: true,
      hasHistory90d: true,
      onlineSellOrders: 20,
      onlineBuyOrders: 20,
      spreadPercent: 0,
    });
    const illiquid = calculateLiquidityAssessment({
      averageDailyClosedVolume90d: 0,
      hasHistory48h: true,
      hasHistory90d: true,
      onlineSellOrders: 0,
      onlineBuyOrders: 0,
      spreadPercent: 100,
    });

    expect(liquid).toMatchObject({ score: 100, grade: "very_high", confidence: "high" });
    expect(liquid.reasons).toEqual(["high_90d_volume", "deep_two_sided_market", "tight_spread"]);
    expect(illiquid).toMatchObject({ score: 0, grade: "very_low", confidence: "medium" });
    expect(illiquid.reasons).toEqual(["low_90d_volume", "one_sided_market", "wide_spread"]);
  });

  it("keeps a high-volume but shallow market distinct from deep low-volume orders", () => {
    const highVolume = calculateLiquidityAssessment({
      averageDailyClosedVolume90d: 50,
      hasHistory48h: true,
      hasHistory90d: true,
      onlineSellOrders: 1,
      onlineBuyOrders: 1,
      spreadPercent: 5,
    });
    const deepLowVolume = calculateLiquidityAssessment({
      averageDailyClosedVolume90d: 1,
      hasHistory48h: true,
      hasHistory90d: true,
      onlineSellOrders: 20,
      onlineBuyOrders: 20,
      spreadPercent: 5,
    });

    expect(highVolume.reasons).toContain("high_90d_volume");
    expect(highVolume.reasons).not.toContain("deep_two_sided_market");
    expect(deepLowVolume.reasons).toContain("low_90d_volume");
    expect(deepLowVolume.reasons).toContain("deep_two_sided_market");
    expect(highVolume.score).toBeGreaterThan(deepLowVolume.score ?? 0);
  });

  it("returns an unknown score when 90-day history is absent", () => {
    expect(
      calculateLiquidityAssessment({
        averageDailyClosedVolume90d: null,
        hasHistory48h: false,
        hasHistory90d: false,
        onlineSellOrders: 3,
        onlineBuyOrders: 3,
        spreadPercent: 10,
        historyUnavailableReason: "statistics_unavailable",
      }),
    ).toEqual({
      score: null,
      grade: "unknown",
      confidence: "low",
      reasons: ["statistics_unavailable", "two_sided_market", "tight_spread"],
    });
  });

  it("returns finite deterministic scores for identical inputs", () => {
    const input = {
      averageDailyClosedVolume90d: 3.75,
      hasHistory48h: false,
      hasHistory90d: true,
      onlineSellOrders: 7,
      onlineBuyOrders: 4,
      spreadPercent: 17.5,
    };
    const first = calculateLiquidityAssessment(input);
    const second = calculateLiquidityAssessment(input);

    expect(second).toEqual(first);
    expect(first.score).not.toBeNull();
    expect(Number.isFinite(first.score)).toBe(true);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
  });

  it("keeps order and history variants separate without mixing rank prices", () => {
    const orders = [
      liquidityOrder("r0-sell", "sell", 10, { rank: 0 }),
      liquidityOrder("r0-buy", "buy", 9, { rank: 0 }),
      liquidityOrder("r5-sell", "sell", 100, { rank: 5 }),
      liquidityOrder("r5-buy", "buy", 90, { rank: 5 }),
    ];
    const statistics = normalizeLegacyStatistics(
      [],
      [
        { datetime: "2026-07-25T00:00:00.000Z", volume: 90, median: 10, mod_rank: 0 },
        { datetime: "2026-07-25T00:00:00.000Z", volume: 900, median: 100, mod_rank: 5 },
      ],
      { maxRank: 5 },
    );
    const variants = collectLiquidityVariants(orders, statistics.variants);
    const result = buildLiquidityVariants(variants, orders, statistics.variants, {
      historyStatus: statistics.status,
    });

    expect(result.map((entry) => entry.variant)).toEqual([{ rank: 0 }, { rank: 5 }]);
    expect(result[0]?.currentMarket).toMatchObject({ bestSell: 10, bestBuy: 9 });
    expect(result[0]?.history.averageDailyClosedVolume90d).toBe(1);
    expect(result[1]?.currentMarket).toMatchObject({ bestSell: 100, bestBuy: 90 });
    expect(result[1]?.history.averageDailyClosedVolume90d).toBe(10);
    expect(result.every((entry) => entry.assessment.reasons[0] === "multiple_variants")).toBe(
      true,
    );
  });

  it("keeps subtype liquidity independent", () => {
    const orders = [
      liquidityOrder("regular-sell", "sell", 10, { rank: undefined, subtype: "regular" }),
      liquidityOrder("regular-buy", "buy", 9, { rank: undefined, subtype: "regular" }),
      liquidityOrder("atragraph-sell", "sell", 50, {
        rank: undefined,
        subtype: "atragraph",
      }),
      liquidityOrder("atragraph-buy", "buy", 30, {
        rank: undefined,
        subtype: "atragraph",
      }),
    ];
    const variants = collectLiquidityVariants(orders, []);
    const result = buildLiquidityVariants(variants, orders, [], { historyStatus: "empty" });

    expect(result.map((entry) => entry.variant)).toEqual([
      { subtype: "atragraph" },
      { subtype: "regular" },
    ]);
    expect(result.map((entry) => [entry.currentMarket.bestSell, entry.currentMarket.bestBuy])).toEqual([
      [50, 30],
      [10, 9],
    ]);
  });

  it("keeps unfiltered dimensions separate when a partial variant filter is supplied", () => {
    const orders = [
      liquidityOrder("regular", "sell", 10, { rank: 5, subtype: "regular" }),
      liquidityOrder("atragraph", "sell", 50, { rank: 5, subtype: "atragraph" }),
      liquidityOrder("other-rank", "sell", 1, { rank: 0, subtype: "regular" }),
    ];

    expect(collectLiquidityVariants(orders, [], { rank: 5 })).toEqual([
      { rank: 5, subtype: "atragraph" },
      { rank: 5, subtype: "regular" },
    ]);
  });

  it("applies an exact variant and counts visible, online, and best-price depth independently", () => {
    const orders = [
      liquidityOrder("sell-best-a", "sell", 10, { quantity: 2 }),
      liquidityOrder("sell-best-b", "sell", 10, { quantity: 3 }),
      liquidityOrder("sell-offline", "sell", 8, { user: { status: "offline" } }),
      liquidityOrder("buy-best", "buy", 9, { quantity: 4 }),
      liquidityOrder("other-rank", "buy", 99, { rank: 5 }),
    ];
    const variants = collectLiquidityVariants(orders, [], { rank: 0 });
    const result = buildLiquidityVariants(variants, orders, [], { historyStatus: "empty" });

    expect(result).toHaveLength(1);
    expect(result[0]?.variant).toEqual({ rank: 0 });
    expect(result[0]?.currentMarket).toMatchObject({
      activeSellOrders: 3,
      activeBuyOrders: 1,
      onlineSellOrders: 2,
      onlineBuyOrders: 1,
      bestSell: 10,
      bestBuy: 9,
      sellDepthAtBestPrice: 5,
      buyDepthAtBestPrice: 4,
    });
    expect(result[0]?.assessment).toMatchObject({
      score: null,
      grade: "unknown",
      confidence: "low",
    });
    expect(result[0]?.assessment.reasons).toContain("statistics_empty");
  });

  it.each([
    ["sell", [liquidityOrder("sell", "sell", 10)]],
    ["buy", [liquidityOrder("buy", "buy", 9)]],
  ] as const)("handles a %s-only market without fabricating a spread", (_side, orders) => {
    const result = buildLiquidityVariants([{ rank: 0 }], [...orders], [], {
      historyStatus: "unavailable",
      historyUnavailableReason: "statistics_unavailable",
    });

    expect(result[0]?.currentMarket.spreadPercent).toBeNull();
    expect(result[0]?.assessment).toMatchObject({ score: null, grade: "unknown" });
    expect(result[0]?.assessment.reasons).toContain("one_sided_market");
    expect(result[0]?.assessment.reasons).toContain("spread_unavailable");
  });
});
