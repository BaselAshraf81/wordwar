// Smoke test for the bundled production API (dist-api/api.js). Reads keys from ../../.env.
// node scripts/api-smoke.mjs [--break-first]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^(TYPESAFE_API_KEY\w*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
if (process.argv.includes("--break-first")) process.env.TYPESAFE_API_KEY = "sk-broken-for-test";
const { default: handler } = await import("../dist-api/api.js");
const call = (phrase) =>
  new Promise((done) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { done({ status: this.statusCode, cache: this.headers["Cache-Control"], body: JSON.parse(b) }); } };
    handler({ method: "GET", url: `/api/wordwar?phrase=${encodeURIComponent(phrase)}`, headers: { "x-forwarded-for": "1.2.3.4" } }, res);
  });
for (const p of ["a rubber chicken with a sword", "a very tired dragon", "a rubber chicken with a sword"]) {
  const t = Date.now();
  const r = await call(p);
  console.log(p, "->", r.status, r.cache?.slice(0, 20), r.body.ok ?? r.body.error, r.body.spec?.genome?.material ?? "", `${Date.now() - t}ms`);
}
