// Diagnostic, not a pass/fail gate: prints how each preset plays out across seeds.
import { beforeAll, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { MATCHUPS } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

it.skipIf(!process.env.BALANCE)("balance report", () => {
  for (const m of MATCHUPS) {
    const rows: string[] = [];
    for (const seed of [1, 2, 3]) {
      const b = new Battle([m.left, m.right], seed);
      while (!b.result) b.step();
      const side = (t: 0 | 1) => {
        const us = b.units.filter((u) => u.team === t);
        const sum = (k: "strikes" | "hits" | "kills") => us.reduce((a, u) => a + u[k], 0);
        return `str=${sum("strikes")} hit=${sum("hits")} kill=${sum("kills")}`;
      };
      const w = b.result!.winner;
      rows.push(`  seed ${seed}: ${w === 0 ? "LEFT " : w === 1 ? "RIGHT" : "DRAW "} t=${b.time.toFixed(1)} alive=${b.result!.alive.join("/")} | L ${side(0)} | R ${side(1)}`);
      b.dispose();
    }
    console.log(`${m.title}\n${rows.join("\n")}`);
  }
}, 900_000);
