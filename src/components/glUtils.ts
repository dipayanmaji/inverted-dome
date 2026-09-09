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

/**
 * Loads each unique image URL and packs it into a square-ish atlas canvas.
 * The per-image cell size shrinks automatically as the image count grows, so
 * dropping in anywhere from 1 to a few hundred images keeps the atlas within
 * a safe GPU texture size instead of growing unbounded.
 */
export async function buildAtlas(
  imageUrls: string[],
  budget: AtlasBudget = {}
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

  const loaded = await Promise.all(
    unique.map(
      (src) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        })
    )
  );

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
    ctx.drawImage(img, dx, dy, w, h);
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
