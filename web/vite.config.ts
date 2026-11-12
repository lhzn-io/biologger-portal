/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server runs on 127.0.0.1:8797. Proxy targets use the IPv4 loopback, not "localhost": Node 17+ resolves
// localhost to ::1 first, which the server does not bind (agent-lab constraint 2).
const SERVER = "http://127.0.0.1:8797";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": SERVER, "/bathy": SERVER, "/tracks": SERVER },
    // The prompt templates live outside web/ (configs/prompts/), imported with ?raw.
    fs: { allow: [".."] },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
