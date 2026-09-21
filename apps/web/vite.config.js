import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Em dev, /api e /media são servidos pela apps/api (:3000) — mesma origem, sem CORS.
const API_URL = process.env.VITE_API_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": { target: API_URL, changeOrigin: true },
      "/media": { target: API_URL, changeOrigin: true }
    }
  }
});
