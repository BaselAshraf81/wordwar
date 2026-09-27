// The battle: specs in, physics out. The winner is whoever is still standing.
import RAPIER, { type Collider, type RevoluteImpulseJoint, type RigidBody, type World } from "@dimforge/rapier2d-deterministic-compat";
import { buildBlueprint, CHEAP_ABOVE, shapeArea, type ArtLayout, type Blueprint, type ColliderBP, type DecoBP, type JointRole, type SegmentBP } from "./plans";
import { Rng } from "./rng";
import type { UnitSpec } from "./spec";

export const DT = 1 / 60;
const G = 9.81;
const DAMAGE = 0.2;

/** Change a whole unit's velocity by (dvx, dvy): every body gets its share, so many-bone bodies move as one instead of the torso being flung. */
function push(u: { bodies: Map<string, RigidBody> }, dvx: number, dvy: number): void {
  for (const body of u.bodies.values()) body.applyImpulse({ x: body.mass() * dvx, y: body.mass() * dvy }, true);
}
const TIME_LIMIT = 75;

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

// Collision groups: bit0 ground, bit1 team 0, bit2 team 1. Allies pass through each other,
// which also removes every self-collision inside a body.
const groups = (membership: number, filter: number) => (membership << 16) | filter;
const GROUND = groups(0b001, 0b110);
const TEAM = [groups(0b010, 0b101), groups(0b100, 0b011)];

const STIFF: Record<JointRole, number> = { hip: 140, knee: 140, shoulder: 90, elbow: 90, neck: 110, tail: 15, wing: 80, wheel: 0, spine: 70 };
const TORQUE: Record<JointRole, number> = { hip: 0.7, knee: 0.55, shoulder: 0.3, elbow: 0.22, neck: 0.18, tail: 0.02, wing: 0.08, wheel: 0, spine: 0.3 };

export interface DrawCollider {
  collider: Collider;
  unit: Unit;
  bp: ColliderBP;
  layer: number;
  eye: boolean;
  hidden: boolean;
}

/** One cut-out piece of emoji art pinned to a body. offset: art origin relative to the body at spawn. */
export interface DrawArt {
  body: RigidBody;
  unit: Unit;
  label: 1 | 2 | 3;
  offset: [number, number];
  layout: ArtLayout;
}

export interface DrawDeco {
  body: RigidBody;
  unit: Unit;
  d: DecoBP;
  layer: number;
}

export interface Unit {
  id: number;
  team: 0 | 1;
  spec: UnitSpec;
  bp: Blueprint;
  bodies: Map<string, RigidBody>;
  joints: Map<string, { j: RevoluteImpulseJoint; role: JointRole; torque: number }>;
  torso: RigidBody;
  feet: Collider[];
  mass: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  facing: 1 | -1;
  phase: number;
  target: Unit | null;
  retargetIn: number;
  cooldown: number;
  strikeT: number;
  struck: Set<number>;
  stunUntil: number;
  fleeing: boolean;
  bravery: number;
  kills: number;
  diedAt: number;
  strikes: number;
  hits: number;
  dealt: number;
  nextHop: number;
  /** Torso angle the animation wants (a T-rex lunging forward), radians. */
  leanTarget: number;
  hover: { x: number; y: number }; // flyers' personal station around the target
}

interface Owner {
  unit: Unit;
  bp: ColliderBP;
}

export interface BattleResult {
  winner: 0 | 1 | null;
  time: number;
  alive: [number, number];
}

/** World y of the lowest point of a ball or capsule collider. */
function lowestPoint(c: Collider): number {
  const y = c.translation().y;
  const r = c.radius();
  if (c.shape.type === RAPIER.ShapeType.Capsule) return y - Math.abs(Math.cos(c.rotation())) * c.halfHeight() - r;
  return y - r;
}

const strikeSpeed = (s: UnitSpec) => 7 * Math.sqrt(s.strength) * s.speed ** 0.3;

const STRIKE_LEN = 22;
const STRIKE_AT = 13; // impulse fires here; hits count from here down to 1

export class Battle {
  readonly world: World;
  readonly units: Unit[] = [];
  readonly draw: DrawCollider[] = [];
  readonly decor: DrawDeco[] = [];
  readonly art: DrawArt[] = [];
  readonly arenaHalf: number;
  readonly rng: Rng;
  time = 0;
  steps = 0;
  result: BattleResult | null = null;
  private owners = new Map<number, Owner>();
  private unitId = 0;

  constructor(
    readonly specs: [UnitSpec, UnitSpec],
    readonly seed: number,
    private readonly opts: { idle?: boolean } = {},
  ) {
    this.rng = new Rng(seed);
    this.world = new RAPIER.World({ x: 0, y: -G });
    this.world.timestep = DT;
    const biggest = Math.max(specs[0].size, specs[1].size);
    this.arenaHalf = 26 + biggest * 4;

    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(this.arenaHalf + 20, 1).setTranslation(0, -1).setFriction(1).setCollisionGroups(GROUND), ground);
    for (const s of [-1, 1]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 30).setTranslation(s * (this.arenaHalf + 0.5), 30).setCollisionGroups(GROUND), ground);
    }

    const gap = 3 + biggest * 1.5;
    specs.forEach((spec, team) => {
      const side = team === 0 ? -1 : 1;
      const spread = Math.min(10, 0.25 * spec.count * Math.max(0.4, spec.size));
      for (let i = 0; i < spec.count; i++) {
        const x = side * (gap + this.rng.next() * spread);
        this.spawn(spec, team as 0 | 1, x);
      }
    });
  }

  private spawn(base: UnitSpec, team: 0 | 1, x: number): void {
    const r = this.rng;
    // Per-body variation: "100 men" is 100 slightly different men.
    const spec: UnitSpec = {
      ...base,
      size: r.jitter(base.size, 0.08),
      weight: r.jitter(base.weight, 0.15),
      strength: r.jitter(base.strength, 0.15),
      toughness: r.jitter(base.toughness, 0.15),
      speed: r.jitter(base.speed, 0.15),
    };
    const facing: 1 | -1 = team === 0 ? 1 : -1;
    const bp = buildBlueprint(spec, facing, base.count);

    let area = 0;
    for (const seg of bp.segments) for (const c of seg.colliders) area += shapeArea(c.shape) * c.densityMul;
    const density = spec.weight / area;

    const unit: Unit = {
      id: this.unitId++,
      team,
      spec,
      bp,
      bodies: new Map(),
      joints: new Map(),
      torso: null as unknown as RigidBody,
      feet: [],
      mass: spec.weight,
      health: spec.toughness,
      maxHealth: spec.toughness,
      alive: true,
      facing,
      phase: r.next(),
      target: null,
      retargetIn: 0,
      cooldown: Math.floor(r.range(10, 50)),
      strikeT: 0,
      struck: new Set(),
      stunUntil: 0,
      fleeing: false,
      bravery: base.bravery >= 1 ? 1 : r.jitter(base.bravery, 0.35),
      kills: 0,
      diedAt: -1,
      strikes: 0,
      hits: 0,
      dealt: 0,
      hover: { x: r.range(0.2, 1.6), y: r.range(-0.3, 1.4) },
      nextHop: r.range(0, 0.6),
      leanTarget: 0,
    };

    const bodyOf = (seg: SegmentBP) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x + seg.pos[0], seg.pos[1] + 0.01)
          .setLinearDamping(0.05)
          .setAngularDamping(0.6),
      );
      for (const c of seg.colliders) {
        const sh = c.shape;
        const desc =
          sh.kind === "ball" ? RAPIER.ColliderDesc.ball(sh.r) : sh.kind === "capsule" ? RAPIER.ColliderDesc.capsule(sh.hh, sh.r) : RAPIER.ColliderDesc.cuboid(sh.hx, sh.hy);
        desc
          .setTranslation(c.offset[0], c.offset[1])
          .setRotation(c.rot)
          .setDensity(density * c.densityMul)
          .setFriction(c.foot ? 1.4 : 0.6)
          .setCollisionGroups(TEAM[team]);
        const collider = this.world.createCollider(desc, body);
        this.owners.set(collider.handle, { unit, bp: c });
        if (c.foot) unit.feet.push(collider);
        const hasEyeDeco = seg.deco?.some((d) => d.paint === "eye") ?? false;
        const isWeapon = c.paint === "metal" || (c.striker && c.densityMul > 1);
        const hidden = !!bp.art && !isWeapon && !(bp.art.showLegs && seg.id.startsWith("leg"));
        this.draw.push({ collider, unit, bp: c, layer: seg.layer, hidden, eye: !bp.art && !hasEyeDeco && seg.id === bp.head && c === seg.colliders[0] && c.shape.kind === "ball" });
      }
      for (const d of seg.deco ?? []) this.decor.push({ body, unit, d, layer: seg.layer });
      if (bp.art) bp.art.piece.forEach((sid, i) => {
        if (sid === seg.id && bp.art!.rig.pieces[i]) this.art.push({ body, unit, label: (i + 1) as 1 | 2 | 3, offset: [-seg.pos[0], -seg.pos[1] - 0.01], layout: bp.art! });
      });
      return body;
    };

    for (const seg of bp.segments) unit.bodies.set(seg.id, bodyOf(seg));
    unit.torso = unit.bodies.get(bp.torso)!;
    if (bp.torso === "torso" && spec.plan !== "wheeled") unit.torso.setAdditionalSolverIterations(2);

    const posOf = (id: string) => bp.segments.find((s) => s.id === id)!.pos;
    for (const jb of bp.joints) {
      const pa = posOf(jb.a), pb = posOf(jb.b);
      const data = RAPIER.JointData.revolute({ x: jb.at[0] - pa[0], y: jb.at[1] - pa[1] }, { x: jb.at[0] - pb[0], y: jb.at[1] - pb[1] });
      const j = this.world.createImpulseJoint(data, unit.bodies.get(jb.a)!, unit.bodies.get(jb.b)!, true) as RevoluteImpulseJoint;
      j.setContactsEnabled(false);
      if (jb.limits) j.setLimits(jb.limits[0], jb.limits[1]);
      j.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      const torque = jb.role === "wheel" ? spec.weight * 2 * spec.strength : TORQUE[jb.role] * (jb.torqueMul ?? 1) * spec.weight * G * spec.size * spec.strength;
      j.setMotorMaxForce(torque);
      if (jb.role !== "wheel") j.configureMotorPosition(0, STIFF[jb.role], 2 * Math.sqrt(STIFF[jb.role]) * 0.7);
      unit.joints.set(jb.id, { j, role: jb.role, torque });
    }
    this.units.push(unit);
  }

  aliveCount(team: 0 | 1): number {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.alive) n++;
    return n;
  }

  step(): void {
    if (this.result) return;
    this.time += DT;
    this.steps++;
    for (const u of this.units) if (u.alive) this.control(u);
    this.world.step();
    for (const u of this.units) if (u.alive && u.strikeT > 0 && u.strikeT <= STRIKE_AT) this.resolveHits(u);
    this.checkMorale();
    this.checkEnd();
  }

  private pickTarget(u: Unit): Unit | null {
    const p = u.torso.translation();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const o of this.units) {
      if (o.team === u.team || !o.alive) continue;
      const q = o.torso.translation();
      const d = Math.abs(q.x - p.x) + 0.5 * Math.abs(q.y - p.y) + this.rng.next() * 0.3;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private control(u: Unit): void {
    const s = u.spec;
    const torso = u.torso;
    const p = torso.translation();
    const v = torso.linvel();

    if (this.opts.idle) u.target = null;
    else if (--u.retargetIn <= 0 || !u.target || !u.target.alive) {
      u.target = this.pickTarget(u);
      u.retargetIn = 20 + Math.floor(this.rng.next() * 10);
    }
    if (u.cooldown > 0) u.cooldown--;

    const stun = Math.max(0, Math.min(1, this.time - u.stunUntil));
    const tgt = u.target;
    const tp = tgt ? tgt.torso.translation() : { x: p.x + u.facing, y: p.y };
    const dx = tp.x - p.x;
    let dir = dx >= 0 ? 1 : -1;
    if (u.fleeing) {
      dir = -dir;
      if (Math.abs(p.x) > this.arenaHalf - 1.5) u.fleeing = false; // cornered: fight
    }

    const flying = s.canFly && stun > 0.5;
    const reach = u.bp.reach + (tgt ? tgt.bp.halfWidth : 0);
    const close = tgt !== null && Math.abs(dx) < reach && !u.fleeing;
    const maxSpeed = 2.4 * s.speed * Math.sqrt(Math.max(0.3, s.size) / 1.7);

    let grounded = false;
    // Standing = a foot is on the floor, or touching anything (a rock, a pile of bodies).
    for (const c of u.feet) {
      if (lowestPoint(c) < 0.06 + s.size * 0.04) {
        grounded = true;
        break;
      }
      this.world.contactPairsWith(c, (other) => {
        if (grounded) return;
        this.world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) grounded = true;
        });
      });
      if (grounded) break;
    }

    if (flying && tgt) {
      // Circle at a personal station; dive in to peck when ready, back off while recovering.
      const diving = u.cooldown < 8 || u.strikeT > 0;
      const hy = tgt.bodies.get(tgt.bp.head)!.translation().y + (diving ? 0.1 : u.hover.y * s.size);
      const ex = dx - dir * (diving ? reach * 0.5 : u.hover.x * s.size + reach);
      const ay = G + Math.max(-8, Math.min(8, 6 * (hy - p.y) - 3 * v.y));
      const ax = Math.max(-10, Math.min(10, 4 * (u.fleeing ? dir * 5 : ex) - 2.5 * v.x)) * s.speed;
      torso.applyImpulse({ x: u.mass * ax * DT, y: u.mass * ay * DT }, true);
    } else if (grounded && (u.bp.legs.length > 0 || u.bp.model)) {
      // Height assist: holds the body up only while its feet are on something.
      const ay = G + 30 * (u.bp.standY - p.y) - 6 * v.y;
      const fy = Math.max(0, Math.min(2.2 * G, ay)) * stun;
      torso.applyImpulse({ x: 0, y: u.mass * fy * DT }, true);
    }

    // Upright controller on the torso.
    const ang = torso.rotation();
    const inertia = u.mass * s.size * s.size * 0.08;
    let tau = inertia * (-45 * (ang - u.leanTarget) - 9 * torso.angvel());
    const cap = u.mass * G * s.size * (s.plan === "wheeled" ? 0.2 : 0.7) * stun;
    tau = Math.max(-cap, Math.min(cap, tau));
    torso.applyTorqueImpulse(tau * DT, true);

    // Drive.
    const moving = (grounded || flying) && tgt !== null && (!close || u.fleeing);
    const mv = u.bp.move;
    if (mv === "flop" || mv === "hop") {
      // No legs: launch the whole body in hops. A beached shark flops toward you.
      if (moving && this.time >= u.nextHop && stun > 0.5) {
        const vy = Math.min(6, Math.sqrt(2 * G * (mv === "hop" ? 0.45 : 0.3) * Math.max(0.3, s.size)));
        const vx = dir * Math.min(maxSpeed * 1.3, 1.6 * s.speed * Math.sqrt(Math.max(0.3, s.size)));
        for (const body of u.bodies.values()) body.applyImpulse({ x: body.mass() * vx, y: body.mass() * vy }, true);
        u.nextHop = this.time + this.rng.range(0.55, 0.85) / Math.sqrt(s.speed);
      }
    } else if (mv === "slither") {
      if (moving && dir * v.x < maxSpeed * 0.8) {
        for (const body of u.bodies.values()) body.applyImpulse({ x: dir * body.mass() * 7 * s.speed * stun * DT, y: 0 }, true);
      }
    } else if (moving && !flying && dir * v.x < maxSpeed) {
      torso.applyImpulse({ x: dir * u.mass * 9 * s.speed * stun * DT, y: 0 }, true);
    }

    // Gait: a phase clock drives hip/knee servos; the physics makes the actual stride.
    const rate = moving || flying ? (1.7 * s.speed) / Math.sqrt(Math.max(0.3, s.size) / 1.7) : 0.4;
    u.phase += DT * rate;
    const amp = moving ? 0.65 : 0.08;
    for (const leg of u.bp.legs) {
      const a = 2 * Math.PI * (u.phase + leg.phase);
      this.servo(u, leg.hip, dir * amp * Math.sin(a));
      if (leg.knee) this.servo(u, leg.knee, -u.facing * (moving ? 0.9 : 0.1) * Math.max(0, Math.cos(a)));
    }
    if (s.plan === "bird") this.servo(u, "wing", u.facing * (flying ? 1.2 * Math.sin(2 * Math.PI * u.phase * 4) : -0.2));
    if (u.joints.has("tail")) this.servo(u, "tail", -u.facing * 0.4 * Math.sin(2 * Math.PI * u.phase));
    if (u.bp.wave) {
      // Undulation travels head to tail. Striking bodies keep the neck free for the bite.
      const wamp = moving ? (mv === "slither" ? 0.55 : 0.6) : 0.12;
      u.bp.wave.forEach((id, i) => {
        if (id === "neck" && u.strikeT > 0) return;
        this.servo(u, id, wamp * Math.sin(2 * Math.PI * u.phase * 1.5 - i * 1.1));
      });
    }
    if (u.bp.model) {
      // Artist animation: every joint chases the clip's angle at this phase. Physics adds the wobble.
      const md = u.bp.model.model;
      const clips = md.clips;
      // While striking, the artist's attack clip plays once over the strike; otherwise gait or idle loops.
      const atk = md.attacks.includes(s.attack === "kick" ? "kick" : s.attack === "charge" ? "headbutt" : "attack")
        ? (s.attack === "kick" ? "kick" : s.attack === "charge" ? "headbutt" : "attack")
        : md.attacks[0];
      const striking = u.strikeT > 0 && atk !== undefined;
      const clip = (striking ? clips[atk!] : moving ? (s.speed > 1.1 ? clips.run ?? clips.walk : clips.walk ?? clips.run) : clips.idle) ?? clips.walk!;
      const ph = striking ? (STRIKE_LEN - u.strikeT) / STRIKE_LEN : moving ? u.phase : u.phase * 0.3;
      const t = (((ph % 1) + 1) % 1) * clip.length;
      const i0 = Math.floor(t) % clip.length, i1 = striking ? Math.min(clip.length - 1, i0 + 1) : (i0 + 1) % clip.length, w = t - Math.floor(t);
      for (const g of md.groups) {
        if (!u.joints.has(g.id)) continue;
        this.servo(u, g.id, u.facing * ((clip[i0][g.id] ?? 0) * (1 - w) + (clip[i1][g.id] ?? 0) * w));
      }
      u.leanTarget = u.facing * ((clip[i0]._rootA ?? 0) * (1 - w) + (clip[i1]._rootA ?? 0) * w);
    }
    if (s.plan === "wheeled") {
      for (const w of ["wheelB", "wheelF"]) {
        const jj = u.joints.get(w);
        if (jj) jj.j.configureMotorVelocity(moving ? (-dir * maxSpeed) / (0.11 * s.size) : 0, 2);
      }
    }

    // Attacks.
    if (close && u.cooldown === 0 && u.strikeT === 0 && stun > 0.8 && this.hasSlot(tgt!, u)) {
      u.strikeT = STRIKE_LEN;
      u.struck.clear();
      u.strikes++;
    }
    this.pose(u, dir, tgt);
  }

  /**
   * Allies pass through each other in 2D, so without this a crowd would stack on one point and
   * all swing at once. A target can only be attacked by as many bodies as fit around it.
   */
  private hasSlot(tgt: Unit, u: Unit): boolean {
    const slots = Math.max(2, Math.round(2 + (tgt.spec.size / Math.max(0.3, u.spec.size)) * 1.5));
    let busy = 0;
    for (const o of this.units) if (o.alive && o.target === tgt && o.strikeT > 0) busy++;
    return busy < slots;
  }

  private servo(u: Unit, id: string, target: number): void {
    const jj = u.joints.get(id);
    if (jj) jj.j.configureMotorPosition(target, STIFF[jj.role], 2 * Math.sqrt(STIFF[jj.role]) * 0.7);
  }

  private pose(u: Unit, dir: number, tgt: Unit | null): void {
    const f = u.facing;
    const s = u.spec;
    const striking = u.strikeT > 0;
    const windup = u.strikeT > STRIKE_AT;
    const bite = s.attack === "bite" || s.attack === "peck";

    if (s.plan === "biped") {
      const slash = s.weapon === "sword" || s.weapon === "club" || s.attack === "slash";
      // Idle guard: fists up. Mirrored for facing.
      let sh = f * 0.5, el = f * 1.4;
      if (striking) {
        if (slash) [sh, el] = windup ? [f * 2.7, f * 0.4] : [f * 0.4, f * 0.1];
        else [sh, el] = windup ? [f * -0.4, f * 2.0] : [f * 1.55, 0];
      }
      if (u.fleeing) [sh, el] = [f * 2.6, f * 0.3]; // arms up, running
      this.servo(u, "shoulderF", sh);
      this.servo(u, "elbowF", el);
      this.servo(u, "shoulderB", u.fleeing ? f * 2.4 : f * 0.7);
      this.servo(u, "elbowB", f * 1.6);
    } else if (bite) {
      // Positive angle lifts a forward-facing head; strike swings it down and forward.
      this.servo(u, "neck", striking ? (windup ? f * 0.45 : -f * 0.75) : 0);
    }

    if (u.strikeT === STRIKE_AT && tgt) {
      const seg = u.bodies.get(u.bp.strikeSeg)!;
      const sp = seg.translation();
      const tp = (s.plan === "biped" ? tgt.bodies.get(tgt.bp.head)! : tgt.torso).translation();
      let nx = tp.x - sp.x, ny = tp.y - sp.y;
      const n = Math.hypot(nx, ny) || 1;
      nx /= n;
      ny /= n;
      const speed = strikeSpeed(s);
      if (s.attack === "ram" || s.attack === "charge") {
        push(u, dir * 3.5 * s.speed, 0.8);
      } else {
        seg.applyImpulse({ x: nx * seg.mass() * speed, y: ny * seg.mass() * speed }, true);
        if (s.plan === "quadruped" || s.plan === "bug") push(u, dir * 2.2 * s.speed, 1.8); // pounce
        if (s.plan === "fish") for (const body of u.bodies.values()) body.applyImpulse({ x: dir * body.mass() * 3 * s.speed, y: body.mass() * 2.5 }, true); // lunge
      }
    }
    if (u.strikeT > 0 && --u.strikeT === 0) u.cooldown = Math.floor((50 / s.speed) * this.rng.range(0.7, 1.3));
  }

  private resolveHits(u: Unit): void {
    const seg = u.bodies.get(u.bp.strikeSeg)!;
    for (let i = 0; i < seg.numColliders(); i++) {
      const c = seg.collider(i);
      const mine = this.owners.get(c.handle);
      if (!mine || !mine.bp.striker) continue;
      this.world.contactPairsWith(c, (other) => {
        const o = this.owners.get(other.handle);
        if (!o || o.unit.team === u.team || !o.unit.alive || u.struck.has(o.unit.id)) return;
        // A bite or peck grabs one body. Swings and charges can sweep a few, more when the attacker is far bigger.
        const grab = u.spec.attack === "bite" || u.spec.attack === "peck";
        const sweep = grab ? 1 : Math.min(5, 1 + Math.floor(u.mass / o.unit.mass / 2));
        if (u.struck.size >= sweep) return;
        let impulse = 0;
        this.world.contactPair(c, other, (m) => {
          for (let k = 0; k < m.numContacts(); k++) impulse += m.contactImpulse(k);
        });
        if (impulse <= 0) return;
        u.struck.add(o.unit.id);
        // Contact confirms the hit; the strike's momentum sizes it (limb plus a share of body
        // weight thrown behind it). Measured contact impulse is too small once the fist has slowed.
        const behind = u.spec.attack === "ram" || u.spec.attack === "charge" ? 0.5 : 0.05;
        // Limb share is a fixed fraction of the body, so a big-headed 3D model does not bite harder than its size.
        this.hit(u, o.unit, mine.bp.sharp, u.mass * (0.035 + behind) * strikeSpeed(u.spec));
      });
    }
  }

  private hit(attacker: Unit, victim: Unit, sharp: number, impulse: number): void {
    const dv = impulse / victim.mass;
    // Soft threshold: blows well below what the victim can shrug off do almost nothing
    // (a man's punch on a gorilla), blows well above it count nearly in full.
    const shrug = 0.15 * victim.spec.toughness * (1 + victim.spec.armor);
    const eff = (dv * dv) / (dv + shrug);
    const dmg = DAMAGE * sharp * eff * (1 - victim.spec.armor * 0.5) * Math.sqrt(attacker.spec.strength);
    victim.health -= dmg;
    attacker.hits++;
    attacker.dealt += dmg;
    // Knockback scales with the attacker's mass: a gorilla throws men, men barely move a gorilla.
    const ap = attacker.torso.translation(), vp = victim.torso.translation();
    const kdir = vp.x >= ap.x ? 1 : -1;
    const kb = (attacker.mass * 1.2 * Math.sqrt(attacker.spec.strength)) / victim.mass;
    push(victim, kdir * Math.min(9, kb), Math.min(5, kb * 0.5));
    // Stun needs a real hit, and a unit that just recovered gets a moment of immunity,
    // otherwise a crowd of weak hits stun-locks anything big.
    const knock = dv + kb * 0.15;
    if (knock > 0.5 && this.time > victim.stunUntil + 1) victim.stunUntil = this.time + Math.min(1.2, knock);
    if (victim.health <= 0) {
      this.kill(victim);
      attacker.kills++;
    }
  }

  private kill(u: Unit): void {
    u.alive = false;
    u.diedAt = this.time;
    for (const { j, role, torque } of u.joints.values()) {
      if (role === "wheel") j.configureMotorVelocity(0, 0.1);
      else {
        j.setMotorMaxForce(torque * 0.03);
        j.configureMotorPosition(0, 5, 2);
      }
    }
  }

  private checkMorale(): void {
    if (this.steps % 15 !== 0) return;
    for (const team of [0, 1] as const) {
      const total = this.specs[team].count;
      const lost = 1 - this.aliveCount(team) / total;
      for (const u of this.units) {
        if (u.team === team && u.alive && !u.fleeing && u.bravery < 1 && lost > u.bravery && Math.abs(u.torso.translation().x) < this.arenaHalf - 3) {
          u.fleeing = true;
        }
      }
    }
  }

  private checkEnd(): void {
    const a = this.aliveCount(0), b = this.aliveCount(1);
    if (a === 0 || b === 0) {
      this.result = { winner: a === 0 && b === 0 ? null : a === 0 ? 1 : 0, time: this.time, alive: [a, b] };
    } else if (this.time >= TIME_LIMIT) {
      const mass = [0, 0];
      for (const u of this.units) if (u.alive) mass[u.team] += u.mass * Math.max(0, u.health / u.maxHealth);
      this.result = { winner: mass[0] === mass[1] ? null : mass[0] > mass[1] ? 0 : 1, time: this.time, alive: [a, b] };
    }
  }

  /** Stable hash of every body's pose, for replay determinism checks. */
  hash(): string {
    let h = 2166136261;
    const f = new Float32Array(3);
    const b = new Uint8Array(f.buffer);
    this.world.forEachRigidBody((body) => {
      const t = body.translation();
      f[0] = t.x;
      f[1] = t.y;
      f[2] = body.rotation();
      for (const x of b) h = Math.imul(h ^ x, 16777619);
    });
    return (h >>> 0).toString(16);
  }

  dispose(): void {
    this.world.free();
  }
}

export { CHEAP_ABOVE };
