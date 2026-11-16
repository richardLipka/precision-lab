// Elementary functions in a simulated binary format, correctly rounded.
//
// sqrt must be correctly rounded by IEEE 754. For exp, ln, sin, … the standard
// only recommends it (real libm implementations may differ by up to ~1 ulp);
// here every function is simulated as correctly rounded with Ziv's strategy:
// evaluate with decimal.js at P digits, round the interval [y − ε, y + ε]; if
// both ends round to the same format number that number is the correctly
// rounded result, otherwise retry with more digits.

import { Fraction, exact, pow10, ZERO, dyadic, bitLength } from './rational.js';
import { fp, roundFraction, fpToFraction, fpEquals, fpNeg, flagsFrom, special } from './ieee.js';
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

function exactResult(r, fmt, mode, zeroSign = 0) {
  const round = roundFraction(r, fmt, mode, zeroSign);
  return { value: round.value, exactOp: exact.finite(r), round, flags: flagsFrom(round) };
}

/**
 * Correctly rounded value of an irrational function result.
 * @param {(C:Function)=>any} compute decimal.js computation in constructor C
 */
export function zivRound(compute, fmt, mode) {
  let P = Math.ceil(fullDigits(fmt)) + ZIV_GUARD_DIGITS;
  let last = null;
  for (let iter = 0; iter < ZIV_MAX_ITER; iter++) {
    let y;
    try {
      y = compute(decCtx(P));
    } catch (e) {
      if (/precision limit/i.test(e.message)) {
        if (last) break;
        throw new EngineError('real.precisionLimit');
      }
      throw e;
    }
    if (decBeyond(y)) return beyondRange(y, fmt, mode, P);
    const A = decToFraction(y);
    if (A.n === 0n) return { A, round: roundFraction(A, fmt, mode), P };
    // error bound of the P-digit evaluation: one unit in its P-th significant digit, |A|·10^(1−P)
    const eps = A.abs().div(new Fraction(pow10(P - 1), 1n));
    const lo = roundFraction(A.sub(eps), fmt, mode);
    const hi = roundFraction(A.add(eps), fmt, mode);
    const round = roundFraction(A, fmt, mode);
    round.inexact = true;
    last = { A, y, round, P };
    if (fpEquals(lo.value, hi.value)) return last;
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
  const stand = dyadic(1n, huge ? fmt.emax + 2 : fmt.emin - fmt.p - 2, sign);
  const round = roundFraction(stand, fmt, mode);
  round.inexact = true;
  return { A: stand, y, round, P, beyond: huge ? 'huge' : 'tiny', sign };
}

function irrational(compute, fmt, mode) {
  const z = zivRound(compute, fmt, mode);
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

const decOf = (v) => (C) => fracToDec(fpToFraction(v), C);
const isNum = (v) => v.kind === 'finite' || v.kind === 'zero';
const isOne = (v) => v.kind === 'finite' && v.sign === 0 && fpToFraction(v).equals(1);

/** Is the FP value an (exact) integer? */
function isInteger(v) {
  if (v.kind === 'zero') return true;
  if (v.kind !== 'finite') return false;
  return v.q >= 0 || (v.m & ((1n << BigInt(-v.q)) - 1n)) === 0n;
}

function isOddInteger(v) {
  if (!isInteger(v) || v.kind !== 'finite') return false;
  if (v.q > 0) return false;
  return ((v.m >> BigInt(-v.q)) & 1n) === 1n;
}

export function fpFunction(name, args, fmt, mode) {
  const [x, y] = args;
  if (args.some((a) => a.kind === 'nan')) return special(fp.nan(), exact.nan('NaN operand'));
  const nan = (why) => special(fp.nan(), exact.nan(why), { invalid: true });
  switch (name) {
    case 'sqrt': {
      if (x.kind === 'zero') return special(x, exact.finite(ZERO));
      if (x.sign) return nan('√ of a negative number');
      if (x.kind === 'inf') return special(x, exact.inf(0));
      // Perfect square? (m·2^q with even q and square m)
      let m = x.m;
      let q = x.q;
      if (q % 2 !== 0) { m <<= 1n; q -= 1; }
      const s = exactRoot(m, 2);
      if (s != null) return exactResult(dyadic(s, q / 2), fmt, mode);
      return irrational((C) => C.sqrt(decOf(x)(C)), fmt, mode);
    }
    case 'exp': {
      if (x.kind === 'inf') return special(x.sign ? fp.zero(0) : x, x.sign ? exact.finite(ZERO) : exact.inf(0));
      if (x.kind === 'zero') return exactResult(new Fraction(1), fmt, mode);
      return irrational((C) => C.exp(decOf(x)(C)), fmt, mode);
    }
    case 'ln':
    case 'log10': {
      if (x.kind === 'zero') return special(fp.inf(1), exact.nan('logarithm of 0'), { divByZero: true });
      if (x.sign) return nan('logarithm of a negative number');
      if (x.kind === 'inf') return special(x, exact.inf(0));
      if (isOne(x)) return exactResult(new Fraction(0), fmt, mode);
      if (name === 'log10' && isInteger(x)) {
        const s = fpToFraction(x).n.toString();
        if (/^10*$/.test(s)) return exactResult(new Fraction(s.length - 1), fmt, mode);
      }
      return irrational((C) => (name === 'ln' ? C.ln(decOf(x)(C)) : C.log10(decOf(x)(C))), fmt, mode);
    }
    case 'sin':
    case 'cos':
    case 'tan': {
      if (x.kind === 'inf') return nan(`${name}(±∞)`);
      if (x.kind === 'zero') return name === 'cos' ? exactResult(new Fraction(1), fmt, mode) : special(x, exact.finite(ZERO));
      return irrational((C) => decFn(name, C, [decOf(x)(C)]), fmt, mode);
    }
    case 'atan': {
      if (x.kind === 'zero') return special(x, exact.finite(ZERO));
      if (x.kind === 'inf') return irrational((C) => decFn('pi', C, []).div(x.sign ? -2 : 2), fmt, mode);
      return irrational((C) => C.atan(decOf(x)(C)), fmt, mode);
    }
    case 'pow':
      return fpPow(x, y, fmt, mode, nan);
    default:
      throw new Error('unknown function ' + name);
  }
}

function fpPow(x, y, fmt, mode, nan) {
  if (y.kind === 'zero') return exactResult(new Fraction(1), fmt, mode);
  if (isOne(x)) return exactResult(new Fraction(1), fmt, mode);
  const yNeg = y.sign === 1;
  if (y.kind === 'inf') {
    if (x.kind === 'zero') return special(yNeg ? fp.inf(0) : fp.zero(0), yNeg ? exact.nan('0^(−∞)') : exact.finite(ZERO), yNeg ? { divByZero: true } : {});
    const ax = x.kind === 'inf' ? Infinity : Math.abs(Number(fpToFraction(x).valueOf()));
    if (ax === 1) return exactResult(new Fraction(1), fmt, mode);
    const big = (ax > 1) !== yNeg;
    return special(big ? fp.inf(0) : fp.zero(0), big ? exact.inf(0) : exact.finite(ZERO));
  }
  const oddInt = isOddInteger(y);
  if (x.kind === 'zero') {
    const sign = oddInt ? x.sign : 0;
    if (yNeg) return special(fp.inf(sign), exact.nan('0 to a negative power'), { divByZero: true });
    return special(fp.zero(sign), exact.finite(ZERO));
  }
  if (x.kind === 'inf') {
    const sign = x.sign && oddInt ? 1 : 0;
    return yNeg ? special(fp.zero(sign), exact.finite(ZERO)) : special(fp.inf(sign), exact.inf(sign));
  }
  if (x.sign && !isInteger(y)) return nan('negative base with a non-integer exponent');
  if (isInteger(y)) {
    // Integer power of a dyadic number is a dyadic number: exact, then one rounding.
    const e = fpToFraction(y);
    const n = Number(e.s * e.n);
    const size = Math.abs(n) * bitLength(x.m);
    if (Number.isSafeInteger(n) && size <= 2_000_000) {
      const r = fpToFraction(x).pow(n);
      return exactResult(r, fmt, mode);
    }
  }
  return irrational((C) => C.pow(decOf(x)(C), decOf(y)(C)), fmt, mode);
}

/** Correctly rounded π in the format. */
export function fpPi(fmt, mode) {
  return irrational((C) => decFn('pi', C, []), fmt, mode);
}

export { fpNeg };
