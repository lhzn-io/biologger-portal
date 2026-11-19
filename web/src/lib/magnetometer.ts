import type { DeploymentDetail } from "./types";

/**
 * True when the deployment's latest verified deep validation found no magnetometer data. Such a tag has no
 * heading, so biologger-sim cannot dead-reckon it: its only tracks are interpolated between the fixes.
 */
export function lacksMagnetometer(d: Pick<DeploymentDetail, "validation_runs">): boolean {
  const deep = d.validation_runs.filter(
    (v) => v.mode === "deep" && !v.unverified && v.results.facts !== undefined && "magnetometer_present" in v.results.facts,
  );
  if (deep.length === 0) return false;
  const latest = deep.reduce((a, b) => (b.created_utc > a.created_utc ? b : a));
  const present = latest.results.facts?.magnetometer_present;
  return present === false || present === 0;
}
