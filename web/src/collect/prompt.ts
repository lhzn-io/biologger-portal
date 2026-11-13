import template from "../../../configs/prompts/portal_prompt.txt?raw";
import { itemText, liveIds } from "./registry";

/** Method notes every prompt carries, so an assistant reads the numbers the way the portal computed them. */
export const METHODS = [
  "- Tracks are reconstructed by biologger-sim from the tag's accelerometer, magnetometer and depth sensor (dead reckoning). " +
    "Positions are observed only at the start and end fixes; in a fix_pinned track the dead-reckoned path is rotated and " +
    "scaled so it ends at the end fix (the heading correction and scale are given when known).",
  "- Positions are meters north and east of the start fix, converted to latitude and longitude with an equirectangular " +
    "approximation (Earth radius 6,371,000 m).",
  "- Depths are meters below the surface, from the tag's pressure sensor. Seafloor depths are read from a fused " +
    "topobathymetric grid (GEBCO 2025, GMRT multibeam, NOAA BlueTopo, NCEI BAG) at the reconstructed position, so they " +
    "inherit the position's uncertainty.",
  "- VeDBA is the vectorial dynamic body acceleration, in the unit given with it.",
  "- Validation results come from reading the whole file; each lists the fixed thresholds it used.",
].join("\n");

export function fillTemplate(values: Record<string, string>, tpl = template): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

/** The prompt for the collected items (every item on the page when none), ending with the question. */
export function buildPrompt(ids: string[], question: string, pageUrl = location.href, now = new Date()): string {
  const chosen = ids.length ? ids : liveIds();
  const sections = chosen
    .map((id) => itemText(id))
    .filter((x): x is { title: string; text: string } => x != null)
    .map((x) => `## ${x.title}\n${x.text.trim()}`);
  return fillTemplate({
    page_url: pageUrl,
    generated_at: now.toISOString().slice(0, 16).replace("T", " "),
    methods: METHODS,
    data: sections.join("\n\n") || "(nothing on this page to describe)",
    question: question.trim() || "What stands out here?",
  });
}

/** "name: value" lines, skipping empty values. */
export function lines(pairs: [string, unknown][]): string {
  return pairs
    .filter(([, v]) => v !== "" && v != null && !(typeof v === "number" && !Number.isFinite(v)))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** Minimum, maximum and mean of the finite values. */
export function stats(values: ArrayLike<number>): { min: number; max: number; mean: number; n: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return { min, max, mean: n ? sum / n : NaN, n };
}
