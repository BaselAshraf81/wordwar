// Fetches Noto Emoji SVGs (Apache-2.0) into public/emoji once, then reads from disk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "public/emoji";
mkdirSync(DIR, { recursive: true });

export async function svgOf(cp) {
  const path = `${DIR}/${cp}.svg`;
  if (!existsSync(path)) {
    const r = await fetch(`https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/svg/emoji_u${cp}.svg`);
    if (!r.ok) throw new Error(`${cp}: ${r.status}`);
    writeFileSync(path, await r.text());
  }
  return readFileSync(path, "utf8");
}
