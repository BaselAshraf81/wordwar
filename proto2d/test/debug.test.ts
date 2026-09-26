import { beforeAll, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { MATCHUPS } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

it.skipIf(!process.env.DEBUG_SIM)("trace", () => {
  const m = MATCHUPS[Number(process.env.DEBUG_SIM)];
  const b = new Battle([m.left, m.right], 1);
  const pick = [b.units.find((u) => u.team === 0)!, b.units.find((u) => u.team === 1)!];
  for (let i = 0; i <= 360; i++) {
    if (i % 45 === 0) {
      console.log(
        `t=${b.time.toFixed(2)} ` +
          pick
            .map((u) => {
              const p = u.torso.translation();
              return `${u.spec.label.slice(0, 10)} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} ang=${u.torso.rotation().toFixed(2)} vx=${u.torso.linvel().x.toFixed(2)} tgt=${u.target?.id ?? "-"} flee=${u.fleeing}`;
            })
            .join(" | "),
      );
    }
    b.step();
  }
  b.dispose();
});
