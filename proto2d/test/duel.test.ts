// Fairness check: evenly matched animals should have a real fight, not a one-touch wipe.
import { beforeAll, expect, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { MATCHUPS, type UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

function watch(specs: [UnitSpec, UnitSpec], seed: number) {
  const b = new Battle(specs, seed);
  let maxRise = 0;
  while (!b.result) {
    b.step();
    for (const u of b.units) maxRise = Math.max(maxRise, (u.torso.translation().y - u.bp.standY) / u.spec.size);
  }
  const st = (t: number) => b.units.filter((u) => u.team === t).reduce((a, u) => a + u.strikes, 0);
  const r = { t: b.time, winner: b.result!.winner, alive: b.result!.alive, maxRise, strikes: `${st(0)}/${st(1)}` };
  b.dispose();
  return r;
}

it("wolves vs dogs: lasts, and nobody gets launched", () => {
  const m = MATCHUPS.find((x) => x.id === "wolves")!;
  const one: [UnitSpec, UnitSpec] = [{ ...m.left, count: 1 }, { ...m.right, count: 1 }];
  const rows = [1, 2, 3].map((s) => ({ duel: watch(one, s), pack: watch([m.left, m.right], s) }));
  for (const r of rows)
    console.log(`duel ${r.duel.t.toFixed(1)}s str ${r.duel.strikes} rise ${r.duel.maxRise.toFixed(2)} | pack ${r.pack.t.toFixed(1)}s alive ${r.pack.alive.join("/")} rise ${r.pack.maxRise.toFixed(2)}`);
  for (const r of rows) {
    expect(r.duel.t, "1v1 of equals ends too fast").toBeGreaterThan(6);
    expect(r.pack.t, "8 wolves vs 3 dogs ends too fast").toBeGreaterThan(5);
    expect(r.pack.t, "pack fight stalled").toBeLessThan(60);
    expect(r.pack.maxRise, "a body was launched into the air").toBeLessThan(1.2);
  }
}, 120_000);
