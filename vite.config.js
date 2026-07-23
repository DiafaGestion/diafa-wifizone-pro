import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // works both on GitHub Pages (/repo-name/) and Electron (file://) once built
});
