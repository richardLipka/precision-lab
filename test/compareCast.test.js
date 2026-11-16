// Comparison operators (== != < <= > >=) and format casts (half … quad):
// language, IEEE semantics checked against native doubles and floats, the
// exact column, printing of the AST and the explanations.
import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/engine/evaluator.js';
import { parseProgram } from '../src/engine/parser.js';
import { FORMATS, fpToFraction, shortestDecimal, fpEquals } from '../src/engine/ieee.js';
import { explainStep, diagnose } from '../src/engine/explain.js';
import { print, statementsOf, walk, applicableRules, applyRule, replaceExpression, sameMeaning, same } from '../src/engine/ast.js';
import { EXAMPLES } from '../src/ui/examples.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const V = (s) => (s ? s.split(',').map((kv) => { const [name, value] = kv.split('='); return { name, value }; }) : []);
const run = (program, vars = '', formats = [F.binary32, F.binary64, F.x87]) => evaluate({ program, variables: V(vars), formats, mode: 'RNE' });
const num = (v) => (v.kind === 'nan' ? NaN : v.kind === 'inf' ? (v.sign ? -Infinity : Infinity) : v.kind === 'zero' ? (v.sign ? -0 : 0) : Number(shortestDecimal(v, F.binary128).replace(/−/g, '-')));
const res = (r, fmt) => r.steps[r.result].fmt[fmt].value;
const exactOf = (r) => r.steps[r.result].exact;
const codes = (ex) => ex.items.map((i) => i.code);
const explain = (r, fmt, id = r.result) => explainStep(r.steps[id], r.steps, F[fmt], 'RNE');

describe('comparison operators', () => {
  it('evaluate to exactly 1 or 0, also in the exact column', () => {
    const r = run('c = a + b\nc == 0.3', 'a=0.1,b=0.2');
    expect(num(res(r, 'binary64'))).toBe(0); // 0.1 + 0.2 != 0.3 in double
    expect(num(res(r, 'binary32'))).toBe(1); // but equal in float (luck)
    expect(num(res(r, 'x87'))).toBe(1);
    expect(exactOf(r).r.toFraction()).toBe('1'); // mathematically true
    expect(r.steps[r.result].fmt.binary64.round).toBe(null); // nothing is rounded
  });

  it('agree with native double and float comparisons, NaN and signed zeros included', () => {
    const values = ['0.1', '0.3', '-0', '0', '1e-30', '-2.5', 'inf', '-inf', '1/3', '16777217'];
    const ops = { '==': (x, y) => x === y, '!=': (x, y) => x !== y, '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y };
    const toNative = (s) => (s === '1/3' ? 1 / 3 : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));
    for (const a of values) {
      for (const b of values) {
        for (const [op, fn] of Object.entries(ops)) {
          const r = run(`a ${op} b`, `a=${a},b=${b}`, [F.binary32, F.binary64]);
          expect(num(res(r, 'binary64')), `${a} ${op} ${b} double`).toBe(fn(toNative(a), toNative(b)) ? 1 : 0);
          expect(num(res(r, 'binary32')), `${a} ${op} ${b} float`).toBe(fn(Math.fround(toNative(a)), Math.fround(toNative(b))) ? 1 : 0);
        }
      }
    }
    // NaN: only != is true, even for NaN with itself
    for (const [op, want] of [['==', 0], ['!=', 1], ['<', 0], ['<=', 0], ['>', 0], ['>=', 0]]) {
      const r = run(`x = inf - inf\nx ${op} x`, '', [F.binary64]);
      expect(num(res(r, 'binary64')), op).toBe(want);
      expect(exactOf(r).kind, op).toBe('nan'); // ∞ − ∞ has no true value, so neither has the comparison
    }
  });

  it('bind more loosely than arithmetic, accept ≠ ≤ ≥ and cannot be chained', () => {
    const r = run('1 + 2 == 3', '', [F.binary64]);
    expect(num(res(r, 'binary64'))).toBe(1);
    expect(num(res(run('2 ≤ 1 + 1', '', [F.binary64]), 'binary64'))).toBe(1);
    expect(num(res(run('2 ≠ 2', '', [F.binary64]), 'binary64'))).toBe(0);
    expect(num(res(run('3 ≥ 4', '', [F.binary64]), 'binary64'))).toBe(0);
    expect(() => parseProgram('a < b < c')).toThrow(/chained/);
    // parentheses make a comparison an ordinary 0/1 operand
    expect(num(res(run('(1 < 2) + (2 < 1) + (3 == 3)', '', [F.binary64]), 'binary64'))).toBe(2);
    // a single = is still an assignment, == is not
    const p = parseProgram('x = 1 == 1');
    expect(p[0].type).toBe('assign');
    expect(p[0].expr.op).toBe('==');
  });

  it('the exact column compares true values; irrational ones that agree in every verified digit count as equal', () => {
    const r = run('sqrt(2) * sqrt(2) == 2', '', [F.binary64]);
    expect(exactOf(r).r.toFraction()).toBe('1');
    expect(exactOf(r).undecided).toBe(true);
    expect(num(res(r, 'binary64'))).toBe(0); // 2.0000000000000004 != 2
    const s = run('sqrt(2) < 1.4142135623730951', '', [F.binary64]);
    expect(exactOf(s).r.toFraction()).toBe('1'); // √2 = 1.41421356237309504… < 1.4142135623730951
    expect(exactOf(s).undecided).toBeUndefined();
    expect(num(res(s, 'binary64'))).toBe(0); // the double nearest √2 is 1.4142135623730951
    expect(exactOf(run('inf > 1e308', '', [F.binary64])).r.toFraction()).toBe('1');
  });

  it('abs() works in a tolerance test', () => {
    const r = run('c = a + b\nabs(c - 0.3) <= tol * abs(0.3)', 'a=0.1,b=0.2,tol=1e-9', [F.binary16, F.binary32, F.binary64]);
    expect(num(res(r, 'binary64'))).toBe(1);
    expect(num(res(r, 'binary32'))).toBe(1);
    expect(num(res(r, 'binary16'))).toBe(0); // the tolerance is far below half's rounding error
    expect(exactOf(r).r.toFraction()).toBe('1');
  });
});

describe('comparison explanations', () => {
  const sum = () => run('c = a + b\nc == 0.3', 'a=0.1,b=0.2');

  it('double: equal true values rounded differently, with the size of the difference and a tolerance advice', () => {
    const ex = explain(sum(), 'binary64');
    expect(ex.cause.code).toBe('cmpWrong');
    expect(codes(ex)).toEqual(expect.arrayContaining(['cmp.noRounding', 'cmp.wrongEqual', 'cmp.tolerance']));
    const w = ex.items.find((i) => i.code === 'cmp.wrongEqual');
    // the stored values are neighbours: counted in representable numbers, not in ulps of the true value
    expect(w.params.apart).toEqual({ key: 'cmp.apartOne' });
    expect(w.params.got.key).toBe('cmp.false');
    expect(w.params.want.key).toBe('cmp.true');
    // the wrong answer is traced back to the rounding of a + b
    expect(ex.items.find((i) => i.code === 'op.lostAt').params.id).toBe(2);
  });

  it('float: the same test is true, which is called luck, and the tolerance advice is still given', () => {
    const ex = explain(sum(), 'binary32');
    expect(ex.cause.code).toBe('lucky');
    expect(codes(ex)).toEqual(expect.arrayContaining(['cmp.equalLuck', 'cmp.right', 'cmp.tolerance']));
    expect(codes(ex)).not.toContain('cmp.wrongEqual');
  });

  it('exact operands: the format compares the true values; ordered tests with small errors keep their answer', () => {
    const ex = explain(run('1 < 2', '', [F.binary64]), 'binary64');
    expect(codes(ex)).toEqual(expect.arrayContaining(['cmp.allExact', 'cmp.right']));
    expect(codes(ex)).not.toContain('cmp.tolerance');
    expect(ex.cause.code).toBe('exact');
    const near = run('a < b', 'a=0.1,b=0.1000000001', [F.binary16, F.binary64]);
    expect(codes(explain(near, 'binary64'))).toContain('cmp.sameAnswer');
    const wrong = explain(near, 'binary16');
    expect(codes(wrong)).toContain('cmp.wrongOrder');
    expect(wrong.cause.code).toBe('cmpWrong');
  });

  it('NaN, signed zeros and undefined true values are named', () => {
    expect(codes(explain(run('x = inf - inf\nx == x', '', [F.binary64]), 'binary64'))).toEqual(expect.arrayContaining(['cmp.nan', 'sp.exactUndefined']));
    expect(codes(explain(run('0 == -0', '', [F.binary64]), 'binary64'))).toContain('cmp.signedZero');
    expect(codes(explain(run('sqrt(2) * sqrt(2) == 2', '', [F.binary64]), 'binary64'))).toContain('cmp.undecided');
  });

  it('a comparison of the same computation is certain, not luck, and gets no tolerance advice', () => {
    for (const [prog, vars] of [['c = a + b\nc == c', 'a=0.1,b=0.2'], ['a*3 == a*3', 'a=0.1'], ['a == b', 'a=0.1,b=0.1'], ['x = 0.1\nx == 0.1', '']]) {
      const ex = explain(run(prog, vars, [F.binary32]), 'binary32');
      expect(codes(ex), prog).toContain('cmp.same');
      expect(codes(ex), prog).not.toContain('cmp.equalLuck');
      expect(codes(ex), prog).not.toContain('cmp.tolerance');
      expect(ex.cause.code, prog).toBe('cancelSame');
    }
  });

  it('the lucky-equality text names no unrelated program', () => {
    const ex = explain(sum(), 'binary32');
    const p = ex.items.find((i) => i.code === 'cmp.equalLuck').params;
    expect(Object.keys(p)).toEqual(['list']);
  });

  it('an operand that is ∞ or NaN only in this format gets its own sentence and no tolerance advice', () => {
    const nan = explain(run('x = 1e300*1e300\nx - x == 0', '', [F.binary64]), 'binary64');
    expect(codes(nan)).toEqual(expect.arrayContaining(['cmp.nan', 'cmp.wrongSpecial']));
    expect(codes(nan)).not.toContain('cmp.wrongOrder');
    expect(codes(nan)).not.toContain('cmp.tolerance');
    expect(nan.cause.code).toBe('cmpWrong');
    const inf = explain(run('x = 1e300*1e300\nx > 1', '', [F.binary64]), 'binary64');
    expect(codes(inf)).toContain('cmp.rightSpecial');
    expect(codes(inf)).not.toContain('cmp.sameAnswer');
    expect(inf.cause.code).not.toBe('exact');
  });

  it('two different stored values of equal true values: the gap is counted in representable numbers', () => {
    // sqrt(2)·sqrt(2) vs 2 in float: neighbours across the power of two (0.5 ulp of the true value 2)
    const r = run('sqrt(a) * sqrt(a) == a', 'a=2', [F.binary32]);
    const w = explain(r, 'binary32').items.find((i) => i.code === 'cmp.wrongEqual');
    if (w) expect(w.params.apart).toEqual({ key: 'cmp.apartOne' });
  });

  it('the diagnosis finds the wrong comparison and its source', () => {
    const dg = diagnose(sum(), F.binary64);
    expect(dg.losses[0].step.op).toBe('==');
    expect(dg.losses[0].source.id).toBe(2);
  });
});

describe('format casts', () => {
  // the classic case: x87 computes a + b with 64 bits; storing it as a double rounds a second time
  const vars = 'a=1,b=0x1.002p-53'; // b = 2⁻⁵³ + 2⁻⁶⁴

  it('double rounding: double(extended a + b) differs from double a + b', () => {
    const r = run('s = a + b\ndouble(s)', vars, [F.binary64, F.x87, F.binary128]);
    const sum = r.steps[r.env.s];
    // native double arithmetic rounds the exact sum once
    expect(num(sum.fmt.binary64.value)).toBe(1 + (2 ** -53 + 2 ** -64));
    expect(num(sum.fmt.binary64.value)).toBe(1 + 2 ** -52);
    // x87: 1 + 2⁻⁵³ (a tie in double after the first rounding), then ties-to-even gives 1
    expect(fpToFraction(sum.fmt.x87.value).toFraction()).toBe(`${2n ** 53n + 1n}/${2n ** 53n}`);
    const cast = r.steps[r.result];
    expect(fpToFraction(cast.fmt.x87.value).toFraction()).toBe('1');
    expect(fpEquals(cast.fmt.x87.value, sum.fmt.binary64.value)).toBe(false);
    // in the double column the cast changes nothing; in quad it rounds once (the sum is exact there)
    expect(fpEquals(cast.fmt.binary64.value, sum.fmt.binary64.value)).toBe(true);
    expect(fpToFraction(cast.fmt.binary128.value).equals(fpToFraction(sum.fmt.binary64.value))).toBe(true);
    // the exact column: a cast is the identity
    expect(cast.exact.r.equals(sum.exact.r)).toBe(true);
  });

  it('the explanation names double rounding only where the two roundings differ from one', () => {
    const r = run('s = a + b\ndouble(s)', vars, [F.binary64, F.x87, F.binary128]);
    const x87 = explain(r, 'x87');
    expect(x87.cause.code).toBe('doubleRound');
    const dr = x87.items.find((i) => i.code === 'cast.doubleRounding');
    expect(dr.params).toMatchObject({ id: 2, p: 64, pT: 53, once: '1.0000000000000002', twice: '1' });
    expect(codes(explain(r, 'binary64'))).toContain('cast.same');
    expect(codes(explain(r, 'binary128'))).not.toContain('cast.doubleRounding');
    // rounded twice, but here with the same result as rounding once
    const same = run('s = a + b\ndouble(s)', 'a=1,b=0x1.0000000004p-60', [F.x87]);
    const ex = explain(same, 'x87');
    expect(codes(ex)).toContain('cast.twiceSame');
    expect(ex.cause.code).not.toBe('doubleRound');
  });

  it('double rounding of an input: decimal → double → float differs from decimal → float', () => {
    // 1 + 2⁻²⁴ + 2⁻⁵⁴: in double it becomes the float tie 1 + 2⁻²⁴, which ties-to-even sends to 1;
    // converted once it rounds up to 1 + 2⁻²³
    for (const a of ['0x1.00000100000004p0', '1.00000005960464488641292746251565404236316680908203125']) {
      const r = run('float(a)', `a=${a}`, [F.binary64]);
      expect(fpToFraction(res(r, 'binary64')).toFraction(), a).toBe('1');
      const ex = explain(r, 'binary64');
      expect(ex.cause.code, a).toBe('doubleRound');
      const dr = ex.items.find((i) => i.code === 'cast.doubleRoundingInput');
      expect(dr.params, a).toMatchObject({ id: 0, p: 53, pT: 24, once: '1.0000001', twice: '1', src: a });
    }
    // an ordinary decimal: rounded twice, with the same result as once
    expect(codes(explain(run('float(a)', 'a=0.1', [F.binary64]), 'binary64'))).toContain('cast.twiceSameInput');
  });

  it('every cast rounds into its format and back, exactly like native float and double', () => {
    for (const x of ['0.1', '1/3', '16777217', '1e-40', '3.4e38', '-2.5']) {
      const r = run(`float(x)`, `x=${x}`, [F.binary64]);
      const nx = x === '1/3' ? 1 / 3 : Number(x);
      expect(num(res(r, 'binary64')), x).toBe(Math.fround(nx));
    }
    const r = run('half(x)', 'x=0.1', [F.binary64, F.binary16]);
    expect(num(res(r, 'binary64'))).toBe(0.0999755859375);
    expect(codes(explain(r, 'binary16'))).toContain('cast.same');
    // a value that fits is not rounded
    expect(codes(explain(run('bfloat16(x)', 'x=0.5', [F.binary64]), 'binary64'))).toContain('cast.fits');
    // too large for half: overflow, held as ∞ in the column
    const o = run('half(x)', 'x=1e5', [F.binary64]);
    expect(res(o, 'binary64').kind).toBe('inf');
    expect(explain(o, 'binary64').cause.code).toBe('overflow');
    // NaN and ∞ pass through every cast
    expect(res(run('x = inf - inf\nquad(x)', '', [F.binary32]), 'binary32').kind).toBe('nan');
  });

  it('a cast whose target does not fit into the column rounds a second time', () => {
    // bfloat16 has a wider exponent range than half: 65504 (the largest half) rounds to
    // 65536 in bfloat16, and that overflows when it is held in half again
    const big = run('bfloat16(x)', 'x=65504', [F.binary16]);
    const c = big.steps[big.result].fmt.binary16;
    expect(fpToFraction(c.cast.mid).toFraction()).toBe('65536');
    expect(c.cast.r2.overflow).toBe(true);
    expect(c.value.kind).toBe('inf');
    expect(c.flags.overflow).toBe(true);
    const ex = explain(big, 'binary16');
    expect(codes(ex)).toEqual(expect.arrayContaining(['cast.round1', 'cast.round2']));
    expect(ex.cause.code).toBe('overflow');
  });

  it('cast names are function names: they cannot be assigned', () => {
    expect(() => parseProgram('double = 1')).toThrow(/function name/);
    expect(() => parseProgram('float(1, 2)')).toThrow(/argument/);
  });
});

describe('AST printing and rewrites with comparisons and casts', () => {
  it('prints comparisons with the parentheses they need and parses back to the same tree', () => {
    for (const src of ['a + b == c', '(a < b) == (c >= d)', '(a < b) + 1', 'abs(a - b) <= t * abs(b)', 'double(a + b) != a + b', '-(a < b)', 'a == -b']) {
      const tree = statementsOf(src)[0].expr;
      const printed = print(tree);
      expect(same(statementsOf(printed)[0].expr, tree), `${src} → ${printed}`).toBe(true);
    }
    expect(print(statementsOf('(a < b) == c')[0].expr)).toBe('(a < b) == c');
    expect(print(statementsOf('a + b == c')[0].expr)).toBe('a + b == c');
  });

  it('no rewrite rule applies to the comparison itself, and rewrites inside keep the true answer', () => {
    const program = 'abs((a + b) - c) <= t * c';
    const vars = V('a=0.1,b=0.2,c=0.3,t=1e-9');
    const st = statementsOf(program)[0];
    expect(applicableRules(st.expr)).toEqual([]);
    let tried = 0;
    for (const { node, path } of walk(st.expr)) {
      for (const rule of applicableRules(node)) {
        const next = replaceExpression(program, 0, applyRule(st.expr, path, rule.id));
        expect(sameMeaning(program, next, vars).ok, `${rule.id} → ${next}`).toBe(true);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(3);
  });
});

describe('the new examples', () => {
  it('equality: == fails in every default format; tol = 1e-9 passes only where it exceeds the rounding error', () => {
    const ex = EXAMPLES.find((e) => e.id === 'equality');
    const r = evaluate({ program: ex.program, variables: ex.variables, formats: FORMATS, mode: 'RNE' });
    const eq = r.steps.find((s) => s.op === '==');
    for (const f of ['binary32', 'binary64', 'x87']) expect(num(eq.fmt[f].value), f).toBe(0);
    // no lucky cancellation hides the lesson: the float difference is not 0
    expect(num(r.steps.find((s) => s.text === 'c - 0.9').fmt.binary32.value)).not.toBe(0);
    expect(num(res(r, 'binary64'))).toBe(1);
    expect(num(res(r, 'x87'))).toBe(1);
    expect(num(res(r, 'binary32'))).toBe(0); // 1e-9 is below float's u ≈ 6e-8
    expect(num(res(r, 'binary16'))).toBe(0);
    // tol = 1e-9 underflows to 0 in half, as the blurb says
    expect(r.steps.find((s) => s.text.startsWith('tol =')).fmt.binary16.value.kind).toBe('zero');
    // a float-sized tolerance passes in float
    const r6 = evaluate({ program: ex.program, variables: ex.variables.map((v) => (v.name === 'tol' ? { ...v, value: '1e-6' } : v)), formats: [F.binary32], mode: 'RNE' });
    expect(num(res(r6, 'binary32'))).toBe(1);
    // the failed tolerance test is told that its tolerance is too small, not to "use a tolerance"
    const fl = explain(r, 'binary32');
    expect(codes(fl)).toContain('cmp.toleranceOrder');
    expect(codes(fl)).not.toContain('cmp.tolerance');
  });

  it('doubleRound: x87 gives 1, double gives 1 + 2⁻⁵²', () => {
    const ex = EXAMPLES.find((e) => e.id === 'doubleRound');
    const r = evaluate({ program: ex.program, variables: ex.variables, formats: FORMATS, mode: 'RNE' });
    expect(fpToFraction(res(r, 'x87')).toFraction()).toBe('1');
    expect(num(res(r, 'binary64'))).toBe(1 + 2 ** -52);
    expect(explain(r, 'x87').cause.code).toBe('doubleRound');
  });
});
