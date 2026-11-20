# Precision Lab

**Aritmetika v pohyblivé řádové čárce krok za krokem: float, double, x87 extended, quad a libovolná přesnost v porovnání s přesným výsledkem.**
Výuková pomůcka pro numerickou matematiku a architekturu počítačů. Česky a anglicky.

[![Deploy](https://github.com/richardLipka/precision-lab/actions/workflows/deploy.yml/badge.svg)](https://github.com/richardLipka/precision-lab/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

🇬🇧 **[English version →](README.md)**
▶️ **[Spustit online](https://richardlipka.github.io/precision-lab/)**

---

## Co umí

Zadejte několik proměnných a krátký program, například `0.1 + 0.2`, Rumpův polynom nebo cyklus.
Precision Lab ho vyhodnotí **jednou přesně** a **jednou v každém zvoleném formátu IEEE 754**,
operaci po operaci, a ukáže, kde a proč se výsledky rozcházejí.

### Porovnání formátů
* **Úvod:** krátké vysvětlení „Jak číst tuto stránku“ (co se počítá, kam klepnout, tři pohledy), které se
  ukáže při první návštěvě a znovu ho otevře tlačítko „Jak na to“. U volby formátů stránka vysvětlí, co
  znamená p a exponent a proč skutečné počítače mohou vypsat jiné výsledky (mezivýsledky x87 v 80 bitech,
  překladač sloučí a·b + c do fma, `-ffast-math`).
* **Formáty:** binary16 (poloviční), bfloat16, binary32 (float), binary64 (double), x87 80bitová
  rozšířená, binary128 (čtyřnásobná), IEEE 754 decimal64 (obě kódování BID i DPD jako samostatné formáty),
  pevná řádová čárka Q16.16 (32bitová dvojková) a DEC(18,4) (64bitová desítková typu SQL MONEY) s přepínačem
  saturace vs. přetečení ve dvojkovém doplňku a vlastní dvojkový formát s libovolnou přesností p (1 – 100 000 bitů)
  a omezeným nebo neomezeným exponentem. Pět zaokrouhlovacích režimů IEEE.
* **Výsledky:** jeden řádek pro každou přiřazenou proměnnou (vyznačený je výsledek a mezivýsledky, které
  používají pozdější kroky) se skutečnou hodnotou a všemi formáty vedle sebe, takže dvojice variant,
  například sčítání dopředu a pozpátku, lze porovnat na první pohled. Hodnoty se vypisují jako nejkratší
  desetinný zápis, který se převede zpět na totéž uložené číslo.
* **Legenda:** pod výsledky a pod tabulkou kroků vysvětluje štítky s počtem číslic a jejich barvy,
  šipky zaokrouhlení ↑ / ↓, štítky příčin a symboly příznaků IEEE.
* **Tabulka kroků:** u každé operace ukáže hodnotu v každém formátu, směr zaokrouhlení, počet
  platných číslic, příznaky IEEE (nepřesný výsledek, přetečení, podtečení, dělení nulou, neplatná
  operace) a **příčinu rozdílu**: reprezentace, zaokrouhlení, krácení ×κ, pohlcení, zděděná chyba,
  podmíněnost ×κ, přetečení, podtečení, chybná odpověď porovnání, dvojí zaokrouhlení nebo chyby, které
  se náhodou vyrušily.
* **Detail kroku:**
  * srozumitelné vysvětlení, co se stalo
  * přesný výsledek před zaokrouhlením a jeho dvě reprezentovatelná sousední čísla na číselné ose
  * ochranný a sticky bit (první zahozený bit a logický součet všech dalších; stránka je dává do
    souvislosti s bity guard / round / sticky hardwarové sčítačky, které vedou ke stejnému rozhodnutí)
  * uložená hodnota jako přesné desetinné číslo i jako bitový zápis (znaménko / exponent /
    zlomková část, hex)
  * chyba rozdělená na část zděděnou z operandů a nové zaokrouhlení
  * **bit po bitu:** bitová pole operandů; u + a − mantisy zarovnané na společný exponent (přesně, v plné
    šířce); přesný výsledek s vyznačenými p zachovanými bity, ochranným bitem a sticky bity a pravidlo,
    podle kterého z nich plyne směr zaokrouhlení
  * **formální zápis:** x̂ = RN₅₃(a + b) = (a + b)(1 + δ) se skutečným δ a jeho mezí u = 2⁻ᵖ (u subnormálních
    čísel absolutní chyba η); srovnání s n-bitovými celými čísly, kde a ⊕ b = (a + b) mod 2ⁿ
  * panel lze rozšířit tažením levého okraje (nebo tlačítkem „vejít bity“), aby se 64bitový zápis vešel na řádek
* **Diagnóza:** pro každou přiřazenou proměnnou a každý formát, kde se informace ztratila (kroky, které
  stály nejvíc platných číslic, nahromaděné zaokrouhlení, speciální hodnoty), s odkazy na průchod
  přesnostmi a na pohled Úpravy výrazu.
* **Graf šíření chyby:** po každém kroku, jedna čára pro každý formát: platné číslice, |vypočtená − skutečná|
  nebo relativní chyba (logaritmické měřítko).

### Průchod přesnostmi
Spustí program pro každou přesnost p ze seznamu nebo rozsahu (např. `1-1000`, `11, 24, 53, 64, 113`).
Ukáže:
* chybu výsledku v závislosti na p vedle nejlepšího možného p-bitového výsledku (skutečná hodnota jednou
  zaokrouhlená; žádný výpočet nemůže být blíž, mezera je tedy ztráta výpočtu) a meze 2⁻ᵖ·|x|
* platné číslice krok za krokem, jednu čáru pro každou přesnost
* verdikt: konverguje výsledek, od kterého p je správně 1 / 6 / 15 číslic, je tu ostrý práh
  (Rump: p = 122) a kolik číslic algoritmus ztrácí.

### Úpravy výrazu (AST)
Zobrazí syntaktický strom libovolného příkazu a pro vybraný uzel nabídne jen úpravy, které
**zachovávají význam**:
* komutativitu, asociativitu (i smíšené + / − a × / ÷)
* distributivitu a vytýkání
* a − b ↔ a + (−b)
* x·x·x ↔ x³ ↔ pow(x, 3) (jedno zaokrouhlení místo mnoha), sqrt ↔ pow(x, 0.5)

Každá úprava se ověřuje: přesná hodnota každé proměnné musí zůstat stejná. Úprava, která je
identitou jen tehdy, když nedochází k dělení nulou, se odmítne, pokud by výsledek změnila.
Zaokrouhlené výsledky před úpravami a po nich se porovnají formát po formátu.

### Jazyk
```
s = 0                        # přiřazení, jeden příkaz na řádek nebo oddělené ;
repeat 10 { s = s + 0.1 }    # cyklus
x^3                          # celočíselná mocnina = opakované, zvlášť zaokrouhlené násobení
fma(a, b, -c)                # a·b − c s jediným zaokrouhlením
sqrt exp ln log10 sin cos tan atan pow(x, y) pi    # v každém formátu správně zaokrouhlené
c == 0.3                     # porovnání: == != < <= > >=, přesně 1 (pravda) nebo 0 (nepravda)
abs(c - 0.3) <= 1e-12 * abs(0.3)   # porovnání s tolerancí (1e-12 se hodí pro double; float potřebuje asi 1e-6)
double(s)                    # přetypování: half bfloat16 float double extended quad
```
Vstupy jsou přesné: `0.1`, `-2.5e-3`, `1/3`, `0x1.8p-2`, `inf`. Vyhodnocuje se striktně zleva
doprava, jak je napsáno: `a + b + c` znamená `(a + b) + c`.

Porovnání se nikdy nezaokrouhluje: jeho odpověď je v každém formátu přesně 1, nebo 0. Chybná může být
jen kvůli chybám operandů. Platí pravidla IEEE 754: každé porovnání s NaN je nepravdivé kromě `!=`
a `+0 == −0`. Porovnání váže volněji než `+` a `−` a nelze ho řetězit (`a < b < c` je chyba). Přesný
sloupec porovnává skutečné hodnoty; když se odpověď formátu liší, vysvětlení řekne proč a doporučí
test s tolerancí `|a − b| ≤ tol·max(|a|, |b|)`. Tolerance musí být s rezervou větší než chyba
zaokrouhlení, kterou výpočet v daném formátu nasbírá (přinejmenším několik násobků u = 2⁻ᵖ): 1e-12 je
rozumná tolerance v doublu (u ≈ 1,1·10⁻¹⁶), je ale menší než u floatu ≈ 6·10⁻⁸; ukazuje to příklad
„Porovnání s tolerancí“.

Přetypování jako `double(x)` uloží x do daného formátu: v každém sloupci se uložená hodnota zaokrouhlí
do pojmenovaného formátu a pak se opět drží ve vlastním formátu sloupce (podruhé zaokrouhlená, pokud se
pojmenovaný formát do formátu sloupce nevejde). V přesném sloupci je přetypování identita, protože
uložení hodnoty mění jen její zaokrouhlenou kopii, ne skutečnou hodnotu; chyba přetypování se proto
projeví jako odchylka od skutečné hodnoty. Když se už zaokrouhlená hodnota zaokrouhlí znovu a dvě
zaokrouhlení dají jiný výsledek než jediné (x87 extended → double), vysvětlení toto dvojí zaokrouhlení
pojmenuje.

### Příklady
27 vestavěných příkladů seřazených jako učební cesta v šesti skupinách: základy (reprezentace, celá čísla,
speciální hodnoty), hromadění chyb zaokrouhlení, krácení a stabilní přepisy, zesílené chyby (nestabilní
algoritmy a citlivé úlohy), podmíněnost a stabilita a hardware (fma, dvojí zaokrouhlení v x87,
decimal64 BID/DPD vs. dvojková a pevná řádová čárka). U každého příkladu je popsáno,
co se děje, jaké si z něj vzít ponaučení a kam se v nástroji dívat (krok, graf, průchod přesnostmi nebo
pohled Úpravy výrazu).

Základy a sčítání:
* 0.1 + 0.2 a test c == 0.3 (v doublu neplatí, ve floatu a v x87 platí jen náhodou)
* chyba reprezentace desetinných vstupů
* kde celá čísla přestávají být přesná (2²⁴ + 1 ve floatu, 2⁵³ + 1 v doublu)
* porovnání s tolerancí
* speciální hodnoty −0, ∞ a NaN; přetečení a podtečení
* desetkrát přičíst 0.1, neasociativní sčítání, sčítání dopředu a pozpátku, Kahanovo sčítání

Klasické případy, které selžou uprostřed výpočtu:
* Rumpův polynom
* Mullerova rekurence
* nestabilní rekurence Iₙ = 1/n − 5·Iₙ₋₁
* Taylorova řada e⁻²⁰
* ztracený kořen kvadratické rovnice
* Kahanův jehlový trojúhelník
* (1 − cos x)/x²
* složené úročení (1 + 1/n)ⁿ
* rekurence se zlatým řezem
* logistické zobrazení
* rozptyl jedním a dvěma průchody a sin(10²²)
* fúzované násobení a sčítání, které získá chybu zaokrouhlení součinu, a dvojí zaokrouhlení (x87 extended → double)

## Zdroje příkladů

Každý příklad zobrazuje své zdroje přímo v aplikaci. „Původní publikace“ je místo, kde se příklad (nebo jeho
myšlenka) objevil poprvé; ostatní zdroje jev vysvětlují. Všechny DOI byly ověřeny v Crossrefu.

| Příklad | Zdroje |
|---|---|
| 0.1 + 0.2, chyba reprezentace, katastrofické krácení | Goldberg 1991 [1] |
| Sčítání není asociativní | Goldberg 1991 [1] (tentýž příklad s ±10³⁰; zde ±10²⁰) |
| Desetkrát přičíst 0.1, pořadí sčítání | Higham 2002 [2], kapitola 4 |
| Rozptyl: jeden, nebo dva průchody | Welford 1962 [3] (stabilní alternativa), Chan, Golub a LeVeque 1983 [4] |
| Rumpův příklad | Rump 1988 [5], rozbor Loh a Walster 2002 [6] |
| Mullerova rekurence | Muller 1989 [7] (tam u₀ = 11/2, u₁ = 61/11), tato podoba Muller a kol. 2018 [8], rozbor Rump 2020 [9] |
| Fúzované násobení a sčítání | Montoye, Hokenek a Runyon 1990 [10], Ogita, Rump a Oishi 2005 [11] |
| Přetečení a podtečení | IEEE 754-2019 [12] |
| Taylorova řada e⁻²⁰, kvadratická rovnice | Forsythe 1970 [13]; Goldberg 1991 [1] |
| Jehlový trojúhelník | Kahan 2014 [14] (délky stran naše vlastní), Goldberg 1991 [1] |
| (1 − cos x)/x² | Higham 2002 [2], kapitola 1 |
| Složené úročení | Goldberg 1991 [1] (tam s denním úročením, n = 365) |
| Rekurence se zlatým řezem | Press a kol. 1992 [15], §1.3 |
| Logistické zobrazení | May 1976 [16] |
| Kahanovo sčítání | Kahan 1965 [17], Goldberg 1991 [1] |
| sin obrovského argumentu | Payne a Hanek 1983 [18] |
| Iₙ = 1/n − 5·Iₙ₋₁ | běžné učebnicové cvičení; původní publikaci se dohledat nepodařilo |
| Kde celá čísla přestávají být přesná, porovnání s tolerancí, speciální hodnoty, dvojí zaokrouhlení | ilustrace pravidel IEEE 754; bez jednoho konkrétního zdroje |

Úplný seznam literatury (čísla [1]–[18]) je v [anglické verzi](README.md#sources-of-the-examples).

## Jak přesné je „přesně“?

* **Racionální hodnoty jsou přesné.** Používají [fraction.js](https://github.com/rawify/Fraction.js)
  (čitatel a jmenovatel jako BigInt), takže + − × ÷ nikdy nezaokrouhlují.
* **Iracionální hodnoty** (√2, e, ln 1.2, π …) a zlomky delší než 60 000 bitů pokračují jako
  desetinná čísla [decimal.js](https://github.com/MikeMcl/decimal.js). Počítají se dvakrát, na D a
  1,5·D číslic. Za ověřené se považují jen číslice, na kterých se oba výpočty shodují, a žádnému
  formátu se nepřipíše víc platných číslic než tolik.
* **Simulace IEEE je bitově přesná.** Každá operace vezme přesný výsledek na vlastních operandech
  formátu a zaokrouhlí ho jednou, přesně tak to definuje IEEE 754. sqrt je správně zaokrouhlená;
  exp, ln, sin, … jsou simulovány jako správně zaokrouhlené (Zivova strategie). Skutečné funkce
  `libm` se mohou mýlit až asi o 1 ulp.

## Ověření

`npm test` (všechny testovací soubory, včetně testů stránky v happy-dom) porovnává simulátor s nezávislými implementacemi:
* binary64 s nativními doubly JavaScriptu: + − × ÷, speciální hodnoty, převod desetinných čísel a
  nejkratší zpětně převoditelný výpis
* binary32 s `Math.fround`, binary16 s `Math.f16round`
* x87 extended, binary128 a široké vlastní formáty s GNU MPFR
  ([gmp-wasm](https://github.com/Daninet/gmp-wasm)) ve čtyřech zaokrouhlovacích režimech
* sqrt bitově shodně, exp, ln, sin, cos, atan do 1 ulp od `Math` v JavaScriptu; funkce s MPFR pro
  64, 113 a 300 bitů
* každé přepisovací pravidlo v každém uzlu každého příkladu zachová přesnou hodnotu
* porovnání a přetypování dodržují pravidla IEEE 754 (NaN, ±0, dvojí zaokrouhlení)
* příklady tvoří úplnou učební cestu a znovu se spouštějí, aby se ověřilo, že ukazují, co říká jejich
  text (včetně čísel, která text uvádí)
* vysvětlení jsou poctivá: přesný výsledek se nesvádí na zděděnou chybu, zisk číslic se nazve štěstím jen
  tehdy, když ho nevysvětlí podmíněnost, a každá mez odpovídá zaokrouhlovacímu režimu
* každý text existuje česky i anglicky a každý klíč a kód vysvětlení použitý v kódu existuje

## Spuštění

Vyžaduje Node.js 24 nebo novější.

```bash
npm install
npm run dev      # vývojový server
npm test
npm run build    # statický web v dist/
```

Každý push do větve `main` se otestuje a nasadí na GitHub Pages
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

## Struktura projektu

Jádro (`src/engine/`) neobsahuje žádný kód pro DOM ani žádné texty: vrací čísla a kódy nezávislé na
jazyce, které překládá uživatelské rozhraní.

| Cesta | Obsah |
|---|---|
| `src/engine/rational.js` | přesné hodnoty (fraction.js), čtení literálů, přesný desetinný rozvoj |
| `src/engine/ieee.js` | formáty, správné zaokrouhlení pro libovolné p a rozsah exponentu, + − × ÷ fma, porovnání a přetypování, příznaky IEEE, bitové kódování, nejkratší desetinný zápis |
| `src/engine/real.js` | referenční hodnoty decimal.js pro iracionální čísla (počítané dvakrát, ověřené číslice) |
| `src/engine/fpfunc.js` | správně zaokrouhlené sqrt, exp, ln, sin, pow, … v libovolném formátu (Zivova strategie) |
| `src/engine/parser.js` | lexikální analyzátor a parser jazyka (gramatika je v úvodním komentáři) |
| `src/engine/evaluator.js` | plochý seznam kroků: každý krok přesně a v každém formátu |
| `src/engine/explain.js` | proč se hodnota liší: štítek příčiny a kódy vysvětlení kroku, diagnóza |
| `src/engine/metrics.js` | všechny údaje o chybě (ulp, relativní chyba, platné číslice) a všechny prahy vysvětlení na jednom místě (`QUALITY_GOOD`, `CANCEL_MIN_LOG10_KAPPA`, `COND_CAUSE`, …), každý s komentářem, proč je takový |
| `src/engine/messages.js` | chyby jádra (chyby zápisu, limity) česky a anglicky, pro rozhraní i jako `Error.message` |
| `src/engine/sweep.js` | průchod přesnostmi a rozbor konvergence |
| `src/engine/ast.js` | přepisovací pravidla zachovávající význam |
| `src/sweep/worker.js` | Web Worker, který spouští průchod přesnostmi mimo hlavní vlákno a hlásí postup |
| `src/main.js` | propojení stránky: stav (uložený v prohlížeči, sdílitelný jako odkaz), úvod, výsledky s přehledem po proměnných, diagnóza, tabulka kroků, graf chyb, přepínání pohledů |
| `src/ui/detail.js` | panel detailu kroku, legenda štítků, vykreslení vysvětlení |
| `src/ui/binaryView.js` | oddíl „bit po bitu“: bitová pole, zarovnané mantisy, ochranný a sticky bit, formální zápis |
| `src/ui/chart.js` | obecný čárový graf v SVG (graf chyb a oba grafy průchodu přesnostmi) |
| `src/ui/sweep.js` | pohled Průchod přesnostmi |
| `src/ui/rewrite.js` | pohled Úpravy výrazu (AST) |
| `src/ui/examples.js` | vestavěné příklady a jejich skupiny v učební cestě |
| `src/ui/references.js` | literatura a zdroje jednotlivých příkladů |
| `src/i18n.js` | všechny texty viditelné uživateli, česky a anglicky (`DICT.en`, `DICT.cs`) |
| `index.html`, `src/style.css` | kostra stránky (texty se doplňují přes atributy `data-i18n`) a její styly |
| `test/` | testy ve vitestu: jádro proti nativním doublům a MPFR, vysvětlení, příklady, shoda češtiny a angličtiny, testy stránky v happy-dom |

## Jak přidat příklad

1. Přidejte objekt do pole `EXAMPLES` v `src/ui/examples.js`, a to na místo v učební cestě, kam patří
   (příklady jedné skupiny musí zůstat pohromadě):
   ```js
   {
     id: 'myExample',                     // jedinečné, používá se v URL a v references.js
     group: 'cancellation',               // jedna ze skupin EXAMPLE_GROUPS
     title: { en: '…', cs: '…' },
     blurb: { en: '…', cs: '…' },         // co se děje a proč, s čísly, která dají výchozí formáty
     lesson: { en: '…', cs: '…' },        // ponaučení, které si vzít
     look: { en: '…', cs: '…' },          // kam se v nástroji dívat (krok, graf, průchod, Úpravy výrazu)
     variables: [{ name: 'x', value: '0.1' }],
     program: 'y = x + x\ny - 0.2',
   },
   ```
2. Pochází-li příklad z publikace, přidejte záznam do `BIB` a příklad do `EXAMPLE_REFS` v
   `src/ui/references.js` (role `origin`, `version`, `analysis` nebo `background` a krátká poznámka
   v obou jazycích) a doplňte ho do tabulky zdrojů v obou README.
3. Aktualizujte počet příkladů a jejich seznam v `README.md` i `README.cs.md` (počet hlídá test).
4. Uvádí-li text čísla, přidejte do `test/examples.test.js` test, který příklad znovu spustí a čísla
   ověří, a pak spusťte `npm test`.

## Jak přidat vysvětlení

1. V `src/engine/explain.js` rozpoznejte situaci a zavolejte `push('skupina.mujKod', params, tone)` (tón
   `good`, `info`, `warn` nebo `bad`); hlavní příčinu pojmenujete voláním `setCause('mojePricina', params,
   tone)`. Parametry jsou obyčejné hodnoty nebo `key('jiny.kod', params)` pro vnořenou přeloženou frázi.
   Prahy patří do `src/engine/metrics.js` jako pojmenované konstanty.
2. Přidejte text `'skupina.mujKod'` (a `'cause.mojePricina'` s `'cause.mojePricina.tip'`) do `DICT.en`
   i `DICT.cs` v `src/i18n.js` se stejnými názvy `{zástupných}` parametrů. V češtině pište počty ve tvaru
   „počet …: {n}“, aby věta byla správně pro každé n.
3. Přidejte test do `test/explain.test.js` (nebo `test/honest.test.js`), který sestaví program s danou
   situací a ověří kód. `npm test` navíc kontroluje, že každý kód použitý v kódu existuje v obou
   jazycích, včetně kódů vybraných ternárním operátorem.

## Autor a licence

[MIT](LICENSE) © 2026 [Richard Lipka](https://home.zcu.cz/~lipka/) &lt;lipka@fav.zcu.cz&gt;,
[Katedra informatiky a výpočetní techniky](https://www.kiv.zcu.cz/cs), Fakulta aplikovaných věd,
Západočeská univerzita v Plzni.

Značka fakulty v zápatí patří univerzitě a licence MIT se na ni nevztahuje.
