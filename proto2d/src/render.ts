// Canvas renderer. Reads physics state; never writes it.
// Each creature is drawn as one silhouette: every part's outline first, then every fill, so
// joints read as a single body instead of a pile of capsules.
import type { Status } from "./sim/combat";
import type { Battle, DrawCollider, DrawDeco, Shot, Unit } from "./sim/battle";
import type { DecoShape, Paint } from "./sim/plans";
import type { DType } from "./sim/spec";

type RGB = [number, number, number];
const hex = (c: string): RGB => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");
const mix = (c: string, to: RGB, t: number) => {
  const [r, g, b] = hex(c);
  return toHex([r + (to[0] - r) * t, g + (to[1] - g) * t, b + (to[2] - b) * t]);
};
const BLACK: RGB = [20, 16, 24];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [120, 118, 125];
const FIXED: Partial<Record<Paint, string>> = { metal: "#cfd6dd", bone: "#f1e9d2", red: "#d94a4a", gold: "#e7b53a", glow: "#fff4a8", eye: "#ffffff" };
const DCOL: Record<DType, string> = { blunt: "#fff1b8", slash: "#ffffff", pierce: "#ff5a5a", fire: "#ff8a1f", ice: "#9ee7ff", poison: "#8fe35a", electric: "#ffe84a", acid: "#c6f24a" };
const STATUS_TINT: Partial<Record<Status, [RGB, number]>> = { freeze: [[190, 240, 255], 0.55], poison: [[120, 210, 70], 0.3], burn: [[255, 120, 40], 0.25], corrode: [[190, 230, 70], 0.3], shock: [[255, 240, 120], 0.4] };

type Item = { kind: "col"; d: DrawCollider } | { kind: "deco"; d: DrawDeco };
interface UnitDraw {
  u: Unit;
  far: Item[];
  near: Item[];
  front: DrawDeco[];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cam = { x: 0, y: 3, scale: 40, ready: false };
  private groups: UnitDraw[] = [];
  private colors = new Map<string, string>();
  private battle: Battle | null = null;
  private version = -1;
  hideUnit: (u: Unit) => boolean = () => false;
  view = { x: 0, scale: 40, groundY: 0, w: 1, h: 1 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  attach(b: Battle): void {
    if (this.battle !== b) this.cam.ready = false;
    this.battle = b;
    this.version = b.version;
    this.colors.clear();
    const by = new Map<Unit, UnitDraw>();
    const get = (u: Unit) => by.get(u) ?? (by.set(u, { u, far: [], near: [], front: [] }), by.get(u)!);
    for (const d of b.draw) (d.layer === 0 ? get(d.unit).far : get(d.unit).near).push({ kind: "col", d });
    for (const d of b.decor) {
      if (d.d.front) get(d.unit).front.push(d);
      else (d.layer === 0 ? get(d.unit).far : get(d.unit).near).push({ kind: "deco", d });
    }
    this.groups = [...by.values()];
  }

  /** Paint -> colour for one unit, with per-body tint in crowds. */
  private paint(u: Unit, p: Paint, far: boolean): string {
    const k = `${u.id}|${p}|${far}`;
    const hit = this.colors.get(k);
    if (hit) return hit;
    const crowd = (this.battle?.specs[u.team].count ?? 1) > 3;
    const tint = (c: string, id: number, amt: number) => {
      if (!crowd) return c;
      const t = (((id * 2654435761) >>> 0) % 1000) / 1000;
      return t < 0.5 ? mix(c, BLACK, (0.5 - t) * amt) : mix(c, WHITE, (t - 0.5) * amt);
    };
    let body = tint(u.spec.colors.body, u.id, 0.5);
    const accent = tint(u.spec.colors.accent, u.id * 7 + 3, 0.9);
    const m = u.g.material;
    if (m === "metal") body = mix(body, [200, 208, 216], 0.35);
    if (m === "stone") body = mix(body, [128, 124, 118], 0.4);
    if (m === "ice") body = mix(body, [200, 240, 255], 0.5);
    if (m === "fire") body = mix(body, [255, 120, 30], 0.5);
    const base =
      FIXED[p] ??
      (p === "accent" ? accent : p === "dark" ? mix(body, BLACK, 0.5) : p === "hair" ? mix(accent, BLACK, 0.25) : p === "belly" ? mix(body, WHITE, 0.45)
        : p === "cape" ? mix(accent, BLACK, 0.3) : p === "membrane" ? mix(body, hex(accent), 0.35) : p === "shell" ? mix(accent, BLACK, 0.2) : body);
    const c = far ? mix(base, BLACK, 0.22) : base;
    this.colors.set(k, c);
    return c;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
  }

  private frame(b: Battle): void {
    let lo = Infinity, hi = -Infinity, top = 2;
    for (const u of b.units) {
      if (!u.alive && b.time - u.diedAt > 1.5) continue;
      const p = u.torso.translation();
      lo = Math.min(lo, p.x - u.spec.size);
      hi = Math.max(hi, p.x + u.spec.size);
      top = Math.max(top, p.y + u.spec.size);
    }
    if (!isFinite(lo)) [lo, hi] = [-8, 8];
    const w = this.canvas.width, h = this.canvas.height;
    const span = Math.max(7, hi - lo + 3);
    const scale = Math.min(w / span, (h * 0.62) / Math.max(3, top + 1));
    const k = this.cam.ready ? 0.06 : 1;
    this.cam.x += ((lo + hi) / 2 - this.cam.x) * k;
    this.cam.scale += (scale - this.cam.scale) * k;
    this.cam.ready = true;
  }

  render(b: Battle): void {
    if (b.version !== this.version) this.attach(b);
    this.frame(b);
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const s = this.cam.scale;
    const groundY = h * 0.84;
    const X = (x: number) => w / 2 + (x - this.cam.x) * s;
    const Y = (y: number) => groundY - y * s;
    this.view = { x: this.cam.x, scale: s, groundY, w, h };

    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, "#9ad0ec");
    sky.addColorStop(1, "#f6e7c8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, groundY);
    ctx.fillStyle = "#b7cf8a";
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = (i / 24) * w;
      const wx = this.cam.x * 0.3 + (px - w / 2) / (s * 0.5);
      const hy = groundY - (18 + 14 * Math.sin(wx * 0.35) + 8 * Math.sin(wx * 0.9 + 1)) * (s / 40);
      if (i === 0) ctx.moveTo(px, hy);
      else ctx.lineTo(px, hy);
    }
    ctx.lineTo(w, groundY);
    ctx.lineTo(0, groundY);
    ctx.fill();
    ctx.fillStyle = "#7fa650";
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = "#6a8f41";
    ctx.fillRect(0, groundY, w, Math.max(2, s * 0.06));
    for (const side of [-1, 1]) {
      const wx = X(side * b.arenaHalf);
      const x0 = side < 0 ? wx - s * 3 : wx;
      ctx.fillStyle = "#8f8a80";
      ctx.fillRect(x0, groundY - s * 6, s * 3, s * 6);
    }
    ctx.fillStyle = "rgba(30,40,20,0.22)";
    for (const u of b.units) {
      const p = u.torso.translation();
      const r = u.spec.size * 0.3 * s * Math.max(0.3, 1 - Math.max(0, p.y - u.bp.standY) / (u.spec.size * 3));
      ctx.beginPath();
      ctx.ellipse(X(p.x), groundY + 2, r, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const outline = Math.max(1.5, s * 0.025);
    const crowdFx = b.units.length < 40;
    for (const alive of [false, true]) {
      for (const gd of this.groups) {
        const u = gd.u;
        if (u.alive !== alive || this.hideUnit(u)) continue;
        const m = u.g.material;
        ctx.globalAlpha = m === "ghost" ? 0.55 + 0.1 * Math.sin(b.time * 4 + u.id) : m === "slime" ? 0.85 : 1;
        const tint = this.tintOf(u);
        for (const layer of [gd.far, gd.near]) {
          for (const it of layer) this.item(it, X, Y, s, outline, true, alive, tint);
          if ((m === "fire" || m === "ice") && crowdFx && alive) {
            ctx.shadowColor = m === "fire" ? "#ff8a1f" : "#9ee7ff";
            ctx.shadowBlur = s * 0.35;
          }
          for (const it of layer) this.item(it, X, Y, s, outline, false, alive, tint);
          ctx.shadowBlur = 0;
        }
        for (const d of gd.front) this.item({ kind: "deco", d }, X, Y, s, outline, false, alive, tint);
        ctx.globalAlpha = 1;
        if (alive && crowdFx) this.statusFx(u, X, Y, s, b.time);
      }
    }

    for (const sh of b.shots) this.shot(sh, X, Y, s);
    for (const f of b.fx) {
      const k = f.t / 0.6;
      ctx.globalAlpha = 1 - k;
      if (f.kind === "boom") {
        ctx.fillStyle = "#ffb347";
        ctx.beginPath();
        ctx.arc(X(f.x), Y(f.y), f.r * s * (0.3 + k), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff4c0";
        ctx.beginPath();
        ctx.arc(X(f.x), Y(f.y), f.r * s * 0.5 * (0.3 + k), 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === "heal") {
        ctx.fillStyle = "#8fe35a";
        ctx.font = `${Math.max(10, f.r * s)}px sans-serif`;
        ctx.fillText("+", X(f.x), Y(f.y + k * f.r * 2));
      } else {
        ctx.strokeStyle = f.kind === "puff" ? "#e9e2cf" : f.kind === "split" ? "#8fe35a" : DCOL[f.color];
        ctx.lineWidth = Math.max(2, s * 0.05) * (1 - k);
        ctx.beginPath();
        ctx.arc(X(f.x), Y(f.y), Math.max(4, f.r * s * (0.4 + k)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    for (const u of b.units) {
      if (!u.alive || b.specs[u.team].count > 5) continue;
      const hp = Math.max(0, u.health / u.maxHealth);
      const head = (u.bodies.get(u.bp.head) ?? u.torso).translation();
      const bw = Math.max(30, u.spec.size * 0.6 * s);
      const bx = X(head.x) - bw / 2, by = Y(head.y + u.spec.size * 0.3) - 6;
      ctx.fillStyle = "rgba(20,16,24,0.55)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = hp > 0.5 ? "#7ddc6a" : hp > 0.25 ? "#f2c14e" : "#e5533d";
      ctx.fillRect(bx, by, bw * hp, 5);
    }
  }

  private tintOf(u: Unit): [RGB, number] | null {
    for (const k of ["freeze", "shock", "burn", "poison", "corrode"] as Status[]) if (u.status[k] && STATUS_TINT[k]) return STATUS_TINT[k]!;
    return null;
  }

  private item(it: Item, X: (x: number) => number, Y: (y: number) => number, s: number, outline: number, line: boolean, alive: boolean, tint: [RGB, number] | null): void {
    const ctx = this.ctx;
    let shape: DecoShape, x: number, y: number, a: number, paint: Paint, unit: Unit, far: boolean;
    let pts: [number, number][] | null = null;
    if (it.kind === "col") {
      const c = it.d.collider, t = c.translation();
      shape = it.d.bp.shape;
      x = X(t.x);
      y = Y(t.y);
      a = c.rotation();
      paint = it.d.bp.paint;
      unit = it.d.unit;
      far = it.d.layer === 0;
    } else {
      const { body, d } = it.d;
      const t = body.translation(), A = body.rotation();
      const ca = Math.cos(A), sa = Math.sin(A);
      shape = d.shape;
      paint = d.paint;
      unit = it.d.unit;
      far = it.d.layer === 0;
      x = X(t.x + d.offset[0] * ca - d.offset[1] * sa);
      y = Y(t.y + d.offset[0] * sa + d.offset[1] * ca);
      a = A + d.rot;
      if (shape.kind === "tri") {
        const cr = Math.cos(d.rot), sr = Math.sin(d.rot);
        pts = shape.pts.map(([px, py]) => {
          const lx = d.offset[0] + px * cr - py * sr, ly = d.offset[1] + px * sr + py * cr;
          return [X(t.x + lx * ca - ly * sa), Y(t.y + lx * sa + ly * ca)];
        });
      }
      if (paint === "eye" || paint === "glow") {
        if (line || shape.kind !== "ball") {
          if (!line && shape.kind !== "ball") this.fillShape(shape, x, y, a, s, paint === "glow" ? "#fff4a8" : "#fff", pts);
          return;
        }
        this.eye(x, y, shape.r * s, unit.facing, alive, paint === "glow");
        return;
      }
      if (paint === "shine") {
        if (!line && alive && shape.kind === "ball") {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          ctx.arc(x, y, shape.r * s, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
    }
    let c = this.paint(unit, paint, far);
    if (!alive) c = mix(c, GREY, 0.55);
    else if (tint) c = mix(c, tint[0], tint[1]);
    if (line) this.fillShape(shape, x, y, a, s, mix(c, BLACK, 0.6), pts, outline);
    else this.fillShape(shape, x, y, a, s, c, pts);
  }

  /** Fills a shape; with `grow` > 0 it is expanded by that many pixels (the outline pass). */
  private fillShape(sh: DecoShape, x: number, y: number, a: number, s: number, color: string, pts: [number, number][] | null, grow = 0): void {
    const ctx = this.ctx;
    if (sh.kind === "capsule") {
      const dx = -Math.sin(a) * sh.hh * s, dy = -Math.cos(a) * sh.hh * s;
      ctx.strokeStyle = color;
      ctx.lineWidth = sh.r * 2 * s + grow * 2;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    } else if (sh.kind === "ball") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, sh.r * s + grow, 0, Math.PI * 2);
      ctx.fill();
    } else if (sh.kind === "box") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-a);
      ctx.fillStyle = color;
      ctx.fillRect(-sh.hx * s - grow, -sh.hy * s - grow, sh.hx * 2 * s + grow * 2, sh.hy * 2 * s + grow * 2);
      ctx.restore();
    } else if (pts) {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      if (grow) {
        ctx.lineWidth = grow * 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  private eye(ex: number, ey: number, er: number, facing: number, alive: boolean, glow: boolean): void {
    const ctx = this.ctx;
    er = Math.max(1.5, er);
    if (!alive) {
      ctx.strokeStyle = "#141018";
      ctx.lineWidth = Math.max(1, er * 0.45);
      ctx.beginPath();
      ctx.moveTo(ex - er, ey - er);
      ctx.lineTo(ex + er, ey + er);
      ctx.moveTo(ex + er, ey - er);
      ctx.lineTo(ex - er, ey + er);
      ctx.stroke();
      return;
    }
    if (glow) {
      ctx.shadowColor = "#fff27a";
      ctx.shadowBlur = er * 3;
      ctx.fillStyle = "#fff6b0";
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    ctx.fillStyle = "#141018";
    ctx.beginPath();
    ctx.arc(ex, ey, er * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#141018";
    ctx.beginPath();
    ctx.arc(ex + facing * er * 0.35, ey, er * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  private statusFx(u: Unit, X: (x: number) => number, Y: (y: number) => number, s: number, t: number): void {
    const ctx = this.ctx;
    const p = u.torso.translation();
    const S = u.spec.size;
    if (u.status.burn || u.g.material === "fire") {
      for (let i = 0; i < 4; i++) {
        const ph = (t * 1.7 + i * 0.27 + u.id * 0.13) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = i % 2 ? "#ffb347" : "#ff6a1f";
        ctx.beginPath();
        ctx.arc(X(p.x + Math.sin(i * 2.1 + t * 3) * S * 0.25), Y(p.y + S * 0.2 + ph * S * 0.5), Math.max(2, S * s * 0.07 * (1 - ph)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (u.status.poison || u.status.corrode) {
      ctx.fillStyle = "#8fe35a";
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.9 + i / 3) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath();
        ctx.arc(X(p.x + (i - 1) * S * 0.2), Y(p.y + S * 0.3 + ph * S * 0.4), Math.max(2, S * s * 0.04), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (u.status.shock) {
      ctx.strokeStyle = "#ffe84a";
      ctx.lineWidth = Math.max(1.5, s * 0.03);
      ctx.beginPath();
      let x = p.x - S * 0.4, y = p.y + S * 0.3;
      ctx.moveTo(X(x), Y(y));
      for (let i = 0; i < 5; i++) {
        x += S * 0.2;
        y += (i % 2 ? 1 : -1) * S * 0.15 * Math.sin(t * 30 + i);
        ctx.lineTo(X(x), Y(y));
      }
      ctx.stroke();
    }
    if (u.status.web) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = Math.max(1, s * 0.015);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(X(p.x - S * 0.4), Y(p.y - S * 0.3 + i * S * 0.2));
        ctx.lineTo(X(p.x + S * 0.4), Y(p.y + S * 0.3 - i * S * 0.2));
        ctx.stroke();
      }
    }
  }

  private shot(sh: Shot, X: (x: number) => number, Y: (y: number) => number, s: number): void {
    const ctx = this.ctx;
    const x = X(sh.x), y = Y(sh.y), r = Math.max(2, sh.r * s);
    const age = 1 - sh.life / ((sh.rule.range * 1.3) / sh.rule.speed);
    switch (sh.kind) {
      case "fire_breath":
      case "ice_breath":
      case "poison_spray": {
        const c = sh.kind === "fire_breath" ? ["#fff1a8", "#ff8a1f", "#c53a12"] : sh.kind === "ice_breath" ? ["#ffffff", "#9ee7ff", "#4aa8d8"] : ["#e2ffc4", "#8fe35a", "#3f8f2a"];
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * (1 + age * 1.8));
        g.addColorStop(0, c[0]);
        g.addColorStop(0.5, c[1]);
        g.addColorStop(1, c[2] + "00");
        ctx.fillStyle = g;
        ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
        ctx.beginPath();
        ctx.arc(x, y, r * (1 + age * 1.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      case "laser":
      case "lightning": {
        ctx.strokeStyle = sh.kind === "laser" ? "#ff4d4d" : "#fff27a";
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = r * 3;
        ctx.lineWidth = r * 1.6;
        ctx.beginPath();
        ctx.moveTo(X(sh.x - sh.vx * 0.05), Y(sh.y - sh.vy * 0.05));
        if (sh.kind === "lightning") ctx.lineTo(X(sh.x - sh.vx * 0.025) + r * 2, Y(sh.y - sh.vy * 0.025) - r * 2);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        return;
      }
      case "shoot":
        ctx.strokeStyle = "#2a2a2e";
        ctx.lineWidth = r * 1.5;
        ctx.beginPath();
        ctx.moveTo(X(sh.x - sh.vx * 0.02), Y(sh.y - sh.vy * 0.02));
        ctx.lineTo(x, y);
        ctx.stroke();
        return;
      default:
        ctx.fillStyle = sh.kind === "throw_rock" ? "#8f8a80" : sh.kind === "web" ? "#f4f4f4" : "#b7e04a";
        ctx.strokeStyle = "rgba(20,16,24,0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
  }
}
