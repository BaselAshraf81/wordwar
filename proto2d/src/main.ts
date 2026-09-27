import { ModelView } from "./model-view";
import { Renderer } from "./render";
import { Battle, DT, initPhysics } from "./sim/battle";
import { genomeOf, MATCHUPS, type UnitSpec } from "./sim/spec";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const renderer = new Renderer(canvas);
const models = new ModelView($<HTMLCanvasElement>("models"));
renderer.hideUnit = (u) => models.shows(u);

let battle: Battle | null = null;
let specs: [UnitSpec, UnitSpec] = [MATCHUPS[0].left, MATCHUPS[0].right];
let presetId: string | null = MATCHUPS[0].id;
let seed = 1;
let slow = false;
let paused = false;
let acc = 0;
let last = performance.now();

const newSeed = () => 1 + Math.floor(Math.random() * 99999);

// Replay links carry the specs themselves, so a shared fight replays exactly,
// without asking Jev again and even if Jev's answers change later.
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

function readHash(): void {
  const q = new URLSearchParams(location.hash.slice(1));
  const s = Number(q.get("s"));
  seed = Number.isFinite(s) && s > 0 ? Math.floor(s) : newSeed();
  const u = q.get("u");
  if (u) {
    try {
      const parsed = JSON.parse(unb64(u)) as [UnitSpec, UnitSpec];
      if (Array.isArray(parsed) && parsed.length === 2) {
        specs = parsed.map((x) => ({ ...x, count: Math.max(1, Math.min(150, Math.floor(x.count))) })) as [UnitSpec, UnitSpec];
        presetId = null;
        return;
      }
    } catch {
      /* fall through to a preset */
    }
  }
  const m = MATCHUPS.find((x) => x.id === q.get("m")) ?? MATCHUPS[0];
  specs = [m.left, m.right];
  presetId = m.id;
}

function writeHash(): void {
  const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  const h = presetId ? `#m=${presetId}&s=${seed}` : `#u=${b64(JSON.stringify(specs, round))}&s=${seed}`;
  history.replaceState(null, "", h);
}

const VERB_WORD: Record<string, string> = {
  bite: "bites", peck: "pecks", headbutt: "headbutts", gore: "gores", claw: "claws", punch: "punches", slash: "slashes", pinch: "pinches",
  kick: "kicks", stomp: "stomps", charge: "charges", slam: "body-slams", tail_swipe: "tail-swipes", sting: "stings", whip: "whips",
};
const RANGED_WORD: Record<string, string> = {
  spit: "spits acid", fire_breath: "breathes fire", ice_breath: "breathes frost", shoot: "shoots", throw_rock: "throws rocks",
  lightning: "casts lightning", laser: "fires lasers", poison_spray: "sprays poison", web: "shoots webs",
};
const describe = (s: UnitSpec) => {
  const g = genomeOf(s);
  const size = s.size < 1 ? `${Math.round(s.size * 100)} cm` : `${s.size.toFixed(1)} m`;
  const kg = s.weight < 10 ? s.weight.toFixed(1) : s.weight < 2000 ? Math.round(s.weight).toString() : `${(s.weight / 1000).toFixed(1)} t`;
  const body = [g.heads > 1 ? `${g.heads} heads` : "", g.legs ? `${g.legs} legs` : "", g.arms ? `${g.arms} arms` : "", g.tentacles ? `${g.tentacles} tentacles` : "", g.wings !== "none" ? "wings" : ""].filter(Boolean).join(", ");
  const acts = [...g.attacks.map((v) => VERB_WORD[v]), g.ranged !== "none" ? RANGED_WORD[g.ranged] : "", ...g.specials.map((x) => (x === "split" ? "splits" : x === "explode" ? "explodes" : x === "regenerate" ? "heals" : x))].filter(Boolean).join(", ");
  return `${g.material}, ${size}, ${kg} kg${body ? `, ${body}` : ""} | ${acts}${g.weak.length ? ` | weak to ${g.weak.join("/")}` : ""}`;
};

function start(): void {
  battle?.dispose();
  battle = new Battle(specs, seed);
  renderer.attach(battle);
  models.attach(battle);
  acc = 0;
  writeHash();
  $("lname").textContent = specs[0].label;
  $("rname").textContent = specs[1].label;
  $("lspec").textContent = describe(specs[0]);
  $("rspec").textContent = describe(specs[1]);
  $("seed").textContent = `fight #${seed}`;
  const banner = $("banner");
  banner.hidden = true;
  banner.classList.remove("refused");
  $<HTMLInputElement>("left").value = specs[0].label;
  $<HTMLInputElement>("right").value = specs[1].label;
  $<HTMLSelectElement>("matchups").value = presetId ?? "";
}

function say(title: string, detail: string, refused = false): void {
  const banner = $("banner");
  banner.replaceChildren(title);
  const small = document.createElement("small");
  small.textContent = detail;
  banner.append(small);
  banner.classList.toggle("refused", refused);
  banner.hidden = false;
}

type ApiResult = { ok: true; spec: UnitSpec; ms: number; tokens: number } | { ok: false; reason: string } | { error: string };

async function askJev(phrase: string): Promise<ApiResult> {
  const r = await fetch("/api/unit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
  return (await r.json()) as ApiResult;
}

async function fight(e: Event): Promise<void> {
  e.preventDefault();
  const phrases = [$<HTMLInputElement>("left").value.trim(), $<HTMLInputElement>("right").value.trim()];
  if (phrases[0] === specs[0].label && phrases[1] === specs[1].label) {
    seed = newSeed();
    start();
    return;
  }
  const btn = $<HTMLButtonElement>("fight");
  btn.disabled = true;
  btn.textContent = "Jev is deciding…";
  paused = true;
  try {
    const results = await Promise.all(phrases.map(askJev));
    for (let i = 0; i < 2; i++) {
      const r = results[i];
      if ("error" in r) return say("Something went wrong", r.error, true);
      if (!r.ok) return say(`Jev refused "${phrases[i]}"`, r.reason, true);
    }
    // Round-trip through the link format so a fresh fight and its shared replay use identical numbers.
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    specs = results.map((r) => {
      const s = (r as { spec: UnitSpec }).spec;
      return { ...s, size: r3(s.size), weight: r3(s.weight), strength: r3(s.strength), toughness: r3(s.toughness), speed: r3(s.speed), bravery: r3(s.bravery), armor: r3(s.armor) };
    }) as [UnitSpec, UnitSpec];
    presetId = null;
    seed = newSeed();
    start();
  } catch {
    say("Couldn't reach Jev", "Is the dev server running with TYPESAFE_API_KEY set?", true);
  } finally {
    paused = false;
    btn.disabled = false;
    btn.textContent = "Fight";
  }
}

function hud(b: Battle): void {
  $("lcount").textContent = `${b.aliveCount(0)} / ${b.specs[0].count} standing`;
  $("rcount").textContent = `${b.aliveCount(1)} / ${b.specs[1].count} standing`;
  $("clock").textContent = `${b.time.toFixed(1)}s`;
  if (b.result && $("banner").hidden) {
    const w = b.result.winner;
    if (w === null) return say("Nobody wins", `Draw after ${b.result.time.toFixed(1)}s`);
    const lost = b.specs[w].count - b.result.alive[w];
    say(`${b.specs[w].label} win${b.specs[w].count === 1 ? "s" : ""}`, `beat ${b.specs[1 - w].label} in ${b.result.time.toFixed(1)}s, losing ${lost} of ${b.specs[w].count}`);
  }
}

let stepMs = 2;
let drawMs = 3;
const prof = { sim: 0, draw: 0, frames: 0 };
if (import.meta.env.DEV) Object.assign(window, { __prof: prof, __r: renderer });

function resize(): void {
  renderer.resize();
  models.resize(canvas.width, canvas.height);
}

// Adaptive resolution. Filling hundreds of ragdoll shapes is pixel-bound, and much of it happens
// after our JS returns (rasterisation), so we watch the real frame interval: long frames lower the
// render resolution a notch, a run of fast ones raises it back.
// `best` is the fastest window seen: the display's own refresh interval (60, 120, or a 30 Hz
// battery-saver cap), so "slow" always means slower than this screen can go.
const adapt = { sum: 0, js: 0, n: 0, good: 0, need: 4, best: Infinity };
function adaptQuality(frameMs: number, jsMs: number): void {
  if (frameMs > 100) return; // tab was hidden or stalled: not a rendering signal
  adapt.sum += frameMs;
  adapt.js += jsMs;
  if (++adapt.n < 45) return;
  const avg = adapt.sum / adapt.n, js = adapt.js / adapt.n;
  adapt.sum = adapt.js = adapt.n = 0;
  adapt.best = Math.max(6, Math.min(adapt.best, avg));
  const q = renderer.quality;
  // Only when the time goes outside our JS (rasterising): fewer pixels don't make physics faster.
  if (avg > adapt.best * 1.3 && js > 4 && avg - js > adapt.best * 0.9 && q > 0.55) {
    renderer.quality = Math.max(0.55, q - 0.15);
    adapt.good = 0;
    adapt.need = 8; // after a drop, prove it for longer before trying sharper again
    resize();
  } else if (avg < adapt.best * 1.1 && q < 1 && ++adapt.good >= adapt.need) {
    renderer.quality = Math.min(1, q + 0.15);
    adapt.good = 0;
    resize();
  }
}

function loop(now: number): void {
  const raw = now - last;
  const dt = Math.min(0.1, raw / 1000);
  last = now;
  const t0 = performance.now();
  if (battle && !paused) {
    acc += dt * (slow ? 0.3 : 1);
    // Adaptive budget: never spend more than ~10 ms a frame on physics. A slow device gets a
    // slightly slower-motion fight instead of a frozen screen.
    // Steps that fit next to the drawing in ~12 ms. One step per frame is real time at 60 Hz, so
    // this only slows the fight when the machine can't keep up; without it a missed frame queues
    // two steps, which makes the next frame miss too.
    const cap = Math.max(1, Math.min(4, Math.floor((12 - drawMs) / Math.max(0.5, stepMs))));
    let n = 0;
    while (acc >= DT && n < cap) {
      const s0 = performance.now();
      battle.step();
      stepMs = stepMs * 0.9 + (performance.now() - s0) * 0.1;
      acc -= DT;
      n++;
    }
    if (n === cap) acc = Math.min(acc, DT);
  }
  const t1 = performance.now();
  if (battle) {
    renderer.render(battle);
    const v = renderer.view;
    models.render(v.x, v.scale, v.groundY, v.w, v.h);
    hud(battle);
  }
  const t2 = performance.now();
  drawMs = drawMs * 0.9 + (t2 - t1) * 0.1;
  prof.sim += t1 - t0;
  prof.draw += t2 - t1;
  prof.frames++;
  if (battle && !paused) adaptQuality(raw, t2 - t0);
  requestAnimationFrame(loop);
}

async function main(): Promise<void> {
  const pick = $<HTMLSelectElement>("matchups");
  for (const m of MATCHUPS) pick.add(new Option(m.title, m.id));
  pick.onchange = () => {
    const m = MATCHUPS.find((x) => x.id === pick.value);
    if (!m) return;
    specs = [m.left, m.right];
    presetId = m.id;
    seed = newSeed();
    start();
    pick.blur();
  };
  $("armies").addEventListener("submit", fight);
  $("restart").onclick = start;
  $("reseed").onclick = () => {
    seed = newSeed();
    start();
  };
  const slowBtn = $("slow");
  slowBtn.onclick = () => {
    slow = !slow;
    slowBtn.setAttribute("aria-pressed", String(slow));
  };
  $("share").onclick = async () => {
    await navigator.clipboard?.writeText(location.href);
    $("share").textContent = "Copied";
    setTimeout(() => ($("share").textContent = "Copy link"), 1200);
  };
  addEventListener("keydown", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
    if (e.key === "r") start();
    else if (e.key === "n") $("reseed").click();
    else if (e.key === "s") slowBtn.click();
    else if (e.key === " ") {
      paused = !paused;
      e.preventDefault();
    }
  });
  addEventListener("resize", resize);
  addEventListener("hashchange", () => {
    readHash();
    start();
  });

  resize();
  await initPhysics();
  readHash();
  start();
  requestAnimationFrame(loop);
}

main();
