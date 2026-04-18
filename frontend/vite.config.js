import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/suggest": "http://localhost:5000",
      "/record":  "http://localhost:5000",
      "/stats":   "http://localhost:5000",
    }
  }
});
