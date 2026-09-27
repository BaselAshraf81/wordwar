// Fuzz: Jev can design any combination, so every combination must survive the physics.
import { beforeAll, expect, it } from "vitest";
import { Battle, initPhysics } from "../src/sim/battle";
import { Rng } from "../src/sim/rng";
import { DEFAULT_GENOME, type Genome, type UnitSpec } from "../src/sim/spec";

beforeAll(async () => {
  await initPhysics();
});

const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];

export function randomGenome(r: Rng): Genome {
  return {
    ...DEFAULT_GENOME,
    frame: pick(r, ["upright", "horizontal", "long", "round", "wheeled"] as const),
    loco: pick(r, ["walk", "gallop", "crawl", "hop", "slither", "roll", "fly", "float", "flop", "drive"] as const),
    clumsy: r.next(),
    legs: pick(r, [0, 2, 4, 6, 8, 12]),
    legLen: r.range(0.45, 1.55),
    legThick: r.range(0.6, 1.7),
    foot: pick(r, ["paw", "hoof", "claw", "foot", "stump"] as const),
    arms: pick(r, [0, 0, 2, 4, 6]),
    armLen: r.range(0.45, 1.55),
    hand: pick(r, ["hand", "claw", "pincer", "blade", "hammer"] as const),
    heads: pick(r, [0, 1, 1, 1, 2, 3, 5]),
    headSize: r.range(0.6, 1.75),
    neckLen: r.range(0.3, 3),
    wings: pick(r, ["none", "none", "feather", "bat", "insect"] as const),
    wingSize: r.range(0.6, 1.7),
    tail: pick(r, ["none", "thin", "thick", "bushy", "club", "stinger", "fin"] as const),
    tailLen: r.range(0.4, 1.8),
    tentacles: pick(r, [0, 0, 0, 2, 4, 8]),
    back: pick(r, ["none", "spikes", "plates", "shell", "fin", "hump"] as const),
    bodyLen: r.range(0.7, 1.6),
    bulk: r.range(0.7, 1.55),
    material: pick(r, ["skin", "fur", "feathers", "scales", "metal", "slime", "stone", "wood", "ghost", "fire", "ice"] as const),
    attacks: [pick(r, ["bite", "peck", "headbutt", "gore", "claw", "punch", "slash", "pinch", "kick", "stomp", "charge", "slam", "tail_swipe", "sting", "whip"] as const)],
    ranged: pick(r, ["none", "none", "spit", "fire_breath", "ice_breath", "shoot", "throw_rock", "lightning", "laser", "poison_spray", "web"] as const),
    element: pick(r, ["none", "none", "fire", "ice", "poison", "electric", "acid"] as const),
    resist: [],
    weak: [],
    specials: r.next() < 0.3 ? [pick(r, ["regenerate", "split", "explode", "thorns", "rage"] as const)] : [],
  };
}

export const specOf = (g: Genome, size: number, weight: number, label = "thing"): UnitSpec => ({
  label, count: 1, plan: "biped", size, weight, strength: 1.3, toughness: 1.3, speed: 1.1, bravery: 1, attack: "bite",
  weapon: "none", armor: 0.1, canFly: false, colors: { body: "#8a8a8a", accent: "#333333" }, genome: g,
});

it("300 random creatures build, stay finite, stay on the field and fight", () => {
  const r = new Rng(7);
  const bad: string[] = [];
  let fought = 0;
  for (let i = 0; i < 300; i++) {
    const ga = randomGenome(r), gb = randomGenome(r);
    const sa = r.range(0.3, 4), sb = r.range(0.3, 4);
    const b = new Battle([specOf(ga, sa, 70 * sa ** 2.2), specOf(gb, sb, 70 * sb ** 2.2)], i);
    let finite = true, maxRise = -Infinity;
    for (let k = 0; k < 360 && !b.result; k++) {
      b.step();
      for (const u of b.units) {
        const p = u.torso.translation();
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
        maxRise = Math.max(maxRise, p.y - (3 * Math.max(sa, sb) + 5));
      }
      if (!finite) break;
    }
    const acted = b.units.some((u) => u.strikes > 0 || u.dealt > 0) || b.shots.length > 0;
    if (acted) fought++;
    if (!finite || maxRise > 0) bad.push(`#${i} ${ga.frame}/${ga.loco} vs ${gb.frame}/${gb.loco} finite=${finite} over=${maxRise.toFixed(1)}m sizes=${sa.toFixed(1)}/${sb.toFixed(1)} ${ga.ranged}/${gb.ranged} ${ga.specials}/${gb.specials}`);
    b.dispose();
  }
  console.log(`fought ${fought}/300, bad ${bad.length}`);
  expect(bad.slice(0, 10)).toEqual([]);
  expect(fought).toBeGreaterThan(240);
}, 300_000);
