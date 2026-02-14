import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "web"),
  publicDir: path.resolve(__dirname, "web/public"),
  build: {
    outDir: path.resolve(__dirname, "public"),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4242"
    }
  }
});
