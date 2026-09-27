// Bakes showcase matchups: every spec designed by Jev, so the examples are the real thing.
// BAKE=1 npx vitest --run test/bake.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { expect, it } from "vitest";
import { phraseToSpec } from "../src/ai/jev";
import type { Matchup, UnitSpec } from "../src/sim/spec";

const FIGHTS: [string, string, string][] = [
  ["goose", "50 geese with knives", "a medieval knight"],
  ["vending", "a haunted vending machine", "a sumo wrestler"],
  ["burger", "100 cheeseburgers with legs", "a hungry bear"],
  ["grandma", "grandma with a frying pan", "a velociraptor"],
  ["toaster", "30 fire-breathing toasters", "a giant snowman"],
  ["ducks", "an army of rubber ducks", "a shark"],
  ["chihuahua", "100 angry chihuahuas", "a T-rex"],
  ["octopus", "a giant octopus with 8 swords", "30 samurai"],
  ["fridge", "a fridge with anger issues", "10 penguins"],
  ["dragon", "a three-headed dragon", "an army of skeletons"],
  ["tank", "a tank", "100 zombies"],
  ["bees", "a swarm of bees", "a grizzly bear"],
];

it.skipIf(!process.env.BAKE)("bake Jev-designed showcase fights", async () => {
  const key = loadEnv("development", "../..", "").TYPESAFE_API_KEY!;
  // ONLY=id1,id2 re-designs just those fights and keeps the rest as baked.
  const only = process.env.ONLY?.split(",");
  const prev = new Map((JSON.parse(readFileSync("src/sim/presets.json", "utf8")) as Matchup[]).map((m) => [m.id, m]));
  const phrases = [...new Set(FIGHTS.filter(([id]) => !only || only.includes(id) || !prev.has(id)).flatMap(([, a, b]) => [a, b]))];
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
  const out: Matchup[] = FIGHTS.map(([id, a, b]) => (specs.has(a) ? { id, title: `${a} vs ${b}`, left: specs.get(a)!, right: specs.get(b)! } : prev.get(id)!));
  writeFileSync("src/sim/presets.json", JSON.stringify(out));
  console.log(`baked ${out.length}`);
}, 300_000);
