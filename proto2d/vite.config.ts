import { defineConfig, loadEnv, type Plugin } from "vite";
import handler from "./src/server/api";

// Dev server runs the same handler as production (GET /api/wordwar?phrase=). The key never
// reaches the browser.
function jevApi(): Plugin {
  return {
    name: "jev-api",
    configureServer(server) {
      server.middlewares.use("/api/wordwar", (req, res) => {
        // connect strips the mount path; restore it so the handler sees the query string.
        req.url = "/api/wordwar" + (req.url ?? "");
        handler(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The key lives in winduo/.env, two levels up. loadEnv with '' prefix reads it server-side only.
  const env = loadEnv(mode, "../..", "");
  for (const [k, v] of Object.entries(env)) if (k.startsWith("TYPESAFE_API_KEY")) process.env[k] ??= v;
  return {
    // Served from baselashraf.com/wordwar/ in production.
    base: mode === "production" ? "/wordwar/" : "/",
    plugins: [jevApi()],
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
    build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  };
});
