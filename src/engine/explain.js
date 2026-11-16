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

import { bitLength, floorLog2, fmtFrac, log10Abs, dyadic, toSciParts } from './rational.js';
import { fpToFraction, ulpOf, shortestDecimal, exactShort } from './ieee.js';
import { compareToExact, localError } from './metrics.js';
import { FUNCTION_NAMES } from './real.js';

const FUNCS = new Set(FUNCTION_NAMES);

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
 */
export function conditionNumber(fn, args) {
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
      return Math.max(Math.abs(y), Math.abs(y * Math.log(Math.abs(x))));
    }
    default: return null;
  }
}

const num = (r, d = 3) => (r == null ? '—' : r.n === 0n ? '0' : fmtFrac(r, d, { plainMin: -3, plainMax: 5 }));
const dig = (x) => (x === Infinity ? '∞' : x.toFixed(1));
const key = (k) => ({ key: k });

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

/** Prime factors (other than 2) of the denominator, for the explanation. */
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

function digitsOf(cmp) {
  if (cmp.status === 'exact' || cmp.status === 'both-inf' || cmp.status === 'both-nan') return Infinity;
  if (cmp.status === 'approx') return cmp.rel ? cmp.digits : 0;
  return 0;
}

/**
 * Analyse one step in one format.
 * @returns {{cause:{code:string, params:object, tone:string}, items:{code:string, params:object, tone:string}[], parts?:object}}
 */
export function explainStep(step, steps, fmt, mode) {
  const res = step.fmt[fmt.id];
  const v = res.value;
  const X = step.exact;
  const R = res.round;
  const items = [];
  const push = (code, params = {}, tone = 'info') => items.push({ code, params, tone });
  const full = fmt.p * Math.log10(2);
  const cmp = compareToExact(v, X, fmt);
  let cause = null;
  const setCause = (code, params = {}, tone = 'info') => { if (!cause) cause = { code, params, tone }; };

  // ---- Special values -----------------------------------------------------
  if (res.flags.invalid) {
    push('sp.invalid', { what: res.exactOp.reason || '' }, 'bad');
    setCause('invalid', {}, 'bad');
  }
  if (res.flags.divByZero) {
    push('sp.divzero', {}, 'bad');
    setCause('divzero', {}, 'bad');
  }
  if (res.flags.overflow) {
    push('sp.overflow', { max: exactShort({ kind: 'finite', r: fpToFraction({ kind: 'finite', sign: 0, m: (1n << BigInt(fmt.p)) - 1n, q: fmt.emax - fmt.p + 1 }) }, 5), result: shortestDecimal(v, fmt) }, 'bad');
    setCause('overflow', {}, 'bad');
  }
  if (!isNum(v) && X.kind === 'finite' && !res.flags.overflow && !res.flags.invalid && !res.flags.divByZero) {
    push(v.kind === 'inf' ? 'sp.infInherited' : 'sp.nanInherited', {}, 'bad');
    setCause(v.kind === 'inf' ? 'overflow' : 'invalid', {}, 'bad');
  }
  if (X.kind === 'nan' && isNum(v)) {
    push('sp.exactUndefined', {}, 'bad');
    setCause('invalid', {}, 'bad');
  }
  if (cause && !isNum(v)) return { cause, items, cmp };

  // ---- Conversion of an input or literal ---------------------------------
  if (step.kind !== 'op') {
    if (X.kind !== 'finite') {
      push('conv.special', {}, 'info');
      return { cause: cause || { code: 'exact', params: {}, tone: 'good' }, items, cmp };
    }
    const bits = significantBits(X.r);
    if (!R || !R.inexact) {
      push('conv.exact', { value: step.source ?? step.text, bits: bits === 0 ? 1 : bits, p: fmt.p }, 'good');
      setCause('exact', {}, 'good');
    } else {
      if (X.approx) {
        push('conv.irrational', { value: step.source ?? step.text, p: fmt.p }, 'warn');
      } else if (bits === Infinity) {
        push('conv.periodic', {
          value: step.source ?? step.text,
          bin: binaryExpansion(X.r.abs()),
          factors: oddDenominatorFactors(X.r).join(', '),
          p: fmt.p,
        }, 'warn');
      } else {
        push('conv.tooManyBits', { value: step.source ?? step.text, bits, p: fmt.p, cut: bits - fmt.p }, 'warn');
      }
      if (R.tiny) {
        if (v.kind === 'zero') push('conv.flushZero', { min: num(dyadic(1n, fmt.emin - fmt.p + 1)) }, 'bad');
        else push('conv.subnormal', { minNormal: num(dyadic(1n, fmt.emin)), avail: bitLength(v.m) }, 'warn');
        setCause('underflow', {}, 'warn');
      }
      roundingItems(res, fmt, mode, push);
      setCause('repr', {}, 'warn');
      if (cmp.status === 'approx' && cmp.rel) push('verdict.newError', { digits: dig(cmp.digits), full: dig(full) }, 'info');
    }
    return { cause, items, cmp };
  }

  // ---- Operation ----------------------------------------------------------
  const ops = step.operands.map((id) => steps[id]);
  const opVals = ops.map((o) => o.fmt[fmt.id].value);
  const opCmp = ops.map((o) => compareToExact(o.fmt[fmt.id].value, o.exact, fmt));
  const opDigits = opCmp.map(digitsOf);
  const inherited = opCmp.some((c) => c.status === 'approx' || c.status === 'mismatch');
  const loc = localError(res, fmt);
  const newRounding = !!(R && R.inexact);
  const exactOp = res.exactOp.kind === 'finite' ? res.exactOp.r : null;
  const label = (i) => `#${ops[i].id}`;

  if (FUNCS.has(step.op)) {
    const fn = step.op;
    if (res.exactOp.approx) {
      push(fn === 'sqrt' ? 'fn.sqrt' : fn === 'pow' ? 'fn.pow' : 'fn.transcendental', { fn }, 'info');
      if (res.uncertain) push('fn.uncertain', {}, 'warn');
    } else if (!newRounding && exactOp && !res.flags.invalid && !res.flags.divByZero) {
      push('fn.exact', { fn }, 'good');
    }
    const kappa = conditionNumber(fn, opVals);
    if (kappa != null && Number.isFinite(kappa)) {
      const params = { fn, kappa: kappa >= 1e4 || kappa < 1e-3 ? kappa.toExponential(1) : kappa.toPrecision(3) };
      if (kappa >= 1.5) {
        push(inherited ? 'fn.cond' : 'fn.condNoInput', params, inherited && kappa >= 10 ? 'bad' : 'info');
        if (inherited && kappa >= 10) setCause('cond', { kappa: kappa.toExponential(0).replace('e+', 'e') }, 'bad');
      } else if (inherited && kappa < 0.9) {
        push('fn.condDamp', params, 'good');
      }
    }
  }

  if (step.op === 'neg' || step.op === 'abs') {
    push('op.signExact', {}, 'good');
    if (inherited) {
      push('prop.operands', { list: describeOperands(ops, opDigits) }, 'warn');
      setCause('prop', {}, 'warn');
    } else setCause('exact', {}, 'good');
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
      if (lk >= 0.6) {
        if (inherited) {
          const relIn = Math.max(...opCmp.map((c) => (c.status === 'approx' && c.rel ? Math.pow(10, log10Abs(c.rel)) : 0)));
          const relProp = X.kind === 'finite' && X.r.n !== 0n ? exactOp.sub(X.r).abs().div(X.r.abs()) : null;
          push('op.cancelAmplify', {
            kappa: num(kappa, 2),
            lost: lk.toFixed(1),
            relIn: relIn ? relIn.toExponential(1) : '0',
            relOut: relProp ? num(relProp, 2) : '—',
          }, 'bad');
          setCause('cancel', { kappa: num(kappa, 1) }, 'bad');
        } else {
          push(newRounding ? 'op.cancelBenign' : 'op.cancelExact', { kappa: num(kappa, 2) }, 'good');
        }
      }
    } else if (effSub && S.n === 0n) {
      push(inherited ? 'op.exactZeroLost' : 'op.exactZero', {}, inherited ? 'bad' : 'good');
      if (inherited && X.kind === 'finite' && X.r.n !== 0n) setCause('cancel', { kappa: '∞' }, 'bad');
    }
    // Absorption of the smaller operand
    if (a.n !== 0n && b.n !== 0n) {
      const bigIdx = A.compare(B) >= 0 ? 0 : 1;
      const big = opVals[bigIdx];
      const smallR = bigIdx === 0 ? B : A;
      const ulpBig = ulpOf(big, fmt);
      const half = ulpBig.div(2);
      const eDiff = exponentOfVal(big) - floorLog2(smallR);
      if (smallR.compare(half) <= 0 && v.kind === big.kind && fpToFraction(v).equals(fpToFraction(big))) {
        push('op.absorbTotal', { small: shortestDecimal(opVals[1 - bigIdx], fmt), big: shortestDecimal(big, fmt), half: num(half), sn: label(1 - bigIdx) }, 'bad');
        setCause('absorb', {}, 'bad');
      } else if (newRounding && eDiff > 0) {
        push('op.alignShift', { d: eDiff, sn: label(1 - bigIdx) }, 'info');
      }
    }
    if (newRounding) push('op.addBits', { bits: fmtBits(significantBits(exactOp)), p: fmt.p }, 'info');
  } else if (step.op === '*' && exactOp) {
    if (newRounding) push('op.mulBits', { bits: fmtBits(significantBits(exactOp)), p: fmt.p, p2: 2 * fmt.p }, 'info');
    if (inherited) push('op.relAdd', { list: relList(opCmp, ops), what: key('w.mul') }, 'info');
  } else if (step.op === '/' && exactOp) {
    const bits = significantBits(exactOp);
    if (bits === Infinity) push('op.divPeriodic', { bin: binaryExpansion(exactOp.abs(), 40), factors: oddDenominatorFactors(exactOp).join(', ') }, 'info');
    else if (newRounding) push('op.divBits', { bits, p: fmt.p }, 'info');
    if (inherited) push('op.relAdd', { list: relList(opCmp, ops), what: key('w.div') }, 'info');
  } else if (step.op === 'fma' && exactOp) {
    push(newRounding ? 'op.fmaOnce' : 'op.fmaExact', {}, 'good');
  }

  if (!newRounding && exactOp && exactOp.n !== 0n && !res.flags.overflow && !FUNCS.has(step.op)) {
    const bits = significantBits(exactOp);
    push('op.exact', { bits: bits === 0 ? 1 : bits, p: fmt.p }, 'good');
  }
  if (newRounding) {
    if (R.tiny) {
      if (v.kind === 'zero') push('op.flushZero', {}, 'bad');
      else push('op.subnormal', { minNormal: num(dyadic(1n, fmt.emin)), avail: bitLength(v.m) }, 'warn');
      setCause('underflow', {}, 'warn');
    }
    roundingItems(res, fmt, mode, push);
  }
  if (inherited) push('prop.operands', { list: describeOperands(ops, opDigits) }, 'warn');

  // Error budget: inherited vs new
  let parts = null;
  if (cmp.status === 'approx' && exactOp && X.kind === 'finite' && isNum(v)) {
    const prop = exactOp.sub(X.r);
    const nw = fpToFraction(v).sub(exactOp);
    parts = { prop, nw, total: cmp.err };
    if (inherited && newRounding) {
      const lp = prop.n === 0n ? -Infinity : log10Abs(prop);
      const ln = nw.n === 0n ? -Infinity : log10Abs(nw);
      const dom = lp - ln > 1 ? 'budget.domInherited' : ln - lp > 1 ? 'budget.domNew' : 'budget.domBoth';
      push('budget', { prop: signed(prop), nw: signed(nw), total: signed(cmp.err), dom: key(dom) }, 'info');
    }
  }

  if (newRounding) setCause('round', {}, 'info');
  else if (inherited) setCause('prop', {}, 'warn');
  else setCause('exact', {}, 'good');

  finalVerdict();
  return { cause, items, cmp, parts };

  function finalVerdict() {
    if (cmp.capped) push('ref.capped', { reliable: dig(X.reliable) }, 'warn');
    if (cmp.status === 'exact') { push('verdict.exact', {}, 'good'); return; }
    if (cmp.status !== 'approx') return;
    const dOut = cmp.rel ? cmp.digits : 0;
    const dIn = Math.min(...opDigits);
    if (!cmp.rel) { push('verdict.trueZero', { abs: num(cmp.abs) }, 'warn'); return; }
    if (dIn === Infinity) {
      push('verdict.newError', { digits: dig(dOut), full: dig(full) }, 'info');
    } else if (dIn - dOut > 1) {
      push('verdict.lost', { from: dig(dIn), to: dig(dOut), lost: dig(dIn - dOut) }, 'bad');
    } else if (dOut - dIn > 1) {
      push('verdict.gained', { from: dig(dIn), to: dig(dOut) }, 'info');
    } else {
      push('verdict.kept', { from: dig(dIn), to: dig(dOut) }, 'good');
    }
  }
}

function exponentOfVal(v) {
  return bitLength(v.m) - 1 + v.q;
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

function relList(opCmp, ops) {
  return opCmp.map((c, i) => `#${ops[i].id}: ${c.status === 'approx' && c.rel ? num(c.rel, 2) : '0'}`).join(', ');
}

function roundingItems(res, fmt, mode, push) {
  const R = res.round;
  const loc = localError(res, fmt);
  if (!R || !R.inexact || !loc) return;
  if (R.guard === 1 && !R.sticky) {
    push('round.tie', { mode: key('mode.' + mode), dir: key('dir.' + R.direction) }, 'info');
  }
  push('round.amount', {
    dir: key('dir.' + R.direction),
    err: num(loc.abs),
    ulps: num(loc.ulps, 3),
    rel: loc.rel ? num(loc.rel, 2) : '—',
    u: num(dyadic(1n, -fmt.p), 2),
  }, 'info');
}

/**
 * Which steps cost the most correct digits on the way to the result?
 * Only steps the result actually depends on are considered.
 */
export function diagnose(result, fmt) {
  const steps = result.steps;
  const root = steps[result.result];
  if (!root) return null;
  const full = fmt.p * Math.log10(2);
  const needed = new Set();
  const stack = [root.id];
  while (stack.length) {
    const id = stack.pop();
    if (needed.has(id)) continue;
    needed.add(id);
    for (const o of steps[id].operands) stack.push(o);
  }
  const cap = (d) => Math.min(d, full);
  const digitsCache = new Map();
  const d = (s) => {
    if (!digitsCache.has(s.id)) digitsCache.set(s.id, digitsOf(compareToExact(s.fmt[fmt.id].value, s.exact, fmt)));
    return digitsCache.get(s.id);
  };
  const losses = [];
  for (const id of needed) {
    const s = steps[id];
    const out = cap(d(s));
    const inp = s.kind === 'op' ? Math.min(full, ...s.operands.map((o) => cap(d(steps[o])))) : full;
    const lost = inp - out;
    if (lost > 0.3) losses.push({ step: s, lost, from: inp, to: out });
  }
  losses.sort((a, b) => b.lost - a.lost);
  const final = compareToExact(root.fmt[fmt.id].value, root.exact, fmt);
  // First step (in evaluation order) where the format leaves the finite numbers.
  let origin = null;
  for (const id of [...needed].sort((a, b) => a - b)) {
    const s = steps[id];
    const r = s.fmt[fmt.id];
    if (r.flags.overflow || r.flags.invalid || r.flags.divByZero || (!isNum(r.value) && s.exact.kind === 'finite')) { origin = s; break; }
  }
  return { final, digits: digitsOf(final), full, losses: losses.slice(0, 3), origin };
}
