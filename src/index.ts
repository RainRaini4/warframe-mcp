import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  SessionRegistry,
  resolveIdleTimeoutMs,
  type SessionTransport,
} from "./http/session-registry.js";
import { registerWorldstateTools } from "./tools/worldstate.js";
import { registerItemTools } from "./tools/items.js";
import { registerMarketTools } from "./tools/market.js";
import { registerDropTools } from "./tools/drops.js";
import { registerPrimeVaultTools } from "./tools/primeVault.js";
import { registerSimarisTools } from "./tools/simaris.js";
import { registerEnemyTools } from "./tools/enemy.js";
import { registerBuildTools } from "./tools/builds.js";
import { registerCraftingTools } from "./tools/crafting.js";
import { registerFarmOptimizerTools } from "./tools/farmOptimizer.js";
import { registerSynergyTools } from "./tools/synergy.js";
import { registerColorTools } from "./tools/colors.js";

// ─── Server factory ──────────────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: "warframe-mcp",
    version: "1.0.0",
  });

  registerWorldstateTools(server);
  registerItemTools(server);
  registerMarketTools(server);
  registerDropTools(server);
  registerPrimeVaultTools(server);
  registerSimarisTools(server);
  registerEnemyTools(server);
  registerBuildTools(server);
  registerCraftingTools(server);
  registerFarmOptimizerTools(server);
  registerSynergyTools(server);
  registerColorTools(server);

  return server;
}

// ─── Transport selection ─────────────────────────────────────────────────────

const useHttp = process.argv.includes("--http");

if (useHttp) {
  // ── Streamable HTTP transport ──────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "127.0.0.1";

  // Build allowed hosts list for DNS rebinding protection.
  // When binding to 0.0.0.0 / ::, allow localhost + any hosts from ALLOWED_HOSTS env.
  // Example: HOST=0.0.0.0 ALLOWED_HOSTS=192.168.1.112,mypc.local
  const allowedHosts: string[] | undefined =
    host === "0.0.0.0" || host === "::"
      ? [
          "localhost",
          "127.0.0.1",
          "::1",
          ...(process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? []),
        ]
      : undefined; // default localhost-only validation

  const app = createMcpExpressApp({ host, allowedHosts });

  // Idle session expiration for the legacy HTTP server. The stateless Worker
  // endpoint (/mcp) does not store HTTP sessions, so this never runs there.
  const idleTimeoutMs = resolveIdleTimeoutMs(process.env.MCP_SESSION_IDLE_TIMEOUT_MS);
  const sessions = new SessionRegistry<SessionTransport>({ idleTimeoutMs });
  console.error(`[http] MCP session idle timeout: ${idleTimeoutMs} ms`);

  // Track a StreamableHTTPServerTransport as an active session.
  function registerTransport(id: string, transport: StreamableHTTPServerTransport): void {
    sessions.touch(id, transport as unknown as SessionTransport);
    console.error(`[http] Session initialized: ${id}`);
  }

  // POST /mcp — JSON-RPC requests + session initialization
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      // Reuse existing session. An unknown or already-expired id is treated as a
      // terminated MCP session and reported with 404 to match the SDK contract.
      if (sessionId) {
        const transport = sessions.get(sessionId) as StreamableHTTPServerTransport | undefined;
        if (!transport) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Session not found or expired. Send an initialize request to start a new session.",
            },
            id: null,
          });
          return;
        }
        sessions.refresh(sessionId);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — must be an initialize request
      if (isInitializeRequest(req.body)) {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id: string): void => registerTransport(id, transport),
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (!sid) return;
          console.error(`[http] Session closed: ${sid}`);
          // Best-effort removal; the registry tolerates unknown ids.
          void sessions.delete(sid);
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Bad request
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
    } catch (err) {
      console.error("[http] Error handling POST /mcp:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET /mcp — SSE stream for server→client notifications
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId
      ? (sessions.get(sessionId) as StreamableHTTPServerTransport | undefined)
      : undefined;
    if (!sessionId || !transport) {
      res.status(404).send("Invalid, missing, or expired session ID");
      return;
    }
    sessions.refresh(sessionId);
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — session termination
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId
      ? (sessions.get(sessionId) as StreamableHTTPServerTransport | undefined)
      : undefined;
    if (!sessionId || !transport) {
      res.status(404).send("Invalid, missing, or expired session ID");
      return;
    }
    await transport.handleRequest(req, res);
    // Delete immediately rather than waiting for the next sweep; the registry
    // closes the transport exactly once.
    await sessions.delete(sessionId);
  });

  const httpServer = app.listen(port, host, () => {
    const addr = host === "0.0.0.0" || host === "::" ? `<all interfaces>:${port}` : `${host}:${port}`;
    console.error(`[http] Warframe MCP server listening on http://${addr}/mcp`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[http] ERROR: Port ${port} is already in use. Set a different port with PORT=<number>`);
    } else {
      console.error("[http] Server error:", err.message);
    }
    process.exit(1);
  });

  // Graceful shutdown: stop sweeping, close active transports, then close HTTP.
  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("[http] Shutting down...");
    await sessions.shutdown();
    httpServer.close();
    process.exit(0);
  }
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
} else {
  // ── Stdio transport (default) ─────────────────────────────────────────────
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
