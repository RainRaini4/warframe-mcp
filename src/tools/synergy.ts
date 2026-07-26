import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ws from "../api/warframestat.js";
import { normalizeWorldstatePlatform, WORLDSTATE_PLATFORM_VALUES } from "../utils/platform.js";
import type {
  Fissure,
  Invasion,
  NightwaveChallenge,
  SortieVariant,
} from "../types/index.js";

// ─── Nightwave keyword matching ──────────────────────────────────────────────

interface ParsedChallenge {
  title: string;
  desc: string;
  isElite: boolean;
  reputation: number;
  keywords: ChallengeKeywords;
}

interface ChallengeKeywords {
  missionTypes: string[];      // e.g. ["exterminate", "capture"]
  enemyTypes: string[];        // e.g. ["eximus", "grineer"]
  weaponTypes: string[];       // e.g. ["shotgun", "rifle"]
  requiresCoop: boolean;       // "with a friend/clanmate"
  requiresSortie: boolean;
  requiresKuva: boolean;
  requiresOpenWorld: boolean;
  requiresFissure: boolean;
  requiresInvasion: boolean;
  killCount: number;
  generic: boolean;            // Can be done anywhere (e.g. "kill 150 enemies")
}

const MISSION_TYPE_KEYWORDS: Record<string, string[]> = {
  exterminate: ["exterminate", "extermination"],
  survival: ["survival", "survive"],
  defense: ["defense", "defend"],
  spy: ["spy", "data", "vault"],
  capture: ["capture"],
  rescue: ["rescue", "hostage"],
  sabotage: ["sabotage"],
  interception: ["interception", "intercept"],
  excavation: ["excavation", "excavate", "excavator"],
  disruption: ["disruption", "disruptions"],
  mobile_defense: ["mobile defense"],
  assassination: ["assassination", "assassinate", "boss"],
  hijack: ["hijack"],
  sanctuary_onslaught: ["sanctuary onslaught", "onslaught"],
};

const WEAPON_TYPE_KEYWORDS: Record<string, string[]> = {
  rifle: ["rifle", "rifles"],
  shotgun: ["shotgun", "shotguns"],
  pistol: ["pistol", "pistols", "secondary"],
  melee: ["melee"],
  sniper: ["sniper"],
  bow: ["bow"],
};

function parseChallenge(challenge: NightwaveChallenge): ParsedChallenge {
  const desc = (challenge.desc || "").toLowerCase();
  const title = (challenge.title || "").toLowerCase();
  const combined = `${desc} ${title}`;

  const keywords: ChallengeKeywords = {
    missionTypes: [],
    enemyTypes: [],
    weaponTypes: [],
    requiresCoop: false,
    requiresSortie: false,
    requiresKuva: false,
    requiresOpenWorld: false,
    requiresFissure: false,
    requiresInvasion: false,
    killCount: 0,
    generic: false,
  };

  // Extract mission types
  for (const [type, kws] of Object.entries(MISSION_TYPE_KEYWORDS)) {
    if (kws.some((kw) => combined.includes(kw))) {
      keywords.missionTypes.push(type);
    }
  }

  // Extract weapon types
  for (const [type, kws] of Object.entries(WEAPON_TYPE_KEYWORDS)) {
    if (kws.some((kw) => combined.includes(kw))) {
      keywords.weaponTypes.push(type);
    }
  }

  // Enemy types
  if (combined.includes("eximus")) keywords.enemyTypes.push("eximus");
  if (combined.includes("grineer")) keywords.enemyTypes.push("grineer");
  if (combined.includes("corpus")) keywords.enemyTypes.push("corpus");
  if (combined.includes("infested")) keywords.enemyTypes.push("infested");
  if (combined.includes("corrupted")) keywords.enemyTypes.push("corrupted");
  if (combined.includes("sentient")) keywords.enemyTypes.push("sentient");

  // Special requirements
  keywords.requiresCoop =
    combined.includes("friend") ||
    combined.includes("clanmate") ||
    combined.includes("squad");
  keywords.requiresSortie = combined.includes("sortie");
  keywords.requiresKuva =
    combined.includes("kuva") && !combined.includes("kuva lich");
  keywords.requiresOpenWorld =
    combined.includes("plains") ||
    combined.includes("vallis") ||
    combined.includes("cambion") ||
    combined.includes("open world") ||
    combined.includes("bounty") ||
    combined.includes("conservation") ||
    combined.includes("fishing") ||
    combined.includes("mining");
  keywords.requiresFissure =
    combined.includes("fissure") || combined.includes("relic");
  keywords.requiresInvasion = combined.includes("invasion");

  // Kill count
  const killMatch = combined.match(/kill\s+(\d+)/);
  if (killMatch) keywords.killCount = parseInt(killMatch[1], 10);

  // Generic (can be done in any mission)
  keywords.generic =
    keywords.missionTypes.length === 0 &&
    !keywords.requiresSortie &&
    !keywords.requiresOpenWorld &&
    !keywords.requiresFissure &&
    !keywords.requiresInvasion &&
    !keywords.requiresKuva;

  return {
    title: challenge.title,
    desc: challenge.desc,
    isElite: challenge.isElite,
    reputation: challenge.reputation,
    keywords,
  };
}

// ─── Synergy matching ────────────────────────────────────────────────────────

interface SynergyMatch {
  activity: string;
  activityDetail: string;
  challenges: string[];
  score: number;
  tips: string[];
}

function findFissureSynergies(
  fissures: Fissure[],
  challenges: ParsedChallenge[]
): SynergyMatch[] {
  const matches: SynergyMatch[] = [];

  for (const fissure of fissures) {
    const matchedChallenges: string[] = [];
    const tips: string[] = [];
    const fMission = (fissure.missionType || "").toLowerCase();
    const fEnemy = (fissure.enemy || "").toLowerCase();

    for (const ch of challenges) {
      // Fissure-required challenges
      if (ch.keywords.requiresFissure) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Mission type match
      if (
        ch.keywords.missionTypes.length > 0 &&
        ch.keywords.missionTypes.some((t) => fMission.includes(t))
      ) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Enemy type match
      if (
        ch.keywords.enemyTypes.length > 0 &&
        ch.keywords.enemyTypes.some((e) => fEnemy.includes(e))
      ) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Generic kill challenges can be done in any fissure
      if (ch.keywords.generic && ch.keywords.killCount > 0) {
        matchedChallenges.push(ch.title);
        continue;
      }
    }

    if (matchedChallenges.length >= 1) {
      // Add weapon tip if any challenge needs specific weapons
      const weaponChallenges = challenges.filter(
        (c) =>
          matchedChallenges.includes(c.title) && c.keywords.weaponTypes.length > 0
      );
      for (const wc of weaponChallenges) {
        tips.push(
          `Bring a ${wc.keywords.weaponTypes.join("/")} for "${wc.title}"`
        );
      }

      const coopChallenges = challenges.filter(
        (c) => matchedChallenges.includes(c.title) && c.keywords.requiresCoop
      );
      if (coopChallenges.length > 0) {
        tips.push("Bring a friend/clanmate for co-op challenges");
      }

      const detail = `${fissure.tier} ${fissure.missionType} — ${fissure.node}${fissure.isHard ? " [Steel Path]" : ""}${fissure.isStorm ? " [Void Storm]" : ""}`;

      matches.push({
        activity: "Void Fissure",
        activityDetail: detail,
        challenges: [...new Set(matchedChallenges)],
        score: matchedChallenges.length * 10 + (fissure.isHard ? 5 : 0),
        tips,
      });
    }
  }

  return matches;
}

function findInvasionSynergies(
  invasions: Invasion[],
  challenges: ParsedChallenge[]
): SynergyMatch[] {
  const matches: SynergyMatch[] = [];

  const activeInvasions = invasions.filter((inv) => !inv.completed);

  for (const inv of activeInvasions) {
    const matchedChallenges: string[] = [];
    const tips: string[] = [];

    for (const ch of challenges) {
      if (ch.keywords.requiresInvasion) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Enemy type match
      const invEnemies = [
        inv.attacker?.faction?.toLowerCase() ?? "",
        inv.defender?.faction?.toLowerCase() ?? "",
      ];
      if (
        ch.keywords.enemyTypes.length > 0 &&
        ch.keywords.enemyTypes.some((e) => invEnemies.some((ie) => ie.includes(e)))
      ) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Generic kill challenges
      if (ch.keywords.generic && ch.keywords.killCount > 0) {
        matchedChallenges.push(ch.title);
      }
    }

    if (matchedChallenges.length >= 1) {
      const fmtReward = (r?: { items?: string[]; countedItems?: { type: string; count: number }[]; credits?: number }) => {
        if (!r) return "?";
        const parts: string[] = [];
        if (r.items?.length) parts.push(...r.items);
        if (r.countedItems?.length) parts.push(...r.countedItems.map(ci => `${ci.count}x ${ci.type}`));
        if (r.credits) parts.push(`${r.credits}cr`);
        return parts.join(", ") || "?";
      };
      const detail = `${inv.node} — ${inv.desc} (${fmtReward(inv.attacker?.reward)} vs ${fmtReward(inv.defender?.reward)})`;

      matches.push({
        activity: "Invasion",
        activityDetail: detail,
        challenges: [...new Set(matchedChallenges)],
        score: matchedChallenges.length * 10,
        tips,
      });
    }
  }

  return matches;
}

function findSortieSynergies(
  variants: SortieVariant[],
  challenges: ParsedChallenge[]
): SynergyMatch[] {
  const matches: SynergyMatch[] = [];

  for (const variant of variants) {
    const matchedChallenges: string[] = [];
    const tips: string[] = [];
    const vMission = (variant.missionType || "").toLowerCase();

    for (const ch of challenges) {
      if (ch.keywords.requiresSortie) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Mission type match
      if (
        ch.keywords.missionTypes.length > 0 &&
        ch.keywords.missionTypes.some((t) => vMission.includes(t))
      ) {
        matchedChallenges.push(ch.title);
        continue;
      }

      // Generic kill challenges
      if (ch.keywords.generic && ch.keywords.killCount > 0) {
        matchedChallenges.push(ch.title);
      }
    }

    if (matchedChallenges.length >= 1) {
      const detail = `Sortie ${variant.missionType} — ${variant.node} (${variant.modifier})`;

      matches.push({
        activity: "Sortie",
        activityDetail: detail,
        challenges: [...new Set(matchedChallenges)],
        score: matchedChallenges.length * 10 + 5, // Sortie bonus
        tips,
      });
    }
  }

  return matches;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerSynergyTools(server: McpServer): void {
  server.tool(
    "task_synergy_planner",
    "Find the most efficient activity combos by cross-referencing active Nightwave challenges with current Fissures, Invasions, and Sortie. Tells you which single mission can complete multiple objectives at once.",
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

        // Fetch all worldstate data in parallel
        const [nightwaveRes, fissureRes, invasionRes, sortieRes] =
          await Promise.allSettled([
            ws.getNightwave(platform),
            ws.getFissures(platform),
            ws.getInvasions(platform),
            ws.getSortie(platform),
          ]);

        const lines: string[] = [];
        lines.push("## Task Synergy Planner");

        // Parse nightwave challenges
        if (nightwaveRes.status !== "fulfilled" || !nightwaveRes.value?.activeChallenges?.length) {
          lines.push(
            "\n**Nightwave data unavailable.** The worldstate API may be down or Nightwave is between seasons."
          );
          lines.push(
            "Without active Nightwave challenges, there's nothing to cross-reference."
          );
          lines.push(
            "\n> **Tip:** You can still use `active_fissures` and `world_state` to check what's currently available."
          );
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        const nightwave = nightwaveRes.value;
        const challenges = nightwave.activeChallenges
          .map(parseChallenge)
          .sort((a, b) => b.reputation - a.reputation);

        lines.push(
          `\n**Active Nightwave Challenges:** ${challenges.length}`
        );
        for (const ch of challenges) {
          const tag = ch.isElite ? " [Elite]" : "";
          lines.push(`- ${ch.title}${tag} (${ch.reputation} rep) — ${ch.desc}`);
        }

        // Find synergies with each activity type
        const allSynergies: SynergyMatch[] = [];

        if (fissureRes.status === "fulfilled" && fissureRes.value?.length > 0) {
          allSynergies.push(
            ...findFissureSynergies(fissureRes.value, challenges)
          );
        }

        if (invasionRes.status === "fulfilled" && invasionRes.value?.length > 0) {
          allSynergies.push(
            ...findInvasionSynergies(invasionRes.value, challenges)
          );
        }

        if (sortieRes.status === "fulfilled" && sortieRes.value?.variants?.length > 0) {
          allSynergies.push(
            ...findSortieSynergies(sortieRes.value.variants, challenges)
          );
        }

        // Sort by number of challenges matched
        allSynergies.sort((a, b) => b.score - a.score);

        if (allSynergies.length === 0) {
          lines.push("\n### No Synergies Found");
          lines.push(
            "No current fissures, invasions, or sortie missions overlap with your Nightwave challenges."
          );
          lines.push(
            "This can happen when the worldstate API is down or challenges are very specific (open world, coop-only, etc.)."
          );
        } else {
          // Show top synergies (max 10)
          const topSynergies = allSynergies.slice(0, 10);
          const best = topSynergies[0];

          lines.push(`\n### Top Synergy Combos`);

          for (let i = 0; i < topSynergies.length; i++) {
            const syn = topSynergies[i];
            lines.push(
              `\n**${i + 1}. ${syn.activity}: ${syn.activityDetail}**`
            );
            lines.push(
              `   Completes ${syn.challenges.length} challenge(s): ${syn.challenges.join(", ")}`
            );
            for (const tip of syn.tips) {
              lines.push(`   > ${tip}`);
            }
          }

          // Best recommendation
          lines.push(`\n---`);
          lines.push(`### Recommendation`);
          lines.push(
            `Run **${best.activityDetail}** to knock out **${best.challenges.length} Nightwave challenge(s)** in a single mission: ${best.challenges.join(", ")}.`
          );
          if (best.tips.length > 0) {
            lines.push(best.tips.join(" "));
          }
        }

        // Show challenges that can't be synergized
        const allMatchedTitles = new Set(
          allSynergies.flatMap((s) => s.challenges)
        );
        const unmatchedChallenges = challenges.filter(
          (c) => !allMatchedTitles.has(c.title)
        );
        if (unmatchedChallenges.length > 0) {
          lines.push(`\n### Standalone Challenges`);
          lines.push(`These need to be done separately:`);
          for (const ch of unmatchedChallenges) {
            lines.push(`- ${ch.title}: ${ch.desc}`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Error in task_synergy_planner: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
