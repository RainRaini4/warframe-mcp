import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

test("creates the MCP server and returns tools/list", async () => {
  const client = new Client({
    name: "warframe-mcp-test",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });

  await client.connect(transport);

  try {
    const result = await client.listTools();

    assert.ok(Array.isArray(result.tools));
    assert.ok(result.tools.length > 0);
    assert.ok(result.tools.every((tool) => typeof tool.name === "string"));
  } finally {
    await client.close();
  }
});
