// ─── Legacy HTTP session registry ────────────────────────────────────────────
//
// Tracks MCP Streamable HTTP sessions for the legacy Node entrypoint and
// expires idle ones. The registry is HTTP-framework agnostic: it stores opaque
// transport-like objects that expose `close(): Promise<void>` and an optional
// `sessionId`, so it can be unit-tested without Express.

/** Minimal transport shape the registry depends on. */
export interface SessionTransport {
  close(): Promise<void>;
  readonly sessionId?: string;
}

interface SessionEntry<T extends SessionTransport> {
  transport: T;
  lastSeenAt: number;
}

export interface SessionRegistryOptions {
  /** Maximum idle time before a session is swept, in milliseconds. */
  idleTimeoutMs?: number;
  /** Clock used for "now"; defaults to Date.now. */
  nowMs?: () => number;
  /**
   * Sweep interval, in milliseconds. Should be substantially smaller than
   * idleTimeoutMs. Defaults to idleTimeoutMs / 4.
   */
  sweepIntervalMs?: number;
  /**
   * Scheduler used for the sweep timer. In production this is `setInterval`;
   * tests can inject a stub. The returned handle is passed to `clearTimer`.
   */
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  /** Clears a handle previously produced by `setTimer`. */
  clearTimer?: (handle: unknown) => void;
  /** Sink for diagnostic logs; defaults to console.error. */
  log?: (message: string) => void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const MIN_IDLE_TIMEOUT_MS = 1_000;

function defaultLog(message: string): void {
  console.error(message);
}

/**
 * In-memory registry of active MCP sessions. Each session records the last time
 * it was seen; a periodic sweep closes and removes sessions that have been idle
 * longer than `idleTimeoutMs`.
 *
 * The sweep timer is created with `.unref()` semantics in production so it
 * cannot keep the Node process alive on its own.
 */
export class SessionRegistry<T extends SessionTransport = SessionTransport> {
  private readonly idleTimeoutMs: number;
  private readonly nowMs: () => number;
  private readonly sweepIntervalMs: number;
  private readonly setTimer: (handler: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly log: (message: string) => void;
  private readonly sessions = new Map<string, SessionEntry<T>>();
  private timerHandle: unknown;
  private closed = false;

  constructor(options: SessionRegistryOptions = {}) {
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < MIN_IDLE_TIMEOUT_MS) {
      throw new Error(
        `idleTimeoutMs must be a finite number >= ${MIN_IDLE_TIMEOUT_MS} (got ${idleTimeoutMs})`,
      );
    }
    this.idleTimeoutMs = idleTimeoutMs;
    this.nowMs = options.nowMs ?? Date.now;
    this.sweepIntervalMs = options.sweepIntervalMs ?? Math.max(1_000, Math.floor(idleTimeoutMs / 4));
    this.setTimer = options.setTimer ?? ((handler, delayMs) => {
      const handle = setInterval(handler, delayMs);
      // .unref() so a forgotten sweep timer cannot keep the process alive.
      if (typeof handle === "object" && handle && "unref" in handle && typeof (handle as NodeJS.Timeout).unref === "function") {
        (handle as NodeJS.Timeout).unref();
      }
      return handle;
    });
    this.clearTimer = options.clearTimer ?? ((handle) => {
      if (handle && typeof (handle as NodeJS.Timeout).unref === "function") {
        clearInterval(handle as NodeJS.Timeout);
      }
    });
    this.log = options.log ?? defaultLog;

    this.startSweep();
  }

  /** Number of currently tracked sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Returns the session ids currently tracked. */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Returns the transport for an active, non-expired session, or undefined. */
  get(sessionId: string): T | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    if (this.nowMs() - entry.lastSeenAt > this.idleTimeoutMs) {
      // Lazily expire on read so a stale session cannot be reused before sweep.
      return undefined;
    }
    return entry.transport;
  }

  /** Returns true if the session exists and has not expired. */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * Register a new session or refresh the last-seen timestamp of an existing
   * one. Idempotent for the same sessionId.
   */
  touch(sessionId: string, transport: T): void {
    if (this.closed) {
      throw new Error("SessionRegistry is shut down");
    }
    this.sessions.set(sessionId, { transport, lastSeenAt: this.nowMs() });
  }

  /** Mark activity on an existing session without changing its transport. */
  refresh(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    entry.lastSeenAt = this.nowMs();
    return true;
  }

  /**
   * Remove a session immediately and close its transport exactly once. Safe to
   * call for an unknown or already-removed session. Swallows close errors after
   * logging them so one failing transport cannot break the sweep.
   */
  async delete(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    await this.closeTransportSafely(sessionId, entry.transport);
  }

  /** Close and remove every active session, then stop sweeping. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopSweep();

    const entries = [...this.sessions.entries()];
    this.sessions.clear();
    await Promise.all(
      entries.map(([id, entry]) => this.closeTransportSafely(id, entry.transport)),
    );
  }

  /**
   * Run one sweep cycle: close and remove every session whose idle window has
   * elapsed. Exposed for unit tests and explicit triggers; production callers
   * normally let the periodic timer invoke it.
   */
  async sweepOnce(): Promise<void> {
    const now = this.nowMs();
    const expired: Array<[string, T]> = [];
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastSeenAt > this.idleTimeoutMs) {
        expired.push([id, entry.transport]);
      }
    }
    for (const [id] of expired) {
      this.sessions.delete(id);
    }
    for (const [id, transport] of expired) {
      await this.closeTransportSafely(id, transport);
    }
  }

  private startSweep(): void {
    if (this.sweepIntervalMs <= 0) return;
    this.timerHandle = this.setTimer(() => {
      this.sweepOnce().catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.log(`[http] session sweep error: ${detail}`);
      });
    }, this.sweepIntervalMs);
  }

  private stopSweep(): void {
    if (this.timerHandle !== undefined) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  private async closeTransportSafely(id: string, transport: T): Promise<void> {
    try {
      await transport.close();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`[http] error closing session ${id}: ${detail}`);
    }
  }
}

/**
 * Resolve the configured idle timeout from the MCP_SESSION_IDLE_TIMEOUT_MS env
 * variable, falling back to the default when unset or unparsable. Exposed so the
 * entrypoint and tests share the same parsing rules.
 */
export function resolveIdleTimeoutMs(
  envValue: string | undefined,
  fallback = DEFAULT_IDLE_TIMEOUT_MS,
): number {
  if (envValue === undefined || envValue === "") return fallback;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed < MIN_IDLE_TIMEOUT_MS) {
    return fallback;
  }
  return Math.floor(parsed);
}
