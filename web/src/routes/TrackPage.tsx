import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { GuideLink } from "../components/GuideLink";
import { Button, ErrorNote, Loading, Panel } from "../components/ui";
import CollectPanel from "../collect/CollectPanel";
import { mapText, readoutText } from "../collect/texts";
import { useTracks } from "../lib/queries";
import { resolveRun } from "../lib/runLinks";
import Charts from "../viewer/Charts";
import { convergenceNote, currentConvergence } from "../viewer/compare";
import { depthScale, loadDem, type DepthScale } from "../viewer/dem";
import { Credits, Legend } from "../viewer/Legend";
import { fmt, readoutAt } from "../viewer/readout";
import Scene3D, { type SceneView } from "../viewer/Scene3D";
import SceneControls from "../viewer/SceneControls";
import { logVisit } from "../lib/visits";
import { odbaScale } from "../viewer/activity";
import { currentScale } from "../viewer/current";
import { advance, DEFAULT_SPEED, parseSpeed, SPEED_STEPS, speedLabel, stepSpeed } from "../viewer/playback";
import { DEFAULT_CHART_PICK, DEFAULT_PLAY_CAMERA, DEFAULT_TRACK_COLOR, PLAY_CAMERAS, readPageLink, writePageLink, type ChartPick, type PlayCamera, type TrackColor } from "../viewer/link";
import type { InspectorCamera, InspectorFrame } from "../viewer/inspector";
import InspectorChrome from "../viewer/InspectorChrome";
import { INSET, insetBox } from "../viewer/inspectorView";
import StudioStrip from "../viewer/StudioStrip";
import { indexAt, loadTrack, timeOf } from "../viewer/track";

const PLAY_CAMERA_LABELS: Record<PlayCamera, string> = { free: "Free", chase: "Chase", orbit: "Orbit" };

export default function TrackPage() {
  const params = useParams();
  const depId = decodeURIComponent(params.id ?? "");
  const linked = decodeURIComponent(params.run ?? "");
  const tracks = useTracks();
  // The link names a run or gives its exact id (lib/runLinks.ts), so it outlives a re-export; the run list says
  // which run it opens. Without a match the link is tried as an exact id, and fails as before.
  const resolved = useMemo(() => (tracks.data ? resolveRun(tracks.data, depId, linked) : null), [tracks.data, depId, linked]);
  const runId = resolved?.row.run_id ?? (tracks.data || tracks.isError ? linked : "");
  const track = useQuery({ queryKey: ["track", depId, runId], queryFn: () => loadTrack(depId, runId), staleTime: Infinity, enabled: runId !== "" });
  // The DEM crop can take up to a minute the first time topobathykit builds it; the track shows meanwhile.
  const dem = useQuery({ queryKey: ["dem", depId, runId], queryFn: () => loadDem(depId, runId), staleTime: Infinity, retry: 1, enabled: runId !== "" });
  // A shared link (see viewer/link.ts) sets the opening state; the camera in it is vantagekit's.
  const [initial] = useState(() => readPageLink(location.search));
  // Null until the viewer moves the cursor: until then it sits at the link's time, or the start. Playback moves it
  // between samples (a fractional index), so slow playback is smooth; the readout and charts use the sample at or
  // before it.
  const [cursorSet, setCursor] = useState<number | null>(null);
  const [exag, setExag] = useState(initial.exaggeration ?? 5);
  const [playing, setPlaying] = useState(false);
  // Playback speed in seconds of track per second, and the text being typed into the speed box (null when idle).
  const [speed, setSpeed] = useState(initial.speed ?? DEFAULT_SPEED);
  const [speedText, setSpeedText] = useState<string | null>(null);
  const [follow, setFollow] = useState(initial.follow ?? false);
  const [playCam, setPlayCam] = useState<PlayCamera>(initial.play ?? DEFAULT_PLAY_CAMERA);
  const [pick, setPick] = useState<ChartPick>(initial.pick ?? DEFAULT_CHART_PICK);
  const [trackColor, setTrackColor] = useState<TrackColor>(initial.color ?? DEFAULT_TRACK_COLOR);
  // Null is the default: arrows on wherever the track has a current (they read against any track coloring).
  const [arrowsSet, setArrows] = useState<boolean | null>(initial.arrows ?? null);
  const [basis, setBasis] = useState<DepthScale["basis"]>(initial.basis ?? "species");
  // The physics inspector inset: hidden unless the viewer or a shared link opens it.
  const [phys, setPhys] = useState<InspectorFrame | null>(initial.phys && initial.phys !== "off" ? initial.phys : null);
  const [physScale, setPhysScale] = useState(1);
  const [physGravity, setPhysGravity] = useState(false);
  const [physCamera, setPhysCamera] = useState<InspectorCamera>("side");
  const [physPair, setPhysPair] = useState(false);
  const [physLarge, setPhysLarge] = useState(false);
  const [physSlip, setPhysSlip] = useState(false);
  // The inset moves its own camera too (a drag frees it, a double-click returns to Side); the buttons follow.
  const onPhysCamera = useCallback((c: InspectorCamera) => setPhysCamera(c), []);
  const inspector = useMemo(
    () =>
      phys
        ? {
            // Always drawn locked to the heading: a north-up inset only moved N, and compass directions read on the map.
            frame: "heading" as const,
            scale: physScale,
            gravity: physGravity,
            camera: physCamera,
            pair: physPair,
            large: physLarge,
            slip: physSlip,
            onCamera: onPhysCamera,
          }
        : null,
    [phys, physScale, physGravity, physCamera, physPair, physLarge, physSlip, onPhysCamera],
  );
  const onInspector = useCallback((f: InspectorFrame | null) => {
    logVisit("action", "inspector", { frame: f ?? "off" });
    setPhys(f);
  }, []);
  const view = useRef<SceneView | null>(null);
  // Studio: the 3D view fills the browser window. Full screen: the browser's own full screen, of the 3D view alone.
  const [studio, setStudio] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const sceneBox = useRef<HTMLDivElement>(null);
  const onCursor = useCallback((i: number) => setCursor(i), []);
  // A click on a chart moves the cursor and, as the viewer chose, leaves the 3D camera, turns it in place to face
  // the animal at that time, or brings it to the animal at the distance and angle the viewer had.
  const onPick = useCallback(
    (i: number) => {
      if (pick === "look") view.current?.lookAt(i);
      else if (pick === "center") view.current?.centerOn(i);
    },
    [pick],
  );

  const tr = track.data;
  const pos = cursorSet ?? (tr && initial.time != null ? indexAt(tr, initial.time) : 0);
  const cursor = Math.floor(pos);
  // The URL follows the view: the camera is written as it settles, the rest here once changes pause (playback
  // writes when it stops), so the address bar can be copied to share this moment and view.
  const linkWrite = useRef<((p: URLSearchParams) => void) | null>(null);
  useEffect(() => {
    if (!tr) return;
    const state = { time: timeOf(tr, cursor), exaggeration: exag, basis, follow, play: playCam, pick, color: trackColor, speed, phys: phys ?? ("off" as const), arrows: arrowsSet };
    linkWrite.current = (p) => writePageLink(p, state);
    const id = setTimeout(() => view.current?.writeLink(), 400);
    return () => clearTimeout(id);
  }, [tr, cursor, exag, basis, follow, playCam, pick, trackColor, speed, phys, arrowsSet]);
  // While the track plays, Chase and Orbit hold the view on the animal: Chase from behind, turning with it, Orbit
  // at the angle the viewer sets with the mouse. Pausing leaves the camera where it is, back under the viewer's own
  // Follow setting.
  const following = follow || (playing && playCam !== "free");
  const chasing = playing && playCam === "chase";
  // Orbit opens out to show the track one second of playback either side of the animal.
  const approach = (mode: PlayCamera, atSpeed: number, force: boolean) => {
    if (mode !== "free" && tr) view.current?.approach(mode, atSpeed * tr.manifest.rate_hz, force);
  };
  // Animal depth colors: by default one scale for every track of the species (deepest of them, rounded up),
  // so a color means the same depth on each of their pages; "this track only" fits the track itself.
  const trackList = tracks.data;
  const scales = useMemo(() => {
    let deepest = 0;
    for (const d of tr?.depth ?? []) if (d > deepest) deepest = d;
    const list = trackList ?? [];
    const species = list.find((t) => t.deployment_id === depId && t.run_id === runId)?.species || undefined;
    const peers = species ? list.filter((t) => t.species === species) : [];
    const speciesDeepest = Math.max(deepest, ...peers.map((t) => t.bounds.depth_m?.[1] ?? 0));
    return {
      species,
      track: depthScale(deepest, "track"),
      ofSpecies: peers.length ? depthScale(speciesDeepest, "species") : null,
    };
  }, [tr, trackList, depId, runId]);
  const species = scales.species;
  const scale = basis === "species" && scales.ofSpecies ? scales.ofSpecies : scales.track;
  // Track colors: by depth, or by ODBA or the applied current when the viewer picks one and the bundle has it.
  const activity = useMemo(() => (tr ? odbaScale(tr) : null), [tr]);
  const flow = useMemo(() => (tr ? currentScale(tr) : null), [tr]);
  const byOdba = trackColor === "odba" && activity != null;
  const byCurrent = trackColor === "current" && flow != null;
  const colorBy: TrackColor = byOdba ? "odba" : byCurrent ? "current" : "depth";
  const colorMax = byOdba ? activity.max : byCurrent ? flow.max : scale.max;
  const arrows = flow != null && (arrowsSet ?? true);
  useEffect(() => {
    if (!tr || !playing) return;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      // at most a quarter second per frame, so a tab left in the background does not jump ahead when it returns
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      setCursor((prev) => {
        const next = advance(prev ?? 0, dt, speed, tr.manifest.rate_hz); // Play and Speed set the cursor first
        if (next >= tr.count - 1) {
          setPlaying(false);
          return tr.count - 1;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [tr, playing, speed]);
  useEffect(() => {
    const onChange = () => setFullscreen(!!sceneBox.current && document.fullscreenElement === sceneBox.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!studio) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStudio(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no page scroll behind the studio view
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [studio]);

  if (track.isPending) return <Loading what="the track" />;
  if (track.error || !tr) return <ErrorNote error={track.error} />;
  const r = readoutAt(tr, dem.data ?? null, cursor);
  const key = `track:${depId}:${runId}`;
  const m = tr.manifest;
  const unsettled = convergenceNote(currentConvergence(tr));
  // A new speed applies at once, playing or paused; while playing, Orbit reframes for it.
  const applySpeed = (next: number) => {
    setSpeedText(null);
    if (next === speed) return;
    setCursor(pos);
    if (playing) approach(playCam, next, playCam === "orbit");
    logVisit("action", "speed", { speed: next });
    setSpeed(next);
  };
  const commitSpeed = () => {
    if (speedText == null) return;
    const v = parseSpeed(speedText);
    if (v == null) setSpeedText(null);
    else applySpeed(v);
  };
  const speedBad = speedText != null && parseSpeed(speedText) == null;
  const stepButton = "rounded border border-line px-1.5 font-mono text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
  // Play, speed and camera, under the readout and, in studio or full screen, inside the 3D view.
  const playbar = (
    <>
          <Button kind="plain" onClick={() => {
            setCursor(pos);
            if (!playing) {
              approach(playCam, speed, false);
              logVisit("action", "play", { speed, camera: playCam });
            }
            setPlaying(!playing);
          }}>
            {playing ? "Pause" : "Play"}
          </Button>
          <span className="flex items-center gap-1 text-muted" title="Seconds of track per second (1x is real time): type 0.1 to 86400, or step with the buttons or arrow keys">
            Speed
            <button type="button" className={stepButton} aria-label="Slower" disabled={speed <= SPEED_STEPS[0]!} onClick={() => applySpeed(stepSpeed(speed, -1))}>
              -
            </button>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Playback speed, seconds of track per second"
              className={`w-14 rounded border bg-surface px-1 text-right font-mono text-ink ${speedBad ? "border-bad" : "border-line"}`}
              value={speedText ?? speedLabel(speed)}
              onChange={(e) => setSpeedText(e.target.value)}
              onBlur={commitSpeed}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitSpeed();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setSpeedText(null);
                  e.currentTarget.blur();
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  applySpeed(stepSpeed(speed, e.key === "ArrowUp" ? 1 : -1));
                }
              }}
            />
            x
            <button type="button" className={stepButton} aria-label="Faster" disabled={speed >= SPEED_STEPS[SPEED_STEPS.length - 1]!} onClick={() => applySpeed(stepSpeed(speed, 1))}>
              +
            </button>
          </span>
          <label className="flex items-center gap-1 text-muted" title="While playing: Chase follows from behind; Orbit keeps your angle (drag, or A/D, W/S, Q/E)">
            Camera
            <select className="rounded border border-line bg-surface px-1" value={playCam} onChange={(e) => {
              const next = e.target.value as PlayCamera;
              setPlayCam(next);
              logVisit("action", "camera", { camera: next });
              if (playing) approach(next, speed, true);
            }}>
              {PLAY_CAMERAS.map((c) => (
                <option key={c} value={c}>
                  {PLAY_CAMERA_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
    </>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-4">
        <h1 className="font-mono text-xl">
          <Link to={`/deployments/${encodeURIComponent(depId)}`} className="text-accent hover:underline">
            {depId}
          </Link>
        </h1>
        <span className="text-sm text-muted">
          {m.track_model_used} track, {m.count.toLocaleString()} samples at {m.rate_hz} Hz, run {m.run_id}
          {m.provenance.sim_git_dirty ? " (uncommitted simulator changes)" : ""}
          {resolved?.replaced && `, replacing ${linked}`}
        </span>
        {unsettled && (
          <p className="basis-full text-sm text-warn" role="note">
            {unsettled}. <GuideLink to="currents.html#how-the-current-enters-a-track" />
          </p>
        )}
      </header>

      <CollectPanel id={`${key}:readout`} title={`Cursor readout, ${depId}`} text={() => readoutText(tr, dem.data ?? null, cursor)}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs md:grid-cols-5">
          <Item label="Time (UTC)" value={r.time_utc} />
          <Item label="Position" value={`${fmt(r.lat, 5)}, ${fmt(r.lon, 5)}`} />
          {/* One style throughout: whole meters and degrees, m/s to 0.01, m/s^2 to 0.1 (g to 0.01), as the inspector. */}
          <Item label="Depth" value={`${fmt(r.depth_m, 0)} m`} />
          <Item label="Seafloor (DEM)" value={r.seafloor_depth_m == null ? "--" : `${fmt(r.seafloor_depth_m, 0)} m`} />
          <Item label="Above seafloor" value={r.above_seafloor_m == null ? "--" : `${fmt(r.above_seafloor_m, 0)} m`} />
          <Item label={tr.headingSource === "tag" ? "Heading" : "Heading (fix bearing; no magnetometer)"} value={`${fmt(((r.heading_deg % 360) + 360) % 360, 0)}°`} />
          <Item label="Pitch" value={`${fmt(r.pitch_deg, 0)}°`} />
          <Item label="Roll" value={`${fmt(r.roll_deg, 0)}°`} />
          <Item label={`VeDBA (${accelUnit(tr.units.vedba)})`} value={fmt(r.vedba, accelDigits(tr.units.vedba))} />
          {r.odba != null && (
            <Item label={`ODBA (${accelUnit(tr.units.odba || tr.units.vedba)})`} value={fmt(r.odba, accelDigits(tr.units.odba || tr.units.vedba))} />
          )}
          {r.current != null && (
            <Item
              label="Ocean current (model)"
              value={Number.isFinite(r.current.speed_m_s) ? `${fmt(r.current.speed_m_s, 2)} m/s toward ${fmt(r.current.toward_deg, 0)}°` : "no value"}
            />
          )}
          <Item label="From start fix" value={`${fmt(r.north_m, 0)} m N, ${fmt(r.east_m, 0)} m E`} />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {playbar}
          {dem.isLoading && <span className="text-xs text-muted">Loading terrain (up to a minute the first time)...</span>}
          {dem.error && <span className="text-xs text-bad">No terrain: {dem.error.message}</span>}
          {dem.data && (
            <span className="text-xs text-muted">
              Terrain: {dem.data.terrain.dataset}, {dem.data.meta.width} x {dem.data.meta.height} cells
            </span>
          )}
        </div>
      </CollectPanel>

      <CollectPanel id={`${key}:scene`} title={`3D view, ${depId}`} text={() => mapText(tr, dem.data ?? null, exag, scale, species, byOdba ? activity : null, byCurrent ? flow : null)}>
        <div ref={sceneBox} className={studio ? "fixed inset-0 z-[100] bg-[#0b1220]" : "relative h-[36rem] bg-[#0b1220]"}>
          <Scene3D track={tr} dem={dem.data ?? null} cursor={pos} exaggeration={exag} colorBy={colorBy} colorMax={colorMax} follow={following} chase={chasing} species={species} viewRef={view} linkWrite={linkWrite} inspector={inspector} onSeek={onCursor} currentArrows={arrows} />
          <Legend depth={colorBy === "depth" ? scale : null} activity={byOdba ? activity : null} current={byCurrent ? flow : null} arrows={arrows ? flow : null} species={species} />
          <SceneControls
            onFocus={() => view.current?.focusAnimal()}
            studio={studio}
            onStudio={() => {
              logVisit("action", "studio", { on: !studio });
              setStudio(!studio);
            }}
            fullscreen={fullscreen}
            onFullscreen={() => {
              logVisit("action", "fullscreen", { on: !document.fullscreenElement });
              if (document.fullscreenElement) void document.exitFullscreen();
              else void sceneBox.current?.requestFullscreen();
            }}
            onHome={() => {
              setFollow(false);
              if (playing) setPlayCam("free");
              view.current?.home();
            }}
            exaggeration={exag}
            onExaggeration={setExag}
            follow={follow}
            onFollow={(on) => {
              setFollow(on);
              if (on) view.current?.focusAnimal();
            }}
            basis={basis}
            onBasis={setBasis}
            pick={pick}
            onPick={(p) => {
              logVisit("action", "chart_pick", { pick: p });
              setPick(p);
            }}
            trackColor={trackColor}
            onTrackColor={(c) => {
              logVisit("action", "track_color", { color: c });
              setTrackColor(c);
            }}
            hasOdba={activity != null}
            hasCurrent={flow != null}
            arrows={arrows}
            onArrows={(on) => {
              logVisit("action", "current_arrows", { on });
              setArrows(on);
            }}
            speciesScale={scales.ofSpecies}
            trackScale={scales.track}
            species={species}
            inspector={phys}
            onInspector={onInspector}
            inspectorScale={physScale}
            onInspectorScale={setPhysScale}
          />
          {phys && (
            <InspectorChrome
              gravity={physGravity}
              onGravity={setPhysGravity}
              hasAccel={tr.accel != null}
              camera={physCamera}
              onCamera={(c) => {
                logVisit("action", "inspector", { camera: c });
                setPhysCamera(c);
              }}
              pair={physPair}
              onPair={(on) => {
                logVisit("action", "inspector", { pair: on });
                setPhysPair(on);
              }}
              large={physLarge}
              onLarge={setPhysLarge}
              slip={physSlip}
              onSlip={(on) => {
                logVisit("action", "inspector", { slip: on });
                setPhysSlip(on);
              }}
              onClose={() => onInspector(null)}
            />
          )}
          <Credits />
          {(studio || fullscreen) && (
            <StudioStrip track={tr} cursor={pos} onCursor={onCursor} right={inspector ? insetBox(inspector).width + INSET.right + 8 : 8} />
          )}
          {(studio || fullscreen) && (
            <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-3 rounded border border-line bg-panel/90 px-2 py-1 text-sm">
              {playbar}
              <span className="font-mono text-xs text-muted">{r.time_utc} UTC</span>
            </div>
          )}
        </div>
      </CollectPanel>

      <Panel title="Along the track">
        <Charts track={tr} dem={dem.data ?? null} cursor={cursor} onCursor={onCursor} onPick={onPick} collectKey={key} />
      </Panel>
      <p className="text-xs text-muted">
        Reconstructed between the fixes ({m.track_model_used}), not observed. <GuideLink to="viewer.html#track-pages" />
      </p>
    </div>
  );
}

/** An activity unit as shown: the run's own (g or m/s^2), with a superscript square. */
const accelUnit = (u: string | undefined) => (u || "m/s^2").replace("^2", "²");
/** Decimals for an activity value: 0.1 m/s^2, or 0.01 g (about the same step). */
const accelDigits = (u: string | undefined) => (u === "g" ? 2 : 1);

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
