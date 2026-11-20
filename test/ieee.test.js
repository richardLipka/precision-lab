// Cross-checks of the simulator against independent implementations:
//  * binary64  — the JavaScript engine's native double arithmetic
//  * binary32  — Math.fround (double has ≥ 2p+2 bits, so fround(a op b) is correctly rounded)
//  * binary16  — Math.f16round (same argument)
//  * x87 / binary128 / arbitrary p — GNU MPFR compiled to WebAssembly (gmp-wasm)

import { describe, it, expect, beforeAll } from 'vitest';
import { init } from 'gmp-wasm';
import {
  FORMATS, makeFormat, roundFraction, fpOp, fp, encode, fpToFraction, shortestDecimal, exponentOf, fpEquals,
  withOverflowMode, encodeDpdDeclet, decodeDpdDeclet, decodeDecimal64, maxFinite, minFinite,
} from '../src/engine/ieee.js';
import { evaluate } from '../src/engine/evaluator.js';
import { explainStep } from '../src/engine/explain.js';
import { frac, Fraction, dyadic, parseLiteral } from '../src/engine/rational.js';

const F = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

// Deterministic PRNG (mulberry32)
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

const buf = new DataView(new ArrayBuffer(8));

/** Random double with interesting distribution: random bits, small ints, near-ties. */
function randomDouble(r) {
  const k = r();
  if (k < 0.5) {
    buf.setUint32(0, (r() * 2 ** 32) >>> 0);
    buf.setUint32(4, (r() * 2 ** 32) >>> 0);
    const x = buf.getFloat64(0);
    return Number.isFinite(x) ? x : 1.5;
  }
  if (k < 0.7) return Math.round((r() - 0.5) * 2000) / 8;
  if (k < 0.8) return (r() - 0.5) * 2 ** (Math.floor(r() * 60) - 1074 + 52); // subnormal range
  return (r() - 0.5) * 10 ** Math.floor(r() * 40 - 20);
}

/** Native double → simulator value (exact, via the bit pattern). */
function fromDouble(x, fmt = F.binary64) {
  return roundFraction(doubleToFraction(x), fmt, 'RNE', Object.is(x, -0) ? 1 : 0).value;
}

function doubleToFraction(x) {
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const sign = hi >>> 31;
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let q;
  if (e === 0) q = -1074;
  else { m |= 1n << 52n; q = e - 1075; }
  const n = sign ? -m : m;
  return q >= 0 ? frac(n << BigInt(q), 1n) : frac(n, 1n << BigInt(-q));
}

/** Simulator value → native double through the binary64 bit pattern. */
function toDouble(v) {
  const { bitsStr } = encode(v, F.binary64);
  const b = BigInt('0b' + bitsStr);
  buf.setUint32(0, Number(b >> 32n));
  buf.setUint32(4, Number(b & 0xffffffffn));
  return buf.getFloat64(0);
}

function toFloat32(v) {
  const { bitsStr } = encode(v, F.binary32);
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, Number(BigInt('0b' + bitsStr)));
  return dv.getFloat32(0);
}

function toFloat16(v) {
  const { bitsStr } = encode(v, F.binary16);
  const dv = new DataView(new ArrayBuffer(2));
  dv.setUint16(0, Number(BigInt('0b' + bitsStr)));
  return dv.getFloat16(0);
}

const OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
};

describe('binary64 matches native JavaScript doubles', () => {
  const r = rng(12345);
  for (const op of Object.keys(OPS)) {
    it(`a ${op} b for 4000 random operand pairs`, () => {
      for (let i = 0; i < 4000; i++) {
        const a = randomDouble(r);
        const b = randomDouble(r);
        const native = OPS[op](a, b);
        const sim = fpOp(op, [fromDouble(a), fromDouble(b)], F.binary64, 'RNE').value;
        const got = toDouble(sim);
        if (!Object.is(got, native) && !(Number.isNaN(got) && Number.isNaN(native))) {
          throw new Error(`${a} ${op} ${b}: native ${native}, simulated ${got}`);
        }
      }
    });
  }

  it('special values follow IEEE 754', () => {
    const cases = [[1, 0, '/'], [-1, 0, '/'], [0, 0, '/'], [Infinity, -Infinity, '+'], [Infinity, 0, '*'],
      [-0, -0, '+'], [0, -0, '+'], [1e308, 1e308, '+'], [-1e308, 1e308, '*'], [5e-324, 0.5, '*'], [1, -1, '+']];
    for (const [a, b, op] of cases) {
      const sim = fpOp(op, [a === Infinity || a === -Infinity ? fp.inf(a < 0 ? 1 : 0) : fromDouble(a),
        b === Infinity || b === -Infinity ? fp.inf(b < 0 ? 1 : 0) : fromDouble(b)], F.binary64, 'RNE').value;
      const native = OPS[op](a, b);
      const got = toDouble(sim);
      expect(Object.is(got, native) || (Number.isNaN(got) && Number.isNaN(native))).toBe(true);
    }
  });

  it('decimal literals convert like JavaScript', () => {
    const r2 = rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = randomDouble(r2);
      const s = x.toPrecision(1 + Math.floor(r2() * 20));
      const v = roundFraction(parseDec(s), F.binary64, 'RNE').value;
      expect(toDouble(v)).toBe(Number(s));
    }
  });

  it('shortest decimal equals Number.prototype.toString', () => {
    const r2 = rng(99);
    for (let i = 0; i < 1500; i++) {
      const x = randomDouble(r2);
      if (x === 0) continue;
      const s = shortestDecimal(fromDouble(x), F.binary64).replaceAll('−', '-').replace('e+', 'e');
      expect(Number(s)).toBe(x);
      const digits = (y) => y.replace(/^-/, '').replace(/e.*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
      expect(digits(s)).toBe(digits(String(x).replace('e+', 'e')));
    }
  });
});

function parseDec(s) {
  const m = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(s);
  const [, sg, ip, fpart = '', ex = '0'] = m;
  const e = parseInt(ex, 10) - fpart.length;
  let n = BigInt(ip + fpart);
  if (sg) n = -n;
  return e >= 0 ? frac(n * 10n ** BigInt(e), 1n) : frac(n, 10n ** BigInt(-e));
}

describe('binary32 / binary16 match Math.fround / Math.f16round', () => {
  const r = rng(4242);
  for (const op of Object.keys(OPS)) {
    it(`float ${op}`, () => {
      for (let i = 0; i < 3000; i++) {
        const a = Math.fround(randomDouble(r) * 2 ** Math.floor(r() * 200 - 100));
        const b = Math.fround(randomDouble(r) * 2 ** Math.floor(r() * 200 - 100));
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const native = Math.fround(OPS[op](a, b));
        const sim = fpOp(op, [fromDouble(a, F.binary32), fromDouble(b, F.binary32)], F.binary32, 'RNE').value;
        const got = toFloat32(sim);
        if (!Object.is(got, native) && !(Number.isNaN(got) && Number.isNaN(native))) {
          throw new Error(`float ${a} ${op} ${b}: native ${native}, simulated ${got}`);
        }
      }
    });
    it(`half ${op}`, () => {
      for (let i = 0; i < 3000; i++) {
        const a = Math.f16round((r() - 0.5) * 2 ** Math.floor(r() * 40 - 25));
        const b = Math.f16round((r() - 0.5) * 2 ** Math.floor(r() * 40 - 25));
        const native = Math.f16round(OPS[op](a, b));
        const sim = fpOp(op, [fromDouble(a, F.binary16), fromDouble(b, F.binary16)], F.binary16, 'RNE').value;
        const got = toFloat16(sim);
        if (!Object.is(got, native) && !(Number.isNaN(got) && Number.isNaN(native))) {
          throw new Error(`half ${a} ${op} ${b}: native ${native}, simulated ${got}`);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// MPFR oracle for wider formats and all directed rounding modes.
// MPFR represents x = m·2^e with 1/2 ≤ m < 1, so an IEEE format with
// exponent range [emin, emax] corresponds to MPFR emin+1 .. emax+1. We test
// the normal range plus overflow (subnormals are covered by the native tests).
// ---------------------------------------------------------------------------

function parseMpfrBinary(s) {
  if (s === 'Infinity' || s === '@Inf@') return 'inf';
  if (s === '-Infinity' || s === '-@Inf@') return '-inf';
  const m = /^(-?)([01]*)(?:\.([01]*))?(?:[@e]([+-]?\d+))?$/.exec(s);
  if (!m) throw new Error('cannot parse MPFR output ' + s);
  const [, sg, ip = '', fpart = '', ex = '0'] = m;
  let n = BigInt('0b' + ((ip + fpart) || '0'));
  if (sg) n = -n;
  const e = parseInt(ex, 10) - fpart.length;
  return e >= 0 ? frac(n << BigInt(e), 1n) : frac(n, 1n << BigInt(-e));
}

describe('wide formats match GNU MPFR', () => {
  let gmp;
  let ctx;
  beforeAll(async () => {
    gmp = await init();
    ctx = gmp.getContext({ precisionBits: 64 });
  });

  const MODES = { RNE: 0, RZ: 1, RU: 2, RD: 3 };
  const fmts = [F.x87, F.binary128, makeFormat({ id: 'c200', name: 'custom', p: 200, expBits: 20 }), F.binary32];

  for (const fmt of fmts) {
    it(`${fmt.name}: random rationals, 4 rounding modes`, () => {
      const r = rng(fmt.p * 31 + 7);
      gmp.binding.mpfr_set_emin(fmt.emin + 1);
      gmp.binding.mpfr_set_emax(fmt.emax + 1);
      try {
        for (let i = 0; i < 600; i++) {
          // random numerator/denominator with a few hundred bits, scaled into range
          const nb = 1 + Math.floor(r() * 300);
          const db = 1 + Math.floor(r() * 300);
          let n = 0n;
          let d = 0n;
          for (let j = 0; j < nb; j += 30) n = (n << 30n) | BigInt(Math.floor(r() * 2 ** 30));
          for (let j = 0; j < db; j += 30) d = (d << 30n) | BigInt(Math.floor(r() * 2 ** 30));
          if (d === 0n) d = 1n;
          if (n === 0n) n = 1n;
          if (r() < 0.5) n = -n;
          // Occasionally force an exact tie at precision p.
          if (r() < 0.1) { n = ((BigInt(Math.floor(r() * 2 ** 30)) << BigInt(fmt.p)) | 1n) * (n < 0n ? -1n : 1n); d = 2n; }
          const shift = Math.floor((r() - 0.5) * Math.min(2 * fmt.emax, 4000));
          const q = shift >= 0 ? frac(n << BigInt(shift), d) : frac(n, d << BigInt(-shift));
          if (fmt.bounded && Math.abs(Number(q.n.toString(2).length - q.d.toString(2).length)) > 0) {
            // skip values in the subnormal range (MPFR would flush them)
            const lg = q.n.toString(2).length - q.d.toString(2).length;
            if (lg < fmt.emin + 2) continue;
          }
          for (const [mode, rm] of Object.entries(MODES)) {
            const ours = roundFraction(q, fmt, mode).value;
            const ref = ctx.Float(ctx.Rational((q.s * q.n).toString(), q.d.toString()), { precisionBits: fmt.p, roundingMode: rm });
            const refStr = ref.toString(2);
            const refVal = parseMpfrBinary(refStr);
            if (refVal === 'inf' || refVal === '-inf') {
              expect(ours.kind).toBe('inf');
              expect(ours.sign).toBe(refVal === 'inf' ? 0 : 1);
            } else {
              const mine = fpToFraction(ours);
              if (!mine.equals(refVal)) {
                throw new Error(`${fmt.name} ${mode}: ${q.toFraction()} → ours ${mine.toFraction()} MPFR ${refStr}`);
              }
            }
          }
        }
      } finally {
        gmp.binding.mpfr_set_emin(gmp.binding.mpfr_get_emin_min());
        gmp.binding.mpfr_set_emax(gmp.binding.mpfr_get_emax_max());
      }
    });
  }
});

describe('format details', () => {
  it('encodes well-known bit patterns', () => {
    const one = roundFraction(new Fraction(1), F.binary32).value;
    expect(encode(one, F.binary32).hex).toBe('0x3F800000');
    const tenth = roundFraction(new Fraction(1, 10), F.binary64).value;
    expect(encode(tenth, F.binary64).hex).toBe('0x3FB999999999999A');
    const x = roundFraction(new Fraction(1, 10), F.x87).value;
    expect(encode(x, F.x87).hex).toBe('0x3FFBCCCCCCCCCCCCCCCD');
    const q = roundFraction(new Fraction(1, 3), F.binary128).value;
    expect(encode(q, F.binary128).hex).toBe('0x3FFD5555555555555555555555555555');
    expect(encode(fp.inf(1), F.x87).hex).toBe('0xFFFF8000000000000000');
    expect(encode(roundFraction(new Fraction(1, 3), F.binary16).value, F.binary16).hex).toBe('0x3555');
  });

  it('rounding modes on a tie', () => {
    const f = makeFormat({ id: 't', name: 't', p: 3, expBits: 4 });
    const val = (r, m) => fpToFraction(roundFraction(r, f, m).value).toFraction();
    // 9/8 = 1.001₂ lies halfway between 1.00₂ and 1.01₂
    expect(val(new Fraction(9, 8), 'RNE')).toBe('1');
    expect(val(new Fraction(9, 8), 'RNA')).toBe('5/4');
    expect(val(new Fraction(-9, 8), 'RU')).toBe('-1');
    expect(val(new Fraction(-9, 8), 'RD')).toBe('-5/4');
    expect(val(new Fraction(11, 8), 'RNE')).toBe('3/2'); // 1.011 → 1.10 (even)
    // RNA ties away from zero on both signs, subnormal ties, and overflow ties
    expect(val(new Fraction(-9, 8), 'RNA')).toBe('-5/4');
    expect(val(new Fraction(11, 8), 'RNA')).toBe('3/2');
    expect(fpToFraction(roundFraction(dyadic(1n, -25), F.binary16, 'RNE').value).n).toBe(0n);
    expect(fpToFraction(roundFraction(dyadic(1n, -25), F.binary16, 'RNA').value).equals(dyadic(1n, -24))).toBe(true);
    expect(roundFraction(dyadic(1n, -25, 1), F.binary16, 'RNA').value.sign).toBe(1);
    expect(roundFraction(dyadic((1n << 25n) - 1n, 103), F.binary32, 'RNA').value.kind).toBe('inf');
  });

  it('overflow direction and below/above neighbours are valid across all 5 modes', () => {
    const cases = [
      dyadic(1n, 128), dyadic(1n, 128, 1),
      dyadic(1n, 128).add(1), dyadic(1n, 128, 1).sub(1),
    ];
    for (const r of cases) {
      const neg = r.s < 0n;
      for (const mode of ['RNE', 'RNA', 'RZ', 'RU', 'RD']) {
        const res = roundFraction(r, F.binary32, mode);
        expect(res.overflow, `${mode} ${r.toFraction()}`).toBe(true);
        expect(res.inexact, `${mode} ${r.toFraction()}`).toBe(true);
        const toInf = res.value.kind === 'inf';
        expect(res.direction, `${mode} neg=${neg} toInf=${toInf}`).toBe(toInf !== neg ? 'up' : 'down');
        // below and above must always be valid format values (never exponent > emax)
        if (res.below.kind === 'finite') expect(exponentOf(res.below)).toBeLessThanOrEqual(F.binary32.emax);
        if (res.above.kind === 'finite') expect(exponentOf(res.above)).toBeLessThanOrEqual(F.binary32.emax);
        if (!neg) {
          expect(res.below.kind).toBe('finite');
          expect(res.above.kind).toBe('inf');
        } else {
          expect(res.below.kind).toBe('inf');
          expect(res.above.kind).toBe('finite');
        }
      }
    }
  });

  it('shortestDecimal is optimal on every binary64 power of two and every positive binary16 value', () => {
    const sigCount = (s) => s.replace(/^−|-/, '').replace(/e.*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
    for (let e = -1074; e <= 1023; e++) {
      const x = 2 ** e;
      const v = fromDouble(x);
      const s = shortestDecimal(v, F.binary64).replaceAll('−', '-').replace('e+', 'e');
      expect(Number(s), `2^${e}`).toBe(x);
      expect(sigCount(s), `2^${e}: ${s} vs ${String(x)}`).toBeLessThanOrEqual(sigCount(String(x).replace('e+', 'e')));
    }
    // Exhaustive positive finite binary16 (including 0x2400 = 2^-5 = 0.03125)
    for (let bits = 1; bits < 0x7c00; bits++) {
      const e = (bits >> 10) & 0x1f;
      const f = bits & 0x3ff;
      const v = e === 0 ? fp.finite(0, BigInt(f), -24) : fp.finite(0, BigInt(0x400 | f), e - 25);
      const s = shortestDecimal(v, F.binary16).replaceAll('−', '-');
      const back = roundFraction(parseDec(s), F.binary16, 'RNE').value;
      expect(fpEquals(back, v), `0x${bits.toString(16)} → ${s}`).toBe(true);
    }
    expect(shortestDecimal(fp.finite(0, 1024n, -15), F.binary16)).toBe('0.03125');
  });

  it('dyadicSum short-circuits zero operands and parseLiteral rejects division by zero / keeps -0', () => {
    const unb = makeFormat({ id: 'u', name: 'u', p: 53, expBits: null });
    const huge = fp.finite(0, 1n << 52n, 1_000_000);
    const t0 = performance.now();
    const res = fpOp('+', [fp.zero(0), huge], unb, 'RNE');
    expect(performance.now() - t0).toBeLessThan(200);
    expect(fpEquals(res.value, huge)).toBe(true);

    expect(parseLiteral('1/0')).toBeNull();
    expect(parseLiteral('0/0')).toBeNull();
    expect(parseLiteral('-0/1')).toMatchObject({ kind: 'finite', negZero: true });
    expect(parseLiteral('0/-1')).toMatchObject({ kind: 'finite', negZero: true });
  });
});

describe('IEEE 754 decimal64 (BID and DPD)', () => {
  it('round-trips all 1,000 DPD 10-bit declets losslessly', () => {
    const seen = new Set();
    for (let d1 = 0; d1 <= 9; d1++) {
      for (let d2 = 0; d2 <= 9; d2++) {
        for (let d3 = 0; d3 <= 9; d3++) {
          const enc = encodeDpdDeclet(d1, d2, d3);
          expect(enc.length).toBe(10);
          expect(seen.has(enc)).toBe(false);
          seen.add(enc);
          expect(decodeDpdDeclet(enc)).toEqual([d1, d2, d3]);
        }
      }
    }
    expect(seen.size).toBe(1000);
  });

  it('matches canonical IEEE 754 decimal64 BID and DPD 64-bit hex encodings and round-trips', () => {
    const cases = [
      { v: fp.zero(0, 0, 10), bid: '0x31C0000000000000', dpd: '0x2238000000000000' },
      { v: fp.zero(1, 0, 10), bid: '0xB1C0000000000000', dpd: '0xA238000000000000' },
      { v: fp.finite(0, 1n, 0, 10), bid: '0x31C0000000000001', dpd: '0x2238000000000001' },
      { v: fp.finite(0, 1n, -1, 10), bid: '0x31A0000000000001', dpd: '0x2234000000000001' },
      { v: fp.inf(0), bid: '0x7800000000000000', dpd: '0x7800000000000000' },
      { v: fp.inf(1), bid: '0xF800000000000000', dpd: '0xF800000000000000' },
      { v: fp.nan(), bid: '0x7C00000000000000', dpd: '0x7C00000000000000' },
    ];
    for (const { v, bid, dpd } of cases) {
      const eBid = encode(v, F.decimal64_bid);
      const eDpd = encode(v, F.decimal64_dpd);
      expect(eBid.bitsStr.length).toBe(64);
      expect(eDpd.bitsStr.length).toBe(64);
      expect(eBid.hex).toBe(bid);
      expect(eDpd.hex).toBe(dpd);
      expect(fpEquals(decodeDecimal64(eBid.bitsStr, 'bid'), v)).toBe(true);
      expect(fpEquals(decodeDecimal64(eDpd.bitsStr, 'dpd'), v)).toBe(true);
    }
    // Large significand (c >= 2^53) uses BID '11'-prefix combination form and DPD d0=9 form
    const bigC = fp.finite(0, 9999999999999999n, 0, 10);
    const eBid = encode(bigC, F.decimal64_bid);
    const eDpd = encode(bigC, F.decimal64_dpd);
    expect(eBid.bidLarge).toBe(true);
    expect(eBid.comb.startsWith('11')).toBe(true);
    expect(eDpd.comb5.startsWith('11')).toBe(true);
    expect(decodeDecimal64(eBid.bitsStr, 'bid')).toEqual(bigC);
    expect(decodeDecimal64(eDpd.bitsStr, 'dpd')).toEqual(bigC);
    // Subnormal (1e-398, E=0)
    const sub = fp.finite(0, 1n, -398, 10);
    expect(encode(sub, F.decimal64_bid).cls).toBe('subnormal');
    expect(decodeDecimal64(encode(sub, F.decimal64_bid).bitsStr, 'bid')).toEqual(sub);
    expect(decodeDecimal64(encode(sub, F.decimal64_dpd).bitsStr, 'dpd')).toEqual(sub);
  });

  it('computes 0.1 + 0.2 == 0.3 exactly, preserves cohorts, and rounds base-10 ties across all 5 modes', () => {
    const r = evaluate({
      program: 'c = a + b\nc == 0.3\nx = 1.0 + 2.00',
      variables: [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }],
      formats: [F.decimal64_bid, F.decimal64_dpd],
      mode: 'RNE',
    });
    const cBid = r.steps[r.env.c].fmt.decimal64_bid;
    const cDpd = r.steps[r.env.c].fmt.decimal64_dpd;
    expect(cBid.flags.inexact).toBe(false);
    expect(shortestDecimal(cBid.value, F.decimal64_bid)).toBe('0.3');
    expect(shortestDecimal(cDpd.value, F.decimal64_dpd)).toBe('0.3');
    expect(encode(cBid.value, F.decimal64_bid).hex).not.toBe(encode(cDpd.value, F.decimal64_dpd).hex);
    expect(fpToFraction(r.steps[r.env.x].fmt.decimal64_bid.value).toFraction()).toBe('3');
    expect(r.steps[r.env.x].fmt.decimal64_bid.value.q).toBe(-2); // preferred quantum min(-1, -2) = -2

    // Exact decimal tie (guard digit 5, sticky 0): 1.0000000000000005 (last kept 0 even) vs 1.0000000000000015 (last kept 1 odd)
    const tieEven = new Fraction(10n ** 16n + 5n, 10n ** 16n);
    const tieOdd = new Fraction(10n ** 16n + 15n, 10n ** 16n);
    const rneEven = roundFraction(tieEven, F.decimal64_bid, 'RNE');
    const rnaEven = roundFraction(tieEven, F.decimal64_bid, 'RNA');
    const rneOdd = roundFraction(tieOdd, F.decimal64_bid, 'RNE');
    expect(rneEven.guard).toBe(5);
    expect(rneEven.sticky).toBe(false);
    expect(fpToFraction(rneEven.value).toFraction()).toBe('1');
    expect(fpToFraction(rnaEven.value).equals(new Fraction(10n ** 15n + 1n, 10n ** 15n))).toBe(true);
    expect(fpToFraction(rneOdd.value).equals(new Fraction(10n ** 15n + 2n, 10n ** 15n))).toBe(true);
  });
});

describe('fixed-point Q16.16 and DEC(18,4)', () => {
  it('encodes Q16.16 two’s-complement bits and hex accurately', () => {
    expect(encode(roundFraction(new Fraction(0), F.q16_16).value, F.q16_16).hex).toBe('0x00000000');
    expect(encode(roundFraction(new Fraction(1), F.q16_16).value, F.q16_16).hex).toBe('0x00010000');
    expect(encode(roundFraction(new Fraction(-1), F.q16_16).value, F.q16_16).hex).toBe('0xFFFF0000');
    expect(encode(roundFraction(new Fraction(1, 2), F.q16_16).value, F.q16_16).hex).toBe('0x00008000');
    expect(encode(minFinite(F.q16_16), F.q16_16).hex).toBe('0x80000000');
    expect(encode(maxFinite(F.q16_16), F.q16_16).hex).toBe('0x7FFFFFFF');
  });

  it('switches cleanly between saturation and two’s-complement wraparound on overflow and neg(min)', () => {
    const rSat = evaluate({ program: 's = 20000 + 20000\nn = -(-32768)\na = abs(-32768)', formats: [F.q16_16], mode: 'RNE', overflowMode: 'sat' });
    const rWrap = evaluate({ program: 's = 20000 + 20000\nn = -(-32768)\na = abs(-32768)', formats: [F.q16_16], mode: 'RNE', overflowMode: 'wrap' });

    const sSat = rSat.steps[rSat.env.s];
    const sWrap = rWrap.steps[rWrap.env.s];
    expect(fpEquals(sSat.fmt.q16_16.value, maxFinite(F.q16_16))).toBe(true);
    expect(sSat.fmt.q16_16.round.overflowKind).toBe('sat');
    expect(fpToFraction(sWrap.fmt.q16_16.value).toFraction()).toBe('-25536');
    expect(sWrap.fmt.q16_16.round.overflowKind).toBe('wrap');

    // Two's-complement asymmetry: -(-32768) saturates to maxFinite or wraps back to -32768
    expect(fpEquals(rSat.steps[rSat.env.n].fmt.q16_16.value, maxFinite(F.q16_16))).toBe(true);
    expect(fpEquals(rWrap.steps[rWrap.env.n].fmt.q16_16.value, minFinite(F.q16_16))).toBe(true);
    expect(fpEquals(rSat.steps[rSat.env.a].fmt.q16_16.value, maxFinite(F.q16_16))).toBe(true);
    expect(fpEquals(rWrap.steps[rWrap.env.a].fmt.q16_16.value, minFinite(F.q16_16))).toBe(true);

    // Explainers name saturation vs wraparound accurately
    const exSat = explainStep(sSat, rSat.steps, withOverflowMode(F.q16_16, 'sat'), 'RNE');
    const exWrap = explainStep(sWrap, rWrap.steps, withOverflowMode(F.q16_16, 'wrap'), 'RNE');
    expect(exSat.cause.code).toBe('saturate');
    expect(exSat.items[0].code).toBe('fxp.saturate');
    expect(exWrap.cause.code).toBe('wrap');
    expect(exWrap.items[0].code).toBe('fxp.wrap');
  });

  it('DEC(18,4) keeps 0.1 sums & 1e12 + 0.0001 exact, flushes tiny products to 0, traps on div0, and supports casts', () => {
    const r = evaluate({
      program: 's = 0\nrepeat 10 { s = s + 0.1 }\nbig = 1e12 + 0.0001\ntiny = 0.01 * 0.001\ndiv0 = 1 / 0\nc1 = decimal64(0.1)\nc2 = q16_16(1.5)\nc3 = dec18_4(1/3)',
      formats: [F.dec18_4, F.binary64],
      mode: 'RNE',
    });
    expect(shortestDecimal(r.steps[r.env.s].fmt.dec18_4.value, F.dec18_4)).toBe('1');
    expect(shortestDecimal(r.steps[r.env.big].fmt.dec18_4.value, F.dec18_4)).toBe('1000000000000.0001');
    expect(r.steps[r.env.tiny].fmt.dec18_4.value.kind).toBe('zero');
    expect(r.steps[r.env.tiny].fmt.dec18_4.flags.underflow).toBe(true);
    expect(r.steps[r.env.div0].fmt.dec18_4.value.trap).toBe(true);
    expect(shortestDecimal(r.steps[r.env.div0].fmt.dec18_4.value, F.dec18_4)).toBe('ERR');
    expect(r.steps[r.env.div0].fmt.dec18_4.flags.divByZero).toBe(true);
    expect(shortestDecimal(r.steps[r.env.c3].fmt.dec18_4.value, F.dec18_4)).toBe('0.3333');
    // Cast double(0.1) → decimal64(0.1) → double works cleanly
    expect(r.steps[r.env.c1].fmt.binary64.value.kind).toBe('finite');
    expect(fpToFraction(r.steps[r.env.c2].fmt.binary64.value).toFraction()).toBe('3/2');
  });
});
