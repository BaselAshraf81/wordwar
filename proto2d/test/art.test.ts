import { beforeAll, describe, expect, it } from "vitest";
import { RIGS } from "../src/art/rigs";
import { Battle, initPhysics } from "../src/sim/battle";
import type { UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const specFor = (id: string, plan: UnitSpec["plan"]): UnitSpec => ({
  label: id, count: 1, plan, art: id, size: plan === "bird" ? 0.8 : 1.8, weight: plan === "bird" ? 6 : 150,
  strength: 1.3, toughness: 1.3, speed: 1.1, bravery: 1, attack: plan === "wheeled" ? "ram" : "bite",
  weapon: "none", armor: 0, canFly: false, colors: { body: "#888888", accent: "#333333" },
});
const man: UnitSpec = { ...specFor("man", "biped"), art: undefined, attack: "punch", size: 1.75, weight: 75 };

describe("every emoji art rig", () => {
  it("builds, stays upright and finite, and closes on an enemy", () => {
    expect(RIGS.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const r of RIGS) {
      const b = new Battle([specFor(r.id, r.plan), man], 5);
      const u = b.units[0];
      const x0 = u.torso.translation().x;
      let tipped = 0, finite = true, maxY = 0;
      for (let i = 0; i < 240; i++) {
        b.step();
        const p = u.torso.translation();
        finite &&= Number.isFinite(p.x) && Number.isFinite(p.y);
        maxY = Math.max(maxY, p.y);
        if (i > 60 && r.plan !== "fish" && Math.abs(u.torso.rotation()) > 0.9) tipped++;
      }
      const moved = u.torso.translation().x - x0;
      if (!finite || tipped > 60 || maxY > u.spec.size * 3 + 2 || moved < 0.4) bad.push(`${r.id}(finite=${finite} tipped=${tipped} moved=${moved.toFixed(2)})`);
      b.dispose();
    }
    expect(bad, bad.join(" ")).toEqual([]);
  }, 180_000);
});
