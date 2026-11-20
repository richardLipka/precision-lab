// Bit-exact simulation of IEEE 754 binary floating-point, IEEE 754 decimal64
// (BID and DPD encodings), and real-world fixed-point arithmetic (Q16.16 and
// DEC(18,4) / SQL MONEY with saturating or two's-complement wraparound overflow).
//
// Every operation computes the exact rational result first and then rounds it
// once, matching IEEE 754 ("as if computed with unbounded precision, then
// rounded") and widening-accumulator fixed-point ALUs.

import {
  Fraction, ZERO, ONE, bitLength, dyadic, dyadicSum, floorLog2, floorLog10, exact, toSciParts, formatSci, frac, pow10,
} from './rational.js';
import { EngineError } from './messages.js';

const TEN = 10n;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/**
 * Binary floating-point format descriptor (IEEE 754 binary interchange or custom).
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.name   human name
 * @param {string} o.short  column label
 * @param {number} o.p      precision in bits, including the leading (hidden or explicit) bit
 * @param {number|null} o.expBits exponent field width; null = unbounded exponent
 * @param {boolean} [o.explicitBit] significand stores the integer bit (x87 80-bit)
 */
export function makeFormat({ id, name, short, p, expBits, explicitBit = false, note = '' }) {
  if (!Number.isInteger(p) || p < 1) throw new EngineError('fmt.precision');
  const bounded = expBits != null;
  if (bounded && (!Number.isInteger(expBits) || expBits < 2 || expBits > 30)) {
    throw new EngineError('fmt.expBits');
  }
  const emax = bounded ? 2 ** (expBits - 1) - 1 : Infinity;
  const emin = bounded ? 1 - emax : -Infinity;
  const fracBits = explicitBit ? p : p - 1;
  return {
    id, name, short: short || name,
    family: 'binfloat', group: 'binfloat', radix: 2, fixed: false,
    p, expBits, explicitBit, bounded, emax, emin,
    bias: bounded ? emax : null,
    fracBits,
    totalBits: bounded ? 1 + expBits + fracBits : null,
    decimalDigits: Math.ceil(p * Math.log10(2)) + 1, // digits that always round-trip
    note,
  };
}

/**
 * IEEE 754 decimal floating-point format descriptor (decimal64 BID or DPD).
 * Value = (−1)^sign · c · 10^q with 0 ≤ c < 10^p and q ∈ [qmin, qmax].
 */
export function makeDecimalFormat({ id, name, short, p = 16, emin = -383, emax = 384, bias = 398, totalBits = 64, encoding = 'bid', note = '' }) {
  const qmin = emin - (p - 1);
  const qmax = emax - (p - 1);
  return {
    id, name, short: short || name,
    family: 'decfloat', group: 'decfloat', radix: 10, fixed: false, encoding,
    p, expBits: 10, explicitBit: false, bounded: true,
    emin, emax, bias, qmin, qmax,
    maxCoef: pow10(p) - 1n,
    totalBits,
    decimalDigits: p,
    note,
  };
}

/**
 * Signed two's-complement fixed-point format descriptor (binary Qm.n or scaled decimal).
 * Value = I · radix^scaleExp with I ∈ [−2^(totalBits−1), 2^(totalBits−1) − 1].
 */
export function makeFixedFormat({
  id, name, short, radix, totalBits, intBits = null, fracBits = 0, scaleDigits = 0, overflowMode = 'sat', note = '',
}) {
  const halfMod = 1n << BigInt(totalBits - 1);
  const modulus = halfMod << 1n;
  const minInt = -halfMod;
  const maxInt = halfMod - 1n;
  const scaleExp = radix === 2 ? -fracBits : -scaleDigits;
  const step = radix === 2 ? dyadic(1n, scaleExp) : frac(1n, pow10(scaleDigits));
  return {
    id, name, short: short || name,
    family: radix === 2 ? 'binfix' : 'decfix',
    group: 'fixed', radix, fixed: true,
    p: radix === 2 ? totalBits - 1 : maxInt.toString().length,
    intBits, fracBits, scaleDigits, scaleExp, step,
    minInt, maxInt, modulus, halfMod,
    overflowMode,
    expBits: null, explicitBit: false, bounded: true,
    emin: scaleExp, emax: radix === 2 ? (intBits ?? totalBits - 1) - 1 : maxInt.toString().length - 1 + scaleExp,
    bias: null,
    totalBits,
    decimalDigits: radix === 2 ? Math.ceil(totalBits * Math.log10(2)) + 2 : maxInt.toString().length,
    note,
  };
}

/** Return a fixed-point format with the requested overflow policy ('sat' | 'wrap'); unchanged for FP formats. */
export function withOverflowMode(fmt, overflowMode = 'sat') {
  if (!fmt.fixed) return fmt;
  const ovf = overflowMode === 'wrap' ? 'wrap' : 'sat';
  return fmt.overflowMode === ovf ? fmt : { ...fmt, overflowMode: ovf };
}

export const FORMATS = [
  makeFormat({ id: 'binary16', name: 'binary16 (half)', short: 'half', p: 11, expBits: 5 }),
  makeFormat({ id: 'bfloat16', name: 'bfloat16', short: 'bfloat16', p: 8, expBits: 8 }),
  makeFormat({ id: 'binary32', name: 'binary32 (float)', short: 'float', p: 24, expBits: 8 }),
  makeFormat({ id: 'binary64', name: 'binary64 (double)', short: 'double', p: 53, expBits: 11 }),
  makeFormat({
    id: 'x87', name: 'x87 extended (80-bit)', short: 'extended', p: 64, expBits: 15, explicitBit: true,
    note: 'Intel 80-bit format: explicit integer bit, precision control set to 64 bits',
  }),
  makeFormat({ id: 'binary128', name: 'binary128 (quad)', short: 'quad', p: 113, expBits: 15 }),
  makeDecimalFormat({
    id: 'decimal64_bid', name: 'decimal64 (BID)', short: 'dec64 BID', encoding: 'bid',
    note: 'IEEE 754 decimal64 with Binary Integer Decimal significand (Intel libbid, GCC/Clang x86-64 _Decimal64)',
  }),
  makeDecimalFormat({
    id: 'decimal64_dpd', name: 'decimal64 (DPD)', short: 'dec64 DPD', encoding: 'dpd',
    note: 'IEEE 754 decimal64 with Densely Packed Decimal declets (IBM POWER / z/Architecture hardware)',
  }),
  makeFixedFormat({
    id: 'q16_16', name: 'Q16.16 (binary fixed)', short: 'Q16.16', radix: 2, totalBits: 32, intBits: 15, fracBits: 16,
    note: '32-bit signed two’s-complement binary fixed-point s15.16 (FreeType, OpenGL ES GLfixed, ARM/DSP)',
  }),
  makeFixedFormat({
    id: 'dec18_4', name: 'DEC(18,4) (SQL MONEY)', short: 'DEC(18,4)', radix: 10, totalBits: 64, scaleDigits: 4,
    note: '64-bit signed two’s-complement decimal fixed-point scaled by 10⁻⁴ (SQL Server MONEY / accounting)',
  }),
];

/**
 * Cast functions of the language: half(x), float(x), double(x), decimal64(x),
 * q16_16(x), dec18_4(x) … store x into that format (the id of a FORMATS entry).
 */
export const CASTS = {
  half: 'binary16',
  bfloat16: 'bfloat16',
  float: 'binary32',
  double: 'binary64',
  extended: 'x87',
  quad: 'binary128',
  decimal64: 'decimal64_bid',
  q16_16: 'q16_16',
  dec18_4: 'dec18_4',
};

export const ROUNDING_MODES = [
  { id: 'RNE', name: 'to nearest, ties to even (default)' },
  { id: 'RNA', name: 'to nearest, ties away from zero' },
  { id: 'RZ', name: 'toward zero (truncate)' },
  { id: 'RU', name: 'toward +∞ (ceiling)' },
  { id: 'RD', name: 'toward −∞ (floor)' },
];

// ---------------------------------------------------------------------------
// Values: {kind:'zero'|'finite'|'inf'|'nan', sign:0|1, m:BigInt, q:Number, radix?:2|10, trap?:boolean}
//   binfloat: (−1)^sign · m · 2^q with m < 2^p
//   decfloat: (−1)^sign · m · 10^q with 0 ≤ m < 10^p, q ∈ [qmin, qmax] (cohorts preserved!)
//   binfix:   (−1)^sign · m · 2^scaleExp  (no −0, no ∞, trap on invalid/div0)
//   decfix:   (−1)^sign · m · 10^scaleExp (no −0, no ∞, trap on invalid/div0)
// ---------------------------------------------------------------------------

export const fp = {
  zero: (sign = 0, q = 0, radix = 2) => (radix === 10 ? { kind: 'zero', sign, m: 0n, q, radix: 10 } : { kind: 'zero', sign, m: 0n, q }),
  inf: (sign = 0) => ({ kind: 'inf', sign, m: 0n, q: 0 }),
  nan: () => ({ kind: 'nan', sign: 0, m: 0n, q: 0 }),
  trap: () => ({ kind: 'nan', sign: 0, m: 0n, q: 0, trap: true }),
  finite: (sign, m, q, radix = 2) => (radix === 10 ? { kind: 'finite', sign, m, q, radix: 10 } : { kind: 'finite', sign, m, q }),
};

export function maxFinite(fmt, sign = 0) {
  if (fmt.family === 'decfloat') return fp.finite(sign, fmt.maxCoef, fmt.qmax, 10);
  if (fmt.fixed) {
    const I = sign ? fmt.minInt : fmt.maxInt;
    return fp.finite(I < 0n ? 1 : 0, I < 0n ? -I : I, fmt.scaleExp, fmt.radix);
  }
  return fp.finite(sign, (1n << BigInt(fmt.p)) - 1n, fmt.emax - fmt.p + 1);
}

export function minFinite(fmt) {
  return maxFinite(fmt, 1);
}

/**
 * Leading exponent E of a finite value in its own radix:
 *   binary:  2^E ≤ |v| < 2^(E+1)
 *   decimal: 10^E ≤ |v| < 10^(E+1)
 */
export function exponentOf(v) {
  if (v.radix === 10) return v.m.toString().length - 1 + v.q;
  return bitLength(v.m) - 1 + v.q;
}

export function isSubnormal(v, fmt) {
  if (fmt.fixed) return false;
  return v.kind === 'finite' && fmt.bounded && exponentOf(v) < fmt.emin;
}

/** Signed integer significand (0 for zero). */
function signedM(v) {
  return v.kind === 'zero' ? 0n : v.sign ? -v.m : v.m;
}

/** Exact rational value of a zero or finite value (any radix). */
export function fpToFraction(v) {
  if (v.kind === 'zero') return ZERO;
  if (v.radix === 10) {
    const s = v.sign ? -v.m : v.m;
    return v.q >= 0 ? frac(s * pow10(v.q), 1n) : frac(s, pow10(-v.q));
  }
  return dyadic(v.m, v.q, v.sign);
}

/** Exact value (ExactVal) of a stored value. */
export function fpToExact(v) {
  if (v.kind === 'nan') return exact.nan(v.trap ? 'fixed-point error / undefined' : 'NaN');
  if (v.kind === 'inf') return exact.inf(v.sign);
  return exact.finite(fpToFraction(v), v.kind === 'zero' && v.sign === 1);
}

/**
 * Value equality (including sign of zero). For decimal floating-point, two
 * cohorts of the same real number (e.g. 1.0 and 1.00) are considered equal.
 */
export function fpEquals(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'nan') return true;
  if (a.sign !== b.sign) return false;
  if (a.kind === 'inf' || a.kind === 'zero') return true;
  if ((a.radix || 2) === (b.radix || 2) && a.m === b.m && a.q === b.q) return true;
  return fpToFraction(a).equals(fpToFraction(b));
}

/** Unit in the last place (or fixed step Δ) at the magnitude of v. */
export function ulpOf(v, fmt) {
  if (fmt.fixed) return fmt.step;
  if (fmt.family === 'decfloat') {
    let E = v.kind === 'finite' ? exponentOf(v) : fmt.emin;
    if (E < fmt.emin) E = fmt.emin;
    const q = E - fmt.p + 1;
    return q >= 0 ? frac(pow10(q), 1n) : frac(1n, pow10(-q));
  }
  let E = v.kind === 'finite' ? exponentOf(v) : fmt.bounded ? fmt.emin : 0;
  if (fmt.bounded && E < fmt.emin) E = fmt.emin;
  return dyadic(1n, E - fmt.p + 1);
}

/** ulp (or fixed step Δ) at an exact rational, using the format's spacing. */
export function ulpAtFraction(r, fmt) {
  if (fmt.fixed) return fmt.step;
  if (r.n === 0n) return ulpOf(fp.zero(0, 0, fmt.radix), fmt);
  if (fmt.family === 'decfloat') {
    let E = floorLog10(r);
    if (E < fmt.emin) E = fmt.emin;
    const q = E - fmt.p + 1;
    return q >= 0 ? frac(pow10(q), 1n) : frac(1n, pow10(-q));
  }
  let E = floorLog2(r);
  if (fmt.bounded && E < fmt.emin) E = fmt.emin;
  return dyadic(1n, E - fmt.p + 1);
}

// ---------------------------------------------------------------------------
// Rounding — Binary FP, Decimal FP (IEEE 754 decimal64), and Fixed-Point
// ---------------------------------------------------------------------------

function shouldRoundUp(mode, sign, M, twice, den) {
  switch (mode) {
    case 'RNE': return twice > den || (twice === den && (M & 1n) === 1n);
    case 'RNA': return twice >= den;
    case 'RZ': return false;
    case 'RU': return sign === 0;
    case 'RD': return sign === 1;
    default: throw new Error('unknown rounding mode ' + mode);
  }
}

function normalizeAbs(m, q, sign, fmt) {
  if (m === 0n) return fp.zero(sign);
  if (m === 1n << BigInt(fmt.p)) return fp.finite(sign, m >> 1n, q + 1);
  return fp.finite(sign, m, q);
}

function exceedsMax(m, q, fmt) {
  return fmt.bounded && m !== 0n && bitLength(m) - 1 + q > fmt.emax;
}

/** Clamp a decimal64 quantum into [qmin, qmax] without changing value when possible. */
function clampDecimalCohort(m, q, fmt, preferredQ) {
  if (m === 0n) {
    const pq = preferredQ == null ? 0 : Math.max(fmt.qmin, Math.min(fmt.qmax, preferredQ));
    return { m: 0n, q: pq };
  }
  const lim = pow10(fmt.p);
  // First strip trailing zeros if q < preferredQ (or if no preferredQ, produce canonical minimal trailing zeros)
  const targetQ = preferredQ == null ? fmt.qmax : Math.max(fmt.qmin, Math.min(fmt.qmax, preferredQ));
  while (q < targetQ && m % TEN === 0n) {
    m /= TEN;
    q += 1;
  }
  // If q > targetQ (including q > qmax clamping!), shift left by adding trailing zeros while m fits in p digits
  while (q > targetQ && m * TEN < lim) {
    m *= TEN;
    q -= 1;
  }
  return { m, q };
}

function roundDecimalFraction(r, fmt, mode = 'RNE', zeroSign = 0, preferredQ = null) {
  if (r.n === 0n) {
    const pq = preferredQ == null ? 0 : Math.max(fmt.qmin, Math.min(fmt.qmax, preferredQ));
    const z = fp.zero(zeroSign, pq, 10);
    return { value: z, inexact: false, overflow: false, underflow: false, direction: 'exact', below: z, above: z, guard: 0, sticky: false, tiny: false };
  }
  const sign = r.s < 0n ? 1 : 0;
  const n = r.n;
  const d = r.d;
  const e = floorLog10(r);
  const tiny = e < fmt.emin;
  const eEff = tiny ? fmt.emin : e;
  const qe = eEff - (fmt.p - 1);
  let num = n;
  let den = d;
  if (qe >= 0) den = d * pow10(qe);
  else num = n * pow10(-qe);
  const M = num / den;
  const rem = num - M * den;
  const inexact = rem !== 0n;
  const twice = 2n * rem;
  const tenRem = TEN * rem;
  const guard = Number(tenRem / den); // first discarded decimal digit (0..9)
  const sticky = (tenRem % den) !== 0n; // nonzero decimal digits after guard digit
  const up = inexact ? shouldRoundUp(mode, sign, M, twice, den) : false;
  let Mr = up ? M + 1n : M;
  let qOut = qe;
  const tenP = pow10(fmt.p);
  if (Mr === tenP) {
    Mr = pow10(fmt.p - 1);
    qOut += 1;
  }
  let value;
  let overflow = false;
  let toInf = false;
  const maxQ = fmt.qmax;
  if (Mr !== 0n && (Mr.toString().length - 1 + qOut > fmt.emax)) {
    overflow = true;
    toInf = mode === 'RNE' || mode === 'RNA' || (mode === 'RU' && sign === 0) || (mode === 'RD' && sign === 1);
    value = toInf ? fp.inf(sign) : maxFinite(fmt, sign);
  } else if (Mr === 0n) {
    value = fp.zero(sign, Math.max(fmt.qmin, Math.min(maxQ, qOut)), 10);
  } else {
    const aligned = inexact
      ? clampDecimalCohort(Mr, qOut, fmt, qOut)
      : clampDecimalCohort(Mr, qOut, fmt, preferredQ);
    value = fp.finite(sign, aligned.m, aligned.q, 10);
  }
  const decNorm = (c, q) => {
    if (c === 0n) return fp.zero(sign, fmt.qmin, 10);
    if (c === tenP) { c = pow10(fmt.p - 1); q += 1; }
    if (c.toString().length - 1 + q > fmt.emax) return fp.inf(sign);
    return fp.finite(sign, c, q, 10);
  };
  const lowAbs = M !== 0n && M.toString().length - 1 + qe > fmt.emax ? maxFinite(fmt, sign) : decNorm(M, qe);
  const highAbs = overflow ? fp.inf(sign) : inexact ? decNorm(M + 1n, qe) : lowAbs;
  const below = sign ? highAbs : lowAbs;
  const above = sign ? lowAbs : highAbs;
  const underflow = tiny && inexact;
  const direction = overflow
    ? (toInf !== (sign === 1) ? 'up' : 'down')
    : !inexact ? 'exact' : (up !== (sign === 1) ? 'up' : 'down');
  return { value, inexact: inexact || overflow, overflow, underflow, direction, below, above, guard, sticky, tiny };
}

function fixedValFromInt(I, fmt) {
  if (I === 0n) return fp.zero(0, fmt.scaleExp, fmt.radix);
  return fp.finite(I < 0n ? 1 : 0, I < 0n ? -I : I, fmt.scaleExp, fmt.radix);
}

function roundFixedFraction(r, fmt, mode = 'RNE') {
  if (r.n === 0n) {
    const z = fp.zero(0, fmt.scaleExp, fmt.radix);
    return { value: z, inexact: false, overflow: false, underflow: false, overflowKind: null, direction: 'exact', below: z, above: z, guard: 0, sticky: false, tiny: false };
  }
  const sign = r.s < 0n ? 1 : 0;
  const scale = -fmt.scaleExp; // fracBits (radix 2) or scaleDigits (radix 10)
  const num = fmt.radix === 2 ? (r.n << BigInt(scale)) : (r.n * pow10(scale));
  const den = r.d;
  const M = num / den;
  const rem = num - M * den;
  const inexact = rem !== 0n;
  const twice = 2n * rem;
  let guard;
  let sticky;
  if (fmt.radix === 10) {
    const tenRem = TEN * rem;
    guard = Number(tenRem / den);
    sticky = (tenRem % den) !== 0n;
  } else {
    guard = twice >= den ? 1 : 0;
    sticky = twice !== 0n && twice !== den;
  }
  const up = inexact ? shouldRoundUp(mode, sign, M, twice, den) : false;
  const mag = up ? M + 1n : M;
  const rawI = sign ? -mag : mag;
  let finalI = rawI;
  let overflow = false;
  let overflowKind = null;
  if (rawI > fmt.maxInt || rawI < fmt.minInt) {
    overflow = true;
    if ((fmt.overflowMode || 'sat') === 'wrap') {
      overflowKind = 'wrap';
      let w = ((rawI % fmt.modulus) + fmt.modulus) % fmt.modulus;
      if (w >= fmt.halfMod) w -= fmt.modulus;
      finalI = w;
    } else {
      overflowKind = 'sat';
      finalI = rawI > fmt.maxInt ? fmt.maxInt : fmt.minInt;
    }
  }
  const value = fixedValFromInt(finalI, fmt);
  const tiny = !overflow && finalI === 0n && r.n !== 0n;
  const underflow = tiny && inexact;
  // Neighbours around r on the fixed grid (clamped to format range when in range)
  const loI = sign ? -(inexact ? M + 1n : M) : M;
  const hiI = sign ? -M : (inexact ? M + 1n : M);
  const clampI = (x) => (x > fmt.maxInt ? fmt.maxInt : x < fmt.minInt ? fmt.minInt : x);
  const below = fixedValFromInt(clampI(loI), fmt);
  const above = fixedValFromInt(clampI(hiI), fmt);
  let direction = 'exact';
  if (overflow || inexact) {
    const cmp = fpToFraction(value).compare(r);
    direction = cmp === 0 ? 'exact' : cmp > 0 ? 'up' : 'down';
  }
  return {
    value,
    inexact: inexact || overflow,
    overflow,
    underflow,
    overflowKind,
    direction,
    below,
    above,
    guard,
    sticky,
    tiny,
    rawInt: rawI,
  };
}

/**
 * Round an exact nonzero-or-zero rational to the format.
 * @param {Fraction} r
 * @param {object} fmt
 * @param {string} mode rounding mode id
 * @param {0|1} [zeroSign] sign to give an exact zero result
 * @param {number|null} [preferredQ] preferred quantum for IEEE 754 decimal64
 */
export function roundFraction(r, fmt, mode = 'RNE', zeroSign = 0, preferredQ = null) {
  if (fmt.family === 'decfloat') return roundDecimalFraction(r, fmt, mode, zeroSign, preferredQ);
  if (fmt.fixed) return roundFixedFraction(r, fmt, mode);
  if (r.n === 0n) {
    const z = fp.zero(zeroSign);
    return { value: z, inexact: false, overflow: false, underflow: false, direction: 'exact', below: z, above: z, guard: 0, sticky: false, tiny: false };
  }
  const sign = r.s < 0n ? 1 : 0;
  const n = r.n;
  const d = r.d;
  const e = floorLog2(r);
  const tiny = fmt.bounded && e < fmt.emin;
  const eEff = tiny ? fmt.emin : e;
  const qe = eEff - (fmt.p - 1);
  let num = n;
  let den = d;
  if (qe >= 0) den = d << BigInt(qe);
  else num = n << BigInt(-qe);
  const M = num / den;
  const rem = num - M * den;
  const inexact = rem !== 0n;
  const twice = 2n * rem;
  const guard = twice >= den ? 1 : 0;
  const sticky = twice !== 0n && twice !== den;
  const up = inexact ? shouldRoundUp(mode, sign, M, twice, den) : false;
  const Mr = up ? M + 1n : M;
  let value;
  let overflow = false;
  let toInf = false;
  if (exceedsMax(Mr, qe, fmt)) {
    overflow = true;
    toInf = mode === 'RNE' || mode === 'RNA' || (mode === 'RU' && sign === 0) || (mode === 'RD' && sign === 1);
    value = toInf ? fp.inf(sign) : maxFinite(fmt, sign);
  } else {
    value = normalizeAbs(Mr, qe, sign, fmt);
  }
  const lowAbs = exceedsMax(M, qe, fmt) ? maxFinite(fmt, sign) : normalizeAbs(M, qe, sign, fmt);
  const highAbs = overflow || (inexact && exceedsMax(M + 1n, qe, fmt))
    ? fp.inf(sign)
    : inexact ? normalizeAbs(M + 1n, qe, sign, fmt) : lowAbs;
  const below = sign ? highAbs : lowAbs;
  const above = sign ? lowAbs : highAbs;
  const underflow = tiny && inexact;
  const direction = overflow
    ? (toInf !== (sign === 1) ? 'up' : 'down')
    : !inexact ? 'exact' : (up !== (sign === 1) ? 'up' : 'down');
  return { value, inexact: inexact || overflow, overflow, underflow, direction, below, above, guard, sticky, tiny };
}

/** Convert an exact value to the format. */
export function fromExact(x, fmt, mode = 'RNE') {
  if (fmt.fixed) {
    if (x.kind === 'nan' || x.kind === 'inf') {
      return { value: fp.trap(), inexact: false, invalid: true, direction: 'exact', overflow: false, underflow: false };
    }
    return roundFixedFraction(x.r, fmt, mode);
  }
  if (x.kind === 'nan') return { value: fp.nan(), inexact: false, invalid: false, direction: 'exact' };
  if (x.kind === 'inf') return { value: fp.inf(x.sign), inexact: false, direction: 'exact' };
  const prefQ = fmt.family === 'decfloat' && x.decScale != null ? x.decScale : null;
  return roundFraction(x.r, fmt, mode, x.negZero ? 1 : 0, prefQ);
}

// ---------------------------------------------------------------------------
// Arithmetic (all operations are correctly rounded)
// Each returns { value, exactOp, round, flags } where exactOp is the exact
// (infinitely precise) result of the operation on the given stored operands.
// ---------------------------------------------------------------------------

export function flagsFrom(round, extra = {}) {
  return {
    inexact: !!round?.inexact,
    overflow: !!round?.overflow,
    underflow: !!round?.underflow,
    divByZero: !!extra.divByZero,
    invalid: !!extra.invalid,
  };
}

/** Result of an operation decided without rounding (NaN, ∞, trap, exact zero …). */
export function special(value, exactOp, extra = {}) {
  return { value, exactOp, round: null, flags: flagsFrom(null, extra) };
}

function roundedResult(r, fmt, mode, zeroSign, preferredQ = null) {
  const round = roundFraction(r, fmt, mode, zeroSign, preferredQ);
  return { value: round.value, exactOp: exact.finite(r, !fmt.fixed && r.n === 0n && zeroSign === 1), round, flags: flagsFrom(round) };
}

export function fpAdd(a, b, fmt, mode = 'RNE') {
  if (fmt.fixed && (a.kind === 'nan' || b.kind === 'nan')) return special(fp.trap(), exact.nan('error operand'));
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  if (a.kind === 'inf' && b.kind === 'inf') {
    if (a.sign !== b.sign) return special(fp.nan(), exact.nan('∞ − ∞'), { invalid: true });
    return special(a, exact.inf(a.sign));
  }
  if (a.kind === 'inf') return special(a, exact.inf(a.sign));
  if (b.kind === 'inf') return special(b, exact.inf(b.sign));
  const r = fmt.radix === 10
    ? fpToFraction(a).add(fpToFraction(b))
    : dyadicSum(signedM(a), a.q, signedM(b), b.q);
  let zeroSign = !fmt.fixed && mode === 'RD' ? 1 : 0;
  if (!fmt.fixed && a.kind === 'zero' && b.kind === 'zero' && a.sign === b.sign) zeroSign = a.sign;
  const prefQ = fmt.family === 'decfloat' ? Math.min(a.q, b.q) : null;
  return roundedResult(r, fmt, mode, zeroSign, prefQ);
}

export function fpNeg(a, fmt = null, mode = 'RNE') {
  if (a.kind === 'nan') return a;
  if (fmt?.fixed) {
    if (a.kind === 'zero') return fp.zero(0, fmt.scaleExp, fmt.radix);
    const r = fpToFraction(a).neg();
    return roundFixedFraction(r, fmt, mode).value;
  }
  return { ...a, sign: a.sign ^ 1 };
}

export function fpAbs(a, fmt = null, mode = 'RNE') {
  if (a.kind === 'nan') return a;
  if (fmt?.fixed) {
    if (a.kind === 'zero') return fp.zero(0, fmt.scaleExp, fmt.radix);
    const r = fpToFraction(a).abs();
    return roundFixedFraction(r, fmt, mode).value;
  }
  return { ...a, sign: 0 };
}

export function fpSub(a, b, fmt, mode = 'RNE') {
  if (fmt.fixed) {
    if (a.kind === 'nan' || b.kind === 'nan') return special(fp.trap(), exact.nan('error operand'));
    const r = fpToFraction(a).sub(fpToFraction(b));
    return roundedResult(r, fmt, mode, 0);
  }
  return fpAdd(a, fpNeg(b), fmt, mode);
}

export function fpMul(a, b, fmt, mode = 'RNE') {
  if (fmt.fixed && (a.kind === 'nan' || b.kind === 'nan')) return special(fp.trap(), exact.nan('error operand'));
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const sign = fmt.fixed ? 0 : (a.sign ^ b.sign);
  if (a.kind === 'inf' || b.kind === 'inf') {
    if (a.kind === 'zero' || b.kind === 'zero') return special(fp.nan(), exact.nan('0 · ∞'), { invalid: true });
    return special(fp.inf(sign), exact.inf(sign));
  }
  const r = fmt.radix === 10
    ? fpToFraction(a).mul(fpToFraction(b))
    : dyadic(signedM(a) * signedM(b), a.q + b.q);
  const prefQ = fmt.family === 'decfloat' ? a.q + b.q : null;
  return roundedResult(r, fmt, mode, sign, prefQ);
}

export function fpDiv(a, b, fmt, mode = 'RNE') {
  if (fmt.fixed) {
    if (a.kind === 'nan' || b.kind === 'nan') return special(fp.trap(), exact.nan('error operand'));
    if (b.kind === 'zero') {
      if (a.kind === 'zero') return special(fp.trap(), exact.nan('0 / 0'), { invalid: true });
      return special(fp.trap(), exact.nan('division by zero'), { divByZero: true });
    }
    return roundedResult(fpToFraction(a).div(fpToFraction(b)), fmt, mode, 0);
  }
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const sign = a.sign ^ b.sign;
  if (a.kind === 'inf' && b.kind === 'inf') return special(fp.nan(), exact.nan('∞ / ∞'), { invalid: true });
  if (a.kind === 'inf') return special(fp.inf(sign), exact.inf(sign));
  if (b.kind === 'inf') return special(fp.zero(sign, fmt.family === 'decfloat' ? fmt.qmin : 0, fmt.radix), exact.finite(ZERO));
  if (b.kind === 'zero') {
    if (a.kind === 'zero') return special(fp.nan(), exact.nan('0 / 0'), { invalid: true });
    return special(fp.inf(sign), exact.nan('division by zero'), { divByZero: true });
  }
  const prefQ = fmt.family === 'decfloat' ? a.q - b.q : null;
  return roundedResult(fpToFraction(a).div(fpToFraction(b)), fmt, mode, sign, prefQ);
}

/** Fused multiply-add a·b + c with a single rounding (or DSP MAC in fixed-point). */
export function fpFma(a, b, c, fmt, mode = 'RNE') {
  if (fmt.fixed) {
    if (a.kind === 'nan' || b.kind === 'nan' || c.kind === 'nan') return special(fp.trap(), exact.nan('error operand'));
    const r = fpToFraction(a).mul(fpToFraction(b)).add(fpToFraction(c));
    return roundedResult(r, fmt, mode, 0);
  }
  if (a.kind === 'nan' || b.kind === 'nan' || c.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const psign = a.sign ^ b.sign;
  if (a.kind === 'inf' || b.kind === 'inf') {
    if (a.kind === 'zero' || b.kind === 'zero') return special(fp.nan(), exact.nan('0 · ∞'), { invalid: true });
    if (c.kind === 'inf' && c.sign !== psign) return special(fp.nan(), exact.nan('∞ − ∞'), { invalid: true });
    return special(fp.inf(psign), exact.inf(psign));
  }
  if (c.kind === 'inf') return special(c, exact.inf(c.sign));
  let r;
  let prodZero;
  if (fmt.radix === 10) {
    const prod = fpToFraction(a).mul(fpToFraction(b));
    prodZero = prod.n === 0n;
    r = prod.add(fpToFraction(c));
  } else {
    const pm = signedM(a) * signedM(b);
    prodZero = pm === 0n;
    r = dyadicSum(pm, a.q + b.q, signedM(c), c.q);
  }
  let zeroSign = mode === 'RD' ? 1 : 0;
  if (prodZero && c.kind === 'zero' && psign === c.sign) zeroSign = psign;
  const prefQ = fmt.family === 'decfloat' ? Math.min(a.q + b.q, c.q) : null;
  return roundedResult(r, fmt, mode, zeroSign, prefQ);
}

/** Order of two stored values: −1, 0, 1, or null when unordered (NaN/trap). */
export function fpOrder(a, b) {
  if (a.kind === 'nan' || b.kind === 'nan') return null;
  const rank = (v) => (v.kind === 'inf' ? (v.sign ? -1 : 1) : 0);
  if (rank(a) !== rank(b) || rank(a) !== 0) return Math.sign(rank(a) - rank(b));
  return fpToFraction(a).compare(fpToFraction(b));
}

export function orderSatisfies(op, c) {
  if (c == null) return op === '!=';
  switch (op) {
    case '==': return c === 0;
    case '!=': return c !== 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
    default: throw new Error('unknown comparison ' + op);
  }
}

export function fpCompare(op, a, b, fmt) {
  const value = orderSatisfies(op, fpOrder(a, b)) ? roundFraction(ONE, fmt).value : fp.zero(0, fmt.fixed ? fmt.scaleExp : 0, fmt.radix);
  return special(value, fpToExact(value));
}

export function fpCast(a, target, fmt, mode = 'RNE') {
  const tgt = target.fixed ? withOverflowMode(target, fmt.overflowMode || target.overflowMode || 'sat') : target;
  if (a.kind === 'nan' || a.kind === 'inf') {
    if (tgt.fixed || fmt.fixed) {
      return { ...special(fp.trap(), fpToExact(a), { invalid: true }), cast: { target: tgt.id, mid: fp.trap(), r1: null, r2: null } };
    }
    return { ...special(a, fpToExact(a)), cast: { target: tgt.id, mid: a, r1: null, r2: null } };
  }
  const x = fpToFraction(a);
  const r1 = roundFraction(x, tgt, mode, a.sign);
  const mid = r1.value;
  let r2 = null;
  let value = mid;
  if (mid.kind === 'inf') {
    if (fmt.fixed) {
      value = fp.trap();
      return { ...special(value, fpToExact(a), { overflow: true, invalid: true }), cast: { target: tgt.id, mid, r1, r2: null } };
    }
  } else if (mid.kind !== 'nan') {
    r2 = roundFraction(fpToFraction(mid), fmt, mode, mid.sign);
    value = r2.value;
  }
  const moved = value.kind === 'inf' ? 1 : value.kind === 'nan' ? 0 : fpToFraction(value).compare(x);
  const round = {
    ...r1,
    value,
    inexact: r1.inexact || !!r2?.inexact,
    overflow: r1.overflow || !!r2?.overflow,
    underflow: r1.underflow || !!r2?.underflow,
    overflowKind: r1.overflowKind || r2?.overflowKind || null,
    tiny: r1.tiny || !!r2?.tiny,
    direction: moved === 0 ? 'exact' : (value.kind === 'inf' ? value.sign === 0 : moved > 0) ? 'up' : 'down',
  };
  return { value, exactOp: fpToExact(a), round, flags: flagsFrom(round), cast: { target: tgt.id, mid, r1, r2 } };
}

export function fpOp(op, args, fmt, mode) {
  switch (op) {
    case '+': return fpAdd(args[0], args[1], fmt, mode);
    case '-': return fpSub(args[0], args[1], fmt, mode);
    case '*': return fpMul(args[0], args[1], fmt, mode);
    case '/': return fpDiv(args[0], args[1], fmt, mode);
    case 'fma': return fpFma(args[0], args[1], args[2], fmt, mode);
    case 'neg': {
      const a = args[0];
      if (fmt.fixed && a.kind === 'finite' && a.sign === 1 && a.m === fmt.halfMod) {
        // Two's-complement −(minFinite) overflows!
        return roundedResult(fpToFraction(a).neg(), fmt, mode, 0);
      }
      if (fmt.fixed && a.kind === 'nan') return special(fp.trap(), exact.nan('error operand'));
      const v = fpNeg(a, fmt, mode);
      return special(v, fpToExact(v));
    }
    case 'abs': {
      const a = args[0];
      if (fmt.fixed && a.kind === 'finite' && a.sign === 1 && a.m === fmt.halfMod) {
        return roundedResult(fpToFraction(a).abs(), fmt, mode, 0);
      }
      if (fmt.fixed && a.kind === 'nan') return special(fp.trap(), exact.nan('error operand'));
      const v = fpAbs(a, fmt, mode);
      return special(v, fpToExact(v));
    }
    case '==': case '!=': case '<': case '<=': case '>': case '>=': return fpCompare(op, args[0], args[1], fmt);
    default:
      if (CASTS[op]) return fpCast(args[0], FORMATS.find((f) => f.id === CASTS[op]), fmt, mode);
      throw new Error('unknown operation ' + op);
  }
}

// ---------------------------------------------------------------------------
// IEEE 754 Densely Packed Decimal (DPD) 10-bit declet codec
// ---------------------------------------------------------------------------

/** Encode 3 decimal digits (0..9 each) into a 10-bit DPD declet string (Cowlishaw / IEEE 754 §3.5.2). */
export function encodeDpdDeclet(d1, d2, d3) {
  const a = (d1 >> 3) & 1; const b = (d1 >> 2) & 1; const c = (d1 >> 1) & 1; const d = d1 & 1;
  const e = (d2 >> 3) & 1; const f = (d2 >> 2) & 1; const g = (d2 >> 1) & 1; const h = d2 & 1;
  const i = (d3 >> 3) & 1; const j = (d3 >> 2) & 1; const k = (d3 >> 1) & 1; const m = d3 & 1;
  let arr;
  const sel = (a << 2) | (e << 1) | i;
  switch (sel) {
    case 0: arr = [b, c, d, f, g, h, 0, j, k, m]; break; // 000
    case 1: arr = [b, c, d, f, g, h, 1, 0, 0, m]; break; // 001
    case 2: arr = [b, c, d, j, k, h, 1, 0, 1, m]; break; // 010
    case 4: arr = [j, k, d, f, g, h, 1, 1, 0, m]; break; // 100
    case 6: arr = [j, k, d, 0, 0, h, 1, 1, 1, m]; break; // 110
    case 5: arr = [f, g, d, 0, 1, h, 1, 1, 1, m]; break; // 101
    case 3: arr = [b, c, d, 1, 0, h, 1, 1, 1, m]; break; // 011
    default: arr = [0, 0, d, 1, 1, h, 1, 1, 1, m]; break; // 111
  }
  return arr.join('');
}

/** Decode a 10-bit DPD declet string back into 3 decimal digits [d1, d2, d3]. */
export function decodeDpdDeclet(s) {
  const [p, q, r, st0, t, u, v, w, x, y] = [...s].map((ch) => (ch === '1' ? 1 : 0));
  if (v === 0) return [(p << 2) | (q << 1) | r, (st0 << 2) | (t << 1) | u, (w << 2) | (x << 1) | y];
  if (w === 0 && x === 0) return [(p << 2) | (q << 1) | r, (st0 << 2) | (t << 1) | u, 8 | y];
  if (w === 0 && x === 1) return [(p << 2) | (q << 1) | r, 8 | u, (st0 << 2) | (t << 1) | y];
  if (w === 1 && x === 0) return [8 | r, (st0 << 2) | (t << 1) | u, (p << 2) | (q << 1) | y];
  const st = (st0 << 1) | t;
  if (st === 0) return [8 | r, 8 | u, (p << 2) | (q << 1) | y];
  if (st === 1) return [8 | r, (p << 2) | (q << 1) | u, 8 | y];
  if (st === 2) return [(p << 2) | (q << 1) | r, 8 | u, 8 | y];
  return [8 | r, 8 | u, 8 | y];
}

/** Decode a 64-bit IEEE 754 decimal64 bit string (BID or DPD) back to a value object (for testing/verification). */
export function decodeDecimal64(bits64, encoding = 'bid') {
  const sign = bits64[0] === '1' ? 1 : 0;
  const g5 = bits64.slice(1, 6);
  if (g5 === '11110') return fp.inf(sign);
  if (g5 === '11111') return fp.nan();
  const bias = 398;
  if (encoding === 'bid') {
    const g = bits64.slice(1, 14);
    const t = bits64.slice(14);
    let E;
    let c;
    if (g.startsWith('11')) {
      E = parseInt(g.slice(2, 12), 2);
      c = (4n << 51n) | (BigInt(g[12] === '1' ? 1 : 0) << 50n) | BigInt('0b' + t);
    } else {
      E = parseInt(g.slice(0, 10), 2);
      c = (BigInt(parseInt(g.slice(10, 13), 2)) << 50n) | BigInt('0b' + t);
    }
    if (c > 9999999999999999n) c = 0n; // IEEE 754 non-canonical BID decodes to 0
    const q = E - bias;
    return c === 0n ? fp.zero(sign, q, 10) : fp.finite(sign, c, q, 10);
  }
  const comb5 = bits64.slice(1, 6);
  const eCont = bits64.slice(6, 14);
  const t = bits64.slice(14);
  let eTop;
  let d0;
  if (comb5.startsWith('11')) {
    eTop = parseInt(comb5.slice(2, 4), 2);
    d0 = 8 | (comb5[4] === '1' ? 1 : 0);
  } else {
    eTop = parseInt(comb5.slice(0, 2), 2);
    d0 = parseInt(comb5.slice(2, 5), 2);
  }
  const E = (eTop << 8) | parseInt(eCont, 2);
  let digits = String(d0);
  for (let i = 0; i < 5; i++) digits += decodeDpdDeclet(t.slice(i * 10, i * 10 + 10)).join('');
  const c = BigInt(digits);
  const q = E - bias;
  return c === 0n ? fp.zero(sign, q, 10) : fp.finite(sign, c, q, 10);
}

// ---------------------------------------------------------------------------
// Encoding and display
// ---------------------------------------------------------------------------

function bits(x, width) {
  return width <= 0 ? '' : x.toString(2).padStart(width, '0');
}

function encodeDecimal64(v, fmt) {
  const sign = String(v.sign);
  const enc = fmt.encoding || 'bid';
  if (v.kind === 'inf' || v.kind === 'nan') {
    const cls = v.kind === 'inf' ? 'infinity' : 'NaN';
    const comb5 = v.kind === 'inf' ? '11110' : '11111';
    const eCont = '00000000';
    const cont = '0'.repeat(50);
    const all = sign + comb5 + eCont + cont;
    const hex = '0x' + BigInt('0b' + all).toString(16).toUpperCase().padStart(16, '0');
    if (enc === 'bid') {
      return { sign, comb: comb5 + eCont, expBits: null, sigHi: null, cont, bidLarge: false, decCoef: null, decExp: null, biasedExp: null, hex, cls, bitsStr: all, encoding: 'bid' };
    }
    return { sign, comb5, eCont, declets: ['0000000000', '0000000000', '0000000000', '0000000000', '0000000000'], decletDigits: null, leadDigit: null, decCoef: null, decExp: null, biasedExp: null, hex, cls, bitsStr: all, encoding: 'dpd' };
  }
  const q = v.q;
  const E = q + fmt.bias;
  const c = v.kind === 'zero' ? 0n : v.m;
  const cls = v.kind === 'zero' ? 'zero' : isSubnormal(v, fmt) ? 'subnormal' : 'normal';
  if (enc === 'bid') {
    const bidLarge = c >= (1n << 53n);
    const expBits = bits(BigInt(E), 10);
    const sigHi = bidLarge ? bits((c >> 50n) & 1n, 1) : bits(c >> 50n, 3);
    const comb = (bidLarge ? '11' : '') + expBits + sigHi;
    const cont = bits(c & ((1n << 50n) - 1n), 50);
    const all = sign + comb + cont;
    const hex = '0x' + BigInt('0b' + all).toString(16).toUpperCase().padStart(16, '0');
    return { sign, comb, expBits, sigHi, cont, bidLarge, decCoef: c.toString(), decExp: q, biasedExp: E, hex, cls, bitsStr: all, encoding: 'bid' };
  }
  const dStr = c.toString().padStart(16, '0');
  const d0 = Number(dStr[0]);
  const eTop = bits(BigInt(E >> 8), 2);
  const eCont = bits(BigInt(E & 0xFF), 8);
  const comb5 = d0 < 8 ? eTop + bits(BigInt(d0), 3) : '11' + eTop + String(d0 & 1);
  const declets = [];
  const decletDigits = [];
  for (let i = 0; i < 5; i++) {
    const g = dStr.slice(1 + i * 3, 4 + i * 3);
    decletDigits.push(g);
    declets.push(encodeDpdDeclet(Number(g[0]), Number(g[1]), Number(g[2])));
  }
  const cont = declets.join('');
  const all = sign + comb5 + eCont + cont;
  const hex = '0x' + BigInt('0b' + all).toString(16).toUpperCase().padStart(16, '0');
  return { sign, comb5, eCont, declets, decletDigits, leadDigit: d0, decCoef: c.toString(), decExp: q, biasedExp: E, hex, cls, bitsStr: all, encoding: 'dpd' };
}

function encodeFixed(v, fmt) {
  if (v.kind === 'nan') {
    return { fixed: true, radix: fmt.radix, cls: 'trap', hex: '—', bitsStr: '', rawInt: null };
  }
  const I = v.kind === 'zero' ? 0n : (v.sign ? -v.m : v.m);
  const U = I < 0n ? I + fmt.modulus : I;
  const all = U.toString(2).padStart(fmt.totalBits, '0');
  const hex = '0x' + U.toString(16).toUpperCase().padStart(fmt.totalBits / 4, '0');
  const cls = v.kind === 'zero' ? 'zero' : 'fixed';
  if (fmt.radix === 2) {
    return {
      fixed: true, radix: 2,
      sign: all[0],
      intPart: all.slice(1, 1 + fmt.intBits),
      fracPart: all.slice(1 + fmt.intBits),
      rawInt: I.toString(), hex, cls, bitsStr: all,
    };
  }
  const absStr = (I < 0n ? -I : I).toString().padStart(fmt.scaleDigits + 1, '0');
  return {
    fixed: true, radix: 10,
    sign: all[0],
    intBits: all.slice(1),
    decSign: I < 0n ? '−' : '+',
    decInt: absStr.slice(0, -fmt.scaleDigits),
    decFrac: absStr.slice(-fmt.scaleDigits),
    rawInt: I.toString(), hex, cls, bitsStr: all,
  };
}

/**
 * Bit fields of a stored value. Supports IEEE binary FP, IEEE decimal64 (BID & DPD),
 * and two's-complement fixed-point (Q16.16 & DEC(18,4)).
 */
export function encode(v, fmt) {
  if (fmt.family === 'decfloat') return encodeDecimal64(v, fmt);
  if (fmt.fixed) return encodeFixed(v, fmt);
  const sign = String(v.sign);
  if (!fmt.bounded) {
    if (v.kind !== 'finite') return { sign, exponent: null, fraction: null, kind: v.kind, unbounded: true };
    const E = exponentOf(v);
    return { sign, exponentValue: E, significand: v.m.toString(2).padEnd(fmt.p, '0'), unbounded: true, kind: v.kind };
  }
  const ones = (1n << BigInt(fmt.expBits)) - 1n;
  let expField = 0n;
  let fracField = 0n;
  let intBit = null;
  let cls;
  if (v.kind === 'zero') {
    cls = 'zero';
    intBit = 0;
  } else if (v.kind === 'inf') {
    cls = 'infinity';
    expField = ones;
    intBit = 1;
  } else if (v.kind === 'nan') {
    cls = 'NaN';
    expField = ones;
    intBit = 1;
    fracField = fmt.p >= 2 ? 1n << BigInt(fmt.p - 2) : 0n; // quiet NaN
  } else {
    const E = exponentOf(v);
    const shift = v.q - (Math.max(E, fmt.emin) - fmt.p + 1);
    const m = shift >= 0 ? v.m << BigInt(shift) : v.m >> BigInt(-shift);
    if (E < fmt.emin) {
      cls = 'subnormal';
      expField = 0n;
      intBit = 0;
      fracField = m;
    } else {
      cls = 'normal';
      expField = BigInt(E + fmt.bias);
      intBit = 1;
      fracField = m - (1n << BigInt(fmt.p - 1));
    }
  }
  let fracStr = bits(fracField, fmt.p - 1);
  if (fmt.explicitBit) fracStr = String(intBit) + fracStr;
  const expStr = bits(expField, fmt.expBits);
  const all = sign + expStr + fracStr;
  const hex = '0x' + BigInt('0b' + all).toString(16).toUpperCase().padStart(Math.ceil(all.length / 4), '0');
  return { sign, exponent: expStr, fraction: fracStr, explicitBit: fmt.explicitBit, hex, cls, bitsStr: all };
}

/** Classify a value: zero / subnormal / normal / infinity / NaN / fixed / trap. */
export function classify(v, fmt) {
  if (fmt.fixed) return v.kind === 'nan' ? 'trap' : v.kind === 'zero' ? 'zero' : 'fixed';
  if (v.kind === 'zero') return 'zero';
  if (v.kind === 'inf') return 'infinity';
  if (v.kind === 'nan') return 'NaN';
  return isSubnormal(v, fmt) ? 'subnormal' : 'normal';
}

/**
 * Radix-native scientific / scaled notation of a stored finite value:
 *   binfloat:  1.100110… × 2^−4
 *   decfloat:  3 × 10^−1  (exact stored cohort c × 10^q)
 *   binfix:    000000000000000.0001100110011010₂ (= 6554 × 2^−16)
 *   decfix:    3000 × 10^−4 (= 0.3000)
 */
export function binarySci(v, fmt) {
  if (v.kind !== 'finite') return fpShort(v, fmt);
  if (fmt.family === 'decfloat') {
    return `${v.sign ? '−' : ''}${v.m.toString()} × 10^${v.q}`;
  }
  if (fmt.fixed) {
    if (fmt.radix === 10) {
      const I = v.sign ? -v.m : v.m;
      return `${I < 0n ? '−' : ''}${v.m.toString()} × 10^${fmt.scaleExp}`;
    }
    const s = v.m.toString(2).padStart(fmt.fracBits + 1, '0');
    const ip = s.slice(0, -fmt.fracBits);
    const fpStr = s.slice(-fmt.fracBits);
    return `${v.sign ? '−' : ''}${ip}.${fpStr}₂ (${v.sign ? '−' : ''}${v.m.toString()} × 2^${fmt.scaleExp})`;
  }
  const E = exponentOf(v);
  const Edisp = fmt.bounded && E < fmt.emin ? fmt.emin : E;
  const shift = v.q - (Edisp - fmt.p + 1);
  const m = shift >= 0 ? v.m << BigInt(shift) : v.m >> BigInt(-shift);
  const s = m.toString(2).padStart(fmt.p, '0');
  const lead = s[0];
  const rest = s.slice(1);
  return `${v.sign ? '−' : ''}${lead}.${rest} × 2^${Edisp}`;
}

/**
 * Shortest decimal string that converts back to the same stored value.
 * For base-10 formats (decimal64, DEC(18,4)) this is directly the exact stored
 * decimal number; for fixed-point trap states it returns 'ERR'.
 */
export function shortestDecimal(v, fmt) {
  if (v.kind === 'nan') return fmt.fixed ? 'ERR' : 'NaN';
  if (v.kind === 'inf') return v.sign ? '−∞' : '+∞';
  if (v.kind === 'zero') return v.sign ? '−0' : '0';
  if (fmt.family === 'decfloat') {
    const s = v.m.toString();
    const exp = s.length - 1 + v.q;
    return formatSci({ negative: v.sign === 1, digits: s, exp }, { plainMin: -5, plainMax: 15, trimZeros: true });
  }
  if (fmt.fixed && fmt.radix === 10) {
    const absStr = v.m.toString().padStart(fmt.scaleDigits + 1, '0');
    const ip = absStr.slice(0, -fmt.scaleDigits);
    const fpStr = absStr.slice(-fmt.scaleDigits).replace(/0+$/, '');
    return `${v.sign ? '−' : ''}${fpStr ? `${ip}.${fpStr}` : ip}`;
  }
  const r = fpToFraction(v);
  const maxDigits = fmt.decimalDigits;
  if (!fmt.fixed && fmt.p > 160) return formatSci(toSciParts(r, maxDigits));
  for (let k = 1; k <= maxDigits; k++) {
    const parts = toSciParts(r, k);
    const mag = BigInt(parts.digits);
    const testMag = (m, exp) => {
      const s = parts.negative ? -m : m;
      const sh = exp - (k - 1);
      const back = sh >= 0 ? frac(s * pow10(sh), 1n) : frac(s, pow10(-sh));
      const rb = roundFraction(back, fmt, 'RNE');
      return !rb.overflow && fpEquals(rb.value, v);
    };
    if (testMag(mag, parts.exp)) return formatSci(parts);
    const hiMag = mag + 1n;
    const tenK = pow10(k);
    if (hiMag < tenK && testMag(hiMag, parts.exp)) {
      return formatSci({ negative: parts.negative, digits: hiMag.toString(), exp: parts.exp });
    }
    if (hiMag === tenK && testMag(pow10(k - 1), parts.exp + 1)) {
      return formatSci({ negative: parts.negative, digits: pow10(k - 1).toString(), exp: parts.exp + 1 });
    }
    const loMag = mag - 1n;
    if (loMag >= (k > 1 ? pow10(k - 1) : 1n) && testMag(loMag, parts.exp)) {
      return formatSci({ negative: parts.negative, digits: loMag.toString(), exp: parts.exp });
    }
  }
  return formatSci(toSciParts(r, maxDigits));
}

export function fpShort(v, fmt) {
  return shortestDecimal(v, fmt);
}

export function exactShort(x, digits = 17) {
  if (x.kind === 'nan') return 'undefined';
  if (x.kind === 'inf') return x.sign ? '−∞' : '+∞';
  if (x.r.n === 0n) return x.negZero ? '−0' : '0';
  return formatSci(toSciParts(x.r, digits));
}

/** Range and resolution facts for the "About format" panel. */
export function formatFacts(fmt) {
  if (fmt.family === 'decfloat') {
    const eps = frac(1n, pow10(fmt.p - 1));
    const u = frac(5n, pow10(fmt.p)); // worst-case relative rounding error = 0.5 · 10^(1−p)
    return {
      precision: fmt.p,
      epsilon: eps,
      unitRoundoff: u,
      decimalDigits: fmt.p,
      emin: fmt.emin,
      emax: fmt.emax,
      qmin: fmt.qmin,
      qmax: fmt.qmax,
      max: fpToFraction(maxFinite(fmt)),
      minNormal: frac(1n, pow10(-fmt.emin)),
      minSubnormal: frac(1n, pow10(-fmt.qmin)),
    };
  }
  if (fmt.fixed) {
    return {
      precision: fmt.p,
      step: fmt.step,
      halfStep: fmt.step.div(2),
      min: fpToFraction(minFinite(fmt)),
      max: fpToFraction(maxFinite(fmt)),
      decimalDigits: fmt.radix === 10 ? fmt.p : (fmt.totalBits - 1) * Math.log10(2),
    };
  }
  const eps = dyadic(1n, 1 - fmt.p);
  const out = {
    precision: fmt.p,
    epsilon: eps,
    unitRoundoff: dyadic(1n, -fmt.p),
    decimalDigits: fmt.p * Math.log10(2),
  };
  if (fmt.bounded) {
    out.emin = fmt.emin;
    out.emax = fmt.emax;
    out.max = fpToFraction(maxFinite(fmt));
    out.minNormal = dyadic(1n, fmt.emin);
    out.minSubnormal = dyadic(1n, fmt.emin - fmt.p + 1);
  }
  return out;
}
