import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { port: 4200 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        autopilot: "autopilot.html",
      },
    },
  },
});
