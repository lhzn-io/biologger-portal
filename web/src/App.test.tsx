import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "./App";

const DEPLOYMENTS = [
  {
    id: "WHOI.001_20250827", species: "Xiphias gladius", common_name: "swordfish", location: "Shelf Canyons",
    time_start_utc: 1756337580, time_end_utc: 1756495440, start_lat: 35.5179, start_lon: -45.5136,
    end_lat: null, end_lon: null, dem_dataset: "112bafb5_30m", file_count: 3, total_bytes: 307609192,
    track_count: 1, last_validation: "warning",
  },
  {
    id: "RED001_20220812", species: "Xiphias gladius", common_name: "swordfish", location: "Shelf Canyons",
    time_start_utc: 1660358100, time_end_utc: 1660391760, start_lat: 35.53, start_lon: -45.69,
    end_lat: null, end_lon: null, dem_dataset: "", file_count: 2, total_bytes: 33134147,
    track_count: 0, last_validation: null,
  },
];

const ROUTES: Record<string, unknown> = {
  "/api/health": { status: "ok", version: "0.1.0", datasets_root_present: true },
  "/api/me": { email: "tester@example.org", editor: false },
  "/api/deployments": DEPLOYMENTS,
  "/api/tracks": [],
};

function stubApi(overrides: Record<string, unknown> = {}) {
  const routes = { ...ROUTES, ...overrides };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url in routes ? new Response(JSON.stringify(routes[url])) : new Response('{"detail":"nope"}', { status: 404 }),
    ),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the server version and the signed-in user", async () => {
    stubApi();
    renderAt("/");
    expect(await screen.findByText("server 0.1.0")).toBeTruthy();
    expect(await screen.findByText("tester@example.org (read only)")).toBeTruthy();
  });

  it("says when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    renderAt("/");
    expect(await screen.findByText("server unreachable")).toBeTruthy();
  });

  it("lists deployments sorted by release, and re-sorts by size", async () => {
    stubApi();
    renderAt("/deployments");
    await screen.findByText("WHOI.001_20250827");
    const ids = () => screen.getAllByRole("link").map((a) => a.textContent).filter((t) => t?.includes("_"));
    expect(ids()).toEqual(["RED001_20220812", "WHOI.001_20250827"]);
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(ids()).toEqual(["RED001_20220812", "WHOI.001_20250827"]);
    fireEvent.click(screen.getByRole("button", { name: /Size/ }));
    expect(ids()).toEqual(["WHOI.001_20250827", "RED001_20220812"]);
  });

  it("tells read-only users they cannot register files", async () => {
    stubApi();
    renderAt("/register");
    expect(await screen.findByText(/can read the catalog but not register files/)).toBeTruthy();
  });
});

describe("App, published", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the snapshot, shows its date, and leaves out registration and identity", async () => {
    vi.stubEnv("VITE_PUBLISHED", "1");
    stubApi({
      "/data/v1/snapshot.json": {
        schema: "portal-snapshot-v1", published_utc: "2026-11-12T18:04:05Z", portal_version: "0.1.0",
        content_sha256: "9ee6beee1e6c00", deployments: 2,
      },
      "/data/v1/deployments.json": DEPLOYMENTS,
      "/data/v1/tracks.json": [],
    });
    renderAt("/");
    expect(await screen.findByText("snapshot 2026-11-12 18:04 UTC")).toBeTruthy();
    expect(await screen.findByText("Files cataloged")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
    expect(screen.queryByText(/read only/)).toBeNull();
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith("/data/v1/"))).toBe(true);
  });

  it("points registration at the hub", async () => {
    vi.stubEnv("VITE_PUBLISHED", "1");
    stubApi();
    renderAt("/register");
    expect(await screen.findByText(/happen on the hub, on the lab VPN/)).toBeTruthy();
  });
});
