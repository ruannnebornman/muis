import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
