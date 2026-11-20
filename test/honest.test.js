// Explanations must be true for the case at hand: no lost difference when the
// result is exact, "luck" only when conditioning cannot explain a gain, texts
// aware of the rounding mode and of the subnormal range, the diagnosis traces a
// loss back to the step that destroyed the information, and huge function
// values overflow instead of aborting the program.

import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS, isSubnormal } from '../src/engine/ieee.js';
import { explainStep, diagnose, binaryText, errorSource, sameOperands } from '../src/engine/explain.js';
import { compareToExact, correctDigits, QUALITY_GOOD } from '../src/engine/metrics.js';
import { runSweep, parsePrecisions } from '../src/engine/sweep.js';
import { EXAMPLES } from '../src/ui/examples.js';
import { DICT } from '../src/i18n.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const V = (s) => (s ? s.split(',').map((kv) => { const [name, value] = kv.split('='); return { name, value }; }) : []);
const run = (program, vars = '', formats = [F.binary64], mode = 'RNE') => evaluate({ program, variables: V(vars), formats, mode });
const runEx = (id, formats, mode = 'RNE') => {
  const ex = EXAMPLES.find((e) => e.id === id);
  return evaluate({ program: ex.program, variables: ex.variables, formats, mode });
};
const explain = (r, id, fmt, mode = 'RNE') => explainStep(r.steps[id ?? r.result], r.steps, fmt, mode);
const codes = (ex) => ex.items.map((i) => i.code);
const item = (ex, code) => ex.items.find((i) => i.code === code);

describe('exact results with inexact operands (lucky cancellation)', () => {
  it('sum, float: c − 0.3 is exact, so nothing was lost and the chip is not "inherited"', () => {
    const r = runEx('sum', [F.binary32]);
    const diff = r.steps.find((s) => s.text === 'c - 0.3').id; // the example ends with the test c == 0.3
    const ex = explain(r, diff, F.binary32);
    expect(codes(ex)).not.toContain('op.exactZeroLost');
    expect(codes(ex)).not.toContain('prop.operands');
    expect(codes(ex)).toContain('prop.lucky');
    expect(codes(ex)).toContain('verdict.exact');
    expect(ex.cause.code).toBe('lucky');
  });

  it('x − x with x = 0.1: the same computation, so the exact 0 is certain, not luck', () => {
    for (const prog of ['x - x', '(x*3) - (x*3)', 'y = x*3\ny - x*3', 'sin(x) - sin(x)']) {
      for (const fmt of [F.binary32, F.binary64]) {
        const ex = explain(run(prog, 'x=0.1', [fmt]), null, fmt);
        expect(codes(ex), prog).toEqual(expect.arrayContaining(['op.exactZero', 'prop.same', 'verdict.exact']));
        expect(codes(ex), prog).not.toContain('prop.lucky');
        expect(codes(ex), prog).not.toContain('op.exactZeroLost');
        expect(ex.cause.code, prog).toBe('cancelSame');
      }
    }
    // different computations that happen to round alike stay luck
    const r = run('(x*3) - (3*x + 0)', 'x=0.1', [F.binary32]);
    expect(sameOperands(r.steps[r.result], r.steps)).toBe(false);
    const c = run('x*3 - 3*x', 'x=0.1');
    expect(sameOperands(c.steps[c.result], c.steps)).toBe(true); // · commutes
  });

  it('a + (−a) cancels by construction in modes that treat both signs alike, and the diagnosis says so', () => {
    const r = runEx('assoc', [F.binary32]);
    const ab = r.steps.find((s) => s.text === '(a + b)');
    const ex = explain(r, ab.id, F.binary32);
    expect(codes(ex)).toContain('prop.opposite');
    expect(codes(ex)).not.toContain('prop.lucky');
    expect(ex.cause.code).toBe('cancelSame');
    expect(diagnose(r, F.binary32, { root: r.env.left }).exactBy).toBe('construction');
    // RU rounds 10²⁰ and −10²⁰ differently: no cancellation, nothing claimed
    const ru = runEx('assoc', [F.binary32], 'RU');
    expect(codes(explain(ru, ab.id, F.binary32, 'RU'))).not.toContain('prop.opposite');
    // two unrelated values that happen to round alike stay luck
    const sum = runEx('sum', [F.binary32]);
    expect(diagnose(sum, F.binary32).exactBy).toBe('luck');
  });

  it('float assoc: the loss is traced to the absorption in (b + c), not to the shared representation error of 10²⁰', () => {
    const r = runEx('assoc', [F.binary32]);
    const right = r.steps.at(-1);
    expect(errorSource(right, r.steps, F.binary32).id).toBe(5);
    expect(diagnose(r, F.binary32).losses[0].source.id).toBe(5);
  });

  it('a real loss is still reported and traced back to the absorption (lost at #5, revealed at #6)', () => {
    const r = runEx('assoc', [F.binary64]);
    const ex = explain(r, null, F.binary64);
    expect(codes(ex)).toContain('op.exactZeroLost');
    const at = item(ex, 'op.lostAt');
    expect(at.params.id).toBe(5);
    expect(at.params.cause.key).toBe('cause.absorb');
    const dg = diagnose(r, F.binary64);
    expect(dg.losses[0].step.id).toBe(6);
    expect(dg.losses[0].source.id).toBe(5);
    expect(errorSource(r.steps[6], r.steps, F.binary64).id).toBe(5);
  });
});

describe('gains of digits: luck only when conditioning does not explain them', () => {
  it('a damping function is not luck', () => {
    const ex = explain(run('x = (a + b) - a\nexp(x)', 'a=1,b=1e-10'), null, F.binary64);
    expect(codes(ex)).toContain('fn.condDamp');
    expect(codes(ex)).toContain('verdict.gainedDamped');
    expect(codes(ex)).not.toContain('verdict.gained');
  });

  it('a small inexact addend next to a large exact number is not luck', () => {
    const ex = explain(run('x = (a + b) - a\n1000 + x', 'a=1,b=1e-10'), null, F.binary64);
    expect(codes(ex)).toContain('verdict.gainedDiluted');
  });

  it('a quotient of two equally wrong numbers gains by compensation (luck)', () => {
    const ex = explain(run('x = (1 + t) - 1\ny = (3 + 3*t) - 3\nx / y', 't=1e-10'), null, F.binary64);
    expect(codes(ex)).toContain('verdict.gained');
    // the signed relative errors are listed: equal signs cancel in a quotient
    expect(item(ex, 'op.relDiv').params.list).toMatch(/#\d+: \+.*#\d+: \+/);
  });

  it('"accuracy is roughly kept" is green only when there is accuracy to keep', () => {
    const r = runEx('cancel', [F.binary32]);
    const ex = explain(r, null, F.binary32);
    const k = item(ex, 'verdict.keptLow');
    expect(k).toBeTruthy();
    expect(k.tone).toBe('bad');
  });
});

describe('cause chip follows the error budget', () => {
  it('inherited error dominating a rounded step gives "inherited", comparable parts "inherited + rounding"', () => {
    const r = run('d = (1 + t) - 1\nd * 3', 't=1e-10');
    expect(explain(r, null, F.binary64).cause.code).toBe('prop');
    const s = runEx('sum', [F.binary32]);
    expect(explain(s, 2, F.binary32).cause.code).toBe('propRound');
    const n = run('x = (a + b) - a\n1000 + x', 'a=1,b=1e-10');
    expect(explain(n, null, F.binary64).cause.code).toBe('round');
  });
});

describe('cancellation wording', () => {
  it('κ below 100 is a mild cancellation, with the same κ in chip and text', () => {
    const ex = explain(run('a = x*1\nb = x*1.125\na - b', 'x=0.1'), null, F.binary64);
    const mild = item(ex, 'op.cancelMild');
    expect(mild.tone).toBe('warn');
    expect(codes(ex)).not.toContain('op.cancelAmplify');
    expect(ex.cause.code).toBe('cancel');
    expect(ex.cause.params.kappa).toBe(mild.params.kappa);
  });

  it('Sterbenz is justified by the operands being within a factor of 2; the unreachable benign text is gone', () => {
    const ex = explain(run('a - b', 'a=1.5,b=1.25'), null, F.binary64);
    expect(codes(ex)).toContain('op.cancelExact');
    expect(DICT.en['op.cancelExact']).toContain('y/2 ≤ x ≤ 2y');
    expect(DICT.en['op.cancelBenign']).toBeUndefined();
  });
});

describe('special values', () => {
  it('a division by a zero that only underflowed: finite true value, origin at the underflow', () => {
    const r = run('z = -a * a\nw = 1/z', 'a=1e-30', [F.binary32]);
    const ex = explain(r, 4, F.binary32);
    expect(codes(ex)).toContain('sp.divzeroFalse');
    expect(codes(ex)).not.toContain('sp.divzero');
    expect(ex.cause.code).toBe('zeroDivisor');
    const dg = diagnose(r, F.binary32);
    expect(dg.origin.id).toBe(2);
    expect(dg.revealed.id).toBe(4);
  });

  it('−0, NaN propagation and the special-values example', () => {
    const r = run('a - a\n1/z', 'z=-0,a=nan');
    expect(codes(explain(r, 0, F.binary64))).toContain('conv.negZero');
    const nan = r.steps.find((s) => s.text === 'a - a');
    expect(codes(explain(r, nan.id, F.binary64))).toContain('sp.nanPropagates');
    const sp = runEx('special', [F.binary64, F.binary32]);
    expect(sp.steps[sp.result].fmt.binary64.value.kind).toBe('nan');
  });
});

describe('subnormals and directed rounding', () => {
  const why = (ex) => (item(ex, 'conv.flushZero') || item(ex, 'op.flushZero')).params.why.key;
  it('flush to zero names the tie, the half and the directed case correctly', () => {
    expect(why(explain(run('x', 'x=0x1p-25', [F.binary16]), 0, F.binary16))).toBe('flush.tie');
    expect(why(explain(run('x', 'x=0x1p-26', [F.binary16]), 0, F.binary16))).toBe('flush.half');
    const rz = run('x', 'x=0x1.8p-25', [F.binary16], 'RZ');
    expect(why(explain(rz, 0, F.binary16, 'RZ'))).toBe('flush.directed');
    const mul = run('a * b', 'a=0x1.f8p-20,b=0x1p-5', [F.binary16], 'RZ');
    expect(why(explain(mul, null, F.binary16, 'RZ'))).toBe('flush.directed');
  });

  it('no bits-versus-p sentence (negative bit counts) in the subnormal range', () => {
    const c = explain(run('x', 'x=0x1.8p-1075'), 0, F.binary64);
    expect(codes(c)).not.toContain('conv.tooManyBits');
    expect(item(c, 'conv.subnormal').params.p).toBe(53);
    const m = explain(run('x*y', 'x=0x1p-20,y=0x1.8p-6', [F.binary16]), null, F.binary16);
    expect(codes(m)).not.toContain('op.mulBits');
  });

  it('every bit-count sentence over the examples claims more bits than p, also under RZ', () => {
    for (const mode of ['RNE', 'RZ']) {
      for (const id of ['sum', 'repr', 'range', 'cancel', 'fma', 'special']) {
        const fmts = [F.binary16, F.binary32, F.binary64];
        const r = runEx(id, fmts, mode);
        for (const s of r.steps) {
          for (const f of fmts) {
            const ex = explainStep(s, r.steps, f, mode, { trace: false });
            for (const it of ex.items) {
              if (['conv.tooManyBits', 'op.addBits', 'op.mulBits', 'op.divBits'].includes(it.code)) {
                expect(it.params.bits === '∞' || Number(it.params.bits) > f.p, `${id} ${f.id} #${s.id}`).toBe(true);
              }
              if (it.code === 'conv.tooManyBits') expect(it.params.cut).toBeGreaterThan(0);
              // the cut-off: a whole step's verdict never contradicts an exact result
              if (it.code === 'op.exactZeroLost' || it.code === 'prop.operands') {
                expect(compareToExact(s.fmt[f.id].value, s.exact, f).status, `${id} ${f.id} #${s.id}`).not.toBe('exact');
              }
              if (it.code === 'verdict.kept') {
                const d = correctDigits(compareToExact(s.fmt[f.id].value, s.exact, f), f);
                expect(d.shown / d.full).toBeGreaterThanOrEqual(QUALITY_GOOD);
              }
              if ((it.code === 'conv.flushZero' || it.code === 'op.flushZero') && mode === 'RZ') expect(it.params.why.key).toBe('flush.directed');
            }
          }
        }
      }
    }
  }, 60000);

  it('tiny and huge values get a binary scientific expansion, not 80 zeros', () => {
    const ex = explain(run('d', 'd=1e-40', [F.binary32]), 0, F.binary32);
    const p = item(ex, 'conv.periodic').params;
    expect(p.bin).toMatch(/^1\.[01]+…?₂ × 2⁻¹³³$/);
    expect(p.keep.key).toBe('conv.keepTiny');
    // near 1 the positional form stays
    expect(binaryText(run('x', 'x=0.1').steps[0].exact.r)).toBe('0.0(0011)₂');
  });

  it('a denominator with only large prime factors is described in words', () => {
    const ex = explain(run('x / y', 'x=1,y=211'), null, F.binary64);
    expect(item(ex, 'op.divPeriodic').params.factors.key).toBe('factor.large');
  });

  it('absorption: tie variant and directed-rounding variant', () => {
    const t = explain(run('b + c', 'b=-1e16,c=1'), null, F.binary64);
    expect(codes(t)).toContain('op.absorbTie');
    // 2²⁴ + 1 in float (intLimit example, step (f + 1)) is a tie as well
    const il = runEx('intLimit', [F.binary32]);
    const f1 = il.steps.find((s) => s.text === '(f + 1)').id;
    expect(codes(explain(il, f1, F.binary32))).toContain('op.absorbTie');
    const rz = run('a + b', 'a=1e16,b=1.5', [F.binary64], 'RZ');
    expect(codes(explain(rz, null, F.binary64, 'RZ'))).toContain('op.absorbDirected');
  });
});

describe('functions', () => {
  it('log10 is not attributed to Lindemann–Weierstrass; ln excludes r = 1', () => {
    expect(codes(explain(run('log10(x)', 'x=2'), null, F.binary64))).toContain('fn.log10');
    expect(item(explain(run('ln(x)', 'x=2'), null, F.binary64), 'fn.transcendental').params.r0).toBe('1');
    expect(item(explain(run('exp(x)', 'x=2'), null, F.binary64), 'fn.transcendental').params.r0).toBe('0');
  });

  it('huge function values overflow instead of aborting the program', () => {
    const r = run('exp(x)', 'x=1000000', [F.binary64, F.binary32]);
    const res = r.steps[r.result].fmt.binary64;
    expect(res.value.kind).toBe('inf');
    expect(res.flags.overflow).toBe(true);
    const ex = explain(r, null, F.binary64);
    expect(codes(ex)).toEqual(expect.arrayContaining(['ref.beyondHuge', 'sp.overflow']));
    // toward zero: the largest finite number, still with the overflow flag
    const rz = run('exp(x)', 'x=1000000', [F.binary64], 'RZ').steps[1].fmt.binary64;
    expect(rz.value.kind).toBe('finite');
    expect(rz.flags.overflow).toBe(true);
    // a tiny value underflows
    const tiny = run('exp(x)', 'x=-1000000', [F.binary64]).steps[1].fmt.binary64;
    expect(tiny.value.kind).toBe('zero');
    expect(tiny.flags.underflow).toBe(true);
  });

  it('a true value beyond the reference range is never called exact, 0 or ∞', () => {
    for (const mode of ['RNE', 'RU', 'RZ']) {
      for (const x of ['-1000000', '1000000']) {
        const r = run('y = exp(x)\ny * 2', `x=${x}`, [F.binary64], mode);
        for (const st of r.steps.slice(1)) {
          if (st.kind !== 'op' || st.op === 'convert' || !st.exact.beyond) continue;
          const cmp = compareToExact(st.fmt.binary64.value, st.exact, F.binary64);
          expect(cmp.status, `${x} ${mode} #${st.id}`).toBe('mismatch');
          expect(cmp.beyond).toBe(x.startsWith('-') ? 'tiny' : 'huge');
          const c = codes(explain(r, st.id, F.binary64, mode));
          for (const bad of ['verdict.exact', 'verdict.trueZero', 'sp.infPropagates']) expect(c, `${x} ${mode} #${st.id}`).not.toContain(bad);
          // the rounding of a stand-in exact result cannot be measured (y * 2 rounds a measurable 2·y)
          if (st.fmt.binary64.exactOp.beyond) expect(c, `${x} ${mode} #${st.id}`).not.toContain('round.amount');
        }
        const dg = diagnose(r, F.binary64);
        expect(dg.final.status, `${x} ${mode}`).toBe('mismatch');
        expect(dg.final.beyond).toBeTruthy();
      }
    }
    // the step that leaves the range says why it is not compared
    const c = codes(explain(run('exp(x)', 'x=-1000000'), null, F.binary64));
    expect(c).toEqual(expect.arrayContaining(['ref.beyondTiny', 'verdict.beyond']));
  });

  it('the compound-interest example runs under RU (bfloat16 overflows in pow)', () => {
    const r = runEx('compound', [F.bfloat16, F.binary64], 'RU');
    const pow = r.steps.find((s) => s.op === 'pow');
    expect(pow.fmt.bfloat16.value.kind).toBe('inf');
    expect(pow.fmt.bfloat16.flags.overflow).toBe(true);
    expect(pow.fmt.binary64.value.kind).toBe('finite');
  });
});

describe('diagnosis of accumulated rounding', () => {
  it('the loop example is not called the best possible result', () => {
    const r = runEx('loop', [F.binary64]);
    const dg = diagnose(r, F.binary64);
    expect(dg.losses).toEqual([]);
    expect(dg.bestPossible).toBe(false);
    expect(dg.rounded).toBe(9);
    expect(dg.ulps).toBeCloseTo(0.5, 9);
    // 0.9999999999999999 is the neighbour of 1, although only half an ulp of 1 away
    expect(dg.apart).toBe(1);
    expect(dg.best.kind).toBe('finite');
  });

  it('a single correctly rounded result is the best possible', () => {
    const dg = diagnose(run('a / b', 'a=1,b=3'), F.binary64);
    expect(dg.bestPossible).toBe(true);
  });
});

describe('precision sweep: exact result', () => {
  it('x/x with x = 0.1 is exact only because the errors cancel', () => {
    const out = runSweep({ variables: V('x=0.1'), program: 'x / x', mode: 'RNE', precisions: parsePrecisions('2-20'), expBits: null });
    expect(out.analysis.kind).toBe('exact');
    expect(out.analysis.allStepsExact).toBe(false);
    const ok = runSweep({ variables: [], program: '0.5 + 0.25', mode: 'RNE', precisions: parsePrecisions('1-10'), expBits: null });
    expect(ok.analysis.allStepsExact).toBe(true);
  });

  it('sweep handles beyond-range true values honestly and computes relText', () => {
    const beyond = runSweep({ variables: [], program: 'exp(-1000000)', mode: 'RNE', precisions: [24, 53], expBits: 11 });
    expect(beyond.meta.exact).toContain('10^−100000');
    expect(beyond.rows[0].final.status).toBe('mismatch');
    expect(beyond.rows[0].final.digits).toBeNull();
    expect(beyond.rows[0].final.bestDigits).toBeNull();
    const normal = runSweep({ variables: V('a=0.1,b=0.2'), program: 'a + b', mode: 'RNE', precisions: [24, 53], expBits: 11 });
    expect(normal.rows[0].final.relText).toBeTruthy();
    expect(normal.rows[0].final.bestRelText).toBeTruthy();
  });
});

describe('automatic explainer truthfulness across edge cases and full example matrix', () => {
  it('detects absorption when the second operand of subtraction is the huge one (1 - 1e20)', () => {
    const ex = explain(run('1 - 1e20'), null, F.binary64);
    expect(ex.cause.code).toBe('absorb');
    expect(codes(ex)).toContain('op.absorbTotal');
  });

  it('never reports cancellation on an exact result (1.6 - 1.1 and 1.1 - 1.0990234375 in float)', () => {
    for (const prog of ['1.6 - 1.1', '1.1 - 1.0990234375']) {
      const ex = explain(run(prog, '', [F.binary32]), null, F.binary32);
      expect(codes(ex), prog).not.toContain('op.cancelAmplify');
      expect(codes(ex), prog).not.toContain('op.cancelMild');
      expect(codes(ex), prog).toContain('verdict.exact');
      expect(ex.cause.code, prog).toBe('lucky');
    }
  });

  it('does not call a value rounded up to minNormal a subnormal number', () => {
    const conv = explain(run('x', 'x=0x1.ffcp-15', [F.binary16]), 0, F.binary16);
    expect(codes(conv)).toContain('conv.roundToMinNormal');
    expect(codes(conv)).not.toContain('conv.subnormal');
    // Both operands are exact normal binary16 numbers; their product 0x1.ffcp-15 = 2^-14 - 2^-25
    // lies just below minNormal and rounds up to normal 2^-14 in RNE.
    const op = explain(run('a * b', 'a=0x1.ffcp-10,b=0x1p-5', [F.binary16]), null, F.binary16);
    expect(codes(op)).toContain('op.roundToMinNormal');
    expect(codes(op)).not.toContain('op.subnormal');
  });

  it('classifies x / x, 0 * x, x * 0 and 0 / x as exact by construction, not luck', () => {
    for (const [prog, wantCode, wantCause] of [
      ['x / x', 'prop.same', 'cancelSame'],
      ['0 * x', 'prop.zeroAbsorb', 'exact'],
      ['x * 0', 'prop.zeroAbsorb', 'exact'],
      ['0 / x', 'prop.zeroAbsorb', 'exact'],
    ]) {
      const r = run(prog, 'x=0.1');
      const ex = explain(r, null, F.binary64);
      expect(codes(ex), prog).toContain(wantCode);
      expect(codes(ex), prog).not.toContain('prop.lucky');
      expect(ex.cause.code, prog).toBe(wantCause);
      expect(diagnose(r, F.binary64).exactBy, prog).toBe('construction');
    }
  });

  it('pow condition number reflects which operand carries error and never contradicts verdict.gainedDamped', () => {
    const r1 = run('pow(x, 0.5)', 'x=1e-20');
    const ex1 = explain(r1, null, F.binary64);
    expect(codes(ex1)).toContain('fn.condDamp');
    expect(codes(ex1)).not.toContain('fn.cond');

    const r2 = run('x = (1e-100 + 1e-108) - 1e-100\npow(x, 0.01)');
    const ex2 = explain(r2, null, F.binary64);
    expect(codes(ex2)).toContain('fn.condDamp');
    expect(codes(ex2)).not.toContain('fn.cond');
    expect(codes(ex2)).toContain('verdict.gainedDamped');
  });

  it('explains fma cancellation, fma absorption, and does not duplicate op.exact after op.fmaExact', () => {
    const canc = explain(run('x = 1 + 1e-10\nfma(x, 1, -1)'), null, F.binary64);
    expect(canc.cause.code).toBe('cancel');
    expect(codes(canc)).toContain('op.cancelAmplify');

    const abs1 = explain(run('fma(1e20, 1, 1)'), null, F.binary64);
    expect(abs1.cause.code).toBe('absorb');
    expect(codes(abs1)).toContain('op.absorbTotal');

    const abs2 = explain(run('fma(1, 1, 1e20)'), null, F.binary64);
    expect(abs2.cause.code).toBe('absorb');
    expect(codes(abs2)).toContain('op.absorbTotal');

    const ex = explain(run('fma(1, 2, 3)'), null, F.binary64);
    expect(codes(ex)).toContain('op.fmaExact');
    expect(codes(ex)).not.toContain('op.exact');
  });

  it('diagnosis classifies well-separated comparisons (equality in double RNE, 0.1 < 1) as margin, not luck', () => {
    const eq = runEx('equality', [F.binary64], 'RNE');
    expect(diagnose(eq, F.binary64).exactBy).toBe('margin');
    const lt = run('0.1 < 1');
    expect(diagnose(lt, F.binary64).exactBy).toBe('margin');
  });

  it('leads with the primary error cause and omits irrelevant noise bullets (flushZero, absorb, cond, doubleRound)', () => {
    // Underflow flush-to-zero leads with op.flushZero and suppresses irrelevant op.relMul / round.amount / budget
    const range = runEx('range', [F.binary32]);
    const yy = range.steps.find((s) => s.text === 'y*y');
    const uEx = explain(range, yy.id, F.binary32);
    expect(codes(uEx)[0]).toBe('op.flushZero');
    expect(codes(uEx)).not.toContain('op.relMul');
    expect(codes(uEx)).not.toContain('round.amount');
    expect(codes(uEx)).not.toContain('budget');

    // Absorption warns about hidden damage instead of praising full format precision
    const assoc = runEx('assoc', [F.binary64]);
    const bc = assoc.steps.find((s) => s.text === '(b + c)');
    const aEx = explain(assoc, bc.id, F.binary64);
    expect(codes(aEx)[0]).toBe('op.absorbTotal');
    expect(codes(aEx)).toContain('verdict.absorbedWarning');
    expect(codes(aEx)).not.toContain('verdict.newErrorFull');
    expect(codes(aEx)).not.toContain('op.addBits');

    // Ill-conditioned function leads with conditioning + error source before generic transcendental note
    const sb = runEx('sinBig', [F.binary32]);
    const sEx = explain(sb, sb.result, F.binary32);
    expect(codes(sEx)[0]).toBe('fn.cond');
    expect(codes(sEx)[1]).toBe('op.lostAt');

    // Double rounding leads with cast.doubleRounding as bullet #1
    const dr = runEx('doubleRound', [F.x87]);
    const dEx = explain(dr, dr.result, F.x87);
    expect(codes(dEx)[0]).toBe('cast.doubleRounding');
    expect(codes(dEx)).not.toContain('cast.what');
  });

  it('holds universal explainer invariants across built-in examples, all 6 formats and all 5 rounding modes', () => {
    const modes = ['RNE', 'RNA', 'RZ', 'RU', 'RD'];
    const heavy = new Set(['order', 'kahansum', 'taylor', 'recurrence', 'golden', 'muller', 'logistic']);
    for (const ex of EXAMPLES) {
      // Heavy multi-iteration loops are tested in RNE (2000+ steps in order/kahansum); all 18 other examples across all 5 modes
      const exModes = heavy.has(ex.id) ? ['RNE'] : modes;
      for (const mode of exModes) {
        const r = evaluate({ program: ex.program, variables: ex.variables, formats: FORMATS, mode });
        for (const f of FORMATS) {
          diagnose(r, f);
          for (const st of r.steps) {
            const exp = explainStep(st, r.steps, f, mode, { trace: false });
            const c = codes(exp);
            const res = st.fmt[f.id];
            const cmp = exp.cmp;
            const tag = `${ex.id} ${f.id} ${mode} #${st.id}`;
            if (c.includes('conv.subnormal') || c.includes('op.subnormal')) {
              expect(isSubnormal(res.value, f), tag).toBe(true);
            }
            if (cmp.status === 'exact') {
              expect(c, tag).not.toContain('op.cancelAmplify');
              expect(c, tag).not.toContain('op.cancelMild');
              expect(c, tag).not.toContain('op.exactZeroLost');
              expect(c, tag).not.toContain('prop.operands');
            }
            if (st.exact.beyond) {
              expect(c, tag).not.toContain('verdict.exact');
            }
            expect(c.includes('fn.cond') && c.includes('verdict.gainedDamped'), tag).toBe(false);
            expect(c.includes('op.fmaExact') && c.includes('op.exact'), tag).toBe(false);
            if (res.round?.direction === 'exact') {
              expect(c, tag).not.toContain('round.amount');
            }
          }
        }
      }
    }
  }, 60000);
});
