import { readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif)$/i;

// Deliberately not "manifest.json" — Vite's dev server reserves that exact
// filename for its own build-manifest feature and falls back to serving
// index.html instead of the static file when a public/ asset is named that.
const MANIFEST_NAME = "images.json";

/**
 * Scans public/images for image files and writes public/images/images.json
 * listing them, so the app can pick up any number of dropped-in images at
 * runtime without touching source code. Regenerates on dev-server start,
 * on every add/remove inside the folder, and before each build.
 */
export function imageManifestPlugin(dir = "public/images"): Plugin {
  // Windows can transiently lock a file while it's still being copied in
  // (Explorer, antivirus scans, etc.) — readdir/watch calls that race that
  // lock must never be allowed to crash the whole dev server over it.
  const write = (root: string) => {
    try {
      const absDir = join(root, dir);
      if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
      const files = readdirSync(absDir)
        .filter((f) => IMAGE_EXT.test(f) && f !== MANIFEST_NAME)
        .sort();
      writeFileSync(join(absDir, MANIFEST_NAME), JSON.stringify(files, null, 2));
      return files;
    } catch (err) {
      console.warn("[image-manifest] skipped a regeneration:", err);
      return [];
    }
  };

  return {
    name: "image-manifest",
    configureServer(server) {
      const root = server.config.root;
      write(root);
      const absDir = join(root, dir).replace(/\\/g, "/");

      // No explicit watcher.add() here: Vite's dev server already watches
      // publicDir for its own full-reload behavior, so adding another
      // explicit fs watch on top of it only doubles the chance of hitting a
      // transient Windows file lock. We just listen on the watcher Vite
      // already runs, and never let a bad event crash the process.
      server.watcher.on("error", (err) => {
        console.warn("[image-manifest] file watcher error (ignored):", err);
      });
      server.watcher.on("add", (path) => {
        if (path.replace(/\\/g, "/").startsWith(absDir) && IMAGE_EXT.test(path)) write(root);
      });
      server.watcher.on("unlink", (path) => {
        if (path.replace(/\\/g, "/").startsWith(absDir) && IMAGE_EXT.test(path)) write(root);
      });
    },
    buildStart() {
      write(process.cwd());
    },
  };
}
