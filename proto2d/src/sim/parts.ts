// Building blocks shared by every body: capsule limbs, joint chains, drawn features.
import type { ColliderBP, DecoBP, DecoShape, JointBP, JointRole, Paint, SegmentBP, Shape } from "./plans";
import type { DType, Features, Weapon } from "./spec";

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const col = (p: Partial<ColliderBP> & { shape: Shape }): ColliderBP => ({ offset: [0, 0], rot: 0, densityMul: 1, sharp: 0.4, paint: "body", foot: false, ...p });
export const deco = (shape: DecoShape, offset: [number, number] = [0, 0], p: Partial<DecoBP> = {}): DecoBP => ({ shape, offset, rot: 0, paint: "body", front: false, ...p });
/** Triangle with points written for a unit facing +x, mirrored by f. */
export const tri = (f: number, pts: [number, number][], p: Partial<DecoBP> = {}) => deco({ kind: "tri", pts: pts.map(([x, y]) => [x * f, y] as [number, number]) }, [0, 0], p);
export const lim = (f: number, a: number, b: number): [number, number] => (f > 0 ? [a, b] : [-b, -a]);
/** World angle: forward (the way f faces) tilted up by t radians. */
export const fwd = (f: number, t: number) => (f > 0 ? t : Math.PI - t);
/** World angle: backward tilted up by t radians. */
export const bwd = (f: number, t: number) => (f > 0 ? Math.PI - t : t);
export const at = (p: [number, number], ang: number, d: number): [number, number] => [p[0] + Math.cos(ang) * d, p[1] + Math.sin(ang) * d];
/**
 * Limbs must never spawn inside the floor (the solver launches them). If a limb of length L from A
 * along `ang` would end below `floor`, tilt it toward horizontal, keeping its left/right direction.
 */
export function safeAngle(A: [number, number], ang: number, L: number, floor: number): number {
  if (A[1] + Math.sin(ang) * L >= floor) return ang;
  const s = clamp((floor - A[1]) / L, -1, 1);
  const up = Math.asin(s);
  return Math.cos(ang) >= 0 ? up : Math.PI - up;
}

export const WEAPONS: Record<Exclude<Weapon, "none">, { len: number; r: number; density: number; sharp: number; paint: Paint; dtype: DType }> = {
  sword: { len: 0.55, r: 0.018, density: 4, sharp: 2.2, paint: "metal", dtype: "slash" },
  knife: { len: 0.16, r: 0.014, density: 4, sharp: 2.2, paint: "metal", dtype: "slash" },
  club: { len: 0.4, r: 0.04, density: 2, sharp: 1.5, paint: "dark", dtype: "blunt" },
  spear: { len: 0.9, r: 0.016, density: 2.5, sharp: 2.4, paint: "dark", dtype: "pierce" },
};

export class Builder {
  segs: SegmentBP[] = [];
  joints: JointBP[] = [];
  constructor(readonly f: number) {}

  seg(id: string, pos: [number, number], layer: 0 | 1 | 2, colliders: ColliderBP[], deco: DecoBP[] = []): SegmentBP {
    const s: SegmentBP = { id, pos, layer, colliders, deco };
    this.segs.push(s);
    return s;
  }
  get(id: string) {
    return this.segs.find((s) => s.id === id)!;
  }
  /** Capsule segment from A to B. */
  limb(id: string, A: [number, number], B: [number, number], r: number, layer: 0 | 1 | 2, p: Partial<ColliderBP> = {}): SegmentBP {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const th = Math.atan2(B[1] - A[1], B[0] - A[0]);
    return this.seg(id, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], layer, [col({ shape: { kind: "capsule", hh: Math.max(0.004, L / 2 - r * 0.3), r }, rot: th - Math.PI / 2, ...p })]);
  }
  joint(id: string, a: string, b: string, p: [number, number], limits: [number, number] | null, role: JointRole, torqueMul?: number) {
    this.joints.push({ id, a, b, at: p, limits, role, torqueMul });
    return id;
  }
  /** n capsules from A along ang, bending by `bend` per segment, radius r0 -> r1. */
  chain(prefix: string, parent: string, A: [number, number], ang: number, L: number, n: number, r0: number, r1: number, layer: 0 | 1 | 2, role: JointRole, limits: [number, number], bend = 0, p: Partial<ColliderBP> = {}) {
    const ids: string[] = [];
    let a = A, th = ang, prev = parent;
    for (let i = 0; i < n; i++) {
      const b = at(a, th, L / n);
      const id = `${prefix}${i}`;
      this.limb(id, a, b, r0 + ((r1 - r0) * i) / Math.max(1, n - 1), layer, p);
      this.joint(id, prev, id, a, limits, role);
      ids.push(id);
      prev = id;
      a = b;
      th += bend;
    }
    return { ids, tip: a, ang: th - bend };
  }
}

export function pattern(F: Features, hl: number, r: number, vertical = false): DecoBP[] {
  const out: DecoBP[] = [];
  if (F.pattern === "stripes") {
    for (let i = 0; i < 5; i++) {
      const t = -hl * 0.7 + (i * hl * 1.4) / 4;
      out.push(deco({ kind: "box", hx: r * 0.09, hy: r * 0.8 }, vertical ? [0, t] : [t, r * 0.1], { paint: "dark", front: true, rot: vertical ? Math.PI / 2 : 0.15 }));
    }
  } else if (F.pattern === "spots") {
    for (const [x, y] of [[-0.55, 0.3], [-0.15, -0.2], [0.2, 0.35], [0.5, -0.1], [-0.35, -0.45], [0.05, 0.05]] as const)
      out.push(deco({ kind: "ball", r: r * 0.2 }, vertical ? [y * r, x * hl] : [x * hl, y * r], { paint: "dark", front: true }));
  }
  return out;
}

/** Ears, horns, mane for a round head of radius r. */
export function headDeco(F: Features, f: number, r: number): DecoBP[] {
  const out: DecoBP[] = [];
  if (F.mane) out.push(deco({ kind: "ball", r: r * 1.45 }, [-f * r * 0.25, r * 0.05], { paint: "hair" }));
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

/** Eyes, mouth and headwear for a round head of radius r. */
export function faceDeco(F: Features, f: number, r: number, side = false): DecoBP[] {
  const out: DecoBP[] = [];
  const e = F.eyes;
  const er = r * (e === "big" ? 0.3 : 0.2);
  const eye = (x: number, y: number, rr = er) => out.push(deco({ kind: "ball", r: rr }, [f * x * r, y * r], { paint: e === "glowing" ? "glow" : "eye", front: true }));
  if (e === "one") eye(0.4, 0.15, r * 0.32);
  else if (e === "three") { eye(0.25, 0.3, r * 0.16); eye(0.62, 0.3, r * 0.16); eye(0.45, 0.62, r * 0.16); }
  else if (side) eye(0.45, 0.22); // a profile shows one eye
  else { eye(0.22, 0.18); eye(0.62, 0.18); }
  if (e === "angry") out.push(tri(f, [[0.05 * r, 0.52 * r], [0.85 * r, 0.3 * r], [0.85 * r, 0.42 * r]], { paint: "dark", front: true }));
  if (F.face === "robot") out.push(deco({ kind: "box", hx: 0.55 * r, hy: 0.22 * r }, [f * 0.4 * r, 0.18 * r], { paint: "dark", front: true }), deco({ kind: "capsule", hh: 0.3 * r, r: 0.05 * r }, [0, 1.2 * r], { paint: "metal" }));
  if (F.face === "skull") out.push(deco({ kind: "box", hx: 0.35 * r, hy: 0.08 * r }, [f * 0.35 * r, -0.45 * r], { paint: "dark", front: true }));
  const m = F.mouth;
  if (m === "smile" || m === "frown") out.push(deco({ kind: "box", hx: 0.28 * r, hy: 0.05 * r }, [f * 0.45 * r, -0.38 * r], { paint: "dark", front: true, rot: (m === "smile" ? -0.25 : 0.25) * f }));
  if (m === "fangs") {
    out.push(deco({ kind: "box", hx: 0.32 * r, hy: 0.07 * r }, [f * 0.45 * r, -0.4 * r], { paint: "dark", front: true }));
    for (const x of [0.25, 0.6]) out.push(tri(f, [[x * r, -0.36 * r], [(x + 0.12) * r, -0.36 * r], [(x + 0.06) * r, -0.62 * r]], { paint: "bone", front: true }));
  }
  if (m === "beak") out.push(tri(f, [[0.7 * r, 0.05 * r], [0.7 * r, -0.35 * r], [1.35 * r, -0.2 * r]], { paint: "gold" }));
  switch (F.headwear) {
    case "helmet": out.push(deco({ kind: "box", hx: 1.05 * r, hy: 0.55 * r }, [0, 0.45 * r], { paint: "metal", front: true }), deco({ kind: "box", hx: 0.5 * r, hy: 0.06 * r }, [f * 0.45 * r, 0.25 * r], { paint: "dark", front: true })); break;
    case "crown": out.push(tri(f, [[-0.7 * r, 0.75 * r], [0.7 * r, 0.75 * r], [0, 1.5 * r]], { paint: "gold" }), tri(f, [[-0.8 * r, 0.7 * r], [-0.2 * r, 0.7 * r], [-0.65 * r, 1.35 * r]], { paint: "gold" }), tri(f, [[0.2 * r, 0.7 * r], [0.8 * r, 0.7 * r], [0.65 * r, 1.35 * r]], { paint: "gold" })); break;
    case "tophat": out.push(deco({ kind: "box", hx: 0.6 * r, hy: 0.6 * r }, [0, 1.35 * r], { paint: "dark" }), deco({ kind: "box", hx: 1.0 * r, hy: 0.1 * r }, [0, 0.8 * r], { paint: "dark" })); break;
    case "wizard": out.push(tri(f, [[-1.0 * r, 0.65 * r], [1.0 * r, 0.65 * r], [-0.3 * r, 2.4 * r]], { paint: "accent" })); break;
    case "cap": out.push(deco({ kind: "box", hx: 0.9 * r, hy: 0.35 * r }, [0, 0.7 * r], { paint: "accent" }), deco({ kind: "box", hx: 0.55 * r, hy: 0.08 * r }, [f * 0.9 * r, 0.45 * r], { paint: "accent" })); break;
    case "spiky_hair": for (let i = 0; i < 4; i++) out.push(tri(f, [[(-0.8 + i * 0.45) * r, 0.55 * r], [(-0.4 + i * 0.45) * r, 0.6 * r], [(-0.75 + i * 0.45) * r, 1.3 * r]], { paint: "hair" })); break;
    case "long_hair": out.push(deco({ kind: "capsule", hh: 0.6 * r, r: 0.55 * r }, [-f * 0.45 * r, -0.1 * r], { paint: "hair" }), deco({ kind: "ball", r: 1.02 * r }, [-f * 0.05 * r, 0.25 * r], { paint: "hair" })); break;
    case "halo": out.push(deco({ kind: "box", hx: 0.7 * r, hy: 0.07 * r }, [0, 1.35 * r], { paint: "glow" })); break;
  }
  return out;
}
