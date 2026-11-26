import { useState, type ReactNode } from "react";
import { activityColor, type ActivityScale } from "./activity";
import { currentColor, currentRampColor, donorCredit, modelPhrase, type CurrentScale } from "./current";
import type { OceanModel } from "./track";
import { LENGTH_FULL_M_S } from "./currentArrows";
import { elevationColor, trackDepthColor, type DepthScale } from "./dem";

type Rgb = [number, number, number];

const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

/**
 * A horizontal color bar for a value range. With `open`, the last tick reads "N+" because colors saturate
 * beyond it; a scale fitted to the data it colors has no values past its end.
 */
function ColorBar({
  label,
  note,
  max,
  color,
  ticks,
  open = true,
}: {
  label: string;
  note?: ReactNode;
  max: number;
  color: (v: number) => Rgb;
  ticks: number[];
  open?: boolean;
}) {
  const stops = Array.from({ length: 13 }, (_, k) => {
    const v = (k / 12) * max;
    return `${css(color(v))} ${((k / 12) * 100).toFixed(1)}%`;
  });
  return (
    <div>
      <p className="mb-0.5">{label}</p>
      {note && <p className="-mt-0.5 mb-0.5 opacity-80">{note}</p>}
      <div className="h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }} />
      <div className="relative h-3 font-mono">
        {ticks.map((t, k) => (
          <span
            key={t}
            className="absolute"
            style={{ left: `${(t / max) * 100}%`, transform: `translateX(${k === 0 ? 0 : k === ticks.length - 1 ? -100 : -50}%)` }}
          >
            {t}
            {open && k === ticks.length - 1 ? "+" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

const ARROW_KEY_MIN = 0.02;
const ARROW_KEY_MAX = 3.1;
const ARROW_TICKS = [0.02, 0.1, 0.5, 3.1];

/** The current arrows' key: the standard currents ramp on its log speed scale, both tables (by seafloor). */
function ArrowKey({ model, tilt }: { model: OceanModel; tilt: number | null }) {
  const at = (f: number) => ARROW_KEY_MIN * (ARROW_KEY_MAX / ARROW_KEY_MIN) ** f;
  const bar = (table: "light" | "dark") =>
    `linear-gradient(to right, ${Array.from({ length: 13 }, (_, k) => `${css(currentRampColor(at(k / 12), table))} ${((k / 12) * 100).toFixed(1)}%`).join(", ")})`;
  const pos = (v: number) => (Math.log(v / ARROW_KEY_MIN) / Math.log(ARROW_KEY_MAX / ARROW_KEY_MIN)) * 100;
  return (
    <div>
      <p className="mb-0.5">Current arrows (m/s)</p>
      <p className="-mt-0.5 mb-0.5 opacity-80">
        {modelPhrase(model)}; head on the track, tail upstream; full length at {LENGTH_FULL_M_S}
        {tilt != null && `; tilted by the vertical current, x${tilt} like the depth`}
      </p>
      <div className="h-1 rounded-t-sm" title="over shallow seafloor" style={{ background: bar("dark") }} />
      <div className="h-1 rounded-b-sm" title="over deep seafloor" style={{ background: bar("light") }} />
      <div className="relative h-3 font-mono">
        {ARROW_TICKS.map((t, k) => (
          <span
            key={t}
            className="absolute"
            style={{ left: `${pos(t)}%`, transform: `translateX(${k === 0 ? 0 : k === ARROW_TICKS.length - 1 ? -100 : -50}%)` }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Color keys for the terrain and the track: by depth (`depth`, meters below the surface; `species` names whose
 * tracks a species scale spans), by ODBA (`activity`) or by the applied current's speed (`current`); and for the
 * current arrows (`arrows`, the current's scale when they are drawn).
 */
export function Legend({
  depth,
  activity,
  current,
  arrows,
  arrowTilt = null,
  species,
}: {
  depth?: DepthScale | null;
  activity?: ActivityScale | null;
  current?: CurrentScale | null;
  /** The current arrows are drawn (the current's scale, for the model's name). */
  arrows?: CurrentScale | null;
  /** The arrows tilt with the vertical current: the scene's vertical exaggeration, else null. */
  arrowTilt?: number | null;
  species?: string;
}) {
  return (
    <div className="pointer-events-none absolute top-2 left-2 w-44 space-y-1 rounded bg-panel/85 px-2 py-1.5 text-[10px] text-muted">
      <ColorBar label="Seafloor depth (m)" max={3000} color={(d) => elevationColor(-d)} ticks={[0, 1000, 2000, 3000]} />
      {depth && (
        <ColorBar
          label="Animal depth (m)"
          note={depth.basis === "species" && species ? <>all <i>{species}</i> tracks</> : "this track only"}
          max={depth.max}
          color={(d) => trackDepthColor(d, depth.max)}
          ticks={depth.ticks}
          open={false}
        />
      )}
      {activity && (
        <ColorBar
          label={`Animal ODBA (${activity.unit})`}
          note={`mean per ${Math.round(activity.stretch_s)} s (per sample up close), this track`}
          max={activity.max}
          color={(v) => activityColor(v, activity.max)}
          ticks={activity.ticks}
        />
      )}
      {current && (
        <ColorBar
          label="Ocean current (m/s)"
          note={`${modelPhrase(current.model)}, mean per ${Math.round(current.stretch_s)} s (per sample up close); gray: no value`}
          max={current.max}
          color={(v) => currentColor(v, current.max)}
          ticks={current.ticks}
        />
      )}
      {arrows && <ArrowKey model={arrows.model} tilt={arrowTilt} />}
    </div>
  );
}

const ATTRIBUTION = "Topobathymetry: GEBCO 2025, GMRT (CC BY 4.0), NOAA BlueTopo, NCEI BAG; fused by topobathykit";

/**
 * The data credits behind a small (i), for the map and the 3D view: the terrain, and the ocean model of every shown
 * track with a current correction (`donors`, as the bundles name them).
 */
export function Credits({ donors = [] }: { donors?: (OceanModel | string | null | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const ocean = [...new Set(donors.map(donorCredit).filter((c): c is string => c != null))];
  return (
    <div className="absolute right-2 bottom-2 flex items-end gap-1 text-[10px]">
      {open && (
        <div className="max-w-72 space-y-0.5 rounded bg-panel/90 px-2 py-1 text-muted">
          <p>{ATTRIBUTION}</p>
          {ocean.map((c) => (
            <p key={c}>{c}</p>
          ))}
        </div>
      )}
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
