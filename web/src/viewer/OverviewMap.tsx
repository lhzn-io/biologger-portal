import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { reliefCanvas, type Dem } from "./dem";
import { Credits, Legend } from "./Legend";
import type { TrackRow } from "../lib/types";

/** Line width and opacity: the highlighted deployment's track stands out, the others recede. */
function emphasize(m: maplibregl.Map, id: string | null) {
  if (!m.getLayer("tracks")) return;
  const hit: ExpressionSpecification = ["==", ["get", "deployment_id"], id ?? ""];
  m.setPaintProperty("tracks", "line-width", id ? ["case", hit, 5, 2] : 2.5);
  m.setPaintProperty("tracks", "line-opacity", id ? ["case", hit, 1, 0.35] : 1);
}

/**
 * Every track on one north-up map, over the overview DEM crop. A click opens a track; hovering one reports its
 * deployment (onHover), and `highlight` emphasizes a deployment's track (from the table beside the map).
 */
export default function OverviewMap({
  tracks,
  colors,
  dem,
  highlight,
  onHover,
}: {
  tracks: TrackRow[];
  colors: string[];
  dem: Dem | null;
  highlight: string | null;
  onHover: (deploymentId: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const hover = useRef(onHover);
  const current = useRef(highlight);
  const navigate = useNavigate();

  useEffect(() => {
    hover.current = onHover;
    current.current = highlight;
    if (map.current) emphasize(map.current, highlight);
  }, [onHover, highlight]);

  useEffect(() => {
    if (!box.current || tracks.length === 0) return;
    const lats = tracks.flatMap((t) => t.bounds.lat ?? []);
    const lons = tracks.flatMap((t) => t.bounds.lon ?? []);
    const m = new maplibregl.Map({
      container: box.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }] },
      bounds: [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      fitBoundsOptions: { padding: 40 },
      attributionControl: false, // the credits sit behind the (i) instead
      canvasContextAttributes: { preserveDrawingBuffer: true },
      // A plan view, north up: tilting a flat relief image only looks like a broken 3D view (3D is the track page's).
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = m;
    m.on("load", async () => {
      if (dem) {
        const [w, s, e, n] = dem.meta.bounds;
        m.addSource("relief", {
          type: "image",
          url: reliefCanvas(dem).toDataURL(),
          coordinates: [
            [w, n],
            [e, n],
            [e, s],
            [w, s],
          ],
        });
        m.addLayer({ id: "relief", type: "raster", source: "relief" });
      }
      const features = await Promise.all(
        tracks.map(async (t, k) => {
          const res = await fetch(`${t.url}track.geojson`);
          const f = res.ok ? await res.json() : null;
          if (!f) return null;
          const feature = f.type === "FeatureCollection" ? f.features[0] : f;
          return { ...feature, properties: { ...feature.properties, deployment_id: t.deployment_id, run_id: t.run_id, color: colors[k] } };
        }),
      );
      const data: FeatureCollection = { type: "FeatureCollection", features: features.filter(Boolean) };
      m.addSource("tracks", { type: "geojson", data });
      m.addLayer({ id: "tracks", type: "line", source: "tracks", paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
      emphasize(m, current.current);
      m.on("click", "tracks", (e) => {
        const p = e.features?.[0]?.properties as { deployment_id: string; run_id: string } | undefined;
        if (p) navigate(`/deployments/${encodeURIComponent(p.deployment_id)}/track/${encodeURIComponent(p.run_id)}`);
      });
      m.on("mousemove", "tracks", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const id = (e.features?.[0]?.properties as { deployment_id?: string } | undefined)?.deployment_id;
        hover.current(id ?? null);
      });
      m.on("mouseleave", "tracks", () => {
        m.getCanvas().style.cursor = "";
        hover.current(null);
      });
    });
    return () => {
      map.current = null;
      m.remove();
    };
  }, [tracks, colors, dem, navigate]);

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full" data-collect-target="overview-map" />
      {dem && <Legend />}
      <Credits />
    </div>
  );
}
