/** Formatting shared by the pages. Times are shown in UTC, the lab's sheets' convention. */

export function utc(seconds: number | null | undefined): string {
  if (seconds == null) return "--";
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function duration(start: number | null, end: number | null): string {
  if (start == null || end == null || end < start) return "--";
  const minutes = Math.round((end - start) / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return "--";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function coord(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return "--";
  return `${Math.abs(lat).toFixed(4)} ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)} ${lon >= 0 ? "E" : "W"}`;
}

export const KIND_LABELS: Record<string, string> = {
  standard: "Standard",
  accel_rotate: "Accel rotate",
  standard_rot_sep: "Rot sep",
  mag_heading: "Mag heading",
  raw: "Raw",
  video: "Video",
  track: "Track",
  cache: "Cache",
  metadata_sheet: "Sheet",
  doc: "Doc",
  other: "Other",
};
