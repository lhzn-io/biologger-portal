import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "./App";

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
  it("shows the server version from /api/health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "ok", version: "0.1.0", datasets_root_present: true }))),
    );
    renderAt("/deployments");
    expect(await screen.findByText("server 0.1.0")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Deployments" })).toBeTruthy();
  });

  it("says when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    renderAt("/");
    expect(await screen.findByText("server unreachable")).toBeTruthy();
  });
});
