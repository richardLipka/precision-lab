// One consistent set of error measures (src/engine/metrics.js): the ulp of a
// step is the gap between its two neighbours, correct digits are shown capped
// at p·log10 2, and the verdict, the cancellation sentence and the diagnosis
// report the same "digits lost" figure for a step.

import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS, makeFormat, roundFraction, fpToFraction, ulpOf } from '../src/engine/ieee.js';
import { Fraction, dyadic } from '../src/engine/rational.js';
import {
  ulpAround, localError, compareToExact, correctDigits, digitsInfo, capDigits, fullDigits, qualityOf,
  stepDigits, exactLevel, stepsBetween, NOTABLE_DIGITS, QUALITY_GOOD, QUALITY_MID,
} from '../src/engine/metrics.js';
import { explainStep, diagnose } from '../src/engine/explain.js';
import { runSweep, parsePrecisions } from '../src/engine/sweep.js';
import { EXAMPLES } from '../src/ui/examples.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const run = (program, variables = [], formats = [F.binary64], mode = 'RNE') => evaluate({ program, variables, formats, mode });
const item = (ex, code) => ex.items.find((i) => i.code === code);
const numOf = (s) => parseFloat(String(s).replace('−', '-'));

describe('ulp: the gap between the two neighbours', () => {
  it('equals R.above − R.below of the rounding, in every binade and in the subnormal range', () => {
    const values = [];
    for (let k = -30; k <= 30; k++) {
      values.push(new Fraction(1, 10).mul(new Fraction(2).pow(k)));
      values.push(new Fraction(1, 3).mul(new Fraction(2).pow(k)));
      values.push(new Fraction(2).pow(k).sub(new Fraction(2).pow(k - 60))); // just below a power of two
      values.push(new Fraction(2).pow(k).add(new Fraction(2).pow(k - 60))); // just above
    }
    values.push(dyadic(3n, -149 - 2)); // binary32 subnormal range
    values.push(dyadic(5n, -1074 - 3)); // binary64 subnormal range
    for (const fmt of [F.binary16, F.binary32, F.binary64, F.x87]) {
      for (const r of values) {
        for (const x of [r, r.neg()]) {
          const R = roundFraction(x, fmt, 'RNE');
          if (!R.inexact || R.overflow || R.below.kind === 'inf' || R.above.kind === 'inf') continue;
          const gap = fpToFraction(R.above).sub(fpToFraction(R.below));
          expect(ulpAround(x, fmt).equals(gap), `${fmt.id} ${x.toString()}`).toBe(true);
        }
      }
    }
  });

  it('of a representable number is the gap to the next number away from zero', () => {
    for (const x of [new Fraction(1), new Fraction(3, 4), new Fraction(-1024)]) {
      const v = roundFraction(x, F.binary64, 'RNE').value;
      expect(ulpAround(x, F.binary64).equals(ulpOf(v, F.binary64))).toBe(true);
    }
  });

  it('a tie is 0.5 ulp everywhere, also when the exact result lies just below a power of two', () => {
    // 1 − 2^−54 lies halfway between 1 − 2^−53 and 1 (one binade below 1)
    const r = run('a = 1\nb = 0x1p-54\na - b');
    const st = r.steps[r.result];
    const res = st.fmt.binary64;
    const loc = localError(res, F.binary64);
    expect(loc.ulps.equals(new Fraction(1, 2))).toBe(true);
    expect(loc.ulp.equals(dyadic(1n, -53))).toBe(true);
    // the total error against the true value is measured in the same binade
    expect(compareToExact(res.value, st.exact, F.binary64).ulps.equals(new Fraction(1, 2))).toBe(true);
    const ex = explainStep(st, r.steps, F.binary64, 'RNE');
    expect(item(ex, 'round.tie')).toBeTruthy();
    expect(item(ex, 'round.amount').params.ulps).toBe('0.5');
    // half an ulp of the step equals the absorbed 2^−54, not twice that (a tie: the tie variant of absorption)
    expect(item(ex, 'op.absorbTotal')).toBeUndefined();
    expect(item(ex, 'op.absorbTie').params.half).toBe(item(ex, 'round.amount').params.err);
  });

  it('round.amount glosses the ulp and the bound of the rounding mode', () => {
    const r = run('a + b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }]);
    const st = r.steps[r.result];
    const near = item(explainStep(st, r.steps, F.binary64, 'RNE'), 'round.amount').params;
    expect(near.bound).toMatchObject({ key: 'round.boundNearest' });
    expect(numOf(near.ulp) / 2 ** -54).toBeCloseTo(1, 2); // 0.3 lies in [1/4, 1/2): gap 2^−54
    const rz = run('a + b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }], [F.binary64], 'RZ');
    expect(item(explainStep(rz.steps[rz.result], rz.steps, F.binary64, 'RZ'), 'round.amount').params.bound).toMatchObject({ key: 'round.boundDirected' });
  });

  it('the bound sentence never contradicts the numbers next to it (subnormals, overflow to the largest number)', () => {
    const bound = (prog, vars, fmt, mode) => {
      const r = run(prog, vars.split(',').map((kv) => { const [name, value] = kv.split('='); return { name, value }; }), [fmt], mode);
      return item(explainStep(r.steps[r.result], r.steps, fmt, mode), 'round.amount')?.params.bound.key;
    };
    // a·b = 1e−42 is subnormal in float: the relative error is far above 2u, so no relative bound is claimed
    expect(bound('a*b', 'a=1e-30,b=1e-12', F.binary32, 'RZ')).toBe('round.boundDirectedTiny');
    expect(bound('a*b', 'a=1e-30,b=1e-12', F.binary32, 'RNE')).toBe('round.boundNearestTiny');
    // RZ overflow of 16777217 in half gives the largest finite number, far more than 1 ulp away
    expect(bound('c', 'c=16777217', F.binary16, 'RZ')).toBe('round.boundOverflow');
  });
});

describe('correct digits', () => {
  it('are shown capped at p·log10 2, with the raw value kept', () => {
    const r = run('a', [{ name: 'a', value: '0.1' }]);
    const st = r.steps[0];
    const dg = correctDigits(compareToExact(st.fmt.binary64.value, st.exact, F.binary64), F.binary64);
    expect(dg.raw).toBeGreaterThan(16.2); // 0.1 lands unusually close
    expect(dg.shown).toBe(fullDigits(F.binary64));
    expect(dg.capped).toBe(true);
    const ex = explainStep(st, r.steps, F.binary64, 'RNE');
    expect(item(ex, 'verdict.newErrorFull').params).toEqual({ full: '16.0', raw: dg.raw.toFixed(1) });
    expect(item(ex, 'verdict.newError')).toBeUndefined();
  });

  it('represent exact by Infinity and not comparable by null', () => {
    expect(correctDigits({ status: 'exact' }, F.binary64).shown).toBe(Infinity);
    expect(correctDigits({ status: 'both-inf' }, F.binary64).shown).toBe(Infinity);
    expect(correctDigits({ status: 'mismatch' }, F.binary64).shown).toBe(null);
    // compareToExact and rawDigits agree that a mismatch has no digits (not 0)
    const inf = compareToExact({ kind: 'inf', sign: 0 }, { kind: 'finite', r: new Fraction(1) }, F.binary64);
    expect(inf.status).toBe('mismatch');
    expect(inf.digits).toBe(null);
    expect(capDigits(Infinity, 7)).toBe(Infinity);
    expect(digitsInfo(5, 7)).toEqual({ raw: 5, shown: 5, full: 7, capped: false });
  });

  it('use one set of quality thresholds', () => {
    const full = fullDigits(F.binary64);
    expect(qualityOf(Infinity, full)).toBe('q-exact');
    expect(qualityOf(null, full)).toBe('q-bad');
    expect(qualityOf(full * QUALITY_GOOD, full)).toBe('q-good');
    expect(qualityOf(full * QUALITY_MID, full)).toBe('q-mid');
    expect(qualityOf(3, full)).toBe('q-bad'); // 3 of 16 digits is red in every view
    expect(exactLevel(full)).toBeGreaterThan(full);
  });

  it('a step after a cancellation reports one loss figure in the verdict, the κ sentence and the diagnosis', () => {
    const r = run('y = (1 + x) - 1\ny / x', [{ name: 'x', value: '1e-10' }]);
    const st = r.steps.find((s) => s.text === '(1 + x) - 1');
    const ex = explainStep(st, r.steps, F.binary64, 'RNE');
    const lost = item(ex, 'verdict.lost').params.lost;
    expect(item(ex, 'op.cancelAmplify').params.lost).toBe(lost);
    expect(numOf(item(ex, 'op.cancelAmplify').params.est)).toBeGreaterThan(numOf(lost)); // κ is the (upper) estimate
    const dg = diagnose(r, F.binary64);
    expect(dg.losses[0].step.id).toBe(st.id);
    expect(dg.losses[0].lost.toFixed(1)).toBe(lost);
    expect(item(ex, 'verdict.lost').params.from).toBe('16.0'); // capped, not 17.1
  });

  it('no verdict claims more digits than the format holds, and every diagnosed loss matches its step', () => {
    // 'logistic' is skipped only for speed: its exact fractions grow to millions of digits.
    for (const exm of EXAMPLES.filter((e) => e.id !== 'logistic')) {
      for (const fmt of [F.binary32, F.binary64]) {
        const r = evaluate({ program: exm.program, variables: exm.variables, formats: [fmt], mode: 'RNE' });
        const cap = numOf(fullDigits(fmt).toFixed(1));
        const limit = Math.min(r.steps.length, 120);
        for (let i = 0; i < limit; i++) {
          const ex = explainStep(r.steps[i], r.steps, fmt, 'RNE');
          for (const it of ex.items) {
            if (!it.code.startsWith('verdict.')) continue;
            for (const k of ['digits', 'from', 'to']) {
              if (it.params[k] != null && it.params[k] !== '∞') expect(numOf(it.params[k]), `${exm.id} ${fmt.id} #${i} ${it.code}`).toBeLessThanOrEqual(cap);
            }
          }
          const amount = item(ex, 'round.amount');
          if (amount) expect(numOf(amount.params.ulps), `${exm.id} ${fmt.id} #${i}`).toBeLessThanOrEqual(0.5);
          if (amount && item(ex, 'round.tie')) expect(amount.params.ulps).toBe('0.5');
        }
        const dg = diagnose(r, fmt);
        if (dg.final.status === 'approx') expect(dg.digits).toBeLessThanOrEqual(dg.full);
        for (const l of dg.losses) {
          expect(l.lost).toBeGreaterThanOrEqual(NOTABLE_DIGITS);
          const sd = stepDigits(l.step, r.steps, fmt);
          expect(sd.lost).toBeCloseTo(l.lost, 12);
          const ex = explainStep(l.step, r.steps, fmt, 'RNE');
          const v = item(ex, 'verdict.lost') || item(ex, 'verdict.newErrorLost');
          if (v) expect(v.params.lost, `${exm.id} ${fmt.id} #${l.step.id}`).toBe(l.lost.toFixed(1));
        }
      }
    }
  }, 60000);
});

describe('precision sweep uses the same capped digits', () => {
  it('never reports more digits than p bits hold', () => {
    const out = runSweep({ variables: [{ name: 'a', value: '0.1' }], program: 'a * 3', mode: 'RNE', precisions: parsePrecisions('20-60:5'), expBits: null });
    expect(out.analysis.lastDigits).toBeLessThanOrEqual(fullDigits(60));
    // the raw values stay available for tooltips
    expect(out.rows.some((r) => r.final.digits > fullDigits(r.p))).toBe(true);
  });

  it('counts how many representable numbers apart two values are, across binades and zero', () => {
    const d = F.binary64;
    const one = new Fraction(1);
    expect(stepsBetween(one, one, d)).toBe(0);
    expect(stepsBetween(one.sub(dyadic(1n, -53)), one, d)).toBe(1); // neighbours across a power of two
    expect(stepsBetween(one, one.add(dyadic(1n, -52)), d)).toBe(1);
    expect(stepsBetween(one.sub(dyadic(1n, -53)), one.add(dyadic(1n, -52)), d)).toBe(2);
    // subnormals: 0 and the smallest subnormal are neighbours; ±min are 2 apart
    const min = dyadic(1n, d.emin - d.p + 1);
    expect(stepsBetween(new Fraction(0), min, d)).toBe(1);
    expect(stepsBetween(min.neg(), min, d)).toBe(2);
    // agrees with counting nextUp steps in float
    const f = F.binary32;
    let x = new Fraction(3, 10);
    let v = roundFraction(x, f, 'RNE').value;
    const start = fpToFraction(v);
    for (let i = 0; i < 5; i++) v = roundFraction(fpToFraction(v).add(ulpOf(v, f)), f, 'RNE').value;
    expect(stepsBetween(start, fpToFraction(v), f)).toBe(5);
    // unbounded custom format: counted from the lower binade; through zero it is unknown
    const u = makeFormat({ id: 'u', name: 'u', p: 10, expBits: null });
    expect(stepsBetween(new Fraction(1), new Fraction(2), u)).toBe(2 ** 9);
    expect(stepsBetween(new Fraction(-1), new Fraction(1), u)).toBe(null);
  });

  it('a custom format with the same p has the same capacity', () => {
    expect(fullDigits(makeFormat({ id: 'c', name: 'c', p: 53, expBits: 11 }))).toBe(fullDigits(53));
  });
});
