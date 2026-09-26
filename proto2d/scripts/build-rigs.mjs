// Offline art rigger. Emoji SVG -> alpha mask -> cut into pieces that ride on the game's
// own skeleton. Legs are NOT taken from the art (emoji are drawn mid-gallop); everything
// below the belly line is dropped and replaced by procedural physics legs at runtime.
//
// Output src/art/rigs.json, per rig:
//   bbox [x0,y0,x1,y1] in a RES x RES render, belly (y px), cuts [headX, tailX] (px),
//   faceLeft, labels (RLE: 0 dropped, 1 body, 2 head, 3 tail).
import { Resvg } from "@resvg/resvg-js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CANDIDATES, FACES_RIGHT } from "./emoji-list.mjs";
import { svgOf } from "./svg-cache.mjs";

const RES = 128;
const LEGGED = new Set(["quadruped", "bird"]);

if (process.argv[2] === "--render") {
  const cp = process.argv[3];
  const img = new Resvg(readFileSync(`public/emoji/${cp}.svg`, "utf8"), { fitTo: { mode: "width", value: RES } }).render();
  const m = new Uint8Array(RES * RES);
  for (let i = 0; i < m.length; i++) m[i] = img.pixels[i * 4 + 3] > 128 ? 1 : 0;
  writeFileSync(`scripts/.masks/${cp}.bin`, m);
  process.exit(0);
}

// resvg leaks native memory across many renders, so each mask renders in its own process.
function mask(cp) {
  const path = `scripts/.masks/${cp}.bin`;
  if (!existsSync(path)) {
    mkdirSync("scripts/.masks", { recursive: true });
    const r = spawnSync(process.execPath, ["scripts/build-rigs.mjs", "--render", cp], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`render ${cp} failed`);
  }
  return new Uint8Array(readFileSync(path));
}

function bbox(m) {
  let x0 = RES, y0 = RES, x1 = -1, y1 = -1;
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) if (m[y * RES + x]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, W: x1 - x0 + 1, H: y1 - y0 + 1 };
}

const rowFill = (m, bb, y) => {
  let n = 0;
  for (let x = bb.x0; x <= bb.x1; x++) n += m[y * RES + x];
  return n / bb.W;
};

/** Lowest row where the body is still solid across most of its middle: the belly line. */
function belly(m, bb) {
  const rows = [];
  for (let y = bb.y0; y <= bb.y1; y++) rows.push(rowFill(m, bb, y));
  const peak = Math.max(...rows);
  for (let y = bb.y1; y >= bb.y0; y--) if (rowFill(m, bb, y) > 0.55 * peak) return y;
  return -1;
}


function rig(cp, id, desc, plan) {
  const m = mask(cp);
  const bb = bbox(m);
  const labels = new Uint8Array(RES * RES);
  let by = bb.y1;
  if (LEGGED.has(plan)) {
    by = belly(m, bb);
    const legFrac = (bb.y1 - by) / bb.H;
    if (by < 0 || legFrac > 0.6) return { reject: "belly line not found" };
    // Stubby drawings keep their painted feet; the physics legs under them stay hidden.
    if (legFrac < 0.1) by = bb.y1;
  }
  const left = !FACES_RIGHT.has(id);
  // Head and tail cuts along x, measured from the facing end.
  const hx = plan === "fish" ? 0.33 : plan === "bird" ? 0.36 : 0.3;
  const tx = plan === "fish" ? 0.3 : 0.2;
  const headCut = left ? bb.x0 + hx * bb.W : bb.x1 - hx * bb.W;
  const tailCut = left ? bb.x1 - tx * bb.W : bb.x0 + tx * bb.W;
  const counts = [0, 0, 0, 0];
  const boxes = [null, [RES, RES, -1, -1], [RES, RES, -1, -1], [RES, RES, -1, -1]];
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    const i = y * RES + x;
    if (!m[i] || y > by + 1) continue; // below the belly: legs, replaced at runtime
    let L = 1;
    if (plan !== "wheeled") {
      const front = left ? x < headCut : x > headCut;
      const back = left ? x > tailCut : x < tailCut;
      L = front ? 2 : back ? 3 : 1;
    }
    labels[i] = L;
    counts[L]++;
    const b = boxes[L];
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  const kept = counts[1] + counts[2] + counts[3];
  if (counts[1] < 0.25 * kept) return { reject: "body piece too small" };
  if (plan !== "wheeled" && counts[2] < 0.05 * kept) return { reject: "no head piece" };
  let rle = "", prev = labels[0], n = 0;
  for (const v of labels) { if (v === prev) n++; else { rle += `${prev}:${n},`; prev = v; n = 1; } }
  rle += `${prev}:${n}`;
  return {
    rig: { id, cp, desc, plan, res: RES, bbox: [bb.x0, bb.y0, bb.x1, bb.y1], belly: by, pieces: boxes.slice(1).map((b) => (b[2] < 0 ? null : b)), cuts: [Math.round(headCut), Math.round(tailCut)], faceLeft: left, labels: rle },
    labels, bb,
  };
}

function ascii(labels, bb) {
  let s = "";
  for (let y = bb.y0; y <= bb.y1; y += 5) {
    for (let x = bb.x0; x <= bb.x1; x += 2.5) s += ".BHT"[labels[y * RES + Math.floor(x)]];
    s += "\n";
  }
  return s;
}

const SUPPORTED = new Set(["quadruped", "bird", "fish", "wheeled"]);
const rigs = [];
const show = process.argv.slice(2).filter((a) => !a.startsWith("-"));
for (const [cp, id, desc, plan] of CANDIDATES) {
  if (!SUPPORTED.has(plan)) continue;
  await svgOf(cp);
  const r = rig(cp, id, desc, plan);
  if (r.reject) { console.log(`REJECT ${id}: ${r.reject}`); continue; }
  const legs = ((r.bb.y1 - r.rig.belly) / r.bb.H * 100).toFixed(0);
  console.log(`ok ${id.padEnd(14)} ${plan.padEnd(9)} legs=${legs}% ${r.rig.faceLeft ? "faces-left" : "faces-right"}`);
  if (show.includes(id)) console.log(ascii(r.labels, r.bb));
  rigs.push(r.rig);
}
mkdirSync("src/art", { recursive: true });
writeFileSync("src/art/rigs.json", JSON.stringify(rigs));
console.log(`${rigs.length} rigs written`);
