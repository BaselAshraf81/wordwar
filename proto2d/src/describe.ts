// One-line summary of what Jev designed, shown under each army's name.
import { genomeOf, type UnitSpec } from "./sim/spec";

const VERB_WORD: Record<string, string> = {
  bite: "bites", peck: "pecks", headbutt: "headbutts", gore: "gores", claw: "claws", punch: "punches", slash: "slashes", pinch: "pinches",
  kick: "kicks", stomp: "stomps", charge: "charges", slam: "body-slams", tail_swipe: "tail-swipes", sting: "stings", whip: "whips",
};
const RANGED_WORD: Record<string, string> = {
  spit: "spits acid", fire_breath: "breathes fire", ice_breath: "breathes frost", shoot: "shoots", throw_rock: "throws rocks",
  lightning: "casts lightning", laser: "fires lasers", poison_spray: "sprays poison", web: "shoots webs",
};
export const describe = (s: UnitSpec) => {
  const g = genomeOf(s);
  const size = s.size < 1 ? `${Math.round(s.size * 100)} cm` : `${s.size.toFixed(1)} m`;
  const kg = s.weight < 10 ? s.weight.toFixed(1) : s.weight < 2000 ? Math.round(s.weight).toString() : `${(s.weight / 1000).toFixed(1)} t`;
  const body = [g.heads > 1 ? `${g.heads} heads` : "", g.legs ? `${g.legs} legs` : "", g.arms ? `${g.arms} arms` : "", g.tentacles ? `${g.tentacles} tentacles` : "", g.wings !== "none" ? "wings" : ""].filter(Boolean).join(", ");
  const acts = [...g.attacks.map((v) => VERB_WORD[v]), g.ranged !== "none" ? RANGED_WORD[g.ranged] : "", ...g.specials.map((x) => (x === "split" ? "splits" : x === "explode" ? "explodes" : x === "regenerate" ? "heals" : x))].filter(Boolean).join(", ");
  return `${g.material}, ${size}, ${kg} kg${body ? `, ${body}` : ""} | ${acts}${g.weak.length ? ` | weak to ${g.weak.join("/")}` : ""}`;
};
