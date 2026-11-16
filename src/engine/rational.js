// Exact rational arithmetic on top of fraction.js (BigInt numerator/denominator),
// plus literal parsing and exact decimal formatting helpers.
//
// fraction.js stores a value as s * n / d with s in {1n, -1n} and n, d >= 0n BigInts,
// always reduced. Every + - * / on these values is exact, so they serve as the
// "true" reference values the IEEE simulations are compared against.

import Fraction from 'fraction.js';

export { Fraction };

export const ZERO = new Fraction(0);
export const ONE = new Fraction(1);

const TEN = 10n;

/** Number of bits of a non-negative BigInt (0 for 0). */
export function bitLength(x) {
  if (x === 0n) return 0;
  const hex = x.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0], 16)));
}

export function pow10(k) {
  return TEN ** BigInt(k);
}

/** Build a fraction from BigInt numerator/denominator (denominator > 0). */
export function frac(n, d = 1n) {
  return new Fraction(n, d);
}

/** m * 2^q as an exact fraction (m BigInt, q integer Number). */
export function dyadic(m, q, sign = 0) {
  if (m < 0n) { m = -m; sign ^= 1; }
  if (m === 0n) return rawFraction(1n, 0n, 1n);
  if (q >= 0) return rawFraction(sign ? -1n : 1n, m << BigInt(q), 1n);
  // Reduce by the common power of two without a general gcd (much faster for wide numbers).
  const tz = Math.min(trailingZeros(m), -q);
  return rawFraction(sign ? -1n : 1n, m >> BigInt(tz), 1n << BigInt(-q - tz));
}

export function trailingZeros(x) {
  if (x === 0n) return 0;
  return bitLength(x & -x) - 1;
}

/**
 * Build a fraction.js value from an already reduced s·n/d (n, d > 0, gcd(n, d) = 1)
 * without running fraction.js's gcd. Only used for dyadic numbers, whose
 * reduction is trivial.
 */
export function rawFraction(s, n, d) {
  const f = Object.create(Fraction.prototype);
  f.s = n === 0n ? 1n : s;
  f.n = n;
  f.d = d;
  return f;
}

/** Exact sum of two dyadic numbers given as signed BigInt m and exponent q. */
export function dyadicSum(m1, q1, m2, q2) {
  const q = Math.min(q1, q2);
  return dyadic((m1 << BigInt(q1 - q)) + (m2 << BigInt(q2 - q)), q);
}

export function isZero(r) {
  return r.n === 0n;
}

export function isNegative(r) {
  return r.s < 0n && r.n !== 0n;
}

// ---------------------------------------------------------------------------
// Exact values: finite rationals, plus the IEEE-like specials so that a user
// can still type "inf" and division by zero is reported instead of throwing.
// ---------------------------------------------------------------------------

/** @typedef {{kind:'finite', r:Fraction, negZero?:boolean} | {kind:'inf', sign:0|1} | {kind:'nan', reason?:string}} ExactVal */

export const exact = {
  finite: (r, negZero = false) => ({ kind: 'finite', r, negZero: negZero && r.n === 0n }),
  inf: (sign) => ({ kind: 'inf', sign }),
  nan: (reason) => ({ kind: 'nan', reason }),
};

function sgnOf(v) {
  if (v.kind === 'inf') return v.sign;
  if (v.kind === 'finite') return isNegative(v.r) ? 1 : 0;
  return 0;
}

export function exactNeg(a) {
  if (a.kind === 'nan') return a;
  if (a.kind === 'inf') return exact.inf(a.sign ^ 1);
  return exact.finite(a.r.neg(), a.r.n === 0n && !a.negZero);
}

export function exactAbs(a) {
  if (a.kind === 'nan') return a;
  if (a.kind === 'inf') return exact.inf(0);
  return exact.finite(a.r.abs());
}

export function exactAdd(a, b) {
  if (a.kind === 'nan') return a;
  if (b.kind === 'nan') return b;
  if (a.kind === 'inf' && b.kind === 'inf') {
    return a.sign === b.sign ? a : exact.nan('∞ − ∞ is undefined');
  }
  if (a.kind === 'inf') return a;
  if (b.kind === 'inf') return b;
  return exact.finite(a.r.add(b.r));
}

export function exactSub(a, b) {
  return exactAdd(a, exactNeg(b));
}

export function exactMul(a, b) {
  if (a.kind === 'nan') return a;
  if (b.kind === 'nan') return b;
  if (a.kind === 'inf' || b.kind === 'inf') {
    const other = a.kind === 'inf' ? b : a;
    if (other.kind === 'finite' && other.r.n === 0n) return exact.nan('0 · ∞ is undefined');
    return exact.inf(sgnOf(a) ^ sgnOf(b));
  }
  return exact.finite(a.r.mul(b.r));
}

export function exactDiv(a, b) {
  if (a.kind === 'nan') return a;
  if (b.kind === 'nan') return b;
  if (a.kind === 'inf' && b.kind === 'inf') return exact.nan('∞ / ∞ is undefined');
  if (a.kind === 'inf') return exact.inf(a.sign ^ sgnOf(b));
  if (b.kind === 'inf') return exact.finite(ZERO);
  if (b.r.n === 0n) return exact.nan('division by zero is undefined in ℝ');
  return exact.finite(a.r.div(b.r));
}

export function exactFma(a, b, c) {
  return exactAdd(exactMul(a, b), c);
}

// ---------------------------------------------------------------------------
// Literal parsing: decimal, scientific, hexadecimal float, p/q fractions,
// inf / nan. All conversions are exact.
// ---------------------------------------------------------------------------

const MAX_EXP = 1_000_000;

const DEC_RE = /^([+-]?)(\d+(?:_\d+)*)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const HEX_RE = /^([+-]?)0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/;
const FRAC_RE = /^\s*([^/]+?)\s*\/\s*([^/]+?)\s*$/;

/**
 * Parse a numeric literal into an exact value.
 * Accepts: 0.1, -2.5e-3, 1e400, .5, 0x1.8p-3, 1/3, -7/10, inf, -Infinity, nan.
 * Returns null when the text is not a number.
 * @returns {ExactVal|null}
 */
export function parseLiteral(text) {
  const s = String(text).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  const m0 = /^([+-]?)(inf|infinity|∞|nan)$/.exec(low);
  if (m0) {
    if (m0[2] === 'nan') return exact.nan('NaN entered by the user');
    return exact.inf(m0[1] === '-' ? 1 : 0);
  }
  const fm = FRAC_RE.exec(s);
  if (fm) {
    const a = parseLiteral(fm[1]);
    const b = parseLiteral(fm[2]);
    if (!a || !b) return null;
    return exactDiv(a, b);
  }
  let m = HEX_RE.exec(s);
  if (m && (m[2] || m[3])) {
    const [, sign, ip = '', fp = '', ex = '0'] = m;
    const e = parseInt(ex, 10);
    if (Math.abs(e) > MAX_EXP) return null;
    const mant = BigInt('0x' + (ip + fp || '0'));
    const r = dyadic(mant, e - 4 * fp.length, sign === '-' ? 1 : 0);
    return exact.finite(r, sign === '-' && mant === 0n);
  }
  m = DEC_RE.exec(s);
  if (m && (m[2] || m[3])) {
    const [, sign, ipRaw = '', fp = '', ex = '0'] = m;
    const ip = ipRaw.replace(/_/g, '');
    const e = parseInt(ex, 10) - fp.length;
    if (Math.abs(e) > MAX_EXP) return null;
    let mant = BigInt((ip + fp) || '0');
    if (sign === '-') mant = -mant;
    const r = e >= 0 ? new Fraction(mant * pow10(e), 1n) : new Fraction(mant, pow10(-e));
    return exact.finite(r, sign === '-' && mant === 0n);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Logarithms and decimal formatting
// ---------------------------------------------------------------------------

/** floor(log2(|r|)) for r != 0. */
export function floorLog2(r) {
  const n = r.n;
  const d = r.d;
  let e = bitLength(n) - bitLength(d);
  if (e >= 0 ? n < d << BigInt(e) : n << BigInt(-e) < d) e--;
  return e;
}

/** floor(log10(|r|)) for r != 0. */
export function floorLog10(r) {
  const n = r.n;
  const d = r.d;
  let k = n.toString().length - d.toString().length;
  if (k >= 0 ? n < d * pow10(k) : n * pow10(-k) < d) k--;
  return k;
}

/** Approximate log10(|r|) as a JS number (works far outside double range). */
export function log10Abs(r) {
  if (r.n === 0n) return -Infinity;
  return (log2Big(r.n) - log2Big(r.d)) * LOG10_2;
}

const LOG10_2 = 0.30102999566398120;

/** log2 of a positive BigInt from its top 60 bits (fast for huge numbers). */
export function log2Big(x) {
  const L = bitLength(x);
  const shift = Math.max(0, L - 60);
  return Math.log2(Number(x >> BigInt(shift))) + shift;
}

/**
 * Round |r| to `digits` significant decimal digits (round half to even).
 * Returns { negative, digits: 'ddddd', exp } meaning ±d.dddd × 10^exp.
 */
export function toSciParts(r, digits) {
  if (r.n === 0n) return { negative: r.s < 0n, digits: '0'.repeat(digits), exp: 0, zero: true };
  let k = floorLog10(r);
  const shift = digits - 1 - k;
  let num = r.n;
  let den = r.d;
  if (shift >= 0) num *= pow10(shift);
  else den *= pow10(-shift);
  let q = num / den;
  const rem = num - q * den;
  const c = 2n * rem - den;
  if (c > 0n || (c === 0n && (q & 1n) === 1n)) q += 1n;
  if (q === pow10(digits)) {
    q /= TEN;
    k += 1;
  }
  return { negative: r.s < 0n, digits: q.toString(), exp: k, exact: rem === 0n };
}

/** Format parts as a human string; plain notation for moderate exponents. */
export function formatSci(parts, { plainMin = -5, plainMax = 15, trimZeros = true } = {}) {
  let { digits } = parts;
  const { exp, negative } = parts;
  if (trimZeros) digits = digits.replace(/0+$/, '') || '0';
  const sign = negative ? '−' : '';
  if (parts.zero) return sign + '0';
  if (exp >= plainMin && exp <= plainMax) {
    if (exp >= 0) {
      const ip = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      const fp = digits.slice(exp + 1);
      return sign + ip + (fp ? '.' + fp : '');
    }
    return sign + '0.' + '0'.repeat(-exp - 1) + digits;
  }
  const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
  return `${sign}${mant}e${exp >= 0 ? '+' : '−'}${Math.abs(exp)}`;
}

/** Short display of a fraction with `digits` significant digits. */
export function fmtFrac(r, digits = 17, opts) {
  return formatSci(toSciParts(r, digits), opts);
}

/**
 * Exact decimal expansion. Terminating expansions are returned in full (up to
 * maxDigits); periodic ones get the repetend in parentheses, e.g. 0.1(6).
 * @returns {{text:string, terminating:boolean, truncated:boolean, period:number}}
 */
export function exactDecimal(r, maxDigits = 2000) {
  const neg = r.s < 0n && r.n !== 0n;
  const ip = r.n / r.d;
  let rem = r.n % r.d;
  const d = r.d;
  let head = (neg ? '−' : '') + ip.toString();
  if (rem === 0n) return { text: head, terminating: true, truncated: false, period: 0 };
  // Strip factors 2 and 5 to know the length of the non-periodic part.
  let d2 = d;
  let twos = 0;
  let fives = 0;
  while ((d2 & 1n) === 0n) { d2 >>= 1n; twos++; }
  while (d2 % 5n === 0n) { d2 /= 5n; fives++; }
  const pre = Math.max(twos, fives);
  const terminating = d2 === 1n;
  const out = [];
  const limit = maxDigits;
  for (let i = 0; i < pre && i < limit; i++) {
    rem *= TEN;
    out.push((rem / d).toString());
    rem %= d;
  }
  if (terminating || pre >= limit) {
    return { text: head + '.' + out.join(''), terminating, truncated: !terminating || pre > limit, period: 0 };
  }
  // Periodic part: the period is the multiplicative order of 10 mod d2;
  // generate digits until the remainder repeats (or the limit is hit).
  const start = rem;
  const rep = [];
  let truncated = false;
  do {
    if (out.length + rep.length >= limit) { truncated = true; break; }
    rem *= TEN;
    rep.push((rem / d).toString());
    rem %= d;
  } while (rem !== start);
  if (truncated) {
    return { text: head + '.' + out.join('') + rep.join('') + '…', terminating: false, truncated: true, period: -1 };
  }
  return { text: `${head}.${out.join('')}(${rep.join('')})`, terminating: false, truncated: false, period: rep.length };
}

/** Plain decimal string of a dyadic rational m*2^q (always terminating). */
export function dyadicDecimal(m, q, sign = 0) {
  return exactDecimal(dyadic(m, q, sign), 100000).text;
}
