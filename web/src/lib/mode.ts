/**
 * Published mode: the Cloudflare viewer is built with VITE_PUBLISHED=1 and reads the static snapshot that
 * `biologger-portal publish` writes (data/v1/, mirroring the hub's API) instead of calling the hub. The hub,
 * on the lab VPN, keeps registration, validation and editing.
 */

const DATA = "/data/v1";

/** Read at call time so tests can switch modes with vi.stubEnv. */
export const isPublished = (): boolean => import.meta.env.VITE_PUBLISHED === "1";

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^\/api\/health$/, () => `${DATA}/snapshot.json`],
  [/^\/api\/deployments$/, () => `${DATA}/deployments.json`],
  [/^\/api\/deployments\/([^/]+)$/, (m) => `${DATA}/deployments/${m[1]}.json`],
  [/^\/api\/matrix$/, () => `${DATA}/matrix.json`],
  [/^\/api\/tracks$/, () => `${DATA}/tracks.json`],
  [/^\/api\/tracks\/([^/]+)\/([^/]+)\/terrain$/, (m) => `${DATA}/terrain/${m[1]}/${m[2]}/terrain.json`],
  [/^\/api\/terrain\/overview$/, () => `${DATA}/terrain/overview/terrain.json`],
  [/^\/tracks\/([^/]+)\/([^/]+)\/(track\.(?:json|f32|geojson))$/, (m) => `${DATA}/tracks/${m[1]}/${m[2]}/${m[3]}`],
];

/** The snapshot file holding what a hub path returns, or null when the snapshot has no equivalent. */
export function snapshotPath(path: string): string | null {
  const p = path.split("?")[0]!;
  if (p.startsWith(`${DATA}/`)) return p;
  for (const [re, to] of RULES) {
    const m = re.exec(p);
    if (m) return to(m);
  }
  return null;
}

/** The address to fetch for a hub path: unchanged on the hub, the snapshot file when published. */
export function resolve(path: string): string {
  if (!isPublished()) return path;
  const s = snapshotPath(path);
  if (s === null) throw new Error(`not part of the published snapshot: ${path}`);
  return s;
}

/** The header of data/v1/snapshot.json (what /api/health resolves to when published). */
export interface SnapshotInfo {
  schema: string;
  published_utc: string;
  portal_version: string;
  content_sha256: string;
  deployments: number;
}
