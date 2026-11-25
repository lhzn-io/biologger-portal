import { useState } from "react";
import type { DepthScale } from "./dem";
import type { InspectorFrame } from "./inspector";
import type { ChartPick, TrackColor } from "./link";

const PICKS: { value: ChartPick; label: string; note: string }[] = [
  { value: "lock", label: "Lock the view", note: "only the cursor moves" },
  { value: "look", label: "Turn to the animal", note: "the camera stays put and faces it" },
  { value: "center", label: "Center on the animal", note: "the camera moves, keeping its distance and angle" },
];

const btn = "rounded border border-line bg-panel/90 px-2 py-0.5 text-muted hover:text-ink";

/** Body lengths per 1 m/s the physics inspector can draw its arrows at. */
const INSPECTOR_SCALES = [0.5, 1, 2, 4];

/**
 * The 3D view's controls, top right: zoom to the animal and reset the view always shown, the rest (vertical
 * exaggeration, following the animal, the depth color scale) behind "Controls".
 */
export default function SceneControls({
  onFocus,
  studio,
  onStudio,
  fullscreen,
  onFullscreen,
  onHome,
  exaggeration,
  onExaggeration,
  follow,
  onFollow,
  basis,
  onBasis,
  pick,
  onPick,
  trackColor,
  onTrackColor,
  hasOdba,
  hasCurrent,
  speciesScale,
  trackScale,
  species,
  inspector,
  onInspector,
  inspectorScale,
  onInspectorScale,
  arrows,
  onArrows,
  tilt,
  onTilt,
  hasVertical,
  hover,
  onHover,
}: {
  onFocus: () => void;
  /** The view fills the browser window. */
  studio: boolean;
  onStudio: () => void;
  /** The view is in the browser's full screen. */
  fullscreen: boolean;
  onFullscreen: () => void;
  onHome: () => void;
  exaggeration: number;
  onExaggeration: (x: number) => void;
  follow: boolean;
  onFollow: (on: boolean) => void;
  basis: DepthScale["basis"];
  onBasis: (b: DepthScale["basis"]) => void;
  /** The species scale, or null when the track has no species to share one with. */
  speciesScale: DepthScale | null;
  /** What a click on an "Along the track" chart does to the camera. */
  pick: ChartPick;
  onPick: (p: ChartPick) => void;
  trackColor: TrackColor;
  onTrackColor: (c: TrackColor) => void;
  /** The track bundle has an ODBA column. */
  hasOdba: boolean;
  /** The track bundle has the applied ocean current. */
  hasCurrent: boolean;
  trackScale: DepthScale;
  species?: string;
  /** The physics inspector when shown (always drawn locked to the heading; a link's old "north" also shows it), or null. */
  inspector: InspectorFrame | null;
  onInspector: (frame: InspectorFrame | null) => void;
  /** Body lengths per 1 m/s in the inspector. */
  inspectorScale: number;
  onInspectorScale: (scale: number) => void;
  /** Current arrows along the track are shown. */
  arrows: boolean;
  onArrows: (on: boolean) => void;
  /** The arrows tilt with the vertical current. */
  tilt: boolean;
  onTilt: (on: boolean) => void;
  /** The track's model gives a vertical current. */
  hasVertical: boolean;
  /** The hover readout is shown. */
  hover: boolean;
  onHover: (on: boolean) => void;
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
        {!fullscreen && (
          <button type="button" className={btn} onClick={onStudio} title="Fill the browser window with the 3D view (Esc to leave)">
            {studio ? "Exit studio" : "Studio"}
          </button>
        )}
        {document.fullscreenEnabled && (
          <button type="button" className={btn} onClick={onFullscreen} title="Show the 3D view full screen (Esc to leave)">
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        )}
        <button
          type="button"
          className={inspector ? `${btn} text-ink` : btn}
          aria-pressed={!!inspector}
          onClick={() => onInspector(inspector ? null : "heading")}
          title="The animal at its attitude, with its velocities through the water, of the current and over the ground"
        >
          Physics
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
            <legend className="mb-1">Track color</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="track-color"
                className="mt-0.5"
                checked={trackColor === "depth" || (trackColor === "odba" && !hasOdba) || (trackColor === "current" && !hasCurrent)}
                onChange={() => onTrackColor("depth")}
              />
              <span>Animal depth</span>
            </label>
            <label className={`flex items-start gap-2 ${hasOdba ? "" : "opacity-50"}`}>
              <input type="radio" name="track-color" className="mt-0.5" disabled={!hasOdba} checked={trackColor === "odba" && hasOdba} onChange={() => onTrackColor("odba")} />
              <span>
                ODBA (body acceleration)
                <span className="block opacity-80">{hasOdba ? "an activity measure, averaged along the line" : "not in this track bundle"}</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 ${hasCurrent ? "" : "opacity-50"}`}>
              <input
                type="radio"
                name="track-color"
                className="mt-0.5"
                disabled={!hasCurrent}
                checked={trackColor === "current" && hasCurrent}
                onChange={() => onTrackColor("current")}
              />
              <span>
                Ocean current speed
                <span className="block opacity-80">
                  {hasCurrent ? "the model current the track was corrected with, averaged along the line" : "no current correction in this track"}
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-2 ${hasCurrent ? "" : "opacity-50"}`}>
              <input type="checkbox" className="mt-0.5" disabled={!hasCurrent} checked={arrows && hasCurrent} onChange={(e) => onArrows(e.target.checked)} />
              <span>
                Current arrows
                <span className="block opacity-80">{hasCurrent ? "where the water flows; longer is faster" : "no current correction in this track"}</span>
              </span>
            </label>
            <label className={`ml-5 flex items-start gap-2 ${arrows && hasVertical ? "" : "opacity-50"}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!arrows || !hasVertical}
                checked={tilt && hasVertical}
                onChange={(e) => onTilt(e.target.checked)}
              />
              <span>
                Tilt with the vertical current
                <span className="block opacity-80">{hasVertical ? "rising or sinking water, exaggerated like the depth" : "this model gives no vertical current"}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={hover} onChange={(e) => onHover(e.target.checked)} />
              <span>
                Hover readout
                <span className="block opacity-80">the values under the pointer, on the track or an arrow</span>
              </span>
            </label>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1">Physics inspector</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={inspector !== null} onChange={(e) => onInspector(e.target.checked ? "heading" : null)} />
              Show
            </label>
            <label className="flex items-center gap-2">
              Arrows
              <select
                className="rounded border border-line bg-surface px-1"
                value={inspectorScale}
                onChange={(e) => onInspectorScale(Number(e.target.value))}
              >
                {INSPECTOR_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s} body {s === 1 ? "length" : "lengths"} per 1 m/s
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1">A click on a chart below</legend>
            {PICKS.map((p) => (
              <label key={p.value} className="flex items-start gap-2">
                <input type="radio" name="chart-pick" className="mt-0.5" checked={pick === p.value} onChange={() => onPick(p.value)} />
                <span>
                  {p.label}
                  <span className="block opacity-80">{p.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1">Animal depth colors</legend>
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
