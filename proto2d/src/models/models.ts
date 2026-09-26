// Artist-rigged models exported by blender/export_models.py. Pure data, no three.js, so the
// simulation and tests can use it. Coordinates are Blender side view: x forward, z up.
import facts from "./facts.json";

export interface BoneFact {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  radius: number | null;
}
interface Fact {
  name: string;
  height: number;
  ground: number;
  xmin: number;
  xmax: number;
  bones: BoneFact[];
  clips: Record<string, Record<string, number>[]>;
}

export type BoneRole = "torso" | "spine" | "neck" | "head" | "tail" | "leg" | "foot";

export interface ModelBone {
  name: string;
  parent: string | null;
  role: BoneRole;
  /** Side-view (x forward, y up) head/tail in model units, ground at y = 0. */
  a: [number, number];
  b: [number, number];
  r: number;
  /** Blender y: smaller is nearer the camera. */
  depth: number;
  /** Physics body this bone rides on (feet ride on their shin). */
  body: string;
  /** Joint limits from the artist's animation range, with margin. */
  limits: [number, number];
}

export interface Model {
  id: string;
  url: string;
  length: number;
  height: number;
  /** Blender z of the ground, to lift glTF rest poses onto y = 0. */
  groundY: number;
  bones: ModelBone[];
  torso: string;
  head: string;
  clips: Record<string, Record<string, number>[]>;
}

const children = (bs: BoneFact[], n: string) => bs.filter((b) => b.parent === n);

function build(f: Fact): Model {
  const g = f.ground;
  const P = (v: number[]): [number, number] => [v[0], v[2] - g];
  const H = f.height;
  const byName = new Map(f.bones.map((b) => [b.name, b]));
  // Legs: chains whose leaf touches the ground. Feet: the leaf itself.
  const leaf = (n: string): BoneFact => {
    let b = byName.get(n)!;
    for (;;) {
      const c = children(f.bones, b.name);
      if (c.length !== 1) return b;
      b = c[0];
    }
  };
  const touches = (b: BoneFact) => Math.min(b.head[2], b.tail[2]) - g < 0.08 * H;
  const role = new Map<string, BoneRole>();
  const root = f.bones.find((b) => !b.parent)!;
  const len = (b: BoneFact) => Math.hypot(b.tail[0] - b.head[0], b.tail[2] - b.head[2]);
  // Torso: the biggest non-leg bone near the root.
  const spineCands = [root, ...children(f.bones, root.name)].filter((b) => !touches(leaf(b.name)));
  const torso = spineCands.reduce((a, b) => ((b.radius ?? 0) * len(b) > (a.radius ?? 0) * len(a) ? b : a));
  const mark = (n: string, r: BoneRole) => role.set(n, r);
  const walk = (b: BoneFact, r: BoneRole) => {
    mark(b.name, r);
    for (const c of children(f.bones, b.name)) walk(c, r);
  };
  for (const b of f.bones) {
    if (b === torso) continue;
    const parentIsSpine = !b.parent || b.parent === root.name || b.parent === torso.name;
    if (!parentIsSpine || role.has(b.name)) continue;
    const L = leaf(b.name);
    if (b === root) continue;
    if (touches(L)) walk(b, "leg");
    else if (L.head[0] > torso.head[0]) walk(b, "neck");
    else walk(b, "tail");
  }
  mark(torso.name, "torso");
  if (root !== torso) mark(root.name, "spine");
  // The last bone of the neck chain is the head; the ground-touching leaf of a leg is a foot.
  let head = torso.name;
  for (const b of f.bones) {
    if (role.get(b.name) === "neck" && children(f.bones, b.name).length === 0) {
      mark(b.name, "head");
      head = b.name;
    }
    if (role.get(b.name) === "leg" && children(f.bones, b.name).length === 0 && touches(b)) mark(b.name, "foot");
  }

  const range = new Map<string, [number, number]>();
  for (const frames of Object.values(f.clips)) for (const fr of frames) for (const [k, v] of Object.entries(fr)) {
    if (k.startsWith("_")) continue;
    const r = range.get(k) ?? [0, 0];
    range.set(k, [Math.min(r[0], v), Math.max(r[1], v)]);
  }
  const bones: ModelBone[] = f.bones.map((b) => {
    const rl = role.get(b.name)!;
    const L = len(b);
    const cap = rl === "torso" || rl === "spine" ? 0.5 : rl === "head" || rl === "neck" ? 0.45 : 0.3;
    const r = Math.max(0.03 * H, Math.min((b.radius ?? 0.1 * H) * 0.9, cap * Math.max(L, 0.2 * H)));
    const [lo, hi] = range.get(b.name) ?? [0, 0];
    const margin = rl === "leg" ? 0.35 : rl === "tail" ? 0.6 : 0.3;
    return {
      name: b.name, parent: b.parent, role: rl, a: P(b.head), b: P(b.tail), r, depth: (b.head[1] + b.tail[1]) / 2,
      body: rl === "foot" ? b.parent! : b.name,
      limits: [Math.max(-2.6, lo - margin), Math.min(2.6, hi + margin)],
    };
  });
  return {
    id: f.name.toLowerCase(), url: `/models/${f.name.toLowerCase()}.glb`,
    length: f.xmax - f.xmin, height: H, groundY: g, bones, torso: torso.name, head, clips: f.clips,
  };
}

export const MODELS: Model[] = (facts as unknown as Fact[]).map(build);
export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));
