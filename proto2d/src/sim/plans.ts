// Blueprint types and dispatch. genomeBody (body.ts) builds any creature from a Genome;
// modelBody wraps an artist-rigged model with the same combat contract.
import { MODEL_BY_ID, type GroupRole, type Model } from "../models/models";
import { genomeBody, movesFor } from "./body";
import { genomeOf, type DType, type Genome, type Loco, type UnitSpec, type Verb } from "./spec";

export type Shape =
  | { kind: "ball"; r: number }
  | { kind: "capsule"; hh: number; r: number }
  | { kind: "box"; hx: number; hy: number };
export type DecoShape = Shape | { kind: "tri"; pts: [number, number][] };

export type Paint =
  | "body" | "accent" | "metal" | "dark" | "bone" | "eye" | "red" | "shine" | "gold" | "glow" | "hair" | "belly" | "cape" | "membrane" | "shell";

export interface ColliderBP {
  shape: Shape;
  offset: [number, number];
  rot: number;
  densityMul: number;
  sharp: number;
  paint: Paint;
  foot: boolean;
  /** Overrides the move's damage type: a blade hand slashes whatever the verb. */
  dtype?: DType;
}

export interface DecoBP {
  shape: DecoShape;
  offset: [number, number];
  rot: number;
  paint: Paint;
  front: boolean;
}

export interface SegmentBP {
  id: string;
  pos: [number, number];
  layer: 0 | 1 | 2;
  colliders: ColliderBP[];
  deco?: DecoBP[];
}

export type JointRole = "hip" | "knee" | "shoulder" | "elbow" | "neck" | "tail" | "wing" | "wheel" | "spine" | "tentacle";

export interface JointBP {
  id: string;
  a: string;
  b: string;
  at: [number, number];
  limits: [number, number] | null;
  role: JointRole;
  torqueMul?: number;
}

export interface MoveBP {
  verb: Verb;
  segs: string[];
  reach: number;
}

export interface ModelLayout {
  model: Model;
  scale: number;
  flip: 1 | -1;
  centre: Record<string, [number, number]>;
}

export interface Blueprint {
  segments: SegmentBP[];
  joints: JointBP[];
  torso: string;
  head: string;
  heads: string[];
  standY: number;
  halfWidth: number;
  reach: number;
  legs: { hip: string; knee?: string; phase: number }[];
  arms: { shoulder: string; elbow?: string }[];
  necks: string[][];
  wings: string[];
  tails: string[];
  tentacles: string[][];
  wave: string[];
  moves: MoveBP[];
  mouth: string;
  loco: Loco;
  genome: Genome;
  model?: ModelLayout;
}

/** Large crowds get cheaper bodies. A performance decision, never an AI one. */
export const CHEAP_ABOVE = 24;
export const HUGE_ABOVE = 60;

export function buildBlueprint(s: UnitSpec, facing: 1 | -1, crowd: number): Blueprint {
  const g = genomeOf(s);
  const model = s.model ? MODEL_BY_ID.get(s.model) : undefined;
  // Rigged models are expensive (many segments plus a skinned mesh each): crowds use the cheap genome body.
  if (model && crowd <= CHEAP_ABOVE) return modelBody(s, facing, model, g);
  return genomeBody(s, g, facing, crowd > CHEAP_ABOVE, crowd > HUGE_ABOVE);
}

export function shapeArea(sh: Shape): number {
  if (sh.kind === "ball") return Math.PI * sh.r * sh.r;
  if (sh.kind === "capsule") return 4 * sh.hh * sh.r + Math.PI * sh.r * sh.r;
  return 4 * sh.hx * sh.hy;
}

// ---------- artist-rigged models: one physics body per bone group ----------

const ROLE_JOINT: Record<GroupRole, JointRole> = { torso: "spine", neck: "neck", head: "neck", leg: "hip", tail: "tail", limb: "shoulder" };

function modelBody(s: UnitSpec, f: 1 | -1, model: Model, g: Genome): Blueprint {
  const k = s.size / model.length;
  const P = (p: [number, number]): [number, number] => [p[0] * k * f, p[1] * k];
  const segs: SegmentBP[] = [];
  const joints: JointBP[] = [];
  const centre: Record<string, [number, number]> = {};
  const torsoDepth = model.groups.find((q) => q.role === "torso")!.depth;
  const H = model.height * k;
  const isFoot = (id: string) => model.groups.find((q) => q.id === id)!.role === "leg" && !model.groups.some((c) => c.parent === id);
  const feet: string[] = [];
  for (const q of model.groups) {
    const A = P(q.a), B = P(q.b);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const cap = q.role === "torso" ? 0.6 : q.role === "head" || q.role === "neck" ? 0.5 : 0.3;
    const r = Math.max(0.02 * H, Math.min(q.r * k * 0.85, cap * Math.max(L, 0.15 * H)));
    const th = Math.atan2(B[1] - A[1], B[0] - A[0]);
    const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const foot = isFoot(q.id);
    if (foot) feet.push(q.id);
    const cols: ColliderBP[] = [{
      shape: { kind: "capsule", hh: Math.max(0.005, L / 2 - r * 0.3), r }, offset: [0, 0], rot: th - Math.PI / 2,
      sharp: q.role === "head" ? 1.8 : q.role === "leg" ? 0.9 : 0.4, paint: "body", densityMul: q.role === "tail" ? 0.4 : 1, foot,
    }];
    if (foot) {
      const low = A[1] < B[1] ? A : B;
      const fr = Math.max(0.015 * H, r);
      cols.push({ shape: { kind: "ball", r: fr }, offset: [low[0] - mid[0], fr - mid[1] + 0.001], rot: 0, densityMul: 1, sharp: 0.9, paint: "dark", foot: true });
    }
    segs.push({ id: q.id, pos: mid, layer: q.role === "leg" || q.role === "limb" ? (q.depth > torsoDepth ? 0 : 2) : 1, colliders: cols });
    centre[q.id] = mid;
    if (q.parent) {
      const lim = model.limits[q.id];
      joints.push({ id: q.id, a: q.parent, b: q.id, at: A, limits: f > 0 ? lim : [-lim[1], -lim[0]], role: ROLE_JOINT[q.role], torqueMul: q.role === "leg" ? 1.4 : 1 });
    }
  }
  const torso = segs.find((q) => q.id === "torso")!;
  const xs = segs.map((q) => q.pos[0]);
  const front = feet.sort((a, b) => f * (centre[b][0] - centre[a][0]))[0];
  const moves = movesFor(g, { head: ["head"], arm: [], leg: front ? [front] : [], tail: model.groups.filter((q) => q.role === "tail").slice(-1).map((q) => q.id), tentacle: [], body: ["torso"] }, (id) => Math.abs(centre[id][0] - torso.pos[0]) + 0.15 * s.size);
  return {
    segments: segs, joints, torso: "torso", head: "head", heads: ["head"], standY: torso.pos[1],
    halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2, reach: Math.max(...moves.map((m) => m.reach)),
    legs: [], arms: [], necks: [], wings: [], tails: [], tentacles: [], wave: [], moves, mouth: "head",
    loco: "walk", genome: g, model: { model, scale: k, flip: f, centre },
  };
}
