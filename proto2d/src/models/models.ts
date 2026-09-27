// Artist-rigged models exported by blender/export_models.py. Pure data (no three.js), so the
// simulation and tests can use it. Side view: x forward (the model faces +x), y up, ground y = 0.
import facts from "./facts.json";

export type GroupRole = "torso" | "neck" | "head" | "leg" | "tail" | "limb";

export interface Group {
  id: string;
  role: GroupRole;
  parent: string | null;
  a: [number, number];
  b: [number, number];
  r: number;
  depth: number;
}

export type ClipName = "walk" | "run" | "idle" | "attack" | "headbutt" | "kick" | "punch" | "slash" | "death" | "hit";
export type Frame = Record<string, number>;

export interface Model {
  id: string;
  url: string;
  length: number;
  height: number;
  /** Blender z of the ground, to lift glTF rest poses onto y = 0. */
  groundY: number;
  groups: Group[];
  /** Artist bone name -> the physics group it rides on. */
  boneGroup: Record<string, string>;
  clips: Partial<Record<ClipName, Frame[]>>;
  /** Joint limits per group, from the artist's full range of motion plus margin. */
  limits: Record<string, [number, number]>;
  attacks: ClipName[];
}

interface Fact {
  id: string;
  height: number;
  ground: number;
  xmin: number;
  xmax: number;
  groups: Group[];
  bones: Record<string, string>;
  clips: Partial<Record<ClipName, Frame[]>>;
}

function build(f: Fact): Model {
  const limits: Record<string, [number, number]> = {};
  for (const g of f.groups) {
    if (!g.parent) continue;
    let lo = 0, hi = 0;
    for (const frames of Object.values(f.clips)) for (const fr of frames ?? []) {
      const v = fr[g.id] ?? 0;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const m = g.role === "leg" ? 0.3 : 0.4;
    limits[g.id] = [Math.max(-2.8, lo - m), Math.min(2.8, hi + m)];
  }
  const attacks = (["attack", "headbutt", "kick", "punch", "slash"] as ClipName[]).filter((c) => f.clips[c]);
  return {
    id: f.id, url: `/models/${f.id}.glb`, length: f.xmax - f.xmin, height: f.height, groundY: f.ground,
    groups: f.groups, boneGroup: f.bones, clips: f.clips, limits, attacks,
  };
}

export const MODELS: Model[] = (facts as unknown as Fact[]).map(build);
export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

/** What each model is, for Jev's picker. Only ids that exist are offered. */
export const MODEL_DESC: Record<string, string> = {
  wolf: "a wolf, coyote or other wild dog",
  husky: "a husky, big dog, hound or guard dog",
  shibainu: "a small dog, puppy or chihuahua",
  fox: "a fox, jackal or other small wild canine",
  horse: "a horse, pony or unicorn",
  donkey: "a donkey or mule",
  deer: "a deer, doe or antelope without big antlers",
  stag: "a stag, moose, elk or reindeer with antlers",
  bull: "a bull, bison, buffalo or ox",
  cow: "a cow or cattle",
  alpaca: "an alpaca, llama or camel",
  trex: "a T-rex or other big two-legged meat-eating dinosaur",
  velociraptor: "a velociraptor or other small two-legged dinosaur",
  parasaurolophus: "a duck-billed two-legged dinosaur",
  triceratops: "a triceratops, rhino or other horned four-legged beast",
  stegosaurus: "a stegosaurus or other spiky-backed dinosaur",
  apatosaurus: "a brachiosaurus, diplodocus or other long-necked dinosaur",
};
