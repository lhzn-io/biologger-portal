import { describe, expect, it } from "vitest";
import { readPageLink, writePageLink } from "./link";

describe("page link", () => {
  it("round-trips the page state beside the camera parameters", () => {
    const p = new URLSearchParams("cv=1&cam=abc");
    writePageLink(p, { time: 1753297800.4, exaggeration: 8, basis: "track", follow: true, play: "orbit", pick: "look", color: "depth", speed: 2.5 });
    expect(p.get("cam")).toBe("abc");
    expect(p.get("t")).toBe("2025-07-23T19:10:00Z");
    expect(readPageLink(p.toString())).toEqual({ time: 1753297800, exaggeration: 8, basis: "track", follow: true, play: "orbit", pick: "look", color: "depth", speed: 2.5 });
  });

  it("leaves defaults out and ignores bad values", () => {
    const p = new URLSearchParams("depth=track&follow=1&play=free&pick=center&color=depth&speed=1");
    writePageLink(p, { time: 0, exaggeration: 5, basis: "species", follow: false, play: "chase", pick: "lock", color: "odba", speed: 60 });
    expect(p.has("depth") || p.has("follow") || p.has("play") || p.has("pick") || p.has("color") || p.has("speed")).toBe(false);
    expect(readPageLink("t=nonsense&ve=999&depth=other&play=spin&speed=0")).toEqual({});
    expect(readPageLink("speed=fast").speed).toBeUndefined();
    expect(readPageLink("speed=1").speed).toBe(1);
    expect(readPageLink("play=chase").play).toBe("chase");
    expect(readPageLink("pick=lock&color=odba")).toEqual({ pick: "lock", color: "odba" }); // links from before the defaults changed
  });
});
