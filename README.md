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
  * **bit by bit:** the operands' bit fields; for + and − the significands aligned to a common exponent;
    the exact result with the kept p bits, the guard bit and the sticky bits marked
  * **formal notation:** x̂ = RN₅₃(a + b) = (a + b)(1 + δ) with the actual δ and its bound u = 2⁻ᵖ (or the
    absolute error η for subnormals); compare n-bit integers, where a ⊕ b = (a + b) mod 2ⁿ
  * the panel can be widened by dragging its left edge (or "fit bits"), so a 64-bit pattern fits on one line
* **Diagnosis:** for each format, the steps that cost the most correct digits.
* **Error-propagation chart:** after each step, one line per format: correct digits, |computed − true|
  or the relative error (log scale).

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
21 built-in examples. Classic ones that fail partway through the calculation:
* Rump's polynomial
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

## Sources of the examples

Each example shows its sources in the app. "Original" means the publication where the example (or its
idea) appeared first; the others explain the effect. All DOIs were checked against Crossref.

| Example | Sources |
|---|---|
| 0.1 + 0.2, representation error, catastrophic cancellation | Goldberg 1991 [1] |
| Addition is not associative | Goldberg 1991 [1] (the same example with ±10³⁰) |
| Adding 0.1 ten times, harmonic sum | Higham 2002 [2], chapter 4 |
| One-pass variance | Welford 1962 [3] (stable alternative), Chan, Golub & LeVeque 1983 [4] |
| Rump's example | Rump 1988 [5], analysis Loh & Walster 2002 [6] |
| Muller's recurrence | Muller 1989 [7] (there u₀ = 11/2, u₁ = 61/11), this version Muller et al. 2018 [8], analysis Rump 2020 [9] |
| Fused multiply-add | Montoye, Hokenek & Runyon 1990 [10], Ogita, Rump & Oishi 2005 [11] |
| Overflow and underflow | IEEE 754-2019 [12] |
| Taylor series of e⁻²⁰, quadratic formula | Forsythe 1970 [13]; Goldberg 1991 [1] |
| Needle-like triangle | Kahan 2014 [14] (our side lengths), Goldberg 1991 [1] |
| (1 − cos x)/x² | Higham 2002 [2], chapter 1 |
| Compound interest | Goldberg 1991 [1] (there with daily interest, n = 365) |
| Golden-ratio recurrence | Press et al. 1992 [15], §1.3 |
| Logistic map | May 1976 [16] |
| Kahan summation | Kahan 1965 [17], Goldberg 1991 [1] |
| sin of a huge argument | Payne & Hanek 1983 [18] |
| Iₙ = 1/n − 5·Iₙ₋₁ | a common textbook exercise; no original publication could be traced |

1. D. Goldberg: What every computer scientist should know about floating-point arithmetic. *ACM Computing Surveys* 23(1), 5–48, 1991. [doi:10.1145/103162.103163](https://doi.org/10.1145/103162.103163)
2. N. J. Higham: *Accuracy and Stability of Numerical Algorithms*, 2nd ed. SIAM, 2002. [doi:10.1137/1.9780898718027](https://doi.org/10.1137/1.9780898718027)
3. B. P. Welford: Note on a method for calculating corrected sums of squares and products. *Technometrics* 4(3), 419–420, 1962. [doi:10.1080/00401706.1962.10490022](https://doi.org/10.1080/00401706.1962.10490022)
4. T. F. Chan, G. H. Golub, R. J. LeVeque: Algorithms for computing the sample variance: analysis and recommendations. *The American Statistician* 37(3), 242–247, 1983. [doi:10.1080/00031305.1983.10483115](https://doi.org/10.1080/00031305.1983.10483115)
5. S. M. Rump: Algorithms for verified inclusions: theory and practice. In R. E. Moore (ed.), *Reliability in Computing*, Academic Press, 109–126, 1988. [doi:10.1016/B978-0-12-505630-4.50012-2](https://doi.org/10.1016/B978-0-12-505630-4.50012-2)
6. E. Loh, G. W. Walster: Rump's example revisited. *Reliable Computing* 8(3), 245–248, 2002. [doi:10.1023/A:1015569431383](https://doi.org/10.1023/A:1015569431383)
7. J.-M. Muller: *Arithmétique des ordinateurs*. Masson, Paris, 1989. [HAL ensl-00086707](https://ens-lyon.hal.science/ensl-00086707)
8. J.-M. Muller et al.: *Handbook of Floating-Point Arithmetic*, 2nd ed. Birkhäuser, 2018. [doi:10.1007/978-3-319-76526-6](https://doi.org/10.1007/978-3-319-76526-6)
9. S. M. Rump: On recurrences converging to the wrong limit in finite precision and some new examples. *Electronic Transactions on Numerical Analysis* 52, 358–369, 2020. [doi:10.1553/etna_vol52s358](https://doi.org/10.1553/etna_vol52s358)
10. R. K. Montoye, E. Hokenek, S. L. Runyon: Design of the IBM RISC System/6000 floating-point execution unit. *IBM J. Res. Dev.* 34(1), 59–70, 1990. [doi:10.1147/rd.341.0059](https://doi.org/10.1147/rd.341.0059)
11. T. Ogita, S. M. Rump, S. Oishi: Accurate sum and dot product. *SIAM J. Sci. Comput.* 26(6), 1955–1988, 2005. [doi:10.1137/030601818](https://doi.org/10.1137/030601818)
12. IEEE Standard for Floating-Point Arithmetic, IEEE Std 754-2019. [doi:10.1109/IEEESTD.2019.8766229](https://doi.org/10.1109/IEEESTD.2019.8766229)
13. G. E. Forsythe: Pitfalls in computation, or why a math book isn't enough. *The American Mathematical Monthly* 77(9), 931–956, 1970. [doi:10.1080/00029890.1970.11992636](https://doi.org/10.1080/00029890.1970.11992636)
14. W. Kahan: Miscalculating area and angles of a needle-like triangle. Lecture notes, UC Berkeley, version of 4 September 2014. [PDF](https://people.eecs.berkeley.edu/~wkahan/Triangle.pdf)
15. W. H. Press, S. A. Teukolsky, W. T. Vetterling, B. P. Flannery: *Numerical Recipes in C*, 2nd ed., §1.3 Error, accuracy, and stability. Cambridge University Press, 1992. [numerical.recipes](https://numerical.recipes/)
16. R. M. May: Simple mathematical models with very complicated dynamics. *Nature* 261, 459–467, 1976. [doi:10.1038/261459a0](https://doi.org/10.1038/261459a0)
17. W. Kahan: Further remarks on reducing truncation errors. *Communications of the ACM* 8(1), 40, 1965. [doi:10.1145/363707.363723](https://doi.org/10.1145/363707.363723)
18. M. H. Payne, R. N. Hanek: Radian reduction for trigonometric functions. *ACM SIGNUM Newsletter* 18(1), 19–24, 1983. [doi:10.1145/1057600.1057602](https://doi.org/10.1145/1057600.1057602)

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

`npm test` (144 tests, including a page smoke test in happy-dom) checks the simulator against independent implementations:
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
