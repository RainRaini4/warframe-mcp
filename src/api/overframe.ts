import { TTLCache } from "../utils/cache.js";
import type {
  OverframeBuildPageProps,
  OverframeBuildSummary,
} from "../types/index.js";

const BASE_URL = "https://overframe.gg";
const cache = new TTLCache<unknown>();

// Cache build pages for 6 hours (builds rarely change)
const TTL_BUILDS = 6 * 60 * 60_000;

/**
 * Categories supported by Overframe build lists
 */
export type OverframeCategory =
  | "warframes"
  | "primary-weapons"
  | "secondary-weapons"
  | "melee-weapons"
  | "archwing"
  | "sentinels";

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Raised when an Overframe page looks like a real build listing (it carries
 * Overframe markers and build-route links) but the parser extracted zero
 * builds. Almost always means upstream markup changed; the result is never
 * cached so the next request re-attempts the parse.
 */
export class OverframeParseDriftError extends Error {
  constructor(
    public readonly category: OverframeCategory | "build",
    public readonly path: string,
  ) {
    super(
      `unexpected Overframe markup: parser returned 0 builds for ${path} (category=${category})`,
    );
    this.name = "OverframeParseDriftError";
  }
}

// ─── HTML fetch (network boundary) ──────────────────────────────────────────

/**
 * Fetch raw HTML from Overframe with a timeout.
 * Overframe public pages are allowed by robots.txt (only /api/ is disallowed).
 */
async function fetchHTML(
  path: string,
  fetcher: typeof fetch,
  timeout = 15_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(`${BASE_URL}${path}`, {
      headers: {
        Accept: "text/html",
        "User-Agent": "WarframeMCP/1.0 (build-lookup)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Pure parser (no network, no clock) ─────────────────────────────────────

const NEXT_DATA_MARKER = '<script id="__NEXT_DATA__" type="application/json">';

/**
 * Cheap structural check: does this HTML look like a real Overframe page that
 * should contain builds? Used to separate "no results" from "markup changed".
 */
export function looksLikeOverframePage(html: string): boolean {
  return html.includes(NEXT_DATA_MARKER) || html.includes("/build/");
}

/**
 * Build-route link: /build/{id}/{item-slug}/{title-slug}/
 * The route itself is a stable structural anchor; we no longer require the
 * surrounding CSS module class names, which change frequently upstream.
 */
const BUILD_LINK_REGEX = /href="\/build\/(\d+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/"/gi;

/**
 * Parse build summaries from an Overframe build list HTML page.
 * Pure: takes a string, returns typed summaries, touches nothing else.
 *
 * Anchor strategy: each `/build/{id}/{item-slug}/{title-slug}/` route starts a
 * build card. We scan a bounded window after each link for nearby title,
 * author, vote, and forma text. When the text cannot be found, we fall back to
 * slug-derived values so the caller always gets a usable summary.
 */
export function parseBuildListHTML(html: string): OverframeBuildSummary[] {
  const builds: OverframeBuildSummary[] = [];
  const seen = new Set<number>();

  BUILD_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BUILD_LINK_REGEX.exec(html)) !== null) {
    const id = parseInt(match[1], 10);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);

    // Bounded window after the link for card-scoped text scraping.
    const afterLink = html.substring(match.index, match.index + 2000);

    const title = extractNearbyTitle(afterLink) ?? match[3].replace(/-/g, " ");
    const author = extractNearbyAuthor(afterLink) ?? "unknown";
    const votes = extractNearbyVotes(afterLink);
    const forma = extractNearbyForma(afterLink);

    builds.push({
      id,
      created: "",
      updated: "",
      score: votes,
      url: `/build/${id}/${match[2]}/${match[3]}/`,
      author: { id: 0, username: author, url: "", is_staff: false },
      formas: forma,
      item_data: { id: 0, locTag: "", texture_new: "" },
      title,
    });
  }

  return builds;
}

function extractNearbyTitle(window: string): string | null {
  // h3 / heading text is the most stable title carrier; fall back to the first
  // non-empty trimmed text node that does not look like metadata.
  const heading = window.match(/<h3[^>]*>([^<]+)</i);
  if (heading && heading[1].trim()) return decodeEntities(heading[1].trim());
  return null;
}

function extractNearbyAuthor(window: string): string | null {
  // "guide by <author>" is a stable Overframe phrasing. The author name is
  // often wrapped in a span, so accept either a bare word or the first text
  // node of the next element.
  const guideByTag = window.match(/guide by\s*<[^>]*>([^<]+)/i);
  if (guideByTag && guideByTag[1].trim()) return decodeEntities(guideByTag[1].trim());
  const guideByBare = window.match(/guide by\s+([^<,\s]+)/i);
  if (guideByBare && guideByBare[1].trim()) return decodeEntities(guideByBare[1].trim());
  return null;
}

function extractNearbyVotes(window: string): number {
  // Votes are typically rendered as a `<dd>N</dd>` near a "votes" label, or as
  // a bare number followed by a votes icon. Accept either.
  const dd = window.match(/(\d+)<\/dd>/i);
  if (dd) return parseInt(dd[1], 10);
  const icon = window.match(/(\d+)\s*(?:votes?|▲)/i);
  return icon ? parseInt(icon[1], 10) : 0;
}

function extractNearbyForma(window: string): number {
  const forma = window.match(/(\d+)<!--\s*-->\s*Forma/);
  if (forma) return parseInt(forma[1], 10);
  const formaAlt = window.match(/(\d+)\s*Forma/i);
  return formaAlt ? parseInt(formaAlt[1], 10) : 0;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extract __NEXT_DATA__ JSON from an Overframe HTML page. Pure.
 */
export function extractNextData(html: string): Record<string, unknown> | null {
  const start = html.indexOf(NEXT_DATA_MARKER);
  if (start === -1) return null;
  const jsonStart = start + NEXT_DATA_MARKER.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end === -1) return null;
  try {
    return JSON.parse(html.substring(jsonStart, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Get the item slug from a build URL.
 * E.g. /build/374539/revenant-prime/some-title/ -> "revenant-prime"
 */
function getItemSlugFromUrl(url: string): string {
  const parts = url.split("/").filter(Boolean);
  // Format: build / {id} / {item-slug} / {title-slug}
  return parts.length >= 3 ? parts[2] : "";
}

/**
 * Normalize a search query to a slug-like format for matching.
 * "Saryn Prime" -> "saryn-prime"
 */
function normalizeToSlug(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch top builds for a category, optionally filtered by item name.
 * Returns build summaries sorted by votes (highest first).
 *
 * Cache policy:
 * - Successful non-empty result is cached.
 * - Empty result on a page that looks like a real Overframe listing is treated
 *   as parser drift and raises OverframeParseDriftError; it is never cached.
 * - Network errors propagate and are never cached.
 */
export async function getTopBuilds(
  category: OverframeCategory,
  itemName?: string,
  limit = 5,
  fetcher: typeof fetch = fetch,
): Promise<OverframeBuildSummary[]> {
  const cacheKey = `overframe:list:${category}`;
  let builds = cache.get(cacheKey) as OverframeBuildSummary[] | undefined;

  if (!builds) {
    const path = `/builds/${category}/`;
    const html = await fetchHTML(path, fetcher);
    const parsed = parseBuildListHTML(html);

    if (parsed.length === 0 && looksLikeOverframePage(html)) {
      console.error(
        `[overframe] parse drift: 0 builds extracted from ${path} (page looks like a real listing)`,
      );
      throw new OverframeParseDriftError(category, path);
    }

    // parsed.length === 0 without Overframe markers means the upstream returned
    // something unexpected (404 page, empty body, ...). Do not cache it.
    if (parsed.length === 0) {
      throw new OverframeParseDriftError(category, path);
    }

    parsed.sort((a, b) => b.score - a.score);
    cache.set(cacheKey, parsed, TTL_BUILDS);
    builds = parsed;
  }

  if (itemName) {
    const slug = normalizeToSlug(itemName);
    builds = builds.filter((b) => {
      const itemSlug = getItemSlugFromUrl(b.url);
      return itemSlug.includes(slug) || slug.includes(itemSlug);
    });
  }

  return builds.slice(0, limit);
}

/**
 * Fetch full build details from a specific build page.
 * Returns the parsed __NEXT_DATA__ pageProps.
 *
 * Cache policy mirrors getTopBuilds: only successfully parsed pages are cached;
 * malformed __NEXT_DATA__ raises and is not cached.
 */
export async function getBuildDetail(
  buildId: number,
  fetcher: typeof fetch = fetch,
): Promise<OverframeBuildPageProps | null> {
  const cacheKey = `overframe:build:${buildId}`;
  const cached = cache.get(cacheKey) as OverframeBuildPageProps | undefined;
  if (cached) return cached;

  const path = `/build/${buildId}/`;
  const html = await fetchHTML(path, fetcher);
  const nextData = extractNextData(html);
  if (!nextData) {
    throw new OverframeParseDriftError("build", path);
  }

  const props = nextData as {
    props?: { pageProps?: OverframeBuildPageProps };
  };
  const pageProps = props?.props?.pageProps;
  if (!pageProps?.data) {
    throw new OverframeParseDriftError("build", path);
  }

  cache.set(cacheKey, pageProps, TTL_BUILDS);
  return pageProps;
}

/**
 * Determine the best Overframe category for a given item type.
 */
export function inferCategory(
  itemType: string
): OverframeCategory | null {
  const t = itemType.toLowerCase();
  if (
    t.includes("warframe") ||
    t.includes("frame") ||
    t === "suit" ||
    t === "suits"
  )
    return "warframes";
  if (t.includes("primary")) return "primary-weapons";
  if (t.includes("secondary") || t.includes("pistol")) return "secondary-weapons";
  if (t.includes("melee") || t.includes("sword") || t.includes("dagger"))
    return "melee-weapons";
  if (t.includes("archwing") || t.includes("archgun") || t.includes("archmelee"))
    return "archwing";
  if (t.includes("sentinel") || t.includes("companion"))
    return "sentinels";
  return null;
}

// ─── Test-only helpers ──────────────────────────────────────────────────────

/** Test-only escape hatch to clear the in-memory Overframe cache. */
export function clearOverframeCache(): void {
  cache.clear();
}
