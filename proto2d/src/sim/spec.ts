// UnitSpec: the only thing the AI produces. See docs/unit-spec.md.

export type PlanId = "biped" | "quadruped" | "bird" | "wheeled";
export type Attack = "punch" | "kick" | "bite" | "peck" | "charge" | "slash" | "ram";
export type Weapon = "none" | "sword" | "knife" | "club" | "spear";

export interface UnitSpec {
  label: string;
  count: number;
  plan: PlanId;
  size: number; // metres
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
}

const human = (over: Partial<UnitSpec>): UnitSpec => ({
  label: "a man",
  count: 1,
  plan: "biped",
  size: 1.78,
  weight: 78,
  strength: 1,
  toughness: 1,
  speed: 1,
  bravery: 0.6,
  attack: "punch",
  weapon: "none",
  armor: 0,
  canFly: false,
  colors: { body: "#e8b98f", accent: "#3d5a80" },
  ...over,
});

export interface Matchup {
  id: string;
  title: string;
  left: UnitSpec;
  right: UnitSpec;
}

// Hand-written specs for the prototype. The AI step will produce exactly this shape.
export const MATCHUPS: Matchup[] = [
  {
    id: "gorilla",
    title: "100 men vs 1 gorilla",
    left: human({ label: "100 men", count: 100 }),
    right: {
      label: "1 gorilla",
      count: 1,
      plan: "biped",
      size: 1.7,
      weight: 190,
      strength: 3,
      toughness: 3.5,
      speed: 1.2,
      bravery: 1,
      attack: "punch",
      weapon: "none",
      armor: 0.25,
      canFly: false,
      colors: { body: "#3b3b3b", accent: "#1f1f1f" },
    },
  },
  {
    id: "geese",
    title: "a swarm of angry geese vs a medieval knight",
    left: {
      label: "a swarm of angry geese",
      count: 14,
      plan: "bird",
      size: 0.8,
      weight: 5,
      strength: 1.6,
      toughness: 0.8,
      speed: 1.6,
      bravery: 1,
      attack: "peck",
      weapon: "none",
      armor: 0,
      canFly: true,
      colors: { body: "#f2f2f2", accent: "#f4a300" },
    },
    right: human({
      label: "a medieval knight",
      weight: 105,
      strength: 1.4,
      toughness: 2,
      speed: 0.8,
      bravery: 1,
      attack: "slash",
      weapon: "sword",
      armor: 0.6,
      colors: { body: "#9aa4ad", accent: "#7a1f1f" },
    }),
  },
  {
    id: "roomba",
    title: "a Roomba with a knife vs 3 house cats",
    left: {
      label: "a Roomba with a knife",
      count: 1,
      plan: "wheeled",
      size: 0.35,
      weight: 4,
      strength: 1.5,
      toughness: 1.5,
      speed: 1.4,
      bravery: 1,
      attack: "ram",
      weapon: "knife",
      armor: 0.3,
      canFly: false,
      colors: { body: "#2b2d42", accent: "#8d99ae" },
    },
    right: {
      label: "3 house cats",
      count: 3,
      plan: "quadruped",
      size: 0.5,
      weight: 4.5,
      strength: 1.3,
      toughness: 0.7,
      speed: 1.8,
      bravery: 0.4,
      attack: "bite",
      weapon: "none",
      armor: 0,
      canFly: false,
      colors: { body: "#e07a2f", accent: "#fff3e0" },
    },
  },
  {
    id: "toddlers",
    title: "50 toddlers vs a grizzly bear",
    left: human({
      label: "50 toddlers",
      count: 50,
      size: 0.9,
      weight: 13,
      strength: 0.7,
      toughness: 0.6,
      speed: 0.9,
      bravery: 0.9,
      colors: { body: "#f1c7a3", accent: "#e76f51" },
    }),
    right: {
      label: "a grizzly bear",
      count: 1,
      plan: "quadruped",
      size: 2.2,
      weight: 300,
      strength: 2.6,
      toughness: 3.5,
      speed: 1.1,
      bravery: 1,
      attack: "bite",
      weapon: "none",
      armor: 0.3,
      canFly: false,
      colors: { body: "#6b4226", accent: "#3e2615" },
    },
  },
];
