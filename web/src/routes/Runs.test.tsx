import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "../App";
import { jobDuration } from "../lib/sim";

const DEPLOYMENTS = [
  { id: "TEST.001_20250101", species: "Xiphias gladius", common_name: "swordfish", track_count: 1 },
  { id: "TEST.002_20250102", species: "Rhincodon typus", common_name: "whale shark", track_count: 0 },
];

function stubApi(editor: boolean) {
  const batches: unknown[] = [];
  const routes: Record<string, unknown> = {
    "/api/health": { status: "ok", version: "0.1.0", datasets_root_present: true },
    "/api/me": { email: "tester@example.org", editor },
    "/api/deployments": DEPLOYMENTS,
    "/api/tracks": [],
    "/api/sim/jobs?limit=200": [],
    "/api/sim/profiles": [{ name: "axy-standard", title: "Big Axy", description: "", tag_types: [], accepts: ["standard"] }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/sim/batches" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { deployment_ids: string[]; dry_run: boolean };
        batches.push(body);
        return new Response(
          JSON.stringify({
            batch_id: body.dry_run ? null : 3,
            jobs: [],
            planned: [{ deployment_id: "TEST.001_20250101", profile: "axy-standard", input_path: "x" }],
            skipped: [{ deployment_id: "TEST.002_20250102", blockers: ["no time_end_utc"] }],
          }),
        );
      }
      return url in routes ? new Response(JSON.stringify(routes[url])) : new Response('{"detail":"nope"}', { status: 404 });
    }),
  );
  return batches;
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

afterEach(async () => {
  cleanup();
  // Let the collect tray's DOM observer run before the test environment is torn down.
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

describe("Runs", () => {
  it("is not in the navigation for readers", async () => {
    stubApi(false);
    renderAt("/");
    await screen.findByText("tester@example.org (read only)");
    expect(screen.queryByRole("link", { name: "Runs" })).toBeNull();
  });

  it("plans a batch, says why deployments are left out, then queues it", async () => {
    const batches = stubApi(true);
    renderAt("/runs");
    expect(await screen.findByRole("link", { name: "Runs" })).toBeTruthy();
    expect(await screen.findByText(/No runs yet/)).toBeTruthy();
    fireEvent.click(await screen.findByText("Select the 2 shown"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/1 of 2 can run/)).toBeTruthy();
    expect(screen.getByText(/no time_end_utc/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 run" }));
    expect(await screen.findByText(/as batch/)).toBeTruthy();
    expect(batches.map((b) => (b as { dry_run: boolean }).dry_run)).toEqual([true, false]);
  });
});

describe("jobDuration", () => {
  it("measures from the claim to the end, or to now while running", () => {
    const claimed = "2026-11-17T12:00:00Z";
    expect(jobDuration({ claimed_utc: claimed, finished_utc: "2026-11-17T12:03:05Z", status: "done" })).toBe("3m 05s");
    expect(jobDuration({ claimed_utc: claimed, finished_utc: null, status: "running" }, Date.parse("2026-11-17T13:02:00Z"))).toBe(
      "1h 02m",
    );
    expect(jobDuration({ claimed_utc: null, finished_utc: null, status: "queued" })).toBe("--");
  });
});
