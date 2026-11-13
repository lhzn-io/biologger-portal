/**
 * Cumulative roll: whether the animal turns right over (spins, the count climbing past whole revolutions) or
 * rocks within a band. Wide rocking and steady spinning cover the same wrapped angles; only the order of the
 * angles tells them apart, so the wrapped roll is unwrapped into a running total and full turns are counted.
 *
 * The exporter can do this at the tag's native rate (columns roll_unwrapped_deg and roll_quality); this module
 * uses those when the bundle has them. Otherwise it unwraps the bundle-rate roll itself, which can only follow
 * rotation slower than about half a turn per sample interval: at 1 Hz, spins faster than about 0.3 rev/s alias
 * and are miscounted. Steps it cannot resolve are flagged rather than guessed, and bridged (from either source):
 * across a doubtful stretch the total keeps only the shortest rotation between the good samples either side.
 *
 * Method and thresholds: the research note roll-visualization-research.md (section 4.2), after Segre et al.
 * 2016 (J Exp Biol 219:3315) for the pitch limit and rorqual roll classes.
 */
import type { Track } from "./track";

/** A wrapped step this large (degrees per sample) could have gone either way round. */
export const STEP_AMBIGUOUS_DEG = 135;
/** Beyond this pitch (degrees), roll from the accelerometer is ill-conditioned. */
export const PITCH_LIMIT_DEG = 65;
/** Hysteresis on revolution counting (degrees): a turn counts once the total is this far past 360. */
export const REVOLUTION_HYSTERESIS_DEG = 30;

export interface Revolution {
  /** Sample index at which the turn completed. */
  i: number;
  /** +1 for a turn in the positive roll sense (right side down), -1 for the other way. */
  sense: 1 | -1;
  /** The turn includes a doubtful step, or completed in fewer than two samples (more likely a missed wrap). */
  doubtful: boolean;
}

export interface RollAnalysis {
  /** "export": the exporter's native-rate unwrap; "viewer": unwrapped here from the bundle-rate roll. */
  source: "export" | "viewer";
  /** Cumulative roll (degrees) per sample, held through doubtful stretches and bridged across them. */
  cum: Float64Array;
  /** 1 where the sample's roll is doubtful: pitch past the limit, an ambiguous step into it, or a time gap. */
  doubt: Uint8Array;
  revolutions: Revolution[];
  doubtfulSteps: number;
  /** Rotation set aside by bridging (degrees): per doubtful stretch, the change across it minus the change kept. */
  bridgedDeg: number;
}

const wrap180 = (d: number) => d - 360 * Math.round(d / 360);

export function analyzeRoll(track: Track): RollAnalysis {
  const n = track.count;
  const cum = new Float64Array(n);
  const doubt = new Uint8Array(n);
  const gap = 3 / Math.max(1e-6, track.manifest.rate_hz); // seconds: more than two missing samples
  let source: RollAnalysis["source"] = "viewer";
  if (track.rollUnwrapped) {
    source = "export";
    for (let i = 0; i < n; i++) {
      cum[i] = track.rollUnwrapped[i]!;
      doubt[i] = track.rollQuality && track.rollQuality[i] ? 1 : 0;
    }
  } else {
    let last = 0;
    let lastRaw = NaN;
    for (let i = 0; i < n; i++) {
      const raw = track.roll[i]!;
      const pitchBad = Math.abs(track.pitch[i]!) > PITCH_LIMIT_DEG;
      if (!Number.isFinite(raw)) {
        cum[i] = last;
        doubt[i] = 1;
        continue;
      }
      if (Number.isNaN(lastRaw)) {
        last = raw;
        doubt[i] = pitchBad ? 1 : 0;
      } else {
        const d = wrap180(raw - lastRaw);
        const gapped = track.t[i]! - track.t[i - 1]! > gap;
        last += d;
        doubt[i] = Math.abs(d) > STEP_AMBIGUOUS_DEG || pitchBad || gapped ? 1 : 0;
      }
      cum[i] = last;
      lastRaw = raw;
    }
  }
  let doubtfulSteps = 0;
  for (let i = 0; i < n; i++) doubtfulSteps += doubt[i]!;

  // Bridge each doubtful stretch as a whole: the total holds through it, then joins the good samples on either
  // side by the shortest rotation between their angles, so whole turns registered inside a stretch the roll
  // cannot be trusted in are not counted. A genuine turn there is lost too, so the rotation set aside is
  // reported. Near vertical the roll itself is undefined and can come out of the stretch flipped by up to 180
  // degrees, so a bridged change can be wrong by up to half a turn; it cannot add a whole one. (Dropping only the
  // steps into doubtful samples drifts: when they fall on the peaks of rocking, the carried steps out add up to
  // whole turns. Choosing between a change and its 180-degree flip at steep pitch drifts too, by the flips.)
  const raw = cum.slice();
  let bridgedDeg = 0;
  for (let i = 1; i < n; ) {
    if (!doubt[i]) {
      cum[i] = cum[i - 1]! + raw[i]! - raw[i - 1]!;
      i++;
      continue;
    }
    const s = i;
    let e = s;
    while (e < n && doubt[e]) e++;
    for (let k = s; k < e; k++) cum[k] = cum[s - 1]!;
    if (e < n) {
      const change = raw[e]! - raw[s - 1]!;
      const d = wrap180(change);
      cum[e] = cum[s - 1]! + d;
      bridgedDeg += Math.abs(change - d);
    } else {
      bridgedDeg += Math.abs(raw[n - 1]! - raw[s - 1]!); // the record ends in the stretch
    }
    i = e + 1;
  }

  // Revolutions by the anchor method: a turn completes when the total moves 360 degrees (plus hysteresis for the
  // first) past the anchor, which then advances by 360.
  const revolutions: Revolution[] = [];
  let anchor = cum[0] ?? 0;
  let since = 0; // index after the previous mark
  let doubtSince = false;
  for (let i = 1; i < n; i++) {
    if (doubt[i]) doubtSince = true;
    const ahead = cum[i]! - anchor;
    const first = revolutions.length === 0 || revolutions[revolutions.length - 1]!.sense !== Math.sign(ahead);
    const need = 360 + (first ? REVOLUTION_HYSTERESIS_DEG : 0);
    if (Math.abs(ahead) >= need) {
      const sense = ahead > 0 ? 1 : -1;
      revolutions.push({ i, sense, doubtful: doubtSince || i - since < 2 });
      anchor += 360 * sense;
      since = i;
      doubtSince = false;
    }
  }
  return { source, cum, doubt, revolutions, doubtfulSteps, bridgedDeg };
}

/** Net turns between two sample indices (signed, in revolutions). */
export function netTurns(a: RollAnalysis, from: number, to: number): number {
  return (a.cum[to]! - a.cum[from]!) / 360;
}
