// Canvas renderer. Reads physics state; never writes it.
import type { Battle, DrawCollider } from "./sim/battle";

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (c: string, to: [number, number, number], t: number) => {
  const [r, g, b] = hex(c);
  return `rgb(${Math.round(r + (to[0] - r) * t)},${Math.round(g + (to[1] - g) * t)},${Math.round(b + (to[2] - b) * t)})`;
};
const BLACK: [number, number, number] = [20, 16, 24];
const GREY: [number, number, number] = [120, 118, 125];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cam = { x: 0, y: 3, scale: 40, ready: false };
  private order: DrawCollider[] = [];
  private colors = new Map<DrawCollider, { fill: string; line: string; dead: string; deadLine: string }>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  attach(b: Battle): void {
    this.cam.ready = false;
    this.order = [...b.draw].sort((a, c) => a.layer - c.layer);
    this.colors.clear();
    // Crowds get per-body tint so "100 men" reads as 100 people, not one sprite. Seeded by unit id.
    const tint = (c: string, id: number, amt: number) => {
      const t = (((id * 2654435761) >>> 0) % 1000) / 1000;
      return t < 0.5 ? mix(c, BLACK, (0.5 - t) * amt) : mix(c, [255, 255, 255], (t - 0.5) * amt);
    };
    const toHex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    for (const d of this.order) {
      const crowd = b.specs[d.unit.team].count > 3;
      const body = crowd ? toHex(tint(d.unit.spec.colors.body, d.unit.id, 0.5)) : d.unit.spec.colors.body;
      const accent = crowd ? toHex(tint(d.unit.spec.colors.accent, d.unit.id * 7 + 3, 0.9)) : d.unit.spec.colors.accent;
      const base = d.bp.paint === "accent" ? accent : d.bp.paint === "metal" ? "#cfd6dd" : d.bp.paint === "dark" ? mix(body, BLACK, 0.5) : body;
      const baseHex = base.startsWith("#") ? base : body;
      const far = d.layer === 0 ? 0.22 : 0;
      const fill = base.startsWith("#") ? mix(base, BLACK, far) : base;
      this.colors.set(d, {
        fill,
        line: mix(baseHex, BLACK, 0.55 + far * 0.5),
        dead: mix(baseHex, GREY, 0.55),
        deadLine: mix(baseHex, BLACK, 0.7),
      });
    }
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
    const scale = Math.min(w / span, (h * 0.78) / Math.max(3, top + 1));
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
    // Walls, if in view.
    ctx.fillStyle = "#8a6f52";
    for (const side of [-1, 1]) {
      const wx = X(side * b.arenaHalf);
      ctx.fillRect(side < 0 ? wx - s : wx, 0, s, groundY);
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
      for (const d of this.order) {
        if (d.unit.alive !== pass) continue;
        const c = d.collider;
        const t = c.translation();
        const a = c.rotation();
        const col = this.colors.get(d)!;
        const fill = pass ? col.fill : col.dead;
        const line = pass ? col.line : col.deadLine;
        const x = X(t.x), y = Y(t.y);
        const sh = d.bp.shape;
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
          if (d.eye) this.eye(x, y, sh.r * s, a, d.unit.facing, pass);
        } else {
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
    }

    // Health bars for small armies only; crowds read by count.
    for (const u of b.units) {
      if (!u.alive || b.specs[u.team].count > 5) continue;
      const hp = Math.max(0, u.health / u.maxHealth);
      const head = u.bodies.get(u.bp.head)!.translation();
      const bw = Math.max(30, u.spec.size * 0.6 * s);
      const bx = X(head.x) - bw / 2, by = Y(head.y + u.spec.size * 0.22) - 6;
      ctx.fillStyle = "rgba(20,16,24,0.55)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = hp > 0.5 ? "#7ddc6a" : hp > 0.25 ? "#f2c14e" : "#e5533d";
      ctx.fillRect(bx, by, bw * hp, 5);
    }
  }

  private eye(x: number, y: number, r: number, a: number, facing: number, alive: boolean): void {
    const ctx = this.ctx;
    const ex = x + Math.cos(-a) * facing * r * 0.42 - Math.sin(-a) * -r * 0.15;
    const ey = y + Math.sin(-a) * facing * r * 0.42 + Math.cos(-a) * -r * 0.15;
    const er = Math.max(1.5, r * 0.22);
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
