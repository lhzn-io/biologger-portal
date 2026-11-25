import { oceanModelDepth, oceanModelsHref } from "../lib/oceanModels";

/**
 * A link to the ocean models (NECOFS and DOPPIO side by side on longhorizon.blue) at the hour, place and depth level
 * of a track sample. It opens in a new tab and sends no referrer.
 */
export function OceanModelsLink({ timeS, lat, lon, depthM }: { timeS: number; lat: number; lon: number; depthM: number }) {
  const href = oceanModelsHref(timeS, lat, lon, depthM);
  if (!href) return null;
  const level = oceanModelDepth(depthM);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-accent hover:underline"
      title="NECOFS and DOPPIO side by side on longhorizon.blue, at the nearest hour and depth level, around this position"
    >
      Ocean models here ({level ? `${level} m` : "surface"})
    </a>
  );
}
