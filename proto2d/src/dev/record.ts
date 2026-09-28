// Dev-only clip recorder. Open /?rec=1#u=...&s=N (or #m=preset&s=N): the fight is stepped
// frame by frame at exactly 60 fps, composited into a 1080x1920 vertical video frame with
// titles, and every frame is uploaded to the dev server (proto2d/rec/). ffmpeg joins them.
// Deterministic, so the video is the same fight the share link replays.
import { describe } from "../describe";
import { Renderer } from "../render";
import { Battle } from "../sim/battle";
import type { UnitSpec } from "../sim/spec";

const W = 1080, H = 1920;
const STAGE_Y = 330, STAGE_H = 1290;
const INK = "#1e1a24", PAPER = "#fffaf0", LEFT = "#34557d", RIGHT = "#b5433a", SOFT = "rgba(30,26,36,0.72)";
const FONT = 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';

export async function record(specs: [UnitSpec, UnitSpec], seed: number, status: (s: string) => void): Promise<void> {
  const q = new URLSearchParams(location.search);
  const realFor = Number(q.get("real") ?? 10); // seconds at real speed before fast-forwarding
  const tailFor = Number(q.get("tail") ?? 5); // real-speed seconds before the end
  const fast = Number(q.get("fast") ?? 2);

  // Dry run to learn when the fight ends, so the fast-forward can stop just before it.
  const dry = new Battle(specs, seed);
  while (!dry.result) dry.step();
  const end = dry.result.time;
  dry.dispose();

  const battle = new Battle(specs, seed);
  const stage = document.createElement("canvas");
  stage.width = W;
  stage.height = STAGE_H;
  const r = new Renderer(stage);
  r.narrow = true;
  r.attach(battle);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;

  let frame = 0;
  const pending = new Set<Promise<unknown>>();
  const emit = async () => {
    const blob = await new Promise<Blob>((ok) => out.toBlob((b) => ok(b!), "image/jpeg", 0.93));
    const p = fetch(`/__rec?i=${frame++}`, { method: "POST", body: blob });
    pending.add(p);
    p.finally(() => pending.delete(p));
    if (pending.size >= 6) await Promise.race(pending);
  };

  const text = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 800) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const wrap = (s: string, x: number, y: number, size: number, color: string, maxW: number, weight = 600): number => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const words = s.split(" ");
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) {
        text(line, x, y, size, color, "left", weight);
        y += size * 1.3;
        line = w;
      } else line = t;
    }
    text(line, x, y, size, color, "left", weight);
    return y + size * 1.3;
  };
  const pill = (x: number, y: number, w: number, h: number, fill: string, stroke = INK, lw = 5) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2 > 40 ? 28 : h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };

  const chrome = (speed: number, card: number, banner: number) => {
    ctx.fillStyle = "#9ad0ec";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(stage, 0, STAGE_Y);
    // Title: the two things somebody typed.
    ctx.font = `800 96px ${FONT}`;
    const a = specs[0].label, b = specs[1].label, vs = "  vs  ";
    const wa = ctx.measureText(a).width, wv = ctx.measureText(vs).width, wb = ctx.measureText(b).width;
    const scale = Math.min(1, (W - 80) / (wa + wv + wb));
    const size = 96 * scale;
    let x = (W - (wa + wv + wb) * scale) / 2;
    text(a, x, 150, size, LEFT, "left");
    x += wa * scale;
    text(vs, x, 150, size, INK, "left");
    x += wv * scale;
    text(b, x, 150, size, RIGHT, "left");
    text("Jev designed both. Physics decides.", W / 2, 232, 44, SOFT, "center", 700);
    // Scoreboard over the sky.
    text(`${battle.aliveCount(0)} / ${specs[0].count} standing`, 50, STAGE_Y + 70, 44, LEFT, "left");
    text(`${battle.aliveCount(1)} / ${specs[1].count} standing`, W - 50, STAGE_Y + 70, 44, RIGHT, "right");
    const clock = `${battle.time.toFixed(1)}s`;
    ctx.font = `800 44px ${FONT}`;
    const cw = ctx.measureText(clock).width + 40;
    pill(W / 2 - cw / 2, STAGE_Y + 22, cw, 66, PAPER, INK, 4);
    text(clock, W / 2, STAGE_Y + 70, 44, INK);
    if (speed > 1) {
      pill(W / 2 - 110, STAGE_Y + 108, 220, 64, INK, INK, 0);
      text(`${speed}× speed`, W / 2, STAGE_Y + 152, 36, PAPER);
    }
    // What Jev came up with: shown over the stage for the first seconds.
    if (card > 0) {
      ctx.globalAlpha = Math.min(1, card * 3);
      const y0 = STAGE_Y + 210;
      pill(50, y0, W - 100, 350, PAPER);
      text("What Jev designed", 90, y0 + 72, 44, INK, "left");
      let y = wrap(`${specs[0].label}: ${describe(specs[0])}`, 90, y0 + 145, 36, LEFT, W - 180);
      wrap(`${specs[1].label}: ${describe(specs[1])}`, 90, y + 18, 36, RIGHT, W - 180);
      ctx.globalAlpha = 1;
    }
    if (banner > 0 && battle.result) {
      const res = battle.result;
      const w = res.winner;
      const title = w === null ? "Nobody wins" : `${specs[w].label} win${specs[w].count === 1 ? "s" : ""}`;
      const sub = w === null ? `draw after ${res.time.toFixed(1)}s` : `lost ${specs[w].count - res.alive[w]} of ${specs[w].count} in ${res.time.toFixed(1)}s`;
      ctx.globalAlpha = Math.min(1, banner * 4);
      const by = STAGE_Y + 360;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.roundRect(112, by + 12, W - 212, 250, 36);
      ctx.fill();
      pill(100, by, W - 200, 250, PAPER, INK, 7);
      text(title, W / 2, by + 118, 84, w === 1 ? RIGHT : LEFT);
      text(sub, W / 2, by + 196, 44, SOFT, "center", 650);
      ctx.globalAlpha = 1;
    }
    // Call to action.
    text("Type any two armies.", W / 2, H - 196, 64, INK);
    text("baselashraf.com/wordwar", W / 2, H - 100, 58, RIGHT);
  };

  // 1. Hold on the start with Jev's designs (2.6 s), then the fight.
  const INTRO = 156;
  r.render(battle);
  for (let i = 0; i < INTRO; i++) {
    chrome(1, i < INTRO - 18 ? 1 : (INTRO - i) / 18, 0);
    await emit();
  }
  let outro = 0;
  while (outro < 200) {
    const t = battle.time;
    const speed = t > realFor && t < end - tailFor ? fast : 1;
    for (let s = 0; s < speed; s++) battle.step();
    r.render(battle);
    if (battle.result) outro++;
    chrome(speed, 0, battle.result ? outro / 60 : 0);
    await emit();
    if (frame % 60 === 0) status(`recording: ${battle.time.toFixed(1)}s of ${end.toFixed(1)}s, ${frame} frames`);
  }
  await Promise.all(pending);
  await fetch(`/__rec?done=${frame}`, { method: "POST" });
  status(`done: ${frame} frames`);
  battle.dispose();
}
