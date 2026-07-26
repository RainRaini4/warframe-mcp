import { describe, expect, it } from "vitest";
import {
  MARKET_PLATFORM_VALUES,
  normalizeCanonicalPlatform,
  normalizeMarketPlatform,
  normalizeWorldstatePlatform,
  PlatformNormalizationError,
  WORLDSTATE_PLATFORM_VALUES,
} from "../../src/utils/platform.js";

describe("normalizeCanonicalPlatform", () => {
  it.each([
    ["pc", "pc"],
    ["ps4", "ps4"],
    ["xbox", "xbox"],
    ["switch", "switch"],
    ["mobile", "mobile"],
  ] as const)("accepts canonical value %s", (input, expected) => {
    expect(normalizeCanonicalPlatform(input)).toBe(expected);
  });

  it.each([
    ["xb1", "xbox"],
    ["swi", "switch"],
    ["ns", "switch"],
    ["psn", "ps4"],
  ] as const)("maps alias %s → %s", (input, expected) => {
    expect(normalizeCanonicalPlatform(input)).toBe(expected);
  });

  it("trims whitespace and ignores case", () => {
    expect(normalizeCanonicalPlatform("  PC  ")).toBe("pc");
    expect(normalizeCanonicalPlatform("Xbox")).toBe("xbox");
    expect(normalizeCanonicalPlatform(" Swi ")).toBe("switch");
  });

  it("returns undefined for an unknown platform", () => {
    expect(normalizeCanonicalPlatform("mega")).toBeUndefined();
    expect(normalizeCanonicalPlatform("")).toBeUndefined();
    expect(normalizeCanonicalPlatform(null)).toBeUndefined();
    expect(normalizeCanonicalPlatform(undefined)).toBeUndefined();
  });
});

describe("normalizeMarketPlatform", () => {
  it.each([
    ["pc", "pc"],
    ["xb1", "xbox"],
    ["swi", "switch"],
    ["ns", "switch"],
    ["psn", "ps4"],
    ["mobile", "mobile"],
  ] as const)("returns the Market upstream code for %s", (input, expected) => {
    expect(normalizeMarketPlatform(input)).toBe(expected);
  });

  it("throws a PlatformNormalizationError enumerating accepted values for unknown input", () => {
    expect(() => normalizeMarketPlatform("mega")).toThrow(PlatformNormalizationError);
    expect(() => normalizeMarketPlatform("mega")).toThrow(/`mobile`/);
    expect(() => normalizeMarketPlatform("mega")).toThrow(/xb1 → xbox/);
  });
});

describe("normalizeWorldstatePlatform", () => {
  it.each([
    ["pc", "pc"],
    ["ps4", "ps4"],
    ["xbox", "xb1"],
    ["xb1", "xb1"],
    ["switch", "swi"],
    ["swi", "swi"],
    ["ns", "swi"],
    ["psn", "ps4"],
  ] as const)("returns the WarframeStatus upstream code for %s", (input, expected) => {
    expect(normalizeWorldstatePlatform(input)).toBe(expected);
  });

  it("rejects mobile because WarframeStatus does not expose it", () => {
    expect(() => normalizeWorldstatePlatform("mobile")).toThrow(PlatformNormalizationError);
    expect(() => normalizeWorldstatePlatform("mobile")).toThrow(/not expose a mobile platform/);
  });

  it("does not list mobile among the accepted values on rejection", () => {
    expect(() => normalizeWorldstatePlatform("mega")).toThrow(/Accepted canonical values/);
    try {
      normalizeWorldstatePlatform("mega");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformNormalizationError);
      const message = (error as PlatformNormalizationError).message;
      expect(message).not.toMatch(/`mobile`/);
    }
  });

  it("throws for an unknown platform", () => {
    expect(() => normalizeWorldstatePlatform("steamdeck")).toThrow(PlatformNormalizationError);
  });
});

describe("platform value lists for tool schemas", () => {
  it("excludes mobile from worldstate values and includes it in market values", () => {
    expect(WORLDSTATE_PLATFORM_VALUES).not.toContain("mobile");
    expect(WORLDSTATE_PLATFORM_VALUES).toEqual(expect.arrayContaining(["pc", "ps4", "xbox", "switch", "xb1", "swi", "ns", "psn"]));
    expect(MARKET_PLATFORM_VALUES).toContain("mobile");
    expect(MARKET_PLATFORM_VALUES).toEqual(expect.arrayContaining([...WORLDSTATE_PLATFORM_VALUES, "mobile"]));
  });
});
