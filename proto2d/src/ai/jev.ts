// Server-only: turns a typed phrase into a UnitSpec with one Jev call.
// Jev only describes what the thing IS, from closed lists. It never sees the opponent,
// so it cannot pick a winner. Numbers and arithmetic stay in code (Jev is weak at them).
import type { Attack, PlanId, UnitSpec, Weapon } from "../sim/spec";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.13.0"; // pinned so tuned thresholds don't drift under an alias

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

// Named colours: Jev judges names far better than hex.
export const COLORS: Record<string, string> = {
  white: "#f2f2f2", black: "#2a2a2e", grey: "#8d8f96", silver: "#c3c9cf", brown: "#7a4e2d",
  tan: "#d8b27e", "skin tone": "#e8b98f", red: "#c8372d", orange: "#e8782a", yellow: "#f2c230",
  green: "#4f9a44", "dark green": "#2f5d34", blue: "#3d6fb6", "navy blue": "#243b6b",
  purple: "#7a4ea3", pink: "#ec8fb3", gold: "#d4a52a",
};

// Score levels -> physical values. Interpolated geometrically in code.
const SIZE = [
  ["tiny, like a mouse or a rat", 0.18],
  ["small, like a cat, a goose or a Roomba", 0.45],
  ["knee-high to waist-high, like a dog or a toddler", 0.9],
  ["the height of an adult human", 1.75],
  ["large, like a horse, a bear or a car", 2.4],
  ["huge, like an elephant or a truck", 3.4],
] as const;
const WEIGHT = [
  ["under a kilogram, like a rat", 0.5],
  ["a few kilograms, like a cat or a goose", 4],
  ["like a large dog or a child, around 25 kg", 25],
  ["like an adult human, around 75 kg", 75],
  ["like a gorilla or a big motorbike, around 200 kg", 200],
  ["like a bear or a horse, around 500 kg", 500],
  ["like a car or an elephant, well over a tonne", 1500],
] as const;

const levels = (xs: readonly (readonly [string, number])[]) => xs.map((x) => x[0]);
const lerpLog = (xs: readonly (readonly [string, number])[], s: number) => {
  const i = Math.max(0, Math.min(xs.length - 1, s));
  const a = Math.floor(i), b = Math.min(xs.length - 1, a + 1), t = i - a;
  return Math.exp(Math.log(xs[a][1]) * (1 - t) + Math.log(xs[b][1]) * t);
};
/** Piecewise-linear map from a Score (level index space) to values, one per level. */
const map = (vals: number[], s: number) => {
  const i = Math.max(0, Math.min(vals.length - 1, s));
  const a = Math.floor(i), b = Math.min(vals.length - 1, a + 1);
  return vals[a] + (vals[b] - vals[a]) * (i - a);
};

const PLANS: Record<PlanId, string> = {
  biped: "walks upright on two legs and fights with arms or hands: people, apes, robots, zombies, knights",
  quadruped: "walks on four legs and bites or charges: cats, dogs, bears, horses, cows, lions",
  bird: "a bird, or a small winged creature: geese, pigeons, chickens, bats",
  wheeled: "moves on wheels and has no legs: cars, Roombas, carts, tanks, shopping trolleys",
};
const ATTACKS: Record<Attack, string> = {
  punch: "hits with fists or hands",
  kick: "kicks with legs or feet",
  bite: "bites with teeth or jaws",
  peck: "pecks with a beak",
  charge: "charges and rams with its head, horns or whole body",
  slash: "slashes or swings a held weapon",
  ram: "drives or rolls into things, as a machine or vehicle",
};
const WEAPONS: Record<Weapon, string> = {
  none: "carries no weapon",
  sword: "a sword, sabre or other long blade",
  knife: "a knife, dagger or other short blade",
  club: "a club, bat, hammer, frying pan or other blunt object",
  spear: "a spear, pitchfork, pole or other long pointed stick",
};
const COUNT = [
  ["exactly one", 1, 1],
  ["a few, two to five", 2, 5],
  ["a group, six to fifteen", 6, 15],
  ["a crowd, sixteen to fifty", 16, 50],
  ["a horde or army, more than fifty", 60, 150],
] as const;

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
};

/** Explicit counts are arithmetic, so code reads them, not the model. */
export function parseCount(phrase: string): number | null {
  const p = phrase.toLowerCase().trim();
  const digits = p.match(/^(\d{1,4})\b/);
  if (digits) return Number(digits[1]);
  const m = p.match(/^(?:(?:a|an|one)\s+)?(hundred|dozen)\b/) ?? p.match(/^(an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\b/);
  if (!m) return null;
  // "a swarm of ...": the article says nothing about the count.
  if ((m[1] === "a" || m[1] === "an") && /^an?\s+(swarm|horde|army|pack|flock|herd|crowd|gang|group|bunch|mob|colony|legion|squad|team|family|troop|school|band)\b/.test(p)) return null;
  return WORDS[m[1]] ?? null;
}

const noul = (instructions: string, t?: string, f?: string) => ({ type: "noul", instructions, ...(t ? { criteria: { true: t, false: f } } : {}) });
const choice = (instructions: string, criteria: Record<string, string | null>) => ({ type: "choice", instructions, criteria });
const score = (instructions: string, criteria: readonly string[]) => ({ type: "score", instructions, criteria });

function questions() {
  const colorOpts = Object.fromEntries(Object.keys(COLORS).map((k) => [k, null]));
  return {
    physical: noul(
      "Is `phrase` a physical thing or a group of physical things (a person, creature, animal, robot, object or vehicle) that could be put in an arena and take part in a fight?",
      "It has a body that could be put in an arena",
      "It is an idea, feeling, place, time, event or other thing with no body",
    ),
    real_person: noul(
      "Does `phrase` name a specific real, identifiable individual person (for example by their name), rather than a general kind of person or a fictional character?",
    ),
    hateful: noul("Is `phrase` a slur, or does it describe people mainly by their race, ethnicity, religion, gender, sexuality or disability?"),
    count: choice("How many individual bodies does `phrase` describe?", Object.fromEntries(COUNT.map((c) => [c[0], null]))),
    plan: choice("Which body shape best fits one individual member of `phrase` (one person, animal or object, not the whole group)?", PLANS),
    size: score("How big is one individual member of `phrase` (one person, animal or object, not the whole group)?", levels(SIZE)),
    weight: score("How heavy is one individual member of `phrase` (one person, animal or object, not the whole group)?", levels(WEIGHT)),
    strength: score("How physically strong is one individual member of `phrase` (one person, animal or object, not the whole group), compared with an ordinary adult human?", [
      "much weaker than an adult human, like a toddler or a cat",
      "a bit weaker than an adult human",
      "about as strong as an ordinary adult human",
      "clearly stronger, like a trained fighter or a large dog",
      "far stronger, like a gorilla, a bear or a machine",
    ]),
    toughness: score("How hard is one individual member of `phrase` (one person, animal or object, not the whole group) to injure or break?", [
      "very fragile, easily hurt",
      "a little fragile",
      "about as tough as an adult human",
      "tough, takes a lot of punishment",
      "extremely tough, like a bear, a tank or a boulder",
    ]),
    speed: score("How fast does one individual member of `phrase` (one person, animal or object, not the whole group) move?", ["very slow", "slow", "normal walking to jogging pace", "fast", "extremely fast"]),
    bravery: score("How brave or aggressive is `phrase` in a fight?", [
      "cowardly, runs at the first sign of trouble",
      "nervous, gives up quickly",
      "ordinary, fights but may flee when losing",
      "brave, keeps fighting when losing",
      "fearless or mindless, never retreats",
    ]),
    armor: score("How well protected is one individual member of `phrase` (one person, animal or object, not the whole group) by armour, a shell, a hard casing or thick hide?", [
      "no protection at all",
      "light protection, like clothes or fur",
      "moderate protection, like thick hide or a plastic casing",
      "heavy protection, like plate armour or a metal body",
    ]),
    attack: choice("How does one individual member of `phrase` (one person, animal or object, not the whole group) mainly attack?", ATTACKS),
    weapon: choice("What weapon, if any, does `phrase` hold or have attached?", WEAPONS),
    flies: noul("Can one individual member of `phrase` (one person, animal or object, not the whole group) fly?"),
    body_color: choice("What is the main colour of one individual member of `phrase` (one person, animal or object, not the whole group)?", colorOpts),
    accent_color: choice("What is the second most visible colour of one individual member of `phrase` (one person, animal or object, not the whole group) (clothing, markings, beak, trim)?", colorOpts),
  };
}

export type JevResult =
  | { ok: true; spec: UnitSpec; tokens: number; ms: number; confidence: Record<string, number> }
  | { ok: false; reason: string; tokens: number; ms: number };

export async function phraseToSpec(phrase: string, apiKey: string): Promise<JevResult> {
  const t0 = Date.now();
  const body = JSON.stringify({
    model: MODEL,
    state: { phrase, context: "`phrase` is what a player typed to create an army in a cartoon physics battle game." },
    questions: questions(),
  });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body });
    if (res.status !== 429 && res.status !== 529) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  if (!res || !res.ok) throw new Error(`TypeSafe ${res?.status}: ${(await res?.text())?.slice(0, 300)}`);
  const json = (await res.json()) as { answers: Record<string, Answer>; usage: { input_tokens: number } };
  const a = json.answers;
  const tokens = json.usage.input_tokens;
  const ms = Date.now() - t0;
  const N = (k: string) => (a[k] as { noul: number }).noul;
  const C = (k: string) => (a[k] as { choice: string }).choice;
  const S = (k: string) => (a[k] as { score: number }).score;

  // Honest refusals, each with its own reason and Jev's probability.
  if (N("physical") < 0.4) return { ok: false, reason: `"${phrase}" has no body to fight with (Jev: ${pct(N("physical"))} sure it's physical).`, tokens, ms };
  if (N("real_person") > 0.6) return { ok: false, reason: `"${phrase}" looks like a real person. Pick a kind of person instead.`, tokens, ms };
  if (N("hateful") > 0.6) return { ok: false, reason: `Armies can't be defined by who people are. Try what they do instead.`, tokens, ms };

  let count = parseCount(phrase);
  if (count === null) {
    // Probability-weighted (geometric) mean of bucket midpoints, so an unsure "swarm"
    // lands between "group" and "horde" instead of snapping to the argmax.
    const probs = (a.count as { probabilities: Record<string, number> }).probabilities;
    let logSum = 0;
    for (const c of COUNT) logSum += (probs[c[0]] ?? 0) * Math.log((c[1] + c[2]) / 2);
    count = Math.round(Math.exp(logSum));
  }
  const plan = C("plan") as PlanId;
  let attack = C("attack") as Attack;
  // The body plan decides which attacks are physically possible.
  if (plan === "wheeled") attack = "ram";
  else if (plan === "bird") attack = "peck";
  else if (plan === "quadruped" && attack !== "charge") attack = "bite";
  const bodyColor = COLORS[C("body_color")] ?? "#8d8f96";
  let accent = COLORS[C("accent_color")] ?? "#2a2a2e";
  if (accent === bodyColor) accent = bodyColor === COLORS.black ? COLORS.grey : COLORS.black;
  const spec: UnitSpec = {
    label: phrase,
    count: Math.max(1, Math.min(150, count)),
    plan,
    size: lerpLog(SIZE, S("size")),
    weight: lerpLog(WEIGHT, S("weight")),
    strength: map([0.45, 0.75, 1, 1.6, 3], S("strength")),
    toughness: map([0.45, 0.7, 1, 2, 3.5], S("toughness")),
    speed: map([0.5, 0.75, 1, 1.4, 2], S("speed")),
    bravery: map([0.1, 0.3, 0.55, 0.85, 1], S("bravery")),
    armor: map([0, 0.1, 0.3, 0.6], S("armor")),
    attack,
    weapon: plan === "biped" || plan === "wheeled" ? (C("weapon") as Weapon) : "none",
    canFly: plan === "bird" && N("flies") > 0.5,
    colors: { body: bodyColor, accent },
  };
  const confidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) if ("confidence" in v) confidence[k] = v.confidence;
  return { ok: true, spec, tokens, ms, confidence };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
