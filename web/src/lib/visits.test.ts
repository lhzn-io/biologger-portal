import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logVisit, resetVisitLog } from "./visits";

describe("visit log beacon", () => {
  const sent: { url: string; body: string }[] = [];
  beforeEach(() => {
    sent.length = 0;
    resetVisitLog();
    // The test DOM's Blob cannot be read back, so a stand-in keeps the parts it was made from.
    vi.stubGlobal(
      "Blob",
      class {
        constructor(public parts: string[]) {}
      },
    );
    vi.stubGlobal("navigator", {
      sendBeacon: (url: string, blob: { parts: string[] }) => {
        sent.push({ url, body: blob.parts.join("") });
        return true;
      },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends nothing from the hub", () => {
    expect(logVisit("page", undefined, undefined, "/deployments")).toBe(false);
  });

  it("sends a page view and an action from the published viewer", () => {
    vi.stubEnv("VITE_PUBLISHED", "1");
    expect(logVisit("page", undefined, undefined, "/deployments/X?color=depth")).toBe(true);
    expect(logVisit("action", "play", { speed: 60, camera: "chase" }, "/deployments/X")).toBe(true);
    expect(sent.map((s) => s.url)).toEqual(["/api/visit", "/api/visit"]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ kind: "page", path: "/deployments/X?color=depth" });
    expect(JSON.parse(sent[1]!.body)).toEqual({ kind: "action", path: "/deployments/X", action: "play", detail: { speed: 60, camera: "chase" } });
  });

  it("drops the same event repeated within 2 s", () => {
    vi.stubEnv("VITE_PUBLISHED", "1");
    expect(logVisit("action", "studio", { on: true }, "/x")).toBe(true);
    expect(logVisit("action", "studio", { on: true }, "/x")).toBe(false);
    expect(logVisit("action", "studio", { on: false }, "/x")).toBe(true);
  });
});
