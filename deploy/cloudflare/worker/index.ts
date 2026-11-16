/**
 * The published viewer's Worker. Static files are served by Workers static assets without running this code;
 * only /api/* comes here (wrangler.toml run_worker_first):
 *
 *   POST /api/visit         a page view or action beacon from the viewer, logged with the visitor's Access email
 *   GET  /api/admin/visits  the log, for the hub; behind its own Access application (service token only)
 *
 * The daily cron deletes rows older than RETENTION_DAYS.
 */
import { MAX_BODY, parseVisit, RETENTION_DAYS, retentionCutoff, verifyAccessToken, type AccessCerts } from "./visits";

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  VISITS: { prepare(sql: string): D1Statement };
  /** <team>.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN: string;
  /** The audience tag of the Access application on /api/admin/*; empty keeps the admin read closed. */
  ADMIN_AUD: string;
}

const PAGE = 1000;
let certCache: { at: number; certs: AccessCerts } | null = null;

async function accessCerts(team: string): Promise<AccessCerts> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.certs;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs: HTTP ${r.status}`);
  certCache = { at: Date.now(), certs: (await r.json()) as AccessCerts };
  return certCache.certs;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function logVisit(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  const row = parseVisit(body, request.headers.get("cf-access-authenticated-user-email"), country, new Date());
  if (row === "bad") return new Response(null, { status: 400 });
  if (row !== "skip") {
    await env.VISITS.prepare("INSERT INTO visits (at_utc, email, country, kind, path, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(row.at_utc, row.email, row.country, row.kind, row.path, row.action, row.detail)
      .run();
  }
  return new Response(null, { status: 204 });
}

async function readVisits(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_AUD || !env.ACCESS_TEAM_DOMAIN) return json({ detail: "the admin read is not configured" }, 503);
  const token = request.headers.get("cf-access-jwt-assertion") ?? "";
  if (!(await verifyAccessToken(token, env.ADMIN_AUD, env.ACCESS_TEAM_DOMAIN, await accessCerts(env.ACCESS_TEAM_DOMAIN), new Date()))) {
    return json({ detail: "forbidden" }, 403);
  }
  const url = new URL(request.url);
  const after = Math.max(0, Math.floor(Number(url.searchParams.get("after_id")) || 0));
  const limit = Math.min(PAGE, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || PAGE)));
  const { results } = await env.VISITS.prepare(
    "SELECT id, at_utc, email, country, kind, path, action, detail FROM visits WHERE id > ? ORDER BY id LIMIT ?",
  )
    .bind(after, limit)
    .all<{ id: number }>();
  return json({ visits: results, retention_days: RETENTION_DAYS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/visit") return request.method === "POST" ? logVisit(request, env) : new Response(null, { status: 405 });
    if (pathname === "/api/admin/visits") return request.method === "GET" ? readVisits(request, env) : new Response(null, { status: 405 });
    if (pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await env.VISITS.prepare("DELETE FROM visits WHERE at_utc < ?").bind(retentionCutoff(new Date())).run();
  },
};
