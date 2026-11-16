/**
 * The live viewer's visit log: what a page view or action beacon may hold, the row it becomes, and the check on
 * the Cloudflare Access token that guards the admin read. Pure functions, so they can be tested without a Worker.
 */

/** Rows older than this are deleted (the daily cron here, and the hub's mirror). */
export const RETENTION_DAYS = 180;

/** The actions the viewer reports; anything else is refused. */
export const ACTIONS = [
  "play",
  "camera",
  "speed",
  "track_color",
  "chart_pick",
  "studio",
  "fullscreen",
  "collect_add",
  "collect_copy_image",
  "collect_copy_prompt",
  "collect_download",
  "collect_mail",
] as const;
export type VisitAction = (typeof ACTIONS)[number];

export const MAX_BODY = 4096;
const MAX_PATH = 512;
const MAX_DETAIL = 1024;
const MAX_DETAIL_KEYS = 12;

export interface VisitRow {
  at_utc: string;
  email: string;
  country: string;
  kind: "page" | "action";
  path: string;
  action: string;
  detail: string;
}

/**
 * The row for a beacon, "skip" when the request carries no Access email (nothing is recorded), or "bad" when the
 * body is not one the viewer sends. Only the email, the country and the body's own fields are kept: no IP address,
 * no user agent.
 */
export function parseVisit(body: unknown, email: string | null, country: string | null, now: Date): VisitRow | "skip" | "bad" {
  if (!email) return "skip";
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "bad";
  const b = body as Record<string, unknown>;
  if (b.kind !== "page" && b.kind !== "action") return "bad";
  if (typeof b.path !== "string" || !b.path.startsWith("/") || b.path.length > MAX_PATH) return "bad";
  let action = "";
  if (b.kind === "action") {
    if (!(ACTIONS as readonly unknown[]).includes(b.action)) return "bad";
    action = b.action as string;
  } else if (b.action !== undefined) {
    return "bad";
  }
  let detail = "{}";
  if (b.detail !== undefined) {
    const d = b.detail;
    if (typeof d !== "object" || d === null || Array.isArray(d)) return "bad";
    const entries = Object.entries(d as Record<string, unknown>);
    if (entries.length > MAX_DETAIL_KEYS) return "bad";
    for (const [k, v] of entries) {
      if (k.length > 32 || !["string", "number", "boolean"].includes(typeof v)) return "bad";
    }
    detail = JSON.stringify(d);
    if (detail.length > MAX_DETAIL) return "bad";
  }
  return {
    at_utc: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    email: email.toLowerCase().slice(0, 254),
    country: (country ?? "").slice(0, 2),
    kind: b.kind,
    path: b.path,
    action,
    detail,
  };
}

/** The oldest time kept, as stored (ISO UTC, seconds). */
export function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

export interface AccessCerts {
  keys: (JsonWebKey & { kid?: string })[];
}

/**
 * Whether `token` is a Cloudflare Access token for the application `aud`: RS256 signed by one of the team's keys,
 * issued by `https://<team>`, unexpired. Access already blocks the admin path without its service token; this is
 * the Worker's own check, so a mistake in the Access setup does not open the log.
 */
export async function verifyAccessToken(token: string, aud: string, team: string, certs: AccessCerts, now: Date): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || !aud) return false;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: { aud?: string | string[]; exp?: number; iss?: string };
  try {
    header = b64urlJson(h) as typeof header;
    claims = b64urlJson(p) as typeof claims;
  } catch {
    return false;
  }
  if (header.alg !== "RS256") return false;
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) return false;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) return false;
  if (claims.iss !== `https://${team}`) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return false;
  }
}
