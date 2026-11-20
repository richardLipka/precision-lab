// Elementary functions in a simulated binary format, correctly rounded.
//
// sqrt must be correctly rounded by IEEE 754. For exp, ln, sin, … the standard
// only recommends it (real libm implementations may differ by up to ~1 ulp);
// here every function is simulated as correctly rounded with Ziv's strategy:
// evaluate with decimal.js at P digits, round the interval [y − ε, y + ε]; if
// both ends round to the same format number that number is the correctly
// rounded result, otherwise retry with more digits.

import { Fraction, exact, pow10, frac, ZERO, ONE, dyadic, bitLength, trailingZeros } from './rational.js';
import { fp, roundFraction, fpToFraction, fpEquals, fpNeg, flagsFrom, special, exponentOf } from './ieee.js';
import { decCtx, decFn, decToFraction, fracToDec, exactRoot, decBeyond, MAX_DEC_EXP } from './real.js';
import { EngineError } from './messages.js';
import { fullDigits } from './metrics.js';

/**
 * Ziv's strategy starts with the format's decimal digits plus this many guard
 * digits: a result closer than 10^−12 relative to a rounding boundary is rare,
 * so the first attempt almost always decides.
 */
const ZIV_GUARD_DIGITS = 12;
/** Each retry doubles the digits; after 7 tries (the last one at 64× the starting digits) the result is marked uncertain. */
const ZIV_MAX_ITER = 7;
/** Maximum |q| for exact decimal string conversion of a dyadic operand (covers all IEEE formats through binary128). */
const MAX_EXACT_DYADIC_EXP = 20000;
const FIVE = 5n;

function exactResult(r, fmt, mode, zeroSign = 0, preferredQ = null) {
  const round = roundFraction(r, fmt, mode, zeroSign, preferredQ);
  return { value: round.value, exactOp: exact.finite(r), round, flags: flagsFrom(round) };
}

/**
 * Convert a finite stored value (binary or decimal, floating or fixed) into a
 * Decimal in C without truncating its exact stored value. Returns { d, exact }.
 */
function exactDecOf(v, C) {
  if (v.kind === 'zero') return { d: new C(v.sign ? '-0' : '0'), exact: true };
  const s = v.sign ? '-' : '';
  if (v.radix === 10) {
    return { d: new C(`${s}${v.m.toString()}e${v.q}`), exact: true };
  }
  const tz = trailingZeros(v.m);
  const m = v.m >> BigInt(tz);
  const q = v.q + tz;
  if (q >= 0 && q <= MAX_EXACT_DYADIC_EXP) {
    return { d: new C(s + (m << BigInt(q)).toString()), exact: true };
  }
  if (q < 0 && -q <= MAX_EXACT_DYADIC_EXP) {
    const k = -q;
    return { d: new C(`${s}${(m * (FIVE ** BigInt(k))).toString()}e-${k}`), exact: true };
  }
  return { d: fracToDec(fpToFraction(v), C), exact: false };
}

/**
 * Correctly rounded value of an irrational function result.
 * @param {(C:Function)=>any} compute decimal.js computation in constructor C
 * @param {object} fmt
 * @param {string} mode
 * @param {boolean} [inexactInput] true when an operand had to be rounded during conversion
 */
export function zivRound(compute, fmt, mode, inexactInput = false) {
  let P = Math.ceil(fullDigits(fmt)) + ZIV_GUARD_DIGITS;
  let last = null;
  for (let iter = 0; iter < ZIV_MAX_ITER; iter++) {
    let y;
    let y2 = null;
    try {
      y = compute(decCtx(P));
      if (inexactInput) y2 = compute(decCtx(P + 16));
    } catch (e) {
      if (/precision limit/i.test(e.message)) {
        if (last) break;
        throw new EngineError('real.precisionLimit');
      }
      throw e;
    }
    const ref = y2 || y;
    if (decBeyond(ref)) return beyondRange(ref, fmt, mode, P);
    const A = decToFraction(ref);
    if (A.n === 0n) return { A, round: roundFraction(A, fmt, mode), P };
    // Error bound: one unit in the P-th significant digit (plus any observed drift if input was approximate).
    let eps = A.abs().div(new Fraction(pow10(P - 1), 1n));
    if (y2) {
      const A1 = decToFraction(y);
      const drift = A.sub(A1).abs().mul(4);
      if (drift.compare(eps) > 0) eps = drift;
    }
    const lo = roundFraction(A.sub(eps), fmt, mode);
    const hi = roundFraction(A.add(eps), fmt, mode);
    const round = roundFraction(A, fmt, mode);
    // An irrational result is never an exact representable float: if A snapped onto
    // one (e.g. cos(1e-8) → 1 at low P), retry with more digits so below < A < above
    // and the rounding direction is resolved (and numberLine never sees gap = 0).
    const resolved = round.inexact || round.overflow;
    round.inexact = true;
    last = { A, y: ref, round, P };
    if (resolved && fpEquals(lo.value, hi.value)) return last;
    P *= 2;
  }
  last.uncertain = true;
  return last;
}

/**
 * A function value beyond ±10^MAX_DEC_EXP (exp(10⁶), pow(1.0078125, 10⁸)) is far
 * outside every bounded format, so its rounding is decided by the range alone:
 * a value above 2^(emax+1) rounds like any other overflow (±∞ or the largest
 * finite number, by mode), one below 2^(emin−p−1) like any other underflow
 * past half the smallest subnormal. Such a stand-in value is rounded instead of
 * the true one, which never has to become a (gigantic) fraction. Unbounded
 * formats have no such limit, so there the range error remains.
 */
function beyondRange(y, fmt, mode, P) {
  if (!fmt.bounded || y.isNaN()) throw new EngineError('real.range', { max: MAX_DEC_EXP });
  const sign = y.isNeg() ? 1 : 0;
  const huge = !y.isFinite() || y.e > 0;
  let stand;
  if (fmt.fixed) {
    // Huge values exceed fixed range (saturate or trap/wrap — stand-in beyond max);
    // tiny values lie strictly between 0 and Δ/4 so they flush to 0 under RNE/RNA/RZ or step by mode.
    stand = huge
      ? (sign ? fpToFraction({ kind: 'finite', sign: 1, m: fmt.modulus * 2n, q: fmt.scaleExp, radix: fmt.radix }) : fpToFraction({ kind: 'finite', sign: 0, m: fmt.modulus * 2n, q: fmt.scaleExp, radix: fmt.radix }))
      : fmt.step.div(16).mul(sign ? -1 : 1);
  } else if (fmt.family === 'decfloat') {
    const e = huge ? fmt.emax + 2 : fmt.qmin - 2;
    stand = e >= 0 ? frac(sign ? -pow10(e) : pow10(e), 1n) : frac(sign ? -1n : 1n, pow10(-e));
  } else {
    stand = dyadic(1n, huge ? fmt.emax + 2 : fmt.emin - fmt.p - 2, sign);
  }
  const round = roundFraction(stand, fmt, mode);
  round.inexact = true;
  return { A: stand, y, round, P, beyond: huge ? 'huge' : 'tiny', sign };
}

function irrational(compute, fmt, mode, inexactInput = false) {
  const z = zivRound(compute, fmt, mode, inexactInput);
  if (z.beyond) {
    // The exact result on the stored operands cannot be a fraction either.
    const exactOp = z.beyond === 'huge'
      ? { ...exact.inf(z.sign), beyond: true }
      : { kind: 'finite', r: ZERO, approx: true, ziv: true, a: z.y, b: z.y, reliable: 0, beyond: true };
    return { value: z.round.value, exactOp, round: z.round, flags: flagsFrom(z.round), uncertain: false };
  }
  const exactOp = { kind: 'finite', r: z.A, approx: true, ziv: true, a: z.y, b: z.y, reliable: z.P - 1 };
  return { value: z.round.value, exactOp, round: z.round, flags: flagsFrom(z.round), uncertain: !!z.uncertain };
}

const isExactInput = (v) => v.kind === 'zero' || v.radix === 10 || Math.abs(v.q + trailingZeros(v.m)) <= MAX_EXACT_DYADIC_EXP;
const decOf = (v) => (C) => exactDecOf(v, C).d;
const isOne = (v) => v.kind === 'finite' && v.sign === 0 && fpToFraction(v).equals(1);
const isNegOne = (v) => v.kind === 'finite' && v.sign === 1 && fpToFraction(v).equals(-1);

/**
 * Exact rounding for tiny nonzero arguments where f(x) lies strictly within a
 * tiny fraction of 1 ulp on a known side of 1 (exp, cos) or x (sin, tan, atan).
 */
function tinyArgResult(name, x, fmt, mode) {
  if (fmt.fixed) return null;
  const ex = fmt.radix === 10 ? Math.floor(exponentOf(x) * 3.321928) : exponentOf(x);
  if (Math.abs(ex) > MAX_EXACT_DYADIC_EXP) return null;
  const p = fmt.radix === 10 ? Math.ceil(fmt.p * 3.321928) + 4 : fmt.p;
  let A = null;
  if (name === 'exp' && ex <= -(p + 5)) {
    if (Math.abs(ex) <= 600) {
      const xr = fpToFraction(x);
      A = ONE.add(xr).add(xr.mul(xr).div(2));
    } else {
      A = ONE.add(dyadic(1n, -p - 4, x.sign));
    }
  } else if (name === 'cos' && ex <= -Math.ceil((p + 8) / 2)) {
    if (Math.abs(ex) <= 600) {
      const xr = fpToFraction(x);
      A = ONE.sub(xr.mul(xr).div(2));
    } else {
      A = ONE.sub(dyadic(1n, -p - 4));
    }
  } else if ((name === 'sin' || name === 'tan' || name === 'atan') && ex <= -Math.ceil((p + 8) / 2)) {
    if (Math.abs(ex) <= 400) {
      const xr = fpToFraction(x);
      const x3 = xr.mul(xr).mul(xr);
      A = name === 'sin' ? xr.sub(x3.div(6)) : name === 'atan' ? xr.sub(x3.div(3)) : xr.add(x3.div(3));
    } else {
      const eEff = fmt.bounded ? Math.max(ex, fmt.radix === 10 ? Math.floor(fmt.emin * 3.321928) : fmt.emin) : ex;
      const delta = dyadic(1n, eEff - p - 4, name === 'tan' ? x.sign : 1 - x.sign);
      A = fpToFraction(x).add(delta);
    }
  }
  if (!A) return null;
  const round = roundFraction(A, fmt, mode);
  round.inexact = true;
  const P = Math.ceil(fullDigits(fmt)) + ZIV_GUARD_DIGITS;
  const C = decCtx(P);
  const y = name === 'exp' || name === 'cos' ? new C(1) : fracToDec(fpToFraction(x), C);
  const exactOp = { kind: 'finite', r: A, approx: true, ziv: true, a: y, b: y, reliable: P - 1 };
  return { value: round.value, exactOp, round, flags: flagsFrom(round), uncertain: false };
}

/** Is the stored value an (exact) integer? */
function isInteger(v) {
  if (v.kind === 'zero') return true;
  if (v.kind !== 'finite') return false;
  if (v.radix === 10) return v.q >= 0 || (v.m % pow10(-v.q)) === 0n;
  return v.q >= 0 || (v.m & ((1n << BigInt(-v.q)) - 1n)) === 0n;
}

function isOddInteger(v) {
  if (!isInteger(v) || v.kind !== 'finite') return false;
  if (v.radix === 10) {
    if (v.q > 0) return false;
    const intVal = v.q === 0 ? v.m : v.m / pow10(-v.q);
    return (intVal & 1n) === 1n;
  }
  if (v.q > 0) return false;
  return ((v.m >> BigInt(-v.q)) & 1n) === 1n;
}

export function fpFunction(name, args, fmt, mode) {
  const [x, y] = args;
  const nan = (why) => special(fmt.fixed ? fp.trap() : fp.nan(), exact.nan(why), { invalid: true });
  if (name === 'pow') return fpPow(x, y, fmt, mode, nan);
  if (args.some((a) => a.kind === 'nan')) return special(fmt.fixed ? fp.trap() : fp.nan(), exact.nan(fmt.fixed ? 'error operand' : 'NaN operand'));
  const approxIn = !isExactInput(x);
  switch (name) {
    case 'sqrt': {
      if (x.kind === 'zero') return special(fmt.family === 'decfloat' ? fp.zero(x.sign, Math.floor(x.q / 2), 10) : x, exact.finite(ZERO));
      if (x.sign) return nan('√ of a negative number');
      if (x.kind === 'inf') return special(x, exact.inf(0));
      if (x.radix === 10) {
        let m = x.m;
        let q = x.q;
        if (q % 2 !== 0) { m *= 10n; q -= 1; }
        const s = exactRoot(m, 2);
        if (s != null) {
          const halfQ = q / 2;
          const r = halfQ >= 0 ? frac(s * pow10(halfQ), 1n) : frac(s, pow10(-halfQ));
          return exactResult(r, fmt, mode, 0, fmt.family === 'decfloat' ? Math.floor(x.q / 2) : null);
        }
        return irrational((C) => C.sqrt(decOf(x)(C)), fmt, mode, approxIn);
      }
      // Perfect square? (m·2^q with even q and square m)
      let m = x.m;
      let q = x.q;
      if (q % 2 !== 0) { m <<= 1n; q -= 1; }
      const s = exactRoot(m, 2);
      if (s != null) return exactResult(dyadic(s, q / 2), fmt, mode);
      return irrational((C) => C.sqrt(decOf(x)(C)), fmt, mode, approxIn);
    }
    case 'exp': {
      if (x.kind === 'inf') return special(x.sign ? fp.zero(0, fmt.family === 'decfloat' ? fmt.qmin : 0, fmt.radix) : x, x.sign ? exact.finite(ZERO) : exact.inf(0));
      if (x.kind === 'zero') return exactResult(new Fraction(1), fmt, mode);
      return tinyArgResult('exp', x, fmt, mode) || irrational((C) => C.exp(decOf(x)(C)), fmt, mode, approxIn);
    }
    case 'ln':
    case 'log10': {
      if (x.kind === 'zero') return special(fmt.fixed ? fp.trap() : fp.inf(1), exact.nan('logarithm of 0'), { divByZero: true });
      if (x.sign) return nan('logarithm of a negative number');
      if (x.kind === 'inf') return special(x, exact.inf(0));
      if (isOne(x)) return exactResult(new Fraction(0), fmt, mode);
      if (name === 'log10') {
        const xr = fpToFraction(x);
        if (xr.d === 1n && /^10*$/.test(xr.n.toString())) return exactResult(new Fraction(xr.n.toString().length - 1), fmt, mode);
        if (xr.n === 1n && /^10*$/.test(xr.d.toString())) return exactResult(new Fraction(-(xr.d.toString().length - 1)), fmt, mode);
      }
      return irrational((C) => (name === 'ln' ? C.ln(decOf(x)(C)) : C.log10(decOf(x)(C))), fmt, mode, approxIn);
    }
    case 'sin':
    case 'cos':
    case 'tan': {
      if (x.kind === 'inf') return nan(`${name}(±∞)`);
      if (x.kind === 'zero') return name === 'cos' ? exactResult(new Fraction(1), fmt, mode) : special(x, exact.finite(ZERO));
      return tinyArgResult(name, x, fmt, mode) || irrational((C) => decFn(name, C, [decOf(x)(C)]), fmt, mode, approxIn);
    }
    case 'atan': {
      if (x.kind === 'zero') return special(x, exact.finite(ZERO));
      if (x.kind === 'inf') return irrational((C) => decFn('pi', C, []).div(x.sign ? -2 : 2), fmt, mode);
      return tinyArgResult('atan', x, fmt, mode) || irrational((C) => C.atan(decOf(x)(C)), fmt, mode, approxIn);
    }
    default:
      throw new Error('unknown function ' + name);
  }
}

function fpPow(x, y, fmt, mode, nan) {
  if (fmt.fixed && (x.kind === 'nan' || y.kind === 'nan')) return special(fp.trap(), exact.nan('error operand'));
  // IEEE 754-2019 §9.2.1: pow(x, ±0) = 1 and pow(+1, y) = 1 even when the other operand is NaN.
  if (y.kind === 'zero') return exactResult(new Fraction(1), fmt, mode);
  if (isOne(x)) return exactResult(new Fraction(1), fmt, mode);
  if (x.kind === 'nan' || y.kind === 'nan') return special(fp.nan(), exact.nan('NaN operand'));
  const yNeg = y.sign === 1;
  if (y.kind === 'inf') {
    if (x.kind === 'zero') return special(yNeg ? fp.inf(0) : fp.zero(0, 0, fmt.radix), yNeg ? exact.nan('0^(−∞)') : exact.finite(ZERO), yNeg ? { divByZero: true } : {});
    const cmp1 = x.kind === 'inf' ? 1 : fpToFraction(x).abs().compare(ONE);
    if (cmp1 === 0) return exactResult(new Fraction(1), fmt, mode);
    const big = (cmp1 > 0) !== yNeg;
    return special(big ? fp.inf(0) : fp.zero(0, 0, fmt.radix), big ? exact.inf(0) : exact.finite(ZERO));
  }
  const oddInt = isOddInteger(y);
  if (x.kind === 'zero') {
    const sign = !fmt.fixed && oddInt ? x.sign : 0;
    if (yNeg) return special(fmt.fixed ? fp.trap() : fp.inf(sign), exact.nan('0 to a negative power'), { divByZero: true });
    return special(fp.zero(sign, fmt.fixed ? fmt.scaleExp : 0, fmt.radix), exact.finite(ZERO));
  }
  if (x.kind === 'inf') {
    const sign = x.sign && oddInt ? 1 : 0;
    return yNeg ? special(fp.zero(sign, 0, fmt.radix), exact.finite(ZERO)) : special(fp.inf(sign), exact.inf(sign));
  }
  if (x.sign && !isInteger(y)) return nan('negative base with a non-integer exponent');
  if (isNegOne(x) && isInteger(y)) {
    return exactResult(new Fraction(oddInt ? -1 : 1), fmt, mode);
  }
  if (isInteger(y)) {
    const e = fpToFraction(y);
    const n = Number(e.s * e.n);
    const ex = exponentOf(x);
    const resSign = x.sign && oddInt ? 1 : 0;
    if (fmt.bounded && !fmt.fixed && Number.isFinite(n)) {
      const loExp = n > 0 ? n * ex : n * (ex + 1);
      const hiExp = n > 0 ? n * (ex + 1) : n * ex;
      if (loExp > fmt.emax + 2) {
        const stand = fmt.family === 'decfloat'
          ? frac(resSign ? -pow10(fmt.emax + 2) : pow10(fmt.emax + 2), 1n)
          : dyadic(1n, fmt.emax + 2, resSign);
        const round = roundFraction(stand, fmt, mode);
        round.inexact = true;
        return { value: round.value, exactOp: { ...exact.inf(resSign), beyond: true }, round, flags: flagsFrom(round) };
      }
      if (hiExp < fmt.emin - fmt.p - 2) {
        const stand = fmt.family === 'decfloat'
          ? frac(resSign ? -1n : 1n, pow10(-(fmt.qmin - 2)))
          : dyadic(1n, fmt.emin - fmt.p - 2, resSign);
        const round = roundFraction(stand, fmt, mode);
        round.inexact = true;
        const exactOp = { kind: 'finite', r: ZERO, approx: true, ziv: true, reliable: 0, beyond: true };
        return { value: round.value, exactOp, round, flags: flagsFrom(round) };
      }
    }
    const size = Math.abs(n) * (bitLength(x.m) + Math.abs(x.q));
    if (Number.isSafeInteger(n) && size <= 2_000_000) {
      const r = fpToFraction(x).pow(n);
      return exactResult(r, fmt, mode);
    }
  }
  return irrational((C) => C.pow(decOf(x)(C), decOf(y)(C)), fmt, mode, !isExactInput(x) || !isExactInput(y));
}

/** Correctly rounded π in the format. */
export function fpPi(fmt, mode) {
  return irrational((C) => decFn('pi', C, []), fmt, mode);
}

export { fpNeg };
