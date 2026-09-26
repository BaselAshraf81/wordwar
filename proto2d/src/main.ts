import { Renderer } from "./render";
import { Battle, DT, initPhysics } from "./sim/battle";
import { MATCHUPS, type Matchup } from "./sim/spec";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const renderer = new Renderer(canvas);

let battle: Battle | null = null;
let matchup: Matchup = MATCHUPS[0];
let seed = 1;
let slow = false;
let paused = false;
let acc = 0;
let last = performance.now();

function readHash(): void {
  const q = new URLSearchParams(location.hash.slice(1));
  matchup = MATCHUPS.find((m) => m.id === q.get("m")) ?? MATCHUPS[0];
  const s = Number(q.get("s"));
  seed = Number.isFinite(s) && s > 0 ? Math.floor(s) : 1 + Math.floor(Math.random() * 99999);
}

function writeHash(): void {
  history.replaceState(null, "", `#m=${matchup.id}&s=${seed}`);
}

function start(): void {
  battle?.dispose();
  battle = new Battle([matchup.left, matchup.right], seed);
  renderer.attach(battle);
  acc = 0;
  writeHash();
  $("lname").textContent = matchup.left.label;
  $("rname").textContent = matchup.right.label;
  $("seed").textContent = `fight #${seed}`;
  $("banner").hidden = true;
  $<HTMLSelectElement>("matchups").value = matchup.id;
}

function hud(b: Battle): void {
  $("lcount").textContent = `${b.aliveCount(0)} / ${b.specs[0].count} standing`;
  $("rcount").textContent = `${b.aliveCount(1)} / ${b.specs[1].count} standing`;
  $("clock").textContent = `${b.time.toFixed(1)}s`;
  const banner = $("banner");
  if (b.result && banner.hidden) {
    const w = b.result.winner;
    const name = w === null ? "Nobody" : b.specs[w].label;
    const other = w === null ? "" : b.specs[1 - w].label;
    const left = w === null ? 0 : b.result.alive[w];
    const lost = w === null ? 0 : b.specs[w].count - left;
    banner.innerHTML = "";
    banner.append(`${name} win${w !== null && b.specs[w].count === 1 ? "s" : ""}`);
    const small = document.createElement("small");
    small.textContent =
      w === null ? `Draw after ${b.result.time.toFixed(1)}s` : `beat ${other} in ${b.result.time.toFixed(1)}s, losing ${lost} of ${b.specs[w].count}`;
    banner.append(small);
    banner.hidden = false;
  }
}

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (battle && !paused) {
    acc += dt * (slow ? 0.3 : 1);
    let n = 0;
    while (acc >= DT && n < 4) {
      battle.step();
      acc -= DT;
      n++;
    }
    if (n === 4) acc = 0; // fall behind gracefully rather than spiral
  }
  if (battle) {
    renderer.render(battle);
    hud(battle);
  }
  requestAnimationFrame(loop);
}

async function main(): Promise<void> {
  const pick = $<HTMLSelectElement>("matchups");
  for (const m of MATCHUPS) pick.add(new Option(m.title, m.id));
  pick.onchange = () => {
    matchup = MATCHUPS.find((m) => m.id === pick.value) ?? MATCHUPS[0];
    seed = 1 + Math.floor(Math.random() * 99999);
    start();
    pick.blur();
  };
  $("restart").onclick = start;
  $("reseed").onclick = () => {
    seed = 1 + Math.floor(Math.random() * 99999);
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
    if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
    if (e.key === "r") start();
    else if (e.key === "n") $("reseed").click();
    else if (e.key === "s") slowBtn.click();
    else if (e.key === " ") {
      paused = !paused;
      e.preventDefault();
    }
  });
  addEventListener("resize", () => renderer.resize());
  addEventListener("hashchange", () => {
    readHash();
    start();
  });

  renderer.resize();
  await initPhysics();
  readHash();
  start();
  requestAnimationFrame(loop);
}

main();
