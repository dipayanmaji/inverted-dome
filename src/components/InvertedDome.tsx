import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import "./InvertedDome.css";
import { VERTEX_SHADER, FRAGMENT_SHADER } from "./domeShaders";
import { createProgram, buildAtlas, parseCssColor, hashCellToIndex } from "./glUtils";

export interface InvertedDomeProps {
  /** Image URLs tiled across the endless grid. */
  images: string[];
  /** Tile width in CSS pixels. */
  tileWidth?: number;
  /** Tile height in CSS pixels. */
  tileHeight?: number;
  /** Space between tiles in CSS pixels. */
  gap?: number;
  /** Corner radius of each tile in CSS pixels. */
  borderRadius?: number;
  /** How hard the lens stretches tiles towards the edges; 0 flattens the grid. */
  curve?: number;
  /** Reach of the lens as a multiple of the viewport diagonal; larger softens the bend. */
  curveRadius?: number;
  /** Magnification at the centre of the lens. */
  zoom?: number;
  /** Rotation of every tile in degrees. */
  tileRotation?: number;
  /** Desaturation of the images, 0 to 1. */
  grayscale?: number;
  /** Darkening towards the edges, 0 to 1. */
  vignette?: number;
  /** Continuous horizontal drift in pixels per second. */
  autoScrollX?: number;
  /** Continuous vertical drift in pixels per second. */
  autoScrollY?: number;
  /** Allow dragging the grid with pointer or touch. */
  enableDrag?: boolean;
  /** Allow scrolling the grid with the wheel or trackpad. */
  enableWheel?: boolean;
  /** Restrict movement to one axis. */
  axis?: "both" | "x" | "y";
  /** Multiplier on drag distance. */
  dragSensitivity?: number;
  /** Multiplier on wheel delta. */
  wheelSensitivity?: number;
  /** Velocity kept per frame after release, 0 to 0.99; higher glides longer. */
  friction?: number;
  /** Vertices per tile edge; reserved for a future adaptive-tessellation path. */
  segments?: number;
  /** Shuffles which image lands on which cell. */
  seed?: number;
  /** Backdrop behind the tiles. */
  backgroundColor?: string;
  /** Upper device pixel ratio bound. */
  dpr?: number;
  /** Open the clicked tile in a lightbox that blurs the grid behind it. */
  openOnClick?: boolean;
  /** Fires with the image index and URL when a tile is clicked. */
  onTileClick?: (index: number, src: string) => void;
  /** Fires once the atlas is ready and tiles are visible. */
  onLoad?: () => void;
  /** Extra classes for the root element. */
  className?: string;
  /** Content layered above the grid. */
  children?: ReactNode;
}

interface Uniforms {
  [key: string]: WebGLUniformLocation | null;
}

const UNIFORM_NAMES = [
  "uResolution",
  "uOffset",
  "uTileW",
  "uTileH",
  "uGap",
  "uBorderRadius",
  "uCurve",
  "uCurveRadius",
  "uZoom",
  "uTileRotation",
  "uGrayscale",
  "uVignette",
  "uBgColor",
  "uAtlas",
  "uAtlasCols",
  "uAtlasRows",
  "uAtlasCount",
  "uSeed",
];

export default function InvertedDome({
  images,
  tileWidth = 200,
  tileHeight = 200,
  gap = 16,
  borderRadius = 16,
  curve = 0.3,
  curveRadius = 1.5,
  zoom = 0.1,
  tileRotation = 0,
  grayscale = 0,
  vignette = 0,
  autoScrollX = 0,
  autoScrollY = 0,
  enableDrag = true,
  enableWheel = true,
  axis = "both",
  dragSensitivity = 1,
  wheelSensitivity = 1.2,
  friction = 0.9,
  seed = 0,
  backgroundColor = "transparent",
  dpr = 2,
  openOnClick = false,
  onTileClick,
  onLoad,
  className,
  children,
}: InvertedDomeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const uniformsRef = useRef<Uniforms>({});
  const atlasInfoRef = useRef({ cols: 1, rows: 1, count: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  const offset = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0, t: 0 });

  const [lightbox, setLightbox] = useState<{ src: string; index: number } | null>(null);
  const loadedRef = useRef(false);

  // Keep the latest prop values in a ref so the single long-lived render
  // loop (set up once) always reads current values without re-subscribing.
  const propsRef = useRef({
    images,
    tileWidth,
    tileHeight,
    gap,
    borderRadius,
    curve,
    curveRadius,
    zoom,
    tileRotation,
    grayscale,
    vignette,
    autoScrollX,
    autoScrollY,
    axis,
    friction,
    seed,
    backgroundColor,
    dpr,
  });
  propsRef.current = {
    images,
    tileWidth,
    tileHeight,
    gap,
    borderRadius,
    curve,
    curveRadius,
    zoom,
    tileRotation,
    grayscale,
    vignette,
    autoScrollX,
    autoScrollY,
    axis,
    friction,
    seed,
    backgroundColor,
    dpr,
  };

  // One-time WebGL setup: compile the program and start the render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.error("InvertedDome: WebGL2 is not supported in this browser.");
      return;
    }
    glRef.current = gl;

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(program);

    const uniforms: Uniforms = {};
    for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name);
    uniformsRef.current = uniforms;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 1x1 placeholder so the first frames have something to sample while the
    // real atlas loads asynchronously below.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let cancelled = false;
    let lastAtlasKey = "";
    // Aborts the in-flight fetches of a stale atlas build (a superseded
    // `images` list, or this effect itself getting cleaned up — which
    // React's StrictMode triggers once in dev on every mount). Without this,
    // a "cancelled" build's fetches keep running in the background and
    // compete with the new build's fetches for the same decoder resources,
    // which was observed to occasionally corrupt one of many concurrent
    // WebP decodes into a flat, banded frame — even though each build loads
    // its own images strictly one at a time.
    let atlasAbort = new AbortController();
    let healTimer: number | undefined;

    const rebuildAtlas = async (imgs: string[]) => {
      atlasAbort.abort();
      atlasAbort = new AbortController();
      const atlas = await buildAtlas(imgs, undefined, atlasAbort.signal);
      if (cancelled || atlasAbort.signal.aborted) return;
      // No UNPACK_FLIP_Y_WEBGL here: the fragment shader computes atlas V to
      // increase downward (matching the canvas atlas's natural top-down row
      // order), so flipping the upload would mirror every image vertically.
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      atlasInfoRef.current = { cols: atlas.cols, rows: atlas.rows, count: atlas.count };
      if (!loadedRef.current) {
        loadedRef.current = true;
        onLoad?.();
      }
    };

    const syncAtlas = async () => {
      const imgs = propsRef.current.images;
      const key = imgs.join("|");
      if (key === lastAtlasKey || imgs.length === 0) return;
      lastAtlasKey = key;
      await rebuildAtlas(imgs);

      // Self-heal: decoding many WebP images has been observed to
      // occasionally corrupt a single one into flat horizontal color bands
      // — reproducibly with the source file confirmed valid on its own —
      // even when every image is loaded strictly one at a time. A fully
      // independent rebuild shortly after consistently comes back clean, so
      // silently rebuild once more a couple seconds after the first load to
      // self-correct any such transient corruption without user action.
      clearTimeout(healTimer);
      healTimer = window.setTimeout(() => {
        if (!cancelled && propsRef.current.images.join("|") === key) rebuildAtlas(imgs);
      }, 2500);
    };
    syncAtlas();

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, propsRef.current.dpr);
      const w = Math.max(1, Math.round(rect.width * ratio));
      const h = Math.max(1, Math.round(rect.height * ratio));
      canvas.width = w;
      canvas.height = h;
      sizeRef.current = { width: rect.width, height: rect.height, dpr: ratio };
      gl.viewport(0, 0, w, h);
    });
    ro.observe(container);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const p = propsRef.current;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Re-check the atlas in case the `images` array identity changed.
      syncAtlas();

      // Same sign convention as the drag fix above: subtract so a positive
      // autoScrollX/Y value drifts the content in that same positive
      // screen direction, matching what the prop names imply.
      if (p.autoScrollX !== 0 && p.axis !== "y") offset.current.x -= p.autoScrollX * dt;
      if (p.autoScrollY !== 0 && p.axis !== "x") offset.current.y -= p.autoScrollY * dt;

      if (!dragging.current) {
        if (Math.abs(velocity.current.x) > 0.01 || Math.abs(velocity.current.y) > 0.01) {
          offset.current.x += velocity.current.x * dt * 60;
          offset.current.y += velocity.current.y * dt * 60;
          velocity.current.x *= p.friction;
          velocity.current.y *= p.friction;
        } else {
          velocity.current.x = 0;
          velocity.current.y = 0;
        }
      }

      const { width, height } = sizeRef.current;
      if (width > 0 && height > 0) {
        gl.useProgram(program);
        const dprScale = sizeRef.current.dpr;
        gl.uniform2f(uniforms.uResolution, width * dprScale, height * dprScale);
        gl.uniform2f(uniforms.uOffset, offset.current.x * dprScale, offset.current.y * dprScale);
        gl.uniform1f(uniforms.uTileW, p.tileWidth * dprScale);
        gl.uniform1f(uniforms.uTileH, p.tileHeight * dprScale);
        gl.uniform1f(uniforms.uGap, p.gap * dprScale);
        gl.uniform1f(uniforms.uBorderRadius, p.borderRadius * dprScale);
        gl.uniform1f(uniforms.uCurve, p.curve);
        gl.uniform1f(uniforms.uCurveRadius, p.curveRadius);
        gl.uniform1f(uniforms.uZoom, p.zoom);
        gl.uniform1f(uniforms.uTileRotation, (p.tileRotation * Math.PI) / 180);
        gl.uniform1f(uniforms.uGrayscale, p.grayscale);
        gl.uniform1f(uniforms.uVignette, p.vignette);
        const [br, bgc, bb, ba] = parseCssColor(p.backgroundColor);
        gl.uniform4f(uniforms.uBgColor, br, bgc, bb, ba);
        gl.uniform1i(uniforms.uAtlas, 0);
        gl.uniform1f(uniforms.uAtlasCols, atlasInfoRef.current.cols);
        gl.uniform1f(uniforms.uAtlasRows, atlasInfoRef.current.rows);
        gl.uniform1f(uniforms.uAtlasCount, atlasInfoRef.current.count);
        gl.uniform1f(uniforms.uSeed, p.seed);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      atlasAbort.abort();
      clearTimeout(healTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    };
    // Runs once: prop changes are read live via propsRef inside the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Given a point in CSS pixels (relative to the container), replays the
  // same forward math as the fragment shader to find which cell was hit.
  const hitTest = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const p = propsRef.current;
    const width = rect.width;
    const height = rect.height;
    const center = { x: width / 2, y: height / 2 };
    const d = { x: px - center.x, y: py - center.y };
    const r = Math.hypot(d.x, d.y);
    const dir = r > 0.0001 ? { x: d.x / r, y: d.y / r } : { x: 0, y: 0 };

    const halfDiag = Math.max(Math.hypot(center.x, center.y), 1);
    const lensReach = Math.max(halfDiag * p.curveRadius, 1);
    const k = p.curve / (lensReach * lensReach);
    const kr2 = Math.min(k * r * r, 0.95);
    const distortedR = r / (1 + kr2);

    const zoomFactor = Math.max(1 + p.zoom, 0.01);
    const sampleX = center.x + dir.x * (distortedR / zoomFactor);
    const sampleY = center.y + dir.y * (distortedR / zoomFactor);

    const gridX = sampleX + offset.current.x;
    const gridY = sampleY + offset.current.y;

    const cellW = p.tileWidth + p.gap;
    const cellH = p.tileHeight + p.gap;
    const col = Math.floor(gridX / cellW);
    const row = Math.floor(gridY / cellH);
    const localX = gridX - col * cellW - p.gap / 2;
    const localY = gridY - row * cellH - p.gap / 2;

    if (localX < 0 || localX > p.tileWidth || localY < 0 || localY > p.tileHeight) return null;

    const uniqueImages = Array.from(new Set(p.images));
    if (uniqueImages.length === 0) return null;
    const uniqueIdx = hashCellToIndex(col, row, p.seed, uniqueImages.length);
    const src = uniqueImages[uniqueIdx];
    const index = p.images.indexOf(src);
    return { src, index: index === -1 ? 0 : index };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!enableDrag) return;
      dragging.current = true;
      dragMoved.current = false;
      velocity.current = { x: 0, y: 0 };
      lastPointer.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [enableDrag]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!enableDrag || !dragging.current) return;
      const now = performance.now();
      const dt = Math.max(now - lastPointer.current.t, 1);
      let dx = (e.clientX - lastPointer.current.x) * dragSensitivity;
      let dy = (e.clientY - lastPointer.current.y) * dragSensitivity;
      if (axis === "x") dy = 0;
      if (axis === "y") dx = 0;

      if (Math.abs(e.clientX - lastPointer.current.x) > 2 || Math.abs(e.clientY - lastPointer.current.y) > 2) {
        dragMoved.current = true;
      }

      // Subtract, not add: a fixed grid feature appears at screen position
      // (sample(screenPos) - offset), so offset must move opposite to the
      // pointer for content to actually follow the drag ("grab and move").
      offset.current.x -= dx;
      offset.current.y -= dy;

      velocity.current.x = -(dx / dt) * 16;
      velocity.current.y = -(dy / dt) * 16;

      lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
    },
    [enableDrag, dragSensitivity, axis]
  );

  const endDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  const onClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragMoved.current) return; // was a drag, not a tap
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      if (openOnClick) setLightbox(hit);
      onTileClick?.(hit.index, hit.src);
    },
    [hitTest, openOnClick, onTileClick]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!enableWheel) return;
      e.preventDefault();
      let dx = e.deltaX * wheelSensitivity;
      let dy = e.deltaY * wheelSensitivity;
      if (axis === "x") dy = 0;
      if (axis === "y") dx = 0;
      // Opposite sign from drag on purpose: a wheel/trackpad gesture follows
      // traditional "scroll" semantics (scrolling down reveals more content
      // below, i.e. content moves up), whereas dragging grabs and moves the
      // content 1:1 with the cursor.
      offset.current.x += dx;
      offset.current.y += dy;
      // Feed a modest amount into the same velocity used by drag so
      // wheel/trackpad input keeps gliding briefly via the friction-based
      // momentum loop instead of stopping dead on every discrete notch.
      // With the default friction (0.9) this adds roughly 3x the current
      // tick's delta as a decaying tail, not a runaway multiplier.
      velocity.current.x = dx * 0.4;
      velocity.current.y = dy * 0.4;
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [enableWheel, wheelSensitivity, axis]);

  return (
    <div
      ref={containerRef}
      className={`inverted-dome-root${className ? ` ${className}` : ""}`}
      style={{ cursor: enableDrag ? "grab" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        endDrag();
        onClick(e);
      }}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
    >
      <canvas ref={canvasRef} className="inverted-dome-canvas" />

      {children}

      {openOnClick && lightbox && (
        <div className="inverted-dome-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt="" />
        </div>
      )}
    </div>
  );
}
