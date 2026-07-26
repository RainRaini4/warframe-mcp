import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal smoke tests that prove the Node-runtime Vitest configuration
// (`vitest.node.config.ts`) supports the primitives the legacy unit tests rely
// on: controllable timers and a stubbable global `fetch`. Real legacy coverage
// lands in the task-specific test files under `test/node/`.
describe("node test runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("supports fake timers and a controllable clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(Date.now()).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("supports fetch mocks via vi.stubGlobal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))),
    );

    const response = await fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetch).toHaveBeenCalledWith("https://example.com/");
  });
});
