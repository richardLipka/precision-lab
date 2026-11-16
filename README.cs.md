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
* **Formáty:** binary16 (poloviční), bfloat16, binary32 (float), binary64 (double), x87 80bitová
  rozšířená, binary128 (čtyřnásobná) a vlastní formát s libovolnou přesností p (1 – 100 000 bitů)
  a omezeným nebo neomezeným exponentem. Pět zaokrouhlovacích režimů IEEE.
* **Tabulka kroků:** u každé operace ukáže hodnotu v každém formátu, směr zaokrouhlení, počet
  platných číslic, příznaky IEEE (nepřesný výsledek, přetečení, podtečení, dělení nulou, neplatná
  operace) a **příčinu rozdílu**: reprezentace, zaokrouhlení, krácení ×κ, pohlcení, zděděná chyba,
  podmíněnost ×κ, přetečení, podtečení.
* **Detail kroku:**
  * srozumitelné vysvětlení, co se stalo
  * přesný výsledek před zaokrouhlením a jeho dvě reprezentovatelná sousední čísla na číselné ose
  * ochranný a sticky bit
  * uložená hodnota jako přesné desetinné číslo i jako bitový zápis (znaménko / exponent /
    zlomková část, hex)
  * chyba rozdělená na část zděděnou z operandů a nové zaokrouhlení
  * **bit po bitu:** bitová pole operandů; u + a − mantisy zarovnané na společný exponent; přesný výsledek
    s vyznačenými p zachovanými bity, ochranným bitem a sticky bity
  * **formální zápis:** x̂ = RN₅₃(a + b) = (a + b)(1 + δ) se skutečným δ a jeho mezí u = 2⁻ᵖ (u subnormálních
    čísel absolutní chyba η); srovnání s n-bitovými celými čísly, kde a ⊕ b = (a + b) mod 2ⁿ
  * panel lze rozšířit tažením levého okraje (nebo tlačítkem „vejít bity“), aby se 64bitový zápis vešel na řádek
* **Diagnóza:** pro každý formát kroky, které stály nejvíc platných číslic.
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
```
Vstupy jsou přesné: `0.1`, `-2.5e-3`, `1/3`, `0x1.8p-2`, `inf`. Vyhodnocuje se striktně zleva
doprava, jak je napsáno: `a + b + c` znamená `(a + b) + c`.

### Příklady
21 vestavěných příkladů. Klasické případy, které selžou uprostřed výpočtu:
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
* Kahanovo sčítání, jednoprůchodový rozptyl a sin(10²²)

## Zdroje příkladů

Každý příklad zobrazuje své zdroje přímo v aplikaci. „Původní publikace“ je místo, kde se příklad (nebo jeho
myšlenka) objevil poprvé; ostatní zdroje jev vysvětlují. Všechny DOI byly ověřeny v Crossrefu.

| Příklad | Zdroje |
|---|---|
| 0.1 + 0.2, chyba reprezentace, katastrofické krácení | Goldberg 1991 [1] |
| Sčítání není asociativní | Goldberg 1991 [1] (tentýž příklad s ±10³⁰) |
| Desetkrát přičíst 0.1, harmonický součet | Higham 2002 [2], kapitola 4 |
| Jednoprůchodový rozptyl | Welford 1962 [3] (stabilní alternativa), Chan, Golub a LeVeque 1983 [4] |
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

`npm test` (146 testů včetně kouřového testu stránky v happy-dom) porovnává simulátor s nezávislými implementacemi:
* binary64 s nativními doubly JavaScriptu: + − × ÷, speciální hodnoty, převod desetinných čísel a
  nejkratší zpětně převoditelný výpis
* binary32 s `Math.fround`, binary16 s `Math.f16round`
* x87 extended, binary128 a široké vlastní formáty s GNU MPFR
  ([gmp-wasm](https://github.com/Daninet/gmp-wasm)) ve čtyřech zaokrouhlovacích režimech
* sqrt bitově shodně, exp, ln, sin, cos, atan do 1 ulp od `Math` v JavaScriptu; funkce s MPFR pro
  64, 113 a 300 bitů
* každé přepisovací pravidlo v každém uzlu každého příkladu zachová přesnou hodnotu
* každý text existuje česky i anglicky

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

## Autor a licence

[MIT](LICENSE) © 2026 [Richard Lipka](https://home.zcu.cz/~lipka/) &lt;lipka@fav.zcu.cz&gt;,
[Katedra informatiky a výpočetní techniky](https://www.kiv.zcu.cz/cs), Fakulta aplikovaných věd,
Západočeská univerzita v Plzni.

Značka fakulty v zápatí patří univerzitě a licence MIT se na ni nevztahuje.
