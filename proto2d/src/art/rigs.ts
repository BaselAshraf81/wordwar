// Emoji art rigs built offline by scripts/build-rigs.mjs (Noto Emoji, Apache-2.0).
import data from "./rigs.json";

export type ArtPlan = "quadruped" | "bird" | "fish" | "wheeled";
type Box = [number, number, number, number];

export interface ArtRig {
  id: string;
  cp: string;
  desc: string;
  plan: ArtPlan;
  res: number;
  bbox: Box;
  belly: number;
  pieces: [Box | null, Box | null, Box | null]; // body, head, tail, in render pixels
  cuts: [number, number];
  faceLeft: boolean;
  labels: string;
}

export const RIGS: ArtRig[] = data as ArtRig[];
export const RIG_BY_ID = new Map(RIGS.map((r) => [r.id, r]));

export function decodeLabels(r: ArtRig): Uint8Array {
  const out = new Uint8Array(r.res * r.res);
  let i = 0;
  for (const run of r.labels.split(",")) {
    const [v, n] = run.split(":").map(Number);
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
}
