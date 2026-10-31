/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend runs on 127.0.0.1:8000 (see README). In development Vite forwards /api to it,
// so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  // ECharts alone is ~0.7 MB minified (~250 kB gzipped); fine for an app served from this computer.
  build: { chunkSizeWarningLimit: 900 },
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"] },
});
