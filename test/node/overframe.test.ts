import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OverframeParseDriftError,
  clearOverframeCache,
  extractNextData,
  getBuildDetail,
  getTopBuilds,
  looksLikeOverframePage,
  parseBuildListHTML,
} from "../../src/api/overframe.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/overframe-builds.html", import.meta.url),
);
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf8");

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

function scriptedFetch(responses: Array<Response | Error>): typeof fetch {
  let index = 0;
  return (() => {
    const entry = responses[index];
    index += 1;
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(entry);
  }) as typeof fetch;
}

beforeEach(() => {
  clearOverframeCache();
});

// ─── Pure parser ─────────────────────────────────────────────────────────────

describe("parseBuildListHTML", () => {
  it("extracts the expected builds from the synthetic fixture", () => {
    const builds = parseBuildListHTML(FIXTURE_HTML);

    expect(builds.map((b) => b.id)).toEqual([100001, 100002]);
    expect(builds[0]).toMatchObject({
      title: "Spore Nuke Endless",
      url: "/build/100001/saryn-prime/spore-nuke/",
      author: { username: "TesterOne" },
      score: 42,
      formas: 3,
    });
    expect(builds[1]).toMatchObject({
      title: "Tank Saryn Meme Build",
      url: "/build/100002/saryn-prime/tankyer-meme/",
      author: { username: "TesterTwo" },
      score: 9,
      formas: 0,
    });
  });

  it("keeps several builds separate — they are not glued together", () => {
    const builds = parseBuildListHTML(FIXTURE_HTML);
    expect(builds).toHaveLength(2);
    expect(builds.every((b) => b.title.length > 0)).toBe(true);
    expect(new Set(builds.map((b) => b.id)).size).toBe(builds.length);
  });

  it("de-duplicates build ids predictably, keeping the first occurrence", () => {
    // The fixture repeats build 100001; the parser must emit it only once.
    const builds = parseBuildListHTML(FIXTURE_HTML);
    const ids = builds.map((b) => b.id);
    expect(ids).toEqual([100001, 100002]);
  });

  it("does not depend on CSS module class names — only on /build/ routes", () => {
    const htmlWithoutCssModules = FIXTURE_HTML.replaceAll(
      /class="BuildSummaryFull_[a-zA-Z]+"/g,
      'class="anything"',
    );
    const builds = parseBuildListHTML(htmlWithoutCssModules);
    expect(builds.map((b) => b.id)).toEqual([100001, 100002]);
  });

  it("returns an empty array when no build routes are present", () => {
    expect(parseBuildListHTML("<html><body>no builds here</body></html>")).toEqual([]);
  });
});

describe("looksLikeOverframePage", () => {
  it("recognizes a page with __NEXT_DATA__ or build routes", () => {
    expect(looksLikeOverframePage(FIXTURE_HTML)).toBe(true);
    expect(looksLikeOverframePage('<html><a href="/build/1/foo/bar/">x</a></html>')).toBe(true);
  });

  it("rejects a page with no Overframe markers", () => {
    expect(looksLikeOverframePage("<html><body>nothing</body></html>")).toBe(false);
  });
});

describe("extractNextData", () => {
  it("parses the __NEXT_DATA__ JSON block", () => {
    const data = extractNextData(FIXTURE_HTML) as {
      props?: { pageProps?: { itemBuilds?: unknown[] } };
    } | null;
    expect(data?.props?.pageProps?.itemBuilds).toEqual([{ id: 100001 }]);
  });

  it("returns null for missing or malformed JSON", () => {
    expect(extractNextData("<html></html>")).toBeNull();
    expect(extractNextData('<script id="__NEXT_DATA__" type="application/json">{not json}</script>')).toBeNull();
  });
});

// ─── Cache and drift policy ──────────────────────────────────────────────────

describe("getTopBuilds cache and drift policy", () => {
  it("caches a successful result and reuses it on the next call", async () => {
    let requests = 0;
    const fetcher = (() => {
      requests += 1;
      return Promise.resolve(htmlResponse(FIXTURE_HTML));
    }) as typeof fetch;

    const first = await getTopBuilds("warframes", undefined, 5, fetcher);
    const second = await getTopBuilds("warframes", undefined, 5, fetcher);

    expect(first.map((b) => b.id)).toEqual([100001, 100002]);
    expect(second).toEqual(first);
    expect(requests).toBe(1);
  });

  it("sorts cached builds by votes descending", async () => {
    const fetcher = (() => Promise.resolve(htmlResponse(FIXTURE_HTML))) as typeof fetch;
    const builds = await getTopBuilds("warframes", undefined, 5, fetcher);
    expect(builds.map((b) => b.score)).toEqual([42, 9]);
  });

  it("does not cache a network error — the next call retries", async () => {
    let requests = 0;
    const fetcher = scriptedFetch([
      new Error("network down"),
      htmlResponse(FIXTURE_HTML),
    ]);

    await expect(getTopBuilds("warframes", undefined, 5, fetcher)).rejects.toThrow(
      "network down",
    );
    requests = 0;
    // New fetcher because the scripted one is exhausted; proves the failure was
    // not cached by checking that a fresh successful fetch works immediately.
    const okFetcher = (() => {
      requests += 1;
      return Promise.resolve(htmlResponse(FIXTURE_HTML));
    }) as typeof fetch;
    const builds = await getTopBuilds("warframes", undefined, 5, okFetcher);
    expect(builds).toHaveLength(2);
    expect(requests).toBe(1);
  });

  it("raises OverframeParseDriftError and does not cache when a real-looking page yields zero builds", async () => {
    // A real Overframe page (has __NEXT_DATA__) but the parser cannot find any
    // build-route links — i.e. the markup shape has drifted.
    const suspiciousHtml =
      '<html><body><script id="__NEXT_DATA__" type="application/json">{}</script>' +
      '<main><h1>Top builds</h1><p>some cards that no longer match</p></main></body></html>';
    let requests = 0;
    const failFetcher = (() => {
      requests += 1;
      return Promise.resolve(htmlResponse(suspiciousHtml));
    }) as typeof fetch;

    await expect(getTopBuilds("warframes", undefined, 5, failFetcher)).rejects.toThrow(
      OverframeParseDriftError,
    );
    expect(requests).toBe(1);

    // The drift result must not be cached: a subsequent successful fetch returns
    // the real builds.
    const okFetcher = (() => Promise.resolve(htmlResponse(FIXTURE_HTML))) as typeof fetch;
    const builds = await getTopBuilds("warframes", undefined, 5, okFetcher);
    expect(builds.map((b) => b.id)).toEqual([100001, 100002]);
  });

  it("raises drift when the upstream HTML has no Overframe markers at all", async () => {
    const emptyFetcher = (() =>
      Promise.resolve(htmlResponse("<html><body>404</body></html>"))) as typeof fetch;
    await expect(getTopBuilds("warframes", undefined, 5, emptyFetcher)).rejects.toThrow(
      OverframeParseDriftError,
    );
  });
});

describe("getBuildDetail cache and drift policy", () => {
  const buildPageHtml = `
    <html><body>
    <script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"data":{"id":1,"title":"x","url":"/build/1/x/y/","buildstring":"","description":"","comment_count":0,"slots":[],"item":1,"platinum_cost":0,"endo_cost":0,"item_rank":0,"mastery_rank":0,"stats":{},"total_damage":0,"created":"","updated":"","score":0,"author":{"id":0,"username":"a","url":"","is_staff":false},"formas":0,"item_data":{"id":0,"locTag":"","texture_new":""}},"id":1,"item":{"categories":[],"id":1,"name":"x","path":"","tag":"","texture_new":""},"buildState":{"item":"","itemRank":0,"orokin":false,"mods":[]},"guideMarkdown":"","itemBuilds":[],"authorBuilds":[]}}}
    </script>
    </body></html>`;

  it("parses and caches a valid build page", async () => {
    let requests = 0;
    const fetcher = (() => {
      requests += 1;
      return Promise.resolve(htmlResponse(buildPageHtml));
    }) as typeof fetch;

    const first = await getBuildDetail(1, fetcher);
    const second = await getBuildDetail(1, fetcher);

    expect(first?.data.id).toBe(1);
    expect(second).toBe(first);
    expect(requests).toBe(1);
  });

  it("raises OverframeParseDriftError instead of returning null for malformed __NEXT_DATA__", async () => {
    const malformed = '<html><script id="__NEXT_DATA__" type="application/json">{not json}</script></html>';
    const fetcher = (() => Promise.resolve(htmlResponse(malformed))) as typeof fetch;
    await expect(getBuildDetail(1, fetcher)).rejects.toThrow(OverframeParseDriftError);
  });

  it("raises OverframeParseDriftError when pageProps.data is missing", async () => {
    const noData = '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></html>';
    const fetcher = (() => Promise.resolve(htmlResponse(noData))) as typeof fetch;
    await expect(getBuildDetail(1, fetcher)).rejects.toThrow(OverframeParseDriftError);
  });
});

// Suppress the structured console.error emitted by the drift path so the test
// runner output stays clean.
vi.spyOn(console, "error").mockImplementation(() => {});
