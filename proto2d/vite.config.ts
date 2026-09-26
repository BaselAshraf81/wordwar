import { defineConfig, loadEnv, type Plugin } from "vite";
import { phraseToSpec, type JevResult } from "./src/ai/jev";

// Dev-only API: POST /api/unit { phrase } -> JevResult. The key never reaches the browser.
// Not a production server: no auth; the only guards are a phrase length cap, a small
// per-process call budget and an in-memory cache.
function jevApi(apiKey: string | undefined): Plugin {
  const cache = new Map<string, JevResult>();
  let calls = 0;
  const BUDGET = 2000;
  return {
    name: "jev-api",
    configureServer(server) {
      server.middlewares.use("/api/unit", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return send(405, { error: "POST only" });
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let phrase = "";
        try {
          phrase = String(JSON.parse(raw).phrase ?? "").replace(/\s+/g, " ").trim();
        } catch {
          return send(400, { error: "bad json" });
        }
        if (!phrase || phrase.length > 80) return send(400, { error: "Type 1 to 80 characters." });
        const key = phrase.toLowerCase();
        const hit = cache.get(key);
        if (hit) return send(200, { ...hit, cached: true });
        if (!apiKey) return send(503, { error: "TYPESAFE_API_KEY is not set." });
        if (calls >= BUDGET) return send(429, { error: "Session budget used up." });
        calls++;
        try {
          const r = await phraseToSpec(phrase, apiKey);
          cache.set(key, r);
          send(200, r);
        } catch (e) {
          server.config.logger.error(String(e));
          send(502, { error: "Jev did not answer. Try again." });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The key lives in winduo/.env, two levels up. loadEnv with '' prefix reads it server-side only.
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [jevApi(env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_API_KEY)],
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
  };
});
