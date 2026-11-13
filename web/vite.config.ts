/// <reference types="vitest/config" />
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server runs on 127.0.0.1:8797. Proxy targets use the IPv4 loopback, not "localhost": Node 17+ resolves
// localhost to ::1 first, which the server does not bind (agent-lab constraint 2).
const SERVER = "http://127.0.0.1:8797";

// Packed animal models for the dev server only (deploy/models/pack-dev.sh writes them). They stay out of
// public/ so that no build ever copies them; the publish step packs its own under a fresh key.
const DEV_MODELS = fileURLToPath(new URL("../deploy/models/dev-out", import.meta.url));
function devModels(): Plugin {
  return {
    name: "dev-models",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/models", (req, res, next) => {
        const name = basename((req.url ?? "").split("?")[0] ?? "");
        readFile(join(DEV_MODELS, name)).then(
          (body) => {
            res.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "application/octet-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.end(body);
          },
          () => next(),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devModels()],
  build: {
    // three.js and MapLibre load only with the track viewer; separate chunks let browsers cache them.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: { manualChunks: { three: ["three", "camera-controls"], maplibre: ["maplibre-gl"] } },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": SERVER, "/topobathy": SERVER, "/tracks": SERVER },
    // The prompt templates live outside web/ (configs/prompts/), imported with ?raw.
    fs: { allow: [".."] },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
