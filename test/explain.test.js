import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS, makeFormat } from '../src/engine/ieee.js';
import { explainStep, diagnose, binaryExpansion, significantBits } from '../src/engine/explain.js';
import { runSweep, parsePrecisions } from '../src/engine/sweep.js';
import { Fraction } from '../src/engine/rational.js';
import { engineErrorText } from '../src/engine/messages.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const run = (program, variables = [], formats = [F.binary64]) => evaluate({ program, variables, formats, mode: 'RNE' });
const codes = (ex) => ex.items.map((i) => i.code);

describe('helpers', () => {
  it('binary expansion with period', () => {
    expect(binaryExpansion(new Fraction(1, 10))).toBe('0.0(0011)');
    expect(binaryExpansion(new Fraction(1, 3))).toBe('0.(01)');
    expect(binaryExpansion(new Fraction(5, 4))).toBe('1.01');
  });
  it('significant bits', () => {
    expect(significantBits(new Fraction(16777217))).toBe(25);
    expect(significantBits(new Fraction(3, 8))).toBe(2);
    expect(significantBits(new Fraction(1, 10))).toBe(Infinity);
  });
});

describe('explanations', () => {
  it('0.1 is a periodic binary fraction (representation error)', () => {
    const r = run('a', [{ name: 'a', value: '0.1' }]);
    const ex = explainStep(r.steps[0], r.steps, F.binary64, 'RNE');
    expect(ex.cause.code).toBe('repr');
    expect(codes(ex)).toContain('conv.periodic');
    expect(ex.items.find((i) => i.code === 'conv.periodic').params.factors).toBe('5');
  });

  it('16777217 needs 25 bits in float', () => {
    const r = run('a', [{ name: 'a', value: '16777217' }], [F.binary32]);
    const ex = explainStep(r.steps[0], r.steps, F.binary32, 'RNE');
    expect(codes(ex)).toContain('conv.tooManyBits');
    expect(codes(ex)).toContain('round.tie');
  });

  it('cancellation amplifies inherited errors', () => {
    const r = run('y = (1 + x) - 1', [{ name: 'x', value: '1e-10' }]);
    const st = r.steps[r.result];
    const ex = explainStep(st, r.steps, F.binary64, 'RNE');
    expect(ex.cause.code).toBe('cancel');
    expect(codes(ex)).toContain('op.cancelAmplify');
    expect(codes(ex)).toContain('verdict.lost');
  });

  it('exact cancellation of exact operands is harmless (Sterbenz)', () => {
    const r = run('a - b', [{ name: 'a', value: '1.5' }, { name: 'b', value: '1.25' }]);
    const ex = explainStep(r.steps[r.result], r.steps, F.binary64, 'RNE');
    expect(ex.cause.code).toBe('exact');
  });

  it('absorption: 1e16 + 1 = 1e16 in double', () => {
    const r = run('a + 1', [{ name: 'a', value: '1e16' }]);
    const ex = explainStep(r.steps[r.result], r.steps, F.binary64, 'RNE');
    expect(ex.cause.code).toBe('absorb');
  });

  it('overflow and inherited infinity', () => {
    const r = run('y = x*x*x\ny / x', [{ name: 'x', value: '1e20' }], [F.binary32]);
    const st = r.steps.find((s) => s.fmt.binary32.flags.overflow);
    expect(explainStep(st, r.steps, F.binary32, 'RNE').cause.code).toBe('overflow');
    const dg = diagnose(r, F.binary32);
    expect(dg.final.status).toBe('mismatch');
    expect(dg.origin.id).toBe(st.id);
  });

  it('subnormal result', () => {
    const r = run('a * a', [{ name: 'a', value: '1e-20' }], [F.binary32]);
    const ex = explainStep(r.steps[r.result], r.steps, F.binary32, 'RNE');
    expect(ex.cause.code).toBe('underflow');
  });

  it('diagnosis points at the cancellation in the variance example', () => {
    const r = run('m = (x1 + x2 + x3) / 3\nm2 = (x1^2 + x2^2 + x3^2) / 3\nvar = m2 - m^2',
      [{ name: 'x1', value: '100000001' }, { name: 'x2', value: '100000002' }, { name: 'x3', value: '100000003' }], [F.binary32]);
    const dg = diagnose(r, F.binary32);
    expect(dg.losses[0].step.id).toBe(r.result);
  });

  it('engine errors translate to Czech', () => {
    try {
      run('a + * b', [{ name: 'a', value: '1' }, { name: 'b', value: '1' }]);
    } catch (e) {
      expect(engineErrorText(e, 'cs')).toMatch(/^Řádek 1, sloupec 5: neočekávaný symbol '\*'/);
      return;
    }
    throw new Error('expected a parse error');
  });
});

describe('precision sweep', () => {
  it('parses precision lists', () => {
    expect(parsePrecisions('1-5')).toEqual([1, 2, 3, 4, 5]);
    expect(parsePrecisions('10-30:10, 53')).toEqual([10, 20, 30, 53]);
    expect(() => parsePrecisions('1-5000')).toThrow();
    expect(() => parsePrecisions('abc')).toThrow();
  });

  it("Rump's example needs 122 bits", () => {
    const out = runSweep({
      variables: [{ name: 'a', value: '77617' }, { name: 'b', value: '33096' }],
      program: '333.75*b^6 + a^2*(11*a^2*b^2 - b^6 - 121*b^4 - 2) + 5.5*b^8 + a/(2*b)',
      mode: 'RNE', precisions: parsePrecisions('100-160'), expBits: null,
    });
    expect(out.analysis.oneFrom).toBe(122);
    expect(out.analysis.jump.to).toBe(122);
    expect(out.analysis.kind).toBe('converges');
    expect(Math.abs(out.analysis.slope - Math.log10(2))).toBeLessThan(0.02);
  });

  it('cancellation (1 + x) − 1 loses about 10 digits at every precision', () => {
    const out = runSweep({ variables: [{ name: 'x', value: '1e-10' }], program: 'y = (1 + x) - 1\ny / x', mode: 'RNE', precisions: parsePrecisions('40-200'), expBits: null });
    expect(out.analysis.loss).toBeGreaterThan(9);
    expect(out.analysis.loss).toBeLessThan(11);
  });

  it('exact computations are recognised', () => {
    const out = runSweep({ variables: [], program: '0.5 + 0.25', mode: 'RNE', precisions: parsePrecisions('1-10'), expBits: null });
    expect(out.analysis.kind).toBe('exact');
    expect(out.analysis.exactFrom).toBe(2);
  });

  it('p = 1 works', () => {
    const f = makeFormat({ id: 'p1', name: 'p1', p: 1, expBits: null });
    const r = evaluate({ program: 'a + b', variables: [{ name: 'a', value: '3' }, { name: 'b', value: '0.1' }], formats: [f], mode: 'RNE' });
    expect(r.steps[r.result].fmt.p1.value.kind).toBe('finite');
  });
});

describe('precision sweep reference lines', () => {
  it('the computed error is never below the best possible p-bit result, and the rel/abs curves differ only by log10|x|', async () => {
    const { EXAMPLES } = await import('../src/ui/examples.js');
    for (const id of ['loop', 'harmonic', 'cancel', 'rump', 'needle', 'golden']) {
      const ex = EXAMPLES.find((e) => e.id === id);
      const out = runSweep({ variables: ex.variables, program: ex.program, mode: 'RNE', precisions: parsePrecisions('5-80:5'), expBits: null });
      for (const r of out.rows) {
        const f = r.final;
        if (f.status === 'approx' && Number.isFinite(f.bestLog10Abs)) {
          expect(f.log10Abs, `${id} p=${r.p}`).toBeGreaterThanOrEqual(f.bestLog10Abs - 1e-9);
        }
        if (f.status === 'approx' && Number.isFinite(f.log10Rel)) {
          expect(f.log10Rel + out.meta.exactLog10, `${id} p=${r.p}`).toBeCloseTo(f.log10Abs, 9);
        }
      }
    }
  }, 60000);

  it('best possible error is zero when the true value fits into p bits', () => {
    const out = runSweep({ variables: [], program: 's = 0\nrepeat 10 { s = s + 0.1 }\ns', mode: 'RNE', precisions: parsePrecisions('20-30:10'), expBits: null });
    for (const r of out.rows) {
      expect(r.final.bestLog10Abs).toBe(-Infinity); // the true value is 1
      expect(r.final.log10Abs).toBeGreaterThan(-Infinity); // the loop still has an error
    }
  });
});
