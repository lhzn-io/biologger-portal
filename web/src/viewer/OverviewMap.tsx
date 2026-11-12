import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { reliefCanvas, type Dem } from "./dem";
import { TRACK_COLORS as COLORS } from "../lib/format";
import type { TrackRow } from "../lib/types";

const ATTRIBUTION = "Topobathymetry: GEBCO 2025, GMRT (CC BY 4.0), NOAA BlueTopo, NCEI BAG; fused by topobathykit";

/** Every track on one map, over the overview DEM crop; a click opens that track. */
export default function OverviewMap({ tracks, dem }: { tracks: TrackRow[]; dem: Dem | null }) {
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
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
          return { ...feature, properties: { ...feature.properties, deployment_id: t.deployment_id, run_id: t.run_id, color: COLORS[k % COLORS.length] } };
        }),
      );
      const data: FeatureCollection = { type: "FeatureCollection", features: features.filter(Boolean) };
      m.addSource("tracks", { type: "geojson", data });
      m.addLayer({ id: "tracks", type: "line", source: "tracks", paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
      m.on("click", "tracks", (e) => {
        const p = e.features?.[0]?.properties as { deployment_id: string; run_id: string } | undefined;
        if (p) navigate(`/deployments/${encodeURIComponent(p.deployment_id)}/track/${encodeURIComponent(p.run_id)}`);
      });
      m.on("mouseenter", "tracks", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "tracks", () => (m.getCanvas().style.cursor = ""));
    });
    return () => m.remove();
  }, [tracks, dem, navigate]);

  return <div ref={box} className="h-[26rem] w-full rounded" data-collect-target="overview-map" />;
}
