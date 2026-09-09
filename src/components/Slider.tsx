import type { CSSProperties } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

export default function Slider({ label, value, min, max, step, unit = "", onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const decimals = step < 1 ? 2 : 0;

  return (
    <label className="slider-row">
      <span className="slider-row-top">
        <span className="slider-label">{label}</span>
        <span className="slider-value">
          {value.toFixed(decimals)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ "--pct": `${pct}%` } as CSSProperties}
      />
    </label>
  );
}
