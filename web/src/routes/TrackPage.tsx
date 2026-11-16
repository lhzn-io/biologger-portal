import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorNote, Loading, Panel } from "../components/ui";
import CollectPanel from "../collect/CollectPanel";
import { mapText, readoutText } from "../collect/texts";
import { useTracks } from "../lib/queries";
import Charts from "../viewer/Charts";
import { depthScale, loadDem, type DepthScale } from "../viewer/dem";
import { Credits, Legend } from "../viewer/Legend";
import { fmt, readoutAt } from "../viewer/readout";
import Scene3D, { type SceneView } from "../viewer/Scene3D";
import SceneControls from "../viewer/SceneControls";
import { logVisit } from "../lib/visits";
import { odbaScale } from "../viewer/activity";
import { DEFAULT_CHART_PICK, DEFAULT_PLAY_CAMERA, DEFAULT_TRACK_COLOR, PLAY_CAMERAS, readPageLink, writePageLink, type ChartPick, type PlayCamera, type TrackColor } from "../viewer/link";
import { indexAt, loadTrack, timeOf } from "../viewer/track";

const SPEEDS = [60, 600, 3600]; // seconds of track per second of playback
const PLAY_CAMERA_LABELS: Record<PlayCamera, string> = { free: "Free", chase: "Chase", orbit: "Orbit" };

export default function TrackPage() {
  const params = useParams();
  const depId = decodeURIComponent(params.id ?? "");
  const runId = decodeURIComponent(params.run ?? "");
  const track = useQuery({ queryKey: ["track", depId, runId], queryFn: () => loadTrack(depId, runId), staleTime: Infinity });
  // The DEM crop can take up to a minute the first time topobathykit builds it; the track shows meanwhile.
  const dem = useQuery({ queryKey: ["dem", depId, runId], queryFn: () => loadDem(depId, runId), staleTime: Infinity, retry: 1 });
  const tracks = useTracks();
  // A shared link (see viewer/link.ts) sets the opening state; the camera in it is vantagekit's.
  const [initial] = useState(() => readPageLink(location.search));
  // Null until the viewer moves the cursor: until then it sits at the link's time, or the start.
  const [cursorSet, setCursor] = useState<number | null>(null);
  const [exag, setExag] = useState(initial.exaggeration ?? 5);
  const [speed, setSpeed] = useState<number | null>(null);
  const [follow, setFollow] = useState(initial.follow ?? false);
  const [playCam, setPlayCam] = useState<PlayCamera>(initial.play ?? DEFAULT_PLAY_CAMERA);
  const [pick, setPick] = useState<ChartPick>(initial.pick ?? DEFAULT_CHART_PICK);
  const [trackColor, setTrackColor] = useState<TrackColor>(initial.color ?? DEFAULT_TRACK_COLOR);
  const [basis, setBasis] = useState<DepthScale["basis"]>(initial.basis ?? "species");
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
  const cursor = cursorSet ?? (tr && initial.time != null ? indexAt(tr, initial.time) : 0);
  // The URL follows the view: the camera is written as it settles, the rest here once changes pause (playback
  // writes when it stops), so the address bar can be copied to share this moment and view.
  const linkWrite = useRef<((p: URLSearchParams) => void) | null>(null);
  useEffect(() => {
    if (!tr) return;
    const state = { time: timeOf(tr, cursor), exaggeration: exag, basis, follow, play: playCam, pick, color: trackColor };
    linkWrite.current = (p) => writePageLink(p, state);
    const id = setTimeout(() => view.current?.writeLink(), 400);
    return () => clearTimeout(id);
  }, [tr, cursor, exag, basis, follow, playCam, pick, trackColor]);
  // While the track plays, Chase and Orbit hold the view on the animal: Chase from behind, turning with it, Orbit
  // at the angle the viewer sets with the mouse. Pausing leaves the camera where it is, back under the viewer's own
  // Follow setting.
  const playing = speed != null;
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
  // Track colors: by depth, or by ODBA when the viewer picks it and the bundle has it.
  const activity = useMemo(() => (tr ? odbaScale(tr) : null), [tr]);
  const byOdba = trackColor === "odba" && activity != null;
  useEffect(() => {
    if (!tr || speed == null) return;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCursor((prev) => {
        const c = prev ?? 0; // Play and Speed set the cursor first
        const next = c + Math.max(1, Math.round(dt * speed * tr.manifest.rate_hz));
        if (next >= tr.count - 1) {
          setSpeed(null);
          return tr.count - 1;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [tr, speed]);
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

  if (track.isLoading) return <Loading what="the track" />;
  if (track.error || !tr) return <ErrorNote error={track.error} />;
  const r = readoutAt(tr, dem.data ?? null, cursor);
  const key = `track:${depId}:${runId}`;
  const m = tr.manifest;
  // Play, speed and camera, under the readout and, in studio or full screen, inside the 3D view.
  const playbar = (
    <>
          <Button kind="plain" onClick={() => {
            setCursor(cursor);
            if (speed == null) {
              approach(playCam, SPEEDS[0]!, false);
              logVisit("action", "play", { speed: SPEEDS[0]!, camera: playCam });
            }
            setSpeed(speed == null ? SPEEDS[0]! : null);
          }}>
            {speed == null ? "Play" : "Pause"}
          </Button>
          <label className="flex items-center gap-1 text-muted">
            Speed
            <select className="rounded border border-line bg-surface px-1" value={speed ?? SPEEDS[0]} onChange={(e) => {
              setCursor(cursor);
              const next = Number(e.target.value);
              approach(playCam, next, playing && playCam === "orbit"); // Orbit reframes for the new speed
              logVisit("action", "speed", { speed: next });
              setSpeed(next);
            }}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted" title="What the 3D view's camera does while the track plays. Chase follows from behind and turns with the animal; Orbit stays on the animal at the angle you set: drag, or click the view and use A/D to turn, W/S to tilt, Q/E to zoom.">
            Camera
            <select className="rounded border border-line bg-surface px-1" value={playCam} onChange={(e) => {
              const next = e.target.value as PlayCamera;
              setPlayCam(next);
              logVisit("action", "camera", { camera: next });
              if (speed != null) approach(next, speed, true);
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
          {m.provenance.sim_git_dirty ? " (exported from a simulator checkout with uncommitted changes)" : ""}
        </span>
      </header>

      <CollectPanel id={`${key}:readout`} title={`Cursor readout, ${depId}`} text={() => readoutText(tr, dem.data ?? null, cursor)}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs md:grid-cols-5">
          <Item label="Time (UTC)" value={r.time_utc} />
          <Item label="Position" value={`${fmt(r.lat, 5)}, ${fmt(r.lon, 5)}`} />
          <Item label="Depth" value={`${fmt(r.depth_m)} m`} />
          <Item label="Seafloor (DEM)" value={r.seafloor_depth_m == null ? "--" : `${fmt(r.seafloor_depth_m)} m`} />
          <Item label="Above seafloor" value={r.above_seafloor_m == null ? "--" : `${fmt(r.above_seafloor_m)} m`} />
          <Item label={tr.headingSource === "tag" ? "Heading" : "Heading (fix bearing; no magnetometer)"} value={`${fmt(r.heading_deg)} deg`} />
          <Item label="Pitch" value={`${fmt(r.pitch_deg)} deg`} />
          <Item label="Roll" value={`${fmt(r.roll_deg)} deg`} />
          <Item label={`VeDBA (${tr.units.vedba || "m/s^2"})`} value={fmt(r.vedba, 3)} />
          {r.odba != null && <Item label={`ODBA (${tr.units.odba || tr.units.vedba || "m/s^2"})`} value={fmt(r.odba, 3)} />}
          <Item label="From start fix" value={`${fmt(r.north_m / 1000, 2)} km N, ${fmt(r.east_m / 1000, 2)} km E`} />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {playbar}
          {dem.isLoading && <span className="text-xs text-muted">Fetching topobathymetry (the first view of a track can take up to a minute)...</span>}
          {dem.error && <span className="text-xs text-bad">No terrain: {dem.error.message}</span>}
          {dem.data && (
            <span className="text-xs text-muted">
              Terrain: {dem.data.terrain.dataset}, {dem.data.meta.width} x {dem.data.meta.height} cells
            </span>
          )}
        </div>
      </CollectPanel>

      <CollectPanel id={`${key}:scene`} title={`3D view, ${depId}`} text={() => mapText(tr, dem.data ?? null, exag, scale, species, byOdba ? activity : null)}>
        <div ref={sceneBox} className={studio ? "fixed inset-0 z-[100] bg-[#0b1220]" : "relative h-[36rem] bg-[#0b1220]"}>
          <Scene3D track={tr} dem={dem.data ?? null} cursor={cursor} exaggeration={exag} colorBy={byOdba ? "odba" : "depth"} colorMax={byOdba ? activity.max : scale.max} follow={following} chase={chasing} species={species} viewRef={view} linkWrite={linkWrite} />
          <Legend depth={byOdba ? null : scale} activity={byOdba ? activity : null} species={species} />
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
            speciesScale={scales.ofSpecies}
            trackScale={scales.track}
            species={species}
          />
          <Credits />
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
        Positions between the start and end fixes are reconstructed by dead reckoning ({m.track_model_used}), not
        observed. Seafloor depths are read from the fused DEM at the reconstructed position.
      </p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
