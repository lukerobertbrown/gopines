import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyDirBeforeWrite: true,
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    proxy: {
      "/api": {
        target: "https://gopines.web.app",
        changeOrigin: true,
      },
    },
  },
});
