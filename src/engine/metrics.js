// Error measures between a simulated FP value and the exact (true) value.
//
// This module is the single source of truth for every error figure the UI
// shows, so that one step never gets two different numbers in two places:
//
//  * ulp. The ulp of an exact real number x is the gap between the two
//    representable numbers around x (R.above − R.below when x is rounded); for
//    a representable x it is the gap from x to the next number away from zero.
//    The SAME definition is applied to two different reference points:
//      - the rounding error of one step uses the ulp around the exact result of
//        that step on the stored operands (so a tie is exactly 0.5 ulp and
//        rounding to nearest is never more than 0.5 ulp),
//      - the total error versus the true value uses the ulp around the true
//        value.
//    The UI labels them "this step" and "versus the true value".
//
//  * Correct digits. −log10(relative error) as measured ("raw") can exceed the
//    p·log10 2 digits a p-bit number holds: a rounding can land much closer to
//    the true value than its worst case. Such a value is still only as good as
//    the format, so every view SHOWS, compares and draws the digits capped at
//    p·log10 2 ("shown"); the raw value is kept for tooltips. A result equal to
//    the true value is represented by Infinity (never capped); a result that
//    cannot be compared (∞ / NaN versus a finite true value) by null, which
//    counts as 0 correct digits when losses are computed.
//
//  * Thresholds that choose explanations, chips and colours are the named
//    constants below.

import { log10Abs, floorLog2, floorLog10, dyadic, dyadicDiff, scalePow2, frac, pow10 } from './rational.js';
import { fpToFraction } from './ieee.js';

/** log10(2): one bit is worth about 0.301 decimal digits. */
export const LOG10_2 = Math.log10(2);

// ---------------------------------------------------------------------------
// Thresholds (one place; each says why it has its value)
// ---------------------------------------------------------------------------

/** Badge green when the shown digits reach 85 % of what the format holds (in double ≥ 13.6 of 16.0 digits). */
export const QUALITY_GOOD = 0.85;
/** Badge amber from 40 % of the format's digits; below that red (most of the digits are wrong). */
export const QUALITY_MID = 0.4;
/**
 * A step "lost" (or "gained") digits only when the shown digits change by at
 * least one whole decimal digit; smaller changes are the ordinary scatter of
 * rounding. Used by the verdict sentence, the diagnosis and the sweep summary.
 */
export const NOTABLE_DIGITS = 1;
/**
 * A subtraction of nearly equal numbers is explained as cancellation when its
 * condition number κ = (|a|+|b|)/|a−b| predicts at least this many lost digits
 * (log10 κ ≥ 0.6, i.e. κ ≥ about 4: the leading digits visibly cancel).
 * Because κ ≥ 3 already means b/2 ≤ a ≤ 2b, such a subtraction of two stored
 * numbers is always exact (Sterbenz lemma): cancellation never rounds, it only
 * amplifies the error the operands already carry.
 */
export const CANCEL_MIN_LOG10_KAPPA = 0.6;
/**
 * Such a cancellation is called "catastrophic" (red) only from κ ≥ 100
 * (log10 κ ≥ 2): at least two leading decimal digits cancel, so two or more
 * correct digits can be lost. Between κ ≈ 4 and 100 the milder wording
 * "cancellation" is used: it costs at most about two digits, which is common
 * in long computations and not a disaster.
 */
export const CATASTROPHIC_LOG10_KAPPA = 2;
/**
 * A step that gained correct digits is explained by conditioning (a damping
 * function, a small inexact addend next to a large exact one) when the
 * first-order worst-case bound of the propagated error already predicts the
 * digits reached, within this margin; otherwise the gain needs errors of
 * opposite sign to cancel each other, i.e. luck.
 */
export const GAIN_EXPLAINED_MARGIN = 0.5;
/** Functions: the condition number is mentioned once it amplifies relative errors by at least half again (κ ≥ 1.5). */
export const COND_REPORT = 1.5;
/** Functions: with an inexact argument the function itself is named the cause once it amplifies the error tenfold (one digit). */
export const COND_CAUSE = 10;
/** Functions: with an inexact argument κ below 0.9 is pointed out as damping the inherited error. */
export const COND_DAMP = 0.9;
/**
 * Error budget: one part (inherited or new) dominates when it is at least 10×
 * (one decimal order) larger than the other. The same rule chooses the cause
 * chip of a rounded step whose operands were already wrong: 'prop'
 * (inherited) when the inherited part dominates, 'round' when the new rounding
 * dominates and 'propRound' (inherited + rounding) when they are comparable;
 * the error source tracing of the diagnosis follows the same rule.
 */
export const DOMINANCE_DIGITS = 1;
/** Charts draw "exact" this many digits above the highest capacity, so no inexact point can reach it. */
export const EXACT_LEVEL_GAP = 1;

// ---------------------------------------------------------------------------
// ulp
// ---------------------------------------------------------------------------

/**
 * The ulp around an exact rational r in a format: the gap between the two
 * representable numbers around r, R.above − R.below of roundFraction(r) (for a
 * representable r, the gap to the next number away from zero). Below the
 * normal range the gap is that of the subnormals; beyond the largest finite
 * number the gap of the top binade is used.
 */
function ulpExp(r, fmt) {
  if (fmt.family === 'decfloat') {
    let E = r.n === 0n ? fmt.emin : floorLog10(r);
    if (E < fmt.emin) E = fmt.emin;
    if (E > fmt.emax) E = fmt.emax;
    return E - fmt.p + 1;
  }
  let E = r.n === 0n ? (fmt.bounded ? fmt.emin : 0) : floorLog2(r);
  if (fmt.bounded && E < fmt.emin) E = fmt.emin;
  if (fmt.bounded && E > fmt.emax) E = fmt.emax;
  return E - fmt.p + 1;
}

export function ulpAround(r, fmt) {
  if (fmt.fixed) return fmt.step;
  const q = ulpExp(r, fmt);
  if (fmt.family === 'decfloat') return q >= 0 ? frac(pow10(q), 1n) : frac(1n, pow10(-q));
  return dyadic(1n, q);
}

/**
 * How many steps apart two representable numbers (fractions) are in the sorted
 * list of a format's numbers: 1 = neighbours. Supports binary FP, decimal64,
 * and fixed-point grids.
 */
export function stepsBetween(a, b, fmt) {
  if (fmt.fixed) {
    const d = a.sub(b).abs().div(fmt.step);
    return Number(d.n / d.d);
  }
  if (fmt.family === 'decfloat') {
    const tenP = pow10(fmt.p);
    const tenPm1 = pow10(fmt.p - 1);
    const decadeCount = 9n * tenPm1;
    const base = fmt.emin;
    const whole = (r) => r.n / r.d;
    const pow10Frac = (e) => (e >= 0 ? frac(pow10(e), 1n) : frac(1n, pow10(-e)));
    const ordinal = (x) => {
      if (x.n === 0n) return 0n;
      const m = x.abs();
      const E = Math.max(floorLog10(m), base);
      const q = E - fmt.p + 1;
      const ulp = pow10Frac(q);
      let o;
      if (E === base) o = whole(m.div(ulp));
      else o = tenP + BigInt(E - base - 1) * decadeCount + whole(m.sub(pow10Frac(E)).div(ulp));
      return x.s < 0n ? -o : o;
    };
    const d = ordinal(a) - ordinal(b);
    return Number(d < 0n ? -d : d);
  }
  let base;
  if (fmt.bounded) base = fmt.emin;
  else {
    if (a.n === 0n || b.n === 0n || a.s !== b.s) return a.equals(b) ? 0 : null;
    base = Math.min(floorLog2(a.abs()), floorLog2(b.abs()));
  }
  const half = 1n << BigInt(fmt.p - 1);
  const whole = (r) => r.n / r.d;
  const ordinal = (x) => {
    if (x.n === 0n) return 0n;
    const m = x.abs();
    const E = Math.max(floorLog2(m), base);
    const ulp = dyadic(1n, E - fmt.p + 1);
    let o;
    if (fmt.bounded && E === base) o = whole(m.div(ulp));
    else o = (fmt.bounded ? 2n * half + BigInt(E - base - 1) * half : BigInt(E - base) * half) + whole(m.sub(dyadic(1n, E)).div(ulp));
    return x.s < 0n ? -o : o;
  };
  const d = ordinal(a) - ordinal(b);
  return Number(d < 0n ? -d : d);
}

// ---------------------------------------------------------------------------
// Comparison with the true value
// ---------------------------------------------------------------------------

const isNum = (v) => v.kind === 'finite' || v.kind === 'zero';

/**
 * Compare an FP value with an exact value.
 * @returns {{status:string, abs?:Fraction, rel?:Fraction|null, ulps?:Fraction, digits?:number, log10Rel?:number}}
 *   status: 'exact' | 'approx' | 'both-nan' | 'both-inf' | 'mismatch'
 *           ('mismatch' = not comparable: ∞ / NaN versus a finite true value, or
 *           a true value beyond the reference's range, marked `beyond`)
 *   digits: RAW −log10(relative error), null when not comparable (as rawDigits);
 *           display it through correctDigits()
 *   refLimited: digits were limited to the verified digits of an irrational reference
 *   ulps:   total error in ulp around the TRUE value (see ulpAround)
 */
export function compareToExact(v, x, fmt) {
  // A true value beyond ±10^±MAX_DEC_EXP (exp(±10⁶)) is only a stand-in (∞ or 0)
  // for a finite, nonzero number (or, after ∞ − ∞ of such stand-ins, for an
  // unknown one): no error can be measured against it, so the result is never
  // called equal to it (nor "both ∞").
  if (x.beyond) {
    const beyond = x.kind === 'inf' ? 'huge' : x.kind === 'nan' ? 'unknown' : 'tiny';
    return { status: 'mismatch', beyond, digits: null, log10Rel: Infinity, ulpsApprox: Infinity };
  }
  if (v.kind === 'nan' && x.kind === 'nan') return { status: 'both-nan' };
  if (v.kind === 'inf' && x.kind === 'inf' && v.sign === x.sign) return { status: 'both-inf' };
  if (!isNum(v) || x.kind !== 'finite') {
    return { status: 'mismatch', digits: null, log10Rel: Infinity, ulpsApprox: Infinity };
  }
  const a = fpToFraction(v);
  const { err, rel } = dyadicDiff(a, x.r);
  const abs = err.abs();
  if (abs.n === 0n) return { status: 'exact', abs, rel: abs, ulps: abs, err, digits: Infinity, log10Rel: -Infinity };
  // Errors in ulps are meaningless when the true value is 0 (any nonzero result is "infinitely" wrong relatively).
  const ulps = x.r.n === 0n ? null
    : fmt.radix === 10 ? abs.div(ulpAround(x.r, fmt))
    : fmt.fixed ? scalePow2(abs, -fmt.scaleExp)
    : scalePow2(abs, -ulpExp(x.r, fmt));
  if (!ulps) {
    return { status: 'approx', err, abs, rel: null, ulps: null, ulpsApprox: Infinity, log10Rel: Infinity, digits: 0 };
  }
  const log10Rel = rel ? log10Abs(rel) : Infinity;
  let digits = Math.max(0, -log10Rel);
  // An irrational reference is only known to `reliable` digits: never claim more.
  // (refLimited is about the reference; digitsInfo().capped is about the format's capacity.)
  const refLimited = !!x.approx && digits > x.reliable;
  if (refLimited) digits = x.reliable;
  return {
    status: 'approx',
    err,
    abs,
    rel,
    ulps,
    ulpsApprox: Math.pow(10, log10Abs(ulps)),
    log10Rel,
    digits,
    refLimited,
  };
}

/**
 * The rounding error committed by one step: rounded − exact result of the
 * operation on the rounded operands, in ulp (or fixed step Δ) around that exact result.
 */
export function localError(res, fmt) {
  // A stand-in exact result beyond the reference's range has no measurable rounding error.
  if (!res.round || !isNum(res.value) || res.exactOp.kind !== 'finite' || res.exactOp.beyond) return null;
  const { err, rel } = dyadicDiff(fpToFraction(res.value), res.exactOp.r);
  const abs = err.abs();
  const ulp = ulpAround(res.exactOp.r, fmt);
  const ulps = fmt.radix === 10 ? abs.div(ulp) : scalePow2(abs, fmt.fixed ? -fmt.scaleExp : -ulpExp(res.exactOp.r, fmt));
  return {
    err,
    abs,
    ulp,
    ulps,
    rel,
  };
}

// ---------------------------------------------------------------------------
// Correct digits
// ---------------------------------------------------------------------------

/** Decimal digits the format holds (accepts a format descriptor or binary bit count p). */
export function fullDigits(fmtOrP) {
  if (typeof fmtOrP === 'number') return fmtOrP * LOG10_2;
  if (fmtOrP.family === 'decfloat') return fmtOrP.p;
  if (fmtOrP.fixed) {
    return fmtOrP.radix === 10 ? Math.log10(Number(fmtOrP.maxInt)) : (fmtOrP.totalBits - 1) * LOG10_2;
  }
  return fmtOrP.p * LOG10_2;
}

/**
 * Raw correct digits of a comparison: Infinity = equal to the true value (also
 * both ∞ or both NaN), 0 when the true value is 0 but the result is not,
 * null = not comparable (∞ / NaN versus a finite true value).
 */
export function rawDigits(cmp) {
  if (cmp.status === 'exact' || cmp.status === 'both-inf' || cmp.status === 'both-nan') return Infinity;
  if (cmp.status === 'approx') return cmp.rel ? cmp.digits : 0;
  return null;
}

/** Raw digits capped at the capacity `full`; Infinity (exact) and null (not comparable) are kept. */
export function capDigits(raw, full) {
  return raw == null || raw === Infinity ? raw : Math.min(raw, full);
}

/**
 * The displayed figure for raw digits in a format with capacity `full`.
 * @returns {{raw:number|null, shown:number|null, full:number, capped:boolean}}
 *   capped: the measured value was above the capacity (show `raw` in a tooltip)
 */
export function digitsInfo(raw, full) {
  return { raw, shown: capDigits(raw, full), full, capped: raw != null && raw !== Infinity && raw > full };
}

/** Correct digits of a comparison as every view shows them (see digitsInfo). */
export function correctDigits(cmp, fmt) {
  return digitsInfo(rawDigits(cmp), fullDigits(fmt));
}

/** Quality class of shown digits: q-exact, q-good, q-mid or q-bad (thresholds QUALITY_GOOD / QUALITY_MID). */
export function qualityOf(shown, full) {
  if (shown === Infinity) return 'q-exact';
  if (shown == null) return 'q-bad';
  const r = shown / full;
  if (r >= QUALITY_GOOD) return 'q-good';
  if (r >= QUALITY_MID) return 'q-mid';
  return 'q-bad';
}

/** Height at which charts draw "exact" for formats whose largest capacity is `maxFull`. */
export function exactLevel(maxFull) {
  return maxFull + EXACT_LEVEL_GAP;
}

/**
 * The one "digits lost" figure of a step, used by the verdict sentence, the
 * cancellation sentence and the diagnosis.
 *   from: fewest shown digits among the operands (Infinity when all operands
 *         are exact, and for inputs and literals, whose decimal value is exact)
 *   to:   shown digits of the result (Infinity when exact)
 *   lost: min(from, full) − min(to, full); negative = digits regained
 * Not comparable values count as 0 digits.
 * @param {(s:object)=>number|null} [shownOf] shown digits of a step (for caching)
 */
export function stepDigits(step, steps, fmt, shownOf) {
  const full = fullDigits(fmt);
  const get = shownOf || ((s) => correctDigits(compareToExact(s.fmt[fmt.id].value, s.exact, fmt), fmt).shown);
  const d = (s) => get(s) ?? 0;
  const to = d(step);
  const from = step.kind === 'op' ? Math.min(...step.operands.map((o) => d(steps[o]))) : Infinity;
  return { from, to, full, lost: Math.min(from, full) - Math.min(to, full) };
}
