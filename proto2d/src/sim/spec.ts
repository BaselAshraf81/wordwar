// UnitSpec: the only thing the AI produces. See docs/unit-spec.md.
// Jev fills a Genome (what the thing IS: body, movement, attacks, weaknesses) from closed
// lists; code turns it into physics. Nothing the AI writes can pick a winner.
import baked from "./presets.json";

export type PlanId = "biped" | "quadruped" | "bird" | "wheeled" | "fish" | "snake" | "bug" | "blob";
export type Attack = "punch" | "kick" | "bite" | "peck" | "charge" | "slash" | "ram";
export type Weapon = "none" | "sword" | "knife" | "club" | "spear";

// ---- look ----
export type Ears = "none" | "round" | "pointy" | "long";
export type Horns = "none" | "short" | "long" | "antlers" | "tusks";
export type Tail = "none" | "short" | "long" | "bushy";
export type Pattern = "plain" | "stripes" | "spots";
export type Face = "human" | "animal" | "robot" | "skull" | "monster";
export type Eyes = "normal" | "angry" | "big" | "one" | "three" | "glowing";
export type Mouth = "smile" | "fangs" | "frown" | "beak" | "none";
export type Headwear = "none" | "helmet" | "crown" | "tophat" | "wizard" | "spiky_hair" | "long_hair" | "halo" | "cap";

export interface Features {
  bodyLength: number;
  legLength: number;
  neckLength: number;
  bulk: number;
  snout: number; // 0 flat face .. 1.1 crocodile jaws
  ears: Ears;
  horns: Horns;
  tail: Tail;
  dorsalFin: boolean;
  spikes: boolean;
  mane: boolean;
  pattern: Pattern;
  legs: 6 | 8;
  face: Face;
  eyes: Eyes;
  mouth: Mouth;
  headwear: Headwear;
  cape: boolean;
  belly: boolean;
}

export const DEFAULT_FEATURES: Features = {
  bodyLength: 1, legLength: 1, neckLength: 1, bulk: 1, snout: 0.35, ears: "none", horns: "none", tail: "none",
  dorsalFin: false, spikes: false, mane: false, pattern: "plain", legs: 6, face: "animal", eyes: "normal", mouth: "none",
  headwear: "none", cape: false, belly: false,
};
export const featuresOf = (s: UnitSpec): Features => ({ ...DEFAULT_FEATURES, ...s.features });

// ---- genome: structure, movement, combat ----
export type Frame = "upright" | "horizontal" | "long" | "round" | "wheeled";
export type Loco = "walk" | "gallop" | "crawl" | "hop" | "slither" | "roll" | "fly" | "float" | "flop" | "drive";
export type Foot = "paw" | "hoof" | "claw" | "foot" | "stump";
export type Hand = "hand" | "claw" | "pincer" | "blade" | "hammer";
export type WingKind = "none" | "feather" | "bat" | "insect";
export type TailKind = "none" | "thin" | "thick" | "bushy" | "club" | "stinger" | "fin";
export type Back = "none" | "spikes" | "plates" | "shell" | "fin" | "hump";
export type Material = "skin" | "fur" | "feathers" | "scales" | "metal" | "slime" | "stone" | "wood" | "ghost" | "fire" | "ice";
export type Verb =
  | "bite" | "peck" | "headbutt" | "gore" | "claw" | "punch" | "slash" | "pinch"
  | "kick" | "stomp" | "charge" | "slam" | "tail_swipe" | "sting" | "whip";
export type Ranged = "none" | "spit" | "fire_breath" | "ice_breath" | "shoot" | "throw_rock" | "lightning" | "laser" | "poison_spray" | "web";
export type DType = "blunt" | "slash" | "pierce" | "fire" | "ice" | "poison" | "electric" | "acid";
export type Element = "none" | "fire" | "ice" | "poison" | "electric" | "acid";
export type Special = "regenerate" | "split" | "explode" | "thorns" | "rage";

export interface Genome {
  frame: Frame;
  loco: Loco;
  clumsy: number; // 0 graceful .. 1 flailing
  legs: number; // 0..12, even
  legLen: number; // ~0.4..1.6
  legThick: number; // ~0.6..1.6
  foot: Foot;
  arms: number; // 0, 2, 4, 6
  armLen: number;
  hand: Hand;
  heads: number; // 0..5
  headSize: number; // ~0.6..1.8
  neckLen: number; // ~0.3..3.2
  wings: WingKind;
  wingSize: number;
  tail: TailKind;
  tailLen: number; // ~0.4..1.8
  tentacles: number; // 0..8
  back: Back;
  bodyLen: number; // ~0.7..1.6
  bulk: number; // ~0.7..1.6
  material: Material;
  attacks: Verb[]; // 1..2 melee moves
  ranged: Ranged;
  element: Element; // extra harm carried by its melee attacks
  resist: DType[];
  weak: DType[];
  specials: Special[];
}

export const DEFAULT_GENOME: Genome = {
  frame: "horizontal", loco: "walk", clumsy: 0.3, legs: 4, legLen: 1, legThick: 1, foot: "paw", arms: 0, armLen: 1, hand: "hand",
  heads: 1, headSize: 1, neckLen: 1, wings: "none", wingSize: 1, tail: "none", tailLen: 1, tentacles: 0, back: "none",
  bodyLen: 1, bulk: 1, material: "fur", attacks: ["bite"], ranged: "none", element: "none", resist: [], weak: [], specials: [],
};

export interface UnitSpec {
  label: string;
  count: number;
  plan: PlanId; // legacy hint for hand-written presets; genome wins when present
  size: number; // metres: height when upright, length when horizontal or long
  weight: number; // kg
  strength: number;
  toughness: number;
  speed: number;
  bravery: number;
  attack: Attack;
  weapon: Weapon;
  armor: number;
  canFly: boolean;
  colors: { body: string; accent: string };
  features?: Partial<Features>;
  genome?: Genome;
  /** Artist-rigged model id (src/models) used as the body when the thing is an ordinary animal. */
  model?: string;
}

/** Every unit runs on a genome. Hand-written presets get one derived from their plan. */
export function genomeOf(s: UnitSpec): Genome {
  if (s.genome) return s.genome;
  const F = featuresOf(s);
  const verb: Record<Attack, Verb> = { punch: "punch", kick: "kick", bite: "bite", peck: "peck", charge: "headbutt", slash: "slash", ram: "charge" };
  const tail: TailKind = F.tail === "none" ? "none" : F.tail === "long" ? "thin" : F.tail === "short" ? "thin" : "bushy";
  const base = { ...DEFAULT_GENOME, attacks: [verb[s.attack]], neckLen: F.neckLength, bulk: F.bulk, legLen: F.legLength, bodyLen: F.bodyLength, tail, back: (F.spikes ? "spikes" : F.dorsalFin ? "fin" : "none") as Back };
  switch (s.plan) {
    case "biped": return { ...base, frame: "upright", legs: 2, arms: 2, loco: "walk", material: "skin", foot: "foot", neckLen: 1, tail: "none" };
    case "quadruped": return { ...base, frame: "horizontal", legs: 4, loco: "gallop", material: "fur" };
    case "bird": return { ...base, frame: "horizontal", legs: 2, loco: s.canFly ? "fly" : "walk", wings: "feather", material: "feathers", foot: "claw", legLen: 1.3, bodyLen: 0.8, attacks: ["peck"] };
    case "fish": return { ...base, frame: "long", legs: 0, loco: "flop", tail: "fin", material: "scales", attacks: ["bite"], bulk: 1.4 };
    case "snake": return { ...base, frame: "long", legs: 0, loco: "slither", material: "scales", bulk: 0.8 };
    case "bug": return { ...base, frame: "horizontal", legs: F.legs, loco: "crawl", material: "scales", foot: "claw" };
    case "blob": return { ...base, frame: "round", legs: 0, heads: 0, loco: "hop", material: "slime", attacks: ["slam"] };
    case "wheeled": return { ...base, frame: "wheeled", legs: 0, heads: 0, loco: "drive", material: "metal", attacks: ["charge"] };
  }
}

const human = (over: Partial<UnitSpec>): UnitSpec => ({
  label: "a man", count: 1, plan: "biped", size: 1.78, weight: 78, strength: 1, toughness: 1, speed: 1, bravery: 0.6,
  attack: "punch", weapon: "none", armor: 0, canFly: false, colors: { body: "#e8b98f", accent: "#3d5a80" },
  features: { face: "human", mouth: "smile" }, ...over,
});

const animal = (label: string, model: string, count: number, size: number, weight: number, over: Partial<UnitSpec> = {}): UnitSpec => ({
  label, count, plan: "quadruped", model, size, weight, strength: 1.5, toughness: 1.4, speed: 1.3, bravery: 0.9,
  attack: "bite", weapon: "none", armor: 0.1, canFly: false, colors: { body: "#8d8f96", accent: "#2a2a2e" }, ...over,
});

export interface Matchup {
  id: string;
  title: string;
  left: UnitSpec;
  right: UnitSpec;
}

const HAND: Matchup[] = [
  {
    id: "gorilla",
    title: "100 men vs 1 gorilla",
    left: human({ label: "100 men", count: 100 }),
    right: human({
      label: "1 gorilla", size: 1.7, weight: 190, strength: 3, toughness: 3.5, speed: 1.2, bravery: 1, armor: 0.25,
      colors: { body: "#3b3b3b", accent: "#1f1f1f" }, features: { face: "animal", snout: 0.3, bulk: 1.35, mouth: "fangs", eyes: "angry" },
    }),
  },
  {
    id: "wolves",
    title: "a pack of wolves vs 3 big dogs",
    left: animal("a pack of wolves", "wolf", 8, 1.5, 40),
    right: animal("3 big dogs", "husky", 3, 1.4, 45, { strength: 1.4, bravery: 0.7 }),
  },
];

/** Showcase fights whose specs were designed by Jev itself (scripts: npm run bake). */
const BAKED = baked as unknown as Matchup[];

export const MATCHUPS: Matchup[] = [...HAND, ...BAKED];
