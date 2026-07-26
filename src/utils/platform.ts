// ─── Platform normalization ─────────────────────────────────────────────────
//
// Different upstream APIs use different identifiers for the same platform:
//   - WarframeStatus (warframestat.us) uses `xb1` and `swi`
//   - Warframe Market uses `xbox` and `switch`
//
// MCP users should not have to learn those internal differences. The canonical
// user-facing values are pc / ps4 / xbox / switch / mobile, and a small set of
// legacy aliases is accepted for backward compatibility. Each upstream gets a
// dedicated converter so the same user input always resolves to the right code
// for that API.

export const CANONICAL_PLATFORMS = [
  "pc",
  "ps4",
  "xbox",
  "switch",
  "mobile",
] as const;
export type CanonicalPlatform = (typeof CANONICAL_PLATFORMS)[number];

/** User-facing aliases preserved for backward compatibility. */
export const PLATFORM_ALIASES: Readonly<Record<string, CanonicalPlatform>> = {
  xb1: "xbox",
  swi: "switch",
  ns: "switch",
  psn: "ps4",
};

/**
 * Normalize a user-supplied platform string to its canonical form.
 * Trims surrounding whitespace and ignores case. Returns undefined when the
 * input is not a recognized canonical value or alias.
 */
export function normalizeCanonicalPlatform(input: string | undefined | null): CanonicalPlatform | undefined {
  if (!input) return undefined;
  const trimmed = input.trim().toLowerCase();
  if ((CANONICAL_PLATFORMS as readonly string[]).includes(trimmed)) {
    return trimmed as CanonicalPlatform;
  }
  return PLATFORM_ALIASES[trimmed];
}

/**
 * Convert a user-supplied platform to a Warframe Market upstream code.
 * `mobile` is a valid Market platform; unknown input is rejected.
 */
export function normalizeMarketPlatform(input: string | undefined | null): string {
  const canonical = normalizeCanonicalPlatform(input);
  if (!canonical) {
    throw new PlatformNormalizationError("market", input, CANONICAL_PLATFORMS);
  }
  return canonical;
}

/** Canonical values supported by the worldstate upstream (no mobile). */
const WORLDSTATE_CANONICAL_VALUES = CANONICAL_PLATFORMS.filter(
  (value) => value !== "mobile",
);

/**
 * Convert a user-supplied platform to a WarframeStatus (warframestat.us)
 * upstream code. `mobile` is not supported by this upstream and is rejected.
 */
export function normalizeWorldstatePlatform(input: string | undefined | null): string {
  const canonical = normalizeCanonicalPlatform(input);
  if (!canonical) {
    throw new PlatformNormalizationError("worldstate", input, WORLDSTATE_CANONICAL_VALUES);
  }
  if (canonical === "mobile") {
    throw new PlatformNormalizationError(
      "worldstate",
      input,
      WORLDSTATE_CANONICAL_VALUES,
      "WarframeStatus does not expose a mobile platform.",
    );
  }
  if (canonical === "xbox") return "xb1";
  if (canonical === "switch") return "swi";
  return canonical;
}

/** Default fallback when the caller did not supply a platform at all. */
export const DEFAULT_CANONICAL_PLATFORM: CanonicalPlatform = "pc";

/**
 * User-facing values accepted by the worldstate tools, including legacy
 * aliases. `mobile` is intentionally excluded: warframestat.us does not expose
 * a mobile platform.
 */
export const WORLDSTATE_PLATFORM_VALUES = [
  "pc",
  "ps4",
  "xbox",
  "switch",
  "xb1",
  "swi",
  "ns",
  "psn",
] as const;

/**
 * User-facing values accepted by the legacy Warframe Market tools, including
 * legacy aliases and `mobile`.
 */
export const MARKET_PLATFORM_VALUES = [
  "pc",
  "ps4",
  "xbox",
  "switch",
  "mobile",
  "xb1",
  "swi",
  "ns",
  "psn",
] as const;

/**
 * Error thrown when a platform value cannot be mapped to the requested upstream.
 * The message enumerates the accepted user-facing values so the caller (or the
 * MCP client) can correct the input without reading the source.
 */
export class PlatformNormalizationError extends Error {
  constructor(
    public readonly upstream: "market" | "worldstate",
    public readonly input: string | undefined | null,
    acceptedValues: readonly string[],
    reason?: string,
  ) {
    const received = input === undefined || input === null ? "(missing)" : `"${input}"`;
    const list = acceptedValues.map((value) => `\`${value}\``).join(", ");
    super(
      [
        `Unsupported platform ${received} for ${upstream} API.`,
        reason,
        `Accepted canonical values (and their legacy aliases): ${list}.`,
        "Legacy aliases: xb1 → xbox, swi/ns → switch, psn → ps4.",
      ]
        .filter(Boolean)
        .join(" "),
    );
    this.name = "PlatformNormalizationError";
  }
}
