// Picks the fight for a demo clip: Jev designs both armies, then seeds are scanned for a
// watchable one. CLIP=1 npx vitest --run test/clip.test.ts  (writes clip.json)
import { writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { beforeAll, expect, it } from "vitest";
import { phraseToSpec } from "../src/ai/jev";
import { Battle, initPhysics } from "../src/sim/battle";
import type { UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

it.skipIf(!process.env.CLIP)("design the clip fight and pick a seed", async () => {
  const key = loadEnv("development", "../..", "").TYPESAFE_API_KEY!;
  const phrases = (process.env.CLIP_PHRASES ?? "100 men|1 gorilla").split("|");
  const r3 = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  const specs = (await Promise.all(phrases.map((p) => phraseToSpec(p, key)))).map((r) => {
    expect(r.ok).toBe(true);
    return JSON.parse(JSON.stringify((r as { spec: UnitSpec }).spec, r3)) as UnitSpec;
  }) as [UnitSpec, UnitSpec];
  const rows: { seed: number; winner: number | null; time: number; alive: number[]; topKills: number }[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const b = new Battle(specs, seed);
    while (!b.result) b.step();
    rows.push({ seed, winner: b.result.winner, time: +b.result.time.toFixed(1), alive: b.result.alive, topKills: Math.max(...b.units.filter((u) => u.team === 1).map((u) => u.kills)) });
    b.dispose();
  }
  writeFileSync("clip.json", JSON.stringify({ specs, rows }, null, 1));
  for (const r of rows) console.log(JSON.stringify(r));
}, 600_000);
