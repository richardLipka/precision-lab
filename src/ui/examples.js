// Built-in example programs. Each one illustrates a classic floating-point effect.
// Titles and descriptions are given in English and Czech.

export const EXAMPLES = [
  {
    id: 'sum',
    title: { en: '0.1 + 0.2', cs: '0.1 + 0.2' },
    blurb: {
      en: 'Neither 0.1 nor 0.2 is representable in binary; their rounded sum is not the double nearest to 0.3.',
      cs: 'Ani 0.1, ani 0.2 nelze ve dvojkové soustavě zapsat přesně; jejich zaokrouhlený součet není double nejbližší k 0.3.',
    },
    variables: [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }],
    program: 'c = a + b\nc - 0.3',
  },
  {
    id: 'repr',
    title: { en: 'Representation error', cs: 'Chyba reprezentace' },
    blurb: {
      en: 'Converting decimal inputs is already a rounding step: 1/3 is periodic, 16777217 = 2²⁴+1 needs 25 bits, 1e-40 is subnormal in float and 1e39 overflows it.',
      cs: 'Už převod desetinných vstupů je zaokrouhlení: 1/3 je periodická, 16777217 = 2²⁴+1 potřebuje 25 bitů, 1e-40 je ve floatu subnormální a 1e39 ho přeteče.',
    },
    variables: [
      { name: 'a', value: '0.1' },
      { name: 'b', value: '1/3' },
      { name: 'c', value: '16777217' },
      { name: 'd', value: '1e-40' },
      { name: 'e', value: '1e39' },
    ],
    program: '',
  },
  {
    id: 'loop',
    title: { en: 'Adding 0.1 ten times', cs: 'Desetkrát přičíst 0.1' },
    blurb: {
      en: 'Each addition rounds again, so errors accumulate: the double result is 0.9999999999999999.',
      cs: 'Každé sčítání znovu zaokrouhluje, chyby se proto hromadí: v doublu vyjde 0.9999999999999999.',
    },
    variables: [],
    program: 's = 0\nrepeat 10 {\n  s = s + 0.1\n}\ns',
  },
  {
    id: 'cancel',
    title: { en: 'Catastrophic cancellation', cs: 'Katastrofické krácení' },
    blurb: {
      en: 'Subtracting nearly equal numbers exposes the rounding error of (1 + x): few or no correct digits survive.',
      cs: 'Odečtení téměř stejných čísel odhalí chybu zaokrouhlení (1 + x): přežije jen málo platných číslic, nebo žádná.',
    },
    variables: [{ name: 'x', value: '1e-10' }],
    program: 'y = (1 + x) - 1\ny / x',
  },
  {
    id: 'assoc',
    title: { en: 'Addition is not associative', cs: 'Sčítání není asociativní' },
    blurb: {
      en: 'Same three numbers, two orders of evaluation, two different answers.',
      cs: 'Stejná tři čísla, dvě pořadí vyhodnocení, dva různé výsledky.',
    },
    variables: [{ name: 'a', value: '1e16' }, { name: 'b', value: '-1e16' }, { name: 'c', value: '1' }],
    program: 'left = (a + b) + c\nright = a + (b + c)',
  },
  {
    id: 'variance',
    title: { en: 'One-pass variance', cs: 'Jednoprůchodový rozptyl' },
    blurb: {
      en: 'E[x²] − E[x]² subtracts two huge, nearly equal numbers. The true variance is 2/3.',
      cs: 'E[x²] − E[x]² odečítá dvě obrovská, téměř stejná čísla. Skutečný rozptyl je 2/3.',
    },
    variables: [{ name: 'x1', value: '100000001' }, { name: 'x2', value: '100000002' }, { name: 'x3', value: '100000003' }],
    program: 'm = (x1 + x2 + x3) / 3\nm2 = (x1^2 + x2^2 + x3^2) / 3\nvar = m2 - m^2',
  },
  {
    id: 'rump',
    title: { en: "Rump's example", cs: 'Rumpův příklad' },
    blurb: {
      en: 'S. M. Rump (1988): float, double and extended all give wrong values; the true result is −0.827396… The precision sweep shows that at least 122 bits are needed.',
      cs: 'S. M. Rump (1988): float, double i extended dávají chybné hodnoty; skutečný výsledek je −0.827396… Průchod přesnostmi ukáže, že je potřeba aspoň 122 bitů.',
    },
    variables: [{ name: 'a', value: '77617' }, { name: 'b', value: '33096' }],
    program: '333.75*b^6 + a^2*(11*a^2*b^2 - b^6 - 121*b^4 - 2) + 5.5*b^8 + a/(2*b)',
  },
  {
    id: 'muller',
    title: { en: "Muller's recurrence", cs: 'Mullerova rekurence' },
    blurb: {
      en: 'uₙ₊₁ = 111 − 1130/uₙ + 3000/(uₙ·uₙ₋₁) with u₀ = 2, u₁ = −4 converges to 6, but any rounding error pulls it to 100.',
      cs: 'uₙ₊₁ = 111 − 1130/uₙ + 3000/(uₙ·uₙ₋₁) s u₀ = 2, u₁ = −4 konverguje k 6, ale jakákoli chyba zaokrouhlení ji stáhne ke 100.',
    },
    variables: [{ name: 'u0', value: '2' }, { name: 'u1', value: '-4' }],
    program: 'repeat 25 {\n  u2 = 111 - 1130/u1 + 3000/(u1*u0)\n  u0 = u1\n  u1 = u2\n}\nu1',
  },
  {
    id: 'harmonic',
    title: { en: 'Harmonic sum', cs: 'Harmonický součet' },
    blurb: {
      en: 'H₁₀₀ = 1 + 1/2 + … + 1/100 accumulated term by term; watch the error grow step by step.',
      cs: 'H₁₀₀ = 1 + 1/2 + … + 1/100 sčítané člen po členu; sledujte, jak chyba krok za krokem roste.',
    },
    variables: [],
    program: 's = 0\nk = 0\nrepeat 100 {\n  k = k + 1\n  s = s + 1/k\n}\ns',
  },
  {
    id: 'fma',
    title: { en: 'Fused multiply-add', cs: 'Fúzované násobení a sčítání (fma)' },
    blurb: {
      en: 'fma(a, a, −p) rounds only once, so it recovers the exact rounding error of p = a·a; the plain expression gives 0.',
      cs: 'fma(a, a, −p) zaokrouhluje jen jednou, a tak získá přesnou chybu zaokrouhlení součinu p = a·a; obyčejný výraz dá 0.',
    },
    variables: [{ name: 'a', value: '0.1' }],
    program: 'p = a*a\nplain = a*a - p\nfused = fma(a, a, -p)',
  },
  {
    id: 'range',
    title: { en: 'Overflow and underflow', cs: 'Přetečení a podtečení' },
    blurb: {
      en: 'x³/x² is exactly x, but in float x³ overflows to ∞; tiny products flush to subnormals or zero.',
      cs: 'x³/x² je přesně x, ve floatu ale x³ přeteče na ∞; malé součiny klesnou do subnormálních čísel nebo na nulu.',
    },
    variables: [{ name: 'x', value: '1e20' }, { name: 'y', value: '1e-25' }],
    program: 'big = x*x*x / (x*x)\ntiny = y*y*1e30',
  },
  {
    id: 'rumpSteps',
    title: { en: "Rump's example — every product a step", cs: 'Rumpův příklad — každý součin krokem' },
    blurb: {
      en: 'The same polynomial written with explicit multiplications (x = 77617, y = 33096), so every partial product is its own step. The terms grow to about 10³⁶ and then cancel almost completely: look at the step where 5.5·y⁸ is added — the cause column shows the cancellation.',
      cs: 'Stejný polynom zapsaný explicitními násobeními (x = 77617, y = 33096), takže každý částečný součin je samostatný krok. Členy narostou asi na 10³⁶ a pak se téměř úplně odečtou: podívejte se na krok, kde se přičítá 5.5·y⁸ — sloupec příčin ukáže krácení.',
    },
    variables: [],
    program: 'x = 77617\ny = 33096\n\nz = 333.75*y*y*y*y*y*y + (x*x)*(11*x*x*y*y - y*y*y*y*y*y - 121*y*y*y*y - 2) + 5.5*y*y*y*y*y*y*y*y + x / (2*y)',
  },
  {
    id: 'recurrence',
    title: { en: 'Unstable recurrence Iₙ = 1/n − 5·Iₙ₋₁', cs: 'Nestabilní rekurence Iₙ = 1/n − 5·Iₙ₋₁' },
    blurb: {
      en: 'Iₙ = ∫₀¹ xⁿ/(x+5) dx satisfies Iₙ = 1/n − 5·Iₙ₋₁ with I₀ = ln 1.2. The true values slowly decrease towards 0, but each step multiplies the error inherited from I₀ by 5: float ends in the millions. (ln 1.2 is irrational — its reference value comes from decimal.js.)',
      cs: 'Iₙ = ∫₀¹ xⁿ/(x+5) dx splňuje Iₙ = 1/n − 5·Iₙ₋₁ s I₀ = ln 1.2. Skutečné hodnoty pomalu klesají k 0, ale každý krok vynásobí chybu zděděnou z I₀ pěti: float skončí v milionech. (ln 1.2 je iracionální — referenční hodnotu dodá decimal.js.)',
    },
    variables: [],
    program: 'I = ln(1.2)\nn = 0\nrepeat 20 {\n  n = n + 1\n  I = 1/n - 5*I\n}\nI',
  },
  {
    id: 'taylor',
    title: { en: 'Taylor series of e⁻²⁰', cs: 'Taylorova řada e⁻²⁰' },
    blurb: {
      en: 'Summing 1 + x + x²/2! + … for x = −20: the terms reach 4·10⁷ with alternating signs and must cancel down to 2·10⁻⁹. Float even gets the sign wrong; double has no correct digit. The step libm = exp(x) shows the correctly rounded value for comparison.',
      cs: 'Součet 1 + x + x²/2! + … pro x = −20: členy dosahují 4·10⁷ se střídavými znaménky a musí se odečíst až na 2·10⁻⁹. Float vyjde dokonce se špatným znaménkem, double nemá ani jednu platnou číslici. Krok libm = exp(x) ukazuje pro srovnání správně zaokrouhlenou hodnotu.',
    },
    variables: [{ name: 'x', value: '-20' }],
    program: 'libm = exp(x)\nterm = 1\ns = 1\nk = 0\nrepeat 90 {\n  k = k + 1\n  term = term * x / k\n  s = s + term\n}\ns',
  },
  {
    id: 'quadratic',
    title: { en: 'Quadratic formula: lost root', cs: 'Kvadratická rovnice: ztracený kořen' },
    blurb: {
      en: 'x² − 10⁸·x + 1 = 0 has roots ≈ 10⁸ and ≈ 10⁻⁸. The textbook formula (−b − √(b²−4ac))/2a for the small root subtracts two nearly equal numbers (float gives 0). The equivalent form 2c/(−b + √(b²−4ac)) adds instead and stays accurate.',
      cs: 'x² − 10⁸·x + 1 = 0 má kořeny ≈ 10⁸ a ≈ 10⁻⁸. Školní vzorec (−b − √(b²−4ac))/2a pro malý kořen odečítá dvě téměř stejná čísla (float dá 0). Ekvivalentní tvar 2c/(−b + √(b²−4ac)) místo toho sčítá a zůstane přesný.',
    },
    variables: [{ name: 'a', value: '1' }, { name: 'b', value: '-1e8' }, { name: 'c', value: '1' }],
    program: 'd = sqrt(b*b - 4*a*c)\nstable = (2*c) / (-b + d)\nnaive = (-b - d) / (2*a)',
  },
  {
    id: 'needle',
    title: { en: 'Needle-like triangle (Heron vs Kahan)', cs: 'Jehlový trojúhelník (Heron vs Kahan)' },
    blurb: {
      en: 'Area of a triangle with sides 100000, 100000 and 0.0001. Heron’s formula needs s − a, which cancels after s has already been rounded (float: 0). Kahan’s rearrangement √((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))/4 with a ≥ b ≥ c avoids that and keeps full accuracy.',
      cs: 'Obsah trojúhelníku se stranami 100000, 100000 a 0.0001. Heronův vzorec potřebuje s − a, kde dojde ke krácení až poté, co se s zaokrouhlilo (float: 0). Kahanova úprava √((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))/4 pro a ≥ b ≥ c tomu předejde a zachová plnou přesnost.',
    },
    variables: [{ name: 'a', value: '100000' }, { name: 'b', value: '100000' }, { name: 'c', value: '0.0001' }],
    program: 'kahan = sqrt((a + (b + c))*(c - (a - b))*(c + (a - b))*(a + (b - c))) / 4\ns = (a + b + c) / 2\nheron = sqrt(s*(s - a)*(s - b)*(s - c))',
  },
  {
    id: 'onecos',
    title: { en: '(1 − cos x)/x² for small x', cs: '(1 − cos x)/x² pro malé x' },
    blurb: {
      en: 'The true value is ≈ 0.5, but cos(10⁻⁸) rounds to exactly 1 in float and double, so 1 − cos x = 0. The identity 1 − cos x = 2·sin²(x/2) removes the subtraction.',
      cs: 'Skutečná hodnota je ≈ 0.5, ale cos(10⁻⁸) se ve floatu i doublu zaokrouhlí přesně na 1, takže 1 − cos x = 0. Identita 1 − cos x = 2·sin²(x/2) odečítání odstraní.',
    },
    variables: [{ name: 'x', value: '1e-8' }],
    program: 'h = sin(x/2)\nstable = 2*h*h / (x*x)\nnaive = (1 - cos(x)) / (x*x)',
  },
  {
    id: 'compound',
    title: { en: 'Compound interest (1 + 1/n)ⁿ → e', cs: 'Složené úročení (1 + 1/n)ⁿ → e' },
    blurb: {
      en: 'For n = 10⁸ the value (1 + 1/n)ⁿ is within 10⁻⁸ of e. But 1 + 1/n is rounded first — in float to exactly 1, so the result is 1. The last step shows the difference from e.',
      cs: 'Pro n = 10⁸ se (1 + 1/n)ⁿ liší od e méně než o 10⁻⁸. Jenže 1 + 1/n se nejdřív zaokrouhlí — ve floatu přesně na 1, takže výsledek je 1. Poslední krok ukazuje rozdíl od e.',
    },
    variables: [{ name: 'n', value: '1e8' }],
    program: 'x = pow(1 + 1/n, n)\nx - exp(1)',
  },
  {
    id: 'golden',
    title: { en: 'Golden-ratio recurrence', cs: 'Rekurence se zlatým řezem' },
    blurb: {
      en: 'Starting with 1 and φ⁻¹ = (√5 − 1)/2, the recurrence bₙ₊₁ = bₙ₋₁ − bₙ produces φ⁻ⁿ, a quickly shrinking sequence. The tiny representation error of √5 excites the second solution (−φ)ⁿ, which grows 1.618× per step and takes over.',
      cs: 'Z počátečních hodnot 1 a φ⁻¹ = (√5 − 1)/2 vytvoří rekurence bₙ₊₁ = bₙ₋₁ − bₙ posloupnost φ⁻ⁿ, která rychle klesá. Nepatrná chyba reprezentace √5 ale vybudí druhé řešení (−φ)ⁿ, které roste 1,618× za krok a převládne.',
    },
    variables: [],
    program: 'a = 1\nb = (sqrt(5) - 1) / 2\nrepeat 40 {\n  c = a - b\n  a = b\n  b = c\n}\nb',
  },
  {
    id: 'logistic',
    title: { en: 'Logistic map (chaos)', cs: 'Logistické zobrazení (chaos)' },
    blurb: {
      en: 'x ← 4·x·(1 − x) from x = 0.1. Every step roughly doubles any error, so after about 25 steps float and after about 55 steps double are unrelated to the true orbit. The exact fraction doubles its length each step, so the reference continues with verified decimal.js digits.',
      cs: 'x ← 4·x·(1 − x) z x = 0.1. Každý krok jakoukoli chybu zhruba zdvojnásobí, takže zhruba po 25 krocích float a po 55 krocích double nemají se skutečnou trajektorií nic společného. Přesný zlomek se každým krokem zdvojnásobí, reference proto pokračuje ověřenými číslicemi z decimal.js.',
    },
    variables: [{ name: 'x', value: '0.1' }],
    program: 'repeat 60 {\n  x = 4*x*(1 - x)\n}\nx',
  },
  {
    id: 'kahansum',
    title: { en: 'Kahan (compensated) summation', cs: 'Kahanovo (kompenzované) sčítání' },
    blurb: {
      en: 'Adding 0.1 two hundred times. The plain loop accumulates a rounding error in every step; Kahan’s algorithm carries the lost low-order part in c and adds it back, so even in float it ends at the correctly rounded 20.',
      cs: 'Dvě stě krát se přičte 0.1. Obyčejný cyklus v každém kroku přidá chybu zaokrouhlení; Kahanův algoritmus si ztracenou nižší část nese v c a vrací ji zpět, takže i ve floatu skončí na správně zaokrouhlené hodnotě 20.',
    },
    variables: [],
    program: 'k = 0\nc = 0\nrepeat 200 {\n  y = 0.1 - c\n  t = k + y\n  c = (t - k) - y\n  k = t\n}\nkahan = k\ns = 0\nrepeat 200 {\n  s = s + 0.1\n}\nnaive = s',
  },
  {
    id: 'sinBig',
    title: { en: 'sin of a huge argument', cs: 'sin obrovského argumentu' },
    blurb: {
      en: 'sin(10²²): double holds 10²² exactly and a correctly rounded sin (with exact argument reduction) gets −0.8522… right. In float, 10²² is stored as a different number, and since sin has condition number ≈ 10²² here, the answer is completely different.',
      cs: 'sin(10²²): double uloží 10²² přesně a správně zaokrouhlený sin (s přesnou redukcí argumentu) vrátí správně −0.8522… Ve floatu se 10²² uloží jako jiné číslo, a protože sin má zde číslo podmíněnosti ≈ 10²², výsledek je úplně jiný.',
    },
    variables: [{ name: 'x', value: '1e22' }],
    program: 'sin(x)',
  },
];

export const DEFAULT_EXAMPLE = 'sum';
