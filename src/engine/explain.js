// Explains, in language-neutral codes, WHY a simulated value differs from the
// true value. The UI turns the codes into Czech or English sentences.
//
// For every step the total error is split into two parts:
//   total     = computed − true
//   inherited = exactOp − true      (the operands were already wrong)
//   new       = computed − exactOp  (the rounding committed in this step)
// and the operation is classified (representation of a literal, rounding of a
// too-long result, cancellation that amplifies inherited errors, absorption of
// a small addend, overflow/underflow, special values).
//
// Every sentence must be true for the case at hand: a step that ends up equal
// to the true value is never said to have lost anything (its operand errors
// cancelled: luck, unless both operands are the same computation, as in x − x,
// where it is certain), a gain of digits is called luck only when the
// first-order error bound cannot explain it, and texts about rounding name the
// active rounding mode instead of assuming round-to-nearest.

import { bitLength, floorLog2, floorLog10, fmtFrac, log10Abs, dyadic, dyadicSub, frac, pow10, exactDecimal, toSciParts } from './rational.js';
import {
  fpToFraction, shortestDecimal, exactShort, roundFraction, fpOrder, fpEquals, fpNeg, isSubnormal, exponentOf, maxFinite, minFinite, CASTS, FORMATS,
} from './ieee.js';
import { exactOrder } from './evaluator.js';
import { COMPARISONS } from './parser.js';
import {
  compareToExact, localError, ulpAround, stepsBetween, correctDigits, fullDigits, stepDigits, qualityOf, LOG10_2,
  NOTABLE_DIGITS, CANCEL_MIN_LOG10_KAPPA, CATASTROPHIC_LOG10_KAPPA, GAIN_EXPLAINED_MARGIN,
  COND_REPORT, COND_CAUSE, COND_DAMP, DOMINANCE_DIGITS,
} from './metrics.js';
import { FUNCTION_NAMES, MAX_DEC_EXP } from './real.js';

const FUNCS = new Set(FUNCTION_NAMES);
const CMP = new Set(COMPARISONS);

/** Number as a JS double (also for fractions with huge numerator/denominator). */
function toNum(v) {
  if (v.kind === 'zero') return 0;
  if (v.kind === 'inf') return v.sign ? -Infinity : Infinity;
  if (v.kind !== 'finite') return NaN;
  const p = toSciParts(fpToFraction(v), 17);
  return Number(`${p.negative ? '-' : ''}${p.digits[0]}.${p.digits.slice(1)}e${p.exp}`);
}

/**
 * Relative condition number |x·f'(x)/f(x)| of a function at the (computed)
 * argument: how much a relative error in the argument is amplified.
 * For 2-argument pow(x, y), when `opCmp` is supplied only the arguments that
 * actually carry error are considered (so pow(inexact, 0.5) has κ = 0.5, not |0.5·ln|x||).
 */
export function conditionNumber(fn, args, opCmp = null) {
  const x = toNum(args[0]);
  if (!Number.isFinite(x)) return null;
  switch (fn) {
    case 'sqrt': return 0.5;
    case 'exp': return Math.abs(x);
    case 'ln': case 'log10': return 1 / Math.abs(Math.log(x));
    case 'sin': return Math.abs((x * Math.cos(x)) / Math.sin(x));
    case 'cos': return Math.abs((x * Math.sin(x)) / Math.cos(x));
    case 'tan': return Math.abs(x / (Math.sin(x) * Math.cos(x)));
    case 'atan': return x === 0 ? 1 : Math.abs(x / ((1 + x * x) * Math.atan(x)));
    case 'pow': {
      const y = toNum(args[1]);
      if (!Number.isFinite(y)) return null;
      const kx = Math.abs(y);
      const ky = Math.abs(y * Math.log(Math.abs(x)));
      if (opCmp) {
        const logRel = (c) => (c.status === 'approx' && c.rel ? log10Abs(c.rel) : c.status === 'mismatch' ? Infinity : -Infinity);
        const lx = logRel(opCmp[0]);
        const ly = logRel(opCmp[1]);
        if (lx > -Infinity && ly === -Infinity) return kx;
        if (lx === -Infinity && ly > -Infinity) return ky;
        if (Number.isFinite(lx) && Number.isFinite(ly)) {
          const m = Math.max(lx, ly);
          return kx * Math.pow(10, lx - m) + ky * Math.pow(10, ly - m);
        }
      }
      return Math.max(kx, ky);
    }
    default: return null;
  }
}

const num = (r, d = 3) => (r == null ? '—' : r.n === 0n ? '0' : fmtFrac(r, d, { plainMin: -3, plainMax: 5 }));
const dig = (x) => (x === Infinity ? '∞' : x.toFixed(1));
const key = (k, params) => (params ? { key: k, params } : { key: k });
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');
const shortText = (s) => (s.text.length > 30 ? '…' + s.text.slice(-28) : s.text);

const isNum = (v) => v.kind === 'finite' || v.kind === 'zero';

/** Number of significant bits of a rational (Infinity if its binary expansion is periodic). */
export function significantBits(r) {
  if (r.n === 0n) return 0;
  const d = r.d;
  if ((d & (d - 1n)) !== 0n) return Infinity;
  let n = r.n;
  let tz = 0;
  while ((n & 1n) === 0n) { n >>= 1n; tz++; }
  return bitLength(r.n) - tz;
}

/** Number of significant base-10 digits of a rational (Infinity if its decimal expansion is periodic). */
export function significantDecimalDigits(r) {
  if (r.n === 0n) return 0;
  let d = r.d;
  let a = 0;
  let b = 0;
  while ((d & 1n) === 0n) { d >>= 1n; a++; }
  while (d % 5n === 0n) { d /= 5n; b++; }
  if (d !== 1n) return Infinity;
  let n = r.n;
  if (a > b) n *= 5n ** BigInt(a - b);
  else if (b > a) n <<= BigInt(b - a);
  while (n % 10n === 0n) n /= 10n;
  return n.toString().length;
}

/** Prime factors (other than 2) of the denominator, for binary explanations. */
export function oddDenominatorFactors(r) {
  let d = r.d;
  while ((d & 1n) === 0n) d >>= 1n;
  const out = [];
  for (let p = 3n; p < 200n && d > 1n; p += 2n) {
    if (d % p === 0n) {
      out.push(p.toString());
      while (d % p === 0n) d /= p;
    }
  }
  if (d > 1n) out.push('…');
  return out;
}

/** Prime factors other than 2 and 5 of the denominator, for base-10 explanations. */
export function nonDecimalFactors(r) {
  let d = r.d;
  while ((d & 1n) === 0n) d >>= 1n;
  while (d % 5n === 0n) d /= 5n;
  const out = [];
  for (let p = 3n; p < 200n && d > 1n; p += 2n) {
    if (p === 5n) continue;
    if (d % p === 0n) {
      out.push(p.toString());
      while (d % p === 0n) d /= p;
    }
  }
  if (d > 1n) out.push('…');
  return out;
}

/** The non-radix denominator factors as a translatable phrase. */
function factorsParam(r, radix = 2) {
  const f = radix === 10 ? nonDecimalFactors(r) : oddDenominatorFactors(r);
  if (f.length === 1 && f[0] === '…') return key('factor.large');
  return key(f.length === 1 ? 'factor.one' : 'factor.many', { list: f.join(', ') });
}

/** Base-10 expansion with repeating period in parentheses, e.g. 1/3 → 0.(3)₁₀. */
export function decimalText(r, maxDigits = 40) {
  if (r.n === 0n) return '0₁₀';
  const E = floorLog10(r.abs());
  if (E >= -6 && E <= 12) return `${exactDecimal(r, maxDigits).text}₁₀`;
  const scaled = E >= 0 ? r.div(frac(pow10(E), 1n)) : r.mul(frac(pow10(-E), 1n));
  return `${exactDecimal(scaled, maxDigits).text}₁₀ × 10${sup(E)}`;
}

/**
 * Binary expansion with the period in parentheses, e.g. 0.1 → 0.0(0011)₂.
 * Long expansions are shortened.
 */
export function binaryExpansion(r, maxDigits = 80) {
  const neg = r.s < 0n && r.n !== 0n;
  const ip = r.n / r.d;
  let rem = r.n % r.d;
  const d = r.d;
  const head = (neg ? '−' : '') + ip.toString(2);
  if (rem === 0n) return head;
  const seen = new Map();
  const digits = [];
  while (rem !== 0n && !seen.has(rem) && digits.length < maxDigits) {
    seen.set(rem, digits.length);
    rem *= 2n;
    digits.push(rem >= d ? '1' : '0');
    if (rem >= d) rem -= d;
  }
  if (rem === 0n) return `${head}.${digits.join('')}`;
  if (seen.has(rem)) {
    const at = seen.get(rem);
    const pre = digits.slice(0, at).join('');
    let per = digits.slice(at).join('');
    if (per.length > 40) per = per.slice(0, 40) + '…';
    return `${head}.${pre}(${per})`;
  }
  return `${head}.${digits.join('')}…`;
}

/**
 * Binary expansions are written positionally only for 2^−8 ≤ |r| < 2^25; far
 * from 1 a positional expansion would show only leading zeros (1e-40) or a
 * long integer part, so the binary scientific form 1.0001…₂ × 2⁻¹³³ is used
 * (multiplying by a power of two only shifts the digits, so the repeating
 * block is the same).
 */
const PLAIN_BIN_MIN_EXP = -8;
const PLAIN_BIN_MAX_EXP = 24;

/** Binary expansion for the explanation texts, including the ₂ mark (see binaryExpansion). */
export function binaryText(r, maxDigits = 80) {
  if (r.n === 0n) return '0₂';
  const E = floorLog2(r.abs());
  if (E >= PLAIN_BIN_MIN_EXP && E <= PLAIN_BIN_MAX_EXP) return `${binaryExpansion(r, maxDigits)}₂`;
  return `${binaryExpansion(r.mul(dyadic(1n, -E)), maxDigits)}₂ × 2${sup(E)}`;
}

/** "0.1 = 1/10": the decimal input together with the fraction the explanation is about. */
function withFraction(src, r) {
  const f = r.toFraction().replace('-', '−');
  if (!f.includes('/') || f.length > 24 || f === src) return src;
  return `${src} = ${f}`;
}

/**
 * Why did a tiny value become 0? Under round-to-nearest because it is below
 * half of the smallest subnormal (or exactly half: a tie that ties-to-even
 * sends to the even neighbour 0); under directed rounding because it is below
 * the smallest subnormal and the mode rounds toward 0.
 */
function isTie(R, fmt) {
  return fmt.radix === 10 ? (R.guard === 5 && !R.sticky) : (R.guard === 1 && !R.sticky);
}

function flushWhy(R, mode, fmt) {
  if (fmt.fixed) {
    const min = num(fmt.step);
    if (mode === 'RNE' || mode === 'RNA') return key(isTie(R, fmt) ? 'fxp.flushTie' : 'fxp.flushHalf', { min });
    return key('fxp.flushDirected', { min, mode: key('mode.' + mode) });
  }
  const min = fmt.family === 'decfloat' ? num(frac(1n, pow10(-fmt.qmin))) : num(dyadic(1n, fmt.emin - fmt.p + 1));
  if (mode === 'RNE' || mode === 'RNA') return key(isTie(R, fmt) ? 'flush.tie' : 'flush.half', { min });
  return key('flush.directed', { min, mode: key('mode.' + mode) });
}

function subnormalParams(v, fmt) {
  if (fmt.family === 'decfloat') {
    return { minNormal: num(frac(1n, pow10(-fmt.emin))), avail: v.m.toString().length, q: num(frac(1n, pow10(-fmt.qmin))), p: fmt.p };
  }
  return { minNormal: num(dyadic(1n, fmt.emin)), avail: bitLength(v.m), q: num(dyadic(1n, fmt.emin - fmt.p + 1)), p: fmt.p };
}

/**
 * Where was the error of a step created? Follows the error backwards: at each
 * step the error versus the true value is split into the inherited part
 * (exactOp − true) and the new rounding (computed − exactOp). While the
 * inherited part dominates (≥ 10×, DOMINANCE_DIGITS) the step only passed the
 * error on, or amplified it (a cancellation), so the search continues in the
 * operand whose error contributes most to first order (|∂f/∂xᵢ| × its absolute
 * error). It stops at the first step whose own rounding is a substantial part
 * of its error (absorption, rounding, underflow) or at an input or literal
 * (representation error).
 * @returns {object|null} that step, or null when the step has no error or the
 *   trace is not possible (∞ / NaN, very long chains)
 */
export function errorSource(step, steps, fmt, maxDepth = 400) {
  let cur = step;
  for (let depth = 0; depth < maxDepth; depth++) {
    const res = cur.fmt[fmt.id];
    const X = cur.exact;
    if (X.kind !== 'finite' || !isNum(res.value)) return null;
    if (fpToFraction(res.value).equals(X.r)) return null;
    if (cur.kind !== 'op' || res.exactOp.kind !== 'finite') return cur;
    const prop = dyadicSub(res.exactOp.r, X.r);
    const nw = dyadicSub(fpToFraction(res.value), res.exactOp.r);
    if (prop.n === 0n) return cur;
    if (nw.n !== 0n && log10Abs(nw) > log10Abs(prop) - DOMINANCE_DIGITS) return cur;
    if (cur.op === '+' || cur.op === '-') {
      const hidden = cancelledSource(cur, steps, fmt, prop);
      if (hidden) return hidden;
    }
    const next = largestContributor(cur, steps, fmt);
    if (!next) return cur;
    cur = next;
  }
  return null;
}

/**
 * a ± b whose operands carry large errors that cancel each other (a = 10²⁰ and
 * b + c = −10²⁰ + 1 in float share the representation error of 10²⁰): the
 * inherited error that remains is far smaller than either operand's error, so
 * it does not come from the operand with the largest error. It is the own
 * rounding of an operand step whose new error matches the remainder (within
 * DOMINANCE_DIGITS), here the absorption of c in b + c. Null when the
 * operands' errors do not cancel or no operand step explains the remainder.
 */
function cancelledSource(step, steps, fmt, prop) {
  const ops = step.operands.map((id) => steps[id]);
  const errs = ops.map((o) => {
    const v = o.fmt[fmt.id].value;
    return isNum(v) && o.exact.kind === 'finite' ? dyadicSub(fpToFraction(v), o.exact.r) : null;
  });
  if (errs.some((e) => e == null)) return null;
  const lp = log10Abs(prop);
  const largest = Math.max(...errs.map((e) => (e.n === 0n ? -Infinity : log10Abs(e))));
  if (largest <= lp + DOMINANCE_DIGITS) return null;
  let best = null;
  let bestGap = Infinity;
  for (const o of ops) {
    const r = o.fmt[fmt.id];
    if (o.kind !== 'op' || r.exactOp.kind !== 'finite' || !isNum(r.value)) continue;
    const own = fpToFraction(r.value).sub(r.exactOp.r);
    if (own.n === 0n) continue;
    const gap = Math.abs(log10Abs(own) - lp);
    if (gap <= DOMINANCE_DIGITS && gap < bestGap) { best = o; bestGap = gap; }
  }
  return best;
}

/** The operand whose error contributes most (first order) to the inherited error of a step. */
function largestContributor(step, steps, fmt) {
  const ops = step.operands.map((id) => steps[id]);
  const vals = ops.map((o) => o.fmt[fmt.id].value);
  if (!vals.every(isNum)) return null;
  const fr = vals.map((v) => fpToFraction(v));
  const lg = (r) => log10Abs(r);
  let best = null;
  let bestW = -Infinity;
  ops.forEach((o, i) => {
    if (o.exact.kind !== 'finite') return;
    const e = dyadicSub(fr[i], o.exact.r);
    if (e.n === 0n) return;
    let w = lg(e);
    if (step.op === '*') w += lg(fr[1 - i]);
    else if (step.op === '/') w += i === 0 ? -lg(fr[1]) : lg(fr[0]) - 2 * lg(fr[1]);
    else if (step.op === 'fma' && i < 2) w += lg(fr[1 - i]);
    else if (FUNCS.has(step.op)) w -= lg(o.exact.r); // relative error of the argument
    if (w > bestW) { bestW = w; best = o; }
  });
  return best;
}

/**
 * Are two steps the same computation, so that they hold the same stored value
 * in every format and carry the identical error? True for the same step, for
 * two conversions of the same exact value (a literal and an input of the same
 * decimal, rounded the same way), and for the same operation on operands that
 * are the same computation (+ and · also with swapped operands). Then a − b is
 * 0 and a == b is true for every input: by construction, not by luck. (Float's
 * 0.1 + 0.2 − 0.3 is different: two unrelated values happen to round alike.)
 */
export function sameComputation(a, b, steps, memo = new Map(), depth = 0) {
  if (a.id === b.id) return true;
  if (depth > 60) return false;
  const k = a.id < b.id ? `${a.id},${b.id}` : `${b.id},${a.id}`;
  if (memo.has(k)) return memo.get(k);
  let same = false;
  if (a.kind !== 'op' || b.kind !== 'op') {
    same = a.kind !== 'op' && b.kind !== 'op' && (a.constant
      ? a.constant === b.constant
      : !b.constant && a.exact.kind === 'finite' && b.exact.kind === 'finite' && !a.exact.approx && !b.exact.approx && a.exact.r.equals(b.exact.r));
  } else if (a.op === b.op && a.operands.length === b.operands.length) {
    const A = a.operands.map((id) => steps[id]);
    const B = b.operands.map((id) => steps[id]);
    const eq = (i, j) => sameComputation(A[i], B[j], steps, memo, depth + 1);
    same = A.every((_, i) => eq(i, i)) || ((a.op === '+' || a.op === '*') && eq(0, 1) && eq(1, 0));
  }
  memo.set(k, same);
  return same;
}

/** A subtraction or division of two operands that are the same computation (x − x, x / x): exact for every valid input. */
export function sameOperands(step, steps) {
  return (step.op === '-' || step.op === '/') && step.operands.length === 2
    && sameComputation(steps[step.operands[0]], steps[step.operands[1]], steps);
}

/**
 * Multiplication by an exact zero (0·x, x·0) or exact zero divided by a finite
 * nonzero value (0/x): the result is 0 for every finite input — exact by
 * construction, not by lucky error cancellation.
 */
function zeroAbsorb(step, steps, fmt) {
  if (step.kind !== 'op' || step.operands.length !== 2) return false;
  const [a, b] = step.operands.map((id) => steps[id]);
  const exactZero = (s) => !s.exact.beyond && s.exact.kind === 'finite' && s.exact.r.n === 0n
    && (!fmt || s.fmt[fmt.id].value.kind === 'zero');
  const finiteNonZero = (s) => s.exact.kind === 'finite' && (s.exact.r.n !== 0n || s.exact.beyond)
    && (!fmt || s.fmt[fmt.id].value.kind === 'finite');
  if (step.op === '*') {
    return (exactZero(a) && (!fmt ? b.exact.kind === 'finite' : isNum(b.fmt[fmt.id].value)))
      || (exactZero(b) && (!fmt ? a.exact.kind === 'finite' : isNum(a.fmt[fmt.id].value)));
  }
  if (step.op === '/') return exactZero(a) && finiteNonZero(b);
  return false;
}

/** Rounding modes that treat both signs alike: RN(−x) = −RN(x), so opposite inputs get opposite errors. */
const SYMMETRIC_MODES = new Set(['RNE', 'RNA', 'RZ']);

/**
 * a + b where b holds the same number as a with the opposite sign (10²⁰ + (−10²⁰)):
 * two conversions of opposite exact values, or a and −(the same computation).
 * In a mode that treats both signs alike their errors are exactly opposite, so
 * the sum is exactly 0 for every such input. (RU / RD round the two signs
 * differently, so there it is not by construction.)
 */
export function oppositeOperands(step, steps, mode) {
  if (step.op !== '+' || step.operands.length !== 2 || !SYMMETRIC_MODES.has(mode)) return false;
  const [a, b] = step.operands.map((id) => steps[id]);
  const leaf = (s) => s.kind !== 'op' && !s.constant && s.exact.kind === 'finite' && !s.exact.approx;
  if (leaf(a) && leaf(b)) return a.exact.r.n !== 0n && a.exact.r.equals(b.exact.r.neg());
  const negOf = (x, y) => x.kind === 'op' && x.op === 'neg' && sameComputation(steps[x.operands[0]], y, steps);
  return negOf(a, b) || negOf(b, a);
}

/**
 * Is an exact result with inexact operands exact by construction rather than by
 * luck? x − x, x / x, 0·x, 0/x, a + (−a) in a symmetric mode, and comparisons
 * of the same computation (c == c) cannot come out otherwise.
 */
export function exactByConstruction(step, steps, mode, fmt = null) {
  if (step.kind !== 'op' || step.operands.length !== 2) return false;
  if (sameOperands(step, steps) || oppositeOperands(step, steps, mode) || zeroAbsorb(step, steps, fmt)) return true;
  return CMP.has(step.op) && sameComputation(steps[step.operands[0]], steps[step.operands[1]], steps);
}

/**
 * Analyse one step in one format.
 * @param {object} [opts] {trace:false} skips tracing an error back to its
 *   source (used when only the cause chip is needed)
 * @returns {{cause:{code:string, params:object, tone:string}, items:{code:string, params:object, tone:string}[], parts?:object}}
 */
export function explainStep(step, steps, fmt, mode, opts = {}) {
  const res = step.fmt[fmt.id];
  const v = res.value;
  const X = step.exact;
  const R = res.round;
  const items = [];
  const push = (code, params = {}, tone = 'info') => items.push({ code, params, tone });
  const full = fullDigits(fmt);
  const cmp = compareToExact(v, X, fmt);
  let cause = null;
  const setCause = (code, params = {}, tone = 'info') => { if (!cause) cause = { code, params, tone }; };
  // Comparisons already made (this step, its operands), reused by the one digits-lost figure.
  const cmpById = new Map([[step.id, cmp]]);
  let sdCache = null;
  const digitsOfStep = () => sdCache || (sdCache = stepDigits(step, steps, fmt,
    (s) => correctDigits(cmpById.get(s.id) || compareToExact(s.fmt[fmt.id].value, s.exact, fmt), fmt).shown));
  // Set for operations: does the first-order error bound explain a gain of digits?
  let gainExplained = null;
  let absorbed = false;

  // ---- A true value beyond the decimal range of the reference ---------------
  if (X.beyond) push(X.kind === 'inf' ? 'ref.beyondHuge' : X.kind === 'nan' ? 'ref.beyondUnknown' : 'ref.beyondTiny', { max: MAX_DEC_EXP }, 'warn');

  // ---- Comparison and cast: their own explanations --------------------------
  if (CMP.has(step.op)) return explainComparison();
  if (CASTS[step.op] && isNum(steps[step.operands[0]].fmt[fmt.id].value)) return explainCast();

  // ---- Fixed-point trap / non-finite handling (no ∞ or NaN in hardware) ----
  const isDec = fmt.family === 'decfloat';
  const isFix = !!fmt.fixed;
  const fxpOverflow = !!(isFix && R && R.overflow);
  const pushFxpOverflow = () => {
    const min = shortestDecimal(minFinite(fmt), fmt);
    const max = shortestDecimal(maxFinite(fmt), fmt);
    const result = shortestDecimal(v, fmt);
    if (R.overflowKind === 'wrap') {
      push('fxp.wrap', { min, max, bits: fmt.totalBits, result }, 'bad');
      setCause('wrap', {}, 'bad');
    } else {
      push('fxp.saturate', { min, max, result }, 'bad');
      setCause('saturate', {}, 'bad');
    }
  };

  if (isFix && v.kind === 'nan') {
    if (step.kind !== 'op') {
      push('fxp.noSpecial', {}, 'bad');
      setCause('invalid', {}, 'bad');
      return { cause, items, cmp };
    }
    if (res.flags.divByZero) {
      if (X.kind === 'finite') {
        push('fxp.divZeroFalse', {}, 'bad');
        setCause('zeroDivisor', {}, 'bad');
      } else {
        push('fxp.divZero', {}, 'bad');
        setCause('divzero', {}, 'bad');
      }
    } else if (res.flags.invalid) {
      push('fxp.invalid', { what: res.exactOp.reason || '' }, 'bad');
      setCause('invalid', {}, 'bad');
    } else {
      push('fxp.trapPropagates', {}, 'bad');
      setCause('invalid', {}, 'bad');
    }
    return { cause, items, cmp };
  }

  // ---- Special values (floating-point) ------------------------------------
  if (!isFix) {
    if (res.flags.invalid) {
      push('sp.invalid', { what: res.exactOp.reason || '' }, 'bad');
      setCause('invalid', {}, 'bad');
    }
    if (res.flags.divByZero) {
      if (X.kind === 'finite') {
        // The zero is 0 only in this format (underflow or cancellation to 0 earlier): the true value is finite.
        push('sp.divzeroFalse', {}, 'bad');
        setCause('zeroDivisor', {}, 'bad');
      } else {
        push('sp.divzero', {}, 'bad');
        setCause('divzero', {}, 'bad');
      }
    }
    if (res.flags.overflow) {
      push('sp.overflow', { max: exactShort({ kind: 'finite', r: fpToFraction(maxFinite(fmt)) }, 5), result: shortestDecimal(v, fmt) }, 'bad');
      setCause('overflow', {}, 'bad');
    }
    if (!isNum(v) && X.kind === 'finite' && !res.flags.overflow && !res.flags.invalid && !res.flags.divByZero) {
      push(v.kind === 'inf' ? 'sp.infInherited' : 'sp.nanInherited', {}, 'bad');
      setCause(v.kind === 'inf' ? 'overflow' : 'invalid', {}, 'bad');
    }
    if (X.kind === 'nan' && !X.beyond && isNum(v)) {
      push('sp.exactUndefined', {}, 'bad');
      setCause('invalid', {}, 'bad');
    }
    if (!cause && !isNum(v) && step.kind === 'op') {
      if (X.beyond) {
        setCause('prop', {}, 'warn');
      } else if (v.kind === 'nan') {
        push('sp.nanPropagates', {}, 'warn');
        setCause('invalid', {}, 'warn');
      } else {
        push('sp.infPropagates', {}, 'info');
        setCause('exact', {}, 'good');
      }
    }
    if (cause && !isNum(v)) return { cause, items, cmp };
  }

  // ---- Conversion of an input or literal ---------------------------------
  if (step.kind !== 'op') {
    if (X.kind !== 'finite') {
      push('conv.special', {}, 'info');
      return { cause: cause || { code: 'exact', params: {}, tone: 'good' }, items, cmp };
    }
    const src = step.source ?? step.text;
    if (isFix) {
      if (!R || !R.inexact) {
        if (X.r.n === 0n) push('conv.zero', { value: src }, 'good');
        else push('fxp.convExact', { value: src, step: num(fmt.step) }, 'good');
        setCause('exact', {}, 'good');
        return { cause, items, cmp };
      }
      if (fxpOverflow) {
        pushFxpOverflow();
        finalVerdict();
        return { cause, items, cmp };
      }
      if (R.tiny && v.kind === 'zero') {
        push('fxp.flushZero', { step: num(fmt.step), why: flushWhy(R, mode, fmt) }, 'bad');
        setCause('underflow', {}, 'warn');
        finalVerdict();
        return { cause, items, cmp };
      }
      const sigCount = fmt.radix === 10 ? significantDecimalDigits(X.r) : significantBits(X.r);
      if (X.approx) {
        push('fxp.convIrrational', { value: src, step: num(fmt.step) }, 'warn');
      } else if (sigCount === Infinity) {
        if (fmt.radix === 10) {
          const dec = decimalText(X.r.abs());
          push('fxp.convPeriodicDec', {
            value: withFraction(src, X.r), dec,
            note: key(dec.includes('(') ? 'expansion.periodDec' : 'expansion.longDec'),
            factors: factorsParam(X.r, 10), scale: fmt.scaleDigits,
          }, 'warn');
        } else {
          const bin = binaryText(X.r.abs());
          push('fxp.convPeriodicBin', {
            value: withFraction(src, X.r), bin,
            note: key(bin.includes('(') ? 'expansion.period' : 'expansion.long'),
            factors: factorsParam(X.r, 2), frac: fmt.fracBits,
          }, 'warn');
        }
      } else {
        push('fxp.convTooFine', { value: src, step: num(fmt.step) }, 'warn');
      }
      roundingItems(res, fmt, mode, push);
      setCause('repr', {}, 'warn');
      finalVerdict();
      return { cause, items, cmp };
    }
    if (isDec) {
      const digits = significantDecimalDigits(X.r);
      if (!R || !R.inexact) {
        if (X.r.n === 0n) push(v.kind === 'zero' && v.sign ? 'conv.negZero' : 'conv.zero', { value: src }, 'good');
        else push('conv.exactDec', { value: src, digits, p: fmt.p, coef: v.m.toString(), q: v.q }, 'good');
        setCause('exact', {}, 'good');
      } else {
        if (X.approx) {
          push('conv.irrationalDec', { value: src, p: fmt.p }, 'warn');
        } else if (digits === Infinity) {
          const dec = decimalText(X.r.abs());
          push('conv.periodicDec', {
            value: withFraction(src, X.r), dec,
            note: key(dec.includes('(') ? 'expansion.periodDec' : 'expansion.longDec'),
            factors: factorsParam(X.r, 10),
            keep: R.tiny ? key('conv.keepTiny') : key('conv.keepDec', { p: fmt.p }),
          }, 'warn');
        } else if (!R.tiny && digits > fmt.p) {
          push('conv.tooManyDigits', { value: src, digits, p: fmt.p, cut: digits - fmt.p }, 'warn');
        }
        if (R.tiny) {
          if (v.kind === 'zero') push('conv.flushZero', { why: flushWhy(R, mode, fmt) }, 'bad');
          else if (isSubnormal(v, fmt)) push('conv.subnormalDec', subnormalParams(v, fmt), 'warn');
          else push('conv.roundToMinNormalDec', { minNormal: num(frac(1n, pow10(-fmt.emin))), p: fmt.p }, 'warn');
          setCause('underflow', {}, 'warn');
        }
        roundingItems(res, fmt, mode, push);
        setCause('repr', {}, 'warn');
        finalVerdict();
      }
      return { cause, items, cmp };
    }
    const bits = significantBits(X.r);
    if (!R || !R.inexact) {
      if (X.r.n === 0n) push(v.kind === 'zero' && v.sign ? 'conv.negZero' : 'conv.zero', { value: src }, 'good');
      else push('conv.exact', { value: src, bits, p: fmt.p }, 'good');
      setCause('exact', {}, 'good');
    } else {
      if (X.approx) {
        push('conv.irrational', { value: src, p: fmt.p }, 'warn');
      } else if (bits === Infinity) {
        const bin = binaryText(X.r.abs());
        push('conv.periodic', {
          value: withFraction(src, X.r),
          bin,
          note: key(bin.includes('(') ? 'expansion.period' : 'expansion.long'),
          factors: factorsParam(X.r, 2),
          keep: R.tiny ? key('conv.keepTiny') : key('conv.keep', { p: fmt.p }),
        }, 'warn');
      } else if (!R.tiny && bits > fmt.p) {
        push('conv.tooManyBits', { value: src, bits, p: fmt.p, cut: bits - fmt.p }, 'warn');
      }
      if (R.tiny) {
        if (v.kind === 'zero') push('conv.flushZero', { why: flushWhy(R, mode, fmt) }, 'bad');
        else if (isSubnormal(v, fmt)) push('conv.subnormal', subnormalParams(v, fmt), 'warn');
        else push('conv.roundToMinNormal', { minNormal: num(dyadic(1n, fmt.emin)), p: fmt.p }, 'warn');
        setCause('underflow', {}, 'warn');
      }
      roundingItems(res, fmt, mode, push);
      setCause('repr', {}, 'warn');
      finalVerdict();
    }
    return { cause, items, cmp };
  }

  // ---- Operation ----------------------------------------------------------
  const ops = step.operands.map((id) => steps[id]);
  const opVals = ops.map((o) => o.fmt[fmt.id].value);
  const opCmp = ops.map((o) => compareToExact(o.fmt[fmt.id].value, o.exact, fmt));
  ops.forEach((o, i) => cmpById.set(o.id, opCmp[i]));
  const opDigits = opCmp.map((c) => correctDigits(c, fmt).shown ?? 0);
  const inherited = opCmp.some((c) => c.status === 'approx' || c.status === 'mismatch');
  const newRounding = !!(R && R.inexact);
  const exactOp = res.exactOp.kind === 'finite' ? res.exactOp.r : null;
  const label = (i) => `#${ops[i].id}`;
  // The operands were wrong, yet the result equals the true value: their errors cancelled.
  // That is luck, unless both operands are the same computation (x − x, x / x), opposite
  // values added, or an exact zero factor (0·x, 0/x): then it is certain by construction.
  const cancelled = inherited && cmp.status === 'exact';
  const zeroFactor = cancelled && zeroAbsorb(step, steps, fmt);
  const opposite = cancelled && oppositeOperands(step, steps, mode);
  const same = cancelled && (opposite || sameOperands(step, steps));
  const lucky = cancelled && !same && !zeroFactor;
  const flushedZero = !!(newRounding && R.tiny && v.kind === 'zero');
  let fnKappa = null;
  let cancelReported = false;

  /** Name the step where the error of this (exact, amplifying) step was created. */
  const pushSource = () => {
    if (opts.trace === false) return;
    const src = errorSource(step, steps, fmt);
    if (!src || src.id === step.id) return;
    const sc = explainStep(src, steps, fmt, mode, { trace: false }).cause;
    push('op.lostAt', { id: src.id, text: shortText(src), cause: key('cause.' + sc.code, sc.params) }, 'info');
  };

  if (FUNCS.has(step.op)) {
    const fn = step.op;
    const kappa = conditionNumber(fn, opVals, opCmp);
    if (kappa != null && Number.isFinite(kappa)) {
      fnKappa = kappa;
      const params = { fn, kappa: kappa >= 1e4 || kappa < 1e-3 ? kappa.toExponential(1) : kappa.toPrecision(3) };
      if (kappa >= COND_REPORT) {
        push(inherited ? 'fn.cond' : 'fn.condNoInput', params, inherited && kappa >= COND_CAUSE ? 'bad' : 'info');
        if (inherited && kappa >= COND_CAUSE) {
          setCause('cond', { kappa: kappa.toExponential(0).replace('e+', 'e') }, 'bad');
          pushSource();
        }
      } else if (inherited && kappa < COND_DAMP) {
        push('fn.condDamp', params, 'good');
      }
    }
    if (isFix && !fxpOverflow && !flushedZero) {
      push('fxp.fnIdeal', { fn, step: num(fmt.step) }, 'info');
    } else if (res.exactOp.approx && !fxpOverflow && !flushedZero) {
      const code = fn === 'sqrt' ? 'fn.sqrt' : fn === 'pow' ? 'fn.pow' : fn === 'log10' ? 'fn.log10' : 'fn.transcendental';
      push(code, { fn, r0: fn === 'ln' ? '1' : '0' }, 'info');
      if (res.uncertain) push('fn.uncertain', {}, 'warn');
    } else if (!newRounding && exactOp && !res.flags.invalid && !res.flags.divByZero) {
      push('fn.exact', { fn }, 'good');
    }
  }

  if (step.op === 'neg' || step.op === 'abs') {
    if (fxpOverflow) {
      push('fxp.negMinOverflow', { min: shortestDecimal(minFinite(fmt), fmt) }, 'bad');
      pushFxpOverflow();
      if (inherited) push('prop.operands', { list: describeOperands(ops, opDigits) }, 'warn');
      finalVerdict();
      return { cause, items, cmp };
    }
    push('op.signExact', {}, 'good');
    if (inherited) {
      push('prop.operands', { list: describeOperands(ops, opDigits) }, 'warn');
      setCause('prop', {}, 'warn');
    } else setCause('exact', {}, 'good');
    finalVerdict();
    return { cause, items, cmp };
  }

  // Fixed-point overflow takes priority over all per-op rounding/propagation noise.
  if (fxpOverflow) {
    pushFxpOverflow();
    if (inherited) push('prop.operands', { list: describeOperands(ops, opDigits) }, 'warn');
    finalVerdict();
    return { cause, items, cmp };
  }

  if ((step.op === '+' || step.op === '-') && opVals.every(isNum) && exactOp) {
    const a = fpToFraction(opVals[0]);
    const b = fpToFraction(opVals[1]);
    const bEff = step.op === '-' ? b.neg() : b;
    const A = a.abs();
    const B = b.abs();
    const S = exactOp.abs();
    const effSub = a.n !== 0n && b.n !== 0n && (a.s * bEff.s) < 0n;
    if (effSub && S.n !== 0n) {
      const kappa = A.add(B).div(S);
      const lk = log10Abs(kappa);
      if (lk >= CANCEL_MIN_LOG10_KAPPA) {
        const kappaText = num(kappa, 2);
        if (inherited && !cancelled) {
          const relIn = Math.max(...opCmp.map((c) => (c.status === 'approx' && c.rel ? Math.pow(10, log10Abs(c.rel)) : 0)));
          const relProp = X.kind === 'finite' && X.r.n !== 0n ? exactOp.sub(X.r).abs().div(X.r.abs()) : null;
          const catastrophic = lk >= CATASTROPHIC_LOG10_KAPPA;
          push(catastrophic ? 'op.cancelAmplify' : 'op.cancelMild', {
            kappa: kappaText,
            est: lk.toFixed(1),
            lost: dig(Math.max(0, digitsOfStep().lost)),
            relIn: relIn ? relIn.toExponential(1) : '0',
            relOut: relProp ? num(relProp, 2) : '—',
          }, catastrophic ? 'bad' : 'warn');
          cancelReported = true;
          setCause('cancel', { kappa: kappaText }, catastrophic ? 'bad' : 'warn');
          pushSource();
        } else if (!inherited) {
          push('op.cancelExact', { kappa: kappaText }, 'good');
          cancelReported = true;
        }
      }
    } else if (effSub && S.n === 0n) {
      if (inherited && X.kind === 'finite' && X.r.n !== 0n) {
        push('op.exactZeroLost', {}, 'bad');
        setCause('cancel', { kappa: '∞' }, 'bad');
        pushSource();
      } else {
        push('op.exactZero', {}, 'good');
      }
    }
    // Absorption / exponent alignment apply only to floating-point formats (fixed-point shares a constant grid).
    if (!isFix && a.n !== 0n && b.n !== 0n) {
      const bigIdx = A.compare(B) >= 0 ? 0 : 1;
      const big = opVals[bigIdx];
      const bigEff = step.op === '-' && bigIdx === 1 ? fpNeg(big) : big;
      const smallR = bigIdx === 0 ? B : A;
      const ulp = ulpAround(exactOp, fmt);
      const half = ulp.div(2);
      const eDiff = isDec ? (exponentOf(big) - floorLog10(smallR)) : (exponentOf(big) - floorLog2(smallR));
      const backToBig = v.kind === bigEff.kind && fpToFraction(v).equals(fpToFraction(bigEff));
      if (backToBig && smallR.compare(ulp) < 0) {
        const p = { small: shortestDecimal(opVals[1 - bigIdx], fmt), big: shortestDecimal(bigEff, fmt), half: num(half), ulp: num(ulp), sn: label(1 - bigIdx), mode: key('mode.' + mode) };
        const rel = smallR.compare(half);
        push(rel < 0 ? 'op.absorbTotal' : rel === 0 ? 'op.absorbTie' : 'op.absorbDirected', p, 'bad');
        absorbed = true;
        setCause('absorb', {}, 'bad');
      } else if (newRounding && eDiff > 0) {
        push(isDec ? 'op.alignShiftDec' : 'op.alignShift', { d: eDiff, sn: label(1 - bigIdx) }, 'info');
      }
    }
    if (!isFix && newRounding && !R.tiny && !absorbed) {
      const sig = isDec ? significantDecimalDigits(exactOp) : significantBits(exactOp);
      if (sig > fmt.p) push(isDec ? 'op.addDigits' : 'op.addBits', isDec ? { digits: fmtBits(sig), p: fmt.p } : { bits: fmtBits(sig), p: fmt.p }, 'info');
    }
  } else if (step.op === '*' && exactOp) {
    if (isFix) {
      if (newRounding && !flushedZero) push('fxp.mulRound', { step: num(fmt.step) }, 'info');
    } else if (isDec) {
      const digits = significantDecimalDigits(exactOp);
      if (newRounding && !R.tiny && digits > fmt.p) push('op.mulDigits', { digits: fmtBits(digits), p: fmt.p, p2: 2 * fmt.p }, 'info');
    } else {
      const bits = significantBits(exactOp);
      if (newRounding && !R.tiny && bits > fmt.p) push('op.mulBits', { bits: fmtBits(bits), p: fmt.p, p2: 2 * fmt.p }, 'info');
    }
    if (inherited && !cancelled && !flushedZero) push('op.relMul', { list: relList(opCmp, ops) }, 'info');
  } else if (step.op === '/' && exactOp) {
    const sig = fmt.radix === 10 ? significantDecimalDigits(exactOp) : significantBits(exactOp);
    if (sig === Infinity) {
      if (!flushedZero) {
        if (fmt.radix === 10) {
          const dec = decimalText(exactOp.abs(), 40);
          push(isFix ? 'fxp.divPeriodicDec' : 'op.divPeriodicDec', { dec, note: key(dec.includes('(') ? 'expansion.periodDec' : 'expansion.longDec'), factors: factorsParam(exactOp, 10) }, 'info');
        } else {
          const bin = binaryText(exactOp.abs(), 40);
          push(isFix ? 'fxp.divPeriodicBin' : 'op.divPeriodic', { bin, note: key(bin.includes('(') ? 'expansion.period' : 'expansion.long'), factors: factorsParam(exactOp, 2) }, 'info');
        }
      }
    } else if (isFix) {
      if (newRounding && !flushedZero) push('fxp.divRound', { step: num(fmt.step) }, 'info');
    } else if (newRounding && !R.tiny && sig > fmt.p) {
      push(isDec ? 'op.divDigits' : 'op.divBits', isDec ? { digits: sig, p: fmt.p } : { bits: sig, p: fmt.p }, 'info');
    }
    if (inherited && !cancelled && !flushedZero) push('op.relDiv', { list: relList(opCmp, ops) }, 'info');
  } else if (step.op === 'fma' && exactOp) {
    push(newRounding ? 'op.fmaOnce' : 'op.fmaExact', {}, 'good');
    if (opVals.every(isNum)) {
      const ab = fpToFraction(opVals[0]).mul(fpToFraction(opVals[1]));
      const c = fpToFraction(opVals[2]);
      const AB = ab.abs();
      const C = c.abs();
      const S = exactOp.abs();
      const effSub = ab.n !== 0n && c.n !== 0n && (ab.s * c.s) < 0n;
      if (effSub && S.n !== 0n && !newRounding && inherited && !cancelled) {
        const kappa = AB.add(C).div(S);
        const lk = log10Abs(kappa);
        if (lk >= CANCEL_MIN_LOG10_KAPPA) {
          const kappaText = num(kappa, 2);
          const relIn = Math.max(...opCmp.map((cm) => (cm.status === 'approx' && cm.rel ? Math.pow(10, log10Abs(cm.rel)) : 0)));
          const relProp = X.kind === 'finite' && X.r.n !== 0n ? exactOp.sub(X.r).abs().div(X.r.abs()) : null;
          const catastrophic = lk >= CATASTROPHIC_LOG10_KAPPA;
          push(catastrophic ? 'op.cancelAmplify' : 'op.cancelMild', {
            kappa: kappaText, est: lk.toFixed(1), lost: dig(Math.max(0, digitsOfStep().lost)),
            relIn: relIn ? relIn.toExponential(1) : '0', relOut: relProp ? num(relProp, 2) : '—',
          }, catastrophic ? 'bad' : 'warn');
          cancelReported = true;
          setCause('cancel', { kappa: kappaText }, catastrophic ? 'bad' : 'warn');
          pushSource();
        }
      } else if (effSub && S.n === 0n && inherited && X.kind === 'finite' && X.r.n !== 0n) {
        push('op.exactZeroLost', {}, 'bad');
        setCause('cancel', { kappa: '∞' }, 'bad');
        pushSource();
      }
      if (!isFix && ab.n !== 0n && c.n !== 0n && newRounding && !R.overflow) {
        const ulp = ulpAround(exactOp, fmt);
        const half = ulp.div(2);
        const vr = fpToFraction(v);
        if (vr.equals(ab) && C.compare(ulp) < 0) {
          const p = { small: shortestDecimal(opVals[2], fmt), big: shortestDecimal(v, fmt), half: num(half), ulp: num(ulp), sn: label(2), mode: key('mode.' + mode) };
          const rel = C.compare(half);
          push(rel < 0 ? 'op.absorbTotal' : rel === 0 ? 'op.absorbTie' : 'op.absorbDirected', p, 'bad');
          absorbed = true;
          setCause('absorb', {}, 'bad');
        } else if (vr.equals(c) && AB.compare(ulp) < 0) {
          const p = { small: num(ab, 6), big: shortestDecimal(opVals[2], fmt), half: num(half), ulp: num(ulp), sn: `${label(0)}×${label(1)}`, mode: key('mode.' + mode) };
          const rel = AB.compare(half);
          push(rel < 0 ? 'op.absorbTotal' : rel === 0 ? 'op.absorbTie' : 'op.absorbDirected', p, 'bad');
          absorbed = true;
          setCause('absorb', {}, 'bad');
        }
      }
    }
  }

  if (!newRounding && !cancelReported && exactOp && exactOp.n !== 0n && !res.flags.overflow && !FUNCS.has(step.op) && step.op !== 'fma') {
    if (isFix && (step.op === '+' || step.op === '-')) push('fxp.addExact', { step: num(fmt.step) }, 'good');
    else if (isFix) push('fxp.convExact', { value: shortestDecimal(v, fmt), step: num(fmt.step) }, 'good');
    else if (isDec) push('op.exactDec', { digits: significantDecimalDigits(exactOp), p: fmt.p }, 'good');
    else push('op.exact', { bits: significantBits(exactOp), p: fmt.p }, 'good');
  }
  if (newRounding) {
    if (R.tiny) {
      if (isFix) push('fxp.flushZero', { step: num(fmt.step), why: flushWhy(R, mode, fmt) }, 'bad');
      else if (v.kind === 'zero') push('op.flushZero', { why: flushWhy(R, mode, fmt) }, 'bad');
      else if (isSubnormal(v, fmt)) push(isDec ? 'op.subnormalDec' : 'op.subnormal', subnormalParams(v, fmt), 'warn');
      else push(isDec ? 'op.roundToMinNormalDec' : 'op.roundToMinNormal', { minNormal: num(isDec ? frac(1n, pow10(-fmt.emin)) : dyadic(1n, fmt.emin)), p: fmt.p }, 'warn');
      setCause('underflow', {}, 'warn');
    }
    if (!flushedZero) roundingItems(res, fmt, mode, push);
  }
  if (inherited && !flushedZero) {
    const code = zeroFactor ? 'prop.zeroAbsorb' : opposite ? 'prop.opposite' : same ? 'prop.same' : lucky ? 'prop.lucky' : 'prop.operands';
    push(code, { list: describeOperands(ops, opDigits) }, same || zeroFactor ? 'good' : lucky ? 'info' : 'warn');
  }

  // Error budget: inherited vs new
  let parts = null;
  let dominance = null;
  if (cmp.status === 'approx' && exactOp && X.kind === 'finite' && isNum(v)) {
    const prop = dyadicSub(exactOp, X.r);
    const nw = dyadicSub(fpToFraction(v), exactOp);
    parts = { prop, nw, total: cmp.err };
    if (inherited && newRounding) {
      const lp = prop.n === 0n ? -Infinity : log10Abs(prop);
      const ln = nw.n === 0n ? -Infinity : log10Abs(nw);
      dominance = lp - ln > DOMINANCE_DIGITS ? 'inherited' : ln - lp > DOMINANCE_DIGITS ? 'new' : 'both';
      const dom = dominance === 'inherited' ? 'budget.domInherited' : dominance === 'new' ? 'budget.domNew' : 'budget.domBoth';
      if (!flushedZero) push('budget', { prop: signed(prop), nw: signed(nw), total: signed(cmp.err), dom: key(dom) }, 'info');
    }
  }

  // Gain of digits: explained when the first-order worst-case bound of the
  // propagated relative error already reaches the digits obtained.
  gainExplained = (sd) => {
    const lb = propagatedBoundLog10(step, ops, opVals, opCmp, exactOp, fnKappa);
    return lb != null && -lb >= Math.min(sd.to, full) - GAIN_EXPLAINED_MARGIN;
  };

  // Cause chip: a special event found above wins; otherwise the dominant part
  // of the error budget (DOMINANCE_DIGITS) decides between the operands'
  // inherited error, this step's rounding, or both.
  if (zeroFactor) setCause('exact', {}, 'good');
  else if (same) setCause('cancelSame', {}, 'good');
  else if (lucky) setCause('lucky', {}, 'info');
  else if (newRounding && dominance === 'inherited') setCause('prop', {}, 'warn');
  else if (newRounding && dominance === 'both') setCause('propRound', {}, 'warn');
  else if (newRounding) setCause('round', {}, 'info');
  else if (inherited) setCause('prop', {}, 'warn');
  else setCause('exact', {}, 'good');

  finalVerdict();
  return { cause, items, cmp, parts };

  function finalVerdict() {
    if (cmp.refLimited) push('ref.capped', { reliable: dig(X.reliable) }, 'warn');
    // The true value is only a stand-in (0 or ∞) for a number beyond the reference's range.
    if (cmp.beyond) { push('verdict.beyond', {}, 'warn'); return; }
    if (cmp.status === 'exact') { push('verdict.exact', {}, 'good'); return; }
    if (cmp.status !== 'approx') return;
    if (!cmp.rel) { push('verdict.trueZero', { abs: num(cmp.abs) }, 'warn'); return; }
    // Shown (capped) digits only, the same figures as the badges and the diagnosis.
    const sd = digitsOfStep();
    if (absorbed && sd.lost < NOTABLE_DIGITS) {
      push('verdict.absorbedWarning', { full: dig(full) }, 'warn');
      return;
    }
    if (sd.from === Infinity) {
      const info = correctDigits(cmp, fmt);
      if (sd.lost >= NOTABLE_DIGITS) {
        push('verdict.newErrorLost', { digits: dig(sd.to), full: dig(full), lost: dig(sd.lost) }, 'warn');
      } else if (info.capped || info.shown >= full) {
        push('verdict.newErrorFull', { full: dig(full), raw: dig(info.raw) }, 'info');
      } else {
        push('verdict.newError', { digits: dig(sd.to), full: dig(full) }, 'info');
      }
    } else if (sd.lost >= NOTABLE_DIGITS) {
      push('verdict.lost', { from: dig(sd.from), to: dig(sd.to), lost: dig(sd.lost) }, 'bad');
    } else if (-sd.lost >= NOTABLE_DIGITS) {
      const p = { from: dig(sd.from), to: dig(sd.to), fn: step.op };
      if (!gainExplained || !gainExplained(sd)) push('verdict.gained', p, 'info');
      else push(FUNCS.has(step.op) ? 'verdict.gainedDamped' : 'verdict.gainedDiluted', p, 'info');
    } else {
      // "kept" is good news only when there was something good to keep.
      const q = qualityOf(Math.min(sd.to, full), full);
      if (q === 'q-good') push('verdict.kept', { from: dig(sd.from), to: dig(sd.to) }, 'good');
      else push('verdict.keptLow', { from: dig(sd.from), to: dig(sd.to) }, q === 'q-mid' ? 'warn' : 'bad');
    }
  }

  /**
   * a == b, a < b …: the answer itself is never rounded (exactly 1 or 0), so
   * the question is only whether the operands' errors change it. The true
   * answer compares the true values; the format compares the stored ones.
   * When they disagree the reason is named (equal true values that were
   * rounded differently, or a true difference smaller than the operands'
   * errors); when equal true values stay equal despite errors, that is luck —
   * unless both operands are the same computation (c == c), which cannot fail.
   * An operand that is ∞ or NaN only in this format (its true value is finite)
   * gets its own sentence: no error can be measured, and no tolerance helps.
   * Whenever rounded values are tested for equality (or the answer is wrong)
   * a tolerance test is recommended; for a wrong order test (which may itself
   * be a tolerance test) the advice says the tolerance or the precision is too small.
   */
  function explainComparison() {
    const ops = step.operands.map((id) => steps[id]);
    const vals = ops.map((o) => o.fmt[fmt.id].value);
    const yes = (b) => key(b ? 'cmp.true' : 'cmp.false');
    const got = v.kind === 'finite';
    push('cmp.noRounding', {}, 'info');
    if (vals.some((x) => x.kind === 'nan')) push('cmp.nan', { got: yes(got) }, 'warn');
    else if (vals.every((x) => x.kind === 'zero') && vals[0].sign !== vals[1].sign) push('cmp.signedZero', {}, 'info');
    if (X.kind !== 'finite') {
      push('sp.exactUndefined', {}, 'bad');
      setCause('invalid', {}, 'bad');
      return { cause, items, cmp };
    }
    if (X.undecided) push('cmp.undecided', {}, 'warn');
    const want = X.r.n !== 0n;
    const opCmp = ops.map((o, i) => compareToExact(vals[i], o.exact, fmt));
    const allExact = opCmp.every((c) => c.status === 'exact' || c.status === 'both-inf');
    const list = ops.map((o, i) => {
      const c = opCmp[i];
      const e = c.status === 'approx' ? signed(c.err) : c.status === 'exact' || c.status === 'both-inf' ? '0' : '—';
      return `#${o.id} ${o.lastAssigned || (o.assigned && o.assigned[0]) || o.text}: ${e}`;
    }).join(', ');
    const finite = (i) => isNum(vals[i]) && ops[i].exact.kind === 'finite';
    const trueDiff = ops.every((o) => o.exact.kind === 'finite') ? signed(ops[0].exact.r.sub(ops[1].exact.r)) : '—';
    const storedDiff = vals.every(isNum) ? signed(fpToFraction(vals[0]).sub(fpToFraction(vals[1]))) : '—';
    const trueOrder = exactOrder(ops[0].exact, ops[1].exact).order;
    const storedOrder = fpOrder(vals[0], vals[1]);
    const equality = step.op === '==' || step.op === '!=';
    const tolerance = () => {
      if (fmt.fixed) {
        push(equality ? 'cmp.toleranceFixed' : 'cmp.toleranceOrderFixed', { step: num(fmt.step) }, 'info');
      } else {
        const u = fmt.family === 'decfloat' ? num(frac(5n, pow10(fmt.p)), 2) : num(dyadic(1n, -fmt.p), 2);
        push(equality ? 'cmp.tolerance' : 'cmp.toleranceOrder', { u }, 'info');
      }
    };
    // ∞ or NaN/trap in this format although the true value is finite (an earlier overflow or invalid step).
    const special = vals.findIndex((x, i) => !isNum(x) && ops[i].exact.kind === 'finite');
    if (special >= 0) {
      const sp = { id: ops[special].id, what: vals[special].kind === 'nan' ? (fmt.fixed ? 'ERR' : 'NaN') : shortestDecimal(vals[special], fmt), got: yes(got), want: yes(want) };
      if (got === want) {
        push('cmp.rightSpecial', sp, 'warn');
        setCause('prop', {}, 'warn');
      } else {
        push('cmp.wrongSpecial', sp, 'bad');
        setCause('cmpWrong', {}, 'bad');
      }
      return { cause, items, cmp };
    }
    const same = !allExact && sameComputation(ops[0], ops[1], steps);
    if (got === want) {
      if (allExact) {
        push('cmp.allExact', {}, 'good');
        setCause('exact', {}, 'good');
      } else if (same) {
        push('cmp.same', { list, got: yes(got) }, 'good');
        setCause('cancelSame', {}, 'good');
      } else if (trueOrder === 0 && storedOrder === 0) {
        push('cmp.equalLuck', { list }, 'warn');
        setCause('lucky', {}, 'info');
      } else {
        push('cmp.sameAnswer', { list, diff: trueDiff }, 'info');
        setCause('exact', {}, 'good');
      }
      push('cmp.right', { got: yes(got) }, 'good');
      if (!allExact && !same && equality) tolerance();
      return { cause, items, cmp };
    }
    if (trueOrder === 0 && storedOrder != null && finite(0) && finite(1)) {
      // How far apart the stored values are, counted in representable numbers (1 = neighbours):
      // an error in ulps of the true value can read "0.5 ulp" for two neighbours across a power of two.
      const n = stepsBetween(fpToFraction(vals[0]), fpToFraction(vals[1]), fmt);
      const apart = n === 1 ? key('cmp.apartOne') : key('cmp.apartMany', { n: n == null ? '—' : String(n) });
      push('cmp.wrongEqual', { list, diff: storedDiff, apart, got: yes(got), want: yes(want) }, 'bad');
    } else {
      push('cmp.wrongOrder', { list, trueDiff, storedDiff, got: yes(got), want: yes(want) }, 'bad');
    }
    setCause('cmpWrong', {}, 'bad');
    if (opts.trace !== false) {
      const src = errorSource(step, steps, fmt);
      if (src && src.id !== step.id) {
        const sc = explainStep(src, steps, fmt, mode, { trace: false }).cause;
        push('op.lostAt', { id: src.id, text: shortText(src), cause: key('cause.' + sc.code, sc.params) }, 'info');
      }
    }
    tolerance();
    return { cause, items, cmp };
  }

  /**
   * double(x), float(x) …: the stored operand is rounded into the target
   * format and then held in this column's format again (rounded once more
   * when the target is not contained in it). The true value is the operand's
   * true value, so the error of the step is everything the cast changed. When
   * the operand was itself the rounded result of an operation, rounding it
   * again can differ from rounding the exact result once: double rounding.
   */
  function explainCast() {
    const op = steps[step.operands[0]];
    const ores = op.fmt[fmt.id];
    const T = FORMATS.find((f) => f.id === CASTS[step.op]);
    const { mid, r1, r2 } = res.cast;
    const target = key('fmt.name.' + T.id);
    const sameFormat = T.family === fmt.family && T.radix === fmt.radix && T.p === fmt.p && T.emin === fmt.emin && T.emax === fmt.emax
      && (!T.fixed || (T.scaleExp === fmt.scaleExp && T.totalBits === fmt.totalBits));
    let doubleRound = false;
    const leaf = op.kind !== 'op';
    let drItem = null;
    if (!sameFormat && R && R.inexact && r1 && r1.inexact && !r1.overflow && ores.round?.inexact && ores.exactOp.kind === 'finite' && !ores.exactOp.beyond && !(leaf && ores.exactOp.approx)) {
      const once = roundFraction(ores.exactOp.r, T, mode).value;
      const prevP = ores.cast ? FORMATS.find((f) => f.id === ores.cast.target).p : fmt.p;
      const params = { id: op.id, p: prevP, pT: T.p, target, src: leaf ? (op.source ?? op.text) : '' };
      if (!fpEquals(once, mid)) {
        doubleRound = true;
        drItem = { code: leaf ? 'cast.doubleRoundingInput' : 'cast.doubleRounding', params: { ...params, once: shortestDecimal(once, T), twice: shortestDecimal(mid, T) }, tone: 'bad' };
      } else {
        drItem = { code: leaf ? 'cast.twiceSameInput' : 'cast.twiceSame', params, tone: 'info' };
      }
    }
    // Lead with the headline failure (double rounding or overflow) rather than generic cast mechanics.
    if (doubleRound) push(drItem.code, drItem.params, drItem.tone);
    else if (r1?.overflow) {
      if (T.fixed) {
        if (r1.overflowKind === 'wrap') {
          push('cast.fixedOverflowWrap', { target, bits: T.totalBits, result: shortestDecimal(mid, T) }, 'bad');
          setCause('wrap', {}, 'bad');
        } else {
          push('cast.fixedOverflowSat', { target, result: shortestDecimal(mid, T) }, 'bad');
          setCause('saturate', {}, 'bad');
        }
      } else {
        push('cast.overflow', { target, result: shortestDecimal(mid, T) }, 'bad');
        setCause('overflow', {}, 'bad');
      }
    } else if (T.family === 'decfloat') {
      push('cast.whatDec', { fn: step.op, target, pT: T.p }, 'info');
    } else if (T.fixed) {
      push('cast.whatFixed', { fn: step.op, target, step: num(T.step) }, 'info');
    } else {
      push('cast.what', { fn: step.op, target, pT: T.p, p: fmt.p }, 'info');
    }
    if (sameFormat) {
      push('cast.same', {}, 'good');
    } else if (!R || !R.inexact) {
      push('cast.fits', { target }, 'good');
    } else {
      if (r1 && !r1.overflow && r1.inexact) {
        const kept = r2 && !r2.inexact;
        push('cast.round1', { target, from: shortestDecimal(ores.value, fmt), to: shortestDecimal(kept ? v : mid, kept ? fmt : T), dir: key('dir.' + r1.direction) }, 'warn');
        if (r1.tiny) setCause('underflow', {}, 'warn');
      }
      if (r2?.inexact) {
        push('cast.round2', { p: fmt.p, from: shortestDecimal(mid, T), to: shortestDecimal(v, fmt) }, r2.overflow ? 'bad' : 'warn');
        if (r2.overflow) setCause(fmt.fixed ? (r2.overflowKind === 'wrap' ? 'wrap' : 'saturate') : 'overflow', {}, 'bad');
        else if (r2.tiny) setCause('underflow', {}, 'warn');
      }
      if (drItem && !doubleRound) push(drItem.code, drItem.params, drItem.tone);
    }
    const inherited = opCmpOf(op) !== 'exact';
    const lucky = inherited && cmp.status === 'exact';
    // When double rounding occurred from a wider column, cast.doubleRounding already explains the operand's rounding.
    if (inherited && !(doubleRound && fmt.p > T.p)) {
      push(lucky ? 'prop.lucky' : 'prop.operands', { list: describeOperands([op], [correctDigits(compareToExact(ores.value, op.exact, fmt), fmt).shown ?? 0]) }, lucky ? 'info' : 'warn');
    }
    if (doubleRound) setCause('doubleRound', {}, 'bad');
    else if (lucky) setCause('lucky', {}, 'info');
    else if (R.inexact) setCause('round', {}, 'info');
    else if (inherited) setCause('prop', {}, 'warn');
    else setCause('exact', {}, 'good');
    finalVerdict();
    return { cause, items, cmp };
  }

  function opCmpOf(o) {
    const c = compareToExact(o.fmt[fmt.id].value, o.exact, fmt);
    return c.status === 'exact' || c.status === 'both-inf' || c.status === 'both-nan' ? 'exact' : 'inexact';
  }
}

/**
 * log10 of the first-order worst-case relative error of the exact operation
 * result caused by the operands' relative errors eᵢ (null when unknown):
 *   a ± b:  Σ |xᵢ|/|a ± b| · |eᵢ|     (small addends weigh little)
 *   a·b, a/b: |e_a| + |e_b|           (≤ 2·max)
 *   fma:    |ab|/|r|·(|e_a|+|e_b|) + |c|/|r|·|e_c|
 *   f(x):   κ · |e_x|                 (κ < 1: the function damps the error)
 */
function propagatedBoundLog10(step, ops, opVals, opCmp, exactOp, fnKappa) {
  if (!exactOp || exactOp.n === 0n) return null;
  const rel = opCmp.map((c) => (c.status === 'exact' ? -Infinity : c.status === 'approx' && c.rel ? log10Abs(c.rel) : null));
  if (rel.some((x) => x == null)) return null;
  const mag = ops.map((o, i) => (o.exact.kind === 'finite' && o.exact.r.n !== 0n ? log10Abs(o.exact.r) : isNum(opVals[i]) && opVals[i].kind !== 'zero' ? log10Abs(fpToFraction(opVals[i])) : -Infinity));
  const lr = log10Abs(exactOp);
  const weighted = (i) => (rel[i] === -Infinity ? -Infinity : rel[i] + mag[i] - lr);
  switch (step.op) {
    case '+': case '-': return Math.max(weighted(0), weighted(1)) + LOG10_2;
    case '*': case '/': return Math.max(rel[0], rel[1]) + LOG10_2;
    case 'fma': {
      const ab = Math.max(rel[0], rel[1]) === -Infinity ? -Infinity : Math.max(rel[0], rel[1]) + LOG10_2 + mag[0] + mag[1] - lr;
      return Math.max(ab, weighted(2)) + LOG10_2;
    }
    case 'pow': {
      const x = toNum(opVals[0]);
      const y = toNum(opVals[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const bx = rel[0] === -Infinity ? -Infinity : rel[0] + Math.log10(Math.abs(y));
      const by = rel[1] === -Infinity ? -Infinity : rel[1] + Math.log10(Math.abs(y * Math.log(Math.abs(x))));
      return Math.max(bx, by) + (bx !== -Infinity && by !== -Infinity ? LOG10_2 : 0);
    }
    default:
      if (FUNCS.has(step.op) && fnKappa != null) return Math.max(...rel) + Math.log10(fnKappa); // κ = 0: −∞, fully damped
      return null;
  }
}

function fmtBits(b) {
  return b === Infinity ? '∞' : String(b);
}

function signed(r) {
  if (r.n === 0n) return '0';
  return (r.s < 0n ? '−' : '+') + num(r.abs());
}

function describeOperands(ops, opDigits) {
  return ops.map((o, i) => `#${o.id} ${o.lastAssigned || (o.assigned && o.assigned[0]) || o.text} (${dig(opDigits[i])})`).join(', ');
}

/** Signed relative errors (computed − true)/true of the operands: their signs decide whether they add or cancel. */
function relList(opCmp, ops) {
  return opCmp.map((c, i) => {
    if (c.status !== 'approx' || !c.rel) return `#${ops[i].id}: 0`;
    const neg = (c.err.s < 0n) !== (ops[i].exact.r.s < 0n);
    return `#${ops[i].id}: ${neg ? '−' : '+'}${num(c.rel, 2)}`;
  }).join(', ');
}

function roundingItems(res, fmt, mode, push) {
  const R = res.round;
  const loc = localError(res, fmt);
  if (!R || !R.inexact || !loc || R.direction === 'exact') return;
  const nearest = mode === 'RNE' || mode === 'RNA';
  if (fmt.fixed) {
    if (isTie(R, fmt)) {
      push(fmt.radix === 10 ? 'fxp.tieDec' : 'fxp.tieBin', { mode: key('mode.' + mode), dir: key('dir.' + R.direction) }, 'info');
    }
    const bound = nearest
      ? key('fxp.boundNearest', { half: num(fmt.step.div(2)) })
      : key('fxp.boundDirected', { step: num(fmt.step) });
    push('fxp.roundAmount', {
      dir: key('dir.' + R.direction),
      err: num(loc.abs),
      ulps: num(loc.ulps, 3),
      step: num(fmt.step),
      bound,
    }, 'info');
    return;
  }
  if (isTie(R, fmt)) {
    push(fmt.family === 'decfloat' ? 'round.tieDec' : 'round.tie', { mode: key('mode.' + mode), dir: key('dir.' + R.direction) }, 'info');
  }
  const u = fmt.family === 'decfloat' ? num(frac(5n, pow10(fmt.p)), 2) : num(dyadic(1n, -fmt.p), 2);
  let bound;
  if (R.overflow || res.flags.overflow) bound = key('round.boundOverflow', { mode: key('mode.' + mode) });
  else if (fmt.family === 'decfloat') {
    if (R.tiny) bound = key(nearest ? 'round.boundNearestTinyDec' : 'round.boundDirectedTinyDec', { u });
    else bound = key(nearest ? 'round.boundNearestDec' : 'round.boundDirectedDec', { u });
  } else if (R.tiny) bound = key(nearest ? 'round.boundNearestTiny' : 'round.boundDirectedTiny', { u });
  else bound = key(nearest ? 'round.boundNearest' : 'round.boundDirected', { u });
  push('round.amount', {
    dir: key('dir.' + R.direction),
    err: num(loc.abs),
    ulps: num(loc.ulps, 3),
    ulp: num(loc.ulp),
    bound,
    rel: loc.rel ? num(loc.rel, 2) : '—',
  }, 'info');
}

/**
 * Which steps cost the most correct digits on the way to the result?
 * Only steps the result actually depends on are considered. For each loss the
 * step where the error was created is traced (errorSource): a cancellation
 * only reveals an error that an absorption or rounding made earlier.
 */
export function diagnose(result, fmt, { root: rootId = result.result, shownOf: shared = null } = {}) {
  // rootId: any step can be diagnosed (the UI diagnoses every assigned variable, so
  // that paired variants such as stable / naive show both sides); shared: the
  // caller's cached shown digits of a step, so that no step is compared twice.
  const steps = result.steps;
  const root = steps[rootId];
  if (!root) return null;
  const full = fullDigits(fmt);
  const needed = new Set();
  const stack = [root.id];
  while (stack.length) {
    const id = stack.pop();
    if (needed.has(id)) continue;
    needed.add(id);
    for (const o of steps[id].operands) stack.push(o);
  }
  const digitsCache = new Map();
  const shownOf = shared || ((s) => {
    if (!digitsCache.has(s.id)) digitsCache.set(s.id, correctDigits(compareToExact(s.fmt[fmt.id].value, s.exact, fmt), fmt).shown);
    return digitsCache.get(s.id);
  });
  // Earlier values the result depends on that already differ from their true
  // values: an exact result built on them is exact only because their errors cancelled.
  const carried = [...needed].filter((id) => id !== root.id && shownOf(steps[id]) !== Infinity).sort((a, b) => a - b);
  // The same per-step figure as the verdict sentence; only whole-digit losses are listed.
  const losses = [];
  for (const id of needed) {
    const s = steps[id];
    const sd = stepDigits(s, steps, fmt, shownOf);
    if (sd.lost >= NOTABLE_DIGITS) losses.push({ step: s, lost: sd.lost, from: Math.min(sd.from, full), to: Math.min(sd.to, full), source: null });
  }
  losses.sort((a, b) => b.lost - a.lost);
  const top = losses.slice(0, 3);
  for (const l of top) {
    const src = errorSource(l.step, steps, fmt);
    if (src && src.id !== l.step.id) l.source = src;
  }
  const final = compareToExact(root.fmt[fmt.id].value, root.exact, fmt);
  const finalDigits = correctDigits(final, fmt);
  // First step (in evaluation order) where the format leaves the finite numbers.
  let origin = null;
  for (const id of [...needed].sort((a, b) => a - b)) {
    const s = steps[id];
    const r = s.fmt[fmt.id];
    if (r.flags.overflow || r.flags.invalid || r.flags.divByZero || (!isNum(r.value) && s.exact.kind === 'finite')) { origin = s; break; }
  }
  // A division by a zero that is 0 only in this format (the true value is finite):
  // the problem starts where that zero was made (typically an underflow).
  let revealed = null;
  if (origin && origin.fmt[fmt.id].flags.divByZero && origin.exact.kind === 'finite') {
    const zero = origin.operands.map((id) => steps[id]).find((o) => o.fmt[fmt.id].value.kind === 'zero' && o.exact.kind === 'finite' && o.exact.r.n !== 0n);
    if (zero) {
      revealed = origin;
      origin = errorSource(zero, steps, fmt) || zero;
    }
  }
  // Is the result the best this format can give (the true value rounded once)?
  let bestPossible = null;
  let best = null;
  let apart = null;
  let rounded = 0;
  if (final.status === 'approx' && root.exact.kind === 'finite') {
    const bestR = roundFraction(root.exact.r, fmt, result.mode || 'RNE');
    best = bestR.value;
    const got = root.fmt[fmt.id].value;
    bestPossible = !bestR.overflow && isNum(best) && fpToFraction(best).equals(fpToFraction(got));
    if (!bestR.overflow && isNum(best) && isNum(got)) apart = stepsBetween(fpToFraction(best), fpToFraction(got), fmt);
    for (const id of needed) if (steps[id].fmt[fmt.id].round?.inexact) rounded++;
  }
  // An exact result built on rounded values: did their errors cancel by construction
  // (every exact step with inexact operands is x − x, x / x, 0·x, a + (−a) or c == c),
  // stay irrelevant because a comparison had wide true margin, or cancel by luck?
  let exactBy = null;
  if (final.status === 'exact' && carried.length) {
    exactBy = 'construction';
    for (const id of needed) {
      const s = steps[id];
      if (s.kind !== 'op' || shownOf(s) !== Infinity || !s.operands.some((o) => shownOf(steps[o]) !== Infinity)) continue;
      if (exactByConstruction(s, steps, result.mode || 'RNE', fmt)) continue;
      if (CMP.has(s.op) && exactOrder(steps[s.operands[0]].exact, steps[s.operands[1]].exact).order !== 0) {
        if (exactBy === 'construction') exactBy = 'margin';
        continue;
      }
      exactBy = 'luck';
      break;
    }
  }
  // digits: shown (capped) correct digits of the result; raw: the measured −log10(rel. error)
  // best: the true value rounded once; apart: how many representable numbers the result lies from it
  return {
    final, digits: finalDigits.shown ?? 0, raw: finalDigits.raw, full, losses: top, origin, revealed,
    bestPossible, best, apart, rounded, ulps: final.status === 'approx' ? final.ulpsApprox : null, carried, exactBy,
  };
}
