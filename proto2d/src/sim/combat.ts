// Combat rules. Jev only picks categories (verb, damage type, element, material, resistances);
// every number lives here so all units obey the same physics-flavoured rules.
import type { DType, Element, Genome, Material, Ranged, Special, Verb } from "./spec";

/** How a verb hits: which body part does it, what kind of damage, and how. */
export interface VerbRule {
  part: "head" | "arm" | "leg" | "tail" | "tentacle" | "body";
  dtype: DType;
  sharp: number;
  grab: boolean; // hits one body only
  body: "none" | "lunge" | "charge" | "jump";
}

export const VERBS: Record<Verb, VerbRule> = {
  bite: { part: "head", dtype: "pierce", sharp: 1.6, grab: true, body: "lunge" },
  peck: { part: "head", dtype: "pierce", sharp: 1.3, grab: true, body: "lunge" },
  headbutt: { part: "head", dtype: "blunt", sharp: 1.3, grab: false, body: "charge" },
  gore: { part: "head", dtype: "pierce", sharp: 2.1, grab: false, body: "charge" },
  claw: { part: "arm", dtype: "slash", sharp: 1.6, grab: false, body: "none" },
  punch: { part: "arm", dtype: "blunt", sharp: 1.0, grab: true, body: "none" },
  slash: { part: "arm", dtype: "slash", sharp: 2.0, grab: false, body: "none" },
  pinch: { part: "arm", dtype: "pierce", sharp: 1.5, grab: true, body: "none" },
  kick: { part: "leg", dtype: "blunt", sharp: 1.3, grab: true, body: "none" },
  stomp: { part: "body", dtype: "blunt", sharp: 1.4, grab: false, body: "jump" },
  charge: { part: "body", dtype: "blunt", sharp: 1.0, grab: false, body: "charge" },
  slam: { part: "body", dtype: "blunt", sharp: 1.5, grab: false, body: "jump" },
  tail_swipe: { part: "tail", dtype: "blunt", sharp: 1.4, grab: false, body: "none" },
  sting: { part: "tail", dtype: "pierce", sharp: 1.7, grab: true, body: "none" },
  whip: { part: "tentacle", dtype: "blunt", sharp: 1.1, grab: false, body: "none" },
};

export type Status = "burn" | "freeze" | "poison" | "shock" | "corrode" | "web";
export const STATUS_DUR: Record<Status, number> = { burn: 3, freeze: 2.5, poison: 6, shock: 0.7, corrode: 5, web: 3 };
/** Damage per second (in health units; an ordinary adult has 1). */
export const STATUS_DOT: Partial<Record<Status, [number, DType]>> = { burn: [0.1, "fire"], poison: [0.06, "poison"], corrode: [0.04, "acid"] };
export const ELEMENT_STATUS: Record<Exclude<Element, "none">, Status> = { fire: "burn", ice: "freeze", poison: "poison", electric: "shock", acid: "corrode" };
export const STATUS_DTYPE: Record<Status, DType> = { burn: "fire", freeze: "ice", poison: "poison", shock: "electric", corrode: "acid", web: "blunt" };

/** Material vs damage type. Missing entries are 1. */
const MATERIAL: Record<Material, Partial<Record<DType, number>>> = {
  skin: {},
  fur: { fire: 1.25, ice: 0.7 },
  feathers: { fire: 1.3, ice: 0.8, blunt: 1.1 },
  scales: { slash: 0.75, pierce: 0.85, fire: 0.8, ice: 1.3 },
  metal: { slash: 0.45, pierce: 0.55, blunt: 0.8, fire: 0.5, poison: 0, electric: 1.9, acid: 1.6 },
  slime: { blunt: 0.35, slash: 0.7, pierce: 0.6, fire: 1.3, ice: 1.5, poison: 0, acid: 0.3 },
  stone: { blunt: 0.7, slash: 0.35, pierce: 0.45, fire: 0.3, poison: 0, electric: 0.3, acid: 1.4 },
  wood: { fire: 2.4, slash: 1.2, electric: 0.4, poison: 0.2, ice: 0.8 },
  ghost: { blunt: 0.25, slash: 0.25, pierce: 0.25, fire: 0.9, ice: 0.7, poison: 0, electric: 1.4, acid: 0.5 },
  fire: { fire: 0, ice: 2.4, poison: 0.5, blunt: 0.8, slash: 0.8, pierce: 0.8 },
  ice: { ice: 0, fire: 2.4, blunt: 1.3, poison: 0.3 },
};

export function typeMult(g: Genome, dtype: DType): number {
  let m = MATERIAL[g.material][dtype] ?? 1;
  if (g.resist.includes(dtype)) m *= 0.35;
  if (g.weak.includes(dtype)) m *= 1.8;
  return Math.min(3, m); // a snowman melts fast, not instantly
}

export const has = (g: Genome, sp: Special) => g.specials.includes(sp);

/** Ranged attacks. dmg is in health units per projectile. */
export interface RangedRule {
  dtype: DType;
  status?: Status;
  speed: number; // m/s
  gravity: number; // gravity scale
  r: number; // metres, before size scaling
  dmg: number;
  range: number; // metres
  stream: boolean; // a burst of small particles instead of one shot
  sensor: boolean; // passes through without pushing
  knock: number;
}

export const RANGED: Record<Exclude<Ranged, "none">, RangedRule> = {
  spit: { dtype: "acid", status: "corrode", speed: 11, gravity: 1, r: 0.07, dmg: 0.18, range: 10, stream: false, sensor: true, knock: 0 },
  fire_breath: { dtype: "fire", status: "burn", speed: 9, gravity: -0.15, r: 0.12, dmg: 0.05, range: 5, stream: true, sensor: true, knock: 0 },
  ice_breath: { dtype: "ice", status: "freeze", speed: 9, gravity: 0.1, r: 0.11, dmg: 0.04, range: 5, stream: true, sensor: true, knock: 0 },
  poison_spray: { dtype: "poison", status: "poison", speed: 8, gravity: 0.3, r: 0.1, dmg: 0.03, range: 4.5, stream: true, sensor: true, knock: 0 },
  shoot: { dtype: "pierce", speed: 30, gravity: 0.15, r: 0.035, dmg: 0.32, range: 22, stream: false, sensor: false, knock: 0.5 },
  throw_rock: { dtype: "blunt", speed: 13, gravity: 1, r: 0.14, dmg: 0.34, range: 14, stream: false, sensor: false, knock: 2.5 },
  lightning: { dtype: "electric", status: "shock", speed: 40, gravity: 0, r: 0.06, dmg: 0.3, range: 16, stream: false, sensor: true, knock: 0 },
  laser: { dtype: "fire", status: "burn", speed: 45, gravity: 0, r: 0.04, dmg: 0.24, range: 22, stream: false, sensor: true, knock: 0 },
  web: { dtype: "blunt", status: "web", speed: 12, gravity: 0.6, r: 0.12, dmg: 0.02, range: 11, stream: false, sensor: true, knock: 0 },
};

export const DTYPE_COLOR: Record<DType, string> = {
  blunt: "#fff4c2", slash: "#ffffff", pierce: "#ff5a5a", fire: "#ff8a1f", ice: "#9ee7ff", poison: "#8fe35a", electric: "#ffe84a", acid: "#c6f24a",
};
