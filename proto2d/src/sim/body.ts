// genomeBody: any Genome -> bones, joints, drawn parts and a move list.
// One code path for every creature. Frames decide the skeleton's layout; counts and sizes of
// legs, arms, heads, necks, wings, tails and tentacles are all Jev's choice.
import { VERBS } from "./combat";
import type { Blueprint, ColliderBP, DecoBP, MoveBP } from "./plans";
import { Builder, at, bwd, clamp, col, deco, faceDeco, fwd, headDeco, lim, pattern, safeAngle, tri, WEAPONS } from "./parts";
import { featuresOf, type Genome, type Loco, type UnitSpec, type Verb } from "./spec";

type PartKey = "head" | "arm" | "leg" | "tail" | "tentacle" | "body";
type Parts = Record<PartKey, string[]>;

/** Keep only moves the body can physically do; always leave at least one. */
export function movesFor(g: Genome, parts: Parts, reachOf: (id: string) => number): MoveBP[] {
  const out: MoveBP[] = [];
  const add = (verb: Verb) => {
    const segs = parts[VERBS[verb].part];
    if (segs.length && !out.some((m) => m.verb === verb)) out.push({ verb, segs, reach: Math.max(...segs.map(reachOf)) });
  };
  for (const v of g.attacks) add(v);
  if (!out.length) add(parts.head.length ? "bite" : parts.arm.length ? "punch" : parts.leg.length ? "kick" : "slam");
  if (!out.length) add("slam");
  // Floaters and things without limbs can always throw their whole body at you.
  if (!parts.arm.length && !parts.leg.length && (g.loco === "float" || g.loco === "fly" || g.frame === "upright")) add("charge");
  return out;
}

/** The body decides which movements are possible. */
export function locoOf(g: Genome, legs: number): Loco {
  let l = g.loco;
  if (g.frame === "wheeled") return "drive";
  if (l === "drive") l = legs ? "walk" : "hop";
  if (l === "fly" && g.wings === "none") l = "float";
  if ((l === "walk" || l === "gallop" || l === "crawl") && legs === 0) l = g.frame === "long" ? "slither" : g.material === "ghost" ? "float" : g.frame === "round" ? "roll" : "hop";
  if (l === "roll" && g.frame !== "round") l = "hop";
  return l;
}

const even = (n: number, max: number) => clamp(Math.round(n / 2) * 2, 0, max);

export function genomeBody(s: UnitSpec, g: Genome, f: 1 | -1, cheap: boolean): Blueprint {
  const F = featuresOf(s);
  const S = s.size;
  const b = new Builder(f);
  const nLegs = g.frame === "wheeled" ? 0 : even(g.legs, 12);
  const nArms = even(g.arms, 6);
  const nHeads = clamp(Math.round(g.heads), 0, 5);
  const nTent = clamp(Math.round(g.tentacles), 0, 8);
  const loco = locoOf(g, nLegs);
  const oneSegLegs = cheap || nLegs > 6;
  const side = g.frame !== "upright";
  const parts: Parts = { head: [], arm: [], leg: [], tail: [], tentacle: [], body: ["torso"] };
  const extra: Record<string, number> = {};
  const legs: Blueprint["legs"] = [];
  const arms: Blueprint["arms"] = [];
  const necks: string[][] = [];
  const wings: string[] = [];
  const tails: string[] = [];
  const tentacles: string[][] = [];
  const wave: string[] = [];
  const heads: string[] = [];
  const rh = 0.075 * S * g.headSize;
  const armLen = 0.32 * S * g.armLen;
  let weaponLen = 0;

  // ---------- reusable part makers ----------

  const makeHead = (id: string, pos: [number, number], parent: string, jointAt: [number, number]) => {
    const robot = F.face === "robot" || g.material === "metal";
    const cols: ColliderBP[] = [col({ shape: robot ? { kind: "box", hx: rh, hy: rh * 0.85 } : { kind: "ball", r: rh }, sharp: 1.2 })];
    const d: DecoBP[] = [...headDeco(F, f, rh), ...faceDeco(F, f, rh, side)];
    let reach = rh;
    if ((F.face === "animal" || F.face === "monster") && F.snout > 0.15) {
      const sn = F.snout * rh * 1.6;
      cols.push(col({ shape: { kind: "capsule", hh: sn / 2, r: rh * 0.48 }, offset: [f * (rh * 0.55 + sn / 2), -rh * 0.3], rot: Math.PI / 2, sharp: 1.8 }));
      d.push(deco({ kind: "ball", r: rh * 0.16 }, [f * (rh * 0.55 + sn + rh * 0.3), -rh * 0.18], { paint: "dark", front: true }));
      if (F.mouth === "fangs" || F.snout > 0.7) for (let i = 0; i < 4; i++) {
        const x = rh * 0.6 + i * sn * 0.24;
        d.push(tri(f, [[x, -rh * 0.72], [x + sn * 0.12, -rh * 0.72], [x + sn * 0.06, -rh * 0.48]], { paint: "bone", front: true }));
      }
      reach += sn;
    }
    if (F.horns === "tusks") d.push(tri(f, [[rh * 0.5, -rh * 0.7], [rh * 0.8, -rh * 0.6], [rh * 1.5, rh * 0.1]], { paint: "bone" }));
    const hs = b.seg(id, [pos[0], Math.max(pos[1], rh * 1.05)], 1, cols, d);
    for (const c of hs.colliders) if (F.horns === "long" || F.horns === "short" || F.horns === "antlers" || F.horns === "tusks") c.dtype = "pierce";
    b.joint(`${id}j`, parent, id, jointAt, [-0.7, 0.7], "neck", 1.3);
    heads.push(id);
    extra[id] = reach;
  };

  /** Neck chain from base toward angle, then a head at the tip. */
  const neckAndHead = (i: number, parent: string, base: [number, number], ang: number, len: number) => {
    const id = i === 0 ? "head" : `head${i}`;
    if (len < 0.06 * S) {
      makeHead(id, at(base, ang, rh * 0.85), parent, base);
      return;
    }
    const n = clamp(Math.round(len / (0.12 * S)), 1, 4);
    const r = Math.max(0.018 * S, rh * 0.45);
    const c = b.chain(`n${i}_`, parent, base, ang, len, n, r, r * 0.8, 1, "neck", [-0.6, 0.6]);
    necks.push(c.ids);
    makeHead(id, at(c.tip, c.ang, rh * 0.8), c.ids[c.ids.length - 1], c.tip);
  };

  const addFoot = (id: string, low: [number, number], r: number) => {
    const sg = b.get(id);
    const off: [number, number] = [low[0] - sg.pos[0], low[1] - sg.pos[1]];
    const fr = g.foot === "stump" ? r * 1.25 : r;
    const c = col({ shape: g.foot === "hoof" ? { kind: "box", hx: r * 1.1, hy: r * 0.7 } : { kind: "ball", r: fr }, offset: [off[0] + (g.foot === "foot" ? f * r * 0.8 : 0), fr - sg.pos[1] + 0.001], foot: true, sharp: g.foot === "claw" ? 1.5 : 1, paint: g.foot === "hoof" ? "dark" : "body" });
    if (g.foot === "claw") c.dtype = "slash";
    sg.colliders.push(c);
    if (g.foot === "claw") for (const dx of [0.4, 1.0]) sg.deco!.push(tri(f, [[off[0] * f + r * dx, r * 0.1 - sg.pos[1]], [off[0] * f + r * (dx + 0.5), r * 0.1 - sg.pos[1]], [off[0] * f + r * (dx + 0.9), -sg.pos[1]]], { paint: "bone" }));
  };

  const addHand = (id: string, end: [number, number], r: number, weapon: boolean) => {
    const sg = b.get(id);
    const off: [number, number] = [end[0] - sg.pos[0], end[1] - sg.pos[1]];
    const h = g.hand;
    if (h === "blade") {
      const L = armLen * 0.9;
      sg.colliders.push(col({ shape: { kind: "capsule", hh: L / 2, r: r * 0.35 }, offset: [off[0] + f * L / 2, off[1]], rot: Math.PI / 2, sharp: 2.2, densityMul: 1.5, paint: "bone", dtype: "slash" }));
      weaponLen = Math.max(weaponLen, L);
    } else if (h === "hammer") {
      sg.colliders.push(col({ shape: { kind: "box", hx: r * 1.8, hy: r * 1.4 }, offset: off, sharp: 1.6, densityMul: 3, paint: "dark", dtype: "blunt" }));
    } else if (h === "pincer") {
      sg.colliders.push(col({ shape: { kind: "ball", r: r * 1.5 }, offset: off, sharp: 1.6, dtype: "pierce", paint: "accent" }));
      sg.deco!.push(tri(f, [[off[0] * f, off[1] + r], [off[0] * f + r * 2.6, off[1] + r * 0.4], [off[0] * f + r * 0.4, off[1] + r * 0.1]], { paint: "accent" }));
      sg.deco!.push(tri(f, [[off[0] * f, off[1] - r], [off[0] * f + r * 2.6, off[1] - r * 0.4], [off[0] * f + r * 0.4, off[1] - r * 0.1]], { paint: "accent" }));
    } else {
      const c = col({ shape: { kind: "ball", r: r * 1.25 }, offset: off, sharp: h === "claw" ? 1.6 : 1 });
      if (h === "claw") {
        c.dtype = "slash";
        for (const dy of [-0.6, 0, 0.6]) sg.deco!.push(tri(f, [[off[0] * f + r, off[1] + r * dy], [off[0] * f + r, off[1] + r * (dy - 0.35)], [off[0] * f + r * 2.3, off[1] + r * (dy - 0.5)]], { paint: "bone" }));
      }
      sg.colliders.push(c);
    }
    if (weapon && s.weapon !== "none") {
      const w = WEAPONS[s.weapon];
      const len = w.len * clamp(S / 1.78, 0.6, 1.4);
      weaponLen = Math.max(weaponLen, len);
      sg.colliders.push(col({ shape: { kind: "capsule", hh: len / 2, r: w.r }, offset: [off[0] + f * len / 2, off[1]], rot: Math.PI / 2, densityMul: w.density, sharp: w.sharp, paint: w.paint, dtype: w.dtype }));
    }
    parts.arm.push(id);
    extra[id] = armLen + weaponLen;
  };

  /** Arms hanging from a shoulder: upper + forearm (or one piece in crowds). */
  const addArm = (k: number, shoulder: [number, number], layer: 0 | 2, weapon: boolean, parent = "torso") => {
    const r = 0.042 * S * Math.sqrt(g.bulk) * (nArms > 2 ? 0.85 : 1);
    // Arms hang down, or reach forward when the body is too low for them to hang.
    const ang = safeAngle(shoulder, fwd(f, -Math.PI / 2 + 0.05), armLen, r * 2);
    const elbow = at(shoulder, ang, armLen / 2);
    const hand = at(shoulder, ang, armLen);
    b.limb(`ua${k}`, shoulder, elbow, r, layer);
    b.limb(`fa${k}`, elbow, hand, r * 0.9, layer);
    b.joint(`sh${k}`, parent, `ua${k}`, shoulder, lim(f, -1.2, 3.0), "shoulder");
    b.joint(`el${k}`, `ua${k}`, `fa${k}`, elbow, lim(f, -0.05, 2.4), "elbow");
    arms.push({ shoulder: `sh${k}`, elbow: `el${k}` });
    addHand(`fa${k}`, hand, r, weapon);
  };

  /** A leg from hip to the ground, straight or splayed like a spider. */
  const addLeg = (k: number, hip: [number, number], layer: 0 | 2, phase: number, splay: number, rl: number) => {
    const H = hip[1];
    const foot: [number, number] = [hip[0] + f * splay * 0.55 * H, rl];
    if (oneSegLegs) {
      b.limb(`lg${k}`, hip, foot, rl, layer, { paint: "dark", sharp: 0.8 });
      b.joint(`hp${k}`, "torso", `lg${k}`, hip, [-1.2, 1.2], "hip", 1.2);
      legs.push({ hip: `hp${k}`, phase });
      addFoot(`lg${k}`, foot, rl);
      return `lg${k}`;
    }
    const knee: [number, number] = splay ? [hip[0] + f * splay * 0.3 * H, H + 0.3 * H] : [hip[0], H * 0.52];
    b.limb(`th${k}`, hip, knee, rl, layer, { paint: "dark" });
    b.limb(`sn${k}`, knee, foot, rl * 0.85, layer, { paint: "dark", sharp: 0.8 });
    b.joint(`hp${k}`, "torso", `th${k}`, hip, [-1.2, 1.2], "hip", 1.2);
    b.joint(`kn${k}`, `th${k}`, `sn${k}`, knee, splay ? [-1.2, 1.2] : lim(f, -2.2, 0.1), "knee");
    legs.push({ hip: `hp${k}`, knee: `kn${k}`, phase });
    addFoot(`sn${k}`, foot, rl * 0.85);
    return `sn${k}`;
  };

  /** Tail chain; the tip carries a club, stinger or fin. */
  const addTail = (base: [number, number], ang: number, parent: string) => {
    if (g.tail === "none") return;
    const L = 0.35 * S * g.tailLen;
    const r = { thin: 0.02, thick: 0.05, bushy: 0.065, club: 0.035, stinger: 0.03, fin: 0.035, none: 0 }[g.tail] * S;
    const c = b.chain("tl", parent, base, safeAngle(base, ang, L, r * 2 + 0.07 * S), L, g.tailLen > 1.2 ? 3 : 2, r, g.tail === "bushy" ? r * 1.1 : r * 0.6, 1, "tail", [-1.1, 1.1], 0, { densityMul: 0.5 });
    tails.push(...c.ids);
    const tip = b.get(c.ids[c.ids.length - 1]);
    const off: [number, number] = [c.tip[0] - tip.pos[0], c.tip[1] - tip.pos[1]];
    if (g.tail === "club") tip.colliders.push(col({ shape: { kind: "ball", r: 0.07 * S }, offset: off, densityMul: 3, sharp: 1.6, paint: "bone", dtype: "blunt" }));
    if (g.tail === "stinger") {
      tip.colliders.push(col({ shape: { kind: "ball", r: 0.03 * S }, offset: off, sharp: 2, dtype: "pierce", paint: "dark" }));
      tip.deco!.push(deco({ kind: "tri", pts: [[off[0] - 0.03 * S, off[1]], [off[0] + 0.03 * S, off[1]], [off[0] + f * 0.02 * S, off[1] + 0.12 * S]] }, [0, 0], { paint: "dark" }));
    }
    if (g.tail === "fin") tip.deco!.push(deco({ kind: "tri", pts: [[off[0], off[1]], [off[0] - f * 0.2 * S, off[1] + 0.2 * S], [off[0] - f * 0.2 * S, off[1] - 0.16 * S]] }, [0, 0], { paint: "accent" }));
    parts.tail.push(tip.id);
    extra[tip.id] = L * 0.5;
  };

  const addWings = (base: [number, number]) => {
    if (g.wings === "none") return;
    const W = 0.45 * S * g.wingSize;
    for (const [k, layer] of [[0, 0], [1, 2]] as const) {
      const ang = bwd(f, 0.9 + k * 0.15);
      const tip = at(base, ang, W);
      const id = `wg${k}`;
      b.limb(id, base, tip, 0.02 * S, layer, { densityMul: 0.3, paint: g.wings === "feather" ? "accent" : "dark" });
      const sg = b.get(id);
      const o = (p: [number, number]) => [p[0] - sg.pos[0], p[1] - sg.pos[1]] as [number, number];
      const low = at(base, ang - (f > 0 ? -1 : 1) * 0.9, W * 0.75);
      sg.deco!.push(deco({ kind: "tri", pts: [o(base), o(tip), o(low)] }, [0, 0], { paint: g.wings === "feather" ? "accent" : "membrane" }));
      b.joint(id, "torso", id, base, [-1.4, 1.4], "wing");
      wings.push(id);
    }
  };

  const addTentacles = (from: (i: number) => [number, number], parent: string, down: boolean) => {
    for (let i = 0; i < nTent; i++) {
      const base = from(i);
      const ang = safeAngle(base, down ? -Math.PI / 2 + (i - (nTent - 1) / 2) * 0.18 : fwd(f, -0.4 - i * 0.15), 0.4 * S, 0.05 * S);
      const c = b.chain(`tn${i}_`, parent, base, ang, 0.4 * S, cheap ? 2 : 3, 0.03 * S, 0.012 * S, i % 2 ? 2 : 0, "tentacle", [-1.2, 1.2], 0, { densityMul: 0.4, paint: "accent" });
      tentacles.push(c.ids);
      parts.tentacle.push(c.ids[c.ids.length - 1]);
      extra[c.ids[c.ids.length - 1]] = 0.3 * S;
    }
  };

  const backDeco = (hl: number, r: number, topY: number): DecoBP[] => {
    const out: DecoBP[] = [];
    if (g.back === "spikes" || g.back === "plates") {
      const n = g.back === "plates" ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const x = -hl * 0.8 + (i * hl * 1.6) / (n - 1), w = hl * (g.back === "plates" ? 0.22 : 0.12), h = r * (g.back === "plates" ? 0.9 : 0.6);
        out.push(tri(f, [[x - w, topY * 0.9], [x + w, topY * 0.9], [x, topY + h]], { paint: "accent" }));
      }
    }
    if (g.back === "shell") out.push(deco({ kind: "ball", r: Math.max(hl, r) * 1.05 }, [0, topY * 0.3], { paint: "shell" }));
    if (g.back === "hump") out.push(deco({ kind: "ball", r: r * 0.8 }, [0, topY * 0.8]));
    if (g.back === "fin" || F.dorsalFin) out.push(tri(f, [[-hl * 0.3, topY * 0.85], [hl * 0.25, topY * 0.85], [-hl * 0.25, topY + r * 1.1]], { paint: "body" }));
    return out;
  };

  let torsoY = 0;
  let halfLen = 0;

  // ---------- frames ----------

  if (g.frame === "upright") {
    const hipY = nLegs ? clamp(0.47 * g.legLen, 0.18, 0.62) * S : 0.3 * S;
    const neckL = g.neckLen >= 1.6 ? 0.1 * S * g.neckLen : 0.04 * S * g.neckLen;
    const tH = Math.max(0.15 * S, S - hipY - neckL - 2 * rh);
    const rt = 0.11 * S * g.bulk;
    torsoY = hipY + tH / 2;
    halfLen = rt;
    const shY = hipY + tH - 0.02 * S;
    const td: DecoBP[] = [...pattern(F, tH / 2, rt, true), ...backDeco(tH / 2, rt, rt).map((d) => ({ ...d, rot: d.rot }))];
    if (F.belly) td.push(deco({ kind: "capsule", hh: tH * 0.25, r: rt * 0.6 }, [f * rt * 0.3, -tH * 0.05], { paint: "belly", front: true }));
    if (F.cape) td.push(tri(f, [[-rt * 0.3, tH * 0.45], [-rt * 1.1, tH * 0.45], [-rt * 2.3, -tH * 1.1]], { paint: "cape" }));
    if (nHeads === 0) td.push(...faceDeco(F, f, rt * 0.8).map((d) => ({ ...d, offset: [d.offset[0], d.offset[1] + tH * 0.25] as [number, number] })));
    b.seg("torso", [0, torsoY], 1, [col({ shape: { kind: "capsule", hh: Math.max(0.01, tH / 2 - rt * 0.5), r: rt }, paint: "accent", sharp: 0.6, foot: nLegs === 0 })], td);
    const rl = 0.055 * S * Math.sqrt(g.bulk) * g.legThick * (nLegs > 4 ? 0.7 : 1);
    for (let i = 0; i < nLegs; i++) {
      const p = Math.floor(i / 2), sd = i % 2, pairs = nLegs / 2;
      const x = f * (pairs === 1 ? (sd ? 0.02 : -0.02) * S : rt * 0.7 - (rt * 1.4 * p) / (pairs - 1));
      const low = addLeg(i, [x, hipY], sd ? 2 : 0, ((p + sd) % 2) * 0.5, 0, rl);
      if (p === 0 && sd === 1) parts.leg.push(low);
    }
    for (let k = 0; k < nArms; k++) addArm(k, [0, shY - Math.floor(k / 2) * 0.13 * S], k % 2 ? 2 : 0, k === 1 || nArms === 1);
    for (let i = 0; i < nHeads; i++) {
      const x = nHeads === 1 ? 0 : f * (-rt * 0.7 + (rt * 1.4 * i) / (nHeads - 1));
      neckAndHead(i, "torso", [x, hipY + tH], Math.PI / 2 - f * (nHeads === 1 ? 0 : ((i - (nHeads - 1) / 2) * 0.45)), neckL);
    }
    addTail([-f * rt * 0.8, hipY + 0.05 * S], bwd(f, -0.6), "torso");
    addWings([-f * rt * 0.5, shY - 0.04 * S]);
    addTentacles((i) => [f * (-rt * 0.6 + (rt * 1.2 * i) / Math.max(1, nTent - 1)), hipY - 0.02 * S], "torso", true);
  } else if (g.frame === "horizontal" || g.frame === "wheeled") {
    const wheeled = g.frame === "wheeled";
    const bh = 0.3 * S * g.bodyLen;
    const rt = (wheeled ? 0.13 : 0.12) * S * g.bulk;
    const legH = wheeled ? 0.22 * S : nLegs ? 0.3 * S * g.legLen : 0;
    torsoY = wheeled ? legH + rt : nLegs ? legH + rt * 0.5 : rt * 1.02;
    halfLen = bh + rt * 0.3;
    const td = [...pattern(F, bh, rt), ...backDeco(bh, rt, rt)];
    if (nHeads === 0) td.push(...faceDeco(F, f, rt * 0.7, true).map((d) => ({ ...d, offset: [d.offset[0] + f * bh * 0.6, d.offset[1]] as [number, number] })));
    const torsoCol = wheeled
      ? col({ shape: { kind: "box", hx: bh, hy: rt }, sharp: 0.8, paint: "body" })
      : col({ shape: { kind: "capsule", hh: Math.max(0.01, bh - rt * 0.3), r: rt }, rot: Math.PI / 2, sharp: 0.6, foot: nLegs === 0 });
    b.seg("torso", [0, torsoY], 1, [torsoCol], td);
    if (wheeled) {
      const wr = 0.11 * S;
      const xs = g.bodyLen > 1.3 ? [-0.7, 0, 0.7] : [-0.65, 0.65];
      xs.forEach((x, i) => {
        const id = `wh${i}`;
        b.seg(id, [x * bh, wr], 2, [col({ shape: { kind: "ball", r: wr }, paint: "dark", foot: true })], [deco({ kind: "ball", r: wr * 0.4 }, [0, 0], { paint: "metal", front: true })]);
        b.joint(id, "torso", id, [x * bh, wr], null, "wheel");
      });
      parts.body.push("torso");
    }
    const splay = loco === "crawl" || nLegs > 4 ? 1 : 0;
    const pairs = nLegs / 2;
    const rl = 0.045 * S * Math.sqrt(g.bulk) * g.legThick * (nLegs > 4 ? 0.55 : 1);
    for (let p = 0; p < pairs; p++) {
      const x = f * (pairs === 1 ? 0 : bh * 0.85 - (bh * 1.7 * p) / (pairs - 1));
      const front = pairs === 1 ? 1 : p < pairs / 2 ? 1 : -1;
      for (const sd of [0, 1]) {
        const phase = pairs <= 2 ? ((p + sd) % 2) * 0.5 : (p / pairs + sd * 0.5) % 1;
        const low = addLeg(p * 2 + sd, [x + f * sd * rl * 0.4, torsoY], sd ? 2 : 0, phase, splay * front, rl);
        if (p === 0 && sd === 1) parts.leg.push(low);
      }
    }
    for (let k = 0; k < nArms; k++) addArm(k, [f * bh * (0.75 - Math.floor(k / 2) * 0.2), torsoY + rt * 0.6], k % 2 ? 2 : 0, k === 1 || nArms === 1);
    const longNeck = g.neckLen >= 1.4;
    for (let i = 0; i < nHeads; i++) {
      const t = (longNeck ? 1.1 : 0.55) + (i - (nHeads - 1) / 2) * 0.35;
      const base: [number, number] = [f * (bh + rt * 0.1), torsoY + rt * 0.35];
      neckAndHead(i, "torso", base, fwd(f, t), longNeck ? 0.13 * S * g.neckLen : nHeads > 1 ? (0.16 + 0.05 * i) * S : 0.05 * S * g.neckLen);
    }
    addTail([-f * (bh + rt * 0.1), torsoY + rt * 0.3], bwd(f, 0.35), "torso");
    addWings([f * bh * 0.1, torsoY + rt * 0.8]);
    addTentacles((i) => [f * (bh * 0.6 - i * 0.05 * S), torsoY - rt * 0.8], "torso", true);
  } else if (g.frame === "long") {
    const n = cheap ? 5 : clamp(Math.round(4 + g.bodyLen * 3), 5, 9);
    const seg = S / n;
    const r = 0.065 * S * g.bulk;
    const legH = nLegs ? 0.13 * S * g.legLen : 0;
    const y = nLegs ? legH + r * 0.5 : r * 1.05;
    torsoY = y;
    halfLen = S / 2;
    const mid = Math.floor(n / 2);
    const ids: string[] = [];
    for (let i = 1; i < n; i++) {
      const id = i === mid ? "torso" : `b${i}`;
      const rr = r * (1 - (i / n) * 0.55);
      const d: DecoBP[] = [];
      if (F.pattern === "stripes" && i % 2 === 0) d.push(deco({ kind: "box", hx: seg * 0.12, hy: rr * 0.95 }, [0, 0], { paint: "accent", front: true }));
      if (F.pattern === "spots") d.push(deco({ kind: "ball", r: rr * 0.35 }, [0, rr * 0.2], { paint: "accent", front: true }));
      if (i === mid) d.push(...backDeco(seg * 1.5, rr, rr));
      if ((g.back === "spikes" || g.back === "plates") && i !== mid) d.push(tri(f, [[-seg * 0.3, rr * 0.8], [seg * 0.3, rr * 0.8], [0, rr * 1.5]], { paint: "accent" }));
      b.seg(id, [f * (S / 2 - seg * (i + 0.5)), y], 1, [col({ shape: { kind: "capsule", hh: seg / 2, r: rr }, rot: Math.PI / 2, foot: nLegs === 0, sharp: 0.5 })], d);
      ids.push(id);
    }
    for (let i = 1; i < ids.length; i++) {
      const jid = b.joint(`sp${i}`, ids[i - 1], ids[i], [f * (S / 2 - seg * (i + 1)), y], [-0.8, 0.8], "spine");
      wave.push(jid);
    }
    // Heads sprout from the front segment.
    for (let i = 0; i < Math.max(1, nHeads); i++) {
      if (nHeads === 0) break;
      const base: [number, number] = [f * (S / 2 - seg), y];
      const t = nHeads === 1 ? 0.15 : 0.2 + i * 0.35;
      neckAndHead(i, ids[0], base, fwd(f, t), nHeads === 1 && g.neckLen < 1.4 ? 0 : 0.12 * S * g.neckLen);
    }
    if (nHeads === 0) b.get(ids[0]).deco!.push(...faceDeco(F, f, r, true));
    else if (heads[0]) wave.unshift(`${heads[0]}j`);
    const pairs = nLegs / 2;
    const rl = 0.03 * S * g.legThick;
    for (let p = 0; p < pairs; p++) {
      const si = 1 + Math.floor((p * (ids.length - 1)) / Math.max(1, pairs));
      const x = b.get(ids[Math.min(ids.length - 1, si - 1)]).pos[0];
      for (const sd of [0, 1]) {
        const k = p * 2 + sd, hip: [number, number] = [x, y];
        const foot: [number, number] = [x + f * (sd ? 0.25 : -0.1) * legH, rl];
        b.limb(`lg${k}`, hip, foot, rl, sd ? 2 : 0, { paint: "dark", sharp: 0.8 });
        b.joint(`hp${k}`, ids[Math.min(ids.length - 1, si - 1)], `lg${k}`, hip, [-1.0, 1.0], "hip");
        legs.push({ hip: `hp${k}`, phase: (p / Math.max(1, pairs) + sd * 0.5) % 1 });
        addFoot(`lg${k}`, foot, rl);
        if (p === 0 && sd === 1) parts.leg.push(`lg${k}`);
      }
    }
    for (let k = 0; k < nArms; k++) addArm(k, [b.get(ids[0]).pos[0], y + r * 0.4], k % 2 ? 2 : 0, k === 1 || nArms === 1, ids[0]);
    const last = b.get(ids[ids.length - 1]);
    if (g.tail !== "none") addTail([f * (-S / 2 + seg * 0.2), y], bwd(f, g.tail === "stinger" ? 1.2 : 0.1), last.id);
    addWings([b.get("torso").pos[0], y + r * 0.8]);
    addTentacles((i) => [b.get(ids[0]).pos[0] + f * i * 0.02 * S, y - r * 0.6], ids[0], true);
  } else {
    // round: a ball body. Spiders, blobs, jellyfish, beholders.
    const R = 0.42 * S * Math.sqrt(g.bulk);
    const legH = nLegs ? 0.35 * S * g.legLen : 0;
    const tentL = nTent ? 0.4 * S : 0;
    torsoY = nLegs ? legH + R * 0.5 : Math.max(R, tentL + R * 0.3);
    halfLen = R;
    const td: DecoBP[] = [...pattern(F, R * 0.7, R * 0.6)];
    // One head on a ball body is the ball itself (a kraken, a beholder, a slime face).
    const faceOnBody = nHeads <= 1;
    if (faceOnBody) td.push(...faceDeco(F, f, R * 0.55, false).map((d) => ({ ...d, offset: [d.offset[0] + f * R * 0.3, d.offset[1] + R * 0.15] as [number, number] })));
    td.push(deco({ kind: "ball", r: R * 0.14 }, [-f * R * 0.4, R * 0.55], { paint: "shine", front: true }));
    td.push(...backDeco(R * 0.8, R * 0.5, R));
    b.seg("torso", [0, torsoY], 1, [col({ shape: { kind: "ball", r: R }, foot: nLegs === 0 && nTent === 0, sharp: 0.9 })], td);
    const pairs = nLegs / 2;
    const rl = 0.03 * S * g.legThick;
    for (let p = 0; p < pairs; p++) {
      const x = f * (pairs === 1 ? 0 : R * 0.6 - (R * 1.2 * p) / (pairs - 1));
      for (const sd of [0, 1]) {
        const low = addLeg(p * 2 + sd, [x, torsoY - R * 0.4], sd ? 2 : 0, (p / Math.max(1, pairs) + sd * 0.5) % 1, pairs === 1 ? 0 : p < pairs / 2 ? 1 : -1, rl);
        if (p === 0 && sd === 1) parts.leg.push(low);
      }
    }
    for (let k = 0; k < nArms; k++) addArm(k, [f * R * 0.7, torsoY + R * 0.1 - Math.floor(k / 2) * 0.1 * S], k % 2 ? 2 : 0, k === 1 || nArms === 1);
    if (faceOnBody && nHeads === 1) { parts.head = ["torso"]; extra.torso = R; }
    else for (let i = 0; i < nHeads; i++) neckAndHead(i, "torso", [f * (R * 0.2 + i * 0.1 * R), torsoY + R * 0.9], Math.PI / 2 - f * (0.3 + i * 0.3), 0.08 * S * g.neckLen);
    addTail([-f * R, torsoY], bwd(f, 0.2), "torso");
    addWings([0, torsoY + R * 0.7]);
    addTentacles((i) => [f * (-R * 0.7 + (R * 1.4 * i) / Math.max(1, nTent - 1)), torsoY - R * 0.8], "torso", true);
  }

  // ---------- summary ----------
  if (!(g.frame === "round" && nHeads === 1)) parts.head = heads;
  if (loco === "roll" || g.frame === "round") parts.body = ["torso"];
  const torsoPos = b.get("torso").pos;
  const reachOf = (id: string) => {
    if (id === "torso") return halfLen + 0.12 * S;
    const sg = b.get(id);
    return Math.abs(sg.pos[0] - torsoPos[0]) + (extra[id] ?? 0.1 * S);
  };
  const moves = movesFor(g, parts, reachOf);
  const xs = b.segs.map((q) => q.pos[0]);
  return {
    segments: b.segs, joints: b.joints, torso: "torso", head: heads[0] ?? "torso", heads,
    standY: torsoY, halfWidth: Math.max(halfLen, (Math.max(...xs) - Math.min(...xs)) / 2),
    reach: Math.max(...moves.map((m) => m.reach)), legs, arms, necks, wings, tails, tentacles, wave, moves,
    mouth: heads[0] ?? (parts.arm[0] || "torso"), loco, genome: g,
  };
}
