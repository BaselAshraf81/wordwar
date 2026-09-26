// Body plans as data. One builder per plan turns a UnitSpec into a blueprint;
// battle.ts turns any blueprint into Rapier bodies. Nothing here reads spec.label.
import type { UnitSpec, Weapon } from "./spec";

export type Shape =
  | { kind: "ball"; r: number }
  | { kind: "capsule"; hh: number; r: number }
  | { kind: "box"; hx: number; hy: number };

export type Paint = "body" | "accent" | "metal" | "dark";

export interface ColliderBP {
  shape: Shape;
  offset: [number, number];
  rot: number;
  densityMul: number;
  sharp: number; // damage multiplier when this collider strikes
  paint: Paint;
  striker: boolean;
  foot: boolean;
}

export interface SegmentBP {
  id: string;
  pos: [number, number]; // world position at spawn, unit origin at feet
  layer: 0 | 1 | 2; // 0 far limbs, 1 body, 2 near limbs
  colliders: ColliderBP[];
}

export type JointRole = "hip" | "knee" | "shoulder" | "elbow" | "neck" | "tail" | "wing" | "wheel";

export interface JointBP {
  id: string;
  a: string;
  b: string;
  at: [number, number]; // world anchor at spawn
  limits: [number, number] | null;
  role: JointRole;
}

export interface Blueprint {
  segments: SegmentBP[];
  joints: JointBP[];
  torso: string;
  head: string;
  strikeSeg: string;
  standY: number; // torso centre height when standing
  reach: number; // strike reach from torso centre, metres
  halfWidth: number; // body half width, for enemy reach checks
  legs: { hip: string; knee?: string; phase: number }[];
  arms: { shoulder: string; elbow?: string }[];
}

type Part = Partial<ColliderBP> & { shape: Shape };
const col = (p: Part): ColliderBP => ({
  offset: [0, 0],
  rot: 0,
  densityMul: 1,
  sharp: 0.3,
  paint: "body",
  striker: false,
  foot: false,
  ...p,
});

/** Vertical capsule segment whose end-cap centres sit at y0 and y1. */
const vcap = (id: string, x: number, y0: number, y1: number, r: number, layer: 0 | 1 | 2, p: Partial<ColliderBP> = {}): SegmentBP => ({
  id,
  pos: [x, (y0 + y1) / 2],
  layer,
  colliders: [col({ shape: { kind: "capsule", hh: Math.max(0.002, (y1 - y0) / 2), r }, ...p })],
});

/** Joint limits written for a unit facing +x, mirrored for one facing -x. */
const lim = (f: number, a: number, b: number): [number, number] => (f > 0 ? [a, b] : [-b, -a]);

export const WEAPONS: Record<Exclude<Weapon, "none">, { len: number; r: number; density: number; sharp: number; paint: Paint }> = {
  sword: { len: 0.55, r: 0.018, density: 4, sharp: 3, paint: "metal" },
  knife: { len: 0.16, r: 0.014, density: 4, sharp: 3, paint: "metal" },
  club: { len: 0.4, r: 0.04, density: 2, sharp: 1.6, paint: "dark" },
  spear: { len: 0.9, r: 0.016, density: 2.5, sharp: 2.6, paint: "dark" },
};

function biped(s: UnitSpec, f: number, cheap: boolean): Blueprint {
  const h = s.size;
  const hipY = 0.5 * h, kneeY = 0.27 * h, shY = 0.8 * h, elY = 0.64 * h, handY = 0.48 * h;
  const rl = 0.055 * h, ra = 0.042 * h, rt = 0.11 * h, rh = 0.075 * h;
  const torsoTop = 0.8 * h;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const legs: Blueprint["legs"] = [];
  const arms: Blueprint["arms"] = [];

  segs.push({
    id: "torso",
    pos: [0, (hipY + torsoTop) / 2],
    layer: 1,
    colliders: [col({ shape: { kind: "capsule", hh: Math.max(0.01, (torsoTop - hipY) / 2 - rt * 0.5), r: rt }, paint: "accent" })],
  });
  segs.push({ id: "head", pos: [0, 0.905 * h], layer: 1, colliders: [col({ shape: { kind: "ball", r: rh } })] });
  joints.push({ id: "neck", a: "torso", b: "head", at: [0, 0.84 * h], limits: [-0.5, 0.5], role: "neck" });

  for (const [side, layer, phase, dx] of [["B", 0, 0, -0.02], ["F", 2, 0.5, 0.02]] as const) {
    const x = dx * h * f;
    if (cheap) {
      segs.push(vcap(`leg${side}`, x, rl, hipY, rl, layer, { paint: "dark", foot: true, sharp: 0.6 }));
      joints.push({ id: `hip${side}`, a: "torso", b: `leg${side}`, at: [x, hipY], limits: [-1.4, 1.4], role: "hip" });
      legs.push({ hip: `hip${side}`, phase });
    } else {
      segs.push(vcap(`thigh${side}`, x, kneeY, hipY, rl, layer, { paint: "dark" }));
      segs.push(vcap(`shin${side}`, x, rl, kneeY, rl * 0.9, layer, { paint: "dark", foot: true, sharp: 0.6 }));
      joints.push({ id: `hip${side}`, a: "torso", b: `thigh${side}`, at: [x, hipY], limits: [-1.4, 1.4], role: "hip" });
      joints.push({ id: `knee${side}`, a: `thigh${side}`, b: `shin${side}`, at: [x, kneeY], limits: lim(f, -2.2, 0.05), role: "knee" });
      legs.push({ hip: `hip${side}`, knee: `knee${side}`, phase });
    }
  }

  const armSides = cheap ? (["F"] as const) : (["B", "F"] as const);
  let weaponLen = 0;
  for (const side of armSides) {
    const layer = side === "F" ? 2 : 0;
    const upper = vcap(`uarm${side}`, 0, elY, shY, ra, layer);
    const lower = vcap(`farm${side}`, 0, handY, elY, ra * 0.9, layer);
    // Fist at the end of the forearm.
    lower.colliders.push(col({ shape: { kind: "ball", r: ra * 1.25 }, offset: [0, -(elY - handY) / 2], striker: side === "F", sharp: 1 }));
    if (side === "F" && s.weapon !== "none") {
      const w = WEAPONS[s.weapon];
      const len = w.len * Math.min(1.4, Math.max(0.6, h / 1.78));
      weaponLen = len;
      lower.colliders.push(
        col({
          shape: { kind: "capsule", hh: len / 2, r: w.r },
          offset: [f * (len / 2), -(elY - handY) / 2],
          rot: Math.PI / 2,
          densityMul: w.density,
          sharp: w.sharp,
          paint: w.paint,
          striker: true,
        }),
      );
    }
    segs.push(upper, lower);
    joints.push({ id: `shoulder${side}`, a: "torso", b: `uarm${side}`, at: [0, shY], limits: lim(f, -1.2, 3.0), role: "shoulder" });
    joints.push({ id: `elbow${side}`, a: `uarm${side}`, b: `farm${side}`, at: [0, elY], limits: lim(f, -0.05, 2.4), role: "elbow" });
    arms.push({ shoulder: `shoulder${side}`, elbow: `elbow${side}` });
  }

  return {
    segments: segs,
    joints,
    torso: "torso",
    head: "head",
    strikeSeg: "farmF",
    standY: (hipY + torsoTop) / 2,
    reach: 0.42 * h + weaponLen,
    halfWidth: rt,
    legs,
    arms,
  };
}

function quadruped(s: UnitSpec, f: number): Blueprint {
  const L = s.size;
  const legLen = 0.3 * L, bodyR = 0.12 * L, rl = 0.045 * L;
  const bodyY = legLen + bodyR * 0.5;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const legs: Blueprint["legs"] = [];
  segs.push({
    id: "torso",
    pos: [0, bodyY],
    layer: 1,
    colliders: [col({ shape: { kind: "capsule", hh: 0.26 * L, r: bodyR }, rot: Math.PI / 2, sharp: 0.5 })],
  });
  const legSpec = [
    ["FF", f * 0.27, 0, 0],
    ["FN", f * 0.29, 2, 0.5],
    ["BF", -f * 0.27, 0, 0.5],
    ["BN", -f * 0.25, 2, 0],
  ] as const;
  for (const [id, x0, layer, phase] of legSpec) {
    const x = x0 * L;
    segs.push(vcap(`leg${id}`, x, rl, bodyY, rl, layer, { paint: layer === 0 ? "accent" : "body", foot: true, sharp: 0.8 }));
    joints.push({ id: `hip${id}`, a: "torso", b: `leg${id}`, at: [x, bodyY], limits: [-1.0, 1.0], role: "hip" });
    legs.push({ hip: `hip${id}`, phase });
  }
  const headR = 0.11 * L;
  segs.push({
    id: "head",
    pos: [f * 0.47 * L, bodyY + 0.1 * L],
    layer: 1,
    colliders: [
      col({ shape: { kind: "ball", r: headR }, striker: true, sharp: 1.6 }),
      col({ shape: { kind: "ball", r: headR * 0.55 }, offset: [f * headR * 0.9, -headR * 0.3], striker: true, sharp: 2, paint: "accent" }),
    ],
  });
  joints.push({ id: "neck", a: "torso", b: "head", at: [f * 0.36 * L, bodyY + 0.04 * L], limits: [-0.8, 0.8], role: "neck" });
  segs.push({
    id: "tail",
    pos: [-f * 0.44 * L, bodyY + 0.08 * L],
    layer: 1,
    colliders: [col({ shape: { kind: "capsule", hh: 0.09 * L, r: 0.025 * L }, rot: -f * 0.9, paint: "accent" })],
  });
  joints.push({ id: "tail", a: "torso", b: "tail", at: [-f * 0.36 * L, bodyY + 0.03 * L], limits: [-1, 1], role: "tail" });
  return { segments: segs, joints, torso: "torso", head: "head", strikeSeg: "head", standY: bodyY, reach: 0.62 * L, halfWidth: 0.3 * L, legs, arms: [] };
}

function bird(s: UnitSpec, f: number): Blueprint {
  const h = s.size;
  const bodyY = 0.42 * h;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const legs: Blueprint["legs"] = [];
  segs.push({ id: "torso", pos: [0, bodyY], layer: 1, colliders: [col({ shape: { kind: "capsule", hh: 0.1 * h, r: 0.17 * h }, rot: Math.PI / 2 })] });
  segs.push({
    id: "neck",
    pos: [f * 0.22 * h, 0.62 * h],
    layer: 1,
    colliders: [
      col({ shape: { kind: "capsule", hh: 0.11 * h, r: 0.045 * h } }),
      col({ shape: { kind: "ball", r: 0.07 * h }, offset: [f * 0.02 * h, 0.15 * h] }),
      col({ shape: { kind: "box", hx: 0.065 * h, hy: 0.022 * h }, offset: [f * 0.12 * h, 0.14 * h], paint: "accent", striker: true, sharp: 1.8 }),
    ],
  });
  joints.push({ id: "neck", a: "torso", b: "neck", at: [f * 0.2 * h, 0.5 * h], limits: [-0.9, 0.9], role: "neck" });
  for (const [side, x, layer, phase] of [["B", -0.04, 0, 0], ["F", 0.04, 2, 0.5]] as const) {
    segs.push(vcap(`leg${side}`, x * h * f, 0.02 * h, 0.3 * h, 0.022 * h, layer, { paint: "accent", foot: true }));
    joints.push({ id: `hip${side}`, a: "torso", b: `leg${side}`, at: [x * h * f, 0.3 * h], limits: [-1, 1], role: "hip" });
    legs.push({ hip: `hip${side}`, phase });
  }
  segs.push({ id: "wing", pos: [-f * 0.13 * h, 0.52 * h], layer: 2, colliders: [col({ shape: { kind: "capsule", hh: 0.13 * h, r: 0.045 * h }, rot: Math.PI / 2, densityMul: 0.4 })] });
  joints.push({ id: "wing", a: "torso", b: "wing", at: [0, 0.52 * h], limits: [-1.4, 1.4], role: "wing" });
  return { segments: segs, joints, torso: "torso", head: "neck", strikeSeg: "neck", standY: bodyY, reach: 0.45 * h, halfWidth: 0.25 * h, legs, arms: [] };
}

function wheeled(s: UnitSpec, f: number): Blueprint {
  const d = s.size;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const chassis: ColliderBP[] = [col({ shape: { kind: "box", hx: 0.5 * d, hy: 0.12 * d }, sharp: 0.6, striker: true })];
  if (s.weapon !== "none") {
    const w = WEAPONS[s.weapon];
    chassis.push(
      col({ shape: { kind: "capsule", hh: w.len / 2, r: w.r }, offset: [f * (0.5 * d + w.len / 2), 0.04 * d], rot: Math.PI / 2, densityMul: w.density, sharp: w.sharp, paint: w.paint, striker: true }),
    );
  }
  segs.push({ id: "torso", pos: [0, 0.24 * d], layer: 1, colliders: chassis });
  for (const [side, x] of [["B", -0.32], ["F", 0.32]] as const) {
    segs.push({ id: `wheel${side}`, pos: [x * d, 0.11 * d], layer: 2, colliders: [col({ shape: { kind: "ball", r: 0.11 * d }, paint: "dark", foot: true })] });
    joints.push({ id: `wheel${side}`, a: "torso", b: `wheel${side}`, at: [x * d, 0.11 * d], limits: null, role: "wheel" });
  }
  const wl = s.weapon === "none" ? 0 : WEAPONS[s.weapon].len;
  return { segments: segs, joints, torso: "torso", head: "torso", strikeSeg: "torso", standY: 0.24 * d, reach: 0.5 * d + wl, halfWidth: 0.5 * d, legs: [], arms: [] };
}

/** Large crowds get cheaper bodies. A performance decision, never an AI one. */
export const CHEAP_ABOVE = 30;

export function buildBlueprint(s: UnitSpec, facing: 1 | -1, crowd: number): Blueprint {
  switch (s.plan) {
    case "biped":
      return biped(s, facing, crowd > CHEAP_ABOVE);
    case "quadruped":
      return quadruped(s, facing);
    case "bird":
      return bird(s, facing);
    case "wheeled":
      return wheeled(s, facing);
  }
}

export function shapeArea(sh: Shape): number {
  if (sh.kind === "ball") return Math.PI * sh.r * sh.r;
  if (sh.kind === "capsule") return 4 * sh.hh * sh.r + Math.PI * sh.r * sh.r;
  return 4 * sh.hx * sh.hy;
}
