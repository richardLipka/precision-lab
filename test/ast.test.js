import { describe, it, expect } from 'vitest';
import {
  statementsOf, walk, print, same, applicableRules, applyRule, replaceExpression, sameMeaning, RULES, getAt,
} from '../src/engine/ast.js';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS } from '../src/engine/ieee.js';
import { EXAMPLES } from '../src/ui/examples.js';
import { DICT } from '../src/i18n.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const expr = (src) => statementsOf(src)[0].expr;

describe('printing', () => {
  it('keeps the tree shape with minimal parentheses', () => {
    for (const src of ['a + (b + c)', '(a + b) + c', 'a - (b - c)', 'a / (b * c)', '-a * b', '-(a * b)', 'a + (-b)', '(a + b)^3', 'pow(x, 2) * 3', 'x^-2', '2 * (3 + 4) / 5']) {
      const e = expr(src);
      const back = expr(print(e));
      expect(same(back, e), src).toBe(true);
    }
    expect(print(expr('(a+b)+c'))).toBe('a + b + c');
    expect(print(expr('a+(b+c)'))).toBe('a + (b + c)');
  });
});

describe('rules', () => {
  const vars = [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }, { name: 'c', value: '0.3' }, { name: 'x', value: '1.7' }];
  const cases = [
    ['a + b', [], 'commute', 'b + a'],
    ['(a + b) + c', [], 'reassocRight', 'a + (b + c)'],
    ['a + (b + c)', [], 'reassocLeft', 'a + b + c'],
    ['(a - b) + c', [], 'reassocRight', 'a - (b - c)'],
    ['a - (b - c)', [], 'reassocLeft', 'a - b + c'],
    ['(a - b) - c', [], 'reassocRight', 'a - (b + c)'],
    ['(a / b) / c', [], 'reassocRight', 'a / (b * c)'],
    ['(a * b) / c', [], 'reassocRight', 'a * (b / c)'],
    ['a * (b + c)', [], 'distribute', 'a * b + a * c'],
    ['(a - b) / c', [], 'distribute', 'a / c - b / c'],
    ['a * b + a * c', [], 'factor', 'a * (b + c)'],
    ['a / c - b / c', [], 'factor', '(a - b) / c'],
    ['a - b', [], 'subToAddNeg', 'a + (-b)'],
    ['a + (-b)', [], 'addNegToSub', 'a - b'],
    ['-(a - b)', [], 'negSub', 'b - a'],
    ['3 * x * x * x', [], 'collectPow', '3 * pow(x, 3)'],
    ['x * x * x', [], 'collectCaret', 'x^3'],
    ['x^3', [], 'caretToPow', 'pow(x, 3)'],
    ['pow(x, 3)', [], 'powToCaret', 'x^3'],
    ['x^3', [], 'expandMul', 'x * x * x'],
    ['sqrt(x)', [], 'sqrtToPow', 'pow(x, 0.5)'],
    ['pow(x, 0.5)', [], 'powToSqrt', 'sqrt(x)'],
  ];
  for (const [src, path, rule, expected] of cases) {
    it(`${rule}: ${src} → ${expected}`, () => {
      const out = print(applyRule(expr(src), path, rule));
      expect(out).toBe(expected);
      expect(sameMeaning(src, out, vars).ok).toBe(true);
    });
  }

  it('every rule has a name and a description in both languages', () => {
    for (const r of RULES) {
      for (const lang of ['en', 'cs']) {
        expect(DICT[lang]['rw.' + r.id], `${lang} rw.${r.id}`).toBeTruthy();
        expect(DICT[lang]['rw.' + r.id + '.desc'], `${lang} rw.${r.id}.desc`).toBeTruthy();
      }
    }
  });

  it('refuses a rewrite that changes the value because of a division by zero', () => {
    const src = 'a / (b / c)';
    const out = print(applyRule(expr(src), [], 'reassocLeft'));
    expect(sameMeaning(src, out, [{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '0' }]).ok).toBe(false);
    expect(sameMeaning(src, out, [{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' }]).ok).toBe(true);
    // Zero verified digits or beyond-range stand-ins are never treated as equal
    expect(sameMeaning('(1 - cos(x)) / (x * x)', '0', [{ name: 'x', value: '1e-60' }], 60).ok).toBe(false);
    expect(sameMeaning('exp(-1000000)', '0', [], 60).ok).toBe(false);
    // refDigits is honoured: 1 + 1e-70 vs 1 agree at 60 digits but differ at 100 digits
    expect(sameMeaning('1 + exp(-160)', '1', [], 100).ok).toBe(false);
  });

  it('commutativity never changes a rounded result, associativity can', () => {
    const v = [{ name: 'a', value: '1e16' }, { name: 'b', value: '-1e16' }, { name: 'c', value: '1' }];
    const run = (p) => evaluate({ program: p, variables: v, formats: [F.binary64], mode: 'RNE' });
    const val = (r) => r.steps[r.result].fmt.binary64.value;
    const src = '(a + b) + c';
    const swapped = print(applyRule(expr(src), [], 'commute'));
    const regrouped = print(applyRule(expr(src), [], 'reassocRight'));
    expect(val(run(swapped))).toEqual(val(run(src)));
    expect(val(run(regrouped))).not.toEqual(val(run(src)));
  });
});

describe('every applicable rewrite in every example keeps the true value', () => {
  for (const ex of EXAMPLES) {
    it(ex.id, () => {
      if (!ex.program.trim()) return;
      const stmts = statementsOf(ex.program);
      let tried = 0;
      stmts.forEach((st, si) => {
        for (const { node, path } of walk(st.expr)) {
          for (const rule of applicableRules(node)) {
            const next = replaceExpression(ex.program, si, applyRule(st.expr, path, rule.id));
            // the rewritten statement must parse back to exactly the rewritten tree
            const reparsed = statementsOf(next)[si].expr;
            expect(same(getAt(reparsed, path), rule.apply(node)), `${ex.id} ${rule.id}`).toBe(true);
            const check = sameMeaning(ex.program, next, ex.variables);
            expect(check.ok, `${ex.id}: ${rule.id} at ${path.join('.')} → ${check.differences}`).toBe(true);
            tried++;
            if (tried > 60) return;
          }
        }
      });
    }, 60000);
  }
});

describe('node to step mapping', () => {
  it('maps every inner node of a statement to the step that computed it', () => {
    const src = 'z = (a + b) * c - a';
    const r = evaluate({ program: src, variables: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' }], formats: [F.binary64], mode: 'RNE' });
    for (const { node } of walk(statementsOf(src)[0].expr)) {
      expect(r.nodeSteps[`${node.start}:${node.end}`], print(node)).not.toBeUndefined();
    }
    expect(r.steps[r.nodeSteps[`${statementsOf(src)[0].expr.start}:${statementsOf(src)[0].expr.end}`]].exact.r.toFraction()).toBe('8');
  });
});
