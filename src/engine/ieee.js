// Bit-exact simulation of IEEE 754 binary floating-point arithmetic for any
// precision p and exponent width. Every operation computes the exact rational
// result first and then rounds it once, which is exactly what IEEE 754 requires
// of +, −, ×, ÷ and fma ("as if computed with unbounded precision, then rounded").

import {
  Fraction, ZERO, bitLength, dyadic, dyadicSum, floorLog2, exact, toSciParts, formatSci, frac, pow10,
} from './rational.js';
import { EngineError } from './messages.js';

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/**
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
    id, name, short: short || name, p, expBits, explicitBit, bounded, emax, emin,
    bias: bounded ? emax : null,
    fracBits,
    totalBits: bounded ? 1 + expBits + fracBits : null,
    decimalDigits: Math.ceil(p * Math.log10(2)) + 1, // digits that always round-trip
    note,
  };
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
];

/**
 * Cast functions of the language: half(x), float(x), double(x) … store x into
 * that format (the id of a FORMATS entry). See fpCast.
 */
export const CASTS = {
  half: 'binary16',
  bfloat16: 'bfloat16',
  float: 'binary32',
  double: 'binary64',
  extended: 'x87',
  quad: 'binary128',
};

export const ROUNDING_MODES = [
  { id: 'RNE', name: 'to nearest, ties to even (default)' },
  { id: 'RNA', name: 'to nearest, ties away from zero' },
  { id: 'RZ', name: 'toward zero (truncate)' },
  { id: 'RU', name: 'toward +∞ (ceiling)' },
  { id: 'RD', name: 'toward −∞ (floor)' },
];

// ---------------------------------------------------------------------------
// Values: {kind:'zero'|'finite'|'inf'|'nan', sign:0|1, m:BigInt, q:Number}
// A finite value equals (−1)^sign · m · 2^q with m < 2^p. Normal numbers have
// m ≥ 2^(p−1); subnormals have q = emin − p + 1 and m < 2^(p−1).
// ---------------------------------------------------------------------------

export const fp = {
  zero: (sign = 0) => ({ kind: 'zero', sign, m: 0n, q: 0 }),
  inf: (sign = 0) => ({ kind: 'inf', sign, m: 0n, q: 0 }),
  nan: () => ({ kind: 'nan', sign: 0, m: 0n, q: 0 }),
  finite: (sign, m, q) => ({ kind: 'finite', sign, m, q }),
};

export function maxFinite(fmt, sign = 0) {
  return fp.finite(sign, (1n << BigInt(fmt.p)) - 1n, fmt.emax - fmt.p + 1);
}

/** Exponent E of a finite value: 2^E ≤ |v| < 2^(E+1). */
export function exponentOf(v) {
  return bitLength(v.m) - 1 + v.q;
}

export function isSubnormal(v, fmt) {
  return v.kind === 'finite' && fmt.bounded && exponentOf(v) < fmt.emin;
}

/** Signed integer significand (0 for zero). */
function signedM(v) {
  return v.kind === 'zero' ? 0n : v.sign ? -v.m : v.m;
}

/** Exact rational value of a zero or finite FP value. */
export function fpToFraction(v) {
  if (v.kind === 'zero') return ZERO;
  return dyadic(v.m, v.q, v.sign);
}

/** Exact value (ExactVal) of an FP value. */
export function fpToExact(v) {
  if (v.kind === 'nan') return exact.nan('NaN');
  if (v.kind === 'inf') return exact.inf(v.sign);
  return exact.finite(fpToFraction(v), v.kind === 'zero' && v.sign === 1);
}

export function fpEquals(a, b) {
  return a.kind === b.kind && (a.kind === 'nan' || (a.sign === b.sign && a.m === b.m && a.q === b.q));
}

/** Unit in the last place at the binade of v (spacing of the format there). */
export function ulpOf(v, fmt) {
  let E = v.kind === 'finite' ? exponentOf(v) : fmt.bounded ? fmt.emin : 0;
  if (fmt.bounded && E < fmt.emin) E = fmt.emin;
  return dyadic(1n, E - fmt.p + 1);
}

/** ulp at the binade of an exact (nonzero) rational, using the format's spacing. */
export function ulpAtFraction(r, fmt) {
  if (r.n === 0n) return ulpOf(fp.zero(), fmt);
  let E = floorLog2(r);
  if (fmt.bounded && E < fmt.emin) E = fmt.emin;
  return dyadic(1n, E - fmt.p + 1);
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

function normalizeAbs(m, q, sign, fmt) {
  if (m === 0n) return fp.zero(sign);
  if (m === 1n << BigInt(fmt.p)) return fp.finite(sign, m >> 1n, q + 1);
  return fp.finite(sign, m, q);
}

function exceedsMax(m, q, fmt) {
  return fmt.bounded && m !== 0n && bitLength(m) - 1 + q > fmt.emax;
}

/**
 * Round an exact nonzero-or-zero rational to the format.
 * @param {Fraction} r
 * @param {object} fmt
 * @param {string} mode rounding mode id
 * @param {0|1} [zeroSign] sign to give an exact zero result
 * @returns {{value, inexact:boolean, overflow:boolean, underflow:boolean, direction:'exact'|'up'|'down',
 *            below, above, guard:number, sticky:boolean, tiny:boolean}}
 */
export function roundFraction(r, fmt, mode = 'RNE', zeroSign = 0) {
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
  // Of the discarded part, two bits decide every rounding mode: the first
  // discarded bit ("guard" here) and the OR of all later bits ("sticky");
  // ties to even also look at the last kept bit, the directed modes at the sign.
  // Hardware texts describe three bits (guard, round, sticky) because an adder
  // keeps only p + 3 bits and a difference may still need a one-place left shift;
  // after normalisation the bit beyond p is this guard bit and the decision is
  // the same. We round the exact value, so no shift is ever pending.
  const guard = twice >= den ? 1 : 0; // first discarded bit
  const sticky = twice !== 0n && twice !== den; // nonzero bits after the guard bit
  let up = false;
  if (inexact) {
    switch (mode) {
      case 'RNE': up = twice > den || (twice === den && (M & 1n) === 1n); break;
      case 'RNA': up = twice >= den; break;
      case 'RZ': up = false; break;
      case 'RU': up = sign === 0; break;
      case 'RD': up = sign === 1; break;
      default: throw new Error('unknown rounding mode ' + mode);
    }
  }
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
  // Neighbouring representable numbers (by magnitude), then ordered by value.
  const lowAbs = exceedsMax(M, qe, fmt) ? maxFinite(fmt, sign) : normalizeAbs(M, qe, sign, fmt);
  const highAbs = overflow || (inexact && exceedsMax(M + 1n, qe, fmt))
    ? fp.inf(sign)
    : inexact ? normalizeAbs(M + 1n, qe, sign, fmt) : lowAbs;
  const below = sign ? highAbs : lowAbs;
  const above = sign ? lowAbs : highAbs;
  // Underflow: tiny before rounding and inexact (IEEE 754 allows either
  // "before" or "after rounding" tininess detection; we use "before").
  const underflow = tiny && inexact;
  const direction = overflow
    ? (toInf !== (sign === 1) ? 'up' : 'down')
    : !inexact ? 'exact' : (up !== (sign === 1) ? 'up' : 'down');
  return { value, inexact: inexact || overflow, overflow, underflow, direction, below, above, guard, sticky, tiny };
}

/** Convert an exact value to the format. */
export function fromExact(x, fmt, mode = 'RNE') {
  if (x.kind === 'nan') return { value: fp.nan(), inexact: false, invalid: false, direction: 'exact' };
  if (x.kind === 'inf') return { value: fp.inf(x.sign), inexact: false, direction: 'exact' };
  return roundFraction(x.r, fmt, mode, x.negZero ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Arithmetic (all operations are correctly rounded)
// Each returns { value, exactOp, round, flags } where exactOp is the exact
// (infinitely precise) result of the operation on the given FP operands.
// ---------------------------------------------------------------------------

/**
 * IEEE status flags of one operation: inexact, overflow and underflow come from
 * the rounding (null for a special result), divByZero and invalid from `extra`.
 * Shared with fpfunc.js so that every operation reports flags the same way.
 */
export function flagsFrom(round, extra = {}) {
  return {
    inexact: !!round?.inexact,
    overflow: !!round?.overflow,
    underflow: !!round?.underflow,
    divByZero: !!extra.divByZero,
    invalid: !!extra.invalid,
  };
}

/** Result of an operation decided without rounding (NaN, ∞, an exact zero …). */
export function special(value, exactOp, extra = {}) {
  return { value, exactOp, round: null, flags: flagsFrom(null, extra) };
}

function roundedResult(r, fmt, mode, zeroSign) {
  const round = roundFraction(r, fmt, mode, zeroSign);
  return { value: round.value, exactOp: exact.finite(r, r.n === 0n && zeroSign === 1), round, flags: flagsFrom(round) };
}

export function fpAdd(a, b, fmt, mode = 'RNE') {
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  if (a.kind === 'inf' && b.kind === 'inf') {
    if (a.sign !== b.sign) return special(fp.nan(), exact.nan('∞ − ∞'), { invalid: true });
    return special(a, exact.inf(a.sign));
  }
  if (a.kind === 'inf') return special(a, exact.inf(a.sign));
  if (b.kind === 'inf') return special(b, exact.inf(b.sign));
  const r = dyadicSum(signedM(a), a.q, signedM(b), b.q);
  let zeroSign = mode === 'RD' ? 1 : 0;
  if (a.kind === 'zero' && b.kind === 'zero' && a.sign === b.sign) zeroSign = a.sign;
  return roundedResult(r, fmt, mode, zeroSign);
}

export function fpNeg(a) {
  if (a.kind === 'nan') return a;
  return { ...a, sign: a.sign ^ 1 };
}

export function fpAbs(a) {
  if (a.kind === 'nan') return a;
  return { ...a, sign: 0 };
}

export function fpSub(a, b, fmt, mode = 'RNE') {
  return fpAdd(a, fpNeg(b), fmt, mode);
}

export function fpMul(a, b, fmt, mode = 'RNE') {
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const sign = a.sign ^ b.sign;
  if (a.kind === 'inf' || b.kind === 'inf') {
    if (a.kind === 'zero' || b.kind === 'zero') return special(fp.nan(), exact.nan('0 · ∞'), { invalid: true });
    return special(fp.inf(sign), exact.inf(sign));
  }
  return roundedResult(dyadic(signedM(a) * signedM(b), a.q + b.q), fmt, mode, sign);
}

export function fpDiv(a, b, fmt, mode = 'RNE') {
  if (a.kind === 'nan' || b.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const sign = a.sign ^ b.sign;
  if (a.kind === 'inf' && b.kind === 'inf') return special(fp.nan(), exact.nan('∞ / ∞'), { invalid: true });
  if (a.kind === 'inf') return special(fp.inf(sign), exact.inf(sign));
  if (b.kind === 'inf') return special(fp.zero(sign), exact.finite(ZERO));
  if (b.kind === 'zero') {
    if (a.kind === 'zero') return special(fp.nan(), exact.nan('0 / 0'), { invalid: true });
    return special(fp.inf(sign), exact.nan('division by zero'), { divByZero: true });
  }
  return roundedResult(fpToFraction(a).div(fpToFraction(b)), fmt, mode, sign);
}

/** Fused multiply-add a·b + c with a single rounding. */
export function fpFma(a, b, c, fmt, mode = 'RNE') {
  if (a.kind === 'nan' || b.kind === 'nan' || c.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const psign = a.sign ^ b.sign;
  if (a.kind === 'inf' || b.kind === 'inf') {
    if (a.kind === 'zero' || b.kind === 'zero') return special(fp.nan(), exact.nan('0 · ∞'), { invalid: true });
    if (c.kind === 'inf' && c.sign !== psign) return special(fp.nan(), exact.nan('∞ − ∞'), { invalid: true });
    return special(fp.inf(psign), exact.inf(psign));
  }
  if (c.kind === 'inf') return special(c, exact.inf(c.sign));
  const pm = signedM(a) * signedM(b);
  const prod = dyadic(pm, a.q + b.q);
  const r = dyadicSum(pm, a.q + b.q, signedM(c), c.q);
  let zeroSign = mode === 'RD' ? 1 : 0;
  if (prod.n === 0n && c.kind === 'zero' && psign === c.sign) zeroSign = psign;
  return roundedResult(r, fmt, mode, zeroSign);
}

/**
 * Order of two FP values: −1, 0 or 1, or null when they are unordered (a NaN).
 * +0 and −0 are equal; ±∞ are below / above every finite number.
 */
export function fpOrder(a, b) {
  if (a.kind === 'nan' || b.kind === 'nan') return null;
  const rank = (v) => (v.kind === 'inf' ? (v.sign ? -1 : 1) : 0);
  if (rank(a) !== rank(b) || rank(a) !== 0) return Math.sign(rank(a) - rank(b));
  return fpToFraction(a).compare(fpToFraction(b));
}

/** Does the order c (−1, 0, 1 or null = unordered) satisfy the comparison op? */
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

/**
 * Comparison a op b. The answer is exactly 1 or 0 in every format: nothing is
 * rounded. IEEE 754 rules: a NaN is unordered, so every comparison with it is
 * false except != (NaN == NaN is false), and +0 == −0. The quiet comparisons
 * are modelled (as == and != are in C), so no flag is raised.
 */
export function fpCompare(op, a, b, fmt) {
  const value = orderSatisfies(op, fpOrder(a, b)) ? roundFraction(new Fraction(1), fmt).value : fp.zero();
  return special(value, fpToExact(value));
}

/**
 * Cast: store the stored value a of a column whose format is fmt into the
 * format `target`, then hold the result in fmt again. Both steps round with
 * the active mode; the second one is exact whenever target ⊆ fmt. The
 * operation's ideal result is a itself, so exactOp = a and the step's error is
 * the effect of the two roundings together.
 * round: the rounding into `target` (its neighbours, guard and sticky bits),
 *   with value, direction and flags of the whole cast.
 * cast: {target, mid (value in target), r1 (a → target), r2 (mid → fmt, null for ±∞)}
 */
export function fpCast(a, target, fmt, mode = 'RNE') {
  if (a.kind === 'nan' || a.kind === 'inf') return { ...special(a, fpToExact(a)), cast: { target: target.id, mid: a, r1: null, r2: null } };
  const x = fpToFraction(a);
  const r1 = roundFraction(x, target, mode, a.sign);
  const mid = r1.value;
  const r2 = mid.kind === 'inf' ? null : roundFraction(fpToFraction(mid), fmt, mode, mid.sign);
  const value = r2 ? r2.value : mid;
  const moved = value.kind === 'inf' ? 1 : fpToFraction(value).compare(x);
  const round = {
    ...r1,
    value,
    inexact: r1.inexact || !!r2?.inexact,
    overflow: r1.overflow || !!r2?.overflow,
    underflow: r1.underflow || !!r2?.underflow,
    tiny: r1.tiny || !!r2?.tiny,
    direction: moved === 0 ? 'exact' : (value.kind === 'inf' ? value.sign === 0 : moved > 0) ? 'up' : 'down',
  };
  return { value, exactOp: fpToExact(a), round, flags: flagsFrom(round), cast: { target: target.id, mid, r1, r2 } };
}

export function fpOp(op, args, fmt, mode) {
  switch (op) {
    case '+': return fpAdd(args[0], args[1], fmt, mode);
    case '-': return fpSub(args[0], args[1], fmt, mode);
    case '*': return fpMul(args[0], args[1], fmt, mode);
    case '/': return fpDiv(args[0], args[1], fmt, mode);
    case 'fma': return fpFma(args[0], args[1], args[2], fmt, mode);
    case 'neg': { const v = fpNeg(args[0]); return special(v, fpToExact(v)); }
    case 'abs': { const v = fpAbs(args[0]); return special(v, fpToExact(v)); }
    case '==': case '!=': case '<': case '<=': case '>': case '>=': return fpCompare(op, args[0], args[1], fmt);
    default:
      if (CASTS[op]) return fpCast(args[0], FORMATS.find((f) => f.id === CASTS[op]), fmt, mode);
      throw new Error('unknown operation ' + op);
  }
}

// ---------------------------------------------------------------------------
// Encoding and display
// ---------------------------------------------------------------------------

function bits(x, width) {
  return width <= 0 ? '' : x.toString(2).padStart(width, '0');
}

/**
 * Bit fields of a value. For bounded formats returns the exact storage
 * layout; for unbounded formats a sign/exponent/significand description.
 */
export function encode(v, fmt) {
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
    // Express the significand at the canonical quantum.
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

/** Classify a value: zero / subnormal / normal / infinity / NaN. */
export function classify(v, fmt) {
  if (v.kind === 'zero') return 'zero';
  if (v.kind === 'inf') return 'infinity';
  if (v.kind === 'nan') return 'NaN';
  return isSubnormal(v, fmt) ? 'subnormal' : 'normal';
}

/** Binary scientific notation, e.g. 1.1001100110011…₂ × 2^−4 */
export function binarySci(v, fmt) {
  if (v.kind !== 'finite') return fpShort(v, fmt);
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
 * Shortest decimal string that converts back to the same value
 * (like JavaScript's Number.prototype.toString does for doubles).
 */
export function shortestDecimal(v, fmt) {
  if (v.kind === 'nan') return 'NaN';
  if (v.kind === 'inf') return v.sign ? '−∞' : '+∞';
  if (v.kind === 'zero') return v.sign ? '−0' : '0';
  const r = fpToFraction(v);
  const maxDigits = fmt.decimalDigits;
  if (fmt.p > 160) return formatSci(toSciParts(r, maxDigits));
  for (let k = 1; k <= maxDigits; k++) {
    const parts = toSciParts(r, k);
    const mag = BigInt(parts.digits);
    const testMag = (m, exp) => {
      const s = parts.negative ? -m : m;
      const sh = exp - (k - 1);
      const back = sh >= 0 ? frac(s * pow10(sh), 1n) : frac(s, pow10(-sh));
      return fpEquals(roundFraction(back, fmt, 'RNE').value, v);
    };
    if (testMag(mag, parts.exp)) return formatSci(parts);
    // At powers of two the rounding interval is twice as wide away from zero, so
    // the next k-digit decimal away from zero can round-trip when the nearest does not.
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

/** Range facts for the info panel. */
export function formatFacts(fmt) {
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
