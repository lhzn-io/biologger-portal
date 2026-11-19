import { useEffect, useMemo, useRef, useState } from "react";
import { valueAt } from "./playback";
import { availableSeries, envelope, indexAtFraction, nightColumns, type StripSeries } from "./strip";
import { indexAt, type Track } from "./track";

const HEIGHT = 84; // the plot, CSS px
const STORE = "biologger.studioStrip"; // the viewer's chosen series, kept in this browser only

function readChosen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : ["depth"];
  } catch {
    return ["depth"];
  }
}

function fmt(v: number, s: StripSeries): string {
  if (!Number.isFinite(v)) return "--";
  return `${v.toFixed(s.digits)}${s.unit === "°" ? "°" : ` ${s.unit}`}`;
}

/**
 * The studio view's timeline: the chosen series drawn see-through over the 3D view, night shaded, the fixes marked,
 * and the time cursor. A click or drag anywhere on it moves the cursor; with it focused, the arrow keys step (shift
 * for ten times as far).
 */
export default function StudioStrip({
  track,
  cursor,
  onCursor,
  right,
}: {
  track: Track;
  cursor: number;
  onCursor: (i: number) => void;
  /** CSS px kept clear on the right, for the physics inspector. */
  right: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [chosen, setChosen] = useState<string[]>(readChosen);
  const series = useMemo(() => availableSeries(track), [track]);
  // Each series' values, computed once per track (dynamic acceleration is derived from three columns).
  const data = useMemo(() => new Map(series.map((s) => [s.key, s.values(track)!])), [series, track]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Keyed on the choice, not the array, so playback (a new cursor every frame) does not redo the envelopes.
  const chosenKey = chosen.join(",");
  const shown = useMemo(() => series.filter((s) => chosenKey.split(",").includes(s.key)), [series, chosenKey]);
  const paths = useMemo(() => {
    if (width < 2) return [];
    return shown.map((s) => {
      const { lo, hi, min, max } = envelope(data.get(s.key)!, width);
      const span = max - min || 1;
      const y = (v: number) => {
        const f = (v - min) / span;
        return 2 + (s.down ? f : 1 - f) * (HEIGHT - 4);
      };
      // The envelope as one closed band: along the column maxima, back along the minima.
      let d = "";
      let open = false;
      const top: string[] = [];
      const flush = (bottom: string[]) => {
        if (top.length) d += `M${top.join("L")}L${bottom.reverse().join("L")}Z`;
        top.length = 0;
      };
      let bottom: string[] = [];
      for (let c = 0; c < width; c++) {
        if (Number.isFinite(lo[c]!)) {
          top.push(`${c},${y(s.down ? lo[c]! : hi[c]!).toFixed(1)}`);
          bottom.push(`${c + 1},${y(s.down ? hi[c]! : lo[c]!).toFixed(1)}`);
          open = true;
        } else if (open) {
          flush(bottom);
          bottom = [];
          open = false;
        }
      }
      flush(bottom);
      return { key: s.key, color: s.color, d };
    });
  }, [shown, data, width]);
  const nights = useMemo(() => (width > 1 ? nightColumns(track, width) : []), [track, width]);
  const fixes = track.manifest.fixes.map((f) => ({ kind: f.kind, x: (indexAt(track, f.t) / Math.max(1, track.count - 1)) * width }));
  const x = (cursor / Math.max(1, track.count - 1)) * width;

  const seekAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    onCursor(indexAtFraction(track, (clientX - r.left) / r.width));
  };
  const toggle = (key: string) => {
    const next = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key];
    setChosen(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // a private window or blocked storage: the choice lasts for this page only
    }
  };

  return (
    <div
      className="absolute bottom-14 left-2 rounded border border-line/60 bg-panel/40 px-2 pt-1 pb-1.5 text-[11px] backdrop-blur-[1px]"
      style={{ right }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5" role="group" aria-label="Series on the timeline">
        {series.map((s) => {
          const on = chosen.includes(s.key);
          const v = valueAt(data.get(s.key)!, cursor);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              title={on ? `Hide ${s.label}` : `Show ${s.label}`}
              className={`flex items-center gap-1 rounded px-1 ${on ? "text-ink" : "text-muted opacity-70 hover:opacity-100"}`}
              onClick={() => toggle(s.key)}
            >
              <span style={{ color: s.color }}>{on ? "■" : "□"}</span>
              {s.label}
              {on && <span className="font-mono text-muted">{fmt(v, s)}</span>}
            </button>
          );
        })}
      </div>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Time along the track"
        aria-valuemin={0}
        aria-valuemax={track.count - 1}
        aria-valuenow={Math.round(cursor)}
        className="relative cursor-ew-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const step = Math.max(1, Math.round(track.count / Math.max(1, width))) * (e.shiftKey ? 10 : 1);
          onCursor(Math.max(0, Math.min(track.count - 1, Math.round(cursor) + (e.key === "ArrowLeft" ? -step : step))));
        }}
      >
        <svg width={width} height={HEIGHT} className="block">
          {nights.map(([a, b]) => (
            <rect key={a} x={a} y={0} width={b - a} height={HEIGHT} fill="#0b1220" opacity={0.35} />
          ))}
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill={p.color} fillOpacity={0.55} stroke={p.color} strokeOpacity={0.8} strokeWidth={0.6} />
          ))}
          {fixes.map((f) => (
            <g key={f.kind}>
              <line x1={f.x} x2={f.x} y1={0} y2={HEIGHT} stroke="#e2e8f0" strokeOpacity={0.5} strokeDasharray="2 3" />
              <text x={f.x + 3} y={10} fill="#e2e8f0" fillOpacity={0.7} fontSize={9}>
                {f.kind} fix
              </text>
            </g>
          ))}
          <line x1={x} x2={x} y1={0} y2={HEIGHT} stroke="#facc15" strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  );
}
