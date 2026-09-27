// Server-only: Jev designs a creature from a typed phrase.
// Two parallel calls (~90 typed questions): what it is and how it looks, then how it is built,
// moves and fights. Every answer is a closed choice, a described level or a yes/no, and code
// turns them into a Genome. Jev never sees the opponent, so it cannot pick a winner.
// Numbers and arithmetic stay in code (Jev is weak at them).
import { MODEL_BY_ID, MODEL_DESC } from "../models/models";
import type {
  Attack, Back, DType, Ears, Element, Eyes, Face, Features, Foot, Frame, Genome, Hand, Headwear, Horns, Loco, Material,
  Mouth, Pattern, PlanId, Ranged, Special, TailKind, UnitSpec, Verb, Weapon, WingKind,
} from "../sim/spec";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.13.0"; // pinned so tuned thresholds don't drift under an alias

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

// Named colours: Jev judges names far better than hex.
export const COLORS: Record<string, string> = {
  white: "#f2f2f2", black: "#2a2a2e", grey: "#8d8f96", silver: "#c3c9cf", brown: "#7a4e2d", "dark brown": "#4a2f1c",
  tan: "#d8b27e", "skin tone": "#e8b98f", red: "#c8372d", "dark red": "#7a1f1f", orange: "#e8782a", yellow: "#f2c230",
  green: "#4f9a44", "dark green": "#2f5d34", "lime green": "#8fd14f", blue: "#3d6fb6", "light blue": "#8cc8f0",
  "navy blue": "#243b6b", purple: "#7a4ea3", pink: "#ec8fb3", gold: "#d4a52a", cream: "#f3e6c4", teal: "#2f9c95",
};

const SIZE = [
  ["tiny, like a mouse or a rat", 0.18],
  ["small, like a cat, a goose or a Roomba", 0.45],
  ["knee-high to waist-high, like a dog or a toddler", 0.9],
  ["the height of an adult human", 1.75],
  ["large, like a horse, a bear or a car", 2.6],
  ["huge, like an elephant, a T-rex or a truck", 4],
  ["gigantic, like a whale or a house", 6],
] as const;
const WEIGHT = [
  ["under a kilogram, like a rat", 0.5],
  ["a few kilograms, like a cat or a goose", 4],
  ["like a large dog or a child, around 25 kg", 25],
  ["like an adult human, around 75 kg", 75],
  ["like a gorilla or a big motorbike, around 200 kg", 200],
  ["like a bear or a horse, around 500 kg", 500],
  ["like a car or an elephant, well over a tonne", 1500],
  ["like a whale or a building, many tonnes", 6000],
] as const;

const levels = (xs: readonly (readonly [string, number])[]) => xs.map((x) => x[0]);
const lerpLog = (xs: readonly (readonly [string, number])[], s: number) => {
  const i = Math.max(0, Math.min(xs.length - 1, s));
  const a = Math.floor(i), b = Math.min(xs.length - 1, a + 1), t = i - a;
  return Math.exp(Math.log(xs[a][1]) * (1 - t) + Math.log(xs[b][1]) * t);
};
/** Piecewise-linear map from a Score (level index space) to one value per level. */
const map = (vals: number[], s: number) => {
  const i = Math.max(0, Math.min(vals.length - 1, s));
  const a = Math.floor(i), b = Math.min(vals.length - 1, a + 1);
  return vals[a] + (vals[b] - vals[a]) * (i - a);
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
  if ((m[1] === "a" || m[1] === "an") && /^an?\s+(swarm|horde|army|pack|flock|herd|crowd|gang|group|bunch|mob|colony|legion|squad|team|family|troop|school|band|stampede|gaggle|pride|murder|fleet|litter|nest|parliament|posse|platoon|battalion|convoy|tribe|clan|mass|load|ton|couple|few)\b/.test(p)) return null;
  return WORDS[m[1]] ?? null;
}

const noul = (instructions: string, t?: string, f?: string) => ({ type: "noul", instructions, ...(t ? { criteria: { true: t, false: f } } : {}) });
const choice = (instructions: string, criteria: Record<string, string | null>) => ({ type: "choice", instructions, criteria });
const score = (instructions: string, criteria: readonly string[]) => ({ type: "score", instructions, criteria });

const ONE = "one individual member of `phrase` (one person, animal or thing, not the whole group)";

// ---------------------------------------------------------------- catalogues

const VERB_DESC: Record<Verb, string> = {
  bite: "biting with teeth or jaws", peck: "pecking with a beak", headbutt: "headbutting or ramming with its head",
  gore: "goring or stabbing with horns, tusks or a horn", claw: "clawing or scratching with claws", punch: "punching or hitting with fists or hands",
  slash: "slashing or swinging a blade, sword or weapon", pinch: "pinching or snapping with pincers or claws like a crab",
  kick: "kicking with legs, feet or hooves", stomp: "stomping or trampling with its weight", charge: "charging and smashing into things with its whole body",
  slam: "body-slamming, bouncing or crushing with its whole body", tail_swipe: "swiping or clubbing with its tail", sting: "stinging with a stinger",
  whip: "whipping or lashing with tentacles or tendrils",
};
const RANGED_DESC: Record<Ranged, string> = {
  none: "no ranged attack, it only fights up close", spit: "spits acid, venom or goo", fire_breath: "breathes fire", ice_breath: "breathes frost or ice",
  shoot: "shoots bullets, arrows or darts", throw_rock: "throws rocks, spears or objects", lightning: "casts lightning or electricity",
  laser: "fires laser beams or magic bolts", poison_spray: "sprays poison gas or a toxic cloud", web: "shoots sticky webs or nets",
};
const DTYPE_DESC: Record<DType, string> = {
  blunt: "blunt force like punches and falls", slash: "cuts from blades and claws", pierce: "stabs, bites and bullets", fire: "fire and heat",
  ice: "cold and ice", poison: "poison and venom", electric: "electricity", acid: "acid and corrosion",
};
const SPECIAL_DESC: Record<Special, string> = {
  regenerate: "heals its own wounds quickly while fighting", split: "splits into smaller copies of itself when destroyed",
  explode: "explodes when it dies", thorns: "is covered in spikes, thorns or spines that hurt whatever touches it",
  rage: "gets more dangerous and furious the more it is hurt",
};

function beingQuestions() {
  const colorOpts = Object.fromEntries(Object.keys(COLORS).map((k) => [k, null]));
  const modelOpts = Object.fromEntries(Object.entries(MODEL_DESC).filter(([id]) => MODEL_BY_ID.has(id)).map(([id, d]) => [id, `an ordinary real ${d}`]));
  return {
    physical: noul(
      "Is `phrase` a thing or group of things with a body or form that could appear in an arena and take part in a fight? This includes people, animals, monsters, robots, objects, vehicles and also magical or fictional beings like ghosts, spirits, elementals and demons.",
      "It has a body that could be put in an arena", "It is an idea, feeling, place, time, event or other thing with no body",
    ),
    real_person: noul("Does `phrase` name a specific real, identifiable individual person (for example by their name), rather than a general kind of person or a fictional character?"),
    hateful: noul("Is `phrase` a slur, or does it describe people mainly by their race, ethnicity, religion, gender, sexuality or disability?"),
    count: choice("How many individual bodies does `phrase` describe?", Object.fromEntries(COUNT.map((c) => [c[0], null]))),
    model: choice(`Is ${ONE} exactly one of these ordinary real animals, with nothing magical, robotic or unusual about it?`, {
      ...modelOpts, none: "none of these: it is a person, a monster, a machine, an object, a different animal, or an animal with something unusual about it",
    }),
    size: score(`How big is ${ONE}, measured along its longest dimension?`, levels(SIZE)),
    weight: score(`How heavy is ${ONE}?`, levels(WEIGHT)),
    strength: score(`How physically strong is ${ONE}, compared with an ordinary adult human?`, [
      "much weaker than an adult human, like a toddler or a cat", "a bit weaker than an adult human", "about as strong as an ordinary adult human",
      "clearly stronger, like a trained fighter or a large dog", "far stronger, like a gorilla, a bear or a machine", "monstrously strong, like a dinosaur or a giant",
    ]),
    toughness: score(`How hard is ${ONE} to injure or destroy?`, [
      "very fragile, easily hurt", "a little fragile", "about as tough as an adult human", "tough, takes a lot of punishment",
      "extremely tough, like a bear or a tank", "nearly indestructible, like a mountain troll or a battleship",
    ]),
    speed: score(`How fast does ${ONE} move?`, ["very slow, like a snail or a zombie", "slow", "normal walking to jogging pace", "fast, like a horse or a wolf", "extremely fast, like a cheetah or a jet"]),
    bravery: score(`How brave or aggressive is ${ONE} in a fight?`, [
      "cowardly, runs at the first sign of trouble", "nervous, gives up quickly", "ordinary, fights but may flee when losing",
      "brave, keeps fighting when losing", "fearless or mindless, never retreats",
    ]),
    armor: score(`How well protected is ${ONE} by armour, a shell, a hard casing or thick hide?`, [
      "no protection at all", "light protection, like clothes or fur", "moderate protection, like thick hide or a plastic casing", "heavy protection, like plate armour or a metal body",
    ]),
    weapon: choice(`What weapon, if any, does ${ONE} hold in its hands?`, {
      none: "holds no weapon", sword: "a sword, sabre, axe or other long blade", knife: "a knife, dagger or other short blade",
      club: "a club, bat, hammer, frying pan or other blunt object", spear: "a spear, pitchfork, trident or other long pointed pole",
    }),
    body_color: choice(`What is the main colour of ${ONE}?`, colorOpts),
    accent_color: choice(`What is the second most visible colour of ${ONE} (clothing, markings, belly, wings, trim)?`, colorOpts),
    face: choice(`What kind of face does ${ONE} have?`, {
      human: "a human or humanlike face", animal: "an animal face with a muzzle, snout or beak", robot: "a mechanical face, screen, visor or lens",
      skull: "a skull or skeletal face", monster: "a monstrous alien or demonic face",
    }),
    eyes: choice(`What eyes does ${ONE} have?`, {
      normal: "ordinary eyes", angry: "angry, fierce, glaring eyes", big: "big cute eyes", one: "a single big eye, like a cyclops",
      three: "three or more eyes, like a spider", glowing: "glowing eyes",
    }),
    mouth: choice(`What is most noticeable about the mouth of ${ONE}?`, {
      smile: "a smile", fangs: "fangs, tusks or rows of sharp teeth", frown: "a frown or grim mouth", beak: "a beak", none: "no visible mouth",
    }),
    headwear: choice(`What does ${ONE} wear or have on top of its head?`, {
      none: "nothing special", helmet: "a helmet", crown: "a crown", tophat: "a top hat", wizard: "a pointed wizard or witch hat",
      spiky_hair: "spiky hair", long_hair: "long flowing hair", halo: "a halo", cap: "a cap or baseball hat",
    }),
    ears: choice(`What ears does ${ONE} have?`, {
      none: "no visible ears", round: "small round ears, like a bear or a mouse", pointy: "pointed ears, like a cat, a wolf or an elf", long: "long ears, like a rabbit or a donkey",
    }),
    horns: choice(`What horns, antlers or tusks does ${ONE} have?`, {
      none: "none", short: "short horns, like a goat or a devil", long: "long horns, like a bull, a ram or a rhino", antlers: "branching antlers, like a deer or a moose", tusks: "tusks, like an elephant, a boar or a walrus",
    }),
    snout: score(`What does the face of ${ONE} look like from the side?`, [
      "flat face with no snout, like a human, an owl or a pug", "short muzzle, like a cat or a bear cub", "medium snout, like a dog or a bear",
      "long snout or big jaws, like a wolf, a horse or a shark", "very long jaws, like a crocodile or a T-rex",
    ]),
    mane: noul(`Does ${ONE} have a mane, a beard, or a big ruff of hair or feathers around its head?`),
    pattern: choice(`What markings does ${ONE} have?`, { plain: "plain, one colour, no clear markings", stripes: "stripes, like a tiger or a bee", spots: "spots, like a leopard, a ladybird or a cow" }),
    cape: noul(`Does ${ONE} wear a cape, cloak or robe?`),
    belly: noul(`Does ${ONE} have a clearly lighter-coloured belly or chest?`),
  };
}

function designQuestions() {
  return {
    frame: choice(`What is the overall body layout of ${ONE}?`, {
      upright: "stands or floats upright with its body vertical, like a person, an ape, a penguin, a ghost or a robot",
      horizontal: "body held level on legs, like a dog, a horse, a lizard, a spider, an insect or a crab",
      long: "a long bendy body, like a snake, a worm, an eel, a shark, a fish or a centipede",
      round: "a round ball-shaped body, like a slime, a jellyfish, a pufferfish, a beholder or a boulder",
      wheeled: "a vehicle or machine on wheels, like a car, a tank, a Roomba or a shopping trolley",
    }),
    loco: choice(`How does ${ONE} mainly move around?`, {
      walk: "walks on legs", gallop: "gallops or runs fast on four legs", crawl: "scuttles or crawls on many legs", hop: "hops or bounces",
      slither: "slithers or wriggles on its belly", roll: "rolls along", fly: "flies with wings", float: "floats or hovers in the air without wings",
      flop: "flops around, like a fish out of water", drive: "drives on wheels or treads",
    }),
    clumsy: score(`How graceful or clumsy is ${ONE} when it moves?`, ["very graceful and precise", "graceful", "ordinary", "clumsy", "extremely clumsy and flailing"]),
    legs: choice(`How many legs does ${ONE} have?`, { "0": "no legs", "2": "two legs", "4": "four legs", "6": "six legs, like an insect", "8": "eight legs, like a spider or a crab", "12": "many legs, like a centipede" }),
    leg_len: score(`How long are the legs of ${ONE}, compared with its body?`, ["no legs or tiny stubs", "short, like a corgi or a crocodile", "average", "long, like a deer or a horse", "very long, like a giraffe, a flamingo or a daddy-long-legs"]),
    leg_thick: score(`How thick are the legs of ${ONE}?`, ["very thin and spindly", "slender", "average", "thick and sturdy", "enormous pillars, like an elephant"]),
    foot: choice(`What are the feet of ${ONE} like?`, { paw: "paws", hoof: "hooves", claw: "clawed or taloned feet", foot: "human feet, boots or shoes", stump: "stumpy round feet, pads or bases" }),
    arms: choice(`How many arms does ${ONE} have in addition to the legs it walks on? Four-legged animals like bears, dogs and horses have no arms; people and apes have two; crabs and mantises have two.`, { "0": "no arms", "2": "two arms", "4": "four arms", "6": "six arms" }),
    arm_len: score(`How long are the arms of ${ONE}?`, ["no arms or tiny arms, like a T-rex", "short", "average, like a human", "long, like an ape", "very long, reaching the ground"]),
    hand: choice(`What does ${ONE} have at the end of its arms?`, {
      hand: "ordinary hands or fists", claw: "big claws", pincer: "pincers, like a crab or a scorpion", blade: "blades or scythes, like a mantis",
      hammer: "big heavy fists, hammers or mallets",
    }),
    heads: choice(`How many heads does ${ONE} have?`, { "0": "no distinct head", "1": "one head", "2": "two heads", "3": "three heads", "5": "five or more heads, like a hydra" }),
    head_size: score(`How big is the head of ${ONE}, compared with its body?`, ["tiny head", "small head", "average head", "big head", "huge head, like a T-rex or a cartoon character"]),
    neck: score(`How long is the neck of ${ONE}?`, ["no visible neck", "short neck", "average neck", "long neck, like a horse or a camel", "very long neck, like a giraffe or a brachiosaurus"]),
    wings: choice(`What wings does ${ONE} have?`, { none: "no wings", feather: "feathered bird wings", bat: "leathery bat or dragon wings", insect: "thin insect or fairy wings" }),
    wing_size: score(`How big are the wings of ${ONE}, compared with its body?`, ["tiny or no wings", "small wings", "medium wings", "huge wings"]),
    tail: choice(`What tail does ${ONE} have?`, {
      none: "no tail", thin: "a thin tail, like a cat, a rat or a monkey", thick: "a thick heavy tail, like a crocodile or a dinosaur",
      bushy: "a big bushy tail, like a fox or a squirrel", club: "a club or mace at the end of its tail, like an ankylosaurus",
      stinger: "a stinger at the end of its tail, like a scorpion or a wasp", fin: "a tail fin, like a fish, a shark or a mermaid",
    }),
    tail_len: score(`How long is the tail of ${ONE}?`, ["no tail", "short tail", "medium tail", "long tail", "very long tail, longer than its body"]),
    tentacles: choice(`How many soft boneless tentacles, like an octopus or a jellyfish has, does ${ONE} have? Legs, necks and tails are not tentacles.`, { "0": "none", "2": "two", "4": "four", "6": "six", "8": "eight or more, like an octopus" }),
    back: choice(`What is on the back of ${ONE}?`, {
      none: "nothing special", spikes: "spikes or spines", plates: "big plates, like a stegosaurus", shell: "a shell, like a turtle or a snail",
      fin: "a fin, like a shark or a dolphin", hump: "a hump, like a camel",
    }),
    body_len: score(`How long is the body of ${ONE}, compared with its height?`, ["very short and compact", "short", "average", "long, like a dachshund or a crocodile", "very long, like a weasel, a train or a dragon"]),
    bulk: score(`How thick or bulky is the body of ${ONE}?`, ["thin and slender, like a stick insect", "lean", "average", "stocky, like a bulldog or a bear", "very bulky and round, like a hippo or a sumo wrestler"]),
    material: choice(`What is ${ONE} mostly made of, or covered in?`, {
      skin: "bare skin", fur: "fur or hair", feathers: "feathers", scales: "scales, chitin or a hard shell", metal: "metal, like a robot, armour or a machine",
      slime: "slime, jelly or goo", stone: "stone, rock or crystal", wood: "wood, bark or plants", ghost: "nothing solid: it is a ghost, spirit or shadow",
      fire: "fire, lava or flames", ice: "ice, snow or frost",
    }),
    ranged: choice(`What ranged attack, if any, does ${ONE} have?`, RANGED_DESC),
    element: choice(`What extra harm do the close-up attacks of ${ONE} carry?`, {
      none: "nothing extra", fire: "they burn", ice: "they freeze", poison: "they poison or envenom", electric: "they shock with electricity", acid: "they burn with acid",
    }),
    ...Object.fromEntries((Object.keys(VERB_DESC) as Verb[]).map((v) => [`atk_${v}`, noul(`Does ${ONE} fight mainly by ${VERB_DESC[v]}?`)])),
    ...Object.fromEntries((Object.keys(DTYPE_DESC) as DType[]).map((d) => [`res_${d}`, noul(`Is ${ONE} naturally very resistant to ${DTYPE_DESC[d]}?`)])),
    ...Object.fromEntries((Object.keys(DTYPE_DESC) as DType[]).map((d) => [`weak_${d}`, noul(`Is ${ONE} especially vulnerable to ${DTYPE_DESC[d]}?`)])),
    ...Object.fromEntries((Object.keys(SPECIAL_DESC) as Special[]).map((sp) => [`sp_${sp}`, noul(`Does ${ONE} have this ability: it ${SPECIAL_DESC[sp]}?`)])),
  };
}

// ---------------------------------------------------------------- the call

export type JevResult =
  | { ok: true; spec: UnitSpec; tokens: number; ms: number; confidence: Record<string, number> }
  | { ok: false; reason: string; tokens: number; ms: number };

async function ask(phrase: string, questions: Record<string, unknown>, apiKey: string) {
  const body = JSON.stringify({
    model: MODEL,
    state: { phrase, context: "`phrase` is what a player typed to create an army in a cartoon physics battle game. Describe the thing itself, as it is usually imagined." },
    questions,
  });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  if (!res || !res.ok) throw new Error(`TypeSafe ${res?.status}: ${(await res?.text())?.slice(0, 300)}`);
  return (await res.json()) as { answers: Record<string, Answer>; usage: { input_tokens: number } };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function phraseToSpec(phrase: string, apiKey: string): Promise<JevResult> {
  const t0 = Date.now();
  const [A, B] = await Promise.all([ask(phrase, beingQuestions(), apiKey), ask(phrase, designQuestions(), apiKey)]);
  const a = { ...A.answers, ...B.answers };
  const tokens = A.usage.input_tokens + B.usage.input_tokens;
  const ms = Date.now() - t0;
  const N = (k: string) => (a[k] as { noul: number }).noul;
  const C = (k: string) => (a[k] as { choice: string }).choice;
  const S = (k: string) => (a[k] as { score: number }).score;
  const P = (k: string) => (a[k] as { probabilities: Record<string, number> }).probabilities;

  if (N("physical") < 0.4) return { ok: false, reason: `"${phrase}" has no body to fight with (Jev: ${pct(N("physical"))} sure it's physical).`, tokens, ms };
  if (N("real_person") > 0.6) return { ok: false, reason: `"${phrase}" looks like a real person. Pick a kind of person instead.`, tokens, ms };
  if (N("hateful") > 0.6) return { ok: false, reason: "Armies can't be defined by who people are. Try what they do instead.", tokens, ms };

  let count = parseCount(phrase);
  if (count === null) {
    // Probability-weighted geometric mean, so an unsure "swarm" lands between "group" and "horde".
    const probs = P("count");
    let logSum = 0;
    for (const c of COUNT) logSum += (probs[c[0]] ?? 0) * Math.log((c[1] + c[2]) / 2);
    count = Math.round(Math.exp(logSum));
  }

  // Attacks: the verbs Jev is most sure of, at most two.
  const verbs = (Object.keys(VERB_DESC) as Verb[]).map((v) => [v, N(`atk_${v}`)] as const).sort((x, y) => y[1] - x[1]);
  const attacks = verbs.filter(([, p], i) => i === 0 || p > 0.5).slice(0, 2).map(([v]) => v);
  const dtypes = Object.keys(DTYPE_DESC) as DType[];
  const genome: Genome = {
    frame: C("frame") as Frame,
    loco: C("loco") as Loco,
    clumsy: map([0, 0.2, 0.4, 0.7, 1], S("clumsy")),
    legs: Number(C("legs")),
    legLen: map([0.45, 0.7, 1, 1.25, 1.55], S("leg_len")),
    legThick: map([0.6, 0.8, 1, 1.3, 1.7], S("leg_thick")),
    foot: C("foot") as Foot,
    arms: Number(C("arms")),
    armLen: map([0.45, 0.75, 1, 1.25, 1.55], S("arm_len")),
    hand: C("hand") as Hand,
    heads: Number(C("heads")),
    headSize: map([0.6, 0.8, 1, 1.3, 1.75], S("head_size")),
    neckLen: map([0.3, 0.8, 1.1, 2, 3], S("neck")),
    wings: C("wings") as WingKind,
    wingSize: map([0.6, 0.9, 1.2, 1.7], S("wing_size")),
    tail: C("tail") as TailKind,
    tailLen: map([0.4, 0.7, 1, 1.35, 1.8], S("tail_len")),
    tentacles: Number(C("tentacles")),
    back: C("back") as Back,
    bodyLen: map([0.7, 0.85, 1, 1.25, 1.6], S("body_len")),
    bulk: map([0.7, 0.85, 1, 1.25, 1.55], S("bulk")),
    material: C("material") as Material,
    attacks,
    ranged: C("ranged") as Ranged,
    element: C("element") as Element,
    resist: dtypes.filter((d) => N(`res_${d}`) > 0.7),
    weak: dtypes.filter((d) => N(`weak_${d}`) > 0.7),
    specials: (Object.keys(SPECIAL_DESC) as Special[]).filter((sp) => N(`sp_${sp}`) > 0.6),
  };
  // Anatomy sanity. Jev can double-count limbs: a kraken's tentacles are its legs and arms,
  // and a knuckle-walking ape is still an upright body with two legs.
  if (genome.tentacles >= 6) {
    genome.legs = 0;
    genome.arms = 0;
  }
  if (genome.frame === "upright" && genome.arms >= 2 && genome.legs === 4) genome.legs = 2;
  // A thing can't both resist and fear the same harm; resistance wins.
  genome.weak = genome.weak.filter((d) => !genome.resist.includes(d));

  const features: Features = {
    bodyLength: genome.bodyLen, legLength: genome.legLen, neckLength: genome.neckLen, bulk: genome.bulk,
    snout: map([0, 0.25, 0.45, 0.75, 1.1], S("snout")), ears: C("ears") as Ears, horns: C("horns") as Horns, tail: "none",
    dorsalFin: genome.back === "fin", spikes: genome.back === "spikes", mane: N("mane") > 0.5, pattern: C("pattern") as Pattern,
    legs: genome.legs >= 8 ? 8 : 6, face: C("face") as Face, eyes: C("eyes") as Eyes, mouth: C("mouth") as Mouth,
    headwear: C("headwear") as Headwear, cape: N("cape") > 0.55, belly: N("belly") > 0.55,
  };
  const bodyColor = COLORS[C("body_color")] ?? "#8d8f96";
  let accent = COLORS[C("accent_color")] ?? "#2a2a2e";
  if (accent === bodyColor) accent = bodyColor === COLORS.black ? COLORS.grey : COLORS.black;

  // An artist-rigged model skins ordinary animals only.
  const mAns = a.model as { choice: string; probabilities: Record<string, number> };
  const modelId = mAns.choice !== "none" && (mAns.probabilities[mAns.choice] ?? 0) >= 0.5 && genome.heads <= 1 && genome.wings === "none" && genome.tentacles === 0 && genome.ranged === "none" ? mAns.choice : undefined;

  const planOf: Record<Frame, PlanId> = { upright: "biped", horizontal: "quadruped", long: "snake", round: "blob", wheeled: "wheeled" };
  const attackOf = (v: Verb): Attack => (v === "bite" || v === "peck" ? v : v === "punch" ? "punch" : v === "kick" || v === "stomp" ? "kick" : v === "slash" || v === "claw" ? "slash" : v === "charge" || v === "slam" ? "ram" : "charge");
  const spec: UnitSpec = {
    label: phrase,
    count: Math.max(1, Math.min(150, count)),
    plan: planOf[genome.frame],
    size: lerpLog(SIZE, S("size")),
    weight: lerpLog(WEIGHT, S("weight")),
    strength: map([0.45, 0.75, 1, 1.6, 3, 4.5], S("strength")),
    toughness: map([0.45, 0.7, 1, 2, 3.5, 6], S("toughness")),
    speed: map([0.4, 0.7, 1, 1.4, 2], S("speed")),
    bravery: map([0.1, 0.3, 0.55, 0.85, 1], S("bravery")),
    armor: map([0, 0.1, 0.3, 0.6], S("armor")),
    attack: attackOf(attacks[0]),
    weapon: genome.arms > 0 ? (C("weapon") as Weapon) : "none",
    canFly: genome.loco === "fly",
    colors: { body: bodyColor, accent },
    features,
    genome,
    ...(modelId ? { model: modelId } : {}),
  };
  const confidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) if ("confidence" in v) confidence[k] = v.confidence;
  return { ok: true, spec, tokens, ms, confidence };
}
