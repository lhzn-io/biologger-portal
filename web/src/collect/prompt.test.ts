import { afterEach, describe, expect, it } from "vitest";
import { buildPrompt, fillTemplate, lines, stats } from "./prompt";
import { clearRegistry, itemText, register } from "./registry";

afterEach(clearRegistry);

describe("Collect prompt", () => {
  it("carries each collected item's text, the method notes and the question", () => {
    register("a", { title: "Readout", text: () => "depth_m: 20.4", element: () => null });
    register("b", { title: "Depth chart", text: () => "min: 0.5", element: () => null });
    const p = buildPrompt(["b"], "Why the plunge?", "https://portal.example/x", new Date("2026-11-12T20:00:00Z"));
    expect(p).toContain("## Depth chart\nmin: 0.5");
    expect(p).not.toContain("Readout");
    expect(p).toContain("dead reckoning");
    expect(p).toContain("https://portal.example/x");
    expect(p).toContain("2026-11-12 20:00");
    expect(p.trim().endsWith("Question: Why the plunge?")).toBe(true);
  });

  it("covers every item on the page when nothing is collected", () => {
    register("a", { title: "One", text: () => "1", element: () => null });
    register("b", { title: "Two", text: () => "2", element: () => null });
    const p = buildPrompt([], "");
    expect(p).toContain("## One");
    expect(p).toContain("## Two");
    expect(p).toContain("What stands out here?");
  });

  it("keeps an item's last text after its page unmounts", () => {
    let depth = 10;
    const off = register("r", { title: "Readout", text: () => `depth_m: ${depth}`, element: () => null });
    depth = 42;
    off();
    expect(itemText("r")).toEqual({ title: "Readout", text: "depth_m: 42" });
  });

  it("formats helpers", () => {
    expect(fillTemplate({ a: "x" }, "{{a}}-{{b}}")).toBe("x-");
    expect(lines([["a", 1], ["b", ""], ["c", NaN], ["d", "y"]])).toBe("a: 1\nd: y");
    const s = stats(new Float32Array([1, NaN, 3]));
    expect([s.min, s.max, s.mean, s.n]).toEqual([1, 3, 2, 2]);
  });
});
