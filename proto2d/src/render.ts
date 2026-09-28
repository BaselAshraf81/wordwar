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

/** Soft radial puff, rendered once per kind; breath streams draw it instead of building gradients per particle. */
const puffs = new Map<string, HTMLCanvasElement>();
function puff(kind: string): HTMLCanvasElement {
  let c = puffs.get(kind);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const cols = kind === "fire_breath" ? ["#fff1a8", "#ff8a1f", "#c53a12"] : kind === "ice_breath" ? ["#ffffff", "#9ee7ff", "#4aa8d8"] : ["#e2ffc4", "#8fe35a", "#3f8f2a"];
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, cols[0]);
  gr.addColorStop(0.5, cols[1]);
  gr.addColorStop(1, cols[2] + "00");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  puffs.set(kind, c);
  return c;
}
/** Clockwise arc segment (subpaths all wind the same way so batched overlaps union). */
function arcPoly(ctx: CanvasPath, x: number, y: number, r: number, a0: number, sweep: number): void {
  ctx.arc(x, y, r, a0, a0 + sweep);
}
/** A closed circle as its own subpath. */
function circlePoly(ctx: CanvasPath, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

/** Armies bigger than this are drawn pass by pass across the whole team instead of unit by unit. */
const CROWD_BATCH = 12;
interface SinkEntry {
  style: string;
  path: Path2D;
  stroke: number;
}
type Item = ({ kind: "col"; d: DrawCollider } | { kind: "deco"; d: DrawDeco }) & { cache?: Map<unknown, [string, string]> };
interface UnitDraw {
  u: Unit;
  far: Item[];
  near: Item[];
  front: Item[];
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
    // CPU-backed canvas: thousands of small curved fills rasterise far faster on the CPU than they
    // tessellate on an integrated GPU (measured: 33 ms -> 16.7 ms frames for 100-unit fights).
    this.ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: !location.search.includes("gpu") })!;
  }

  attach(b: Battle): void {
    if (this.battle !== b) this.cam.ready = false;
    this.battle = b;
    this.version = b.version;
    this.colors.clear();
    this.lines.clear();
    const by = new Map<Unit, UnitDraw>();
    const get = (u: Unit) => by.get(u) ?? (by.set(u, { u, far: [], near: [], front: [] }), by.get(u)!);
    for (const d of b.draw) (d.layer === 0 ? get(d.unit).far : get(d.unit).near).push({ kind: "col", d });
    for (const d of b.decor) {
      if (d.d.front) get(d.unit).front.push({ kind: "deco", d });
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
      // Five shades, not a unique one per body: batched crowds then need only a few fills per colour.
      const t = ((((id * 2654435761) >>> 0) % 5) + 0.5) / 5;
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

  /** Render-resolution multiplier, lowered by the main loop when frames run long. */
  quality = 1;

  resize(): void {
    // Pixel budget: sharp enough, but a 3x phone screen would triple the fill cost for nothing.
    const small = Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const dpr = Math.min(small ? 1.25 : 1.5, window.devicePixelRatio || 1) * this.quality;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.cam.ready = false; // same framing at the new pixel size, no zoom drift
  }

  private frame(b: Battle): void {
    // Frame the action, not the stragglers: in a crowd, the outer 10% on each side (fleeing,
    // flung or flying units) may leave the shot, which keeps narrow phone screens zoomed in.
    let lo = Infinity, hi = -Infinity, top = 2;
    for (const team of [0, 1]) {
      const xs: [number, number][] = [];
      for (const u of b.units) {
        if (u.team !== team || (!u.alive && b.time - u.diedAt > 1.5)) continue;
        const p = u.torso.translation();
        xs.push([p.x - u.spec.size, p.x + u.spec.size]);
        top = Math.max(top, Math.min(p.y, u.bp.standY * 3 + u.spec.size) + u.spec.size);
      }
      if (!xs.length) continue;
      const trim = xs.length > 10 ? Math.floor(xs.length * 0.1) : 0;
      const l = xs.map((v) => v[0]).sort((a, c) => a - c), r = xs.map((v) => v[1]).sort((a, c) => a - c);
      lo = Math.min(lo, l[trim]);
      hi = Math.max(hi, r[r.length - 1 - trim]);
    }
    if (!isFinite(lo)) [lo, hi] = [-8, 8];
    const w = this.canvas.width, h = this.canvas.height;
    const span = Math.max(7, hi - lo + 3);
    const fitAll = w / span;
    const fitTall = (h * 0.62) / Math.max(3, top + 1);
    // Readability floor: the biggest creature should stay a decent fraction of the stage height.
    // Wide screens rarely hit it; on a phone, fitting a 100-man army edge to edge makes everyone
    // specks, so there we zoom in on the front line, where the two armies actually meet.
    let biggest = 0.5, f0 = -Infinity, f1 = Infinity;
    for (const u of b.units) {
      if (!u.alive) continue;
      biggest = Math.max(biggest, u.spec.size);
      const x = u.torso.translation().x;
      if (u.team === 0) f0 = Math.max(f0, x);
      else f1 = Math.min(f1, x);
    }
    const narrow = this.canvas.clientWidth < 700;
    const floor = (h * (narrow ? 0.3 : 0.12)) / biggest;
    // Never zoom past the point where both front lines are in view (before contact that is the
    // whole gap between the armies, so the zoom tightens as they close in).
    const fronts = isFinite(f0) && isFinite(f1) ? w / (Math.abs(f1 - f0) + biggest * 1.8 + 1.5) : Infinity;
    const scale = Math.min(fitTall, Math.max(fitAll, Math.min(floor, fronts)));
    let cx = (lo + hi) / 2;
    if (scale > fitAll * 1.02) {
      const front = isFinite(f0) && isFinite(f1) ? (f0 + f1) / 2 : cx;
      const half = w / scale / 2 - 1;
      cx = half * 2 < hi - lo ? Math.min(hi - half, Math.max(lo + half, front)) : cx;
    }
    const k = this.cam.ready ? 0.06 : 1;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.scale += (scale - this.cam.scale) * k;
    // Height of the action (tallest living fighter's torso plus a bit), for vertical centring.
    let act = 1;
    for (const u of b.units) if (u.alive) act = Math.max(act, Math.min(u.torso.translation().y, u.bp.standY * 2.5) + u.spec.size * 0.35);
    this.cam.y += (act - this.cam.y) * k;
    this.cam.ready = true;
  }

  render(b: Battle): void {
    if (b.version !== this.version) this.attach(b);
    this.frame(b);
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const s = this.cam.scale;
    // Tall (portrait) stages: centre the action vertically instead of leaving a sky of empty space.
    // The scoreboard covers the top ~20%, so "centre" is the middle of what's left.
    const groundY = h > w * 1.1 ? Math.min(h * 0.82, Math.max(h * 0.6, h * 0.64 + (this.cam.y * s) / 2)) : h * 0.84;
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
    ctx.beginPath();
    for (const u of b.units) {
      const p = u.torso.translation();
      const r = u.spec.size * 0.3 * s * Math.max(0.3, 1 - Math.max(0, p.y - u.bp.standY) / (u.spec.size * 3));
      ctx.moveTo(X(p.x) + r, groundY + 2);
      ctx.ellipse(X(p.x), groundY + 2, r, r * 0.18, 0, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const outline = Math.max(1.5, s * 0.025);
    const crowdFx = b.units.length < 40;
    const batched = [0, 1].map((t) => b.specs[t].count > CROWD_BATCH);
    for (const alive of [false, true]) {
      for (const team of [0, 1] as const) {
        if (batched[team]) this.crowd(this.groups.filter((gd) => gd.u.team === team && gd.u.alive === alive && !this.hideUnit(gd.u)), alive, X, Y, s, outline);
      }
      for (const gd of this.groups) {
        const u = gd.u;
        if (batched[u.team] || u.alive !== alive || this.hideUnit(u)) continue;
        const m = u.g.material;
        ctx.globalAlpha = m === "ghost" ? 0.55 + 0.1 * Math.sin(b.time * 4 + u.id) : m === "slime" ? 0.85 : 1;
        const tint = this.tintOf(u);
        for (const layer of [gd.far, gd.near]) {
          for (const it of layer) this.item(it, X, Y, s, outline, true, alive, tint);
          this.flush();

          for (const it of layer) this.item(it, X, Y, s, outline, false, alive, tint);
          this.flush();
        }
        for (const it of gd.front) this.item(it, X, Y, s, outline, false, alive, tint);
        this.flush();
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
        this.flush();
        this.eye(x, y, shape.r * s, unit.facing, alive, paint === "glow");
        return;
      }
      if (paint === "shine") {
        if (!line && alive && shape.kind === "ball" && this.eyeSink) {
          circlePoly(this.sinkPath(this.eyeSink, "shine", "rgba(255,255,255,0.35)"), x, y, shape.r * s);
        } else if (!line && alive && shape.kind === "ball") {
          this.flush();
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          circlePoly(ctx, x, y, shape.r * s);
          ctx.fill();
        }
        return;
      }
    }
    const state = alive ? (tint ?? "live") : "dead";
    const cache = (it.cache ??= new Map());
    let v = cache.get(state);
    if (!v) cache.set(state, (v = this.variant(unit, paint, far, state)));
    this.fillShape(shape, x, y, a, s, line ? this.lineOf(unit, state) : v[0], pts, line ? outline : 0);
  }

  /** One outline colour per creature and state, so the whole silhouette outline is a single fill. */
  private lines = new Map<Unit, Map<unknown, string>>();
  private lineOf(u: Unit, state: "live" | "dead" | [RGB, number]): string {
    let m = this.lines.get(u);
    if (!m) this.lines.set(u, (m = new Map()));
    let c = m.get(state);
    if (!c) m.set(state, (c = mix(this.variant(u, "body", false, state)[0], BLACK, 0.62)));
    return c;
  }

  /** [fill, outline] for a paint in a state, cached: no colour maths or string building per frame. */
  private variant(u: Unit, p: Paint, far: boolean, state: "live" | "dead" | [RGB, number]): [string, string] {
    let c = this.paint(u, p, far);
    if (state === "dead") c = mix(c, GREY, 0.55);
    else if (state !== "live") c = mix(c, state[0], state[1]);
    return [c, mix(c, BLACK, 0.6)];
  }

  // ---- batched fills: consecutive shapes of one colour become one path, one fill call ----
  private bColor = "";
  private bOpen = false;
  private begin(color: string): void {
    if (color === this.bColor && this.bOpen) return;
    this.flush();
    this.ctx.beginPath();
    this.bColor = color;
    this.bOpen = true;
  }
  flush(): void {
    if (!this.bOpen) return;
    this.ctx.fillStyle = this.bColor;
    this.ctx.fill();
    this.bOpen = false;
  }

  /** Appends a shape (grown by `grow` px for the outline pass) to the current batch. All subpaths wind clockwise so overlaps union. */
  private fillShape(sh: DecoShape, x: number, y: number, a: number, s: number, color: string, pts: [number, number][] | null, grow = 0): void {
    let ctx: CanvasPath;
    if (this.sink) ctx = this.sinkPath(this.sink, color, color);
    else {
      this.begin(color);
      ctx = this.ctx;
    }
    if (sh.kind === "capsule") {
      const dx = -Math.sin(a) * sh.hh * s, dy = -Math.cos(a) * sh.hh * s;
      const R = sh.r * s + grow;
      const th = Math.atan2(2 * dy, 2 * dx);
      const x1 = x - dx, y1 = y - dy, x2 = x + dx, y2 = y + dy;
      ctx.moveTo(x2 + Math.cos(th - Math.PI / 2) * R, y2 + Math.sin(th - Math.PI / 2) * R);
      arcPoly(ctx, x2, y2, R, th - Math.PI / 2, Math.PI);
      arcPoly(ctx, x1, y1, R, th + Math.PI / 2, Math.PI);
      ctx.closePath();
    } else if (sh.kind === "ball") {
      circlePoly(ctx, x, y, sh.r * s + grow);
    } else if (sh.kind === "box") {
      const hx = sh.hx * s + grow, hy = sh.hy * s + grow;
      const c = Math.cos(-a), sn = Math.sin(-a);
      const P = (u: number, v: number) => [x + u * c - v * sn, y + u * sn + v * c] as const;
      const q = [P(-hx, -hy), P(hx, -hy), P(hx, hy), P(-hx, hy)];
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
    } else if (pts) {
      let p = pts;
      const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
      if (area < 0) p = [p[0], p[2], p[1]];
      if (grow) {
        const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
        p = p.map(([px, py]) => {
          const d = Math.hypot(px - cx, py - cy) || 1;
          return [px + ((px - cx) / d) * grow * 1.6, py + ((py - cy) / d) * grow * 1.6] as [number, number];
        });
      }
      ctx.moveTo(p[0][0], p[0][1]);
      ctx.lineTo(p[1][0], p[1][1]);
      ctx.lineTo(p[2][0], p[2][1]);
      ctx.closePath();
    }
  }
  // ---- crowd batching: a whole army's shapes of one colour go into one Path2D and one fill ----
  // Hundreds of small fills per frame cost far more to rasterise than a few large ones.
  private sink: Map<string, SinkEntry> | null = null;
  private eyeSink: Map<string, SinkEntry> | null = null;
  private sinkPath(m: Map<string, SinkEntry>, key: string, style: string, stroke = 0): Path2D {
    let e = m.get(key);
    if (!e) m.set(key, (e = { style, path: new Path2D(), stroke }));
    return e.path;
  }
  private drain(m: Map<string, SinkEntry>): void {
    const ctx = this.ctx;
    for (const e of m.values()) {
      if (e.stroke) {
        ctx.strokeStyle = e.style;
        ctx.lineWidth = e.stroke;
        ctx.stroke(e.path);
      } else {
        ctx.fillStyle = e.style;
        ctx.fill(e.path);
      }
    }
    m.clear();
  }

  /** Every unit of one crowd team and one state, drawn pass by pass across the whole army. */
  private crowd(units: UnitDraw[], alive: boolean, X: (x: number) => number, Y: (y: number) => number, s: number, outline: number): void {
    if (!units.length) return;
    const ctx = this.ctx;
    const m = units[0].u.g.material;
    ctx.globalAlpha = m === "ghost" ? 0.6 : m === "slime" ? 0.85 : 1;
    const sink = new Map<string, SinkEntry>();
    this.eyeSink = new Map();
    for (const layer of ["far", "near", "front"] as const) {
      for (const line of layer === "front" ? [false] : [true, false]) {
        this.sink = sink;
        for (const gd of units) {
          const tint = this.tintOf(gd.u);
          for (const it of gd[layer]) this.item(it, X, Y, s, outline, line, alive, tint);
        }
        this.sink = null;
        this.drain(sink);
      }
      // Eyes with their own depth layer: far-side eyes must not show through near-side bodies.
      this.drain(this.eyeSink);
    }
    this.eyeSink = null;
    ctx.globalAlpha = 1;
  }

  private eye(ex: number, ey: number, er: number, facing: number, alive: boolean, glow: boolean): void {
    const ctx = this.ctx;
    er = Math.max(1.5, er);
    const es = this.eyeSink;
    if (es) {
      if (!alive) {
        const p = this.sinkPath(es, "x", "#141018", Math.max(1, er * 0.45));
        p.moveTo(ex - er, ey - er);
        p.lineTo(ex + er, ey + er);
        p.moveTo(ex + er, ey - er);
        p.lineTo(ex - er, ey + er);
      } else if (glow) {
        circlePoly(this.sinkPath(es, "halo", "rgba(255,240,120,0.35)"), ex, ey, er * 2.2);
        circlePoly(this.sinkPath(es, "core", "#fff6b0"), ex, ey, er);
      } else {
        circlePoly(this.sinkPath(es, "ring", "#141018"), ex, ey, er * 1.2);
        circlePoly(this.sinkPath(es, "white", "#fff"), ex, ey, er);
        circlePoly(this.sinkPath(es, "pupil", "#141018"), ex + facing * er * 0.35, ey, er * 0.55);
      }
      return;
    }
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
      ctx.fillStyle = "rgba(255,240,120,0.35)";
      ctx.beginPath();
      circlePoly(ctx, ex, ey, er * 2.2);
      ctx.fill();
      ctx.fillStyle = "#fff6b0";
      ctx.beginPath();
      circlePoly(ctx, ex, ey, er);
      ctx.fill();
      return;
    }
    ctx.fillStyle = "#141018";
    ctx.beginPath();
    circlePoly(ctx, ex, ey, er * 1.2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    circlePoly(ctx, ex, ey, er);
    ctx.fill();
    ctx.fillStyle = "#141018";
    ctx.beginPath();
    circlePoly(ctx, ex + facing * er * 0.35, ey, er * 0.55);
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
        const R = r * (1 + age * 1.8);
        ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
        ctx.drawImage(puff(sh.kind), x - R, y - R, R * 2, R * 2);
        ctx.globalAlpha = 1;
        return;
      }
      case "laser":
      case "lightning": {
        ctx.strokeStyle = sh.kind === "laser" ? "#ff4d4d" : "#fff27a";
        ctx.lineWidth = r * 1.6;
        ctx.beginPath();
        ctx.moveTo(X(sh.x - sh.vx * 0.05), Y(sh.y - sh.vy * 0.05));
        if (sh.kind === "lightning") ctx.lineTo(X(sh.x - sh.vx * 0.025) + r * 2, Y(sh.y - sh.vy * 0.025) - r * 2);
        ctx.lineTo(x, y);
        ctx.stroke();
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
