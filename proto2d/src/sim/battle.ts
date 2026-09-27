// The battle: specs in, physics out. The winner is whoever is still standing.
import RAPIER, { type Collider, type RevoluteImpulseJoint, type RigidBody, type World } from "@dimforge/rapier2d-deterministic-compat";
import { ELEMENT_STATUS, has, RANGED, STATUS_DOT, STATUS_DTYPE, STATUS_DUR, typeMult, VERBS, type RangedRule, type Status } from "./combat";
import { buildBlueprint, CHEAP_ABOVE, shapeArea, type Blueprint, type ColliderBP, type DecoBP, type JointRole, type MoveBP } from "./plans";
import { Rng } from "./rng";
import type { DType, Genome, Ranged, UnitSpec } from "./spec";

export const DT = 1 / 60;
const G = 9.81;
const DAMAGE = 0.2;
const TIME_LIMIT = 75;

/** Change a whole unit's velocity by (dvx, dvy): every body gets its share, so the unit moves as one. */
function push(u: { bodies: Map<string, RigidBody> }, dvx: number, dvy: number): void {
  for (const body of u.bodies.values()) body.applyImpulse({ x: body.mass() * dvx, y: body.mass() * dvy }, true);
}

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

// Collision groups: bit0 ground, bit1 team 0, bit2 team 1. Allies pass through each other.
const groups = (membership: number, filter: number) => (membership << 16) | filter;
const GROUND = groups(0b0001, 0b1110);
const TEAM = [groups(0b0010, 0b0101), groups(0b0100, 0b0011)];
// bit3: settled corpses. They lie on the ground and nothing else touches them.
const CORPSE = groups(0b1000, 0b0001);
const SETTLE_AFTER = 3;

const STIFF: Record<JointRole, number> = { hip: 140, knee: 140, shoulder: 90, elbow: 90, neck: 110, tail: 25, wing: 80, wheel: 0, spine: 70, tentacle: 30 };
const TORQUE: Record<JointRole, number> = { hip: 0.7, knee: 0.55, shoulder: 0.3, elbow: 0.22, neck: 0.18, tail: 0.06, wing: 0.08, wheel: 0, spine: 0.3, tentacle: 0.04 };

export interface DrawCollider {
  collider: Collider;
  unit: Unit;
  bp: ColliderBP;
  layer: number;
}

export interface DrawDeco {
  body: RigidBody;
  unit: Unit;
  d: DecoBP;
  layer: number;
}

export interface Shot {
  team: 0 | 1;
  owner: Unit;
  kind: Exclude<Ranged, "none">;
  rule: RangedRule;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  hit: Set<number>;
}

/** Visual-only events for the renderer. Never read by the simulation. */
export interface Fx {
  kind: "hit" | "boom" | "puff" | "split" | "heal";
  x: number;
  y: number;
  t: number;
  r: number;
  color: DType;
}

export interface Unit {
  id: number;
  team: 0 | 1;
  spec: UnitSpec;
  g: Genome;
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
  rangedCd: number;
  strikeT: number;
  move: MoveBP | null;
  firing: number; // steps of breath left
  struck: Set<number>;
  stunUntil: number;
  fleeing: boolean;
  bravery: number;
  kills: number;
  diedAt: number;
  /** Corpse put to sleep: touches only the ground and costs the solver nothing. */
  settled: boolean;
  strikes: number;
  hits: number;
  dealt: number;
  nextHop: number;
  leanTarget: number;
  hover: { x: number; y: number };
  status: Partial<Record<Status, number>>; // status -> ends at time
  generation: number;
  slow: number;
  /** Last time a breath stream hurt this unit; streams tick, they don't stack per particle. */
  streamHitAt: number;
}

interface Owner {
  unit: Unit;
  bp: ColliderBP;
  seg: string;
}

export interface BattleResult {
  winner: 0 | 1 | null;
  time: number;
  alive: [number, number];
}

function lowestPoint(c: Collider): number {
  const y = c.translation().y;
  const r = c.radius();
  if (c.shape.type === RAPIER.ShapeType.Capsule) return y - Math.abs(Math.cos(c.rotation())) * c.halfHeight() - r;
  if (c.shape.type === RAPIER.ShapeType.Cuboid) return y - (c.halfExtents()?.y ?? 0);
  return y - r;
}

function boundR(sh: ColliderBP["shape"]): number {
  return sh.kind === "ball" ? sh.r : sh.kind === "capsule" ? sh.hh + sh.r : Math.hypot(sh.hx, sh.hy);
}

const strikeSpeed = (s: UnitSpec) => 7 * Math.sqrt(s.strength) * s.speed ** 0.3;
const STRIKE_LEN = 22;
const STRIKE_AT = 13;
const BREATH_LEN = 40;

export class Battle {
  readonly world: World;
  readonly units: Unit[] = [];
  readonly draw: DrawCollider[] = [];
  readonly decor: DrawDeco[] = [];
  readonly shots: Shot[] = [];
  readonly fx: Fx[] = [];
  readonly arenaHalf: number;
  readonly rng: Rng;
  /** Bumped whenever units are added mid-fight (splitting), so views can re-attach. */
  version = 0;
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
    for (const s of [-1, 1]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 30).setTranslation(s * (this.arenaHalf + 0.5), 30).setCollisionGroups(GROUND), ground);
    // Big battles: fewer solver passes. Wobblier joints, which suits the genre, at half the cost.
    if (specs[0].count + specs[1].count > 40) this.world.numSolverIterations = 2;
    const gap = 3 + biggest * 1.5;
    specs.forEach((spec, team) => {
      const side = team === 0 ? -1 : 1;
      const spread = Math.min(10, 0.25 * spec.count * Math.max(0.4, spec.size));
      for (let i = 0; i < spec.count; i++) this.spawn(spec, team as 0 | 1, side * (gap + this.rng.next() * spread), 0, spec.count);
    });
  }

  private spawn(base: UnitSpec, team: 0 | 1, x: number, generation: number, crowd: number): Unit {
    const r = this.rng;
    const spec: UnitSpec = {
      ...base,
      size: r.jitter(base.size, 0.08),
      weight: r.jitter(base.weight, 0.15),
      strength: r.jitter(base.strength, 0.15),
      toughness: r.jitter(base.toughness, 0.15),
      speed: r.jitter(base.speed, 0.15),
    };
    const facing: 1 | -1 = team === 0 ? 1 : -1;
    const bp = buildBlueprint(spec, facing, crowd);
    // Mass balance: a hub body carrying limbs many times its weight makes the joint solver blow
    // up (twelve thick legs on a thin torso). The torso always carries at least a third.
    let torsoA = 0, limbA = 0;
    for (const seg of bp.segments) for (const c of seg.colliders) {
      const a = shapeArea(c.shape) * c.densityMul;
      if (seg.id === bp.torso) torsoA += a;
      else limbA += a;
    }
    const limbScale = limbA > 0 && torsoA < 0.35 * (torsoA + limbA) ? (0.65 / 0.35) * (torsoA / limbA) : 1;
    const density = spec.weight / (torsoA + limbA * limbScale);
    const unit: Unit = {
      id: this.unitId++, team, spec, g: bp.genome, bp, bodies: new Map(), joints: new Map(),
      torso: null as unknown as RigidBody, feet: [], mass: spec.weight, health: spec.toughness, maxHealth: spec.toughness,
      alive: true, facing, phase: r.next(), target: null, retargetIn: 0, cooldown: Math.floor(r.range(10, 50)),
      rangedCd: Math.floor(r.range(20, 90)), strikeT: 0, move: null, firing: 0, struck: new Set(), stunUntil: 0, fleeing: false,
      bravery: base.bravery >= 1 ? 1 : r.jitter(base.bravery, 0.35), kills: 0, diedAt: -1, settled: false, strikes: 0, hits: 0, dealt: 0,
      nextHop: r.range(0, 0.6), leanTarget: 0, hover: { x: r.range(0.2, 1.6), y: r.range(-0.3, 1.4) }, status: {}, generation, slow: 1, streamHitAt: -1,
    };
    const ghost = unit.g.material === "ghost";
    for (const seg of bp.segments) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x + seg.pos[0], seg.pos[1] + 0.01).setLinearDamping(ghost ? 0.6 : 0.05).setAngularDamping(0.6),
      );
      for (const c of seg.colliders) {
        const sh = c.shape;
        const desc = sh.kind === "ball" ? RAPIER.ColliderDesc.ball(sh.r) : sh.kind === "capsule" ? RAPIER.ColliderDesc.capsule(sh.hh, sh.r) : RAPIER.ColliderDesc.cuboid(sh.hx, sh.hy);
        desc.setTranslation(c.offset[0], c.offset[1]).setRotation(c.rot).setDensity(density * c.densityMul * (seg.id === bp.torso ? 1 : limbScale)).setFriction(c.foot ? (bp.loco === "slither" || bp.loco === "roll" ? 0.3 : 1.4) : 0.6)
          .setRestitution(unit.g.material === "slime" ? 0.5 : 0).setCollisionGroups(TEAM[team]);
        const collider = this.world.createCollider(desc, body);
        this.owners.set(collider.handle, { unit, bp: c, seg: seg.id });
        if (c.foot) unit.feet.push(collider);
        this.draw.push({ collider, unit, bp: c, layer: seg.layer });
      }
      for (const d of seg.deco ?? []) this.decor.push({ body, unit, d, layer: seg.layer });
      unit.bodies.set(seg.id, body);
    }
    unit.torso = unit.bodies.get(bp.torso)!;
    if (crowd <= CHEAP_ABOVE) unit.torso.setAdditionalSolverIterations(2);
    const posOf = (id: string) => bp.segments.find((s) => s.id === id)!.pos;
    // Mass each joint has to move: its child segment and everything hanging off it.
    const kids = new Map<string, string[]>();
    for (const jb of bp.joints) kids.set(jb.a, [...(kids.get(jb.a) ?? []), jb.b]);
    const subtree = (id: string): number => unit.bodies.get(id)!.mass() + (kids.get(id) ?? []).reduce((m, c) => m + subtree(c), 0);
    for (const jb of bp.joints) {
      const pa = posOf(jb.a), pb = posOf(jb.b);
      const data = RAPIER.JointData.revolute({ x: jb.at[0] - pa[0], y: jb.at[1] - pa[1] }, { x: jb.at[0] - pb[0], y: jb.at[1] - pb[1] });
      const j = this.world.createImpulseJoint(data, unit.bodies.get(jb.a)!, unit.bodies.get(jb.b)!, true) as RevoluteImpulseJoint;
      j.setContactsEnabled(false);
      if (jb.limits) j.setLimits(jb.limits[0], jb.limits[1]);
      j.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      // Legs carry the whole body; everything else only its own weight (with headroom to strike).
      const load = jb.role === "hip" || jb.role === "knee" || jb.role === "spine" ? spec.weight : Math.min(spec.weight, subtree(jb.b) * 8);
      const torque = jb.role === "wheel" ? spec.weight * 2 * spec.strength : TORQUE[jb.role] * (jb.torqueMul ?? 1) * load * G * spec.size * spec.strength;
      j.setMotorMaxForce(torque);
      if (jb.role !== "wheel") j.configureMotorPosition(0, STIFF[jb.role], 2 * Math.sqrt(STIFF[jb.role]) * 0.7);
      unit.joints.set(jb.id, { j, role: jb.role, torque });
    }
    this.units.push(unit);
    return unit;
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
    for (const u of this.units) if (u.alive) this.tickStatus(u);
    for (const u of this.units) if (u.alive) this.control(u);
    this.world.step();
    for (const u of this.units) if (u.alive && u.move && u.strikeT > 0 && u.strikeT <= STRIKE_AT) this.resolveHits(u);
    this.stepShots();
    for (let i = this.fx.length - 1; i >= 0; i--) if ((this.fx[i].t += DT) > 0.6) this.fx.splice(i, 1);
    this.checkMorale();
    this.settleCorpses();
    this.checkEnd();
  }

  /**
   * Big battles leave piles of ragdolls that the solver keeps working on. A few seconds after death,
   * once a body has come to rest, it stops touching fighters and goes to sleep. Deterministic: it
   * depends only on simulation state, so replays still match on every device.
   */
  private settleCorpses(): void {
    if (this.steps % 20 !== 0) return;
    for (const u of this.units) {
      if (u.alive || u.settled || this.time - u.diedAt < SETTLE_AFTER) continue;
      let still = true;
      for (const b of u.bodies.values()) {
        const v = b.linvel();
        if (v.x * v.x + v.y * v.y > 0.5 || Math.abs(b.angvel()) > 1.5) {
          still = false;
          break;
        }
      }
      if (!still && this.time - u.diedAt < SETTLE_AFTER * 3) continue;
      u.settled = true;
      for (const { j } of u.joints.values()) j.setMotorMaxForce(0);
      for (const b of u.bodies.values()) {
        for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(CORPSE);
        b.setLinvel({ x: 0, y: Math.min(0, b.linvel().y) }, false);
        b.setAngvel(0, false);
        b.sleep();
      }
    }
  }

  // ------------------------------------------------------------ status, specials

  private tickStatus(u: Unit): void {
    let slow = 1;
    for (const k of Object.keys(u.status) as Status[]) {
      if (this.time > u.status[k]!) {
        delete u.status[k];
        continue;
      }
      const dot = STATUS_DOT[k];
      // Big things burn and rot slower: less surface for their bulk.
      if (dot) this.harm(u, (dot[0] * DT) / Math.pow(Math.max(1, u.mass / 75), 0.3), dot[1], null);
      if (k === "freeze") slow *= 0.3;
      if (k === "web") slow *= 0.25;
      if (k === "shock") u.stunUntil = Math.max(u.stunUntil, this.time + DT * 2);
      if (!u.alive) return;
    }
    u.slow = slow;
    if (has(u.g, "regenerate") && !u.status.burn && u.health < u.maxHealth) {
      u.health = Math.min(u.maxHealth, u.health + 0.04 * u.maxHealth * DT);
      if (this.steps % 40 === 0) this.fx.push({ kind: "heal", ...this.xy(u), t: 0, r: u.spec.size * 0.3, color: "poison" });
    }
  }

  private applyStatus(u: Unit, st: Status, mult = 1): void {
    if (typeMult(u.g, STATUS_DTYPE[st]) <= 0.05) return; // immune: a fire elemental can't burn
    if (st === "burn" && u.status.freeze) {
      delete u.status.freeze; // fire melts ice
      return;
    }
    u.status[st] = Math.max(u.status[st] ?? 0, this.time + STATUS_DUR[st] * mult);
  }

  private xy(u: Unit) {
    const p = u.torso.translation();
    return { x: p.x, y: p.y };
  }

  /** Apply damage of a type. Every source goes through here. */
  private harm(victim: Unit, amount: number, dtype: DType, attacker: Unit | null): number {
    if (!victim.alive) return 0;
    const dmg = amount * typeMult(victim.g, dtype);
    victim.health -= dmg;
    if (attacker) {
      attacker.dealt += dmg;
      if (victim.health <= 0) attacker.kills++;
    }
    if (victim.health <= 0) this.kill(victim);
    return dmg;
  }

  // ------------------------------------------------------------ AI + movement

  private pickTarget(u: Unit): Unit | null {
    const p = u.torso.translation();
    let best: Unit | null = null, bestD = Infinity;
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

  private grounded(u: Unit): boolean {
    for (const c of u.feet) {
      if (lowestPoint(c) < 0.06 + u.spec.size * 0.04) return true;
      let touching = false;
      this.world.contactPairsWith(c, (other) => {
        if (touching) return;
        this.world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
      });
      if (touching) return true;
    }
    return false;
  }

  private control(u: Unit): void {
    const s = u.spec, bp = u.bp, loco = bp.loco;
    const torso = u.torso;
    const p = torso.translation();
    const v = torso.linvel();
    if (this.opts.idle) u.target = null;
    else if (--u.retargetIn <= 0 || !u.target || !u.target.alive) {
      u.target = this.pickTarget(u);
      u.retargetIn = 20 + Math.floor(this.rng.next() * 10);
    }
    if (u.cooldown > 0) u.cooldown--;
    if (u.rangedCd > 0) u.rangedCd--;
    const stun = Math.max(0, Math.min(1, this.time - u.stunUntil));
    const tgt = u.target;
    const tp = tgt ? tgt.torso.translation() : { x: p.x + u.facing, y: p.y };
    const dx = tp.x - p.x;
    let dir = dx >= 0 ? 1 : -1;
    if (u.fleeing) {
      dir = -dir;
      if (Math.abs(p.x) > this.arenaHalf - 1.5) u.fleeing = false;
    }
    const speed = s.speed * u.slow;
    const airborne = (loco === "fly" || loco === "float") && stun > 0.5 && !u.status.web;
    const reach = bp.reach + (tgt ? tgt.bp.halfWidth : 0);
    const dist = Math.abs(dx);
    const close = tgt !== null && dist < reach && !u.fleeing;
    const maxSpeed = 2.4 * speed * Math.sqrt(Math.max(0.3, s.size) / 1.7) * (loco === "gallop" ? 1.3 : loco === "crawl" ? 0.9 : 1);
    const grounded = this.grounded(u);
    const legged = bp.legs.length > 0 || !!bp.model;
    const moving = (grounded || airborne || loco === "slither" || loco === "roll") && tgt !== null && (!close || u.fleeing);

    // Vertical support.
    if (airborne) {
      const flyer = loco === "fly";
      const diving = u.cooldown < 8 || u.strikeT > 0;
      const headY = tgt ? tgt.bodies.get(tgt.bp.head)!.translation().y : p.y;
      const hy = flyer
        ? headY + (diving ? 0.1 : u.hover.y * s.size)
        : diving && tgt ? Math.max(bp.standY * 0.6, tgt.torso.translation().y) : bp.standY + 0.25 * s.size + 0.1 * s.size * Math.sin(this.time * 2 + u.id);
      const ex = dx - dir * (flyer && !diving ? u.hover.x * s.size + reach : reach * 0.6);
      const ay = G + Math.max(-8, Math.min(8, 6 * (hy - p.y) - 3 * v.y));
      const ax = Math.max(-10, Math.min(10, 4 * (u.fleeing ? dir * 5 : moving || diving ? ex : 0) - 2.5 * v.x)) * speed * (flyer ? 1 : 0.6);
      push(u, ax * DT, ay * DT);
    } else if (grounded && legged) {
      const ay = G + 30 * (bp.standY - p.y) - 6 * v.y;
      torso.applyImpulse({ x: 0, y: u.mass * Math.max(0, Math.min(2.2 * G, ay)) * stun * DT }, true);
    }

    // Stay upright, how hard depends on the body. Rollers don't try at all.
    if (loco !== "roll") {
      const k = u.g.frame === "long" ? 0.2 : u.g.frame === "wheeled" ? 0.2 : u.g.frame === "round" && !legged ? 0.15 : 0.7;
      const inertia = u.mass * s.size * s.size * 0.08;
      let tau = inertia * (-45 * (torso.rotation() - u.leanTarget) - 9 * torso.angvel());
      const cap = u.mass * G * s.size * k * stun * (1 - u.g.clumsy * 0.4);
      tau = Math.max(-cap, Math.min(cap, tau));
      torso.applyTorqueImpulse(tau * DT, true);
    }

    // Drive.
    if (moving) {
      if (loco === "hop" || loco === "flop") {
        if (this.time >= u.nextHop && stun > 0.5 && grounded) {
          const vy = Math.min(6, Math.sqrt(2 * G * (loco === "hop" ? 0.45 : 0.3) * Math.max(0.3, s.size)));
          push(u, dir * Math.min(maxSpeed * 1.3, 1.6 * speed * Math.sqrt(Math.max(0.3, s.size))), vy);
          u.nextHop = this.time + this.rng.range(0.55, 0.85) / Math.sqrt(Math.max(0.2, speed));
        }
      } else if (loco === "slither") {
        if (dir * v.x < maxSpeed * 0.8) push(u, dir * 7 * speed * stun * DT, 0);
      } else if (loco === "roll") {
        if (dir * v.x < maxSpeed * 1.2) {
          torso.applyTorqueImpulse(-dir * u.mass * s.size * 3 * speed * DT, true);
          push(u, dir * 4 * speed * stun * DT, 0);
        }
      } else if (loco === "drive") {
        for (const jj of u.joints.values()) if (jj.role === "wheel") jj.j.configureMotorVelocity((-dir * maxSpeed) / (0.11 * s.size), 2);
      } else if (!airborne && dir * v.x < maxSpeed) {
        torso.applyImpulse({ x: dir * u.mass * 9 * speed * stun * DT, y: 0 }, true);
      }
    } else if (loco === "drive") for (const jj of u.joints.values()) if (jj.role === "wheel") jj.j.configureMotorVelocity(0, 2);

    // Gait and body waves.
    const rate = (moving || airborne ? (1.7 * speed) / Math.sqrt(Math.max(0.3, s.size) / 1.7) : 0.4) * (loco === "gallop" ? 1.25 : loco === "crawl" ? 1.6 : 1);
    u.phase += DT * rate;
    const amp = moving ? (loco === "crawl" ? 0.45 : 0.65) * (1 + u.g.clumsy * 0.4) : 0.08;
    for (const leg of bp.legs) {
      const a = 2 * Math.PI * (u.phase + leg.phase);
      this.servo(u, leg.hip, dir * amp * Math.sin(a));
      if (leg.knee) this.servo(u, leg.knee, -u.facing * (moving ? 0.9 : 0.1) * Math.max(0, Math.cos(a)));
    }
    const flap = loco === "fly" && airborne ? 1.2 * Math.sin(2 * Math.PI * u.phase * 4) : -0.25;
    for (const w of bp.wings) this.servo(u, w, u.facing * flap);
    bp.tails.forEach((t, i) => this.striking(u, "tail") || this.servo(u, t, -u.facing * 0.3 * Math.sin(2 * Math.PI * u.phase - i * 0.8)));
    bp.tentacles.forEach((ch, k) => this.striking(u, "tentacle") || ch.forEach((t, i) => this.servo(u, t, 0.35 * Math.sin(2 * Math.PI * u.phase * 0.8 + k * 1.3 - i * 0.9))));
    if (bp.wave.length) {
      const wamp = moving ? (loco === "slither" ? 0.55 : 0.4) : 0.1;
      bp.wave.forEach((id, i) => {
        if (i === 0 && this.striking(u, "head")) return;
        this.servo(u, id, wamp * Math.sin(2 * Math.PI * u.phase * 1.5 - i * 1.1));
      });
    }
    if (bp.model) this.modelPose(u, moving);

    // Choose an action.
    const ready = stun > 0.8 && u.strikeT === 0 && u.firing === 0 && !u.fleeing && tgt !== null;
    const rng = u.g.ranged !== "none" ? RANGED[u.g.ranged] : null;
    if (ready && rng && u.rangedCd === 0 && dist > reach * 0.9 && dist < rng.range * Math.sqrt(Math.max(0.5, s.size))) {
      this.fire(u, tgt!);
    } else if (ready && close && u.cooldown === 0 && this.hasSlot(tgt!, u)) {
      const usable = bp.moves.filter((m) => m.reach + tgt!.bp.halfWidth >= dist);
      u.move = (usable.length ? usable : bp.moves)[Math.floor(this.rng.next() * (usable.length || bp.moves.length))];
      u.strikeT = STRIKE_LEN;
      u.struck.clear();
      u.strikes++;
    }
    if (u.firing > 0) this.breathe(u);
    this.pose(u, dir, tgt);
  }

  private striking(u: Unit, part: string): boolean {
    return u.strikeT > 0 && !!u.move && VERBS[u.move.verb].part === part;
  }

  private modelPose(u: Unit, moving: boolean): void {
    const md = u.bp.model!.model;
    const verb = u.move?.verb;
    const want = verb === "kick" || verb === "stomp" ? "kick" : verb === "headbutt" || verb === "gore" || verb === "charge" ? "headbutt" : "attack";
    const atk = md.attacks.includes(want) ? want : md.attacks[0];
    const striking = u.strikeT > 0 && atk !== undefined;
    const clips = md.clips;
    const clip = (striking ? clips[atk!] : moving ? (u.spec.speed > 1.1 ? clips.run ?? clips.walk : clips.walk ?? clips.run) : clips.idle) ?? clips.walk!;
    const ph = striking ? (STRIKE_LEN - u.strikeT) / STRIKE_LEN : moving ? u.phase : u.phase * 0.3;
    const t = (((ph % 1) + 1) % 1) * clip.length;
    const i0 = Math.floor(t) % clip.length, i1 = striking ? Math.min(clip.length - 1, i0 + 1) : (i0 + 1) % clip.length, w = t - Math.floor(t);
    for (const g of md.groups) if (u.joints.has(g.id)) this.servo(u, g.id, u.facing * ((clip[i0][g.id] ?? 0) * (1 - w) + (clip[i1][g.id] ?? 0) * w));
    u.leanTarget = u.facing * ((clip[i0]._rootA ?? 0) * (1 - w) + (clip[i1]._rootA ?? 0) * w);
  }

  /** Allies pass through each other in 2D; only as many attackers as fit around a target may swing. */
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

  // ------------------------------------------------------------ melee

  private pose(u: Unit, dir: number, tgt: Unit | null): void {
    const f = u.facing, bp = u.bp, s = u.spec;
    const m = u.strikeT > 0 ? u.move : null;
    const part = m ? VERBS[m.verb].part : null;
    const windup = u.strikeT > STRIKE_AT;
    // Arms: guard, or the swing of the arm that is attacking.
    bp.arms.forEach((a, k) => {
      const hand = `fa${a.shoulder.slice(2)}`;
      const mine = part === "arm" && m!.segs.includes(hand) && (k % 2 === 1 || bp.arms.length === 1);
      let sh = f * (0.5 + (k % 2) * 0.2), el = f * 1.4;
      if (mine) {
        const overhead = m!.verb === "slash" || m!.verb === "claw" || u.g.hand === "hammer" || s.weapon === "sword" || s.weapon === "club";
        [sh, el] = overhead ? (windup ? [f * 2.7, f * 0.4] : [f * 0.4, f * 0.1]) : windup ? [f * -0.4, f * 2.0] : [f * 1.55, 0];
      } else if (u.fleeing) [sh, el] = [f * 2.6, f * 0.3];
      this.servo(u, a.shoulder, sh);
      if (a.elbow) this.servo(u, a.elbow, el);
    });
    if (part === "head") for (const ch of [...bp.necks, bp.heads.map((h) => `${h}j`)]) for (const j of ch) this.servo(u, j, windup ? f * 0.4 : -f * 0.6);
    if (part === "leg" && bp.legs.length) {
      const leg = bp.legs.find((l) => m!.segs.some((sg) => sg.endsWith(l.hip.slice(2)))) ?? bp.legs[1] ?? bp.legs[0];
      this.servo(u, leg.hip, windup ? -dir * 0.8 : dir * 1.3);
      if (leg.knee) this.servo(u, leg.knee, windup ? -f * 1.2 : 0);
    }
    if (part === "tail") for (const t of bp.tails) this.servo(u, t, windup ? -f * 0.5 : -f * 1.1);
    if (part === "tentacle") for (const ch of bp.tentacles) for (const t of ch) this.servo(u, t, windup ? -f * 0.4 : f * 0.9);

    if (m && u.strikeT === STRIKE_AT && tgt) {
      const rule = VERBS[m.verb];
      const spd = strikeSpeed(s);
      if (rule.body === "charge") push(u, dir * 3.5 * s.speed * u.slow, 0.8);
      if (rule.body === "jump") push(u, dir * 1.5, m.verb === "stomp" ? 4.5 : 3.2);
      if (rule.body === "lunge") push(u, dir * 2 * s.speed * u.slow, 1.2);
      if (rule.part !== "body") {
        const tq = (u.g.frame === "upright" ? tgt.bodies.get(tgt.bp.head)! : tgt.torso).translation();
        for (const id of m.segs) {
          const seg = u.bodies.get(id);
          if (!seg) continue;
          const sp = seg.translation();
          let nx = tq.x - sp.x, ny = tq.y - sp.y;
          const n = Math.hypot(nx, ny) || 1;
          nx /= n;
          ny /= n;
          seg.applyImpulse({ x: nx * seg.mass() * spd, y: ny * seg.mass() * spd }, true);
        }
      }
    }
    if (u.strikeT > 0 && --u.strikeT === 0) {
      u.cooldown = Math.floor((50 / Math.max(0.3, s.speed * u.slow)) * this.rng.range(0.7, 1.3));
      u.move = null;
    }
  }

  private resolveHits(u: Unit): void {
    const m = u.move!;
    const rule = VERBS[m.verb];
    const segs = rule.part === "body" ? [...u.bodies.keys()] : m.segs;
    for (const sid of segs) {
      const seg = u.bodies.get(sid);
      if (!seg) continue;
      for (let i = 0; i < seg.numColliders(); i++) {
        const c = seg.collider(i);
        const mine = this.owners.get(c.handle);
        if (!mine) continue;
        this.world.contactPairsWith(c, (other) => {
          const o = this.owners.get(other.handle);
          if (!o || o.unit.team === u.team || !o.unit.alive || u.struck.has(o.unit.id)) return;
          const sweep = rule.grab ? 1 : Math.min(5, 1 + Math.floor(u.mass / o.unit.mass / 2));
          if (u.struck.size >= sweep) return;
          let impulse = 0;
          this.world.contactPair(c, other, (mf) => {
            for (let k = 0; k < mf.numContacts(); k++) impulse += mf.contactImpulse(k);
          });
          if (impulse <= 0) return;
          u.struck.add(o.unit.id);
          const behind = rule.body === "charge" || rule.body === "jump" ? 0.5 : 0.05;
          this.hit(u, o.unit, Math.max(mine.bp.sharp, rule.sharp * 0.6), u.mass * (0.035 + behind) * strikeSpeed(u.spec), mine.bp.dtype ?? rule.dtype, other.translation());
        });
      }
    }
  }

  private hit(attacker: Unit, victim: Unit, sharp: number, impulse: number, dtype: DType, at: { x: number; y: number }): void {
    const dv = impulse / victim.mass;
    const armor = Math.max(0, victim.spec.armor + (victim.g.back === "shell" ? 0.25 : 0) - (victim.status.corrode ? 0.3 : 0));
    const shrug = 0.15 * victim.spec.toughness * (1 + armor);
    const eff = (dv * dv) / (dv + shrug);
    const rage = has(attacker.g, "rage") ? 1 + (1 - Math.max(0, attacker.health / attacker.maxHealth)) * 0.9 : 1;
    let base = DAMAGE * sharp * eff * (1 - Math.min(0.8, armor) * 0.5) * Math.sqrt(attacker.spec.strength) * rage;
    // Only something far bigger kills in one blow; between rough equals a fight takes several hits.
    // The cap grows with the mass ratio: a gorilla can drop a man with one good swing, a man can't.
    if (attacker.mass < 8 * victim.mass) base = Math.min(base, 0.45 * Math.max(1, attacker.mass / victim.mass) * victim.maxHealth);
    attacker.hits++;
    this.fx.push({ kind: "hit", x: at.x, y: at.y, t: 0, r: Math.min(1.2, 0.15 + dv * 0.1), color: dtype });
    this.harm(victim, base, dtype, attacker);
    const el = attacker.g.element;
    if (el !== "none") {
      const st = ELEMENT_STATUS[el];
      this.harm(victim, base * 0.35, STATUS_DTYPE[st], attacker);
      if (victim.alive) this.applyStatus(victim, st);
    }
    // Spikes, thorns and hot bodies hurt whatever hits them.
    if (has(victim.g, "thorns")) this.harm(attacker, base * 0.3, "pierce", victim);
    if (victim.g.material === "fire" && attacker.alive) this.applyStatus(attacker, "burn", 0.5);
    // Knockback scales with attacker mass: a gorilla throws men, men barely move a gorilla.
    const ap = attacker.torso.translation(), vp = victim.torso.translation();
    const kdir = vp.x >= ap.x ? 1 : -1;
    const kb = (attacker.mass * 1.2 * Math.sqrt(attacker.spec.strength)) / victim.mass;
    if (victim.alive || victim.diedAt === this.time) push(victim, kdir * Math.min(9, kb), Math.min(5, kb * 0.5));
    const knock = dv + kb * 0.15;
    if (knock > 0.5 && this.time > victim.stunUntil + 1) victim.stunUntil = this.time + Math.min(1.2, knock);
  }

  // ------------------------------------------------------------ ranged

  private origin(u: Unit, kind: Exclude<Ranged, "none">) {
    const hand = u.bp.arms.length && (kind === "shoot" || kind === "throw_rock" || kind === "lightning") ? `fa${u.bp.arms[Math.min(1, u.bp.arms.length - 1)].shoulder.slice(2)}` : u.bp.mouth;
    const b = u.bodies.get(hand) ?? u.torso;
    const p = b.translation();
    return { x: p.x + u.facing * 0.1 * u.spec.size, y: p.y };
  }

  private fire(u: Unit, tgt: Unit): void {
    const kind = u.g.ranged as Exclude<Ranged, "none">;
    const rule = RANGED[kind];
    u.rangedCd = Math.floor(((rule.stream ? 150 : 120) / Math.max(0.4, u.spec.speed)) * this.rng.range(0.8, 1.2));
    if (rule.stream) {
      u.firing = BREATH_LEN;
      return;
    }
    this.launch(u, tgt, kind, rule, 0);
  }

  private breathe(u: Unit): void {
    u.firing--;
    if (!u.target || !u.target.alive || u.firing % 2) return;
    const kind = u.g.ranged as Exclude<Ranged, "none">;
    this.launch(u, u.target, kind, RANGED[kind], (this.rng.next() - 0.5) * 0.35);
  }

  private launch(u: Unit, tgt: Unit, kind: Exclude<Ranged, "none">, rule: RangedRule, spread: number): void {
    const o = this.origin(u, kind);
    const tq = tgt.torso.translation();
    const dx = tq.x - o.x, dy = tq.y - o.y;
    const dist = Math.hypot(dx, dy) || 1;
    const sc = Math.sqrt(Math.max(0.4, u.spec.size / 1.7));
    const spd = rule.speed * Math.sqrt(sc);
    const t = dist / spd;
    // Aim high enough that gravity brings it onto the target.
    const vx = (dx / dist) * spd, vy = (dy / dist) * spd + 0.5 * G * rule.gravity * t;
    const a = Math.atan2(vy, vx) + spread;
    const v = Math.hypot(vx, vy);
    const power = Math.sqrt(u.spec.strength);
    this.shots.push({
      team: u.team, owner: u, kind, rule, x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rule.r * sc,
      dmg: rule.dmg * power, life: (rule.range * sc * 1.3) / spd, hit: new Set(),
    });
  }

  private stepShots(): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.vy -= G * s.rule.gravity * DT;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      s.life -= DT;
      let done = s.life <= 0 || Math.abs(s.x) > this.arenaHalf;
      if (s.y < s.r) {
        if (!s.rule.stream) this.fx.push({ kind: "puff", x: s.x, y: 0.05, t: 0, r: s.r * 3, color: s.rule.dtype });
        done = true;
      }
      if (!done) {
        for (const u of this.units) {
          if (u.team === s.team || !u.alive || s.hit.has(u.id)) continue;
          const tp = u.torso.translation();
          if (Math.abs(tp.x - s.x) > u.spec.size * 1.5 + 1 || Math.abs(tp.y - s.y) > u.spec.size * 1.5 + 1) continue;
          if (!this.touches(u, s.x, s.y, s.r)) continue;
          if (s.rule.stream && this.time - u.streamHitAt < 0.2) continue;
          s.hit.add(u.id);
          if (s.rule.stream) u.streamHitAt = this.time;
          // A bullet barely scratches a kraken; a dragon's breath is worse for a man than for a whale.
          const scale = Math.max(0.12, Math.min(2.5, (s.owner.mass / u.mass) ** 0.35));
          this.harm(u, s.dmg * scale * (s.rule.stream ? 1.5 : 1), s.rule.dtype, s.owner);
          if (s.rule.status && u.alive) this.applyStatus(u, s.rule.status, s.rule.stream ? 0.4 : 1);
          if (s.rule.knock) push(u, Math.sign(s.vx) * s.rule.knock * Math.sqrt(75 / Math.max(10, u.mass)), s.rule.knock * 0.3);
          this.fx.push({ kind: "hit", x: s.x, y: s.y, t: 0, r: s.r * 2.5, color: s.rule.dtype });
          if (!s.rule.sensor || !s.rule.stream) {
            done = true;
            break;
          }
        }
      }
      if (done) this.shots.splice(i, 1);
    }
  }

  private touches(u: Unit, x: number, y: number, r: number): boolean {
    for (const d of this.draw) {
      if (d.unit !== u) continue;
      const c = d.collider.translation();
      const br = boundR(d.bp.shape) + r;
      if ((c.x - x) ** 2 + (c.y - y) ** 2 < br * br) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ death

  private kill(u: Unit): void {
    if (!u.alive) return;
    u.alive = false;
    u.diedAt = this.time;
    u.firing = 0;
    for (const { j, role, torque } of u.joints.values()) {
      if (role === "wheel") j.configureMotorVelocity(0, 0.1);
      else {
        j.setMotorMaxForce(torque * 0.03);
        j.configureMotorPosition(0, 5, 2);
      }
    }
    const p = u.torso.translation();
    if (has(u.g, "explode")) {
      const R = 1.2 + u.spec.size * 1.2;
      this.fx.push({ kind: "boom", x: p.x, y: p.y, t: 0, r: R, color: "fire" });
      for (const o of this.units) {
        if (o === u || !o.alive) continue;
        const q = o.torso.translation();
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d > R) continue;
        const k = 1 - d / R;
        const power = Math.sqrt(Math.max(0.2, u.mass / 75));
        if (o.team !== u.team) this.harm(o, 0.9 * k * power, "fire", u);
        push(o, Math.sign(q.x - p.x || 1) * 9 * k * power * Math.sqrt(75 / Math.max(10, o.mass)), 6 * k * power);
      }
    }
    if (has(u.g, "split") && u.generation < 2 && u.spec.size > 0.2) {
      const child: UnitSpec = { ...u.spec, count: 1, size: u.spec.size * 0.7, weight: u.spec.weight * 0.34, toughness: u.spec.toughness * 0.5 };
      this.fx.push({ kind: "split", x: p.x, y: p.y, t: 0, r: u.spec.size, color: "poison" });
      for (const dxs of [-0.35, 0.35]) {
        const c = this.spawn(child, u.team, p.x + dxs * u.spec.size, u.generation + 1, 1);
        push(c, dxs * 6, 4);
      }
      this.version++;
    }
  }

  private checkMorale(): void {
    if (this.steps % 15 !== 0) return;
    for (const team of [0, 1] as const) {
      const lost = 1 - this.aliveCount(team) / this.specs[team].count;
      for (const u of this.units) {
        if (u.team === team && u.alive && !u.fleeing && u.bravery < 1 && lost > u.bravery && Math.abs(u.torso.translation().x) < this.arenaHalf - 3) u.fleeing = true;
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
    const fl = new Float32Array(3);
    const by = new Uint8Array(fl.buffer);
    this.world.forEachRigidBody((body) => {
      const t = body.translation();
      fl[0] = t.x;
      fl[1] = t.y;
      fl[2] = body.rotation();
      for (const x of by) h = Math.imul(h ^ x, 16777619);
    });
    return (h >>> 0).toString(16);
  }

  dispose(): void {
    this.world.free();
  }
}

export { CHEAP_ABOVE };
