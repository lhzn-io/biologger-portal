import { Fragment, useEffect, useMemo, useRef } from "react";
import { markAsOf, niceStep, renderLines, type Area, type Line, type Span } from "@lhzn-io/timecharts/chart";
import { timeTrack } from "@lhzn-io/timecharts/time-axis";
import "@lhzn-io/timecharts/tokens.css";
import "@lhzn-io/timecharts/charts.css";
import "./charts-local.css";
import { CollectButton, useCollectItem } from "../collect/collect";
import { lines } from "../collect/prompt";
import { chartText } from "../collect/texts";
import { elevationAt, type Dem } from "./dem";
import { postureByDepth, quantile, UPRIGHT_DEG, wrap180, type SideStats } from "./posture";
import { analyseRoll } from "./roll";
import { indexAt, strideIndices, timeOf, type Track } from "./track";

const CHART_POINTS = 1500;
const ZONE = "UTC";

export interface ChartSeries {
  id: string;
  title: string;
  unit: string;
  xs: number[];
  lines: Line[];
  areas?: Area[];
  spans?: Span[];
  yTicks?: { at: number[]; label: (v: number) => string };
  /** Least padding above and below the data, in value units. */
  minPad?: number;
  /** Include zero in the value range, and the least value the range reaches down to. */
  zero?: boolean;
  floor?: number;
  /** One line under the chart, and facts for the Collect prompt beyond the line statistics. */
  caption?: string;
  notes?: [string, string][];
}

/** Roll direction colours: positive roll (right side down) and negative. */
const ROLL_POS = "#f472b6";
const ROLL_NEG = "#38bdf8";

function rollSeries(track: Track, idx: number[], xs: number[]): ChartSeries {
  const roll = analyseRoll(track);
  const n = track.count;
  const lo: number[] = [];
  const hi: number[] = [];
  const mid: number[] = [];
  const spans: Span[] = [];
  let doubtFrom: number | null = null;
  idx.forEach((i0, j) => {
    const i1 = j + 1 < idx.length ? idx[j + 1]! : n;
    let mn = Infinity;
    let mx = -Infinity;
    let doubtful = false;
    for (let i = i0; i < i1; i++) {
      const c = roll.cum[i]!;
      if (c < mn) mn = c;
      if (c > mx) mx = c;
      if (roll.doubt[i]) doubtful = true;
    }
    lo.push(mn / 360);
    hi.push(mx / 360);
    mid.push(roll.cum[i0]! / 360);
    // Doubtful stretches, merged over consecutive drawn points, as faint full-height spans.
    const x0 = xs[j]!;
    const x1 = j + 1 < xs.length ? xs[j + 1]! : timeOf(track, n - 1);
    if (doubtful && doubtFrom == null) doubtFrom = x0;
    if ((!doubtful || j === idx.length - 1) && doubtFrom != null) {
      spans.push({
        x0: doubtFrom,
        x1: doubtful ? x1 : x0,
        fill: "rgba(148, 163, 184, 0.16)",
        title: "Roll uncertain here: a step too large to unwrap, pitch beyond 65 degrees, or a gap",
      });
      doubtFrom = null;
    }
  });
  // The revolution rug: one mark per drawn interval holding completed turns, along the time axis, taller for more
  // turns and coloured by their net direction; paler where any of them is doubtful.
  const perPoint = new Map<number, { pos: number; neg: number; doubtful: boolean }>();
  for (const r of roll.revolutions) {
    let j = 0;
    let lo2 = 0;
    let hi2 = idx.length - 1;
    while (lo2 <= hi2) {
      const m = (lo2 + hi2) >> 1;
      if (idx[m]! <= r.i) {
        j = m;
        lo2 = m + 1;
      } else hi2 = m - 1;
    }
    const e = perPoint.get(j) ?? { pos: 0, neg: 0, doubtful: false };
    if (r.sense > 0) e.pos++;
    else e.neg++;
    e.doubtful ||= r.doubtful;
    perPoint.set(j, e);
  }
  for (const [j, e] of perPoint) {
    const net = e.pos - e.neg;
    const color = net >= 0 ? ROLL_POS : ROLL_NEG;
    // A drawn interval is under a pixel wide over a long track; each mark covers a few, so it stays visible.
    const x0 = xs[Math.max(0, j - 2)]!;
    const x1 = xs[Math.min(xs.length - 1, j + 3)]!;
    spans.push({
      x0,
      x1,
      edge: 6 + Math.min(10, 2 * (e.pos + e.neg)),
      fill: e.doubtful ? `${color}55` : color,
      title: `${e.pos} turn${e.pos === 1 ? "" : "s"} right side down, ${e.neg} the other way${e.doubtful ? " (doubtful)" : ""}`,
    });
  }

  const lowest = Math.min(...lo);
  const highest = Math.max(...hi);
  const step = Math.max(1, Math.round(niceStep(Math.max(1, highest - lowest))));
  const at: number[] = [];
  for (let v = Math.floor(lowest / step) * step - step; v <= Math.ceil(highest / step) * step + step; v += step) at.push(v);
  const pos = roll.revolutions.filter((r) => r.sense > 0).length;
  const neg = roll.revolutions.length - pos;
  const doubtfulTurns = roll.revolutions.filter((r) => r.doubtful).length;
  const rate = track.manifest.rate_hz;
  // The bundle's roll_deg is the simulator's static (gravity) roll, a moving average over about 2 to 3 s at the
  // tag's rate, then decimated: a spin faster than about 0.3 rev/s is averaged away before it is sampled, so the
  // fallback under-reports spinning. The exporter's native-rate columns, when present, carry their own smoothing.
  const continuity = (track.manifest as unknown as { roll_continuity?: { roll_smoothing_s?: number } | null }).roll_continuity;
  const smoothing = Number(continuity?.roll_smoothing_s);
  const ceiling =
    roll.source === "viewer"
      ? `unwrapped here from the ${rate} Hz roll, which is smoothed over about 2 to 3 s; turns faster than about 0.3 rev/s are smoothed away, so spinning is under-reported`
      : `unwrapped by the exporter at the tag's native rate${Number.isFinite(smoothing) && smoothing > 0 ? `, roll smoothed over ${smoothing} s` : ""}`;
  return {
    id: "roll",
    title: "Cumulative roll (revolutions)",
    unit: "",
    xs,
    lines: [{ ys: mid, color: ROLL_POS, label: "Cumulative roll", fmt: (v) => `${v.toFixed(2)} rev` }],
    areas: [{ lo, hi, fill: ROLL_POS, opacity: 0.22 }],
    spans,
    yTicks: { at, label: (v) => `${v}` },
    // At least two revolutions of height, so rocking within one turn reads as a thin band between the rules.
    minPad: Math.max(0.1, (2.4 - (highest - lowest)) / 2),
    caption:
      `${pos} full turn${pos === 1 ? "" : "s"} right side down and ${neg} the other way` +
      `${doubtfulTurns ? ` (${doubtfulTurns} doubtful)` : ""}; ${ceiling}.`,
    notes: [
      ["roll_source", ceiling],
      ["revolutions", `${pos} positive (right side down), ${neg} negative, ${doubtfulTurns} of them doubtful`],
      ["net_roll_rev", ((roll.cum[n - 1]! - roll.cum[0]!) / 360).toFixed(2)],
      ["doubtful_samples", `${roll.doubtfulSteps} of ${n} (step over 135 deg, pitch beyond 65 deg, or a gap)`],
      ["counting", "a turn counts when the running total passes 360 degrees, plus 30 degrees for the first of a direction"],
    ],
  };
}

const RIGHT_COLOR = "#fb923c"; // right side down (positive roll)
const LEFT_COLOR = "#2dd4bf"; // left side down
/** A side's median line is drawn at full strength where the side holds at least this fraction of the interval. */
const STRONG_SHARE = 0.25;

/**
 * Roll angle over time, mirrored: right side down above zero, left side down below. Per drawn interval, the rolls to
 * each side get their own median line and 10 to 90 percent band, so a fish that banks both ways within an interval
 * shows both, and one that holds a side shows one. A signed median of both sides together would fall between the
 * two humps and read as upright. Samples within UPRIGHT_DEG of upright count to neither side (as in the by-depth
 * view), so an upright interval draws no side line; a side's line is faint where it holds under a quarter of the
 * interval, and the tooltip gives each side's share.
 */
function postureSeries(track: Track, idx: number[], xs: number[]): ChartSeries {
  const n = track.count;
  const blank = () => ({ lo: [] as number[], mid: [] as number[], hi: [] as number[], share: [] as number[], strong: [] as number[] });
  const side = { right: blank(), left: blank() };
  const upright: number[] = [];
  let deepest = 90;
  for (let j = 0; j < idx.length; j++) {
    const i0 = idx[j]!;
    const i1 = j + 1 < idx.length ? idx[j + 1]! : n;
    const pos: number[] = [];
    const neg: number[] = [];
    let total = 0;
    for (let i = i0; i < i1; i++) {
      const r = track.roll[i]!;
      if (!Number.isFinite(r)) continue;
      const w = wrap180(r);
      total++;
      if (w >= UPRIGHT_DEG) pos.push(w);
      else if (w <= -UPRIGHT_DEG) neg.push(w);
    }
    pos.sort((a, b) => a - b);
    neg.sort((a, b) => a - b);
    const put = (s: ReturnType<typeof blank>, v: number[], lo: number, hi: number) => {
      const share = total ? v.length / total : NaN;
      const mid = quantile(v, 0.5);
      s.lo.push(quantile(v, lo));
      s.mid.push(mid);
      s.hi.push(quantile(v, hi));
      s.share.push(100 * share);
      s.strong.push(share >= STRONG_SHARE ? mid : NaN);
    };
    put(side.right, pos, 0.1, 0.9);
    put(side.left, neg, 0.1, 0.9); // lo is the most negative: furthest over to the left
    upright.push(total ? (100 * (total - pos.length - neg.length)) / total : NaN);
    deepest = Math.max(deepest, Math.abs(quantile(neg, 0.1)) || 0, quantile(pos, 0.9) || 0);
  }
  const all = Array.from(track.roll, wrap180).filter(Number.isFinite);
  const rightShare = all.filter((r) => r >= UPRIGHT_DEG).length / Math.max(1, all.length);
  const leftShare = all.filter((r) => r <= -UPRIGHT_DEG).length / Math.max(1, all.length);
  const reach = Math.min(180, Math.ceil(deepest / 45) * 45);
  const pct = (v: number) => `${v.toFixed(0)} % of interval`;
  return {
    id: "posture",
    title: "Roll angle (degrees; right side down above zero, left side down below)",
    unit: "",
    xs,
    lines: [
      // full medians, faint; they carry the tooltip and legend
      { ys: side.right.mid, color: RIGHT_COLOR, opacity: 0.35, label: "Right side down", fmt: (v) => `${v.toFixed(0)} deg right` },
      { ys: side.left.mid, color: LEFT_COLOR, opacity: 0.35, label: "Left side down", fmt: (v) => `${(-v).toFixed(0)} deg left` },
      // drawn over them at full strength where the side holds at least STRONG_SHARE of the interval
      { ys: side.right.strong, color: RIGHT_COLOR, label: "", tip: false },
      { ys: side.left.strong, color: LEFT_COLOR, label: "", tip: false },
      // tooltip only: how the interval divides between the sides and upright (the tooltip lists them in reverse)
      { ys: side.left.share, color: LEFT_COLOR, label: "Left side down, share", hidden: true, fmt: pct },
      { ys: upright, color: "currentColor", label: `Upright (within ${UPRIGHT_DEG} deg), share`, hidden: true, fmt: pct },
      { ys: side.right.share, color: RIGHT_COLOR, label: "Right side down, share", hidden: true, fmt: pct },
      // invisible, so the scale reaches the left band's far edge (areas only widen the scale upward)
      { ys: side.left.lo, color: "transparent", width: 0, opacity: 0, label: "", tip: false },
    ],
    areas: [
      { lo: side.right.lo, hi: side.right.hi, fill: RIGHT_COLOR, opacity: 0.22 },
      { lo: side.left.lo, hi: side.left.hi, fill: LEFT_COLOR, opacity: 0.22 },
    ],
    zero: true,
    floor: -90,
    yTicks: { at: [-180, -135, -90, -45, 0, 45, 90, 135, 180].filter((v) => Math.abs(v) <= reach), label: (v) => `${v}` },
    minPad: 2,
    caption:
      `0 upright, +90 right side down, -90 left side down; each side's median and 10 to 90 % range per interval, ` +
      `counting rolls past ${UPRIGHT_DEG} deg (nearer upright counts to neither side); lines faint where a side holds under ` +
      `${100 * STRONG_SHARE} % of the interval. Rolled past ${UPRIGHT_DEG} deg: right ${(100 * rightShare).toFixed(0)} % ` +
      `of the time, left ${(100 * leftShare).toFixed(0)} %. ` +
      `From the accelerometer's gravity roll, smoothed over 2 to 3 s (posture, not tailbeat).`,
    notes: [
      ["definition", `roll angle, positive right side down, negative left side down; per interval each side summarised separately, counting rolls past ${UPRIGHT_DEG} deg`],
      ["time_rolled_past_20_deg", `right ${(100 * rightShare).toFixed(1)} %, left ${(100 * leftShare).toFixed(1)} %`],
      ["roll_source", "static (gravity) roll from the accelerometer, smoothed over about 2 to 3 s by the simulator"],
    ],
  };
}

/** The series the charts draw, from the same arrays the map and 3D view use (and the Collect prompt reads). */
export function chartSeries(track: Track, dem: Dem | null): ChartSeries[] {
  const idx = strideIndices(track.count, CHART_POINTS);
  const xs = idx.map((i) => timeOf(track, i));
  const pick = (a: Float32Array) => idx.map((i) => a[i]!);
  const seafloor = dem ? idx.map((i) => elevationAt(dem, track.lat[i]!, track.lon[i]!)) : null;
  const depthLines: Line[] = [{ ys: pick(track.depth).map((d) => -d), color: "#fbbf24", label: "Animal", fmt: (v) => `${(-v).toFixed(0)} m` }];
  if (seafloor) depthLines.push({ ys: seafloor, color: "#94a3b8", label: "Seafloor (DEM)", dash: "3 2", fmt: (v) => `${(-v).toFixed(0)} m` });
  // Dynamic body acceleration: VeDBA (vector length) and, when the bundle has it, ODBA (sum of absolute axes, up to
  // root 3 times VeDBA for the same motion), on one axis since they share units.
  const unit = track.units.vedba || "m/s^2";
  const activity: Line[] = [{ ys: pick(track.vedba), color: "#3b9cff", label: "VeDBA" }];
  if (track.odba) activity.push({ ys: pick(track.odba), color: "#a78bfa", label: "ODBA", opacity: 0.8 });
  return [
    { id: "depth", title: "Depth (m, below the surface)", unit: "m", xs, lines: depthLines },
    { id: "vedba", title: `${track.odba ? "VeDBA and ODBA" : "VeDBA"} (${unit})`, unit: "", xs, lines: activity },
    { id: "pitch", title: "Pitch (degrees)", unit: "deg", xs, lines: [{ ys: pick(track.pitch), color: "#34d399", label: "Pitch" }] },
    postureSeries(track, idx, xs),
    rollSeries(track, idx, xs),
  ];
}

const DAY = "#fbbf24";
const NIGHT = "#818cf8";

/**
 * Roll by depth band as a butterfly: upright at the centre, left side down to the left, right side down to the right.
 * Per band, day and night on their own rows, each side gets a dot at the median and a bar over the middle half of
 * its rolls, labelled with the share of the band's time spent on that side. Bands with under a minute of data are
 * left out. This is the view that tests whether the animal rolls more at depth, and to which side.
 */
function PostureByDepth({ track, collectId }: { track: Track; collectId: string }) {
  const bins = useMemo(() => postureByDepth(track).filter((b) => b.minutes >= 1), [track]);
  const fig = useRef<HTMLElement>(null);
  const title = `Roll by depth, ${track.manifest.deployment_id}`;
  const text = () =>
    lines([
      ["chart", "Roll by depth band, each side apart, day (sun above the horizon) and night"],
      ["definition", "degrees from upright per side; share = time on that side; static (gravity) roll smoothed over 2 to 3 s"],
      ...bins.map((b) => {
        const s = (x: SideStats, name: string) =>
          `${name} ${(100 * x.share).toFixed(0)} % of the time, median ${Number.isFinite(x.median) ? x.median.toFixed(0) : "-"} deg`;
        return [`${b.top}-${b.bottom} m ${b.period}`, `${s(b.left, "left side down")}; ${s(b.right, "right side down")}; ${b.minutes.toFixed(0)} min`] as [
          string,
          string,
        ];
      }),
    ]);
  useCollectItem(collectId, title, text, fig);
  const rows = bins.map((b) => ({ ...b, key: `${b.top}-${b.bottom}:${b.period}` }));
  const xMax = Math.max(90, ...bins.flatMap((b) => [b.left.p75, b.right.p75]).filter(Number.isFinite).map((v) => Math.ceil(v / 30) * 30));
  const W = 640;
  const rowH = 13;
  const labelW = 74;
  const H = rows.length * rowH + 26;
  const mid = labelW + (W - labelW - 8) / 2;
  const half = (W - labelW - 8) / 2 - 22; // room for the share labels at the ends
  const x = (deg: number, sign: 1 | -1) => mid + sign * (deg / xMax) * half;
  return (
    <figure ref={fig} data-collect-item>
      <figcaption className="mb-1 flex flex-wrap items-center text-xs text-muted">
        <CollectButton id={collectId} title={title} kind="chart" />
        Roll by depth (degrees from upright; left side down to the left, right side down to the right)
        <span className="ml-3 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: DAY }} />
            day
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: NIGHT }} />
            night
          </span>
        </span>
      </figcaption>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">No depth and roll samples to summarise.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={title}>
          <rect x={x(UPRIGHT_DEG, -1)} width={x(UPRIGHT_DEG, 1) - x(UPRIGHT_DEG, -1)} y={0} height={H - 18} fill="currentColor" opacity={0.06} />
          {Array.from({ length: xMax / 30 + 1 }, (_, k) => k * 30).flatMap((v) =>
            ([-1, 1] as const)
              .filter((s) => v > 0 || s > 0)
              .map((s) => (
                <g key={`${v}:${s}`}>
                  <line x1={x(v, s)} x2={x(v, s)} y1={0} y2={H - 18} stroke="currentColor" strokeOpacity={v === 0 ? 0 : v === 90 ? 0.25 : 0.1} />
                  <text x={x(v, s)} y={H - 6} textAnchor="middle" fontSize={8.5} fill="currentColor" opacity={0.6}>
                    {v === 0 ? "upright" : v === 90 ? `90 ${s < 0 ? "left" : "right"}` : v}
                  </text>
                </g>
              )),
          )}
          {rows.map((b, row) => {
            const y = row * rowH + rowH / 2;
            const band = `${b.top}-${b.bottom} m`;
            const showBand = row === 0 || rows[row - 1]!.top !== b.top;
            const color = b.period === "day" ? DAY : NIGHT;
            return (
              <g key={b.key} opacity={b.minutes < 10 ? 0.5 : 1}>
                {showBand && (
                  <text x={labelW - 8} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.7}>
                    {band}
                  </text>
                )}
                <text x={mid} y={y + 3} textAnchor="middle" fontSize={8} fill={color} opacity={0.85}>
                  <title>{`${band}, ${b.period}: within ${UPRIGHT_DEG} deg of upright ${(100 * b.upright).toFixed(0)} % of the time`}</title>
                  {(100 * b.upright).toFixed(0)}%
                </text>
                {(
                  [
                    [b.left, -1],
                    [b.right, 1],
                  ] as const
                ).map(([s, sign]) =>
                  s.share > 0 && Number.isFinite(s.median) ? (
                    <g key={sign}>
                      <title>{`${band}, ${b.period}, ${sign < 0 ? "left" : "right"} side down: ${(100 * s.share).toFixed(0)} % of the time, median ${s.median.toFixed(0)} deg (middle half ${s.p25.toFixed(0)} to ${s.p75.toFixed(0)}), ${b.minutes.toFixed(0)} min in the band`}</title>
                      <line
                        x1={x(s.p25, sign)}
                        x2={x(s.p75, sign)}
                        y1={y}
                        y2={y}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeOpacity={0.35 + 0.65 * Math.min(1, s.share * 2)}
                      />
                      <circle cx={x(s.median, sign)} cy={y} r={2.6} fill={color} fillOpacity={0.35 + 0.65 * Math.min(1, s.share * 2)} />
                      <text
                        x={x(Math.max(s.p75, s.median), sign) + sign * 5}
                        y={y + 3}
                        textAnchor={sign < 0 ? "end" : "start"}
                        fontSize={8}
                        fill="currentColor"
                        opacity={0.55}
                      >
                        {(100 * s.share).toFixed(0)}%
                      </text>
                    </g>
                  ) : null,
                )}
              </g>
            );
          })}
        </svg>
      )}
      <p className="mt-0.5 text-xs text-muted">
        Centre: the share of the band&apos;s time within {UPRIGHT_DEG} degrees of upright (shaded). Per side: dot the median, bar the middle half of the rolls past {UPRIGHT_DEG} degrees, the figure the share of the band&apos;s time on that
        side (bars fainter for small shares; rows paler with under 10 minutes). Day is the sun above the horizon at the
        fish&apos;s position.
      </p>
    </figure>
  );
}

function Chart({
  series,
  onTime,
  collectId,
  text,
  deploymentId,
}: {
  series: ChartSeries;
  deploymentId: string;
  onTime: (t: number) => void;
  collectId: string;
  text: () => string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const fig = useRef<HTMLElement>(null);
  const itemTitle = `${series.title}, ${deploymentId}`;
  useCollectItem(collectId, itemTitle, text, fig);
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const opts = {
      xs: series.xs,
      lines: series.lines,
      unit: series.unit,
      timeZone: ZONE,
      areas: series.areas,
      spans: series.spans,
      yTicks: series.yTicks,
      minPad: series.minPad,
      zero: series.zero,
      floor: series.floor,
    };
    let rendered = renderLines(el, opts);
    const ro = new ResizeObserver(() => {
      rendered = renderLines(el, opts);
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
    <figure ref={fig} data-collect-item>
      <figcaption className="mb-1 flex flex-wrap items-center text-xs text-muted">
        <CollectButton id={collectId} title={itemTitle} kind="chart" />
        {series.title}
        <span className="ml-3">
          {series.lines.filter((l) => l.label && !l.hidden).map((l) => (
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
      {series.caption && <p className="mt-0.5 text-xs text-muted">{series.caption}</p>}
    </figure>
  );
}

/**
 * Linked charts and the time track; clicking a chart or dragging the track moves the shared cursor. A click on a
 * chart (not a drag of the track) also reports the picked sample through `onPick`, which the page uses to bring
 * the 3D view to the animal at that time.
 */
export default function Charts({
  track,
  dem,
  cursor,
  onCursor,
  onPick,
  collectKey,
}: {
  track: Track;
  dem: Dem | null;
  cursor: number;
  onCursor: (index: number) => void;
  onPick?: (index: number) => void;
  collectKey: string;
}) {
  const series = useMemo(() => chartSeries(track, dem), [track, dem]);
  const slot = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const onTime = useMemo(
    () => (t: number) => {
      const i = indexAt(track, t);
      onCursor(i);
      onPick?.(i);
    },
    [track, onCursor, onPick],
  );

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
        <Fragment key={s.id}>
          <Chart
            series={s}
            onTime={onTime}
            collectId={`${collectKey}:chart-${s.id}`}
            deploymentId={track.manifest.deployment_id}
            text={() => chartText(s, track, cursor)}
          />
          {s.id === "posture" && <PostureByDepth track={track} collectId={`${collectKey}:chart-posture-depth`} />}
        </Fragment>
      ))}
    </div>
  );
}
