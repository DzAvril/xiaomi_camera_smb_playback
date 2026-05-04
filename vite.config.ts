/// <reference types="vitest" />

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = {
  plugins: [react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
};

export default defineConfig(config);
