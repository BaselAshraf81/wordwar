import { beforeAll, describe, expect, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { MATCHUPS, type UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const run = (specs: [UnitSpec, UnitSpec], seed: number, seconds: number) => {
  const b = new Battle(specs, seed);
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !b.result; i++) b.step();
  return b;
};

describe("body control", () => {
  it("every plan stays up for 4 s when enemies are far away", () => {
    for (const m of MATCHUPS) {
      for (const spec of [m.left, m.right]) {
        if (spec.canFly) continue;
        const lone = { ...spec, count: 1 };
        const b = new Battle([lone, lone], 1, { idle: true });
        const u = b.units[0];
        const target = u.bp.standY;
        let low = Infinity;
        for (let i = 0; i < 240; i++) {
          b.step();
          if (i > 60) low = Math.min(low, u.torso.translation().y);
        }
        const ang = Math.abs(u.torso.rotation());
        b.dispose();
        expect(low, `${spec.label} torso sank`).toBeGreaterThan(target * 0.7);
        expect(ang, `${spec.label} tipped over`).toBeLessThan(0.6);
      }
    }
  });
});

describe("determinism", () => {
  it("same seed gives the same fight, different seed a different one", () => {
    const m = MATCHUPS[0];
    const a = run([m.left, m.right], 42, 5);
    const b = run([m.left, m.right], 42, 5);
    const c = run([m.left, m.right], 43, 5);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());
    [a, b, c].forEach((x) => x.dispose());
  });
});

describe("matchups resolve", () => {
  it("each preset ends with a winner within the time limit", () => {
    for (const m of MATCHUPS) {
      const t0 = performance.now();
      const b = run([m.left, m.right], 7, 125);
      const ms = performance.now() - t0;
      const r = b.result;
      console.log(
        `${m.title.padEnd(48)} winner=${r?.winner === 0 ? m.left.label : r?.winner === 1 ? m.right.label : "draw"} ` +
          `t=${r?.time.toFixed(1)}s alive=${r?.alive.join("/")} sim=${(ms / b.steps).toFixed(2)}ms/step`,
      );
      expect(r).not.toBeNull();
      b.dispose();
    }
  }, 120_000);
});
