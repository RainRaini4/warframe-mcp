import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ws from "../api/warframestat.js";
import * as market from "../api/warframe-market.js";
import * as fmt from "../utils/formatting.js";
import { normalizeWorldstatePlatform, WORLDSTATE_PLATFORM_VALUES } from "../utils/platform.js";
import type { Invasion, NightwaveChallenge } from "../types/index.js";

export function registerWorldstateTools(server: McpServer): void {
  // ─── world_state ──────────────────────────────────────────────────────────
  server.tool(
    "world_state",
    "Get current Warframe world state: sortie, archon hunt, nightwave, invasions, open world cycles, events, steel path, construction progress, and daily deals.",
    {
      platform: z
        .enum(WORLDSTATE_PLATFORM_VALUES)
        .default("pc")
        .optional()
        .describe(
          "Game platform. Canonical values: pc, ps4, xbox, switch. Legacy aliases accepted: xb1 → xbox, swi/ns → switch, psn → ps4. mobile is not supported by this upstream.",
        ),
      sections: z
        .array(
          z.enum([
            "sortie",
            "archon_hunt",
            "nightwave",
            "invasions",
            "cycles",
            "events",
            "steel_path",
            "construction",
            "daily_deals",
          ])
        )
        .optional()
        .describe("Sections to include (default: all)"),
    },
    async (args) => {
      try {
        const platform = normalizeWorldstatePlatform(args.platform ?? "pc");
        const allSections = [
          "cycles",
          "sortie",
          "archon_hunt",
          "nightwave",
          "steel_path",
          "invasions",
          "events",
          "daily_deals",
          "construction",
        ];
        const sections = args.sections ?? allSections;
        const lines: string[] = [
          `=== WARFRAME WORLD STATE (${platform.toUpperCase()}) ===`,
          `Updated: ${new Date().toISOString()}`,
        ];

        // Build fetchers map
        type SectionFetcher = () => Promise<string>;
        const fetchers: Record<string, SectionFetcher> = {};

        if (sections.includes("cycles")) {
          fetchers["cycles"] = async () => {
            const [cetus, vallis, cambion, earth] = await Promise.allSettled([
              ws.getCetusCycle(platform),
              ws.getVallisCycle(platform),
              ws.getCambionCycle(platform),
              ws.getEarthCycle(platform),
            ]);
            const out: string[] = ["\n--- OPEN WORLD CYCLES ---"];
            if (cetus.status === "fulfilled") {
              const c = cetus.value;
              out.push(
                `Plains of Eidolon (Cetus): ${c.state.toUpperCase()} — ${c.timeLeft ?? fmt.timeRemaining(c.expiry)} remaining`
              );
            } else out.push("Plains of Eidolon: data unavailable");

            if (vallis.status === "fulfilled") {
              const v = vallis.value;
              out.push(
                `Orb Vallis (Fortuna): ${v.state.toUpperCase()} — ${fmt.timeRemaining(v.expiry)} remaining`
              );
            } else out.push("Orb Vallis: data unavailable");

            if (cambion.status === "fulfilled") {
              const cb = cambion.value;
              out.push(
                `Cambion Drift (Necralisk): ${cb.state.toUpperCase()} — ${cb.timeLeft ?? fmt.timeRemaining(cb.expiry)} remaining`
              );
            } else out.push("Cambion Drift: data unavailable");

            if (earth.status === "fulfilled") {
              const e = earth.value;
              out.push(
                `Earth: ${e.state.toUpperCase()} — ${e.timeLeft ?? fmt.timeRemaining(e.expiry)} remaining`
              );
            } else out.push("Earth: data unavailable");

            return out.join("\n");
          };
        }

        if (sections.includes("sortie")) {
          fetchers["sortie"] = async () => {
            const sortie = await ws.getSortie(platform);
            const faction = sortie.factionKey ?? sortie.faction;
            const out: string[] = [
              `\n--- DAILY SORTIE (${faction} | ${sortie.boss}) ---`,
            ];
            sortie.variants.forEach((v, i) => {
              // Prefer English *Key fields over potentially-localized fields
              const mType = v.missionTypeKey ?? v.missionType;
              const node = v.nodeKey ?? v.node;
              const mod = v.modifierDescription ?? v.modifier;
              out.push(
                `  ${i + 1}. ${mType} — ${node} | Modifier: ${mod}`
              );
            });
            out.push(`Resets in: ${fmt.timeRemaining(sortie.expiry)}`);
            return out.join("\n");
          };
        }

        if (sections.includes("archon_hunt")) {
          fetchers["archon_hunt"] = async () => {
            const archon = await ws.getArchonHunt(platform);
            const faction = archon.factionKey ?? archon.faction;
            const out: string[] = [
              `\n--- ARCHON HUNT (${faction} | ${archon.boss}) ---`,
            ];
            archon.missions.forEach((m, i) => {
              const mType = m.typeKey ?? m.type;
              const node = m.nodeKey ?? m.node;
              out.push(`  ${i + 1}. ${mType} — ${node}`);
            });
            out.push(`Resets in: ${fmt.timeRemaining(archon.expiry)}`);
            return out.join("\n");
          };
        }

        if (sections.includes("nightwave")) {
          fetchers["nightwave"] = async () => {
            const nw = await ws.getNightwave(platform);
            const tagName =
              nw.tag
                ?.replace(/Syndicate$/, "")
                .replace(/Intermission\d+/, "Intermission")
                .trim() ?? `Season ${nw.season}`;
            const out: string[] = [
              `\n--- NIGHTWAVE: ${tagName} (Season ${nw.season}) ---`,
            ];

            const challenges = nw.activeChallenges ?? [];
            const daily = challenges.filter(
              (c: NightwaveChallenge) => c.isDaily
            );
            const elite = challenges.filter(
              (c: NightwaveChallenge) => !c.isDaily && c.isElite
            );
            const weekly = challenges.filter(
              (c: NightwaveChallenge) =>
                !c.isDaily && !c.isElite && !c.isPermanent
            );
            const permanent = challenges.filter(
              (c: NightwaveChallenge) => c.isPermanent
            );

            if (daily.length > 0) {
              out.push("  Daily:");
              daily.forEach((c: NightwaveChallenge) => {
                out.push(
                  `    • ${c.title} — ${c.desc} (${fmt.formatNumber(c.reputation)} rep) — expires in ${fmt.timeRemaining(c.expiry)}`
                );
              });
            }
            if (weekly.length > 0) {
              out.push("  Weekly:");
              weekly.forEach((c: NightwaveChallenge) => {
                out.push(
                  `    • ${c.title} — ${c.desc} (${fmt.formatNumber(c.reputation)} rep) — expires in ${fmt.timeRemaining(c.expiry)}`
                );
              });
            }
            if (elite.length > 0) {
              out.push("  Elite Weekly:");
              elite.forEach((c: NightwaveChallenge) => {
                out.push(
                  `    • ${c.title} — ${c.desc} (${fmt.formatNumber(c.reputation)} rep)`
                );
              });
            }
            if (permanent.length > 0) {
              out.push("  Recovered:");
              permanent.forEach((c: NightwaveChallenge) => {
                out.push(
                  `    • ${c.title} — ${c.desc} (${fmt.formatNumber(c.reputation)} rep)`
                );
              });
            }
            return out.join("\n");
          };
        }

        if (sections.includes("steel_path")) {
          fetchers["steel_path"] = async () => {
            const sp = await ws.getSteelPath(platform);
            const out: string[] = ["\n--- STEEL PATH HONORS ---"];
            out.push(
              `  Current Rotating Reward: ${sp.currentReward.name} (${sp.currentReward.cost} Steel Essence)`
            );
            out.push(`  Resets in: ${sp.remaining ?? fmt.timeRemaining(sp.expiry)}`);
            return out.join("\n");
          };
        }

        if (sections.includes("invasions")) {
          fetchers["invasions"] = async () => {
            const invasions = await ws.getInvasions(platform);
            const active = invasions.filter((inv: Invasion) => !inv.completed);
            if (active.length === 0) return "\n--- ACTIVE INVASIONS ---\n  No active invasions.";

            const out: string[] = ["\n--- ACTIVE INVASIONS ---"];
            active.forEach((inv: Invasion) => {
              out.push(
                `  • ${inv.node}: ${inv.attacker.faction} vs ${inv.defender.faction} — ${inv.completion.toFixed(1)}% complete`
              );
              const attackerRewards = formatInvasionRewards(inv.attacker.reward);
              const defenderRewards = formatInvasionRewards(inv.defender.reward);
              if (attackerRewards)
                out.push(`    Attacker (${inv.attacker.faction}): ${attackerRewards}`);
              if (defenderRewards)
                out.push(`    Defender (${inv.defender.faction}): ${defenderRewards}`);
            });
            return out.join("\n");
          };
        }

        if (sections.includes("events")) {
          fetchers["events"] = async () => {
            const events = await ws.getEvents(platform);
            if (!events || events.length === 0) return "";
            const out: string[] = ["\n--- ACTIVE EVENTS ---"];
            events.forEach((ev) => {
              out.push(
                `  • ${ev.description} — ${ev.node ?? "Various locations"} — expires ${ev.expiry?.substring(0, 10) ?? "unknown"}`
              );
              if (ev.health !== undefined && ev.health !== null) {
                out.push(`    Progress: ${ev.health}/100`);
              }
              const finalRewards = ev.rewards
                ?.flatMap((r) => [...(r.items ?? []), ...(r.countedItems?.map((ci) => ci.type) ?? [])])
                .filter(Boolean);
              if (finalRewards && finalRewards.length > 0) {
                out.push(`    Final reward: ${finalRewards.join(", ")}`);
              }
            });
            return out.join("\n");
          };
        }

        if (sections.includes("daily_deals")) {
          fetchers["daily_deals"] = async () => {
            const deals = await ws.getDailyDeals(platform);
            if (!deals || deals.length === 0) return "";
            const out: string[] = ["\n--- DARVO DAILY DEALS ---"];
            deals.forEach((d) => {
              out.push(
                `  • ${d.item} — ${d.salePrice}p (was ${d.originalPrice}p, ${d.discount}% off) — ${d.sold}/${d.total} sold — expires ${d.expiry?.substring(0, 10) ?? "unknown"}`
              );
            });
            return out.join("\n");
          };
        }

        if (sections.includes("construction")) {
          fetchers["construction"] = async () => {
            const cp = await ws.getConstructionProgress(platform);
            return `\n--- CONSTRUCTION PROGRESS ---\n  Fomorian: ${cp.fomorianProgress}%  |  Razorback: ${cp.razorbackProgress}%`;
          };
        }

        // Execute all fetchers in parallel
        const keys = Object.keys(fetchers);
        const results = await Promise.allSettled(
          keys.map((k) => fetchers[k]())
        );

        // Maintain section order
        const orderedSections = [
          "cycles",
          "sortie",
          "archon_hunt",
          "nightwave",
          "steel_path",
          "invasions",
          "events",
          "daily_deals",
          "construction",
        ];
        for (const section of orderedSections) {
          const idx = keys.indexOf(section);
          if (idx === -1) continue;
          const result = results[idx];
          if (result.status === "fulfilled" && result.value) {
            lines.push(result.value);
          } else if (result.status === "rejected") {
            const sectionName = section.replace(/_/g, " ").toUpperCase();
            lines.push(`\n--- ${sectionName} ---\n  Data unavailable`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error fetching world state: ${msg}\n\nThe API may be temporarily unavailable. Try again in a moment.`,
            },
          ],
        };
      }
    }
  );

  // ─── baro_kiteer ──────────────────────────────────────────────────────────
  server.tool(
    "baro_kiteer",
    "Check Baro Ki'Teer's current status, inventory, and optional plat-per-ducat worth analysis.",
    {
      platform: z
        .enum(WORLDSTATE_PLATFORM_VALUES)
        .default("pc")
        .optional()
        .describe(
          "Game platform. Canonical values: pc, ps4, xbox, switch. Legacy aliases accepted: xb1 → xbox, swi/ns → switch, psn → ps4.",
        ),
      show_worth_analysis: z
        .boolean()
        .default(true)
        .optional()
        .describe("Show plat/ducat value analysis for each item"),
    },
    async (args) => {
      try {
        const platform = normalizeWorldstatePlatform(args.platform ?? "pc");
        const showWorth = args.show_worth_analysis ?? true;
        const baro = await ws.getVoidTrader(platform);
        const active = fmt.isActive(baro.activation, baro.expiry);

        if (!active) {
          const lines = [
            "=== BARO KI'TEER — NOT CURRENTLY ACTIVE ===",
            `Next arrival: ${baro.activation} (${fmt.timeUntil(baro.activation)} from now)`,
            `Last known location: ${baro.location}`,
            "",
            "Baro Ki'Teer visits every 2 weeks, staying for 48 hours.",
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        const lines = [
          "=== BARO KI'TEER — CURRENTLY ACTIVE ===",
          `Location: ${baro.location}`,
          `Departs in: ${fmt.timeRemaining(baro.expiry)}`,
        ];

        if (!baro.inventory || baro.inventory.length === 0) {
          lines.push("\nNo inventory data available yet.");
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        // Categorize items
        const primedMods = baro.inventory.filter(
          (i) => i.ducats > 0 && i.credits > 0
        );
        const decorations = baro.inventory.filter(
          (i) => i.ducats === 0 || i.credits === 0
        );

        if (primedMods.length > 0) {
          lines.push("\nPRIMED MODS / EQUIPMENT:");
          for (const item of primedMods) {
            let line = `  • ${item.item} — ${item.ducats} ducats + ${fmt.formatNumber(item.credits)} credits`;

            if (showWorth && item.ducats > 50) {
              try {
                const priceResult = await market.priceCheck(item.item, {
                  onlineOnly: true,
                });
                const medianPlat = priceResult.sell.median;
                if (medianPlat > 0) {
                  const ratio = medianPlat / item.ducats;
                  let verdict: string;
                  if (ratio > 1.0) verdict = "✓ Good value";
                  else if (ratio >= 0.3) verdict = "~ Decent";
                  else verdict = "⚠ Low value";
                  line += `\n    Market: ~${medianPlat}p median — ${ratio.toFixed(2)} plat/ducat ${verdict}`;
                }
              } catch {
                // Item not on market — silently skip
              }
            }
            lines.push(line);
          }
        }

        if (decorations.length > 0) {
          lines.push("\nCOSMETICS / DECORATIONS:");
          decorations.forEach((item) => {
            lines.push(
              `  • ${item.item} — ${item.ducats} ducats + ${item.credits ?? 0} credits`
            );
          });
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error fetching Baro Ki'Teer data: ${msg}\n\nThe API may be temporarily unavailable. Try again in a moment.`,
            },
          ],
        };
      }
    }
  );

  // ─── active_fissures ──────────────────────────────────────────────────────
  server.tool(
    "active_fissures",
    "List active Void Fissure missions, filterable by tier, Steel Path, Void Storm, and mission type.",
    {
      platform: z
        .enum(WORLDSTATE_PLATFORM_VALUES)
        .default("pc")
        .optional()
        .describe(
          "Game platform. Canonical values: pc, ps4, xbox, switch. Legacy aliases accepted: xb1 → xbox, swi/ns → switch, psn → ps4.",
        ),
      tier: z
        .enum(["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"])
        .optional()
        .describe("Filter by relic tier"),
      steel_path: z
        .boolean()
        .optional()
        .describe("Filter for Steel Path fissures"),
      void_storm: z
        .boolean()
        .optional()
        .describe("Filter for Void Storm (Railjack) fissures"),
      mission_type: z
        .string()
        .optional()
        .describe("Filter by mission type (case-insensitive contains)"),
    },
    async (args) => {
      try {
        const platform = normalizeWorldstatePlatform(args.platform ?? "pc");
        let fissures = await ws.getFissures(platform);

        // Apply filters
        if (args.tier) {
          fissures = fissures.filter((f) => f.tier === args.tier);
        }
        if (args.steel_path !== undefined) {
          fissures = fissures.filter((f) => f.isHard === args.steel_path);
        }
        if (args.void_storm !== undefined) {
          fissures = fissures.filter((f) => f.isStorm === args.void_storm);
        }
        if (args.mission_type) {
          const mt = args.mission_type.toLowerCase();
          fissures = fissures.filter((f) =>
            f.missionType.toLowerCase().includes(mt)
          );
        }

        // Sort by tierNum asc, then expiry asc
        fissures.sort((a, b) => {
          if (a.tierNum !== b.tierNum) return a.tierNum - b.tierNum;
          return new Date(a.expiry).getTime() - new Date(b.expiry).getTime();
        });

        const lines = [
          `=== ACTIVE VOID FISSURES (${platform.toUpperCase()}) ===`,
          `Total active: ${fissures.length}`,
        ];

        // Group by tier
        const tiers = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
        for (const tier of tiers) {
          const tierFissures = fissures.filter((f) => f.tier === tier);
          if (args.tier && tier !== args.tier) continue;

          lines.push(`\n${tier.toUpperCase()} (Tier ${tiers.indexOf(tier) + 1}):`);
          if (tierFissures.length === 0) {
            lines.push("  [none currently active]");
          } else {
            tierFissures.forEach((f) => {
              let line = `  • ${f.node} — ${f.missionType} | ${f.enemy} — expires in ${fmt.timeRemaining(f.expiry)}`;
              if (f.isHard) line += " [STEEL PATH]";
              if (f.isStorm) line += " [VOID STORM]";
              lines.push(line);
            });
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error fetching fissures: ${msg}\n\nThe API may be temporarily unavailable. Try again in a moment.`,
            },
          ],
        };
      }
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatInvasionRewards(reward: {
  items?: string[];
  countedItems?: Array<{ count: number; type: string }>;
  credits?: number;
}): string {
  const parts: string[] = [];
  if (reward.items) {
    parts.push(...reward.items);
  }
  if (reward.countedItems) {
    reward.countedItems.forEach((ci) => {
      parts.push(ci.count > 1 ? `${ci.count}x ${ci.type}` : ci.type);
    });
  }
  if (reward.credits && reward.credits > 0) {
    parts.push(`${fmt.formatNumber(reward.credits)} credits`);
  }
  return parts.join(", ");
}
