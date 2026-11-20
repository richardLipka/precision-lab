// Reference values that are not rational (√2, e, ln 1.2, π, sin 1 …).
//
// Rational values stay exact (fraction.js). As soon as a function produces an
// irrational number, the "true" value is carried on as a high-precision decimal
// computed with decimal.js — twice, at two different precisions (D and ≈1.5·D
// digits). The number of digits on which both chains agree is reported as the
// verified accuracy of the reference, so cancellation inside the reference
// computation itself can never go unnoticed.
//
// Such values are still {kind:'finite', r:Fraction} (r = the more precise decimal
// as an exact fraction), plus: approx:true, a/b (the two Decimals), reliable (digits).

import Decimal from 'decimal.js';
import { Fraction, exact, parseLiteral, pow10, bitLength } from './rational.js';
import { EngineError } from './messages.js';

export { Decimal };

/** Decimal exponents beyond ±MAX_DEC_EXP are not converted to exact fractions (they would have ~330 000 bits). */
export const MAX_DEC_EXP = 100000;
const ctxCache = new Map();

/** decimal.js constructor with the given precision (cached). */
export function decCtx(precision) {
  let C = ctxCache.get(precision);
  if (!C) {
    C = Decimal.clone({ precision, rounding: Decimal.ROUND_HALF_EVEN, maxE: 9e15, minE: -9e15 });
    ctxCache.set(precision, C);
  }
  return C;
}

/**
 * The second (control) reference chain runs with REF_RATIO × the digits plus
 * REF_EXTRA_DIGITS, so its own rounding errors are far below those of the first
 * chain; digits on which both chains agree are reported as verified.
 */
const REF_RATIO = 1.5;
const REF_EXTRA_DIGITS = 10;
const refDigitsB = (d) => Math.ceil(d * REF_RATIO) + REF_EXTRA_DIGITS;

let DIG = 60;
let A = decCtx(60);
let B = decCtx(refDigitsB(60));

/** Set the precision (decimal digits) of the reference chain. */
export function setRealDigits(d) {
  DIG = Math.max(20, Math.min(4000, Math.ceil(d)));
  A = decCtx(DIG);
  B = decCtx(refDigitsB(DIG));
}

export function realDigits() {
  return DIG;
}

/** Exact fraction of a Decimal (decimals are terminating, so this is exact). */
export function decToFraction(y) {
  if (!y.isFinite()) throw new EngineError('real.range', { max: MAX_DEC_EXP });
  if (Math.abs(y.e) > MAX_DEC_EXP) throw new EngineError('real.range', { max: MAX_DEC_EXP });
  return parseLiteral(y.toString()).r;
}

/** A rational (Fraction) as a Decimal of the given constructor. */
export function fracToDec(r, C) {
  const n = new C((r.s < 0n ? '-' : '') + r.n.toString());
  return r.d === 1n ? n : n.div(r.d.toString());
}

function pair(x) {
  if (x.approx) return [x.a, x.b];
  return [fracToDec(x.r, A), fracToDec(x.r, B)];
}

function agreement(a, b) {
  const bb = new B(a);
  if (b.isZero()) return 0;
  if (bb.eq(b)) return DIG - 1;
  const rel = bb.minus(b).abs().div(b.abs());
  const lg = rel.e < -300 ? rel.e : Math.log10(rel.toNumber());
  return Math.max(0, Math.min(DIG - 1, -lg));
}

/** Is a Decimal outside the range that is converted to exact fractions (|decimal exponent| > MAX_DEC_EXP)? */
export function decBeyond(y) {
  return !y.isFinite() || Math.abs(y.e) > MAX_DEC_EXP;
}

/**
 * Build an approximate (irrational) exact value from the two chains.
 * A value beyond ±10^MAX_DEC_EXP (exp(10⁶), a huge pow) cannot become a
 * fraction; instead of aborting the whole program it is carried on as ∞
 * (huge) or as 0 (tiny), marked `beyond` so the explanation can say so.
 */
export function approxValue(a, b, reliable = null) {
  if (decBeyond(b) && !b.isNaN()) {
    if (!b.isFinite() || b.e > 0) return { ...exact.inf(b.isNeg() ? 1 : 0), beyond: true };
    return { kind: 'finite', approx: true, a, b, r: new Fraction(0), reliable: 0, beyond: true };
  }
  return {
    kind: 'finite',
    approx: true,
    a,
    b,
    r: decToFraction(b),
    reliable: reliable ?? agreement(a, b),
  };
}

function wrap(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EngineError) throw e;
    if (/precision limit/i.test(e.message)) throw new EngineError('real.precisionLimit');
    throw e;
  }
}

/** + − × ÷ fma when at least one operand is irrational (both finite). */
export function realOp(op, args) {
  return wrap(() => {
    const p = args.map(pair);
    const big = args.some((x) => x.big);
    const run = (i) => {
      const [x, y, z] = p.map((q) => q[i]);
      switch (op) {
        case '+': return x.plus(y);
        case '-': return x.minus(y);
        case '*': return x.times(y);
        case '/': return x.div(y);
        case 'fma': return x.times(y).plus(z);
        default: throw new Error('realOp ' + op);
      }
    };
    const out = approxValue(run(0), run(1));
    if (big && !args.some((x) => x.approx && !x.big)) out.big = true;
    return out;
  });
}

/** Bits above which an exact fraction is continued as a decimal reference. */
export const MAX_EXACT_BITS = 60000;

/** Keep a rational exact unless it has grown too large; then switch to decimal. */
export function limitSize(v) {
  if (v.kind !== 'finite' || v.approx) return v;
  if (bitLength(v.r.n) + bitLength(v.r.d) <= MAX_EXACT_BITS) return v;
  const x = approxValue(fracToDec(v.r, A), fracToDec(v.r, B), DIG - 1);
  x.big = true;
  return x;
}

export function realNeg(x) {
  return { ...x, a: x.a.neg(), b: x.b.neg(), r: x.r.neg() };
}

export function realAbs(x) {
  return { ...x, a: x.a.abs(), b: x.b.abs(), r: x.r.abs() };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export const FUNCTION_NAMES = ['sqrt', 'exp', 'ln', 'log10', 'sin', 'cos', 'tan', 'atan', 'pow'];
export const TRANSCENDENTAL = new Set(['exp', 'ln', 'log10', 'sin', 'cos', 'tan', 'atan']);

/** Decimal implementation of a function in constructor C (args are Decimals of C). */
export function decFn(name, C, args) {
  const [x, y] = args;
  switch (name) {
    case 'sqrt': return C.sqrt(x);
    case 'exp': return C.exp(x);
    case 'ln': return C.ln(x);
    case 'log10': return C.log10(x);
    case 'sin': return C.sin(x);
    case 'cos': return C.cos(x);
    case 'tan': return C.tan(x);
    case 'atan': return C.atan(x);
    case 'pow': return C.pow(x, y);
    case 'pi': return C.acos(-1);
    default: throw new Error('decFn ' + name);
  }
}

/** Integer k-th root of a non-negative BigInt, or null if it is not a perfect power. */
export function exactRoot(n, k) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  // Newton iteration from a power-of-two upper bound
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k) + 1);
  const K = BigInt(k);
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  return x ** K === n ? x : null;
}

const isInt = (r) => r.d === 1n;

/**
 * Exact value of a function of exact arguments. Rational whenever the result
 * is rational (√4, exp(0), ln(1), 2^10, 8^(1/3) …), otherwise an approximate
 * irrational value from the two decimal chains.
 */
export function exactFunction(name, args) {
  const [x, y] = args;
  if (args.some((a) => a.kind === 'nan')) return args.find((a) => a.kind === 'nan');
  // Infinite arguments: limits
  if (args.some((a) => a.kind === 'inf')) return infLimit(name, x, y);
  const R = (v) => exact.finite(v);
  const xr = x.r;
  const zero = xr.n === 0n;
  const neg = xr.s < 0n && !zero;
  if (name === 'pow') {
    const yr = y.r;
    if (!y.approx && yr.n === 0n) return R(new Fraction(1));
    if (!x.beyond && zero) {
      if (y.beyond ? y.b.isNeg() : yr.s < 0n && yr.n !== 0n) return exact.nan('0 to a negative power');
      if (!y.approx && yr.n > 0n) return R(new Fraction(0));
      if (y.approx && !y.b.isNeg() && !y.b.isZero()) return R(new Fraction(0));
    }
  }
  if (!x.approx && (name !== 'pow' || !y.approx)) {
    switch (name) {
      case 'sqrt': {
        if (neg) return exact.nan('√ of a negative number');
        const n = exactRoot(xr.n, 2);
        const d = exactRoot(xr.d, 2);
        if (n != null && d != null) return R(new Fraction(n, d));
        break;
      }
      case 'exp': if (zero) return R(new Fraction(1)); break;
      case 'ln':
        if (zero) return exact.nan('ln 0 = −∞ (undefined)');
        if (neg) return exact.nan('ln of a negative number');
        if (xr.n === 1n && xr.d === 1n) return R(new Fraction(0));
        break;
      case 'log10': {
        if (zero) return exact.nan('log₁₀ 0 = −∞ (undefined)');
        if (neg) return exact.nan('log of a negative number');
        const k = powerOfTen(xr);
        if (k != null) return R(new Fraction(k));
        break;
      }
      case 'sin': case 'tan': case 'atan': if (zero) return R(new Fraction(0)); break;
      case 'cos': if (zero) return R(new Fraction(1)); break;
      case 'pow': {
        const yr = y.r;
        if (yr.n === 0n) return R(new Fraction(1));
        if (zero) return yr.s < 0n ? exact.nan('0 to a negative power') : R(new Fraction(0));
        if (isInt(yr)) {
          const e = yr.s * yr.n;
          const size = Number(e < 0n ? -e : e) * (bitLength(xr.n) + bitLength(xr.d));
          if (size <= 2_000_000) return R(xr.pow(Number(e)));
          break; // too large to keep exactly → decimal reference
        }
        if (neg) return exact.nan('negative base with a non-integer exponent');
        // x^(c/d) is rational iff numerator and denominator are perfect d-th powers
        if (yr.d <= 64n) {
          const k = Number(yr.d);
          const n = exactRoot(xr.n, k);
          const d = exactRoot(xr.d, k);
          if (n != null && d != null) {
            const base = new Fraction(n, d);
            const e = Number(yr.s * yr.n);
            if (Math.abs(e) * (bitLength(n) + bitLength(d)) <= 2_000_000) return R(base.pow(e));
          }
        }
        break;
      }
      default: break;
    }
  } else {
    if (name === 'sqrt' && neg) return exact.nan('√ of a negative number');
    if ((name === 'ln' || name === 'log10') && (neg || zero)) return exact.nan('logarithm of a non-positive number');
  }
  if (name === 'pow' && neg && !(isInt(y.r) && !y.approx)) return exact.nan('negative base with a non-integer exponent');
  return wrap(() => {
    const p = args.map(pair);
    const a = decFn(name, A, p.map((q) => q[0]));
    const b = decFn(name, B, p.map((q) => q[1]));
    return approxValue(a, b);
  });
}

/** π as an exact (irrational) value. */
export function exactPi() {
  return wrap(() => approxValue(decFn('pi', A, []), decFn('pi', B, [])));
}

function powerOfTen(r) {
  if (r.d === 1n) {
    const s = r.n.toString();
    if (/^10*$/.test(s)) return s.length - 1;
    return null;
  }
  if (r.n === 1n) {
    const s = r.d.toString();
    if (/^10*$/.test(s)) return -(s.length - 1);
  }
  return null;
}

function infLimit(name, x, y) {
  const pos = (v) => v.kind === 'inf' ? v.sign === 0 : v.r.s > 0n && v.r.n !== 0n;
  switch (name) {
    case 'sqrt': return x.sign ? exact.nan('√ of −∞') : x;
    case 'exp': return x.sign ? exact.finite(new Fraction(0)) : x;
    case 'ln': case 'log10': return x.sign ? exact.nan('logarithm of −∞') : x;
    case 'atan': return wrap(() => {
      const h = (C) => decFn('pi', C, []).div(2).times(x.sign ? -1 : 1);
      return approxValue(h(A), h(B));
    });
    case 'pow': {
      if (y.kind === 'inf') return exact.nan('power with an infinite exponent');
      if (y.r.n === 0n && !y.beyond) return exact.finite(new Fraction(1));
      const yPos = y.beyond ? !y.b.isNeg() : pos(y);
      if (!yPos) {
        if (x.sign && (y.approx || !isInt(y.r))) return exact.nan('negative base with a non-integer exponent');
        return exact.finite(new Fraction(0));
      }
      if (x.sign) {
        if (y.approx || !isInt(y.r)) return exact.nan('negative base with a non-integer exponent');
        return exact.inf((y.r.n & 1n) === 1n ? 1 : 0);
      }
      return exact.inf(0);
    }
    default: return exact.nan(`${name}(±∞) is undefined`);
  }
}

/** Short decimal display of an approximate value (only verified digits). */
export function approxText(x, maxDigits = 60) {
  const d = Math.max(1, Math.min(maxDigits, Math.floor(x.reliable)));
  return x.b.toSignificantDigits(d).toString();
}
