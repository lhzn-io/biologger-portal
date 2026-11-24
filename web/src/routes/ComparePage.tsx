import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { GuideLink } from "../components/GuideLink";
import { Button, ErrorNote, Loading, Panel } from "../components/ui";
import CollectPanel from "../collect/CollectPanel";
import { lines } from "../collect/prompt";
import { chartText } from "../collect/texts";
import { useDeployment } from "../lib/queries";
import { trackHref } from "../lib/runLinks";
import type { TrackRow } from "../lib/types";
import { Chart, type ChartSeries } from "../viewer/Charts";
import {
  belowSeafloor,
  BELOW_FLOOR_MARGIN_M,
  convergenceNote,
  currentConvergence,
  currentSummary,
  describeVariant,
  metricValue,
  placementSummary,
  separation,
  seafloorUnder,
  variantColor,
  type VariantInfo,
} from "../viewer/compare";
import { loadDem, type Dem } from "../viewer/dem";
import { Credits } from "../viewer/Legend";
import { advance, DEFAULT_SPEED, SPEED_STEPS, speedLabel } from "../viewer/playback";
import { fmt } from "../viewer/readout";
import Scene3D, { type OtherTrack } from "../viewer/Scene3D";
import { indexAt, loadTrack, strideIndices, timeOf, type Track } from "../viewer/track";

const CHART_POINTS = 1500;

interface Variant {
  row: TrackRow;
  track: Track;
  dem: Dem | null;
  info: VariantInfo;
  color: string;
}

const km = (m: number | null | undefined, digits = 1) => (m == null || !Number.isFinite(m) ? "--" : (m / 1000).toFixed(digits));
const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "--" : `${(100 * x).toFixed(1)} %`);
const bearing = (north: number, east: number) => ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;


/**
 * Every reconstruction of one deployment side by side: the same tag data placed with and without the ocean current,
 * dead-reckoned and pinned to the end fix. One table, one 3D view (the selected track carries the animal, the others
 * a dot at the same time), and charts of the seafloor under each track and how far apart they run.
 */
export default function ComparePage() {
  const depId = decodeURIComponent(useParams().id ?? "");
  const dep = useDeployment(depId);
  const rows = useMemo(() => dep.data?.tracks ?? [], [dep.data]);
  const tracks = useQueries({
    queries: rows.map((r) => ({ queryKey: ["track", depId, r.run_id], queryFn: () => loadTrack(depId, r.run_id), staleTime: Infinity })),
  });
  const dems = useQueries({
    queries: rows.map((r) => ({ queryKey: ["dem", depId, r.run_id], queryFn: () => loadDem(depId, r.run_id), staleTime: Infinity, retry: 1 })),
  });
  const loaded = tracks.every((q) => q.data);
  // The query arrays are new on every render; this changes only when a track or DEM arrives.
  const dataKey = [...tracks, ...dems].map((q) => q.dataUpdatedAt).join(",");
  const variants = useMemo<Variant[]>(() => {
    if (!loaded) return [];
    const list = rows.map((row, k) => {
      const track = tracks[k]!.data!;
      return { row, track, dem: dems[k]?.data ?? null, info: describeVariant(track) };
    });
    list.sort((a, b) => a.info.order - b.info.order || a.row.run_id.localeCompare(b.row.run_id));
    let older = 0;
    return list.map((v) => ({ ...v, color: variantColor(v.info, v.info.current === undefined ? older++ : 0) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, rows, dataKey]);

  // Shown: the tracks with a pipeline record (the comparison set), or every track when none has one.
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const visible = useMemo(() => {
    if (shown) return shown;
    const recorded = variants.filter((v) => v.info.current !== undefined).map((v) => v.row.run_id);
    return new Set(recorded.length ? recorded : variants.map((v) => v.row.run_id));
  }, [shown, variants]);
  const primary =
    variants.find((v) => v.row.run_id === selected && visible.has(v.row.run_id)) ??
    variants.find((v) => visible.has(v.row.run_id) && v.info.placement === "fix_pinned" && v.info.current) ??
    variants.find((v) => visible.has(v.row.run_id)) ??
    variants[0];

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED * 10);
  const [exag, setExag] = useState(5);
  const pt = primary?.track;
  useEffect(() => {
    if (!pt || !playing) return;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      setCursor((prev) => {
        const next = advance(prev, dt, speed, pt.manifest.rate_hz);
        if (next >= pt.count - 1) {
          setPlaying(false);
          return pt.count - 1;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [pt, playing, speed]);

  const others = useMemo<OtherTrack[]>(
    () =>
      variants
        .filter((v) => v !== primary && visible.has(v.row.run_id))
        .map((v) => ({ key: v.row.run_id, track: v.track, color: v.color })),
    [variants, primary, visible],
  );

  const stats = useMemo(
    () =>
      new Map(
        variants.map((v) => [
          v.row.run_id,
          {
            current: currentSummary(v.track),
            unsettled: convergenceNote(currentConvergence(v.track)),
            placement: placementSummary(v.track),
            missBefore: metricValue(v.track, "end_fix_miss_before_placement"),
            miss: metricValue(v.track, "end_fix_miss"),
            floor: v.dem ? belowSeafloor(v.track, v.dem) : null,
          },
        ]),
      ),
    [variants],
  );

  const series = useMemo<ChartSeries[]>(() => {
    if (!primary) return [];
    const base = primary.track;
    const idx = strideIndices(base.count, CHART_POINTS);
    const xs = idx.map((i) => timeOf(base, i));
    const shownVariants = variants.filter((v) => visible.has(v.row.run_id));
    const depthLines = [
      { ys: idx.map((i) => -base.depth[i]!), color: "#e5e7eb", label: "Animal", fmt: (v: number) => `${(-v).toFixed(0)} m` },
      ...shownVariants
        .filter((v) => v.dem)
        .map((v) => ({
          ys: seafloorUnder(base, v.track, v.dem!, idx).map((d) => -d),
          color: v.color,
          dash: "3 2",
          width: 1.2,
          label: `Seafloor under: ${v.info.label}`,
          fmt: (x: number) => `${(-x).toFixed(0)} m`,
        })),
    ];
    const sepLines = shownVariants
      .filter((v) => v !== primary)
      .map((v) => ({ ys: separation(base, v.track, idx).map((m) => m / 1000), color: v.color, label: v.info.label, fmt: (x: number) => `${x.toFixed(2)} km` }));
    const out: ChartSeries[] = [
      {
        id: "compare-depth",
        title: "Depth, and the seafloor under each track (m)",
        unit: "m",
        xs,
        lines: depthLines,
        caption: "Depth is the same in every track; the seafloor differs. The animal below a seafloor line puts that track inside the seabed.",
        doc: "currents.html#comparing-reconstructions",
      },
    ];
    if (sepLines.length)
      out.push({
        id: "compare-separation",
        title: `Distance from the selected track (km): ${primary.info.label}`,
        unit: "km",
        xs,
        lines: sepLines,
        zero: true,
        caption: "Horizontal distance from the selected track at the same moment.",
        doc: "currents.html#comparing-reconstructions",
      });
    return out;
  }, [primary, variants, visible]);

  const onTime = useCallback((t: number) => pt && setCursor(indexAt(pt, t)), [pt]);

  if (dep.isLoading) return <Loading what={depId} />;
  if (dep.error || !dep.data) return <ErrorNote error={dep.error} />;
  if (rows.length === 0) return <p className="text-sm text-muted">{depId} has no tracks to compare.</p>;
  const failed = tracks.find((q) => q.error);
  if (failed) return <ErrorNote error={failed.error} />;
  if (!loaded || !primary || !pt) return <Loading what={`${rows.length} tracks`} />;
  const pos = Math.min(Math.max(cursor, 0), pt.count - 1);
  const i = Math.round(pos);
  const key = `compare:${depId}`;
  const recorded = variants.filter((v) => v.info.current !== undefined).length;

  const toggle = (run: string) => {
    const next = new Set(visible);
    if (next.has(run)) next.delete(run);
    else next.add(run);
    setShown(next);
  };
  const tableText = () =>
    variants
      .map((v) => {
        const s = stats.get(v.row.run_id)!;
        return lines([
          ["track", v.info.label],
          ["run_id", v.row.run_id],
          ["current", s.current ? `${s.current.donor}, ${pct(s.current.missingShare)} without a value` : v.info.current === undefined ? "unknown" : "none"],
          ["current_convergence", s.unsettled],
          ["current_drift_at_end_km", s.current?.driftEnd ? `${km(Math.hypot(s.current.driftEnd.north, s.current.driftEnd.east))} toward ${fmt(bearing(s.current.driftEnd.north, s.current.driftEnd.east), 0)} deg` : ""],
          ["end_fix_miss_before_placement_km", km(s.missBefore)],
          ["pinning", s.placement.scale != null ? `x${s.placement.scale.toFixed(3)}, ${fmt(s.placement.rotationDeg, 1)} deg` : ""],
          [`below_seafloor_by_more_than_${BELOW_FLOOR_MARGIN_M}_m`, s.floor ? `${pct(s.floor.share)} of samples, deepest ${fmt(s.floor.maxBelowM, 0)} m` : "no DEM"],
          ["sim_commit", `${v.row.sim_git_commit.slice(0, 7)}${v.row.sim_git_dirty ? " (dirty)" : ""}`],
        ]);
      })
      .join("\n\n");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-mono text-xl">
          <Link to={`/deployments/${encodeURIComponent(depId)}`} className="text-accent hover:underline">
            {depId}
          </Link>{" "}
          <span className="font-sans text-base text-muted">track comparison</span>
        </h1>
        <p className="text-sm text-muted">
          {recorded} {recorded === 1 ? "reconstruction" : "reconstructions"} of the same tag data
          {variants.length > recorded && `, plus ${variants.length - recorded} earlier ${variants.length - recorded === 1 ? "export" : "exports"} (hidden until ticked)`}
          ; only the fixes are measured. Click a row to follow a track. <GuideLink to="currents.html#comparing-reconstructions" />
        </p>
      </header>

      <CollectPanel id={`${key}:table`} title={`Track comparison, ${depId}`} text={tableText}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">Show</th>
                <th className="pr-4 font-normal">Track</th>
                <th className="pr-4 font-normal" title="The ocean model, and the share of the record where it had no value (still water used)">
                  Current
                </th>
                <th className="pr-4 font-normal" title="How far the current alone moved the track by its end">
                  Current drift at end
                </th>
                <th className="pr-4 font-normal" title="Distance from the end of the dead-reckoned track to the end fix, before any pinning">
                  Miss before pinning
                </th>
                <th className="pr-4 font-normal" title="Fix pinning's stretch and turn to bring the track onto the end fix">
                  Pinning
                </th>
                <th className="pr-4 font-normal" title={`Samples more than ${BELOW_FLOOR_MARGIN_M} m below the DEM seafloor under the track, and the deepest`}>
                  Below seafloor
                </th>
                <th className="font-normal">Simulator</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const s = stats.get(v.row.run_id)!;
                const on = visible.has(v.row.run_id);
                const isPrimary = v === primary;
                return (
                  <tr
                    key={v.row.run_id}
                    className={`cursor-pointer border-t border-line ${isPrimary ? "bg-surface" : ""} ${on ? "" : "opacity-50"}`}
                    onClick={() => {
                      if (!on) toggle(v.row.run_id);
                      setSelected(v.row.run_id);
                    }}
                  >
                    <td className="py-1.5 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={on} aria-label={`Show ${v.info.label}`} onChange={() => toggle(v.row.run_id)} />
                    </td>
                    <td className="pr-4">
                      <span className="mr-2 inline-block h-1 w-5 align-middle" style={{ background: v.color }} />
                      {v.info.label}
                      {isPrimary && <span className="ml-2 text-xs text-accent">(animal)</span>}
                      <Link
                        to={trackHref(rows, v.row)}
                        className="ml-2 font-mono text-xs text-muted hover:text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.row.run_id}
                      </Link>
                    </td>
                    <td className="pr-4" title={s.unsettled || undefined}>
                      {s.current ? `${s.current.donor}, ${pct(s.current.missingShare)} no value` : v.info.current === undefined ? "--" : "none"}
                    </td>
                    <td className="pr-4 font-mono text-xs">
                      {s.current?.driftEnd
                        ? `${km(Math.hypot(s.current.driftEnd.north, s.current.driftEnd.east))} km toward ${fmt(bearing(s.current.driftEnd.north, s.current.driftEnd.east), 0)} deg`
                        : "--"}
                    </td>
                    <td className="pr-4 font-mono text-xs">{s.missBefore != null ? `${km(s.missBefore)} km` : "--"}</td>
                    <td className="pr-4 font-mono text-xs">
                      {s.placement.scale != null ? `x${s.placement.scale.toFixed(3)}, ${fmt(s.placement.rotationDeg, 1)} deg` : "--"}
                    </td>
                    <td className="pr-4 font-mono text-xs">
                      {s.floor ? `${pct(s.floor.share)}, deepest ${fmt(s.floor.maxBelowM, 0)} m` : v.dem ? "--" : "no DEM yet"}
                    </td>
                    <td className="font-mono text-xs">
                      {v.row.sim_git_commit.slice(0, 7)}
                      {v.row.sim_git_dirty ? " (dirty)" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollectPanel>

      <Panel title="3D view">
        <div className="relative h-[34rem] bg-[#0b1220]">
          <Scene3D
            track={pt}
            dem={primary.dem}
            cursor={pos}
            exaggeration={exag}
            colorMax={1}
            solidColor={primary.color}
            others={others}
            species={dep.data.species}
          />
          <div className="pointer-events-none absolute top-2 left-2 space-y-0.5 rounded bg-panel/85 px-2 py-1.5 text-[11px] text-muted">
            {variants
              .filter((v) => visible.has(v.row.run_id))
              .map((v) => (
                <p key={v.row.run_id}>
                  <span className="mr-1.5 inline-block h-1 w-4 align-middle" style={{ background: v.color }} />
                  {v.info.label}
                  {v === primary ? " (animal)" : " (dot)"}
                </p>
              ))}
          </div>
          <Credits />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <Button kind="plain" onClick={() => setPlaying(!playing)}>
            {playing ? "Pause" : "Play"}
          </Button>
          <label className="flex items-center gap-1 text-muted">
            Speed
            <select className="rounded border border-line bg-surface px-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEED_STEPS.map((s) => (
                <option key={s} value={s}>
                  {speedLabel(s)}x
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted">
            Vertical exaggeration
            <input type="range" min={1} max={20} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))} />
            <span className="font-mono">{exag}x</span>
          </label>
          <span className="font-mono text-xs text-muted">{new Date(timeOf(pt, i) * 1000).toISOString().replace(".000Z", "Z")}</span>
          <input
            type="range"
            className="min-w-48 flex-1"
            min={0}
            max={pt.count - 1}
            step={1}
            value={i}
            aria-label="Time along the tracks"
            onChange={(e) => setCursor(Number(e.target.value))}
          />
        </div>
      </Panel>

      <Panel title="Along the tracks">
        <div className="space-y-3">
          {series.map((s) => (
            <Chart
              key={s.id}
              series={s}
              onTime={onTime}
              collectId={`${key}:chart-${s.id}`}
              deploymentId={depId}
              text={() => chartText(s, pt, i)}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}
