// Production API, bundled into one file (npm run build:api) and deployed as a Vercel function.
// GET /api/wordwar?phrase=a%20goose%20with%20a%20knife -> JevResult
//
// Guards: phrase length cap, per-IP rate limit and a per-instance call budget. Successful answers
// are cached at Vercel's edge for a year (s-maxage), so a phrase is designed once and every later
// request for it, from anyone, is served without calling Jev. The API key stays server-side.
import { phraseToSpec, type JevResult } from "../ai/jev";

// The slice of Node's http types this handler uses (keeps @types/node out of the project).
interface IncomingMessage {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}
declare const process: { env: Record<string, string | undefined> };
declare const console: { error(...a: unknown[]): void };

const memo = new Map<string, JevResult>();
const perIp = new Map<string, { n: number; since: number }>();
const WINDOW_MS = 10 * 60_000;
const PER_IP = 24; // phrases per IP per 10 minutes, per warm instance
const BUDGET = 3000; // Jev calls per warm instance
let calls = 0;

function send(res: ServerResponse, status: number, body: unknown, cache: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.end(JSON.stringify(body));
}

const NO_STORE = "no-store";
const FOREVER = "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return send(res, 405, { error: "GET only" }, NO_STORE);
  const url = new URL(req.url ?? "/", "http://localhost");
  const phrase = (url.searchParams.get("phrase") ?? "").replace(/\s+/g, " ").trim();
  if (!phrase || phrase.length > 80) return send(res, 400, { error: "Type 1 to 80 characters." }, NO_STORE);

  const key = phrase.toLowerCase();
  const hit = memo.get(key);
  if (hit) return send(res, 200, hit, FOREVER);

  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const rec = perIp.get(ip);
  if (!rec || now - rec.since > WINDOW_MS) perIp.set(ip, { n: 1, since: now });
  else if (++rec.n > PER_IP) return send(res, 429, { error: "That's a lot of armies. Give Jev a few minutes." }, NO_STORE);
  if (perIp.size > 5000) perIp.clear();

  const keys = apiKeys();
  if (!keys.length) return send(res, 503, { error: "The designer is offline right now." }, NO_STORE);
  if (calls >= BUDGET) return send(res, 429, { error: "Busy. Try again in a minute." }, NO_STORE);
  calls++;
  // Rotate across keys so their credit drains evenly. A key that fails (out of credit, revoked,
  // rate-limited) sits out for a while and the phrase is retried on the next one.
  const now2 = Date.now();
  const usable = keys.filter((k) => (benched.get(k) ?? 0) < now2);
  const order = (usable.length ? usable : keys).slice();
  const startAt = turn++ % order.length;
  const tries = [...order.slice(startAt), ...order.slice(0, startAt)];
  for (const k of tries) {
    try {
      const r = await phraseToSpec(phrase, k);
      memo.set(key, r);
      if (memo.size > 2000) memo.delete(memo.keys().next().value!);
      return send(res, 200, r, FOREVER);
    } catch (e) {
      console.error(`key #${keys.indexOf(k) + 1} failed:`, String(e).slice(0, 200));
      benched.set(k, Date.now() + BENCH_MS);
    }
  }
  send(res, 502, { error: "Jev did not answer. Try again." }, NO_STORE);
}

// TYPESAFE_API_KEY, TYPESAFE_API_KEY_BK, TYPESAFE_API_KEY_2, _3 ... all join the rotation.
const BENCH_MS = 10 * 60_000;
const benched = new Map<string, number>();
let turn = 0;
function apiKeys(): string[] {
  const out: string[] = [];
  for (const [name, v] of Object.entries(process.env)) if (/^TYPESAFE_API_KEY(_\w+)?$/.test(name) && v && !out.includes(v.trim())) out.push(v.trim());
  return out.sort();
}
