// Literature for the built-in examples. Every DOI was checked against its
// Crossref record (authors, title, year, venue); the two web documents
// (Muller 1989 on HAL, Kahan's triangle notes) were opened and their titles
// and dates checked. An example gets a reference only when a publication
// could be traced; the role says whether it is the original source of the
// example or a text that explains the effect.

export const BIB = {
  goldberg1991: {
    authors: 'D. Goldberg', year: 1991,
    title: 'What every computer scientist should know about floating-point arithmetic',
    venue: 'ACM Computing Surveys 23(1), 5–48', doi: '10.1145/103162.103163',
  },
  higham2002: {
    authors: 'N. J. Higham', year: 2002,
    title: 'Accuracy and Stability of Numerical Algorithms, 2nd ed.',
    venue: 'SIAM, Philadelphia', doi: '10.1137/1.9780898718027',
  },
  ieee754: {
    authors: 'IEEE', year: 2019,
    title: 'IEEE Standard for Floating-Point Arithmetic (IEEE Std 754-2019)',
    venue: 'IEEE, New York', doi: '10.1109/IEEESTD.2019.8766229',
  },
  welford1962: {
    authors: 'B. P. Welford', year: 1962,
    title: 'Note on a method for calculating corrected sums of squares and products',
    venue: 'Technometrics 4(3), 419–420', doi: '10.1080/00401706.1962.10490022',
  },
  chan1983: {
    authors: 'T. F. Chan, G. H. Golub, R. J. LeVeque', year: 1983,
    title: 'Algorithms for computing the sample variance: analysis and recommendations',
    venue: 'The American Statistician 37(3), 242–247', doi: '10.1080/00031305.1983.10483115',
  },
  rump1988: {
    authors: 'S. M. Rump', year: 1988,
    title: 'Algorithms for verified inclusions: theory and practice',
    venue: 'In R. E. Moore (ed.), Reliability in Computing, Academic Press, 109–126', doi: '10.1016/B978-0-12-505630-4.50012-2',
  },
  loh2002: {
    authors: 'E. Loh, G. W. Walster', year: 2002,
    title: 'Rump’s example revisited',
    venue: 'Reliable Computing 8(3), 245–248', doi: '10.1023/A:1015569431383',
  },
  muller1989: {
    authors: 'J.-M. Muller', year: 1989,
    title: 'Arithmétique des ordinateurs',
    venue: 'Masson, Paris', url: 'https://ens-lyon.hal.science/ensl-00086707',
  },
  muller2018: {
    authors: 'J.-M. Muller, N. Brunie, F. de Dinechin, C.-P. Jeannerod, M. Joldes, V. Lefèvre, G. Melquiond, N. Revol, S. Torres', year: 2018,
    title: 'Handbook of Floating-Point Arithmetic, 2nd ed.',
    venue: 'Birkhäuser, Cham', doi: '10.1007/978-3-319-76526-6',
  },
  rump2020: {
    authors: 'S. M. Rump', year: 2020,
    title: 'On recurrences converging to the wrong limit in finite precision and some new examples',
    venue: 'Electronic Transactions on Numerical Analysis 52, 358–369', doi: '10.1553/etna_vol52s358',
  },
  montoye1990: {
    authors: 'R. K. Montoye, E. Hokenek, S. L. Runyon', year: 1990,
    title: 'Design of the IBM RISC System/6000 floating-point execution unit',
    venue: 'IBM Journal of Research and Development 34(1), 59–70', doi: '10.1147/rd.341.0059',
  },
  ogita2005: {
    authors: 'T. Ogita, S. M. Rump, S. Oishi', year: 2005,
    title: 'Accurate sum and dot product',
    venue: 'SIAM Journal on Scientific Computing 26(6), 1955–1988', doi: '10.1137/030601818',
  },
  forsythe1970: {
    authors: 'G. E. Forsythe', year: 1970,
    title: 'Pitfalls in computation, or why a math book isn’t enough',
    venue: 'The American Mathematical Monthly 77(9), 931–956', doi: '10.1080/00029890.1970.11992636',
  },
  kahan2014: {
    authors: 'W. Kahan', year: 2014,
    title: 'Miscalculating area and angles of a needle-like triangle',
    venue: 'Lecture notes, University of California, Berkeley (version of 4 September 2014)', url: 'https://people.eecs.berkeley.edu/~wkahan/Triangle.pdf',
  },
  press1992: {
    authors: 'W. H. Press, S. A. Teukolsky, W. T. Vetterling, B. P. Flannery', year: 1992,
    title: 'Numerical Recipes in C: The Art of Scientific Computing, 2nd ed., §1.3 Error, accuracy, and stability',
    venue: 'Cambridge University Press', url: 'https://numerical.recipes/',
  },
  may1976: {
    authors: 'R. M. May', year: 1976,
    title: 'Simple mathematical models with very complicated dynamics',
    venue: 'Nature 261, 459–467', doi: '10.1038/261459a0',
  },
  kahan1965: {
    authors: 'W. Kahan', year: 1965,
    title: 'Further remarks on reducing truncation errors',
    venue: 'Communications of the ACM 8(1), 40', doi: '10.1145/363707.363723',
  },
  payne1983: {
    authors: 'M. H. Payne, R. N. Hanek', year: 1983,
    title: 'Radian reduction for trigonometric functions',
    venue: 'ACM SIGNUM Newsletter 18(1), 19–24', doi: '10.1145/1057600.1057602',
  },
};

const n = (en, cs) => ({ en, cs });

/**
 * Sources per example. role: origin = where the example (or its idea) was
 * published first; version = where this particular form comes from;
 * analysis = later explanation; background = textbook treatment of the effect.
 */
export const EXAMPLE_REFS = {
  sum: [{ id: 'goldberg1991', role: 'background', note: n('why 0.1 has no exact binary representation', 'proč 0.1 nemá přesný dvojkový zápis') }],
  repr: [
    { id: 'goldberg1991', role: 'background', note: n('representation error, subnormal numbers', 'chyba reprezentace, subnormální čísla') },
    { id: 'ieee754', role: 'background', note: n('formats, overflow and underflow', 'formáty, přetečení a podtečení') },
  ],
  loop: [{ id: 'higham2002', role: 'background', note: n('chapter 4, summation', 'kapitola 4, sčítání') }],
  cancel: [{ id: 'goldberg1991', role: 'background', note: n('catastrophic and benign cancellation', 'katastrofické a neškodné krácení') }],
  assoc: [{ id: 'goldberg1991', role: 'origin', note: n('the same example with x = 10³⁰, y = −10³⁰, z = 1', 'tentýž příklad s x = 10³⁰, y = −10³⁰, z = 1') }],
  variance: [
    { id: 'welford1962', role: 'origin', note: n('the stable one-pass alternative', 'stabilní jednoprůchodová alternativa') },
    { id: 'chan1983', role: 'analysis', note: n('why the textbook one-pass formula fails', 'proč učebnicový jednoprůchodový vzorec selhává') },
  ],
  rump: [
    { id: 'rump1988', role: 'origin' },
    { id: 'loh2002', role: 'analysis', note: n('why IEEE 754 machines give different wrong answers', 'proč stroje s IEEE 754 dávají jiné chybné výsledky') },
  ],
  muller: [
    { id: 'muller1989', role: 'origin', note: n('the recurrence, there with u₀ = 11/2, u₁ = 61/11', 'rekurence, tam s u₀ = 11/2, u₁ = 61/11') },
    { id: 'muller2018', role: 'version', note: n('the starting values u₀ = 2, u₁ = −4', 'počáteční hodnoty u₀ = 2, u₁ = −4') },
    { id: 'rump2020', role: 'analysis' },
  ],
  order: [{ id: 'higham2002', role: 'background', note: n('chapter 4, summation: the effect of the order of the terms', 'kapitola 4, sčítání: vliv pořadí členů') }],
  fma: [
    { id: 'montoye1990', role: 'origin', note: n('the first fused multiply-add in hardware', 'první fúzované násobení a sčítání v hardwaru') },
    { id: 'ogita2005', role: 'analysis', note: n('TwoProduct: the exact error of a product computed with fma', 'TwoProduct: přesná chyba součinu spočtená pomocí fma') },
  ],
  range: [{ id: 'ieee754', role: 'background', note: n('overflow, underflow and subnormal numbers', 'přetečení, podtečení a subnormální čísla') }],
  taylor: [{ id: 'forsythe1970', role: 'origin', note: n('the series for e^x with negative x', 'řada pro e^x se záporným x') }],
  quadratic: [
    { id: 'forsythe1970', role: 'origin', note: n('roots of a quadratic equation', 'kořeny kvadratické rovnice') },
    { id: 'goldberg1991', role: 'background', note: n('catastrophic cancellation in the quadratic formula', 'katastrofické krácení ve vzorci pro kořeny') },
  ],
  needle: [
    { id: 'kahan2014', role: 'origin', note: n('Kahan’s formula; the side lengths used here are our own', 'Kahanův vzorec; délky stran zde jsou naše vlastní') },
    { id: 'goldberg1991', role: 'background', note: n('Heron’s formula rewritten', 'přepsaný Heronův vzorec') },
  ],
  onecos: [{ id: 'higham2002', role: 'origin', note: n('chapter 1, the cancellation example (1 − cos x)/x²', 'kapitola 1, příklad krácení (1 − cos x)/x²') }],
  compound: [{ id: 'goldberg1991', role: 'origin', note: n('compound interest (1 + i/n)ⁿ, there with daily interest, n = 365; computing ln(1 + x)', 'složené úročení (1 + i/n)ⁿ, tam s denním úročením, n = 365; výpočet ln(1 + x)') }],
  golden: [{ id: 'press1992', role: 'origin', note: n('powers of the golden mean by the recurrence φⁿ⁺¹ = φⁿ⁻¹ − φⁿ', 'mocniny zlatého řezu rekurencí φⁿ⁺¹ = φⁿ⁻¹ − φⁿ') }],
  logistic: [{ id: 'may1976', role: 'origin', note: n('the logistic map and its chaotic regime', 'logistické zobrazení a jeho chaotický režim') }],
  kahansum: [
    { id: 'kahan1965', role: 'origin' },
    { id: 'goldberg1991', role: 'analysis', note: n('error bound of the Kahan summation formula', 'odhad chyby Kahanova sčítání') },
  ],
  sinBig: [{ id: 'payne1983', role: 'origin', note: n('exact argument reduction for huge arguments', 'přesná redukce argumentu pro obrovské argumenty') }],
};

export function refLink(entry) {
  return entry.doi ? `https://doi.org/${entry.doi}` : entry.url;
}
