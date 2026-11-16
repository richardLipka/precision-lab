// Functions with irrational results: correctly rounded results checked against
// the JavaScript engine (V8's Math.sqrt is correctly rounded; for the other
// functions V8 is accurate to < 1 ulp, so we require ≤ 1 ulp difference) and
// against GNU MPFR for wide formats. Plus the decimal.js reference chain.

import { describe, it, expect, beforeAll } from 'vitest';
import { init } from 'gmp-wasm';
import { FORMATS, makeFormat, roundFraction, encode, fpToFraction, fp } from '../src/engine/ieee.js';
import { fpFunction } from '../src/engine/fpfunc.js';
import { evaluate } from '../src/engine/evaluator.js';
import { exactFunction, setRealDigits, exactRoot } from '../src/engine/real.js';
import { frac, exact, Fraction } from '../src/engine/rational.js';
import { compareToExact } from '../src/engine/metrics.js';
import { EXAMPLES } from '../src/ui/examples.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
const buf = new DataView(new ArrayBuffer(8));

function fromDouble(x, fmt = F.binary64) {
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let q = -1074;
  if (e) { m |= 1n << 52n; q = e - 1075; }
  const n = hi >>> 31 ? -m : m;
  const r = q >= 0 ? frac(n << BigInt(q), 1n) : frac(n, 1n << BigInt(-q));
  return roundFraction(r, fmt, 'RNE', Object.is(x, -0) ? 1 : 0).value;
}

function toDouble(v) {
  const b = BigInt('0b' + encode(v, F.binary64).bitsStr);
  buf.setUint32(0, Number(b >> 32n));
  buf.setUint32(4, Number(b & 0xffffffffn));
  return buf.getFloat64(0);
}

function ulpDiff(a, b) {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  buf.setFloat64(0, a);
  const ia = buf.getBigInt64(0);
  buf.setFloat64(0, b);
  const ib = buf.getBigInt64(0);
  const d = ia - ib;
  return Number(d < 0n ? -d : d);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('functions in binary64 vs JavaScript Math', () => {
  const cases = {
    sqrt: [Math.sqrt, (r) => r() * 10 ** (r() * 40 - 20), 0],
    exp: [Math.exp, (r) => (r() - 0.5) * 100, 1],
    ln: [Math.log, (r) => r() * 10 ** (r() * 40 - 20), 1],
    sin: [Math.sin, (r) => (r() - 0.5) * 20, 1],
    cos: [Math.cos, (r) => (r() - 0.5) * 20, 1],
    atan: [Math.atan, (r) => (r() - 0.5) * 100, 1],
  };
  for (const [name, [ref, gen, tol]] of Object.entries(cases)) {
    it(`${name}: ${tol ? '≤ 1 ulp from' : 'identical to'} Math.${ref.name}`, () => {
      const r = rng(name.length * 977);
      for (let i = 0; i < 300; i++) {
        const x = gen(r);
        const got = toDouble(fpFunction(name, [fromDouble(x)], F.binary64, 'RNE').value);
        const d = ulpDiff(got, ref(x));
        if (d > tol) throw new Error(`${name}(${x}) = ${got}, Math gives ${ref(x)} (${d} ulp)`);
      }
    });
  }

  it('pow with integer and fractional exponents', () => {
    expect(toDouble(fpFunction('pow', [fromDouble(2), fromDouble(0.5)], F.binary64, 'RNE').value)).toBe(Math.SQRT2);
    expect(toDouble(fpFunction('pow', [fromDouble(1.1), fromDouble(10)], F.binary64, 'RNE').value)).toBe(Number('2.5937424601000023'));
    expect(fpFunction('pow', [fromDouble(-8), fromDouble(1 / 3)], F.binary64, 'RNE').flags.invalid).toBe(true);
  });

  it('special values', () => {
    expect(fpFunction('sqrt', [fromDouble(-1)], F.binary64, 'RNE').value.kind).toBe('nan');
    expect(fpFunction('ln', [fp.zero(0)], F.binary64, 'RNE').value).toMatchObject({ kind: 'inf', sign: 1 });
    expect(fpFunction('exp', [fp.inf(1)], F.binary64, 'RNE').value.kind).toBe('zero');
    expect(fpFunction('sin', [fp.inf(0)], F.binary64, 'RNE').flags.invalid).toBe(true);
    expect(toDouble(fpFunction('sin', [fromDouble(1e22)], F.binary64, 'RNE').value)).toBe(Math.sin(1e22));
  });
});

describe('functions in wide formats vs GNU MPFR', () => {
  let ctx;
  let gmp;
  beforeAll(async () => {
    gmp = await init();
    ctx = gmp.getContext({ precisionBits: 64 });
  });
  const parseBin = (s) => {
    const m = /^(-?)([01]*)(?:\.([01]*))?(?:[@e]([+-]?\d+))?$/.exec(s);
    const [, sg, ip = '', fpart = '', ex = '0'] = m;
    let n = BigInt('0b' + ((ip + fpart) || '0'));
    if (sg) n = -n;
    const e = parseInt(ex, 10) - fpart.length;
    return e >= 0 ? frac(n << BigInt(e), 1n) : frac(n, 1n << BigInt(-e));
  };
  for (const fmt of [F.x87, F.binary128, makeFormat({ id: 'c300', name: 'c300', p: 300, expBits: null })]) {
    it(`${fmt.name}: sqrt, exp, ln, sin, atan`, () => {
      const r = rng(fmt.p);
      const MP = { sqrt: 'sqrt', exp: 'exp', ln: 'ln', sin: 'sin', atan: 'atan' };
      for (let i = 0; i < 40; i++) {
        const x = (r() + 0.01) * 10 ** Math.floor(r() * 6 - 3);
        const xv = roundFraction(new Fraction(Math.round(x * 1e9), 1e9), fmt, 'RNE').value;
        const xr = fpToFraction(xv);
        for (const [name, mp] of Object.entries(MP)) {
          const ours = fpToFraction(fpFunction(name, [xv], fmt, 'RNE').value);
          const f = ctx.Float(ctx.Rational(xr.n.toString(), xr.d.toString()), { precisionBits: fmt.p + 20 })[mp]();
          // MPFR at p+20 bits, then rounded once more to p bits by MPFR itself
          const ref = ctx.Float(f, { precisionBits: fmt.p, roundingMode: 0 });
          const refVal = parseBin(ref.toString(2));
          // double rounding through p+20 bits can only differ in astronomically rare cases
          if (!ours.equals(refVal)) throw new Error(`${fmt.name} ${name}(${x}): ours ${ours.toFraction()}, MPFR ${refVal.toFraction()}`);
        }
      }
    });
  }
});

describe('exact reference for irrational values', () => {
  it('stays rational when the result is rational', () => {
    setRealDigits(60);
    expect(exactFunction('sqrt', [exact.finite(new Fraction(16, 9))]).r.toFraction()).toBe('4/3');
    expect(exactFunction('pow', [exact.finite(new Fraction(8)), exact.finite(new Fraction(1, 3))]).r.toFraction()).toBe('2');
    expect(exactFunction('log10', [exact.finite(new Fraction(1, 1000))]).r.toFraction()).toBe('-3');
    expect(exactFunction('exp', [exact.finite(new Fraction(0))]).r.toFraction()).toBe('1');
    expect(exactFunction('sqrt', [exact.finite(new Fraction(2))]).approx).toBe(true);
    expect(exactRoot(10n ** 40n, 4)).toBe(10n ** 10n);
    expect(exactRoot(10n ** 40n + 1n, 4)).toBe(null);
  });

  it('reports how many digits of the reference are verified', () => {
    const r = evaluate({ program: '(1 - cos(x)) / (x*x)', variables: [{ name: 'x', value: '1e-8' }], formats: [F.binary64], mode: 'RNE', refDigits: 60 });
    const x = r.steps[r.result].exact;
    expect(x.approx).toBe(true);
    // 1 − cos(1e-8) cancels 16 digits of the 60-digit reference
    expect(x.reliable).toBeGreaterThan(40);
    expect(x.reliable).toBeLessThan(46);
  });

  it('caps the claimed accuracy at the verified digits', () => {
    const r = evaluate({ program: 'sqrt(2)', formats: [makeFormat({ id: 'w', name: 'w', p: 2000, expBits: null })], mode: 'RNE', refDigits: 30 });
    const st = r.steps[r.result];
    const cmp = compareToExact(st.fmt.w.value, st.exact, r.formats[0]);
    expect(cmp.digits).toBeLessThanOrEqual(st.exact.reliable);
  });

  it('switches huge fractions to the decimal reference (logistic map)', () => {
    const r = evaluate({ program: 'repeat 20 { x = 4*x*(1 - x) }\nx', variables: [{ name: 'x', value: '0.1' }], formats: [F.binary64], mode: 'RNE' });
    const x = r.steps[r.result].exact;
    expect(x.big).toBe(true);
    expect(x.reliable).toBeGreaterThan(40);
  });
});

describe('examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id} evaluates in all formats within 3 s`, () => {
      const t0 = performance.now();
      const r = evaluate({ program: ex.program, variables: ex.variables, formats: FORMATS, mode: 'RNE' });
      expect(r.steps.length).toBeGreaterThan(0);
      expect(performance.now() - t0).toBeLessThan(3000);
    });
  }

  it('the new examples really fail in double', () => {
    const fail = ['rumpSteps', 'recurrence', 'taylor', 'compound', 'golden', 'logistic'];
    for (const id of fail) {
      const ex = EXAMPLES.find((e) => e.id === id);
      const r = evaluate({ program: ex.program, variables: ex.variables, formats: [F.binary64], mode: 'RNE' });
      const st = r.steps[r.result];
      const c = compareToExact(st.fmt.binary64.value, st.exact, F.binary64);
      expect(c.digits, id).toBeLessThan(4);
    }
  });
});
