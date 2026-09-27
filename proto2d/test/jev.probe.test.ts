// Live probe against Jev. Costs real tokens, so it only runs with JEV_PROBE=1.
import { writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { expect, it } from "vitest";
import { parseCount, phraseToSpec } from "../src/ai/jev";
import type { UnitSpec } from "../src/sim/spec";

it("parses explicit counts in code", () => {
  expect(parseCount("100 men")).toBe(100);
  expect(parseCount("a hundred men")).toBe(100);
  expect(parseCount("three house cats")).toBe(3);
  expect(parseCount("a gorilla")).toBe(1);
  expect(parseCount("a swarm of angry geese")).toBeNull();
  expect(parseCount("zombies")).toBeNull();
});

export const describeG = (s: UnitSpec) => {
  const g = s.genome!;
  const bits = [
    `n=${s.count}`, `${s.size.toFixed(1)}m`, `${Math.round(s.weight)}kg`, s.model ? `3D:${s.model}` : "", `${g.frame}/${g.loco}`,
    `legs${g.legs}`, `arms${g.arms}${g.hand !== "hand" ? `(${g.hand})` : ""}`, `heads${g.heads}`, g.wings !== "none" ? `${g.wings}-wings` : "",
    g.tail !== "none" ? `${g.tail}-tail` : "", g.tentacles ? `${g.tentacles}tent` : "", g.back !== "none" ? g.back : "", g.material,
    `atk=${g.attacks.join("+")}`, g.ranged !== "none" ? `ranged=${g.ranged}` : "", g.element !== "none" ? `el=${g.element}` : "",
    g.resist.length ? `res=${g.resist}` : "", g.weak.length ? `weak=${g.weak}` : "", g.specials.length ? `sp=${g.specials}` : "", s.weapon !== "none" ? s.weapon : "",
  ];
  return bits.filter(Boolean).join(" ");
};

const PHRASES = (process.env.JEV_PHRASES ?? "").split("|").filter(Boolean);

it.skipIf(!process.env.JEV_PROBE)("phrases -> specs", async () => {
  const key = loadEnv("development", "../..", "").TYPESAFE_API_KEY;
  expect(key, "TYPESAFE_API_KEY missing").toBeTruthy();
  let tokens = 0;
  const out: Record<string, UnitSpec> = {};
  const results = await Promise.all(PHRASES.map((p) => phraseToSpec(p, key!).then((r) => [p, r] as const)));
  for (const [phrase, r] of results) {
    tokens += r.tokens;
    if (!r.ok) {
      console.log(`${phrase.padEnd(28)} REFUSED ${r.reason}`);
      continue;
    }
    out[phrase] = r.spec;
    console.log(`${phrase.padEnd(28)} ${describeG(r.spec)} ${r.ms}ms`);
  }
  if (process.env.JEV_OUT) writeFileSync(process.env.JEV_OUT, JSON.stringify(out));
  console.log(`total input tokens ${tokens}  ~$${((tokens * 0.042) / 1e6).toFixed(5)}`);
}, 300_000);
