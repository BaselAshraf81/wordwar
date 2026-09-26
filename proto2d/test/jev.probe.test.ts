// Live probe against Jev. Costs real tokens, so it only runs with JEV_PROBE=1.
import { loadEnv } from "vite";
import { expect, it } from "vitest";
import { parseCount, phraseToSpec } from "../src/ai/jev";

it("parses explicit counts in code", () => {
  expect(parseCount("100 men")).toBe(100);
  expect(parseCount("a hundred men")).toBe(100);
  expect(parseCount("three house cats")).toBe(3);
  expect(parseCount("a gorilla")).toBe(1);
  expect(parseCount("a swarm of angry geese")).toBeNull();
  expect(parseCount("zombies")).toBeNull();
});

const PHRASES = (process.env.JEV_PHRASES ?? "").split("|").filter(Boolean);
const DEFAULT = [
  "100 men", "1 gorilla", "a swarm of angry geese", "a medieval knight", "a Roomba with a knife",
  "3 house cats", "50 toddlers", "a grizzly bear", "zombies", "the entire French army",
  "a very large goose", "an angry shopping trolley", "Tuesday", "democracy", "Elon Musk",
];

it.skipIf(!process.env.JEV_PROBE)("phrases -> specs", async () => {
  const key = loadEnv("development", "../..", "").TYPESAFE_API_KEY;
  expect(key, "TYPESAFE_API_KEY missing").toBeTruthy();
  let tokens = 0;
  for (const phrase of PHRASES.length ? PHRASES : DEFAULT) {
    const r = await phraseToSpec(phrase, key!);
    tokens += r.tokens;
    if (!r.ok) {
      console.log(`${phrase.padEnd(26)} REFUSED ${r.reason} (${r.ms}ms)`);
      continue;
    }
    const s = r.spec;
    const low = Object.entries(r.confidence).filter(([, c]) => c < 0.5).map(([k]) => k);
    console.log(
      `${phrase.padEnd(26)} n=${String(s.count).padEnd(3)} ${s.plan.padEnd(9)} ${s.size.toFixed(2)}m ${s.weight.toFixed(0).padStart(4)}kg ` +
        `str=${s.strength.toFixed(1)} tuf=${s.toughness.toFixed(1)} spd=${s.speed.toFixed(1)} brv=${s.bravery.toFixed(2)} arm=${s.armor.toFixed(2)} ` +
        `${s.attack}/${s.weapon}${s.canFly ? " fly" : ""} ${s.colors.body}/${s.colors.accent} ${r.ms}ms ${r.tokens}tok ` +
        Object.entries(s.features ?? {}).filter(([, v]) => v !== "none" && v !== false && v !== "plain").map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`).join(" ") +
        (low.length ? ` lowconf:${low.join(",")}` : ""),
    );
  }
  console.log(`total input tokens ${tokens}  ~$${((tokens * 0.042) / 1e6).toFixed(5)}`);
}, 180_000);
