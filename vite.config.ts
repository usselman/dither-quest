import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "itch" ? "./" : "/dither-quest",
  plugins: [react()],
}));
