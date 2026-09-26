// Canvas renderer. Reads physics state; never writes it.
import { decodeLabels, type ArtRig } from "./art/rigs";
import type { Battle, DrawArt, DrawCollider, DrawDeco, Unit } from "./sim/battle";
import type { DecoShape, Paint } from "./sim/plans";

type RGB = [number, number, number];
const hex = (c: string): RGB => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
const mixRgb = (c: string, to: RGB, t: number): RGB => {
  const [r, g, b] = hex(c);
  return [r + (to[0] - r) * t, g + (to[1] - g) * t, b + (to[2] - b) * t];
};
const mix = (c: string, to: RGB, t: number) => toHex(mixRgb(c, to, t));
const BLACK: RGB = [20, 16, 24];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [120, 118, 125];
const FIXED: Partial<Record<Paint, string>> = { metal: "#cfd6dd", bone: "#f1e9d2", red: "#d94a4a" };

type Item =
  | { kind: "col"; d: DrawCollider; unit: Unit; key: number }
  | { kind: "deco"; d: DrawDeco; unit: Unit; key: number }
  | { kind: "art"; d: DrawArt; unit: Unit; key: number };

/** Emoji art cut into body/head/tail canvases, rendered at UP x the rig resolution. */
const UP = 4;
interface ArtCut {
  pieces: ({ c: ImageBitmap; x: number; y: number } | null)[];
  legColor: string;
}
const artCache = new Map<string, Promise<ArtCut>>();
const artReady = new Map<string, ArtCut>();

function loadArt(rig: ArtRig): Promise<ArtCut> {
  let p = artCache.get(rig.id);
  if (p) return p;
  p = new Promise<ArtCut>((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      const N = rig.res * UP;
      const full = document.createElement("canvas");
      full.width = full.height = N;
      const fc = full.getContext("2d", { willReadFrequently: true })!;
      fc.drawImage(img, 0, 0, N, N);
      const src = fc.getImageData(0, 0, N, N);
      const labels = decodeLabels(rig);
      const out = [1, 2, 3].map(() => new ImageData(N, N));
      let lr = 0, lg = 0, lb = 0, ln = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        if (src.data[i + 3] === 0) continue;
        const L = labels[Math.floor(y / UP) * rig.res + Math.floor(x / UP)];
        if (L === 0) {
          // Pixels below the belly: the drawn legs. Their colour paints the physics legs.
          if (src.data[i + 3] > 200) { lr += src.data[i]; lg += src.data[i + 1]; lb += src.data[i + 2]; ln++; }
          continue;
        }
        out[L - 1].data.set(src.data.subarray(i, i + 4), i);
      }
      // Each piece keeps only its own box (plus a pixel of margin), so drawing is cheap.
      const pieces = await Promise.all(out.map(async (d, k) => {
        const b = rig.pieces[k];
        if (!b) return null;
        const x = Math.max(0, b[0] * UP - UP), y = Math.max(0, b[1] * UP - UP);
        const w = Math.min(N - x, (b[2] - b[0] + 3) * UP), h = Math.min(N - y, (b[3] - b[1] + 3) * UP);
        return { c: await createImageBitmap(d, x, y, w, h), x, y };
      }));
      const legColor = ln ? toHex([lr / ln, lg / ln, lb / ln]) : "#6b5a4a";
      const cut = { pieces, legColor };
      artReady.set(rig.id, cut);
      resolve(cut);
    };
    img.onerror = reject;
    img.src = `/emoji/${rig.cp}.svg`;
  });
  artCache.set(rig.id, p);
  return p;
}
interface Colors {
  fill: string;
  line: string;
  dead: string;
  deadLine: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cam = { x: 0, y: 3, scale: 40, ready: false };
  private items: Item[] = [];
  private colors = new Map<string, Colors>();
  private battle: Battle | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  attach(b: Battle): void {
    this.battle = b;
    this.cam.ready = false;
    this.colors.clear();
    const items: Item[] = [];
    for (const d of b.draw) items.push({ kind: "col", d, unit: d.unit, key: d.layer * 3 + 1 });
    for (const d of b.decor) items.push({ kind: "deco", d, unit: d.unit, key: d.layer * 3 + (d.d.front ? 2 : 0) });
    // Art sits on the body layer: tail behind body behind head.
    for (const d of b.art) items.push({ kind: "art", d, unit: d.unit, key: 1 * 3 + 1 + (d.label === 3 ? -0.2 : d.label === 2 ? 0.2 : 0) });
    for (const d of b.art) loadArt(d.layout.rig).then(() => this.colors.clear()).catch(() => {});
    this.items = items.sort((a, c) => a.key - c.key);
  }

  /** Paint -> colours for one unit, with per-body tint in crowds so 100 men aren't one sprite. */
  private paint(u: Unit, p: Paint, layer: number): Colors {
    const k = `${u.id}|${p}|${layer}`;
    const hit = this.colors.get(k);
    if (hit) return hit;
    const crowd = (this.battle?.specs[u.team].count ?? 1) > 3;
    const tint = (c: string, id: number, amt: number) => {
      if (!crowd) return c;
      const t = (((id * 2654435761) >>> 0) % 1000) / 1000;
      return t < 0.5 ? mix(c, BLACK, (0.5 - t) * amt) : mix(c, WHITE, (t - 0.5) * amt);
    };
    const body = tint(u.spec.colors.body, u.id, 0.5);
    const accent = tint(u.spec.colors.accent, u.id * 7 + 3, 0.9);
    const cut = u.bp.art ? artReady.get(u.bp.art.rig.id) : undefined;
    const base = cut && p === "dark" ? cut.legColor : FIXED[p] ?? (p === "accent" ? accent : p === "dark" ? mix(body, BLACK, 0.55) : body);
    const far = layer === 0 ? 0.22 : 0;
    const c: Colors = {
      fill: mix(base, BLACK, far),
      line: mix(base, BLACK, 0.55 + far * 0.5),
      dead: mix(base, GREY, 0.55),
      deadLine: mix(base, BLACK, 0.7),
    };
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
    const cx = (lo + hi) / 2;
    const k = this.cam.ready ? 0.06 : 1;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.scale += (scale - this.cam.scale) * k;
    this.cam.ready = true;
  }

  render(b: Battle): void {
    this.frame(b);
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const s = this.cam.scale;
    const groundY = h * 0.84;
    const X = (x: number) => w / 2 + (x - this.cam.x) * s;
    const Y = (y: number) => groundY - y * s;

    // Sky and ground.
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
    // Arena edges: rock cliffs, rarely in view.
    for (const side of [-1, 1]) {
      const wx = X(side * b.arenaHalf);
      const x0 = side < 0 ? wx - s * 3 : wx;
      ctx.fillStyle = "#8f8a80";
      ctx.fillRect(x0, groundY - s * 6, s * 3, s * 6);
      ctx.fillStyle = "#77726a";
      ctx.fillRect(x0, groundY - s * 6, s * 3, s * 0.4);
    }

    // Shadows.
    ctx.fillStyle = "rgba(30,40,20,0.22)";
    for (const u of b.units) {
      const p = u.torso.translation();
      const r = u.spec.size * 0.3 * s;
      ctx.beginPath();
      ctx.ellipse(X(p.x), groundY + 2, r, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const outline = Math.max(1.5, s * 0.025);
    // Dead bodies first, then the living on top.
    for (const pass of [false, true]) {
      for (const it of this.items) {
        if (it.unit.alive !== pass) continue;
        if (it.kind === "art") {
          this.drawArt(it.d, X, Y, s, pass);
          continue;
        }
        if (it.kind === "col") {
          const { collider: c, bp } = it.d;
          if (it.d.hidden && (!it.unit.bp.art || artReady.has(it.unit.bp.art.rig.id))) continue;
          const t = c.translation();
          const col = this.paint(it.unit, bp.paint, it.d.layer);
          this.shape(bp.shape, X(t.x), Y(t.y), c.rotation(), s, pass ? col.fill : col.dead, pass ? col.line : col.deadLine, outline);
          if (it.d.eye && bp.shape.kind === "ball") this.ballEye(X(t.x), Y(t.y), bp.shape.r * s, c.rotation(), it.unit.facing, pass);
        } else {
          const { body, d } = it.d;
          const t = body.translation();
          const A = body.rotation();
          const ca = Math.cos(A), sa = Math.sin(A);
          const wx = t.x + d.offset[0] * ca - d.offset[1] * sa;
          const wy = t.y + d.offset[0] * sa + d.offset[1] * ca;
          if (d.paint === "eye" && d.shape.kind === "ball") {
            this.eye(X(wx), Y(wy), d.shape.r * s, it.unit.facing, pass);
            continue;
          }
          if (d.paint === "shine") {
            if (!pass || d.shape.kind !== "ball") continue;
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.beginPath();
            ctx.arc(X(wx), Y(wy), d.shape.r * s, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          const col = this.paint(it.unit, d.paint, it.d.layer);
          const ang = A + d.rot;
          if (d.shape.kind === "tri") {
            // Triangle points are body-local; rotate by deco rot, then by the body.
            const cr = Math.cos(d.rot), sr = Math.sin(d.rot);
            ctx.beginPath();
            d.shape.pts.forEach(([px, py], i) => {
              const lx = d.offset[0] + px * cr - py * sr, ly = d.offset[1] + px * sr + py * cr;
              const qx = X(t.x + lx * ca - ly * sa), qy = Y(t.y + lx * sa + ly * ca);
              if (i === 0) ctx.moveTo(qx, qy);
              else ctx.lineTo(qx, qy);
            });
            ctx.closePath();
            ctx.lineWidth = outline * 2;
            ctx.strokeStyle = pass ? col.line : col.deadLine;
            ctx.stroke();
            ctx.fillStyle = pass ? col.fill : col.dead;
            ctx.fill();
          } else {
            this.shape(d.shape, X(wx), Y(wy), ang, s, pass ? col.fill : col.dead, pass ? col.line : col.deadLine, outline);
          }
        }
      }
    }

    // Health bars for small armies only; crowds read by count.
    for (const u of b.units) {
      if (!u.alive || b.specs[u.team].count > 5) continue;
      const hp = Math.max(0, u.health / u.maxHealth);
      const head = u.bodies.get(u.bp.head)!.translation();
      const bw = Math.max(30, u.spec.size * 0.6 * s);
      const bx = X(head.x) - bw / 2, by = Y(head.y + u.spec.size * 0.3) - 6;
      ctx.fillStyle = "rgba(20,16,24,0.55)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = hp > 0.5 ? "#7ddc6a" : hp > 0.25 ? "#f2c14e" : "#e5533d";
      ctx.fillRect(bx, by, bw * hp, 5);
    }
  }

  private drawArt(a: DrawArt, X: (x: number) => number, Y: (y: number) => number, s: number, alive: boolean): void {
    const cut = artReady.get(a.layout.rig.id);
    const piece = cut?.pieces[a.label - 1];
    if (!piece) return;
    const { k, flip, cx, rig } = a.layout;
    const t = a.body.translation();
    const A = a.body.rotation();
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(X(t.x), Y(t.y));
    ctx.rotate(-A);
    ctx.translate(a.offset[0] * s, -a.offset[1] * s);
    ctx.scale((flip * k * s) / UP, (k * s) / UP);
    if (!alive) ctx.globalAlpha = 0.55;
    ctx.drawImage(piece.c, piece.x - cx * UP, piece.y - (rig.bbox[3] + 1) * UP);
    ctx.restore();
  }

  private shape(sh: DecoShape, x: number, y: number, a: number, s: number, fill: string, line: string, outline: number): void {
    const ctx = this.ctx;
    if (sh.kind === "capsule") {
      const dx = -Math.sin(a) * sh.hh * s, dy = -Math.cos(a) * sh.hh * s;
      ctx.strokeStyle = line;
      ctx.lineWidth = sh.r * 2 * s + outline * 2;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = sh.r * 2 * s;
      ctx.stroke();
    } else if (sh.kind === "ball") {
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(x, y, sh.r * s + outline, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, sh.r * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (sh.kind === "box") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-a);
      ctx.fillStyle = line;
      ctx.fillRect(-sh.hx * s - outline, -sh.hy * s - outline, sh.hx * 2 * s + outline * 2, sh.hy * 2 * s + outline * 2);
      ctx.fillStyle = fill;
      ctx.fillRect(-sh.hx * s, -sh.hy * s, sh.hx * 2 * s, sh.hy * 2 * s);
      ctx.restore();
    }
  }

  /** Eye placed on the face of a round head. */
  private ballEye(x: number, y: number, r: number, a: number, facing: number, alive: boolean): void {
    const ex = x + Math.cos(-a) * facing * r * 0.42 - Math.sin(-a) * -r * 0.15;
    const ey = y + Math.sin(-a) * facing * r * 0.42 + Math.cos(-a) * -r * 0.15;
    this.eye(ex, ey, Math.max(1.5, r * 0.22), facing, alive);
  }

  private eye(ex: number, ey: number, er: number, facing: number, alive: boolean): void {
    const ctx = this.ctx;
    er = Math.max(1.5, er);
    if (alive) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#141018";
      ctx.beginPath();
      ctx.arc(ex + facing * er * 0.35, ey, er * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#141018";
      ctx.lineWidth = Math.max(1, er * 0.45);
      ctx.beginPath();
      ctx.moveTo(ex - er, ey - er);
      ctx.lineTo(ex + er, ey + er);
      ctx.moveTo(ex + er, ey - er);
      ctx.lineTo(ex - er, ey + er);
      ctx.stroke();
    }
  }
}
