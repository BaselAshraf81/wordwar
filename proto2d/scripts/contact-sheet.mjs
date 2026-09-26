// Renders every rigged emoji into one labelled PNG for a visual audit.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const only = process.argv[2]?.split(",");
const rigs = JSON.parse(readFileSync("src/art/rigs.json", "utf8")).filter((r) => !only || only.includes(r.id));
const COLS = only ? 6 : 10, CELL = only ? 150 : 90;
const rows = Math.ceil(rigs.length / COLS);
let body = "";
rigs.forEach((r, i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
  const b64 = readFileSync(`public/emoji/${r.cp}.svg`).toString("base64");
  body += `<image x="${x + 10}" y="${y + 2}" width="${CELL - 20}" height="${CELL - 20}" href="data:image/svg+xml;base64,${b64}"/>`;
  body += `<text x="${x + CELL / 2}" y="${y + CELL - 6}" font-size="11" text-anchor="middle" font-family="Arial">${r.id} ${r.faceLeft ? "LEFT" : "RIGHT"}</text>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${COLS * CELL}" height="${rows * CELL}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
writeFileSync("scripts/.masks/contact.png", new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
console.log("ok", rigs.length);
