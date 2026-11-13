import { useState } from "react";
import { elevationColor, trackDepthColor } from "./dem";

type Rgb = [number, number, number];

const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

/** A horizontal colour bar for a value range; the last tick reads "N+" when colours saturate beyond it. */
function ColorBar({ label, max, color, ticks }: { label: string; max: number; color: (v: number) => Rgb; ticks: number[] }) {
  const stops = Array.from({ length: 13 }, (_, k) => {
    const v = (k / 12) * max;
    return `${css(color(v))} ${((k / 12) * 100).toFixed(1)}%`;
  });
  return (
    <div>
      <p className="mb-0.5">{label}</p>
      <div className="h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }} />
      <div className="relative h-3 font-mono">
        {ticks.map((t, k) => (
          <span
            key={t}
            className="absolute"
            style={{ left: `${(t / max) * 100}%`, transform: `translateX(${k === 0 ? 0 : k === ticks.length - 1 ? -100 : -50}%)` }}
          >
            {t}
            {k === ticks.length - 1 ? "+" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Colour keys for the terrain and, when a track is drawn by depth, the track (both in metres below the surface). */
export function Legend({ track = false }: { track?: boolean }) {
  return (
    <div className="pointer-events-none absolute top-2 left-2 w-40 space-y-1 rounded bg-panel/85 px-2 py-1.5 text-[10px] text-muted">
      <ColorBar label="Seafloor depth (m)" max={3000} color={(d) => elevationColor(-d)} ticks={[0, 1000, 2000, 3000]} />
      {track && <ColorBar label="Animal depth (m)" max={600} color={trackDepthColor} ticks={[0, 200, 400, 600]} />}
    </div>
  );
}

export const ATTRIBUTION = "Topobathymetry: GEBCO 2025, GMRT (CC BY 4.0), NOAA BlueTopo, NCEI BAG; fused by topobathykit";

/** The data credits behind a small (i), for the map and the 3D view. */
export function Credits() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute right-2 bottom-2 flex items-end gap-1 text-[10px]">
      {open && <p className="max-w-72 rounded bg-panel/90 px-2 py-1 text-muted">{ATTRIBUTION}</p>}
      <button
        type="button"
        aria-label={open ? "Hide data credits" : "Show data credits"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-5 w-5 rounded-full border border-line bg-panel/90 font-serif text-xs text-muted italic hover:text-ink"
      >
        i
      </button>
    </div>
  );
}
