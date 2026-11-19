# Copyright (c) 2026 Long Horizon Observatory
# Licensed under the Apache License, Version 2.0. See LICENSE file for details.

"""Light and deep checks of a standard export.

Light reads the header, the first ``LIGHT_ROWS`` rows and the last line (seconds, at registration).
Deep streams the whole file in chunks (a 300 MB, 4 million row file in tens of seconds).
Column names, the time parser and the g versus m/s^2 rule come from biologger-sim's loader
(``biologger_sim.io.data_loader``), so the portal and the simulator read a file the same way.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from biologger_sim.io.data_loader import STANDARD_COLUMNS, STANDARD_GRAVITY

from ..scanner import file_info

TIME = "datetime_utc"
DEPTH = "depth_m"
TEMP = "temperature_c"
ACCEL = ("accelX_total_raw", "accelY_total_raw", "accelZ_total_raw")
MAG = ("magX_raw", "magY_raw", "magZ_raw")
REQUIRED = (TIME, DEPTH, *ACCEL)
NUMERIC = tuple(STANDARD_COLUMNS)  # depth, temperature, accel x3, mag x3

LIGHT_ROWS = 5000
CHUNK_ROWS = 500_000

# Fixed thresholds, returned with every result.
THRESHOLDS: dict[str, Any] = {
    "g_if_median_accel_magnitude_below": 3.0,  # biologger-sim from_standard_export rule
    "gap_factor": 2.0,  # a gap is an interval longer than 2 x the median interval
    "accel_component_limit_g": 16.0,
    "depth_limits_m": [-5.0, 3000.0],
    "temperature_limits_c": [-5.0, 40.0],
    "duplicate_warning_fraction": 0.001,
    "violation_failure_fraction": 0.01,
    "unparseable_failure_fraction": 0.01,
    # Sheet times are recorded to the minute, so the data may start or end within this of them.
    "window_tolerance_s": 120.0,
}

ORDER = {"passed": 0, "warning": 1, "failed": 2}


@dataclass
class Result:
    mode: str
    checks: list[dict[str, str]] = field(default_factory=list)
    facts: dict[str, Any] = field(default_factory=dict)

    def check(self, name: str, status: str, detail: str) -> None:
        self.checks.append({"name": name, "status": status, "detail": detail})

    @property
    def status(self) -> str:
        return max((c["status"] for c in self.checks), key=ORDER.__getitem__, default="passed")

    def summary(self) -> str:
        bad = [c for c in self.checks if c["status"] != "passed"]
        if not bad:
            return f"{self.mode.capitalize()} validation passed {len(self.checks)} checks."
        return "; ".join(f"{c['name']}: {c['detail']}" for c in bad)

    def to_json(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "checks": self.checks,
            "facts": self.facts,
            "thresholds": THRESHOLDS,
        }


class ValidationError(Exception):
    """The file cannot be validated (missing, unreadable, not a standard export)."""


def time_format(sample: str) -> str:
    text = sample.strip().strip('"')
    if text.endswith("Z") or (len(text) > 6 and text[-6] in "+-" and text[-3] == ":"):
        return "iso_with_zone"
    return "iso_naive"


def parse_times(values: pd.Series) -> pd.Series:
    """biologger-sim's parse: ISO 8601, naive values taken as UTC; unparseable values become NaT."""
    return pd.to_datetime(values, utc=True, format="ISO8601", errors="coerce")


def unix_seconds(times: pd.Series) -> np.ndarray:
    """Unix seconds of the parsed (non-NaT) times, whatever resolution pandas inferred."""
    valid = times.dropna()
    return np.asarray((valid - pd.Timestamp(0, tz="UTC")).dt.total_seconds(), dtype=float)


def accel_unit(median_magnitude: float) -> str:
    return "g" if median_magnitude < THRESHOLDS["g_if_median_accel_magnitude_below"] else "m/s^2"


def read_header(path: Path) -> list[str]:
    if not path.is_file():
        raise ValidationError(f"file not found: {path.name}")
    with path.open("r", encoding="utf-8-sig", errors="replace") as fh:
        return [c.strip().strip('"') for c in fh.readline().strip().split(",")]


def _common_header_checks(result: Result, columns: list[str]) -> list[str]:
    missing = [c for c in REQUIRED if c not in columns]
    result.facts["columns"] = columns
    result.facts["missing_required"] = missing
    if missing:
        result.check("required columns", "failed", "missing " + ", ".join(missing))
    else:
        result.check("required columns", "passed", "time, depth and three accelerometer axes present")
    present_mag = [c for c in MAG if c in columns]
    result.facts["magnetometer_columns"] = present_mag
    return missing


def _unit_check(result: Result, accel: np.ndarray) -> float | None:
    """Records the accelerometer unit; returns the factor that converts values to g, or None."""
    mags = np.sqrt(np.nansum(accel**2, axis=1))
    mags = mags[np.isfinite(mags) & (mags > 0)]
    if mags.size == 0:
        result.check("accelerometer units", "failed", "no accelerometer values")
        return None
    median = float(np.median(mags))
    unit = accel_unit(median)
    result.facts["accel_unit"] = unit
    result.facts["accel_median_magnitude"] = round(median, 4)
    result.check("accelerometer units", "passed", f"{unit} (median |a| {median:.3f})")
    return 1.0 if unit == "g" else 1.0 / STANDARD_GRAVITY


def light(path: Path) -> Result:
    result = Result("light")
    columns = read_header(path)
    if _common_header_checks(result, columns):
        return result
    usecols = [c for c in (*REQUIRED, TEMP, *MAG) if c in columns]
    df = pd.read_csv(path, usecols=usecols, nrows=LIGHT_ROWS, dtype={TIME: str}, encoding="utf-8-sig")
    fmt = time_format(str(df[TIME].dropna().iloc[0])) if df[TIME].notna().any() else "none"
    result.facts["time_format"] = fmt
    if fmt == "iso_naive":
        result.check("time zone", "warning", "timestamps carry no zone; read as UTC")
    else:
        result.check("time zone", "passed", "timestamps carry a zone")
    times = parse_times(df[TIME])
    bad = int(times.isna().sum())
    if bad:
        result.check("timestamps", "warning", f"{bad} of the first {len(df)} rows unparseable")
    secs = unix_seconds(times)
    if secs.size >= 2:
        dt = float(np.median(np.diff(secs)))
        result.facts["median_dt_s"] = dt
        result.facts["rate_hz_estimate"] = round(1.0 / dt, 3) if dt > 0 else None
    accel = df[list(ACCEL)].apply(pd.to_numeric, errors="coerce").to_numpy(float)
    _unit_check(result, accel)
    fill = {c: round(float(df[c].notna().mean()), 4) for c in usecols if c != TIME}
    result.facts["fill_fraction_head"] = fill
    info = file_info(path, "standard")
    result.facts["first_time"] = info.get("first_time")
    result.facts["last_time"] = info.get("last_time")
    return result


@dataclass
class _Stream:
    rows: int = 0
    bad_times: int = 0
    duplicates: int = 0
    non_monotonic: int = 0
    gaps: int = 0
    max_gap_s: float = 0.0
    first: float | None = None
    last: float | None = None
    median_dt: float | None = None
    counts: dict[str, int] = field(default_factory=dict)
    minmax: dict[str, list[float]] = field(default_factory=dict)
    violations: dict[str, int] = field(default_factory=dict)


def deep(path: Path, window: tuple[float | None, float | None] = (None, None)) -> Result:
    result = Result("deep")
    columns = read_header(path)
    if _common_header_checks(result, columns):
        return result
    numeric = [c for c in NUMERIC if c in columns]
    s = _Stream(counts={c: 0 for c in numeric}, violations={c: 0 for c in numeric})
    to_g: float | None = None
    fmt = "none"
    reader = pd.read_csv(
        path, usecols=[TIME, *numeric], dtype={TIME: str}, chunksize=CHUNK_ROWS, encoding="utf-8-sig"
    )
    prev_t: float | None = None
    for chunk in reader:
        n = len(chunk)
        s.rows += n
        if fmt == "none" and chunk[TIME].notna().any():
            fmt = time_format(str(chunk[TIME].dropna().iloc[0]))
        times = parse_times(chunk[TIME])
        s.bad_times += int(times.isna().sum())
        secs = unix_seconds(times)
        if secs.size:
            s.first = secs[0] if s.first is None else s.first
            s.last = secs[-1]
            seq = secs if prev_t is None else np.concatenate(([prev_t], secs))
            diffs = np.diff(seq)
            if s.median_dt is None and diffs.size:
                pos = diffs[diffs > 0]
                s.median_dt = float(np.median(pos)) if pos.size else None
            s.duplicates += int((diffs == 0).sum())
            s.non_monotonic += int((diffs < 0).sum())
            if s.median_dt:
                big = diffs[diffs > THRESHOLDS["gap_factor"] * s.median_dt]
                s.gaps += int(big.size)
                if big.size:
                    s.max_gap_s = max(s.max_gap_s, float(big.max()))
            prev_t = secs[-1]
        values = chunk[numeric].apply(pd.to_numeric, errors="coerce")
        if to_g is None:
            to_g = _unit_check(result, values[list(ACCEL)].to_numpy(float))
            if to_g is None:
                return result
        for c in numeric:
            col = values[c]
            present = col.dropna()
            s.counts[c] += int(present.size)
            if present.size:
                lo, hi = float(present.min()), float(present.max())
                mm = s.minmax.setdefault(c, [lo, hi])
                mm[0], mm[1] = min(mm[0], lo), max(mm[1], hi)
                s.violations[c] += _violations(c, present.to_numpy(float), to_g)
    _deep_report(result, s, fmt, window, to_g or 1.0)
    return result


def _violations(column: str, values: np.ndarray, to_g: float) -> int:
    if column in ACCEL:
        return int((np.abs(values * to_g) > THRESHOLDS["accel_component_limit_g"]).sum())
    if column == DEPTH:
        lo, hi = THRESHOLDS["depth_limits_m"]
        return int(((values < lo) | (values > hi)).sum())
    if column == TEMP:
        lo, hi = THRESHOLDS["temperature_limits_c"]
        return int(((values < lo) | (values > hi)).sum())
    return 0


def _relative(seconds_before: float, event: str) -> str:
    """'69 min before release', '2 min after recovery', 'at release' (within a minute)."""
    minutes = round(abs(seconds_before) / 60)
    if minutes == 0:
        return f"at {event}"
    # For the end, a positive value means the data runs past recovery.
    if event == "release":
        side = "before" if seconds_before > 0 else "after"
    else:
        side = "after" if seconds_before > 0 else "before"
    return f"{minutes} min {side} {event}"


def _iso(t: float | None) -> str | None:
    return None if t is None else pd.Timestamp(t, unit="s", tz="UTC").isoformat().replace("+00:00", "Z")


def _deep_report(
    result: Result, s: _Stream, fmt: str, window: tuple[float | None, float | None], to_g: float
) -> None:
    f = result.facts
    f["rows"] = s.rows
    f["time_format"] = fmt
    f["first_time"], f["last_time"] = _iso(s.first), _iso(s.last)
    f["duration_s"] = None if s.first is None or s.last is None else round(s.last - s.first, 3)
    f["median_dt_s"] = round(s.median_dt, 6) if s.median_dt else None
    base_rate = 1.0 / s.median_dt if s.median_dt else None
    f["rate_hz"] = round(base_rate, 4) if base_rate else None

    if fmt == "iso_naive":
        result.check("time zone", "warning", "timestamps carry no zone; read as UTC")
    else:
        result.check("time zone", "passed", "timestamps carry a zone")

    frac_bad = s.bad_times / s.rows if s.rows else 1.0
    status = (
        "passed"
        if s.bad_times == 0
        else ("failed" if frac_bad > THRESHOLDS["unparseable_failure_fraction"] else "warning")
    )
    result.check("timestamps", status, f"{s.bad_times} unparseable of {s.rows} rows")

    f["non_monotonic"], f["duplicates"], f["gaps"], f["max_gap_s"] = (
        s.non_monotonic,
        s.duplicates,
        s.gaps,
        round(s.max_gap_s, 3),
    )
    if s.non_monotonic:
        result.check("time order", "failed", f"{s.non_monotonic} backward steps")
    else:
        result.check("time order", "passed", "timestamps never go backward")
    dup_status = (
        "warning" if s.rows and s.duplicates / s.rows > THRESHOLDS["duplicate_warning_fraction"] else "passed"
    )
    result.check("duplicate timestamps", dup_status, f"{s.duplicates} repeated timestamps")
    gap_status = "warning" if s.gaps else "passed"
    gap_detail = f"{s.gaps} intervals over {THRESHOLDS['gap_factor']:g} x {s.median_dt or 0:.4g} s"
    if s.gaps:
        gap_detail += f" (longest {s.max_gap_s:.1f} s)"
    result.check("gaps", gap_status, gap_detail)

    channels: dict[str, Any] = {}
    for c, count in s.counts.items():
        fill = count / s.rows if s.rows else 0.0
        channels[c] = {
            "fill_fraction": round(fill, 5),
            "rate_hz": round(base_rate * fill, 4) if base_rate else None,
            "min": s.minmax.get(c, [None, None])[0],
            "max": s.minmax.get(c, [None, None])[1],
            "violations": s.violations[c],
        }
    f["channels"] = channels
    sparse = [
        f"{c} at {v['rate_hz']:g} Hz"
        for c, v in channels.items()
        if v["rate_hz"] and v["fill_fraction"] < 0.99
    ]
    result.check(
        "channel rates",
        "passed",
        "all channels at the base rate" if not sparse else "lower-rate channels: " + ", ".join(sparse),
    )

    total_viol = sum(s.violations.values())
    worst = max(((v / s.counts[c]) for c, v in s.violations.items() if s.counts[c]), default=0.0)
    viol_status = (
        "passed"
        if total_viol == 0
        else ("failed" if worst > THRESHOLDS["violation_failure_fraction"] else "warning")
    )
    detail = (
        "no values outside limits"
        if not total_viol
        else ", ".join(f"{c}: {v}" for c, v in s.violations.items() if v)
    )
    result.check("value limits", viol_status, detail)

    mag_fill = [channels[c]["fill_fraction"] for c in MAG if c in channels]
    f["magnetometer_present"] = bool(mag_fill) and max(mag_fill) > 0
    result.check(
        "magnetometer",
        "passed",
        "present" if f["magnetometer_present"] else "absent (heading needs a magnetometer)",
    )

    start, end = window
    if start is not None and end is not None and s.first is not None and s.last is not None:
        f["deployment_window"] = {
            "start": _iso(start),
            "end": _iso(end),
            "pre_release_s": round(start - s.first, 1),
            "post_recovery_s": round(s.last - end, 1),
        }
        tol = THRESHOLDS["window_tolerance_s"]
        covers = s.first <= start + tol and s.last >= end - tol
        result.check(
            "deployment window",
            "passed" if covers else "warning",
            f"data starts {_relative(start - s.first, 'release')}; ends {_relative(s.last - end, 'recovery')}",
        )
    else:
        result.check("deployment window", "warning", "release or recovery time missing from metadata")
