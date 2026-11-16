# Precision Lab

**See floating-point arithmetic step by step: float, double, x87 extended, quad and any precision, compared with the exact result.**
A teaching tool for numerical-analysis and computer-architecture courses. Czech and English.

[![Deploy](https://github.com/richardLipka/precision-lab/actions/workflows/deploy.yml/badge.svg)](https://github.com/richardLipka/precision-lab/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

🇨🇿 **[Česká verze tohoto souboru →](README.cs.md)**
▶️ **[Live demo](https://richardlipka.github.io/precision-lab/)**

---

## What it does

Type a few variables and a short program, such as `0.1 + 0.2`, Rump's polynomial or a loop.
Precision Lab evaluates it **once exactly** and **once in every selected IEEE 754 format**,
operation by operation, and shows where and why the results drift apart.

### Format comparison
* **Formats:** binary16 (half), bfloat16, binary32 (float), binary64 (double), x87 80-bit
  extended, binary128 (quad), and a custom format with any precision p (1 – 100 000 bits) and a
  bounded or unbounded exponent. Five IEEE rounding modes.
* **Step table:** for every operation it shows the value in each format, the rounding direction,
  the number of correct significant digits, the IEEE flags (inexact, overflow, underflow,
  division by zero, invalid), and **the cause of the difference**: representation, rounding,
  cancellation ×κ, absorption, inherited error, conditioning ×κ, overflow, underflow.
* **Step detail:**
  * a plain-language explanation of what happened
  * the exact result before rounding, with its two representable neighbours on a number line
  * guard and sticky bits
  * the stored value as an exact decimal and as a bit pattern (sign / exponent / fraction, hex)
  * the error split into the part inherited from the operands and the new rounding error
* **Diagnosis:** for each format, the steps that cost the most correct digits.
* **Error-propagation chart:** correct digits after each step, one line per format.

### Precision sweep
Runs the program with every precision p from a list or range (e.g. `1-1000`, `11, 24, 53, 64, 113`).
It shows:
* the error of the result against p, next to the ideal "one rounding" line
* correct digits step by step, one line per precision
* a verdict: does it converge, from which p are 1 / 6 / 15 digits correct, is there a sharp
  threshold (Rump: p = 122), and how many digits the algorithm loses.

### Rearranging the expression (AST)
Shows the syntax tree of any statement and offers only **meaning-preserving** rewrites for the
selected node:
* commutativity, associativity (including mixed + / − and × / ÷)
* distributivity and factoring
* a − b ↔ a + (−b)
* x·x·x ↔ x³ ↔ pow(x, 3) (one rounding instead of many), sqrt ↔ pow(x, 0.5)

Every rewrite is checked: the exact value of every variable must stay the same. A rewrite that is
only an identity when no division by zero occurs is refused when it would change the result.
The rounded results before and after are compared format by format.

### Language
```
s = 0                        # assignment, one statement per line or separated by ;
repeat 10 { s = s + 0.1 }    # loop
x^3                          # integer power = repeated, individually rounded multiplication
fma(a, b, -c)                # a·b − c with a single rounding
sqrt exp ln log10 sin cos tan atan pow(x, y) pi    # correctly rounded in every format
```
Inputs are exact: `0.1`, `-2.5e-3`, `1/3`, `0x1.8p-2`, `inf`. Evaluation is strictly left to right
as written, so `a + b + c` means `(a + b) + c`.

### Examples
22 built-in examples. Classic ones that fail partway through the calculation:
* Rump's polynomial, written in two ways
* Muller's recurrence
* the unstable recurrence Iₙ = 1/n − 5·Iₙ₋₁
* the Taylor series of e⁻²⁰
* the lost root of the quadratic formula
* Kahan's needle-like triangle
* (1 − cos x)/x²
* compound interest (1 + 1/n)ⁿ
* the golden-ratio recurrence
* the logistic map
* Kahan summation, one-pass variance and sin(10²²)

## How exact is "exact"?

* **Rational values are exact.** They use [fraction.js](https://github.com/rawify/Fraction.js)
  (BigInt numerator and denominator), so + − × ÷ never round.
* **Irrational values** (√2, e, ln 1.2, π …), and fractions that grow beyond 60 000 bits, continue as
  [decimal.js](https://github.com/MikeMcl/decimal.js) decimals. They are computed twice, at D and
  1.5·D digits. Only the digits on which both agree count as verified, and no format is ever
  credited with more correct digits than that.
* **The IEEE simulation is bit-exact.** Every operation takes the exact result on the format's own
  operands and rounds it once, which is how IEEE 754 defines it. sqrt is correctly rounded. exp, ln,
  sin, … are simulated as correctly rounded (Ziv's strategy). Real `libm` functions may be off by
  up to about 1 ulp.

## Verification

`npm test` (137 tests) checks the simulator against independent implementations:
* binary64 against native JavaScript doubles: + − × ÷, special values, decimal conversion and the
  shortest round-trip output
* binary32 against `Math.fround`, binary16 against `Math.f16round`
* x87 extended, binary128 and wide custom formats against GNU MPFR
  ([gmp-wasm](https://github.com/Daninet/gmp-wasm)) in four rounding modes
* sqrt bit-identical, and exp, ln, sin, cos, atan within 1 ulp of JavaScript's `Math`; the
  functions against MPFR for 64, 113 and 300 bits
* every rewrite rule at every node of every example keeps the exact value
* every text exists in Czech and English

## Running locally

Requires Node.js 24 or newer.

```bash
npm install
npm run dev      # development server
npm test
npm run build    # static site in dist/
```

Every push to `main` is tested and deployed to GitHub Pages by
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Project layout

| Path | Contents |
|---|---|
| `src/engine/rational.js` | exact values, literal parsing, exact decimal expansion |
| `src/engine/ieee.js` | formats, correct rounding for any p and exponent range, bit encoding, shortest decimal |
| `src/engine/real.js`, `fpfunc.js` | decimal.js reference for irrational values; correctly rounded functions |
| `src/engine/parser.js`, `evaluator.js` | the language and the step list |
| `src/engine/explain.js`, `metrics.js` | cause analysis and error measures |
| `src/engine/sweep.js` | precision sweep and convergence analysis (runs in a Web Worker) |
| `src/engine/ast.js` | meaning-preserving rewrite rules |
| `src/ui/` | views, charts, examples; `src/i18n.js` Czech/English texts |

## Author and licence

[MIT](LICENSE) © 2026 [Richard Lipka](https://home.zcu.cz/~lipka/) &lt;lipka@fav.zcu.cz&gt;,
[Department of Computer Science and Engineering](https://www.kiv.zcu.cz/cs), Faculty of Applied
Sciences, University of West Bohemia.

The faculty mark shown in the footer belongs to the university and is not covered by the MIT licence.
