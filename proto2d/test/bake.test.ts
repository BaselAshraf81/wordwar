// Bakes showcase matchups: every spec designed by Jev, so the examples are the real thing.
// BAKE=1 npx vitest --run test/bake.test.ts
import { writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { expect, it } from "vitest";
import { phraseToSpec } from "../src/ai/jev";
import type { Matchup, UnitSpec } from "../src/sim/spec";

const FIGHTS: [string, string, string][] = [
  ["dragon", "a three-headed dragon", "an army of skeletons"],
  ["hydra", "a hydra", "a medieval knight"],
  ["kraken", "a kraken", "20 pirates"],
  ["spider", "a giant spider", "a wizard"],
  ["elements", "a fire dragon", "an ice dragon"],
  ["mech", "a mech robot with lasers", "a T-rex"],
  ["slime", "a giant green slime", "20 samurai"],
  ["cactus", "a cactus", "a porcupine"],
  ["tank", "a tank", "100 zombies"],
  ["ghost", "3 ghosts", "a ghostbuster"],
  ["crab", "a crab", "a scorpion"],
  ["bees", "a swarm of bees", "a grizzly bear"],
];

it.skipIf(!process.env.BAKE)("bake Jev-designed showcase fights", async () => {
  const key = loadEnv("development", "../..", "").TYPESAFE_API_KEY!;
  const phrases = [...new Set(FIGHTS.flatMap(([, a, b]) => [a, b]))];
  const specs = new Map<string, UnitSpec>();
  const r3 = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  const queue = [...phrases];
  await Promise.all([0, 1, 2, 3].map(async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const r = await phraseToSpec(p, key);
      expect(r.ok, `${p} refused`).toBe(true);
      if (r.ok) specs.set(p, JSON.parse(JSON.stringify(r.spec, r3)));
    }
  }));
  const out: Matchup[] = FIGHTS.map(([id, a, b]) => ({ id, title: `${a} vs ${b}`, left: specs.get(a)!, right: specs.get(b)! }));
  writeFileSync("src/sim/presets.json", JSON.stringify(out));
  console.log(`baked ${out.length}`);
}, 300_000);
