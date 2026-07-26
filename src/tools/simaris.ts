import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ws from "../api/warframestat.js";
import { normalizeWorldstatePlatform, WORLDSTATE_PLATFORM_VALUES } from "../utils/platform.js";

export function registerSimarisTools(server: McpServer): void {
  server.tool(
    "simaris_target",
    "Check today's Cephalon Simaris synthesis target and recommended scanning locations.",
    {
      platform: z
        .enum(WORLDSTATE_PLATFORM_VALUES)
        .default("pc")
        .optional()
        .describe(
          "Game platform. Canonical values: pc, ps4, xbox, switch. Legacy aliases accepted: xb1 → xbox, swi/ns → switch, psn → ps4.",
        ),
    },
    async (args) => {
      try {
        const platform = normalizeWorldstatePlatform(args.platform ?? "pc");
        const simaris = await ws.getSimaris(platform);

        if (!simaris.target || simaris.target === "") {
          return {
            content: [
              {
                type: "text",
                text: "=== CEPHALON SIMARIS SYNTHESIS TARGET ===\nNo active target at this time.",
              },
            ],
          };
        }

        const lines: string[] = [
          "=== CEPHALON SIMARIS SYNTHESIS TARGET ===",
          `Today's Target: ${simaris.target}`,
          `Status: ${simaris.isTargetActive ? "Active for scanning" : "Inactive"}`,
        ];

        // Find where this enemy spawns
        const [dropResults, solNodeResults] = await Promise.allSettled([
          ws.searchDrops(simaris.target),
          ws.searchSolNodes(simaris.target),
        ]);

        const missionNodes: Array<{ node: string; type?: string; enemy?: string }> = [];

        // From drop tables — only real mission nodes (contain "/" and "()")
        if (dropResults.status === "fulfilled") {
          const drops = dropResults.value;
          for (const d of drops) {
            if (/relic(\s*\(|$)/i.test(d.place)) continue;
            if (d.place.includes("/") && d.place.includes("(")) {
              if (!missionNodes.some((n) => n.node === d.place)) {
                missionNodes.push({ node: d.place });
              }
            }
          }
        }

        // From sol nodes
        if (solNodeResults.status === "fulfilled") {
          const results = solNodeResults.value;
          for (const result of results) {
            for (const node of result.nodes) {
              if (!missionNodes.some((n) => n.node === node.value)) {
                missionNodes.push({
                  node: node.value,
                  type: node.type,
                  enemy: node.enemy,
                });
              }
            }
          }
        }

        if (missionNodes.length > 0) {
          // Prefer non-endless missions for scanning
          const preferred = ["Exterminate", "Capture", "Spy", "Rescue"];
          const sorted = [...missionNodes].sort((a, b) => {
            const aIdx = preferred.findIndex(
              (p) => a.type?.includes(p) ?? false
            );
            const bIdx = preferred.findIndex(
              (p) => b.type?.includes(p) ?? false
            );
            const aScore = aIdx >= 0 ? aIdx : 99;
            const bScore = bIdx >= 0 ? bIdx : 99;
            return aScore - bScore;
          });

          lines.push("\nRECOMMENDED NODES:");
          sorted.slice(0, 8).forEach((n) => {
            const typePart = n.type ? `, ${n.type}` : "";
            const enemyPart = n.enemy ? `, ${n.enemy}` : "";
            lines.push(`  • ${n.node}${typePart ? ` —${typePart}${enemyPart}` : ""}`);
          });
        }

        lines.push("\nSYNTHESIS TIPS:");
        lines.push("  • Use Synthesis Scanner (not Codex Scanner)");
        lines.push("  • Carrier with Investigator precept auto-scans");
        lines.push("  • 5,000 Simaris standing per full synthesis (4 scans)");

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error fetching Simaris target: ${msg}\n\nThe API may be temporarily unavailable. Try again in a moment.`,
            },
          ],
        };
      }
    }
  );
}
