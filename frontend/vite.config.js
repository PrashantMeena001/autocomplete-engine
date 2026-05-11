import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/suggest": "http://localhost:5001",
      "/record":  "http://localhost:5001",
      "/stats":   "http://localhost:5001",
    }
  }
});
