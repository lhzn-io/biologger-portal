import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature } from "geojson";
import { reliefCanvas, type Dem } from "./dem";
import { strideIndices, type Track } from "./track";

const ATTRIBUTION =
  "Topobathymetry: GEBCO 2025, GMRT (Ryan et al. 2009, CC BY 4.0), NOAA BlueTopo, NCEI BAG; fused by topobathykit";

/** Plan view: shaded relief from the DEM crop (no map tiles), the track, its fixes, and the cursor. */
export default function Map2D({
  track,
  dem,
  cursor,
  onPick,
}: {
  track: Track;
  dem: Dem | null;
  cursor: number;
  onPick: (index: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const picks = useRef<number[]>([]);

  useEffect(() => {
    if (!box.current) return;
    const { lat, lon } = track.manifest.bounds;
    const m = new maplibregl.Map({
      container: box.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }] },
      bounds: [
        [lon[0], lat[0]],
        [lon[1], lat[1]],
      ],
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
      // Collect paints the map into its image, which needs a readable drawing buffer.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = m;
    picks.current = strideIndices(track.count, 4000);
    m.on("load", () => {
      const coords = picks.current.map((i) => [track.lon[i]!, track.lat[i]!]);
      m.addSource("track", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } });
      m.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#fbbf24", "line-width": 2 } });
      m.addSource("fixes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: track.manifest.fixes.map((f) => ({
            type: "Feature",
            properties: { kind: f.kind },
            geometry: { type: "Point", coordinates: [f.lon, f.lat] },
          })),
        },
      });
      m.addLayer({
        id: "fixes",
        type: "circle",
        source: "fixes",
        paint: { "circle-radius": 6, "circle-color": ["match", ["get", "kind"], "start", "#34d399", "#f87171"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
      });
      m.addSource("cursor", { type: "geojson", data: point(track, 0) });
      m.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": 7, "circle-color": "#3b9cff", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    });
    m.on("click", (e) => {
      let best = 0;
      let bestD = Infinity;
      for (const i of picks.current) {
        const d = (track.lon[i]! - e.lngLat.lng) ** 2 + (track.lat[i]! - e.lngLat.lat) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      onPick(best);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is built once per track; onPick is read through the closure of that track's handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => {
    const m = map.current;
    if (!m || !dem) return;
    const add = () => {
      if (m.getSource("relief")) return;
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
      m.addLayer({ id: "relief", type: "raster", source: "relief", paint: { "raster-fade-duration": 0 } }, m.getLayer("track") ? "track" : undefined);
    };
    if (m.loaded()) add();
    else m.once("load", add);
  }, [dem]);

  useEffect(() => {
    const src = map.current?.getSource("cursor") as GeoJSONSource | undefined;
    src?.setData(point(track, cursor));
  }, [track, cursor]);

  return <div ref={box} className="h-full min-h-80 w-full rounded" data-collect-target="map" />;
}

function point(track: Track, i: number): Feature {
  return { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [track.lon[i]!, track.lat[i]!] } };
}
