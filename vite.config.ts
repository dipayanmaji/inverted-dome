import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { imageManifestPlugin } from "./vite-image-manifest-plugin";

export default defineConfig({
  plugins: [react(), imageManifestPlugin()],
});
