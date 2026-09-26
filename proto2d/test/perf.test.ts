// Budget check: big art crowds must stay under the 60 fps physics budget.
import { beforeAll, expect, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import type { UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const beast = (art: string, count: number, size: number, weight: number): UnitSpec => ({
  label: art, count, plan: "quadruped", art, size, weight, strength: 2.5, toughness: 2.5, speed: 1.5, bravery: 1,
  attack: "charge", weapon: "none", armor: 0.3, canFly: false, colors: { body: "#7a4e2d", accent: "#2a2a2e" },
});

it("95 art buffalo vs an elephant stays under 8 ms per physics step", () => {
  const b = new Battle([beast("elephant", 1, 3.4, 1500), beast("ox", 95, 2.5, 770)], 1);
  for (let i = 0; i < 60; i++) b.step();
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) b.step();
  const ms = (performance.now() - t0) / 120;
  console.log(`ms/step ${ms.toFixed(2)}`);
  b.dispose();
  expect(ms).toBeLessThan(8);
}, 120_000);
