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
* **Getting started:** a short "How to read this page" introduction (what is computed, what to click,
  the three views), shown on the first visit and reopened by the "How to use" button. Next to the format
  choice the page explains what p and the exponent mean, and why real machines can print other results
  (x87 intermediates kept in 80 bits, compilers contracting a·b + c into fma, `-ffast-math`).
* **Formats:** binary16 (half), bfloat16, binary32 (float), binary64 (double), x87 80-bit
  extended, binary128 (quad), IEEE 754 decimal64 (both BID and DPD encodings as separate formats),
  fixed-point Q16.16 (32-bit binary) and DEC(18,4) (64-bit SQL MONEY decimal) with saturating or
  two's-complement wraparound overflow, and a custom binary format with any precision p (1 – 100 000 bits)
  and a bounded or unbounded exponent. Five IEEE rounding modes.
* **Results:** one row for every assigned variable (the final result and the intermediate values that
  later steps use are marked), with the true value and every format side by side, so paired variants
  such as a forward and a backward sum can be compared at a glance. Values are printed as the shortest
  decimal that converts back to the same stored number.
* **Key:** a legend under the results and the step table explains the digit badges and their colours,
  the ↑ / ↓ rounding arrows, the cause chips and the IEEE flag symbols.
* **Step table:** for every operation it shows the value in each format, the rounding direction,
  the number of correct significant digits, the IEEE flags (inexact, overflow, underflow,
  division by zero, invalid), and **the cause of the difference**: representation, rounding,
  cancellation ×κ, absorption, inherited error, conditioning ×κ, overflow, underflow, a wrong
  comparison answer, double rounding, or errors that cancelled by luck.
* **Step detail:**
  * a plain-language explanation of what happened
  * the exact result before rounding, with its two representable neighbours on a number line
  * guard and sticky bits (the first discarded bit and the OR of the rest; the page relates them to the
    guard / round / sticky bits of a hardware adder, which reach the same decision)
  * the stored value as an exact decimal and as a bit pattern (sign / exponent / fraction, hex)
  * the error split into the part inherited from the operands and the new rounding error
  * **bit by bit:** the operands' bit fields; for + and − the significands aligned to a common exponent
    (exactly, at full width); the exact result with the kept p bits, the guard bit and the sticky bits
    marked, and the rule that turns them into the rounding direction
  * **formal notation:** x̂ = RN₅₃(a + b) = (a + b)(1 + δ) with the actual δ and its bound u = 2⁻ᵖ (or the
    absolute error η for subnormals); compare n-bit integers, where a ⊕ b = (a + b) mod 2ⁿ
  * the panel can be widened by dragging its left edge (or "fit bits"), so a 64-bit pattern fits on one line
* **Diagnosis:** for every assigned variable and format, where the information was lost (the steps
  that cost the most correct digits, accumulated rounding, special values), with links to the precision
  sweep and the Rearrange view.
* **Error-propagation chart:** after each step, one line per format: correct digits, |computed − true|
  or the relative error (log scale).

### Precision sweep
Runs the program with every precision p from a list or range (e.g. `1-1000`, `11, 24, 53, 64, 113`).
It shows:
* the error of the result against p, next to the best possible p-bit result (the true value rounded
  once; no computed result can be closer, so the gap is what the calculation loses) and the bound 2⁻ᵖ·|x|
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
c == 0.3                     # comparison: == != < <= > >=, exactly 1 (true) or 0 (false)
abs(c - 0.3) <= 1e-12 * abs(0.3)   # compare with a tolerance (1e-12 suits double; float needs about 1e-6)
double(s)                    # cast: half bfloat16 float double extended quad
```
Inputs are exact: `0.1`, `-2.5e-3`, `1/3`, `0x1.8p-2`, `inf`. Evaluation is strictly left to right
as written, so `a + b + c` means `(a + b) + c`.

A comparison is never rounded: its answer is exactly 1 or 0 in every format, and only the operands'
errors can make it wrong. IEEE 754 rules apply: every comparison with NaN is false except `!=`, and
`+0 == −0`. Comparisons bind more loosely than `+` and `−` and cannot be chained (`a < b < c` is an
error). The exact column compares the true values; when the format's answer differs, the explanation
says why and recommends a tolerance test `|a − b| ≤ tol·max(|a|, |b|)`. The tolerance must be
comfortably larger than the rounding error the computation accumulates in the format at hand (a few
times u = 2⁻ᵖ at the very least): 1e-12 is a sensible tolerance in double (u ≈ 1.1·10⁻¹⁶), but it is
below float's u ≈ 6·10⁻⁸; the example "Comparing with a tolerance" shows this.

A cast such as `double(x)` stores x into that format: in every column the stored value is rounded to
the named format and then held in the column's own format again (rounded a second time if the named
format does not fit into it). In the exact column a cast is the identity, because storing a value
changes only its rounded copy, not the true value; the error of the cast therefore shows up as the
difference from the true value. When a value that was already rounded is rounded again and the two
roundings give a different result than a single one (x87 extended → double), the explanation names
this double rounding.

### Examples
27 built-in examples, ordered as a learning path in six groups: basics (representation, integers, special
values), accumulating rounding errors, cancellation and stable rewrites, amplified errors (unstable
algorithms and sensitive problems), conditioning versus stability, and hardware (fma, x87 double rounding,
decimal64 BID/DPD vs binary, and fixed-point saturation vs wraparound). Every example states
what happens, the lesson to take away and where in the tool to look (a step, the chart, the sweep or the
Rearrange view).

Basics and summation:
* 0.1 + 0.2 and the test c == 0.3 (false in double, true in float and x87 only by luck)
* representation error of decimal inputs
* where integers stop being exact (2²⁴ + 1 in float, 2⁵³ + 1 in double)
* comparing with a tolerance
* special values −0, ∞ and NaN; overflow and underflow
* adding 0.1 ten times, non-associative addition, forward vs backward summation, Kahan summation

Classic ones that fail partway through the calculation:
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
* one-pass vs two-pass variance and sin(10²²)
* fused multiply-add recovering the rounding error of a product, and double rounding (x87 extended → double)

## Sources of the examples

Each example shows its sources in the app. "Original" means the publication where the example (or its
idea) appeared first; the others explain the effect. All DOIs were checked against Crossref.

| Example | Sources |
|---|---|
| 0.1 + 0.2, representation error, catastrophic cancellation | Goldberg 1991 [1] |
| Addition is not associative | Goldberg 1991 [1] (the same example with ±10³⁰; here ±10²⁰) |
| Adding 0.1 ten times, order of summation | Higham 2002 [2], chapter 4 |
| Variance: one pass vs two passes | Welford 1962 [3] (stable alternative), Chan, Golub & LeVeque 1983 [4] |
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
| Where integers stop being exact, comparing with a tolerance, special values, double rounding | illustrations of IEEE 754 rules; no single source |

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

`npm test` (all test files, including page tests in happy-dom) checks the simulator against independent implementations:
* binary64 against native JavaScript doubles: + − × ÷, special values, decimal conversion and the
  shortest round-trip output
* binary32 against `Math.fround`, binary16 against `Math.f16round`
* x87 extended, binary128 and wide custom formats against GNU MPFR
  ([gmp-wasm](https://github.com/Daninet/gmp-wasm)) in four rounding modes
* sqrt bit-identical, and exp, ln, sin, cos, atan within 1 ulp of JavaScript's `Math`; the
  functions against MPFR for 64, 113 and 300 bits
* every rewrite rule at every node of every example keeps the exact value
* comparisons and casts follow the IEEE 754 rules (NaN, ±0, double rounding)
* the examples form a complete learning path, and the examples are rerun to check that they show what
  their texts say (the numbers quoted in the texts included)
* the explanations are honest: an exact result is not blamed on an inherited error, a gain of digits is
  called luck only when conditioning does not explain it, and every bound matches the rounding mode
* every text exists in Czech and English, and every key or explanation code used in the code exists

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

The engine (`src/engine/`) has no DOM code and no texts: it returns numbers and language-neutral codes,
which the UI translates.

| Path | Contents |
|---|---|
| `src/engine/rational.js` | exact values (fraction.js), literal parsing, exact decimal expansion |
| `src/engine/ieee.js` | formats, correct rounding for any p and exponent range, + − × ÷ fma, comparisons and casts, IEEE flags, bit encoding, shortest decimal |
| `src/engine/real.js` | decimal.js reference for irrational values (computed twice, verified digits) |
| `src/engine/fpfunc.js` | correctly rounded sqrt, exp, ln, sin, pow, … in any format (Ziv's strategy) |
| `src/engine/parser.js` | tokenizer and parser of the language (grammar in the header comment) |
| `src/engine/evaluator.js` | the flat step list: every step exactly and in every format |
| `src/engine/explain.js` | why a value differs: the cause chip and the explanation codes of a step, the diagnosis |
| `src/engine/metrics.js` | every error figure (ulp, relative error, correct digits) and all thresholds of the explanations in one place (`QUALITY_GOOD`, `CANCEL_MIN_LOG10_KAPPA`, `COND_CAUSE`, …), each with a comment saying why |
| `src/engine/messages.js` | engine errors (parse errors, limits) in Czech and English, used by the UI and as `Error.message` |
| `src/engine/sweep.js` | precision sweep and convergence analysis |
| `src/engine/ast.js` | meaning-preserving rewrite rules |
| `src/sweep/worker.js` | the Web Worker that runs the sweep off the main thread and reports progress |
| `src/main.js` | page wiring: the state (saved in the browser, shareable as a link), the introduction, the results with the per-variable summary, the diagnosis, the step table, the error chart, the view tabs |
| `src/ui/detail.js` | the step detail panel, the badge legend, explanation rendering |
| `src/ui/binaryView.js` | the "bit by bit" section: bit fields, aligned significands, guard and sticky bits, formal notation |
| `src/ui/chart.js` | generic SVG line chart (error chart and both sweep charts) |
| `src/ui/sweep.js` | the Precision sweep view |
| `src/ui/rewrite.js` | the Rearrange (AST) view |
| `src/ui/examples.js` | the built-in examples and their learning-path groups |
| `src/ui/references.js` | the bibliography and the sources of each example |
| `src/i18n.js` | every user-visible text, Czech and English (`DICT.en`, `DICT.cs`) |
| `index.html`, `src/style.css` | the page skeleton (texts filled in through `data-i18n` attributes) and its styles |
| `test/` | vitest tests: engine against native doubles and MPFR, explanations, examples, i18n parity, page tests in happy-dom |

## How to add an example

1. Add an object to `EXAMPLES` in `src/ui/examples.js`, at the place in the learning path where it
   belongs (examples of one group must stay together):
   ```js
   {
     id: 'myExample',                     // unique, used in the URL and in references.js
     group: 'cancellation',               // one of EXAMPLE_GROUPS
     title: { en: '…', cs: '…' },
     blurb: { en: '…', cs: '…' },         // what happens and why, with the numbers the default formats give
     lesson: { en: '…', cs: '…' },        // the rule to take away
     look: { en: '…', cs: '…' },          // where in the tool to look (a step, the chart, the sweep, Rearrange)
     variables: [{ name: 'x', value: '0.1' }],
     program: 'y = x + x\ny - 0.2',
   },
   ```
2. If the example comes from a publication, add the entry to `BIB` and the example to `EXAMPLE_REFS` in
   `src/ui/references.js` (role `origin`, `version`, `analysis` or `background`, with a short note in
   both languages), and add it to the sources table of both READMEs.
3. Update the example count and the list in `README.md` and `README.cs.md` (a test checks the count).
4. If the text quotes numbers, add a test to `test/examples.test.js` that reruns the example and checks
   them, then run `npm test`.

## How to add an explanation

1. In `src/engine/explain.js`, detect the situation and call `push('group.myCode', params, tone)` (tone
   `good`, `info`, `warn` or `bad`); to name the main cause, call `setCause('myCause', params, tone)`. Params are
   plain values or `key('other.code', params)` for a nested, translated phrase. Thresholds belong in
   `src/engine/metrics.js` as named constants.
2. Add the text `'group.myCode'` (and `'cause.myCause'` with `'cause.myCause.tip'`) to both `DICT.en` and
   `DICT.cs` in `src/i18n.js`, with the same `{placeholder}` names. In Czech, write a count as
   "počet …: {n}" so that the sentence is correct for every n.
3. Add a test in `test/explain.test.js` (or `test/honest.test.js`) that builds a program showing the
   situation and checks the code. `npm test` also checks that every code used in the code exists in
   both languages, including codes chosen by a ternary.

## Author and licence

[MIT](LICENSE) © 2026 [Richard Lipka](https://home.zcu.cz/~lipka/) &lt;lipka@fav.zcu.cz&gt;,
[Department of Computer Science and Engineering](https://www.kiv.zcu.cz/cs), Faculty of Applied
Sciences, University of West Bohemia.

The faculty mark shown in the footer belongs to the university and is not covered by the MIT licence.
