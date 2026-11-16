// Error measures between a simulated FP value and the exact (true) value.

import { log10Abs } from './rational.js';
import { fpToFraction, ulpOf, ulpAtFraction } from './ieee.js'; // ulpOf: local error

const isNum = (v) => v.kind === 'finite' || v.kind === 'zero';

/**
 * Compare an FP value with an exact value.
 * @returns {{status:string, abs?:Fraction, rel?:Fraction|null, ulps?:Fraction, digits?:number, log10Rel?:number}}
 *   status: 'exact' | 'approx' | 'both-nan' | 'both-inf' | 'mismatch'
 *   digits: number of correct significant decimal digits, −log10(relative error)
 */
export function compareToExact(v, x, fmt) {
  if (v.kind === 'nan' && x.kind === 'nan') return { status: 'both-nan' };
  if (v.kind === 'inf' && x.kind === 'inf' && v.sign === x.sign) return { status: 'both-inf' };
  if (!isNum(v) || x.kind !== 'finite') {
    return { status: 'mismatch', digits: 0, log10Rel: Infinity, ulpsApprox: Infinity };
  }
  const a = fpToFraction(v);
  const err = a.sub(x.r);
  const abs = err.abs();
  if (abs.n === 0n) return { status: 'exact', abs, rel: abs, ulps: abs, err, digits: Infinity, log10Rel: -Infinity };
  const rel = x.r.n === 0n ? null : abs.div(x.r.abs());
  // Errors in ulps are meaningless when the true value is 0 (any nonzero result is "infinitely" wrong relatively).
  const ulps = x.r.n === 0n ? null : abs.div(ulpAtFraction(x.r, fmt));
  if (!ulps) {
    return { status: 'approx', err, abs, rel: null, ulps: null, ulpsApprox: Infinity, log10Rel: Infinity, digits: 0 };
  }
  const log10Rel = rel ? log10Abs(rel) : Infinity;
  let digits = Math.max(0, -log10Rel);
  // An irrational reference is only known to `reliable` digits: never claim more.
  const capped = !!x.approx && digits > x.reliable;
  if (capped) digits = x.reliable;
  return {
    status: 'approx',
    err,
    abs,
    rel,
    ulps,
    ulpsApprox: Math.pow(10, log10Abs(ulps)),
    log10Rel,
    digits,
    capped,
  };
}

/** The rounding error committed by one step: rounded − exact result of the operation on the rounded operands. */
export function localError(res, fmt) {
  if (!res.round || !isNum(res.value) || res.exactOp.kind !== 'finite') return null;
  const err = fpToFraction(res.value).sub(res.exactOp.r);
  const abs = err.abs();
  const ulp = ulpOf(res.value.kind === 'zero' ? res.round.below : res.value, fmt);
  return {
    err,
    abs,
    ulps: abs.div(ulp),
    rel: res.exactOp.r.n === 0n ? null : abs.div(res.exactOp.r.abs()),
  };
}
