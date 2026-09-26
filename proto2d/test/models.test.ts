import { beforeAll, expect, it } from "vitest";
import { MODELS } from "../src/models/models";
import { Battle, initPhysics } from "../src/sim/battle";
import type { UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const beast = (model: string, size: number, weight: number): UnitSpec => ({
  label: model, count: 1, plan: "quadruped", model, size, weight, strength: 1.5, toughness: 1.5, speed: 1.2, bravery: 1,
  attack: "bite", weapon: "none", armor: 0, canFly: false, colors: { body: "#888888", accent: "#333333" },
});

it("every rigged model stands, walks toward an enemy and stays finite", () => {
  expect(MODELS.length).toBeGreaterThan(0);
  const bad: string[] = [];
  for (const m of MODELS) {
    const b = new Battle([beast(m.id, 1.6, 45), beast(m.id, 1.6, 45)], 2);
    const u = b.units[0];
    const x0 = u.torso.translation().x, y0 = u.bp.standY;
    let low = Infinity, tip = 0;
    for (let i = 0; i < 180; i++) {
      b.step();
      if (i > 40) {
        low = Math.min(low, u.torso.translation().y);
        tip = Math.max(tip, Math.abs(u.torso.rotation()));
      }
    }
    const moved = u.torso.translation().x - x0;
    console.log(`${m.id} low=${(low / y0).toFixed(2)} tip=${tip.toFixed(2)} moved=${moved.toFixed(2)}`);
    if (!Number.isFinite(low) || low < 0.6 * y0 || tip > 0.8 || moved < 0.5) bad.push(m.id);
    b.dispose();
  }
  expect(bad).toEqual([]);
}, 60_000);
