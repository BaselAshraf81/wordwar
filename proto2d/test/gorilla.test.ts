// Diagnostic: what is the gorilla doing each step? Runs with GORILLA=1.
import { beforeAll, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { MATCHUPS } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

it.skipIf(!process.env.GORILLA)("gorilla time budget", () => {
  const m = MATCHUPS.find((x) => x.id === "gorilla")!;
  for (const seed of [1, 2, 3]) {
    const b = new Battle([m.left, m.right], seed);
    const g = b.units.find((u) => u.team === 1)!;
    const c = { steps: 0, stunned: 0, down: 0, striking: 0, cooldown: 0, near: 0, attackersNear: 0 };
    while (!b.result) {
      b.step();
      if (!g.alive) break;
      c.steps++;
      if (b.time < g.stunUntil) c.stunned++;
      if (Math.abs(g.torso.rotation()) > 0.8 || g.torso.translation().y < g.bp.standY * 0.6) c.down++;
      if (g.strikeT > 0) c.striking++;
      if (g.cooldown > 0) c.cooldown++;
      const gp = g.torso.translation();
      const near = b.units.filter((u) => u.team === 0 && u.alive && Math.abs(u.torso.translation().x - gp.x) < 1.2).length;
      c.attackersNear += near;
      if (near > 0) c.near++;
    }
    const pct = (n: number) => `${Math.round((100 * n) / c.steps)}%`;
    console.log(
      `seed ${seed}: lived ${(c.steps / 60).toFixed(1)}s kills=${g.kills} strikes=${g.strikes} | stunned ${pct(c.stunned)} knocked-down ${pct(c.down)} ` +
        `striking ${pct(c.striking)} cooldown ${pct(c.cooldown)} | avg men within 1.2m ${(c.attackersNear / c.steps).toFixed(1)}`,
    );
    b.dispose();
  }
}, 120_000);
