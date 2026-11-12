import { useEffect, useMemo, useRef } from "react";
import { markAsOf, renderLines, type Line } from "@lhzn-io/timecharts/chart";
import { timeTrack } from "@lhzn-io/timecharts/time-axis";
import "@lhzn-io/timecharts/tokens.css";
import "./charts.css";
import { elevationAt, type Dem } from "./dem";
import { indexAt, strideIndices, timeOf, type Track } from "./track";

const CHART_POINTS = 1500;
const ZONE = "UTC";

export interface ChartSeries {
  id: string;
  title: string;
  unit: string;
  xs: number[];
  lines: Line[];
}

/** The series the charts draw, from the same arrays the map and 3D view use (and the Collect prompt reads). */
export function chartSeries(track: Track, dem: Dem | null): ChartSeries[] {
  const idx = strideIndices(track.count, CHART_POINTS);
  const xs = idx.map((i) => timeOf(track, i));
  const pick = (a: Float32Array) => idx.map((i) => a[i]!);
  const seafloor = dem ? idx.map((i) => elevationAt(dem, track.lat[i]!, track.lon[i]!)) : null;
  const depthLines: Line[] = [{ ys: pick(track.depth).map((d) => -d), color: "#fbbf24", label: "Animal", fmt: (v) => `${(-v).toFixed(0)} m` }];
  if (seafloor) depthLines.push({ ys: seafloor, color: "#94a3b8", label: "Seafloor (DEM)", dash: "3 2", fmt: (v) => `${(-v).toFixed(0)} m` });
  return [
    { id: "depth", title: "Depth (m, below the surface)", unit: "m", xs, lines: depthLines },
    { id: "vedba", title: `VeDBA (${track.units.vedba || "m/s^2"})`, unit: "", xs, lines: [{ ys: pick(track.vedba), color: "#3b9cff", label: "VeDBA" }] },
    {
      id: "attitude",
      title: "Pitch and roll (degrees)",
      unit: "deg",
      xs,
      lines: [
        { ys: pick(track.pitch), color: "#34d399", label: "Pitch" },
        { ys: pick(track.roll), color: "#f472b6", label: "Roll", opacity: 0.8 },
      ],
    },
  ];
}

function Chart({ series, onTime }: { series: ChartSeries; onTime: (t: number) => void }) {
  const plot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    let rendered = renderLines(el, { xs: series.xs, lines: series.lines, unit: series.unit, timeZone: ZONE });
    const ro = new ResizeObserver(() => {
      rendered = renderLines(el, { xs: series.xs, lines: series.lines, unit: series.unit, timeZone: ZONE });
    });
    ro.observe(el);
    const click = (e: MouseEvent) => onTime(rendered.timeAt(e.clientX));
    el.addEventListener("click", click);
    return () => {
      ro.disconnect();
      el.removeEventListener("click", click);
    };
  }, [series, onTime]);
  return (
    <figure data-collect-target={`chart-${series.id}`}>
      <figcaption className="mb-1 text-xs text-muted">
        {series.title}
        <span className="ml-3">
          {series.lines.map((l) => (
            <span key={l.label} className="mr-3">
              <i className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div ref={plot} className="plot">
        <svg />
        <div className="plot-labels" />
      </div>
    </figure>
  );
}

/** Linked charts and the time track; clicking a chart or dragging the track moves the shared cursor. */
export default function Charts({
  track,
  dem,
  cursor,
  onCursor,
}: {
  track: Track;
  dem: Dem | null;
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const series = useMemo(() => chartSeries(track, dem), [track, dem]);
  const slot = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const onTime = useMemo(() => (t: number) => onCursor(indexAt(track, t)), [track, onCursor]);

  // The time track dresses a plain range input (timeTrack replaces it in the DOM), so it is built here, not by React.
  useEffect(() => {
    const host = slot.current;
    if (!host) return;
    host.replaceChildren();
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = String(track.count - 1);
    range.step = "1";
    range.value = "0";
    range.setAttribute("aria-label", "Time along the track");
    host.append(range);
    timeTrack(range, (v) => timeOf(track, Math.round(v)), { timeZone: ZONE });
    const onInput = () => onCursor(Number(range.value));
    range.addEventListener("input", onInput);
    input.current = range;
    return () => range.removeEventListener("input", onInput);
  }, [track, onCursor]);

  useEffect(() => {
    if (input.current && input.current.value !== String(cursor)) input.current.value = String(cursor);
    markAsOf(timeOf(track, cursor));
  }, [track, cursor]);

  return (
    <div className="space-y-3">
      <div ref={slot} />
      {series.map((s) => (
        <Chart key={s.id} series={s} onTime={onTime} />
      ))}
    </div>
  );
}
