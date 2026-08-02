import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
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
