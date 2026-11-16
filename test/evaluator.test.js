import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS, shortestDecimal, fpToFraction } from '../src/engine/ieee.js';
import { parseLiteral, exactDecimal, fmtFrac, Fraction } from '../src/engine/rational.js';
import { compareToExact, localError } from '../src/engine/metrics.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const all = FORMATS;

function run(program, variables = [], formats = all, mode = 'RNE') {
  return evaluate({ program, variables, formats, mode });
}

describe('literals and decimal output', () => {
  it('parses many literal forms exactly', () => {
    expect(parseLiteral('0.1').r.toFraction()).toBe('1/10');
    expect(parseLiteral('-2.5e-3').r.toFraction()).toBe('-1/400');
    expect(parseLiteral('0x1.8p-2').r.toFraction()).toBe('3/8');
    expect(parseLiteral('1/3').r.toFraction()).toBe('1/3');
    expect(parseLiteral('1e400').r.n).toBe(10n ** 400n);
    expect(parseLiteral('-inf')).toEqual({ kind: 'inf', sign: 1 });
    expect(parseLiteral('abc')).toBe(null);
  });

  it('exact decimal expansions show the period', () => {
    expect(exactDecimal(new Fraction(1, 6)).text).toBe('0.1(6)');
    expect(exactDecimal(new Fraction(1, 7)).text).toBe('0.(142857)');
    expect(exactDecimal(new Fraction(-5, 4)).text).toBe('−1.25');
    expect(fmtFrac(new Fraction(2, 3), 5)).toBe('0.66667');
  });
});

describe('evaluator', () => {
  it('0.1 + 0.2 in all formats', () => {
    const res = run('a + b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }]);
    const st = res.steps[res.result];
    expect(st.exact.r.toFraction()).toBe('3/10');
    expect(shortestDecimal(st.fmt.binary64.value, F.binary64)).toBe('0.30000000000000004');
    expect(shortestDecimal(st.fmt.binary32.value, F.binary32)).toBe('0.3');
    const cmp = compareToExact(st.fmt.binary64.value, st.exact, F.binary64);
    expect(cmp.status).toBe('approx');
    const loc = localError(st.fmt.binary64, F.binary64);
    expect(loc.abs.n > 0n).toBe(true);
  });

  it('associativity: (a+b)+c differs from a+(b+c) in double', () => {
    const vars = [{ name: 'a', value: '1e16' }, { name: 'b', value: '-1e16' }, { name: 'c', value: '1' }];
    const r1 = run('(a + b) + c', vars, [F.binary64]);
    const r2 = run('a + (b + c)', vars, [F.binary64]);
    expect(fpToFraction(r1.steps[r1.result].fmt.binary64.value).toFraction()).toBe('1');
    expect(fpToFraction(r2.steps[r2.result].fmt.binary64.value).toFraction()).toBe('0');
  });

  it('repeat loop: summing 0.1 ten times', () => {
    const res = run('s = 0\nrepeat 10 { s = s + 0.1 }\ns', [], [F.binary64]);
    const st = res.steps[res.result];
    expect(st.exact.r.toFraction()).toBe('1');
    expect(shortestDecimal(st.fmt.binary64.value, F.binary64)).toBe('0.9999999999999999');
  });

  it("Rump's example gives a wrong answer in every hardware format", () => {
    const prog = '333.75*b^6 + a^2*(11*a^2*b^2 - b^6 - 121*b^4 - 2) + 5.5*b^8 + a/(2*b)';
    const res = run(prog, [{ name: 'a', value: '77617' }, { name: 'b', value: '33096' }]);
    const st = res.steps[res.result];
    // true value −54767/66192 ≈ −0.8273960599
    expect(st.exact.r.toFraction()).toBe('-54767/66192');
    for (const f of [F.binary32, F.binary64, F.x87]) {
      const cmp = compareToExact(st.fmt[f.id].value, st.exact, f);
      expect(cmp.digits).toBeLessThan(1);
    }
  });

  it('fma rounds once', () => {
    // a*a - b where b = fl(a*a): fma recovers the rounding error, plain code gives 0
    const vars = [{ name: 'a', value: '0.1' }];
    const res = run('p = a*a\nfma(a, a, -p)', vars, [F.binary64]);
    const v = res.steps[res.result].fmt.binary64.value;
    expect(v.kind).toBe('finite');
    const res2 = run('p = a*a\na*a - p', vars, [F.binary64]);
    expect(res2.steps[res2.result].fmt.binary64.value.kind).toBe('zero');
  });

  it('reports parse errors with positions', () => {
    expect(() => run('a + * b', [{ name: 'a', value: '1' }, { name: 'b', value: '1' }])).toThrow(/column 5/);
    expect(() => run('x + 1')).toThrow(/unknown variable 'x'/);
  });

  it('division by zero: IEEE gives ∞, exact value is undefined', () => {
    const res = run('1/0', [], [F.binary64]);
    const st = res.steps[res.result];
    expect(st.fmt.binary64.value.kind).toBe('inf');
    expect(st.fmt.binary64.flags.divByZero).toBe(true);
    expect(st.exact.kind).toBe('nan');
  });
});
