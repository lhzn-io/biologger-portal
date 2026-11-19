/** Typed fetch helpers for the portal API (same origin; the dev server proxies /api to the server). */

import { isPublished, resolve } from "./mode";

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response, path: string): Promise<ApiError> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
  } catch {
    // not JSON: keep the status line
  }
  return new ApiError(res.status, `${detail} (${path})`);
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolve(path), { ...init, headers: { Accept: "application/json", ...init?.headers } });
  if (!res.ok) throw await errorFrom(res, path);
  return (await res.json()) as T;
}

export function sendJson<T>(path: string, method: "POST" | "PATCH" | "PUT", body: unknown): Promise<T> {
  if (isPublished()) return Promise.reject(new ApiError(405, "the published viewer is read only; changes are made on the hub"));
  return getJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export interface Health {
  status: string;
  version: string;
  datasets_root_present: boolean;
}

/** Uploads a file in parts (Cloudflare caps a request body at 100 MB), reporting progress 0 to 1. */
export async function uploadFile(
  deploymentId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ path: string; sha256: string; file_id: number | null; validation_run?: number }> {
  const sha256 = await sha256Hex(file);
  const up = await sendJson<{ id: string; parts: number; part_bytes: number }>("/api/uploads", "POST", {
    deployment_id: deploymentId,
    filename: file.name,
    size: file.size,
    sha256,
  });
  for (let i = 0; i < up.parts; i++) {
    const part = file.slice(i * up.part_bytes, Math.min(file.size, (i + 1) * up.part_bytes));
    const res = await fetch(`/api/uploads/${up.id}/parts/${i}`, { method: "PUT", body: part });
    if (!res.ok) throw await errorFrom(res, `part ${i}`);
    onProgress((i + 1) / up.parts);
  }
  return sendJson(`/api/uploads/${up.id}/complete`, "POST", {});
}

async function sha256Hex(file: File): Promise<string | undefined> {
  // Hashing in the browser needs the whole file in memory; skip it for files over 512 MB.
  if (file.size > 512 * 1024 * 1024 || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
