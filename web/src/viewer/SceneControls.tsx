import { useState } from "react";
import type { DepthScale } from "./dem";

const btn = "rounded border border-line bg-panel/90 px-2 py-0.5 text-muted hover:text-ink";

/**
 * The 3D view's controls, top right: zoom to the animal and reset the view always shown, the rest (vertical
 * exaggeration, following the animal, the depth colour scale) behind "Controls".
 */
export default function SceneControls({
  onFocus,
  onHome,
  exaggeration,
  onExaggeration,
  follow,
  onFollow,
  basis,
  onBasis,
  speciesScale,
  trackScale,
  species,
}: {
  onFocus: () => void;
  onHome: () => void;
  exaggeration: number;
  onExaggeration: (x: number) => void;
  follow: boolean;
  onFollow: (on: boolean) => void;
  basis: DepthScale["basis"];
  onBasis: (b: DepthScale["basis"]) => void;
  /** The species scale, or null when the track has no species to share one with. */
  speciesScale: DepthScale | null;
  trackScale: DepthScale;
  species?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute top-2 right-2 flex flex-col items-end gap-1 text-xs">
      <div className="flex gap-1">
        <button type="button" className={btn} onClick={onFocus} title="Glide to the animal at the cursor time">
          Zoom to animal
        </button>
        <button type="button" className={btn} onClick={onHome}>
          Reset view
        </button>
        <button type="button" className={btn} aria-expanded={open} aria-controls="scene-controls" onClick={() => setOpen(!open)}>
          Controls {open ? "▴" : "▾"}
        </button>
      </div>
      {open && (
        <div id="scene-controls" className="w-64 space-y-3 rounded border border-line bg-panel/95 p-3 text-muted">
          <label className="block">
            Vertical exaggeration {exaggeration}x
            <input
              type="range"
              className="mt-1 block w-full"
              min={1}
              max={20}
              value={exaggeration}
              onChange={(e) => onExaggeration(Number(e.target.value))}
            />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={follow} onChange={(e) => onFollow(e.target.checked)} />
            <span>
              Follow the animal
              <span className="block opacity-80">the view orbits it as it moves; drag to circle, wheel to zoom</span>
            </span>
          </label>
          <fieldset className="space-y-1">
            <legend className="mb-1">Animal depth colours</legend>
            <label className={`flex items-start gap-2 ${speciesScale ? "" : "opacity-50"}`}>
              <input
                type="radio"
                name="depth-basis"
                className="mt-0.5"
                disabled={!speciesScale}
                checked={basis === "species" && !!speciesScale}
                onChange={() => onBasis("species")}
              />
              <span>
                Same for every {species ? <i>{species}</i> : "species"} track
                {speciesScale ? ` (0 to ${speciesScale.max} m)` : " (no species recorded)"}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="depth-basis"
                className="mt-0.5"
                checked={basis === "track" || !speciesScale}
                onChange={() => onBasis("track")}
              />
              <span>This track only (0 to {trackScale.max} m)</span>
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
