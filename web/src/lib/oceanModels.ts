/**
 * Links to the longhorizon.blue "Ocean models compared" page for the Northeast U.S. Shelf, which draws NECOFS and
 * DOPPIO side by side for any hour, at fixed depth levels, in a box. The portal links there for the moment and place
 * under the cursor rather than drawing the model fields itself.
 *
 * The page reads `from` (a UTC day), `t` (an hour, `2025-07-23T19Z`), `bbox` (west,south,east,north) and `depth`
 * (one of its levels; 0 is the surface). The box is centered on the animal to 0.1 degree, so the link places the
 * animal only to within about 10 km.
 */

export const OCEAN_MODELS_URL = "https://longhorizon.blue/northeast-shelf/";

/** The depth levels the page offers, in meters. */
export const OCEAN_MODEL_DEPTHS = [0, 10, 25, 50, 100, 200, 500] as const;

/** Half the box's width and height, in degrees of longitude and latitude (about 70 by 65 km on the shelf). */
const HALF_LON = 0.4;
const HALF_LAT = 0.3;

/** The page's depth level nearest `depthM` (deeper than the last level gives the last). */
export function oceanModelDepth(depthM: number): number {
  if (!Number.isFinite(depthM)) return 0;
  let best: number = OCEAN_MODEL_DEPTHS[0];
  for (const d of OCEAN_MODEL_DEPTHS) if (Math.abs(d - depthM) < Math.abs(best - depthM)) best = d;
  return best;
}

const deg = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** The page at the hour nearest `timeS` (Unix seconds), around the position, at the level nearest the depth. */
export function oceanModelsHref(timeS: number, lat: number, lon: number, depthM: number): string | null {
  if (![timeS, lat, lon].every(Number.isFinite)) return null;
  const hour = new Date(Math.round(timeS / 3600) * 3600 * 1000).toISOString();
  const day = hour.slice(0, 10);
  const cLat = Math.round(lat * 10) / 10;
  const cLon = Math.round(lon * 10) / 10;
  const bbox = [cLon - HALF_LON, cLat - HALF_LAT, cLon + HALF_LON, cLat + HALF_LAT].map(deg).join(",");
  const depth = oceanModelDepth(depthM);
  const q = `from=${day}&t=${day}T${hour.slice(11, 13)}Z&bbox=${bbox}${depth ? `&depth=${depth}` : ""}`;
  return `${OCEAN_MODELS_URL}?${q}`;
}
