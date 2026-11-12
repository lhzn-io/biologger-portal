/** Typed fetch helpers for the portal API (same origin; the dev server proxies /api to the server). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

export interface Health {
  status: string;
  version: string;
  datasets_root_present: boolean;
}
