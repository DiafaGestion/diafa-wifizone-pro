import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base ("./") instead of an absolute path: every asset URL in the built index.html
  // becomes "./assets/…" instead of "/something-hardcoded/assets/…". This is exactly the
  // pattern the working cPanel build already used (see the uploaded index.html — all hrefs are
  // "./..."), and it means the SAME build works unchanged whether it's deployed at the domain
  // root, on cPanel in a subfolder, or on GitHub Pages under /diafa-wifizone-pro/ — no need to
  // hardcode the repo name here, and nothing breaks if the repo or hosting folder is renamed.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          firebase: ["firebase/app", "firebase/firestore"],
          xlsx: ["xlsx"],
          charts: ["recharts"],
          vendor: ["papaparse", "lucide-react"],
        },
      },
    },
  },
});
