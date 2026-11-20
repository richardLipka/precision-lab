// Built-in example programs. Each one illustrates a classic floating-point effect.
// Titles and texts are given in English and Czech. The list is a learning path:
// the examples are ordered and grouped (EXAMPLE_GROUPS, shown as <optgroup>s)
// from representation basics to accumulation, cancellation, amplified errors,
// conditioning and hardware details. Every example has three texts:
//   blurb  — what happens and why (with the numbers the default formats give),
//   lesson — the transferable rule (the take-away),
//   look   — where in the tool to see it (a step, the chart, the sweep, the
//            Rearrange view), so that a beginner knows which panel to open.
// Optional:
//   byDesign — variables whose exact result is the purpose of the algorithm
//              (Kahan summation), so the diagnosis does not call it luck;
//   helpers  — a note per helper variable, shown with its diagnosis (what the
//              value means, e.g. a compensation term whose true value is 0).

/** Group ids in learning order; their names are the i18n keys 'exgroup.<id>'. */
export const EXAMPLE_GROUPS = ['basics', 'accumulation', 'cancellation', 'amplification', 'conditioning', 'hardware'];

export const EXAMPLES = [
  // ---------------------------------------------------------------- basics
  {
    id: 'sum',
    group: 'basics',
    title: { en: '0.1 + 0.2', cs: '0.1 + 0.2' },
    blurb: {
      en: '0.1, 0.2 and 0.3 are all rounded when they are stored: none of them is a finite binary fraction. In double, 0.1 + 0.2 = 0.30000000000000004 is not the double nearest to 0.3, so c − 0.3 = 5.55·10⁻¹⁷ and the test c == 0.3 gives 0 (false), although its true value is 1 (true). In float and x87 the rounding errors happen to cancel and both tests come out right — that is luck, not better accuracy.',
      cs: '0.1, 0.2 i 0.3 se při uložení zaokrouhlí: žádné z nich není konečný dvojkový zlomek. V doublu vyjde 0.1 + 0.2 = 0.30000000000000004, což není double nejbližší k 0.3, takže c − 0.3 = 5.55·10⁻¹⁷ a test c == 0.3 dá 0 (nepravda), přestože jeho skutečná hodnota je 1 (pravda). Ve floatu a v x87 se chyby zaokrouhlení náhodou vyruší a oba testy vyjdou správně — je to štěstí, ne vyšší přesnost.',
    },
    lesson: {
      en: 'Never test computed floating-point numbers for exact equality: whether 0.1 + 0.2 == 0.3 holds depends on the format.',
      cs: 'Vypočtená čísla v pohyblivé řádové čárce nikdy netestujte na přesnou rovnost: zda platí 0.1 + 0.2 == 0.3, závisí na formátu.',
    },
    look: {
      en: 'step c in each column (click a cell to see how 0.1 and 0.2 were rounded) and the diagnosis “Why do the results differ?”.',
      cs: 'krok c v každém sloupci (klepnutím na buňku uvidíte, jak se zaokrouhlily 0.1 a 0.2) a diagnóza „Proč se výsledky liší?“.',
    },
    variables: [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }],
    program: 'c = a + b\nc - 0.3\nc == 0.3',
  },
  {
    id: 'repr',
    group: 'basics',
    title: { en: 'Representation error', cs: 'Chyba reprezentace' },
    blurb: {
      en: 'Converting decimal inputs is already a rounding step: 0.1 and 1/3 are periodic in binary, 16777217 = 2²⁴+1 needs 25 bits (float holds 24), 1e-40 is subnormal in float and 1e39 overflows it. The program is empty: every row of the table is an input conversion.',
      cs: 'Už převod desetinných vstupů je zaokrouhlení: 0.1 i 1/3 jsou ve dvojkové soustavě periodické, 16777217 = 2²⁴+1 potřebuje 25 bitů (float jich má 24), 1e-40 je ve floatu subnormální a 1e39 ho přeteče. Program je prázdný: každý řádek tabulky je převod vstupu.',
    },
    lesson: {
      en: 'Error can enter before any arithmetic is done; an input that looks exact in decimal is usually not exact in binary.',
      cs: 'Chyba může vzniknout dřív, než proběhne jakýkoli výpočet; vstup, který v desítkové soustavě vypadá přesně, ve dvojkové přesný obvykle není.',
    },
    look: {
      en: 'click each input row in the step table: the detail shows the binary expansion and where it is cut off.',
      cs: 'klepněte na jednotlivé vstupy v tabulce kroků: detail ukáže dvojkový rozvoj a místo, kde je useknut.',
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
    id: 'intLimit',
    group: 'basics',
    title: { en: 'Where integers stop being exact', cs: 'Kde celá čísla přestávají být přesná' },
    blurb: {
      en: 'A format with a p-bit significand holds every integer up to 2ᵖ exactly; above 2ᵖ only every 2nd integer exists, above 2ᵖ⁺¹ every 4th, and so on. f = 2²⁴ = 16777216 is the limit of float: f + 1 rounds back to f, so (f + 1) − f is 0, while (f + 2) − f = 2 is exact. d = 2⁵³ is the limit of double (JavaScript’s Number.MAX_SAFE_INTEGER is 2⁵³ − 1): there d + 1 is lost as well. x87 (p = 64) gets all three right.',
      cs: 'Formát s p bity mantisy uloží přesně každé celé číslo až do 2ᵖ; nad 2ᵖ existuje jen každé druhé celé číslo, nad 2ᵖ⁺¹ každé čtvrté a tak dále. f = 2²⁴ = 16777216 je hranice floatu: f + 1 se zaokrouhlí zpět na f, takže (f + 1) − f vyjde 0, kdežto (f + 2) − f = 2 vyjde přesně. d = 2⁵³ je hranice doublu (Number.MAX_SAFE_INTEGER v JavaScriptu je 2⁵³ − 1): tam se ztratí i d + 1. x87 (p = 64) spočte všechny tři výsledky správně.',
    },
    lesson: {
      en: 'Integer arithmetic in floating point is exact only while every value stays within ±2ᵖ (float 2²⁴ ≈ 1.7·10⁷, double 2⁵³ ≈ 9·10¹⁵); counters and IDs beyond that silently skip numbers.',
      cs: 'Celočíselné výpočty v pohyblivé řádové čárce jsou přesné jen tehdy, když všechny hodnoty zůstanou v mezích ±2ᵖ (float 2²⁴ ≈ 1,7·10⁷, double 2⁵³ ≈ 9·10¹⁵); čítače a identifikátory za touto hranicí potichu přeskakují čísla.',
    },
    look: {
      en: 'the steps (f + 1) and (d + 1): the cause chip says absorption, and the bit view shows the added 1 falling just below the last kept bit.',
      cs: 'kroky (f + 1) a (d + 1): štítek příčiny říká pohlcení a bitový pohled ukáže, jak přičtená 1 spadne těsně pod poslední uložený bit.',
    },
    variables: [{ name: 'f', value: '16777216' }, { name: 'd', value: '9007199254740992' }],
    program: 'f1 = (f + 1) - f\nf2 = (f + 2) - f\nd1 = (d + 1) - d',
  },
  {
    id: 'equality',
    group: 'basics',
    title: { en: 'Comparing with a tolerance', cs: 'Porovnání s tolerancí' },
    blurb: {
      en: 'c == 0.9 is false in float, double and x87: 0.3 + 0.6 does not round to the same number as 0.9 in any of them. The usual remedy is a relative tolerance: abs(c − 0.9) <= tol·abs(0.9). It works only when tol is larger than the rounding error of the computation, which is a few times u = 2⁻ᵖ. tol = 1e-9 is far above u of double (≈ 1.1·10⁻¹⁶) and of x87 (≈ 5.4·10⁻²⁰), so the test passes there; it is below u of float (≈ 6·10⁻⁸), so in float it fails — a float program needs a tolerance of about 10⁻⁶. In half (u ≈ 4.9·10⁻⁴) the test fails as well, and tol = 1e-9 even underflows to 0 there.',
      cs: 'c == 0.9 neplatí ve floatu, v doublu ani v x87: 0.3 + 0.6 se v žádném z nich nezaokrouhlí na stejné číslo jako 0.9. Obvyklou nápravou je relativní tolerance: abs(c − 0.9) <= tol·abs(0.9). Funguje ale jen tehdy, když je tol větší než chyba zaokrouhlení výpočtu, tedy několik násobků u = 2⁻ᵖ. tol = 1e-9 je mnohem větší než u doublu (≈ 1,1·10⁻¹⁶) i x87 (≈ 5,4·10⁻²⁰), takže tam test projde; je ale menší než u floatu (≈ 6·10⁻⁸), takže ve floatu selže — program ve floatu potřebuje toleranci asi 10⁻⁶. V half (u ≈ 4,9·10⁻⁴) test selže také a tol = 1e-9 tam dokonce podteče na 0.',
    },
    lesson: {
      en: 'Compare computed values with a tolerance, and choose the tolerance from the precision of the format and the error the computation can accumulate.',
      cs: 'Vypočtené hodnoty porovnávejte s tolerancí a tu volte podle přesnosti formátu a podle chyby, kterou výpočet může nasbírat.',
    },
    look: {
      en: 'the last two rows in each column: the tolerance test passes in double and x87 but fails in float; set tol to 1e-6 and it passes in float too.',
      cs: 'poslední dva řádky v každém sloupci: test s tolerancí projde v doublu a v x87, ve floatu ale selže; nastavte tol na 1e-6 a projde i ve floatu.',
    },
    variables: [{ name: 'a', value: '0.3' }, { name: 'b', value: '0.6' }, { name: 'tol', value: '1e-9' }],
    program: 'c = a + b\nc == 0.9\nabs(c - 0.9) <= tol * abs(0.9)',
  },
  {
    id: 'special',
    group: 'basics',
    title: { en: 'Special values: −0, ∞, NaN', cs: 'Speciální hodnoty: −0, ∞, NaN' },
    blurb: {
      en: 'Integers have one zero and no NaN; IEEE 754 has more. −0 equals +0, yet 1/−0 = −∞. ∞ − ∞ and 0·∞ are invalid and give NaN. NaN propagates: every operation with a NaN operand gives NaN, so even n − n is NaN, not 0 (and NaN is not even equal to itself: n == n is false).',
      cs: 'Celá čísla mají jedinou nulu a žádné NaN; IEEE 754 zná víc speciálních hodnot. −0 se rovná +0, přesto 1/−0 = −∞. ∞ − ∞ a 0·∞ jsou neplatné operace a dají NaN. NaN se šíří dál: každá operace s operandem NaN dá NaN, takže i n − n je NaN, ne 0 (a NaN se nerovná ani sobě samému: n == n je nepravda).',
    },
    lesson: {
      en: 'An invalid or overflowing step does not stop the program: ∞ and NaN flow silently into every later result, so check for them where they can arise.',
      cs: 'Neplatný nebo přetečený krok program nezastaví: ∞ a NaN potichu proniknou do všech dalších výsledků, proto je kontrolujte tam, kde mohou vzniknout.',
    },
    look: {
      en: 'the cause chips and the flags (DIV0, INV) in the step table; click a step to read the rule.',
      cs: 'štítky příčin a příznaky (DIV0, INV) v tabulce kroků; klepnutím na krok si přečtete pravidlo.',
    },
    variables: [{ name: 'z', value: '-0' }, { name: 'i', value: 'inf' }, { name: 'n', value: 'nan' }],
    program: 'a = 1/z    # the sign of the zero matters\nb = i - i\nc = 0*i\nd = n - n',
  },
  {
    id: 'range',
    group: 'basics',
    title: { en: 'Overflow and underflow', cs: 'Přetečení a podtečení' },
    blurb: {
      en: 'x³/x² is exactly x. In float (largest value ≈ 3.4·10³⁸) both x·x·x = 10⁶⁰ and x·x = 10⁴⁰ overflow to ∞, and ∞/∞ is undefined, so big becomes NaN (not a number). Double has enough exponent range; its products are rounded, but here their errors cancel and big comes out exactly x. y·y = 10⁻⁵⁰ lies below float’s smallest subnormal number (≈ 1.4·10⁻⁴⁵) and underflows to 0, so tiny is 0 instead of 10⁻²⁰.',
      cs: 'x³/x² je přesně x. Ve floatu (největší hodnota ≈ 3,4·10³⁸) přeteče na ∞ jak x·x·x = 10⁶⁰, tak x·x = 10⁴⁰, a ∞/∞ není definováno, takže big vyjde NaN (není číslo). Double má dostatečný rozsah exponentu; jeho součiny se sice zaokrouhlí, ale jejich chyby se zde vyruší a big vyjde přesně x. y·y = 10⁻⁵⁰ leží pod nejmenším subnormálním číslem floatu (≈ 1,4·10⁻⁴⁵) a podteče na 0, takže tiny vyjde 0 místo 10⁻²⁰.',
    },
    lesson: {
      en: 'Precision and range are separate limits: a result can be lost to overflow or underflow even when it needs only a few digits. Scale or reorder the computation so that intermediate results stay in range.',
      cs: 'Přesnost a rozsah jsou dvě různé meze: výsledek se může ztratit přetečením nebo podtečením, i když potřebuje jen pár číslic. Výpočet přeškálujte nebo přeuspořádejte tak, aby mezivýsledky zůstaly v rozsahu.',
    },
    look: {
      en: 'the float column: the step x*x (flag OVF), then the NaN in big, and the step y*y (flag UNF).',
      cs: 'sloupec float: krok x*x (příznak OVF), pak NaN v big a krok y*y (příznak UNF).',
    },
    variables: [{ name: 'x', value: '1e20' }, { name: 'y', value: '1e-25' }],
    program: 'big = x*x*x / (x*x)\ntiny = y*y*1e30',
  },

  // ---------------------------------------------------------- accumulation
  {
    id: 'loop',
    group: 'accumulation',
    title: { en: 'Adding 0.1 ten times', cs: 'Desetkrát přičíst 0.1' },
    blurb: {
      en: 'Each addition rounds again and the small rounding errors add up: the double result is 0.9999999999999999, not 1, so a test s == 1 would fail. No single step loses a whole digit; the diagnosis shows how far the sum ends from the true value.',
      cs: 'Každé sčítání znovu zaokrouhluje a drobné chyby zaokrouhlení se sčítají: v doublu vyjde 0.9999999999999999, ne 1, takže test s == 1 by selhal. Žádný krok sám neztratí celou číslici; diagnóza ukáže, jak daleko od skutečné hodnoty součet skončí.',
    },
    lesson: {
      en: 'Every operation may add up to half an ulp of error; over many operations these errors accumulate, so a long computation is less accurate than a single rounding.',
      cs: 'Každá operace může přidat chybu až půl ulp; během mnoha operací se tyto chyby hromadí, takže dlouhý výpočet je méně přesný než jediné zaokrouhlení.',
    },
    look: {
      en: 'the Error propagation chart (correct digits after each step) and the diagnosis; the Precision sweep shows how the error shrinks with more bits.',
      cs: 'graf Šíření chyby (platné číslice po každém kroku) a diagnóza; Průchod přesnostmi ukáže, jak chyba s dalšími bity klesá.',
    },
    variables: [],
    program: 's = 0\nrepeat 10 {\n  s = s + 0.1\n}\ns',
  },
  {
    id: 'assoc',
    group: 'accumulation',
    title: { en: 'Addition is not associative', cs: 'Sčítání není asociativní' },
    blurb: {
      en: 'Same three numbers, two orders of evaluation: (a + b) + c = 0 + 1 = 1, but in a + (b + c) the 1 is less than half an ulp of 10²⁰ (8192 in double, 4 in x87) and is absorbed, so b + c = −10²⁰ and the result is 0. Float, double and x87 all fail; only quad (113 bits) holds 10²⁰ − 1 exactly. With 10¹⁶ instead of 10²⁰, x87 (64 bits) would still hold 10¹⁶ − 1 and get both orders right: more bits only move the threshold.',
      cs: 'Stejná tři čísla, dvě pořadí vyhodnocení: (a + b) + c = 0 + 1 = 1, ale v a + (b + c) je 1 menší než polovina ulp čísla 10²⁰ (v doublu 8192, v x87 4) a pohltí se, takže b + c = −10²⁰ a výsledek je 0. Selže float, double i x87; jen quad (113 bitů) uloží 10²⁰ − 1 přesně. S 10¹⁶ místo 10²⁰ by x87 (64 bitů) číslo 10¹⁶ − 1 ještě uložil a obě pořadí by spočetl správně: další bity jen posunou hranici.',
    },
    lesson: {
      en: 'Floating-point addition is not associative: the order of operations changes the result. That is why compilers do not reorder sums unless told to (-ffast-math).',
      cs: 'Sčítání v pohyblivé řádové čárce není asociativní: pořadí operací mění výsledek. Proto překladače součty nepřeuspořádávají, pokud jim to výslovně nedovolíte (-ffast-math).',
    },
    look: {
      en: 'the step (b + c) (cause: absorption), then a + (b + c); in the Rearrange view you can change the order yourself.',
      cs: 'krok (b + c) (příčina: pohlcení), potom a + (b + c); v pohledu Úpravy výrazu můžete pořadí změnit sami.',
    },
    variables: [{ name: 'a', value: '1e20' }, { name: 'b', value: '-1e20' }, { name: 'c', value: '1' }],
    program: 'left = (a + b) + c\nright = a + (b + c)',
  },
  {
    id: 'order',
    group: 'accumulation',
    title: { en: 'Order of summation: forward vs backward', cs: 'Pořadí sčítání: dopředu a pozpátku' },
    blurb: {
      en: 'The sum 1 + x + x + … + x with a thousand terms x = 10⁻⁸ is 1.00001. Forward, each x is added to a number near 1: in float x is below half an ulp of 1 (≈ 6·10⁻⁸) and is absorbed every time, so the sum stays 1; in double and x87 each of the thousand additions rounds and the errors add up. Backward, the small terms are summed first. Their sum t ≈ 10⁻⁵ has rounding errors of its own (in float only about 5 of its digits are correct), but those errors are tiny compared with the 1 it is then added to, and adding the 1 rounds only once: float gives 1.00001, and double has 16 correct digits instead of 13.',
      cs: 'Součet 1 + x + x + … + x s tisícem členů x = 10⁻⁸ je 1.00001. Dopředu se každé x přičítá k číslu blízkému 1: ve floatu je x menší než polovina ulp jedničky (≈ 6·10⁻⁸) a pokaždé se pohltí, takže součet zůstane 1; v doublu a v x87 každé z tisíce sčítání zaokrouhluje a chyby se sčítají. Pozpátku se nejdřív sečtou malé členy. Jejich součet t ≈ 10⁻⁵ má vlastní chyby zaokrouhlení (ve floatu je správně jen asi 5 jeho číslic), ty jsou ale nepatrné ve srovnání s 1, ke které se pak přičte, a přičtení 1 zaokrouhlí jen jednou: float dá 1.00001 a double má místo 13 platných číslic 16.',
    },
    lesson: {
      en: 'The order of a sum decides how much is lost: add the small terms first (increasing magnitude), or use compensated summation (see Kahan summation).',
      cs: 'Pořadí sčítání rozhoduje o tom, kolik se ztratí: sčítejte od nejmenších členů (podle rostoucí velikosti), nebo použijte kompenzované sčítání (viz Kahanovo sčítání).',
    },
    look: {
      en: 'the rows forward and backward in the summary, and the Error propagation chart, where the forward sum loses digits step by step.',
      cs: 'řádky forward a backward v souhrnu a graf Šíření chyby, kde dopředný součet ztrácí číslice krok za krokem.',
    },
    variables: [{ name: 'x', value: '1e-8' }],
    program: 's = 1\nrepeat 1000 {\n  s = s + x\n}\nforward = s\nt = 0\nrepeat 1000 {\n  t = t + x\n}\nbackward = t + 1',
  },
  {
    id: 'kahansum',
    group: 'accumulation',
    title: { en: 'Kahan (compensated) summation', cs: 'Kahanovo (kompenzované) sčítání' },
    blurb: {
      en: 'Adding 0.1 two hundred times. The plain loop accumulates a rounding error in every step; Kahan’s algorithm carries the lost low-order part in c and adds it back, so even in float it ends at the correctly rounded 20.',
      cs: 'Dvě stě krát se přičte 0.1. Obyčejný cyklus v každém kroku přidá chybu zaokrouhlení; Kahanův algoritmus si ztracenou nižší část nese v c a vrací ji zpět, takže i ve floatu skončí na správně zaokrouhlené hodnotě 20.',
    },
    lesson: {
      en: 'A few extra operations can recover the error of each addition: compensated summation is the practical cure when the order of the terms cannot be chosen.',
      cs: 'Několik operací navíc dokáže zachytit chybu každého sčítání: kompenzované sčítání je praktický lék tam, kde pořadí členů nelze zvolit.',
    },
    look: {
      en: 'the rows kahan and naive in the summary; in the step table, c holds the low-order part each addition lost.',
      cs: 'řádky kahan a naive v souhrnu; v tabulce kroků drží c nižší část, kterou každé sčítání ztratilo.',
    },
    byDesign: ['kahan'],
    helpers: {
      c: {
        en: 'c is the compensation term: the low-order part the last addition lost, with the opposite sign. In exact arithmetic nothing is lost, so its true value is 0 and its badge shows the absolute value it holds — that value is the information Kahan’s method recovers, not a defect.',
        cs: 'c je kompenzační člen: nižší část, kterou poslední sčítání ztratilo, s opačným znaménkem. V přesné aritmetice se nic neztrácí, jeho skutečná hodnota je proto 0 a štítek ukazuje absolutní hodnotu, kterou drží — ta je právě informací, kterou Kahanova metoda zachraňuje, ne vadou.',
      },
      y: {
        en: 'y is the next term corrected by the compensation (0.1 − c): it deliberately differs from 0.1 by the error that the previous addition lost, so that the next addition puts it back.',
        cs: 'y je další člen opravený o kompenzaci (0.1 − c): od 0.1 se záměrně liší o chybu, kterou ztratilo předchozí sčítání, aby ji další sčítání vrátilo zpět.',
      },
    },
    variables: [],
    program: 'k = 0\nc = 0\nrepeat 200 {\n  y = 0.1 - c\n  t = k + y\n  c = (t - k) - y\n  k = t\n}\nkahan = k\ns = 0\nrepeat 200 {\n  s = s + 0.1\n}\nnaive = s',
  },

  // ---------------------------------------------------------- cancellation
  {
    id: 'cancel',
    group: 'cancellation',
    title: { en: 'Catastrophic cancellation', cs: 'Katastrofické krácení' },
    blurb: {
      en: 'Subtracting nearly equal numbers exposes the rounding error of (1 + x). The subtraction itself is exact, but it keeps only the digits of x that survived the rounding of 1 + x: float loses x entirely (0), double keeps about 7 of its 16 digits.',
      cs: 'Odečtení téměř stejných čísel odhalí chybu zaokrouhlení (1 + x). Samotné odčítání je přesné, zachová ale jen ty číslice x, které přežily zaokrouhlení 1 + x: float ztratí x úplně (0), double si ze svých 16 číslic ponechá asi 7.',
    },
    lesson: {
      en: 'Cancellation does not create error, it reveals the error already present in the operands. Avoid subtracting nearly equal rounded quantities (here the formula simplifies to x).',
      cs: 'Krácení chybu nevytváří, odhaluje chybu, která už v operandech je. Vyhněte se odčítání téměř stejných zaokrouhlených hodnot (zde se vzorec zjednoduší na x).',
    },
    look: {
      en: 'the step (1 + x) - 1: the cause chip says cancellation, and the bit view shows the leading bits cancelling.',
      cs: 'krok (1 + x) - 1: štítek příčiny říká krácení a bitový pohled ukáže, jak se úvodní bity odečtou.',
    },
    variables: [{ name: 'x', value: '1e-10' }],
    program: 'y = (1 + x) - 1\ny / x',
  },
  {
    id: 'quadratic',
    group: 'cancellation',
    title: { en: 'Quadratic formula: lost root', cs: 'Kvadratická rovnice: ztracený kořen' },
    blurb: {
      en: 'x² − 10⁸·x + 1 = 0 has roots ≈ 10⁸ and ≈ 10⁻⁸. The textbook formula (−b − √(b²−4ac))/2a for the small root subtracts two nearly equal numbers (float gives 0). The equivalent form 2c/(−b + √(b²−4ac)) adds instead and stays accurate.',
      cs: 'x² − 10⁸·x + 1 = 0 má kořeny ≈ 10⁸ a ≈ 10⁻⁸. Školní vzorec (−b − √(b²−4ac))/2a pro malý kořen odečítá dvě téměř stejná čísla (float dá 0). Ekvivalentní tvar 2c/(−b + √(b²−4ac)) místo toho sčítá a zůstane přesný.',
    },
    lesson: {
      en: 'The small root is a well-conditioned problem; only the textbook formula is an unstable algorithm for it. When an equivalent formula fixes the result, the algorithm was to blame, not the problem.',
      cs: 'Malý kořen je dobře podmíněná úloha; nestabilní je jen školní vzorec, kterým se počítá. Když výsledek opraví ekvivalentní vzorec, chyba byla v algoritmu, ne v úloze.',
    },
    look: {
      en: 'the rows stable and naive in the summary and the step (-b - d) (cancellation); the Rearrange view offers such rewrites.',
      cs: 'řádky stable a naive v souhrnu a krok (-b - d) (krácení); podobné přepisy nabízí pohled Úpravy výrazu.',
    },
    variables: [{ name: 'a', value: '1' }, { name: 'b', value: '-1e8' }, { name: 'c', value: '1' }],
    program: 'd = sqrt(b*b - 4*a*c)\nstable = (2*c) / (-b + d)\nnaive = (-b - d) / (2*a)',
  },
  {
    id: 'onecos',
    group: 'cancellation',
    title: { en: '(1 − cos x)/x² for small x', cs: '(1 − cos x)/x² pro malé x' },
    blurb: {
      en: 'The true value is ≈ 0.5, but cos(10⁻⁸) rounds to exactly 1 in float and double, so 1 − cos x = 0. The identity 1 − cos x = 2·sin²(x/2) removes the subtraction.',
      cs: 'Skutečná hodnota je ≈ 0.5, ale cos(10⁻⁸) se ve floatu i doublu zaokrouhlí přesně na 1, takže 1 − cos x = 0. Identita 1 − cos x = 2·sin²(x/2) odečítání odstraní.',
    },
    lesson: {
      en: 'An identity that avoids subtracting nearly equal values turns an unstable formula into a stable one; the problem itself is harmless.',
      cs: 'Identita, která se vyhne odečítání téměř stejných hodnot, změní nestabilní vzorec ve stabilní; samotná úloha je neškodná.',
    },
    look: {
      en: 'the step cos(x) (it rounds to 1), the step (1 - cos(x)) and the rows stable and naive in the summary.',
      cs: 'krok cos(x) (zaokrouhlí se na 1), krok (1 - cos(x)) a řádky stable a naive v souhrnu.',
    },
    variables: [{ name: 'x', value: '1e-8' }],
    program: 'h = sin(x/2)\nstable = 2*h*h / (x*x)\nnaive = (1 - cos(x)) / (x*x)',
  },
  {
    id: 'needle',
    group: 'cancellation',
    title: { en: 'Needle-like triangle (Heron vs Kahan)', cs: 'Jehlový trojúhelník (Heron vs Kahan)' },
    blurb: {
      en: 'Area of a triangle with sides 100000, 100000 and 0.0001. Heron’s formula needs s − a, which cancels after s has already been rounded (float: 0). Kahan’s rearrangement √((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))/4 with a ≥ b ≥ c avoids that and keeps full accuracy.',
      cs: 'Obsah trojúhelníku se stranami 100000, 100000 a 0.0001. Heronův vzorec potřebuje s − a, kde dojde ke krácení až poté, co se s zaokrouhlilo (float: 0). Kahanova úprava √((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))/4 pro a ≥ b ≥ c tomu předejde a zachová plnou přesnost.',
    },
    lesson: {
      en: 'Heron’s formula is unstable for needle-like triangles; Kahan’s ordering of almost the same arithmetic is stable. Where the parentheses go matters.',
      cs: 'Heronův vzorec je pro jehlové trojúhelníky nestabilní; Kahanovo uspořádání téměř stejných operací je stabilní. Na umístění závorek záleží.',
    },
    look: {
      en: 'the step (s - a) in Heron’s formula (cancellation) and the rows kahan and heron in the summary.',
      cs: 'krok (s - a) v Heronově vzorci (krácení) a řádky kahan a heron v souhrnu.',
    },
    variables: [{ name: 'a', value: '100000' }, { name: 'b', value: '100000' }, { name: 'c', value: '0.0001' }],
    program: 'kahan = sqrt((a + (b + c))*(c - (a - b))*(c + (a - b))*(a + (b - c))) / 4\ns = (a + b + c) / 2\nheron = sqrt(s*(s - a)*(s - b)*(s - c))',
  },
  {
    id: 'variance',
    group: 'cancellation',
    title: { en: 'Variance: one pass vs two passes', cs: 'Rozptyl: jeden, nebo dva průchody' },
    blurb: {
      en: 'The true variance of 100000001, 100000002 and 100000003 is 2/3. The one-pass formula E[x²] − E[x]² subtracts two nearly equal numbers of about 10¹⁶ and gives 0 in double. The two-pass formula first subtracts the mean and then squares the small deviations: double gets 2/3 to full precision. In float even the inputs are lost (100000001 needs 27 bits), so both formulas give 0 there.',
      cs: 'Skutečný rozptyl čísel 100000001, 100000002 a 100000003 je 2/3. Jednoprůchodový vzorec E[x²] − E[x]² odečítá dvě téměř stejná čísla velikosti asi 10¹⁶ a v doublu dá 0. Dvouprůchodový vzorec nejdřív odečte průměr a teprve pak umocní malé odchylky: double spočte 2/3 s plnou přesností. Ve floatu se ztratí už vstupy (100000001 potřebuje 27 bitů), takže tam oba vzorce dají 0.',
    },
    lesson: {
      en: 'The textbook one-pass formula is numerically unstable; use the two-pass form or Welford’s stable one-pass update.',
      cs: 'Učebnicový jednoprůchodový vzorec je numericky nestabilní; použijte dvouprůchodový tvar nebo Welfordovu stabilní jednoprůchodovou aktualizaci.',
    },
    look: {
      en: 'the rows twoPass and onePass in the summary and the step m2 - m^2 (cancellation).',
      cs: 'řádky twoPass a onePass v souhrnu a krok m2 - m^2 (krácení).',
    },
    variables: [{ name: 'x1', value: '100000001' }, { name: 'x2', value: '100000002' }, { name: 'x3', value: '100000003' }],
    program: 'm = (x1 + x2 + x3) / 3\ntwoPass = ((x1 - m)^2 + (x2 - m)^2 + (x3 - m)^2) / 3\nm2 = (x1^2 + x2^2 + x3^2) / 3\nonePass = m2 - m^2',
  },

  // --------------------------------------------------------- amplification
  {
    id: 'compound',
    group: 'amplification',
    title: { en: 'Compound interest (1 + 1/n)ⁿ → e', cs: 'Složené úročení (1 + 1/n)ⁿ → e' },
    blurb: {
      en: 'For n = 10⁸ the value (1 + 1/n)ⁿ differs from e by only about 1.4·10⁻⁸ (≈ e/(2n)). But 1 + 1/n is rounded first, and raising it to the power n multiplies its relative error by n. In float 1 + 1/n is exactly 1, so the result is 1. In double the tiny error of 1 + 1/n grows to about 10⁻⁸: x = 2.7182817983 instead of 2.7182818149, farther from e than the mathematical gap.',
      cs: 'Pro n = 10⁸ se (1 + 1/n)ⁿ liší od e jen asi o 1,4·10⁻⁸ (≈ e/(2n)). Jenže 1 + 1/n se nejdřív zaokrouhlí a umocnění na n-tou vynásobí jeho relativní chybu číslem n. Ve floatu je 1 + 1/n přesně 1, takže výsledek je 1. V doublu naroste nepatrná chyba 1 + 1/n asi na 10⁻⁸: x = 2.7182817983 místo 2.7182818149, tedy dál od e, než je matematický rozdíl.',
    },
    lesson: {
      en: 'A rounding error that is harmless on its own becomes large when a later step amplifies it (here n-fold). The problem (1 + 1/n)ⁿ is well-conditioned; the algorithm is unstable, because it rounds 1 + 1/n and then feeds that value into an ill-conditioned step (a huge power of a number near 1). Compute exp(n·ln(1 + 1/n)) with an accurate ln(1 + x) (log1p in C) instead, or use more precision.',
      cs: 'Chyba zaokrouhlení, která je sama o sobě neškodná, naroste, když ji pozdější krok zesílí (zde n-krát). Úloha (1 + 1/n)ⁿ je dobře podmíněná; nestabilní je algoritmus, protože zaokrouhlí 1 + 1/n a tuto hodnotu pak předá špatně podmíněnému kroku (obrovské mocnině čísla blízkého 1). Počítejte místo toho exp(n·ln(1 + 1/n)) s přesným ln(1 + x) (v C log1p), nebo použijte vyšší přesnost.',
    },
    look: {
      en: 'the step 1 + 1/n (rounded), then pow(1 + 1/n, n), whose cause chip “conditioning ×1e8” shows the amplification, and the last step x - exp(1).',
      cs: 'krok 1 + 1/n (zaokrouhlený), potom pow(1 + 1/n, n), jehož štítek příčiny „podmíněnost ×1e8“ ukazuje zesílení, a poslední krok x - exp(1).',
    },
    variables: [{ name: 'n', value: '1e8' }],
    program: 'x = pow(1 + 1/n, n)\nx - exp(1)',
  },
  {
    id: 'recurrence',
    group: 'amplification',
    title: { en: 'Unstable recurrence Iₙ = 1/n − 5·Iₙ₋₁', cs: 'Nestabilní rekurence Iₙ = 1/n − 5·Iₙ₋₁' },
    blurb: {
      en: 'Iₙ = ∫₀¹ xⁿ/(x+5) dx satisfies Iₙ = 1/n − 5·Iₙ₋₁ with I₀ = ln 1.2. The true values slowly decrease towards 0, but each step multiplies the error inherited from I₀ by 5: float ends in the millions. (ln 1.2 is irrational — its reference value comes from decimal.js.)',
      cs: 'Iₙ = ∫₀¹ xⁿ/(x+5) dx splňuje Iₙ = 1/n − 5·Iₙ₋₁ s I₀ = ln 1.2. Skutečné hodnoty pomalu klesají k 0, ale každý krok vynásobí chybu zděděnou z I₀ pěti: float skončí v milionech. (ln 1.2 je iracionální — referenční hodnotu dodá decimal.js.)',
    },
    lesson: {
      en: 'An algorithm that multiplies the inherited error in every step is unstable, however accurate each single operation is. Running the recurrence backwards, Iₙ₋₁ = (1/n − Iₙ)/5, divides the error by 5 instead.',
      cs: 'Algoritmus, který v každém kroku násobí zděděnou chybu, je nestabilní, ať je každá jednotlivá operace sebepřesnější. Rekurence spuštěná pozpátku, Iₙ₋₁ = (1/n − Iₙ)/5, chybu naopak pěti dělí.',
    },
    look: {
      en: 'the Error propagation chart: the correct digits fall by log₁₀5 ≈ 0.7 per step; the Precision sweep shows how many bits postpone the failure.',
      cs: 'graf Šíření chyby: platných číslic ubude s každým krokem o log₁₀5 ≈ 0,7; Průchod přesnostmi ukáže, kolik bitů selhání oddálí.',
    },
    variables: [],
    program: 'I = ln(1.2)\nn = 0\nrepeat 20 {\n  n = n + 1\n  I = 1/n - 5*I\n}\nI',
  },
  {
    id: 'golden',
    group: 'amplification',
    title: { en: 'Golden-ratio recurrence', cs: 'Rekurence se zlatým řezem' },
    blurb: {
      en: 'Starting with 1 and φ⁻¹ = (√5 − 1)/2, the recurrence bₙ₊₁ = bₙ₋₁ − bₙ produces φ⁻ⁿ, a quickly shrinking sequence. The tiny representation error of √5 excites the second solution (−φ)ⁿ, which grows 1.618× per step and takes over.',
      cs: 'Z počátečních hodnot 1 a φ⁻¹ = (√5 − 1)/2 vytvoří rekurence bₙ₊₁ = bₙ₋₁ − bₙ posloupnost φ⁻ⁿ, která rychle klesá. Nepatrná chyba reprezentace √5 ale vybudí druhé řešení (−φ)ⁿ, které roste 1,618× za krok a převládne.',
    },
    lesson: {
      en: 'If a recurrence also has a growing solution, any rounding error excites it; computing a decaying solution forward through such a recurrence is unstable.',
      cs: 'Má-li rekurence i rostoucí řešení, každá chyba zaokrouhlení ho vybudí; počítat klesající řešení dopředu takovou rekurencí je nestabilní.',
    },
    look: {
      en: 'the Error propagation chart: the relative error grows φ² ≈ 2.6× per step, so about 0.42 correct digits are lost per step.',
      cs: 'graf Šíření chyby: relativní chyba roste φ² ≈ 2,6× za krok, takže s každým krokem ubude asi 0,42 platné číslice.',
    },
    variables: [],
    program: 'a = 1\nb = (sqrt(5) - 1) / 2\nrepeat 40 {\n  c = a - b\n  a = b\n  b = c\n}\nb',
  },
  {
    id: 'muller',
    group: 'amplification',
    title: { en: "Muller's recurrence", cs: 'Mullerova rekurence' },
    blurb: {
      en: 'uₙ₊₁ = 111 − 1130/uₙ + 3000/(uₙ·uₙ₋₁) with u₀ = 2, u₁ = −4 converges to 6, but any rounding error pulls it to 100.',
      cs: 'uₙ₊₁ = 111 − 1130/uₙ + 3000/(uₙ·uₙ₋₁) s u₀ = 2, u₁ = −4 konverguje k 6, ale jakákoli chyba zaokrouhlení ji stáhne ke 100.',
    },
    lesson: {
      en: 'A rounding error can push an iteration onto a different solution: the computed sequence converges smoothly and convincingly — to the wrong limit. This is ill-conditioning: the sequence is extremely sensitive to its starting values, and every rounding acts like a tiny change of the start that switches on the solution tending to 100. No rearrangement of the step helps; more precision only delays the switch.',
      cs: 'Chyba zaokrouhlení může iteraci převést na jiné řešení: vypočtená posloupnost konverguje hladce a přesvědčivě — k nesprávné limitě. Jde o špatnou podmíněnost: posloupnost je extrémně citlivá na počáteční hodnoty a každé zaokrouhlení působí jako nepatrná změna začátku, která zapne řešení směřující ke 100. Žádná úprava kroku nepomůže; vyšší přesnost přechod jen oddálí.',
    },
    look: {
      en: 'the values of u1 in the step table and the Error propagation chart; the Precision sweep shows that more bits only delay the jump to 100.',
      cs: 'hodnoty u1 v tabulce kroků a graf Šíření chyby; Průchod přesnostmi ukáže, že další bity skok ke 100 jen oddálí.',
    },
    variables: [{ name: 'u0', value: '2' }, { name: 'u1', value: '-4' }],
    program: 'repeat 25 {\n  u2 = 111 - 1130/u1 + 3000/(u1*u0)\n  u0 = u1\n  u1 = u2\n}\nu1',
  },
  {
    id: 'logistic',
    group: 'amplification',
    title: { en: 'Logistic map (chaos)', cs: 'Logistické zobrazení (chaos)' },
    blurb: {
      en: 'x ← 4·x·(1 − x) from x = 0.1. Every step roughly doubles any error, so after about 25 steps float and after about 55 steps double are unrelated to the true orbit. The exact fraction doubles its length each step, so the reference continues with verified decimal.js digits.',
      cs: 'x ← 4·x·(1 − x) z x = 0.1. Každý krok jakoukoli chybu zhruba zdvojnásobí, takže zhruba po 25 krocích float a po 55 krocích double nemají se skutečnou trajektorií nic společného. Přesný zlomek se každým krokem zdvojnásobí, reference proto pokračuje ověřenými číslicemi z decimal.js.',
    },
    lesson: {
      en: 'In a chaotic system the state after many steps depends on every bit of the input: the problem itself is ill-conditioned (its condition number roughly doubles with every step), not the algorithm unstable. No formula and no precision gives the long-term orbit; more bits only buy a longer correct start.',
      cs: 'V chaotickém systému závisí stav po mnoha krocích na každém bitu vstupu: špatně podmíněná je samotná úloha (její číslo podmíněnosti se s každým krokem zhruba zdvojnásobí), nejde o nestabilní algoritmus. Dlouhodobou trajektorii nedá žádný vzorec ani žádná přesnost; další bity jen prodlouží správný začátek.',
    },
    look: {
      en: 'the Error propagation chart: about 0.3 digits (one bit) are lost per step; the Precision sweep shows that each extra bit buys about one more correct step.',
      cs: 'graf Šíření chyby: s každým krokem se ztratí asi 0,3 číslice (jeden bit); Průchod přesnostmi ukáže, že každý bit navíc získá zhruba jeden správný krok.',
    },
    variables: [{ name: 'x', value: '0.1' }],
    program: 'repeat 60 {\n  x = 4*x*(1 - x)\n}\nx',
  },

  // ---------------------------------------------------------- conditioning
  {
    id: 'taylor',
    group: 'conditioning',
    title: { en: 'Taylor series of e⁻²⁰', cs: 'Taylorova řada e⁻²⁰' },
    blurb: {
      en: 'Summing 1 + x + x²/2! + … for x = −20: the terms reach 4·10⁷ with alternating signs and must cancel down to 2·10⁻⁹. Float even gets the sign wrong; double has no correct digit. The step ideal = exp(x) shows what an ideal, correctly rounded exp returns (real math libraries may be off by up to about 1 ulp).',
      cs: 'Součet 1 + x + x²/2! + … pro x = −20: členy dosahují 4·10⁷ se střídavými znaménky a musí se odečíst až na 2·10⁻⁹. Float vyjde dokonce se špatným znaménkem, double nemá ani jednu platnou číslici. Krok ideal = exp(x) ukazuje, co vrátí ideální, správně zaokrouhlená funkce exp (skutečné matematické knihovny se mohou lišit až asi o 1 ulp).',
    },
    lesson: {
      en: 'Stability belongs to the algorithm, conditioning to the problem: e⁻²⁰ is a well-conditioned problem, and the alternating series is an unstable way to compute it. Summing the series for e²⁰ (all terms positive) and taking 1/e²⁰ is stable.',
      cs: 'Stabilita je vlastnost algoritmu, podmíněnost vlastnost úlohy: e⁻²⁰ je dobře podmíněná úloha a střídavá řada je nestabilní způsob, jak ji spočítat. Sečíst řadu pro e²⁰ (všechny členy kladné) a vzít 1/e²⁰ je stabilní.',
    },
    look: {
      en: 'the rows ideal and s in the summary, and the Error propagation chart, where the digits collapse while the large terms cancel.',
      cs: 'řádky ideal a s v souhrnu a graf Šíření chyby, kde se platné číslice zhroutí, zatímco se velké členy odečítají.',
    },
    variables: [{ name: 'x', value: '-20' }],
    program: 'ideal = exp(x)\nterm = 1\ns = 1\nk = 0\nrepeat 90 {\n  k = k + 1\n  term = term * x / k\n  s = s + term\n}\ns',
  },
  {
    id: 'sinBig',
    group: 'conditioning',
    title: { en: 'sin of a huge argument', cs: 'sin obrovského argumentu' },
    blurb: {
      en: 'sin(10²²): double holds 10²² exactly and a correctly rounded sin (with exact argument reduction) gets −0.8522… right. In float, 10²² is stored as a different number, and since sin has condition number ≈ 10²² here, the answer is completely different.',
      cs: 'sin(10²²): double uloží 10²² přesně a správně zaokrouhlený sin (s přesnou redukcí argumentu) vrátí správně −0.8522… Ve floatu se 10²² uloží jako jiné číslo, a protože sin má zde číslo podmíněnosti ≈ 10²², výsledek je úplně jiný.',
    },
    lesson: {
      en: 'An ill-conditioned problem: a relative change of 10⁻²² in x changes sin(x) completely, so the error of storing x decides the answer. Unlike an unstable algorithm, no other formula can fix that — only a more precise input helps.',
      cs: 'Špatně podmíněná úloha: relativní změna x o 10⁻²² změní sin(x) úplně, o výsledku tedy rozhodne chyba uložení x. Na rozdíl od nestabilního algoritmu to žádný jiný vzorec nespraví — pomůže jen přesnější vstup.',
    },
    look: {
      en: 'the input row x in the float column (10²² is not a float) and the step sin(x), whose detail gives the condition number.',
      cs: 'vstupní řádek x ve sloupci float (10²² není float) a krok sin(x), jehož detail uvádí číslo podmíněnosti.',
    },
    variables: [{ name: 'x', value: '1e22' }],
    program: 'sin(x)',
  },
  {
    id: 'rump',
    group: 'conditioning',
    title: { en: "Rump's example", cs: 'Rumpův příklad' },
    blurb: {
      en: 'S. M. Rump (1988): float, double and extended all give wrong values; the true result is −0.827396… The polynomial is written with explicit multiplications (x = 77617, y = 33096), so every partial product is its own step. The terms grow to about 10³⁶ and then cancel almost completely.',
      cs: 'S. M. Rump (1988): float, double i extended dávají chybné hodnoty; skutečný výsledek je −0.827396… Polynom je zapsaný explicitními násobeními (x = 77617, y = 33096), takže každý částečný součin je samostatný krok. Členy narostou asi na 10³⁶ a pak se téměř úplně odečtou.',
    },
    lesson: {
      en: 'The sum is extremely ill-conditioned: its terms are about 10³⁶ times larger than the result, so it needs a relative accuracy of about 10⁻³⁶. Each format fails differently, and a wrong answer can look perfectly plausible.',
      cs: 'Součet je extrémně špatně podmíněný: jeho členy jsou asi 10³⁶krát větší než výsledek, takže vyžaduje relativní přesnost asi 10⁻³⁶. Každý formát selže jinak a chybný výsledek může vypadat zcela věrohodně.',
    },
    look: {
      en: 'the step where 5.5·y⁸ is added; the Precision sweep shows that at least 122 bits are needed.',
      cs: 'krok, kde se přičítá 5.5·y⁸; Průchod přesnostmi ukáže, že je potřeba aspoň 122 bitů.',
    },
    variables: [],
    program: 'x = 77617\ny = 33096\n\nz = 333.75*y*y*y*y*y*y + (x*x)*(11*x*x*y*y - y*y*y*y*y*y - 121*y*y*y*y - 2) + 5.5*y*y*y*y*y*y*y*y + x / (2*y)',
  },

  // -------------------------------------------------------------- hardware
  {
    id: 'fma',
    group: 'hardware',
    title: { en: 'Fused multiply-add', cs: 'Fúzované násobení a sčítání (fma)' },
    blurb: {
      en: 'a = 1 + 2⁻¹² is exact in every format, but a² = 1 + 2⁻¹¹ + 2⁻²⁴ needs 25 bits; p = 1 + 2⁻¹¹ is a·a rounded to float. The true a·a − p = 2⁻²⁴ is therefore exactly the error float makes when it stores the product. In float, a*a − p rounds the product to p first and gives 0; fma(a, a, −p) rounds only once and returns 2⁻²⁴ exactly. Double and x87 hold the 25-bit product, so there both are exact. The pair b, q repeats the experiment for double (b² needs 55 bits): plain2 is 0 in double and fused2 is exact; x87 gets both right, and in float b and q are not even representable.',
      cs: 'a = 1 + 2⁻¹² je přesné v každém formátu, ale a² = 1 + 2⁻¹¹ + 2⁻²⁴ potřebuje 25 bitů; p = 1 + 2⁻¹¹ je a·a zaokrouhlené do floatu. Skutečná hodnota a·a − p = 2⁻²⁴ je proto přesně chyba, které se float dopustí při uložení součinu. Ve floatu a*a − p nejdřív zaokrouhlí součin na p a dá 0; fma(a, a, −p) zaokrouhluje jen jednou a vrátí přesně 2⁻²⁴. Double a x87 25bitový součin uloží, takže tam jsou přesné oba výrazy. Dvojice b, q opakuje pokus pro double (b² potřebuje 55 bitů): plain2 je v doublu 0 a fused2 je přesné; x87 spočte obojí správně a ve floatu nejsou b a q ani reprezentovatelné.',
    },
    lesson: {
      en: 'fma computes a·b + c with a single rounding, so fma(a, b, −p) recovers the exact rounding error of a product p = a·b whenever the product needs more bits than the format has. This is the basis of error-free transformations (TwoProduct) and compensated algorithms.',
      cs: 'fma spočte a·b + c s jediným zaokrouhlením, takže fma(a, b, −p) získá přesnou chybu zaokrouhlení součinu p = a·b, kdykoli součin potřebuje víc bitů, než formát má. Na tom stojí bezchybové transformace (TwoProduct) a kompenzované algoritmy.',
    },
    look: {
      en: 'the rows plain and fused in the float column, and plain2 and fused2 in the double column.',
      cs: 'řádky plain a fused ve sloupci float a plain2 a fused2 ve sloupci double.',
    },
    variables: [
      { name: 'a', value: '0x1.001p0' },
      { name: 'p', value: '0x1.002p0' },
      { name: 'b', value: '0x1.0000002p0' },
      { name: 'q', value: '0x1.0000004p0' },
    ],
    program: 'plain = a*a - p\nfused = fma(a, a, -p)\nplain2 = b*b - q\nfused2 = fma(b, b, -q)',
  },
  {
    id: 'doubleRound',
    group: 'hardware',
    title: { en: 'Double rounding', cs: 'Dvojí zaokrouhlení' },
    blurb: {
      en: 'The exact sum 1 + 2⁻⁵³ + 2⁻⁶⁴ rounded once to double gives 1 + 2⁻⁵² (double column, step s). x87 first rounds it to 64 bits, which lands exactly halfway between two doubles, and double(s) then rounds that tie to even: 1. Rounding twice is not the same as rounding once.',
      cs: 'Přesný součet 1 + 2⁻⁵³ + 2⁻⁶⁴ zaokrouhlený jednou do doublu dá 1 + 2⁻⁵² (sloupec double, krok s). x87 ho nejprve zaokrouhlí na 64 bitů, čímž skončí přesně uprostřed mezi dvěma doubly, a double(s) pak tuto remízu zaokrouhlí k sudému: 1. Dvě zaokrouhlení nejsou totéž co jedno.',
    },
    lesson: {
      en: 'A program that computes in x87 extended registers and stores to double can give a different result than pure double arithmetic; the result then depends on the compiler and the hardware.',
      cs: 'Program, který počítá v registrech x87 extended a ukládá do doublu, může dát jiný výsledek než čistě doublová aritmetika; výsledek pak závisí na překladači a hardwaru.',
    },
    look: {
      en: 'the step double(s) in the x87 column (cause: double rounding) next to the step s in the double column.',
      cs: 'krok double(s) ve sloupci x87 (příčina: dvojí zaokrouhlení) vedle kroku s ve sloupci double.',
    },
    variables: [{ name: 'a', value: '1' }, { name: 'b', value: '0x1.002p-53' }],
    program: 's = a + b\nd = double(s)',
  },
  {
    id: 'decimalVsBinary',
    group: 'hardware',
    title: { en: 'Binary vs. decimal64 & fixed-point', cs: 'Dvojkový vs. decimal64 a pevná řádová čárka' },
    blurb: {
      en: 'Compare binary floating point (double) with IEEE 754 decimal64 (BID / DPD) and fixed-point DEC(18,4) / Q16.16. In base 10, 0.1 + 0.2 == 0.3 is exact — no representation error — yet 1/3 still repeats in every format. Adding 1e12 + 0.0001 stays exact in decimal64 and DEC(18,4), while 0.01 × 0.001 underflows to 0 in DEC(18,4) because fixed point has no floating exponent.',
      cs: 'Porovnání dvojkové pohyblivé řádové čárky (double) s IEEE 754 decimal64 (BID / DPD) a pevnou řádovou čárkou DEC(18,4) / Q16.16. V desítkové soustavě platí 0.1 + 0.2 == 0.3 přesně — bez chyby reprezentace — ale 1/3 má periodu v každém formátu. Součet 1e12 + 0.0001 zůstane přesný v decimal64 i DEC(18,4), zatímco 0.01 × 0.001 v DEC(18,4) podteče na 0, protože pevná řádová čárka nemá pohyblivý exponent.',
    },
    lesson: {
      en: 'Decimal formats eliminate base-2 representation errors of decimal fractions (0.1, 0.01), while fixed-point trades dynamic range for uniform absolute spacing Δ; neither prevents repeating fractions like 1/3 or cancellation.',
      cs: 'Desítkové formáty odstraňují dvojkovou chybu reprezentace desetinných zlomků (0.1, 0.01) a pevná řádová čárka vyměňuje dynamický rozsah za rovnoměrný krok Δ; žádný z nich však nezabrání periodickým zlomkům typu 1/3 ani krácení.',
    },
    look: {
      en: 'enable decimal64 (BID), decimal64 (DPD), Q16.16 and DEC(18,4) in Formats, then inspect 0.1 + 0.2 and the BID vs. DPD bit encodings in the step detail.',
      cs: 'zapněte ve Formátech decimal64 (BID), decimal64 (DPD), Q16.16 a DEC(18,4) a pak v detailu kroku porovnejte 0.1 + 0.2 a bitové kódování BID vs. DPD.',
    },
    variables: [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }],
    program: 'sum = a + b\neq = sum == 0.3\nthird = 1 / 3\nledger = 1e12 + 0.0001\ntiny = 0.01 * 0.001',
  },
  {
    id: 'fixedOverflow',
    group: 'hardware',
    title: { en: 'Fixed-point overflow: saturation vs. wraparound', cs: 'Přetečení v pevné řádové čárce: saturace vs. přetečení mod 2ⁿ' },
    blurb: {
      en: 'Q16.16 stores signed numbers in [−32768, 32767.999985] with fixed step Δ = 2⁻¹⁶. Adding 20000 + 20000 = 40000 exceeds the range: under saturation (ARM DSP / ISO TR 18037 _Sat) it clamps to +32767.999985; under two’s-complement wraparound it wraps modulo 2³² to −25536 (wrong sign!). Even (20000 × 2) / 4 fails because the intermediate product overflows before dividing back into range.',
      cs: 'Q16.16 ukládá čísla se znaménkem v [−32768, 32767.999985] s pevným krokem Δ = 2⁻¹⁶. Součet 20000 + 20000 = 40000 rozsah překročí: při saturaci (ARM DSP / ISO TR 18037 _Sat) se omezí na +32767.999985; při přetečení ve dvojkovém doplňku (mod 2³²) přeskočí na −25536 (opačné znaménko!). Selže i (20000 × 2) / 4, protože mezivýsledek přeteče dřív, než ho dělení vrátí do rozsahu.',
    },
    lesson: {
      en: 'Fixed-point arithmetic has no ±∞: overflow either saturates (clamps magnitude) or wraps modulo 2ⁿ (flips sign). Always size intermediate accumulators or rescale before multiplying.',
      cs: 'Aritmetika s pevnou řádovou čárkou nemá ±∞: přetečení buď saturuje (omezí velikost), nebo přeteče modulo 2ⁿ (změní znaménko). Mezivýsledky vyžadují širší akumulátor nebo včasné přeškálování.',
    },
    look: {
      en: 'enable Q16.16 in Formats and toggle Fixed-point overflow between Saturation and Wraparound to watch sum and mid change.',
      cs: 'zapněte Q16.16 ve Formátech a přepínejte přetečení pevné čárky mezi Saturací a Přetečením mod 2ⁿ u kroků sum a mid.',
    },
    variables: [{ name: 'a', value: '20000' }, { name: 'b', value: '20000' }],
    program: 'sum = a + b\nmid = (a * 2) / 4\nsmall = 0.001 * 0.001',
  },
];

export const DEFAULT_EXAMPLE = 'sum';
