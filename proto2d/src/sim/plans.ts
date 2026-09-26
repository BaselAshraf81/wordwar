// Body plans as data. One builder per plan turns a UnitSpec into a blueprint;
// battle.ts turns any blueprint into Rapier bodies. Nothing here reads spec.label.
import { featuresOf, type Features, type UnitSpec, type Weapon } from "./spec";

export type Shape =
  | { kind: "ball"; r: number }
  | { kind: "capsule"; hh: number; r: number }
  | { kind: "box"; hx: number; hy: number };

export type Paint = "body" | "accent" | "metal" | "dark" | "bone" | "eye" | "red" | "shine";

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

/** Drawn but not simulated: ears, fins, stripes, eyes on odd heads. Positions are body-local. */
export type DecoShape = Shape | { kind: "tri"; pts: [number, number][] };
export interface DecoBP {
  shape: DecoShape;
  offset: [number, number];
  rot: number;
  paint: Paint;
  front: boolean; // draw over the segment's colliders (patterns) instead of behind (ears, fins)
}

export interface SegmentBP {
  id: string;
  pos: [number, number]; // world position at spawn, unit origin at feet
  layer: 0 | 1 | 2; // 0 far limbs, 1 body, 2 near limbs
  colliders: ColliderBP[];
  deco?: DecoBP[];
}

export type JointRole = "hip" | "knee" | "shoulder" | "elbow" | "neck" | "tail" | "wing" | "wheel" | "spine";

export interface JointBP {
  id: string;
  a: string;
  b: string;
  at: [number, number]; // world anchor at spawn
  limits: [number, number] | null;
  role: JointRole;
  torqueMul?: number;
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
  /** Locomotion without legs. */
  move?: "flop" | "slither" | "hop";
  /** Spine joints that undulate, head to tail. */
  wave?: string[];
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


// ---------- decoration helpers (drawn, not simulated) ----------

const deco = (shape: DecoShape, offset: [number, number] = [0, 0], p: Partial<DecoBP> = {}): DecoBP => ({ shape, offset, rot: 0, paint: "body", front: false, ...p });
const tri = (f: number, pts: [number, number][], p: Partial<DecoBP> = {}) => deco({ kind: "tri", pts: pts.map(([x, y]) => [x * f, y] as [number, number]) }, [0, 0], p);
const eye = (x: number, y: number, r: number) => deco({ kind: "ball", r }, [x, y], { paint: "eye", front: true });

/** Stripes or spots over a horizontal body of half length hl and radius r. */
function pattern(F: Features, hl: number, r: number): DecoBP[] {
  const out: DecoBP[] = [];
  if (F.pattern === "stripes") {
    for (let i = 0; i < 5; i++) out.push(deco({ kind: "box", hx: r * 0.09, hy: r * 0.8 }, [-hl * 0.7 + (i * hl * 1.4) / 4, r * 0.1], { paint: "dark", front: true, rot: 0.15 }));
  } else if (F.pattern === "spots") {
    const at: [number, number][] = [[-0.55, 0.3], [-0.15, -0.2], [0.2, 0.35], [0.5, -0.1], [-0.35, -0.45], [0.05, 0.05]];
    for (const [x, y] of at) out.push(deco({ kind: "ball", r: r * 0.2 }, [x * hl, y * r], { paint: "dark", front: true }));
  }
  return out;
}

/** Ears, horns and mane for a ball head of radius r. */
function headDeco(F: Features, f: number, r: number): DecoBP[] {
  const out: DecoBP[] = [];
  if (F.mane) out.push(deco({ kind: "ball", r: r * 1.45 }, [-f * r * 0.25, r * 0.05], { paint: "accent" }));
  if (F.ears === "round") out.push(deco({ kind: "ball", r: r * 0.36 }, [-f * r * 0.35, r * 0.85]));
  if (F.ears === "pointy") out.push(tri(f, [[-r * 0.65, r * 0.55], [-r * 0.05, r * 0.7], [-r * 0.4, r * 1.45]]));
  if (F.ears === "long") out.push(deco({ kind: "capsule", hh: r * 0.6, r: r * 0.2 }, [-f * r * 0.45, r * 1.35], { rot: f * 0.35 }));
  if (F.horns === "short") out.push(tri(f, [[-r * 0.05, r * 0.75], [r * 0.3, r * 0.7], [r * 0.2, r * 1.3]], { paint: "bone" }));
  if (F.horns === "long") out.push(tri(f, [[-r * 0.25, r * 0.7], [r * 0.15, r * 0.75], [-r * 0.6, r * 2.1]], { paint: "bone" }));
  if (F.horns === "antlers") {
    out.push(deco({ kind: "capsule", hh: r * 0.7, r: r * 0.08 }, [-f * r * 0.35, r * 1.5], { paint: "bone", rot: f * 0.4 }));
    out.push(deco({ kind: "capsule", hh: r * 0.35, r: r * 0.07 }, [-f * r * 0.05, r * 1.75], { paint: "bone", rot: -f * 0.6 }));
    out.push(deco({ kind: "capsule", hh: r * 0.3, r: r * 0.07 }, [-f * r * 0.75, r * 1.9], { paint: "bone", rot: f * 0.9 }));
  }
  return out;
}

function quadruped(s: UnitSpec, f: number): Blueprint {
  const F = featuresOf(s);
  const L = s.size;
  const bodyR = 0.12 * L * F.bulk;
  const bodyHalf = 0.26 * L * F.bodyLength;
  const legLen = 0.3 * L * F.legLength;
  const rl = 0.045 * L * Math.sqrt(F.bulk);
  const bodyY = legLen + bodyR * 0.5;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const legs: Blueprint["legs"] = [];

  const torsoDeco = pattern(F, bodyHalf, bodyR);
  if (F.spikes) for (let i = 0; i < 5; i++) torsoDeco.push(tri(f, [[-bodyHalf * 0.8 + i * bodyHalf * 0.35, bodyR * 0.8], [-bodyHalf * 0.6 + i * bodyHalf * 0.35, bodyR * 0.8], [-bodyHalf * 0.72 + i * bodyHalf * 0.35, bodyR * 1.45]], { paint: "accent" }));
  if (F.dorsalFin) torsoDeco.push(tri(f, [[-bodyHalf * 0.3, bodyR * 0.8], [bodyHalf * 0.2, bodyR * 0.8], [-bodyHalf * 0.25, bodyR * 1.9]], { paint: "accent" }));
  segs.push({
    id: "torso",
    pos: [0, bodyY],
    layer: 1,
    colliders: [col({ shape: { kind: "capsule", hh: Math.max(0.01, bodyHalf - bodyR * 0.3), r: bodyR }, rot: Math.PI / 2, sharp: 0.5 })],
    deco: torsoDeco,
  });
  const legX = bodyHalf * 0.85;
  const legSpec = [
    ["FF", f * legX, 0, 0],
    ["FN", f * (legX + rl * 0.4), 2, 0.5],
    ["BF", -f * legX, 0, 0.5],
    ["BN", -f * (legX - rl * 0.4), 2, 0],
  ] as const;
  for (const [id, x, layer, phase] of legSpec) {
    segs.push(vcap(`leg${id}`, x, rl, bodyY, rl, layer, { paint: layer === 0 ? "accent" : "body", foot: true, sharp: 0.8 }));
    joints.push({ id: `hip${id}`, a: "torso", b: `leg${id}`, at: [x, bodyY], limits: [-1.0, 1.0], role: "hip" });
    legs.push({ hip: `hip${id}`, phase });
  }

  const longNeck = F.neckLength > 1.35;
  const headR = 0.1 * L * (0.8 + 0.2 * F.bulk) * (longNeck ? 0.6 : 1);
  const shoulder: [number, number] = [f * (bodyHalf + bodyR * 0.1), bodyY + bodyR * 0.35];
  let headPos: [number, number];
  let headParent = "torso";
  let headAt = shoulder;
  if (longNeck) {
    const nl = 0.17 * L * F.neckLength;
    const th = 1.15; // radians above horizontal
    const dx = f * Math.cos(th), dy = Math.sin(th);
    segs.push({
      id: "neckseg",
      pos: [shoulder[0] + (dx * nl) / 2, shoulder[1] + (dy * nl) / 2],
      layer: 1,
      colliders: [col({ shape: { kind: "capsule", hh: nl / 2, r: rl * 1.1 }, rot: -f * (Math.PI / 2 - th), densityMul: 0.35 })],
    });
    joints.push({ id: "neck", a: "torso", b: "neckseg", at: shoulder, limits: lim(f, -0.5, 0.35), role: "neck", torqueMul: 2.5 + F.neckLength });
    headAt = [shoulder[0] + dx * nl, shoulder[1] + dy * nl];
    headParent = "neckseg";
    headPos = [headAt[0] + f * headR * 0.5, headAt[1] + headR * 0.2];
  } else {
    headPos = [shoulder[0] + f * headR * 0.7, bodyY + 0.1 * L * F.neckLength];
  }
  const sn = F.snout * 0.22 * L;
  const headCols = [col({ shape: { kind: "ball", r: headR }, striker: true, sharp: 1.6, densityMul: longNeck ? 0.5 : 1 })];
  const hd = headDeco(F, f, headR);
  if (sn > 0.03 * L) {
    headCols.push(col({ shape: { kind: "capsule", hh: sn / 2, r: headR * 0.48 }, offset: [f * (headR * 0.55 + sn / 2), -headR * 0.3], rot: Math.PI / 2, striker: true, sharp: 2 }));
    hd.push(deco({ kind: "ball", r: headR * 0.2 }, [f * (headR * 0.55 + sn + headR * 0.3), -headR * 0.2], { paint: "dark", front: true }));
    if (F.snout > 0.7) for (let i = 0; i < 4; i++) hd.push(tri(f, [[headR * 0.7 + i * sn * 0.22, -headR * 0.72], [headR * 0.85 + i * sn * 0.22, -headR * 0.72], [headR * 0.77 + i * sn * 0.22, -headR * 0.5]], { paint: "bone", front: true }));
  } else {
    headCols.push(col({ shape: { kind: "ball", r: headR * 0.4 }, offset: [f * headR * 0.85, -headR * 0.3], striker: true, sharp: 2, paint: "accent" }));
  }
  if (F.horns === "tusks") hd.push(tri(f, [[headR * 0.5, -headR * 0.7], [headR * 0.8, -headR * 0.6], [headR * 1.4 + sn, headR * 0.1]], { paint: "bone", front: true }));
  segs.push({ id: "head", pos: headPos, layer: 1, colliders: headCols, deco: hd });
  joints.push({ id: headParent === "torso" ? "neck" : "headj", a: headParent, b: "head", at: headParent === "torso" ? shoulder : headAt, limits: [-0.8, 0.8], role: "neck" });

  if (F.tail !== "none") {
    const tl = F.tail === "short" ? 0.06 * L : 0.13 * L;
    const tr = F.tail === "bushy" ? 0.06 * L : 0.022 * L;
    const base: [number, number] = [-f * (bodyHalf + bodyR * 0.2), bodyY + bodyR * 0.3];
    segs.push({
      id: "tail",
      pos: [base[0] - f * tl * 0.6, base[1] + tl * 0.8],
      layer: 1,
      colliders: [col({ shape: { kind: "capsule", hh: tl, r: tr }, rot: -f * 0.65, paint: F.tail === "bushy" ? "body" : "accent", densityMul: 0.5 })],
    });
    joints.push({ id: "tail", a: "torso", b: "tail", at: base, limits: [-1, 1], role: "tail" });
  }
  return {
    segments: segs, joints, torso: "torso", head: "head", strikeSeg: "head", standY: bodyY,
    reach: bodyHalf + headR * 2 + sn + 0.1 * L, halfWidth: bodyHalf + bodyR * 0.5, legs, arms: [],
  };
}

/** Sharks, megalodons, whales, piranhas: a three-piece spine that flops on land. */
function fish(s: UnitSpec, f: number): Blueprint {
  const F = featuresOf(s);
  const L = s.size * F.bodyLength;
  const R = 0.12 * L * F.bulk;
  const seg = 0.11 * L;
  const y = R;
  const hc = (r: number, p: Partial<ColliderBP> = {}) => col({ shape: { kind: "capsule", hh: seg, r }, rot: Math.PI / 2, foot: true, ...p });
  const sharkish = F.snout >= 0.45 || F.dorsalFin;
  const headDecos: DecoBP[] = [eye(f * seg * 0.55, R * 0.35, R * 0.16)];
  // Mouth line and teeth: a megalodon should look like it bites.
  headDecos.push(deco({ kind: "box", hx: seg * 0.55, hy: R * 0.05 }, [f * seg * 0.35, -R * 0.35], { paint: "dark", front: true, rot: f * 0.12 }));
  if (sharkish) for (let i = 0; i < 5; i++) headDecos.push(tri(f, [[seg * (-0.1 + i * 0.22), -R * 0.3], [seg * (0.05 + i * 0.22), -R * 0.3], [seg * (-0.02 + i * 0.22), -R * 0.6]], { paint: "bone", front: true }));
  const midDecos = [...pattern(F, seg * 1.5, R)];
  if (F.dorsalFin || sharkish) midDecos.push(tri(f, [[-seg * 0.55, R * 0.85], [seg * 0.45, R * 0.85], [-seg * 0.45, R * 0.85 + 0.17 * L]], { paint: "body" }));
  midDecos.push(tri(f, [[seg * 0.3, -R * 0.5], [seg * 0.8, -R * 0.4], [-seg * 0.1, -R * 1.25]], { paint: "accent" }));
  midDecos.push(deco({ kind: "capsule", hh: seg * 1.1, r: R * 0.4 }, [0, -R * 0.55], { paint: "bone", front: true, rot: Math.PI / 2 }));
  const tailDecos = [
    tri(f, [[-seg * 0.9, 0], [-seg * 1.9, R * 0.35 + 0.16 * L], [-seg * 1.25, 0]], { paint: "body" }),
    tri(f, [[-seg * 0.9, 0], [-seg * 1.7, -R * 0.2 - 0.1 * L], [-seg * 1.25, 0]], { paint: "body" }),
  ];
  const segs: SegmentBP[] = [
    { id: "head", pos: [f * seg * 2.05, y], layer: 1, colliders: [hc(R * 0.92, { striker: true, sharp: sharkish ? 2.4 : 1.4 })], deco: headDecos },
    { id: "torso", pos: [0, y], layer: 1, colliders: [hc(R, { sharp: 0.6 })], deco: midDecos },
    { id: "tail", pos: [-f * seg * 2.0, y], layer: 1, colliders: [hc(R * 0.6, { densityMul: 0.7 })], deco: tailDecos },
  ];
  const joints: JointBP[] = [
    { id: "neck", a: "torso", b: "head", at: [f * seg * 1.02, y], limits: [-0.5, 0.5], role: "neck" },
    { id: "spine1", a: "torso", b: "tail", at: [-f * seg * 1.0, y], limits: [-0.8, 0.8], role: "spine" },
  ];
  return { segments: segs, joints, torso: "torso", head: "head", strikeSeg: "head", standY: y, reach: seg * 3.4, halfWidth: seg * 3, legs: [], arms: [], move: "flop", wave: ["neck", "spine1"] };
}

/** Snakes, worms, eels, dragons without legs: a chain that slithers. */
function snake(s: UnitSpec, f: number): Blueprint {
  const F = featuresOf(s);
  const L = s.size * F.bodyLength;
  const n = 7;
  const seg = L / n;
  const r = Math.max(0.02, 0.045 * L * F.bulk);
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const wave: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = f * (L / 2 - seg * (i + 0.5));
    const head = i === 0;
    const rr = head ? r * 1.35 : r * (1 - (i / n) * 0.55);
    const d: DecoBP[] = [];
    if (head) {
      d.push(eye(f * seg * 0.15, rr * 0.35, rr * 0.28));
      d.push(tri(f, [[seg * 0.45, -rr * 0.1], [seg * 0.8, -rr * 0.25], [seg * 0.8, rr * 0.05]], { paint: "red" }));
    } else if (F.pattern === "stripes" && i % 2 === 0) d.push(deco({ kind: "box", hx: seg * 0.12, hy: rr * 0.95 }, [0, 0], { paint: "accent", front: true }));
    else if (F.pattern === "spots") d.push(deco({ kind: "ball", r: rr * 0.4 }, [0, rr * 0.2], { paint: "accent", front: true }));
    segs.push({
      id: head ? "head" : i === 3 ? "torso" : `s${i}`,
      pos: [x, r * 1.35],
      layer: 1,
      colliders: [col({ shape: { kind: "capsule", hh: seg / 2, r: rr }, rot: Math.PI / 2, foot: true, striker: head, sharp: head ? 2.2 : 0.4, paint: i % 2 && F.pattern === "plain" ? "body" : "body" })],
      deco: d,
    });
  }
  for (let i = 1; i < n; i++) {
    const a = segs[i - 1].id, b = segs[i].id;
    const id = i === 1 ? "neck" : `j${i}`;
    joints.push({ id, a, b, at: [f * (L / 2 - seg * i), r * 1.35], limits: [-0.9, 0.9], role: i === 1 ? "neck" : "spine" });
    wave.push(id);
  }
  return { segments: segs, joints, torso: "torso", head: "head", strikeSeg: "head", standY: r, reach: seg * 3.5, halfWidth: L * 0.3, legs: [], arms: [], move: "slither", wave };
}

/** Spiders, ants, beetles, scorpions: many thin legs in a tripod gait. */
function bug(s: UnitSpec, f: number): Blueprint {
  const F = featuresOf(s);
  const L = s.size;
  const legN = F.legs;
  const bodyR = 0.13 * L * F.bulk;
  const bodyHalf = 0.22 * L * F.bodyLength;
  const legLen = 0.24 * L * F.legLength;
  const rl = 0.018 * L;
  const bodyY = legLen + bodyR * 0.4;
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const legs: Blueprint["legs"] = [];
  segs.push({
    id: "torso",
    pos: [0, bodyY],
    layer: 1,
    colliders: [col({ shape: { kind: "capsule", hh: bodyHalf, r: bodyR }, rot: Math.PI / 2, sharp: 0.5 })],
    deco: [...pattern(F, bodyHalf, bodyR), ...(F.spikes ? [tri(f, [[-bodyHalf, bodyR * 0.6], [-bodyHalf * 0.6, bodyR * 0.9], [-bodyHalf * 1.3, bodyR * 2]], { paint: "accent" })] : [])],
  });
  const pairs = legN / 2;
  for (let i = 0; i < pairs; i++) {
    const x = f * bodyHalf * (0.8 - (1.6 * i) / Math.max(1, pairs - 1));
    for (const [side, layer] of [["F", 0], ["N", 2]] as const) {
      const id = `leg${i}${side}`;
      segs.push(vcap(id, x + (side === "N" ? f * rl : 0), rl, bodyY, rl, layer, { paint: "dark", foot: true, sharp: 0.6 }));
      joints.push({ id: `hip${i}${side}`, a: "torso", b: id, at: [x, bodyY], limits: [-1.0, 1.0], role: "hip" });
      legs.push({ hip: `hip${i}${side}`, phase: (i + (side === "N" ? 1 : 0)) % 2 ? 0.5 : 0 });
    }
  }
  const headR = 0.09 * L;
  const hd: DecoBP[] = [
    eye(f * headR * 0.35, headR * 0.3, headR * 0.3),
    tri(f, [[headR * 0.7, -headR * 0.2], [headR * 0.8, -headR * 0.55], [headR * 1.45, -headR * 0.6]], { paint: "dark" }),
  ];
  if (legN === 6) {
    hd.push(deco({ kind: "capsule", hh: headR * 0.9, r: headR * 0.07 }, [f * headR * 0.6, headR * 1.5], { paint: "dark", rot: -f * 0.5 }));
    hd.push(deco({ kind: "capsule", hh: headR * 0.9, r: headR * 0.07 }, [f * headR * 0.1, headR * 1.6], { paint: "dark", rot: -f * 0.2 }));
  }
  segs.push({
    id: "head",
    pos: [f * (bodyHalf + bodyR * 0.6 + headR * 0.6), bodyY + headR * 0.2],
    layer: 1,
    colliders: [col({ shape: { kind: "ball", r: headR }, striker: true, sharp: 1.8 })],
    deco: hd,
  });
  joints.push({ id: "neck", a: "torso", b: "head", at: [f * (bodyHalf + bodyR * 0.6), bodyY + headR * 0.1], limits: [-0.6, 0.6], role: "neck" });
  return { segments: segs, joints, torso: "torso", head: "head", strikeSeg: "head", standY: bodyY, reach: bodyHalf + headR * 3, halfWidth: bodyHalf + bodyR, legs, arms: [] };
}

/** Slimes, jellies, puddings, bouncy balls: one blob that hops into things. */
function blob(s: UnitSpec, f: number): Blueprint {
  const F = featuresOf(s);
  const r = s.size * 0.5 * Math.sqrt(F.bulk);
  const d: DecoBP[] = [
    eye(f * r * 0.15, r * 0.3, r * 0.17),
    eye(f * r * 0.55, r * 0.3, r * 0.17),
    deco({ kind: "box", hx: r * 0.22, hy: r * 0.05 }, [f * r * 0.35, -r * 0.1], { paint: "dark", front: true }),
    deco({ kind: "ball", r: r * 0.25 }, [-f * r * 0.35, r * 0.5], { paint: "shine", front: true }),
    ...pattern(F, r * 0.7, r * 0.6),
  ];
  const segs: SegmentBP[] = [{ id: "torso", pos: [0, r], layer: 1, colliders: [col({ shape: { kind: "ball", r }, foot: true, striker: true, sharp: 0.9 })], deco: d }];
  return { segments: segs, joints: [], torso: "torso", head: "torso", strikeSeg: "torso", standY: r, reach: r * 1.3, halfWidth: r, legs: [], arms: [], move: "hop" };
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
    case "fish":
      return fish(s, facing);
    case "snake":
      return snake(s, facing);
    case "bug":
      return bug(s, facing);
    case "blob":
      return blob(s, facing);
  }
}

export function shapeArea(sh: Shape): number {
  if (sh.kind === "ball") return Math.PI * sh.r * sh.r;
  if (sh.kind === "capsule") return 4 * sh.hh * sh.r + Math.PI * sh.r * sh.r;
  return 4 * sh.hx * sh.hy;
}