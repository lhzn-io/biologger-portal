import { describe, expect, it } from "vitest";
import { lacksMagnetometer } from "./magnetometer";
import type { ValidationRun } from "./types";

function run(over: Partial<ValidationRun> & { present?: unknown }): ValidationRun {
  const { present, ...rest } = over;
  return {
    id: 1, deployment_id: "D", file_id: null, file_path: "f.csv", mode: "deep", status: "passed", tool_version: "1",
    unverified: false, summary: "", requested_by: "", created_utc: "2026-11-10T00:00:00Z", started_utc: null,
    finished_utc: null, results: present === undefined ? { facts: {} } : { facts: { magnetometer_present: present } },
    ...rest,
  };
}

describe("lacksMagnetometer", () => {
  it("is true when the latest verified deep validation found none", () => {
    expect(lacksMagnetometer({ validation_runs: [run({ present: false })] })).toBe(true);
    expect(lacksMagnetometer({ validation_runs: [run({ present: 0 })] })).toBe(true);
  });
  it("is false with a magnetometer, without a deep validation, or when only unverified runs say so", () => {
    expect(lacksMagnetometer({ validation_runs: [run({ present: true })] })).toBe(false);
    expect(lacksMagnetometer({ validation_runs: [] })).toBe(false);
    expect(lacksMagnetometer({ validation_runs: [run({})] })).toBe(false);
    expect(lacksMagnetometer({ validation_runs: [run({ present: false, unverified: true })] })).toBe(false);
    expect(lacksMagnetometer({ validation_runs: [run({ present: false, mode: "light" })] })).toBe(false);
  });
  it("follows the latest run", () => {
    const older = run({ id: 1, present: false, created_utc: "2026-11-01T00:00:00Z" });
    const newer = run({ id: 2, present: true, created_utc: "2026-11-12T00:00:00Z" });
    expect(lacksMagnetometer({ validation_runs: [older, newer] })).toBe(false);
  });
});
