export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  return program;
}

export interface AtlasBudget {
  /** Largest atlas canvas dimension, in px — keeps very large image sets from exceeding GPU texture limits. */
  maxAtlasDim?: number;
  /** Per-image cell size used when there's room for it. */
  maxCellSize?: number;
  /** Floor for cell size — below this, further-growing sets still fit but images get blurrier. */
  minCellSize?: number;
}

// Fetching the bytes ourselves and decoding via createImageBitmap() is a
// different (and generally more reliable) code path than an <img>'s own
// decode: an <img>'s onload — and even <img>.decode() — can occasionally
// hand back an incompletely decoded frame that paints as flat horizontal
// color bands once drawn to a canvas, even though the same file displays
// perfectly fine as a plain <img>.
async function loadFullyDecodedImage(src: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(src, { signal });
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.warn(`InvertedDome: failed to decode image "${src}"`, err);
    }
    return null;
  }
}

// Loads strictly one image at a time — even a modest concurrency cap (6 at
// a time) was observed to occasionally starve/corrupt one of many
// simultaneous WebP decodes under resource pressure, coming back as a flat,
// horizontally-banded bitmap despite decoding perfectly fine on its own.
// This only runs once per atlas rebuild, so the extra time is a worthwhile
// trade for correctness. `signal` lets an in-progress build be abandoned
// (e.g. React StrictMode's mount→cleanup→mount in dev, or the images list
// changing again mid-build) — without it, a stale build's fetches would
// keep running in the background and contend with the new one for the same
// decoder resources, defeating the point of loading one at a time at all.
async function loadAllSequentially<T, R>(items: T[], fn: (item: T, signal?: AbortSignal) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;
    results[i] = await fn(items[i], signal);
  }
  return results;
}

/**
 * Loads each unique image URL and packs it into a square-ish atlas canvas.
 * The per-image cell size shrinks automatically as the image count grows, so
 * dropping in anywhere from 1 to a few hundred images keeps the atlas within
 * a safe GPU texture size instead of growing unbounded.
 */
export async function buildAtlas(
  imageUrls: string[],
  budget: AtlasBudget = {},
  signal?: AbortSignal
): Promise<{ canvas: HTMLCanvasElement; cols: number; rows: number; count: number }> {
  const { maxAtlasDim = 4096, maxCellSize = 256, minCellSize = 48 } = budget;

  const unique = Array.from(new Set(imageUrls));
  const count = Math.max(unique.length, 1);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellSize = Math.max(minCellSize, Math.min(maxCellSize, Math.floor(maxAtlasDim / Math.max(cols, rows))));

  const canvas = document.createElement("canvas");
  canvas.width = cols * cellSize;
  canvas.height = rows * cellSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for atlas build");

  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const loaded = await loadAllSequentially(unique, loadFullyDecodedImage, signal);
  if (signal?.aborted) return { canvas, cols, rows, count };

  loaded.forEach((img, i) => {
    if (!img) return;
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Cover-fit each source image into its atlas cell.
    const scale = Math.max(cellSize / img.width, cellSize / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const dx = col * cellSize + (cellSize - w) / 2;
    const dy = row * cellSize + (cellSize - h) / 2;
    // Cover-fit deliberately overshoots the cell on one axis (that's what
    // lets it fully cover a square cell from a non-square source) — clip to
    // the cell's own rectangle first, or that overshoot paints straight into
    // the neighboring cell and bleeds two different photos into one tile.
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * cellSize, row * cellSize, cellSize, cellSize);
    ctx.clip();
    ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();
    img.close();
  });

  return { canvas, cols, rows, count };
}

/** Resolves any CSS color string to premultiplied-alpha-free RGBA in 0..1. */
export function parseCssColor(color: string): [number, number, number, number] {
  if (color === "transparent") return [0, 0, 0, 0];
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return [0, 0, 0, 0];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
}

// Mirrors the GLSL `hashCell()` in domeShaders.ts bit-for-bit, using 32-bit
// integer wraparound arithmetic (via Math.imul) rather than a sin()-based
// float hash — GLSL's sin runs in 32-bit float vs JS's 64-bit double, so a
// float hash would silently drift apart and pick a different image than the
// one actually rendered for a cell, making clicks open the wrong tile.
export function hashCellToIndex(col: number, row: number, seed: number, count: number): number {
  if (count <= 0) return 0;
  let h = (Math.imul(col, 374761393) + Math.imul(row, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % count;
}
