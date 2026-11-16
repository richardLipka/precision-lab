// Precision sweep: evaluate the same program with p = p1, p2, … bits and
// record how the error of every step (and of the result) depends on p.

import { evaluate } from './evaluator.js';
import { makeFormat, shortestDecimal, exactShort, roundFraction, fpToFraction } from './ieee.js';
import { compareToExact, rawDigits, capDigits, fullDigits, LOG10_2 } from './metrics.js';
import { fmtFrac, log10Abs, log2Big, dyadic } from './rational.js';
import { EngineError } from './messages.js';
import { approxText } from './real.js';

export { LOG10_2 };
export const MAX_PRECISION = 100000;

// Thresholds of the convergence summary (they choose which sentence is shown).
/** A gain of more than 8 digits between neighbouring precisions is a "sharp threshold" (Rump-like), not gradual convergence. */
const JUMP_DIGITS = 8;
/** Slope (digits per bit) above which the result is said to converge; the ideal is log10 2 ≈ 0.30. */
const SLOPE_CONVERGES = 0.12;
/** Slope above which a still inaccurate result is said to be "not yet" converging rather than showing no trend. */
const SLOPE_NOT_YET = 0.05;
/** A step to the next precision that loses more than 2 digits counts as an irregular drop. */
const DROP_DIGITS = 2;
export const MAX_SWEEP_POINTS = 1000;

/**
 * Parse a precision specification:
 *   "1-200"        every p from 1 to 200
 *   "2-1000:10"    from 2 to 1000 in steps of 10
 *   "11, 24, 53, 64, 113"  an explicit list (ranges may be mixed in)
 * Returns a sorted array of distinct integers.
 */
export function parsePrecisions(text) {
  const out = new Set();
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+)(?::(\d+))?)?$/.exec(part);
    if (!m) throw new EngineError('sweep.badSpec', { part });
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const step = m[3] ? Math.max(1, parseInt(m[3], 10)) : 1;
    if (a < 1 || b < 1 || a > MAX_PRECISION || b > MAX_PRECISION) throw new EngineError('sweep.badRange', { max: MAX_PRECISION });
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let p = lo; p <= hi; p += step) {
      out.add(p);
      if (out.size > MAX_SWEEP_POINTS) throw new EngineError('sweep.tooMany', { max: MAX_SWEEP_POINTS });
    }
    out.add(hi);
  }
  if (!out.size) throw new EngineError('sweep.empty');
  if (out.size > MAX_SWEEP_POINTS) throw new EngineError('sweep.tooMany', { max: MAX_SWEEP_POINTS });
  return [...out].sort((x, y) => x - y);
}

/**
 * Fast RAW correct-digit count for the sweep (same convention as rawDigits in
 * metrics.js): |v − X| / |X| computed with plain BigInt arithmetic (no fraction
 * reduction), exact to ~15 digits in the log. Views cap it with capDigits.
 */
function fastDigits(v, X, fmt) {
  if (X.kind !== 'finite' || (v.kind !== 'finite' && v.kind !== 'zero')) return rawDigits(compareToExact(v, X, fmt));
  const vm = v.kind === 'zero' ? 0n : v.sign ? -v.m : v.m;
  const q = v.kind === 'zero' ? 0 : v.q;
  const k = q < 0 ? -q : 0;
  const n = X.r.s < 0n ? -X.r.n : X.r.n;
  const A = (vm * X.r.d) << BigInt(q + k);
  const B = n << BigInt(k);
  let diff = A - B;
  if (diff === 0n) return Infinity;
  if (n === 0n) return 0;
  if (diff < 0n) diff = -diff;
  const lrel = (log2Big(diff) - log2Big(B < 0n ? -B : B)) * LOG10_2;
  const d = Math.max(0, -lrel);
  return X.approx ? Math.min(d, X.reliable) : d;
}

/**
 * @param {object} cfg {variables, program, mode, precisions:number[], expBits:number|null}
 * @param {(done:number, total:number)=>void} [onProgress]
 */
export function runSweep(cfg, onProgress) {
  const { variables, program, mode, precisions, expBits = null } = cfg;
  const chunkSize = Math.max(1, Math.min(25, Math.floor(400000 / Math.max(1, precisions.reduce((a, b) => a + b, 0) / precisions.length))));
  let meta = null;
  const exactCache = [];
  const rows = [];
  for (let i = 0; i < precisions.length; i += chunkSize) {
    const chunk = precisions.slice(i, i + chunkSize);
    const formats = chunk.map((p) => makeFormat({ id: 'p' + p, name: `p=${p}`, short: `p=${p}`, p, expBits }));
    const res = evaluate({ variables, program, formats, mode, maxSteps: 5000, refDigits: Math.ceil(precisions[precisions.length - 1] * LOG10_2) + 30, exactCache });
    if (!meta) {
      const root = res.steps[res.result];
      meta = {
        result: res.result,
        steps: res.steps.map((s) => ({ id: s.id, text: s.text, kind: s.kind, op: s.op, lastAssigned: s.lastAssigned || null, iter: s.iter })),
        exact: root ? (root.exact.approx ? '≈ ' + approxText(root.exact, 30) : exactShort(root.exact, 30)) : '—',
        exactApprox: !!root?.exact.approx,
        reliable: root?.exact.approx ? root.exact.reliable : null,
        refDigits: res.refDigits,
        exactKind: root ? root.exact.kind : 'nan',
        exactLog10: root && root.exact.kind === 'finite' && root.exact.r.n !== 0n ? log10Abs(root.exact.r) : null,
        resultName: root ? root.lastAssigned || root.text : '',
      };
    }
    for (const f of formats) {
      const digits = new Float64Array(res.steps.length);
      res.steps.forEach((s, k) => {
        const d = fastDigits(s.fmt[f.id].value, s.exact, f);
        digits[k] = d == null ? NaN : d;
      });
      const root = res.steps[res.result];
      let final = null;
      if (root) {
        const v = root.fmt[f.id].value;
        const cmp = compareToExact(v, root.exact, f);
        final = {
          value: f.p <= 128 ? shortestDecimal(v, f) : (v.kind === 'finite' ? fmtFrac(fracOf(v), 30) : shortestDecimal(v, f)),
          kind: v.kind,
          status: cmp.status,
          digits: rawDigits(cmp), // raw; capped at p·log10 2 for display and analysis
          log10Abs: cmp.status === 'exact' ? -Infinity : cmp.status === 'approx' ? log10(cmp.abs) : Infinity,
          log10Rel: cmp.status === 'exact' ? -Infinity : cmp.status === 'approx' && cmp.rel ? cmp.log10Rel : Infinity,
          absText: cmp.status === 'approx' ? fmtFrac(cmp.abs, 3, { plainMin: -3, plainMax: 5 }) : null,
          ...bestPossible(root.exact, f),
        };
      }
      rows.push({ p: f.p, digits, final });
    }
    onProgress?.(Math.min(precisions.length, i + chunk.length), precisions.length);
  }
  return { meta, rows, analysis: analyzeConvergence(rows, meta), expBits, mode };
}

function log10(r) {
  return log10Abs(r);
}

/**
 * The best any p-bit result can do: the true value rounded once to the nearest
 * p-bit number. No computed result can be closer to the true value, so the
 * computed error is always ≥ this one; the gap is what the calculation loses.
 * (The bound of one rounding, u·|x| = 2^−p·|x|, is only an upper limit of it.)
 */
export function bestPossible(X, fmt) {
  if (X.kind !== 'finite') return { bestLog10Abs: null, bestLog10Rel: null, bestDigits: null };
  const r = roundFraction(X.r, fmt, 'RNE').value;
  if (r.kind !== 'finite' && r.kind !== 'zero') return { bestLog10Abs: null, bestLog10Rel: null, bestDigits: null };
  const err = fpToFraction(r).sub(X.r).abs();
  if (err.n === 0n) return { bestLog10Abs: -Infinity, bestLog10Rel: X.r.n === 0n ? null : -Infinity, bestDigits: Infinity, bestText: '0' };
  const la = log10Abs(err);
  const lr = X.r.n === 0n ? null : la - log10Abs(X.r);
  let d = lr == null ? null : Math.max(0, -lr);
  if (d != null && X.approx) d = Math.min(d, X.reliable);
  return { bestLog10Abs: la, bestLog10Rel: lr, bestDigits: d, bestText: fmtFrac(err, 3, { plainMin: -3, plainMax: 5 }) };
}

function fracOf(v) {
  return dyadic(v.m, v.q, v.sign);
}

/**
 * Summarise how the error of the result depends on the precision.
 * All numbers; the UI writes the sentences.
 */
export function analyzeConvergence(rows, meta) {
  // Shown (capped) digits, the same figure the chart, the table and the other views use.
  const pts = rows.filter((r) => r.final).map((r) => ({ p: r.p, d: capDigits(r.final.digits, fullDigits(r.p)), final: r.final }));
  if (!pts.length || meta?.exactKind !== 'finite') return { kind: 'undefined' };
  const comparable = pts.filter((x) => x.d != null);
  if (!comparable.length) return { kind: 'noComparable' };
  const pMin = pts[0].p;
  const pMax = pts[pts.length - 1].p;
  const last = pts[pts.length - 1];

  // Smallest p from which the result is always exact / always has ≥ 1 / ≥ 6 correct digits
  const from = (pred) => {
    let p = null;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].d != null && pred(pts[i].d)) p = pts[i].p; else break;
    }
    return p;
  };
  const exactFrom = from((d) => d === Infinity);
  // Is every step (not only the result) exact from exactFrom on? Otherwise the exact
  // result comes from rounding errors that cancel (x/x with x = 0.1), not from fitting into p bits.
  const allStepsExact = exactFrom != null && rows.every((r) => !r.final || r.p < exactFrom || !r.digits || r.digits.every((d) => d === Infinity));
  const oneFrom = from((d) => d >= 1);
  const sixFrom = from((d) => d >= 6);

  // Largest jump in accuracy between neighbouring precisions (threshold behaviour, e.g. Rump).
  let jump = null;
  for (let i = 1; i < comparable.length; i++) {
    const a = comparable[i - 1].d;
    const b = Math.min(comparable[i].d, fullDigits(comparable[i].p) + 1);
    if (a === Infinity) continue;
    const gain = b - a;
    if (gain > JUMP_DIGITS && (!jump || gain > jump.gain)) jump = { from: comparable[i - 1].p, to: comparable[i].p, gain, dFrom: a, dTo: comparable[i].d };
  }
  // Digits lost by the computation: ideal p·log10(2) minus achieved. Measured in the
  // regular regime: after any threshold jump and after the first correct digit,
  // in the upper half of that sub-range.
  const finitePts = comparable.filter((x) => x.d !== Infinity);
  const start = Math.max(pMin, jump ? jump.to : pMin, oneFrom ?? pMin);
  const regular = finitePts.filter((x) => x.p >= start);
  const upper = regular.filter((x) => x.p >= (start + pMax) / 2);
  const sample = upper.length >= 3 ? upper : regular.length >= 3 ? regular : finitePts;
  // loss = digits of the best possible p-bit result minus the digits achieved
  const bestOf = (x) => (Number.isFinite(x.final.bestDigits) ? capDigits(x.final.bestDigits, fullDigits(x.p)) : fullDigits(x.p));
  const losses = sample.map((x) => bestOf(x) - x.d).sort((a, b) => a - b);
  const loss = losses.length ? losses[Math.floor(losses.length / 2)] : null;

  // Slope of correct digits per bit (least squares over the same sample)
  let slope = null;
  if (sample.length >= 3) {
    const n = sample.length;
    const mx = sample.reduce((s, x) => s + x.p, 0) / n;
    const my = sample.reduce((s, x) => s + x.d, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const x of sample) { sxy += (x.p - mx) * (x.d - my); sxx += (x.p - mx) ** 2; }
    slope = sxx ? sxy / sxx : null;
  }

  // Irregularity: how often the error got noticeably worse with MORE bits
  let drops = 0;
  for (let i = 1; i < comparable.length; i++) {
    const a = comparable[i - 1].d;
    const b = comparable[i].d;
    if (a !== Infinity && b !== Infinity && b < a - DROP_DIGITS) drops++;
  }

  let kind;
  if (last.d === Infinity) kind = 'exact';
  else if (last.d == null) kind = 'special';
  else if (last.d >= 1 && slope != null && slope > SLOPE_CONVERGES) kind = 'converges';
  else if (last.d >= 1) kind = 'convergesSlow';
  else if (slope != null && slope > SLOPE_NOT_YET) kind = 'notYet';
  else kind = 'noTrend';

  // Model-based extrapolation (only used when the range is too short).
  const estimate = (D) => (loss != null ? Math.ceil((D + Math.max(0, loss)) / LOG10_2) : null);
  const fifteenFrom = from((d) => d >= 15);
  return {
    kind, pMin, pMax, exactFrom, allStepsExact, oneFrom, sixFrom, fifteenFrom, loss, slope, drops, jump,
    lastDigits: last.d, lastValue: last.final.value,
    estimate1: oneFrom == null ? estimate(1) : null,
  };
}
