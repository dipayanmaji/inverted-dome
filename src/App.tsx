import { useEffect, useRef, useState } from "react";
import InvertedDome from "./components/InvertedDome";
import Slider from "./components/Slider";
import { useImageManifest } from "./useImageManifest";
import "./App.css";

export default function App() {
  const images = useImageManifest();
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);

  // Measured (not guessed) so the collapse animation stays correct however
  // many controls end up in the panel. Height starts as `null` (rendered as
  // "none") so the panel appears at full size instantly on first paint
  // instead of visibly animating open before anything has been measured.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyHeight(el.scrollHeight));
    ro.observe(el);
    setBodyHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, []);

  const [curve, setCurve] = useState(0.75);
  const [curveRadius, setCurveRadius] = useState(1.4);
  const [zoom, setZoom] = useState(0);
  const [tileWidth, setTileWidth] = useState(150);
  const [tileHeight, setTileHeight] = useState(150);
  const [gap, setGap] = useState(16);
  const [borderRadius, setBorderRadius] = useState(16);
  const [tileRotation, setTileRotation] = useState(0);
  const [grayscale, setGrayscale] = useState(1);
  const [vignette, setVignette] = useState(0.35);

  return (
    <div className="app-root">
      <InvertedDome
        images={images}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        gap={gap}
        borderRadius={borderRadius}
        curve={curve}
        curveRadius={curveRadius}
        zoom={zoom}
        tileRotation={tileRotation}
        grayscale={grayscale}
        vignette={vignette}
        openOnClick
        onTileClick={(index, src) => console.log("tile clicked", index, src)}
      />

      <div className={`controls${collapsed ? " collapsed" : ""}`}>
        <div className="controls-header">
          <div>
            <h1>Inverted Dome</h1>
            <p className="hint">Drag or scroll the grid. Click a tile to open it.</p>
          </div>
          <button
            type="button"
            className="toggle-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div
          className="controls-body-wrapper"
          style={{ maxHeight: collapsed ? 0 : bodyHeight ?? "none" }}
        >
          <div className="controls-body" ref={bodyRef}>
            <div className="section-label">Lens</div>
            <Slider label="Curve" value={curve} min={0} max={1} step={0.01} onChange={setCurve} />
            <Slider label="Curve Radius" value={curveRadius} min={0.3} max={3} step={0.01} onChange={setCurveRadius} />
            <Slider label="Zoom" value={zoom} min={0} max={1} step={0.01} onChange={setZoom} />

            <div className="section-label">Tile</div>
            <Slider label="Tile Width" value={tileWidth} min={80} max={400} step={1} unit="px" onChange={setTileWidth} />
            <Slider
              label="Tile Height"
              value={tileHeight}
              min={80}
              max={400}
              step={1}
              unit="px"
              onChange={setTileHeight}
            />
            <Slider label="Gap" value={gap} min={0} max={64} step={1} unit="px" onChange={setGap} />
            <Slider
              label="Border Radius"
              value={borderRadius}
              min={0}
              max={100}
              step={1}
              unit="px"
              onChange={setBorderRadius}
            />
            <Slider
              label="Tile Rotation"
              value={tileRotation}
              min={-45}
              max={45}
              step={1}
              unit="°"
              onChange={setTileRotation}
            />

            <div className="section-label">Style</div>
            <Slider label="Grayscale" value={grayscale} min={0} max={1} step={0.01} onChange={setGrayscale} />
            <Slider label="Vignette" value={vignette} min={0} max={1} step={0.01} onChange={setVignette} />
          </div>
        </div>
      </div>
    </div>
  );
}
