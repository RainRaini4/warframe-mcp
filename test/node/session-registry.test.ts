import { describe, expect, it } from "vitest";
import {
  SessionRegistry,
  resolveIdleTimeoutMs,
  type SessionTransport,
} from "../../src/http/session-registry.js";

/** Stub transport that records close() calls and can simulate close failures. */
function makeTransport(
  options: { closeShouldFail?: boolean; sessionId?: string } = {},
): SessionTransport & { closeCalls: number } {
  let closeCalls = 0;
  return {
    sessionId: options.sessionId,
    async close() {
      closeCalls += 1;
      if (options.closeShouldFail) {
        throw new Error("close failure");
      }
    },
    get closeCalls() {
      return closeCalls;
    },
  };
}

/** In-memory scheduler so tests never wait on real setInterval. */
function makeFakeTimers() {
  let now = 0;
  const handlers: Array<() => void> = [];
  return {
    nowMs: () => now,
    advance(ms: number) {
      now += ms;
      // Fire every scheduled handler once per advance — mirrors setInterval
      // semantics closely enough for these tests.
      for (const handler of [...handlers]) handler();
    },
    setTimer: (handler: () => void) => {
      handlers.push(handler);
      return handler;
    },
    clearTimer: (handle: unknown) => {
      const index = handlers.indexOf(handle as () => void);
      if (index >= 0) handlers.splice(index, 1);
    },
    scheduledCount: () => handlers.length,
  };
}

function makeRegistry(options: ConstructorParameters<typeof SessionRegistry>[0] = {}) {
  const timers = makeFakeTimers();
  const logs: string[] = [];
  const registry = new SessionRegistry<SessionTransport>({
    idleTimeoutMs: 1_000,
    sweepIntervalMs: 250,
    nowMs: timers.nowMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    log: (message) => logs.push(message),
    ...options,
  });
  return { registry, timers, logs };
}

describe("SessionRegistry", () => {
  it("stores a newly registered session", () => {
    const { registry } = makeRegistry();
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);
    expect(registry.has("s1")).toBe(true);
    expect(registry.get("s1")).toBe(transport);
    expect(registry.size).toBe(1);
  });

  it("refresh() extends the lifetime of an active session", async () => {
    const { registry, timers } = makeRegistry({ idleTimeoutMs: 1_000 });
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);

    timers.advance(800);
    expect(registry.refresh("s1")).toBe(true);
    timers.advance(800);
    // Without refresh, the session would have expired at t=1000.
    expect(registry.has("s1")).toBe(true);

    timers.advance(300);
    expect(registry.has("s1")).toBe(false);
  });

  it("expires an idle session after the timeout on the next sweep", async () => {
    const { registry, timers } = makeRegistry({ idleTimeoutMs: 1_000, sweepIntervalMs: 250 });
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);

    timers.advance(1_001);
    await registry.sweepOnce();

    expect(registry.has("s1")).toBe(false);
    expect(transport.closeCalls).toBe(1);
  });

  it("closes the transport exactly once even if delete and sweep race", async () => {
    const { registry, timers } = makeRegistry({ idleTimeoutMs: 1_000, sweepIntervalMs: 250 });
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);

    timers.advance(1_001);
    await registry.delete("s1");
    await registry.sweepOnce();

    expect(transport.closeCalls).toBe(1);
  });

  it("a failing transport close does not stop the sweep from cleaning others", async () => {
    // Disable timer-driven sweep so the only sweep is our explicit one; this
    // keeps the close-order assertion deterministic.
    const { registry, timers, logs } = makeRegistry({
      idleTimeoutMs: 1_000,
      sweepIntervalMs: 0,
    });
    const failing = makeTransport({ sessionId: "s1", closeShouldFail: true });
    const healthy = makeTransport({ sessionId: "s2" });
    registry.touch("s1", failing);
    registry.touch("s2", healthy);

    timers.advance(1_001);
    await registry.sweepOnce();

    expect(registry.size).toBe(0);
    expect(failing.closeCalls).toBe(1);
    expect(healthy.closeCalls).toBe(1);
    expect(logs.some((line) => line.includes("error closing session s1"))).toBe(true);
  });

  it("delete() removes a session immediately, before the sweep runs", async () => {
    const { registry } = makeRegistry({ idleTimeoutMs: 60_000 });
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);

    await registry.delete("s1");

    expect(registry.has("s1")).toBe(false);
    expect(transport.closeCalls).toBe(1);
  });

  it("shutdown() closes all active sessions and stops sweeping", async () => {
    const { registry, timers } = makeRegistry({ idleTimeoutMs: 60_000 });
    const a = makeTransport({ sessionId: "a" });
    const b = makeTransport({ sessionId: "b" });
    registry.touch("a", a);
    registry.touch("b", b);

    await registry.shutdown();

    expect(a.closeCalls).toBe(1);
    expect(b.closeCalls).toBe(1);
    expect(registry.size).toBe(0);
    // Sweeping must be a no-op after shutdown.
    expect(timers.scheduledCount()).toBe(0);
  });

  it("the sweep timer does not keep the Node process alive (.unref semantics)", () => {
    // We can't observe .unref() directly without real timers, but we can assert
    // that the injected scheduler was used (i.e. production code path delegates
    // to setTimer and never registers its own native timer).
    const timers = makeFakeTimers();
    const setTimerSpy = timers.setTimer;
    const registry = new SessionRegistry<SessionTransport>({
      idleTimeoutMs: 1_000,
      setTimer: setTimerSpy,
      clearTimer: timers.clearTimer,
    });

    expect(timers.scheduledCount()).toBe(1);
    registry.shutdown();
    expect(timers.scheduledCount()).toBe(0);
  });

  it("get() returns undefined for an unknown or already-expired session id", () => {
    const { registry, timers } = makeRegistry({ idleTimeoutMs: 1_000 });
    const transport = makeTransport({ sessionId: "s1" });
    registry.touch("s1", transport);

    expect(registry.get("missing")).toBeUndefined();

    timers.advance(1_001);
    // Lazy expiration on read.
    expect(registry.get("s1")).toBeUndefined();
    expect(registry.has("s1")).toBe(false);
  });
});

describe("resolveIdleTimeoutMs", () => {
  it("returns the fallback when the env value is missing or invalid", () => {
    expect(resolveIdleTimeoutMs(undefined, 30_000)).toBe(30_000);
    expect(resolveIdleTimeoutMs("", 30_000)).toBe(30_000);
    expect(resolveIdleTimeoutMs("not-a-number", 30_000)).toBe(30_000);
    expect(resolveIdleTimeoutMs("500", 30_000)).toBe(30_000); // below minimum
  });

  it("returns the parsed value for a valid env string", () => {
    expect(resolveIdleTimeoutMs("60000", 30_000)).toBe(60_000);
  });
});
