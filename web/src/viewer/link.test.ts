import { describe, expect, it } from "vitest";
import { readPageLink, writePageLink } from "./link";

describe("page link", () => {
  it("round-trips the page state beside the camera parameters", () => {
    const p = new URLSearchParams("cv=1&cam=abc");
    writePageLink(p, { time: 1753297800.4, exaggeration: 8, basis: "track", follow: true });
    expect(p.get("cam")).toBe("abc");
    expect(p.get("t")).toBe("2025-07-23T19:10:00Z");
    expect(readPageLink(p.toString())).toEqual({ time: 1753297800, exaggeration: 8, basis: "track", follow: true });
  });

  it("leaves defaults out and ignores bad values", () => {
    const p = new URLSearchParams("depth=track&follow=1");
    writePageLink(p, { time: 0, exaggeration: 5, basis: "species", follow: false });
    expect(p.has("depth") || p.has("follow")).toBe(false);
    expect(readPageLink("t=nonsense&ve=999&depth=other")).toEqual({});
  });
});
