// The built-in examples as a curriculum: every example belongs to a group of the
// learning path and states its lesson and where to look, and every example
// shows in the default formats (float, double, x87) what its text promises.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/engine/evaluator.js';
import { FORMATS, fpToFraction } from '../src/engine/ieee.js';
import { compareToExact, correctDigits } from '../src/engine/metrics.js';
import { diagnose } from '../src/engine/explain.js';
import { EXAMPLES, EXAMPLE_GROUPS, DEFAULT_EXAMPLE } from '../src/ui/examples.js';
import { EXAMPLE_REFS } from '../src/ui/references.js';
import { DICT } from '../src/i18n.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const DEFAULT = [F.binary32, F.binary64, F.x87];
const runEx = (id, formats = DEFAULT) => {
  const ex = EXAMPLES.find((e) => e.id === id);
  return evaluate({ program: ex.program, variables: ex.variables, formats, mode: 'RNE' });
};
/** The step a variable was last assigned (or the program result for null). */
const stepOf = (r, name) => r.steps[name == null ? r.result : r.env[name]];
const value = (st, fmt) => st.fmt[fmt].value;
const num = (v) => (v.kind === 'nan' ? NaN : v.kind === 'inf' ? (v.sign ? -Infinity : Infinity) : fpToFraction(v).valueOf());
const exactIn = (st, fmt) => compareToExact(value(st, fmt), st.exact, F[fmt]).status === 'exact';
const digits = (st, fmt) => correctDigits(compareToExact(value(st, fmt), st.exact, F[fmt]), F[fmt]).shown;

describe('the example list is a grouped learning path', () => {
  it('every example has a known group, a lesson and a "look at" pointer in both languages', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EXAMPLES) {
      expect(EXAMPLE_GROUPS, e.id).toContain(e.group);
      for (const field of ['title', 'blurb', 'lesson', 'look']) {
        expect(e[field]?.en?.trim().length, `${e.id}.${field}.en`).toBeGreaterThan(0);
        expect(e[field]?.cs?.trim().length, `${e.id}.${field}.cs`).toBeGreaterThan(0);
      }
    }
  });

  it('groups are contiguous in learning order, none is empty, and each has a translated name', () => {
    const order = EXAMPLES.map((e) => EXAMPLE_GROUPS.indexOf(e.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const g of EXAMPLE_GROUPS) {
      expect(EXAMPLES.some((e) => e.group === g), g).toBe(true);
      expect(DICT.en['exgroup.' + g] && DICT.cs['exgroup.' + g], g).toBeTruthy();
    }
    expect(EXAMPLES[0].id).toBe(DEFAULT_EXAMPLE);
  });

  it('starts with the basics and keeps the advanced material for later', () => {
    const pos = (id) => EXAMPLES.findIndex((e) => e.id === id);
    for (const id of ['sum', 'repr', 'intLimit', 'equality', 'special', 'range']) expect(pos(id)).toBeLessThan(pos('loop'));
    expect(pos('cancel')).toBeLessThan(pos('quadratic'));
    expect(pos('quadratic')).toBeLessThan(pos('muller'));
    expect(pos('muller')).toBeLessThan(pos('rump'));
  });

  it('the READMEs state the current number of examples', () => {
    const read = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
    expect(read('README.md')).toContain(`${EXAMPLES.length} built-in examples`);
    expect(read('README.cs.md')).toContain(`${EXAMPLES.length} vestavěných příkladů`);
  });

  it('both READMEs list every source file in the project layout and say how to add an example and an explanation', () => {
    const root = join(import.meta.dirname, '..');
    const read = (f) => readFileSync(join(root, f), 'utf8');
    const files = readdirSync(join(root, 'src'), { recursive: true })
      .map((f) => 'src/' + String(f).replaceAll('\\', '/'))
      .filter((f) => /\.(js|css)$/.test(f));
    expect(files).toContain('src/sweep/worker.js');
    for (const [readme, sections] of [
      ['README.md', ['## Project layout', '## How to add an example', '## How to add an explanation']],
      ['README.cs.md', ['## Struktura projektu', '## Jak přidat příklad', '## Jak přidat vysvětlení']],
    ]) {
      const text = read(readme);
      for (const s of sections) expect(text, `${readme}: ${s}`).toContain(s);
      for (const f of files) expect(text, `${readme}: ${f}`).toContain('`' + f + '`');
    }
  });

  it('references point to existing examples only (the harmonic sum became the order example)', () => {
    expect(EXAMPLES.find((e) => e.id === 'harmonic')).toBeUndefined();
    expect(EXAMPLE_REFS.order).toBeTruthy();
    expect(EXAMPLE_REFS.harmonic).toBeUndefined();
  });
});

describe('each example shows what its text says', () => {
  it('sum: c == 0.3 is true mathematically, false in double, true in float and x87 only by luck', () => {
    const r = runEx('sum');
    const eq = stepOf(r, null);
    expect(eq.op).toBe('==');
    expect(eq.exact.r.toFraction()).toBe('1');
    expect(num(value(eq, 'binary64'))).toBe(0);
    expect(num(value(eq, 'binary32'))).toBe(1);
    expect(num(value(eq, 'x87'))).toBe(1);
    const diff = r.steps.find((s) => s.text === 'c - 0.3');
    expect(num(value(diff, 'binary64'))).toBeCloseTo(5.551115123125783e-17, 30);
    for (const f of ['binary32', 'x87']) expect(num(value(diff, f))).toBe(0);
    // ... although c itself is rounded in float and x87
    for (const f of ['binary32', 'x87']) expect(exactIn(stepOf(r, 'c'), f)).toBe(false);
    for (const lang of ['en', 'cs']) expect(EXAMPLES[0].blurb[lang]).toMatch(/x87/);
  });

  it('fma: the true a·a − p is the rounding error of the product, recovered by fma and lost by the plain expression', () => {
    const r = runEx('fma');
    // float: the 25-bit product does not fit
    expect(num(value(stepOf(r, 'plain'), 'binary32'))).toBe(0);
    expect(exactIn(stepOf(r, 'plain'), 'binary32')).toBe(false);
    expect(stepOf(r, 'fused').exact.r.toFraction()).toBe(`1/${2 ** 24}`);
    for (const f of ['binary32', 'binary64', 'x87']) expect(exactIn(stepOf(r, 'fused'), f), f).toBe(true);
    // double: the 55-bit product does not fit
    expect(exactIn(stepOf(r, 'plain2'), 'binary64')).toBe(false);
    expect(num(value(stepOf(r, 'plain2'), 'binary64'))).toBe(0);
    expect(exactIn(stepOf(r, 'fused2'), 'binary64')).toBe(true);
    expect(stepOf(r, 'fused2').exact.r.toFraction()).toBe(`1/${2 ** 54}`);
    // x87 holds both products
    for (const v of ['plain', 'fused', 'plain2', 'fused2']) expect(exactIn(stepOf(r, v), 'x87'), v).toBe(true);
    // the inputs a and p are exact in every default format
    for (const f of ['binary32', 'binary64', 'x87']) {
      expect(exactIn(stepOf(r, 'a'), f)).toBe(true);
      expect(exactIn(stepOf(r, 'p'), f)).toBe(true);
    }
  });

  it('assoc: the two orders differ in float, double and x87 alike; quad holds 10²⁰ − 1', () => {
    const r = runEx('assoc', [...DEFAULT, F.binary128]);
    for (const f of ['binary32', 'binary64', 'x87']) {
      expect(num(value(stepOf(r, 'left'), f)), f).toBe(1);
      expect(num(value(stepOf(r, 'right'), f)), f).toBe(0);
    }
    expect(num(value(stepOf(r, 'right'), 'binary128'))).toBe(1);
    // 10²⁰ is exact in double and x87, so their diagnosis blames the absorption in (b + c), nothing else
    for (const f of ['binary64', 'x87']) {
      expect(exactIn(stepOf(r, 'a'), f)).toBe(true);
      const dg = diagnose(runEx('assoc', [F[f]]), F[f]);
      expect(dg.losses[0].source.text, f).toBe('(b + c)');
    }
  });

  it('order: the backward sum is visibly better than the forward sum in every default format', () => {
    const r = runEx('order');
    const fw = stepOf(r, 'forward');
    const bw = stepOf(r, 'backward');
    expect(fw.exact.r.toFraction()).toBe('100001/100000');
    expect(num(value(fw, 'binary32'))).toBe(1); // every x absorbed
    expect(num(value(bw, 'binary32'))).toBeCloseTo(1.00001, 6);
    for (const f of ['binary32', 'binary64', 'x87']) expect(digits(bw, f) - digits(fw, f), f).toBeGreaterThan(2);
    expect(digits(fw, 'binary64')).toBeLessThan(14);
    expect(digits(bw, 'binary64')).toBeGreaterThan(15.5);
  });

  it('intLimit: integers stop being exact at 2²⁴ in float and 2⁵³ in double; x87 gets all right', () => {
    const r = runEx('intLimit');
    expect(num(value(stepOf(r, 'f1'), 'binary32'))).toBe(0);
    expect(num(value(stepOf(r, 'f2'), 'binary32'))).toBe(2);
    expect(num(value(stepOf(r, 'f1'), 'binary64'))).toBe(1);
    expect(num(value(stepOf(r, 'd1'), 'binary64'))).toBe(0);
    for (const v of ['f1', 'f2', 'd1']) expect(exactIn(stepOf(r, v), 'x87'), v).toBe(true);
    // the limits are exactly 2^p
    expect(EXAMPLES.find((e) => e.id === 'intLimit').variables.map((v) => Number(v.value))).toEqual([2 ** 24, 2 ** 53]);
  });

  it('variance: the two-pass formula is accurate in double, the one-pass formula has no correct digit', () => {
    const r = runEx('variance');
    expect(stepOf(r, 'twoPass').exact.r.toFraction()).toBe('2/3');
    expect(digits(stepOf(r, 'twoPass'), 'binary64')).toBeGreaterThan(15.5);
    expect(digits(stepOf(r, 'onePass'), 'binary64')).toBe(0);
    // in float even the inputs are rounded
    expect(exactIn(stepOf(r, 'x1'), 'binary32')).toBe(false);
  });

  it('compound: (1 + 1/n)ⁿ is about 1.4·10⁻⁸ from e, as the text says', () => {
    const r = runEx('compound', [F.binary64]);
    const gap = Math.abs(stepOf(r, null).exact.r.valueOf());
    expect(gap).toBeGreaterThan(1.35e-8);
    expect(gap).toBeLessThan(1.4e-8);
    const ex = EXAMPLES.find((e) => e.id === 'compound');
    expect(ex.blurb.en).toContain('1.4·10⁻⁸');
    expect(ex.blurb.en).not.toContain('within 10⁻⁸');
  });

  it('range: float gives NaN for big (∞/∞) and 0 for tiny, and the text says so', () => {
    const r = runEx('range');
    expect(value(stepOf(r, 'big'), 'binary32').kind).toBe('nan');
    expect(num(value(stepOf(r, 'tiny'), 'binary32'))).toBe(0);
    expect(exactIn(stepOf(r, 'big'), 'binary64')).toBe(true);
    const ex = EXAMPLES.find((e) => e.id === 'range');
    for (const lang of ['en', 'cs']) expect(ex.blurb[lang]).toContain('NaN');
  });

  it('taylor: the reference step is named for an ideal, correctly rounded exp, not for libm', () => {
    const ex = EXAMPLES.find((e) => e.id === 'taylor');
    expect(ex.program).not.toContain('libm');
    const r = runEx('taylor', [F.binary64]);
    expect(exactIn(stepOf(r, 'ideal'), 'binary64')).toBe(false); // e⁻²⁰ is irrational …
    expect(digits(stepOf(r, 'ideal'), 'binary64')).toBeGreaterThan(15.5); // … but correctly rounded
    for (const lang of ['en', 'cs']) expect(ex.blurb[lang]).toContain('1 ulp');
  });

  it('stability and conditioning are named in the examples that contrast them', () => {
    const text = (id) => `${EXAMPLES.find((e) => e.id === id).lesson.en}`;
    expect(text('quadratic')).toMatch(/well-conditioned problem.*unstable algorithm/);
    expect(text('sinBig')).toMatch(/ill-conditioned problem/);
    expect(text('taylor')).toMatch(/Stability belongs to the algorithm, conditioning to the problem/);
    expect(DICT.en['an.loss']).toMatch(/ill-conditioned problem.*unstable algorithm/);
    expect(DICT.cs['an.loss']).toMatch(/Špatně podmíněná úloha.*Nestabilní algoritmus/);
  });
});
