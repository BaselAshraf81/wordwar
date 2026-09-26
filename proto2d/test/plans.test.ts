import { beforeAll, describe, expect, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import type { PlanId, UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const base = (plan: PlanId, over: Partial<UnitSpec> = {}): UnitSpec => ({
  label: plan, count: 1, plan, size: 1.5, weight: 80, strength: 1.2, toughness: 1.2, speed: 1.1, bravery: 1,
  attack: "bite", weapon: "none", armor: 0, canFly: false, colors: { body: "#888888", accent: "#333333" }, ...over,
});

const NEW: UnitSpec[] = [
  base("fish", { size: 3, weight: 900, features: { dorsalFin: true, snout: 0.8 } }),
  base("snake", { size: 3, weight: 40 }),
  base("bug", { size: 0.6, weight: 3, features: { legs: 8 } }),
  base("bug", { size: 0.6, weight: 3, features: { legs: 6 } }),
  base("blob", { size: 1, weight: 60, attack: "charge" }),
  base("quadruped", { size: 2.2, weight: 700, features: { neckLength: 3, legLength: 1.45 } }),
];

describe("legless and many-legged plans", () => {
  it("stay finite, stay low, and close the distance to an enemy", () => {
    for (const spec of NEW) {
      const b = new Battle([spec, base("biped", { size: 1.7, weight: 75, attack: "punch" })], 3);
      const u = b.units[0];
      const x0 = u.torso.translation().x;
      let maxY = 0;
      for (let i = 0; i < 180; i++) {
        b.step();
        const p = u.torso.translation();
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${spec.plan} exploded`).toBe(true);
        maxY = Math.max(maxY, p.y);
      }
      const moved = u.torso.translation().x - x0;
      b.dispose();
      expect(maxY, `${spec.plan} flew off`).toBeLessThan(spec.size * 3 + 2);
      expect(moved, `${spec.plan} did not advance`).toBeGreaterThan(0.5);
    }
  });
});
