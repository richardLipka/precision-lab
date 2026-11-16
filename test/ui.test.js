// @vitest-environment happy-dom
// Smoke test of the real page: loads index.html and main.js in happy-dom and
// checks the example sources, the language switch and the AST view.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');

beforeAll(async () => {
  localStorage.clear();
  localStorage.setItem('precision-lab-lang', 'en');
  document.body.innerHTML = html.replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, '').replace(/<script[\s\S]*?<\/script>/g, '');
  await import('../src/main.js');
});

const pick = (id) => {
  const s = document.getElementById('example');
  s.value = id;
  s.dispatchEvent(new Event('change'));
};

describe('page', () => {
  it('shows the sources of the selected example with working links', () => {
    pick('muller');
    const refs = document.getElementById('example-refs');
    expect(refs.textContent).toContain('Original publication');
    expect(refs.textContent).toContain('Arithmétique des ordinateurs');
    expect(refs.textContent).toContain('u₀ = 2, u₁ = −4');
    const links = [...refs.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('https://ens-lyon.hal.science/ensl-00086707');
    expect(links).toContain('https://doi.org/10.1553/etna_vol52s358');
  });

  it('shows no sources for an example without a traceable publication', () => {
    pick('recurrence');
    expect(document.getElementById('example-refs').innerHTML).toBe('');
  });

  it('translates the sources to Czech', () => {
    pick('rump');
    document.getElementById('lang').click();
    expect(document.getElementById('example-refs').textContent).toContain('Původní publikace');
    document.getElementById('lang').click();
  });

  it('groups the examples into a learning path and shows each lesson and where to look', () => {
    const sel = document.getElementById('example');
    const groups = [...sel.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.getAttribute('label'))[0]).toBe('1 · Basics: representation, integers, special values');
    expect(groups.length).toBe(6);
    expect([...groups[0].querySelectorAll('option')].map((o) => o.value)).toEqual(['sum', 'repr', 'intLimit', 'equality', 'special', 'range']);
    expect(sel.options[0].value).toBe(''); // "custom" stays first, outside the groups
    pick('order');
    const blurb = document.getElementById('example-blurb');
    expect(blurb.querySelector('.ex-blurb').textContent).toContain('1.00001');
    expect(blurb.querySelector('.ex-lesson').textContent).toMatch(/^Lesson: .*small terms first/);
    expect(blurb.querySelector('.ex-look').textContent).toMatch(/^Look at: the rows forward and backward/);
    document.getElementById('lang').click();
    expect(sel.querySelector('optgroup').getAttribute('label')).toContain('Základy');
    expect(blurb.querySelector('.ex-lesson').textContent).toMatch(/^Ponaučení: /);
    expect(blurb.querySelector('.ex-look').textContent).toMatch(/^Kam se dívat: /);
    document.getElementById('lang').click();
    // a custom program clears the example texts
    const prog = document.getElementById('program');
    prog.value = 'x + 1';
    prog.dispatchEvent(new Event('input'));
    expect(blurb.textContent).toBe('');
    pick('sum');
  });

  it('has the author and department links in the footer', () => {
    const hrefs = [...document.querySelectorAll('.app-footer a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://home.zcu.cz/~lipka/');
    expect(hrefs).toContain('https://www.kiv.zcu.cz/cs');
  });

  it('renders the AST view and applies a rewrite', () => {
    pick('assoc');
    document.querySelector('.view-tab[data-view=rewrite]').click();
    expect(document.querySelectorAll('.ast-row').length).toBeGreaterThan(2);
    document.querySelector('.ast-row[data-path=""]').click();
    document.querySelector('.rw-rule[data-rule=reassocRight]').click();
    expect(document.getElementById('rw-after').textContent).toContain('a + (b + c)');
    expect(document.getElementById('rw-error').hidden).toBe(true);
  });

  it('shows the bit-level view and the formal notation of a step', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('sum');
    // step 2 = a + b; select it in binary64
    document.querySelector('.vcell[data-step="2"][data-fmt="binary64"]').click();
    const bin = document.querySelector('#detail .binary');
    expect(bin).toBeTruthy();
    expect(bin.textContent).toContain('RN₅₃(a + b)');
    expect(bin.textContent).toMatch(/δ = −?[0-9.e−]+/);
    // aligned addition: three or four rows with a guard bit marked in the exact row
    expect(bin.querySelectorAll('.bin-table').length).toBeGreaterThanOrEqual(2);
    expect(bin.querySelector('.bin-exact .bin-guard')).toBeTruthy();
    // 0.1 + 0.2 in double is an exact tie: guard 1, sticky 0
    expect(bin.textContent).toContain('guard bit 1, sticky bit 0');
    // the 'fit bits' button and the resizer keyboard control must not throw
    document.querySelector('#detail .fit-bits').click();
    document.getElementById('detail-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(document.querySelector('.layout').style.getPropertyValue('--detail-w')).toMatch(/px$/);
  });

  it('shows the bits of a literal conversion: 0.1 in binary32', () => {
    pick('sum');
    document.querySelector('.vcell[data-step="0"][data-fmt="binary32"]').click();
    const kept = [...document.querySelectorAll('#detail .bin-exact .bin-kept')].map((e) => e.textContent);
    expect(kept[0]).toBe('1.10011001100110011001100');
    expect(document.querySelector('#detail .bin-exact .bin-guard').textContent).toBe('1');
  });

  it('switches the error chart to |computed − true|', () => {
    const m = document.getElementById('chart-measure');
    m.value = 'abs';
    m.dispatchEvent(new Event('change'));
    expect(document.getElementById('chart-subtitle').textContent).toContain('|x̂ − x|');
    const ticks = [...document.querySelectorAll('#chart .axis-label')].map((e) => e.textContent);
    expect(ticks.some((x) => x.startsWith('1e'))).toBe(true);
    m.value = 'digits';
    m.dispatchEvent(new Event('change'));
  });

  it('shows correct digits capped at the format capacity, with the measured value as a note', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('sum');
    // 0.1 in double: −log10(rel. error) ≈ 16.3, more than the ≈ 16.0 digits double holds
    const cell = document.querySelector('.vcell[data-step="0"][data-fmt="binary64"]');
    const badge = cell.querySelector('.badge');
    expect(badge.textContent).toContain('16.0 d');
    expect(badge.getAttribute('title')).toContain('measured −log₁₀(relative error) = 16.');
    cell.click();
    const detail = document.getElementById('detail').textContent;
    expect(detail).toContain('correct to the full precision of the format');
    expect(detail).not.toMatch(/Result: 16\.[1-9] correct/);
    expect(detail).toContain('capped at what the format holds');
    // ulp and u are defined where the student meets them; the gap is marked as 1 ulp
    expect(detail).toContain('is the gap between the two representable numbers around the exact result');
    expect(detail).toContain('so its relative error is at most the unit roundoff u = 2^−p');
    expect(document.querySelector('#detail .nl-ulp-text').textContent).toMatch(/^gap = 1 ulp = /);
    // the summary diagnosis never claims more digits than the format holds
    expect(document.getElementById('diagnosis').textContent).not.toMatch(/16\.[1-9] of ≈ 16\.0/);
  });

  it('draws no inexact point of the digits chart at or above the labelled "exact" line', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('needle'); // float digits measure up to ≈ 18.9, far above the 7.2 float holds
    const band = document.querySelector('#chart .band-line');
    expect(band).toBeTruthy();
    expect(document.querySelector('#chart .band-label').textContent).toBe('exact');
    const yExact = Number(band.getAttribute('y1'));
    const dots = [...document.querySelectorAll('#chart .series-dot')].map((c) => Number(c.getAttribute('cy')));
    expect(dots.length).toBeGreaterThan(0);
    // SVG y grows downwards: every point lies on (exact) or below the line
    for (const cy of dots) expect(cy).toBeGreaterThanOrEqual(yExact - 1e-6);
  });

  it('opens on an honest explanation: float c − 0.3 is exact by lucky cancellation, nothing was lost', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('sum');
    document.querySelector('.vcell[data-step="4"][data-fmt="binary32"]').click();
    const what = document.querySelector('#detail .what').textContent;
    expect(what).not.toContain('was lost in earlier steps');
    expect(what).not.toContain('cannot give the true value');
    expect(what).toContain('happened to cancel');
    const chip = document.querySelector('.vcell[data-step="4"][data-fmt="binary32"] .cause');
    expect(chip.textContent).toBe('errors cancelled');
  });

  it('diagnosis names where information was lost, accumulation and special values honestly', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('assoc');
    expect(document.getElementById('diagnosis').textContent).toMatch(/#6 .*cancellation.*← information lost at #5 .*absorption/);
    pick('loop');
    const loop = document.getElementById('diagnosis').textContent;
    expect(loop).toContain('the small rounding errors added up');
    expect(loop).not.toContain('only ordinary rounding');
    pick('special');
    expect(document.getElementById('diagnosis').textContent).toContain('the result is NaN');
  });

  it('documents comparisons and casts in the syntax help', () => {
    const help = document.querySelector('details.syntax').textContent;
    expect(help).toContain('== != < <= > >=');
    expect(help).toContain('abs(a - b) <= 1e-12 * abs(b)');
    expect(help).toContain('half(x) bfloat16(x) float(x) double(x) extended(x) quad(x)');
  });

  it('explains why c == 0.9 is false and why the tolerance test still fails in float', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('equality');
    // step #5 is c == 0.9
    expect(document.querySelector('.vcell[data-step="5"][data-fmt="binary64"] .cause').textContent).toBe('wrong answer');
    document.querySelector('.vcell[data-step="5"][data-fmt="binary64"]').click();
    const what = document.querySelector('#detail .what').textContent;
    expect(what).toContain('The true values are equal, but the stored values differ by');
    expect(what).toContain('they are neighbouring numbers of this format');
    expect(what).toContain('Compare with a tolerance instead');
    expect(document.getElementById('detail').textContent).toContain('A comparison is not rounded');
    expect(document.querySelector('#detail .binary').textContent).toContain('A comparison is not rounded: its result is exactly 1 (true) or 0 (false).');
    // the tolerance test (last row) fails in float: the advice says the tolerance is too small
    const last = document.querySelectorAll('#steps tbody tr').length - 1;
    document.querySelector(`.vcell[data-step="${last}"][data-fmt="binary32"]`).click();
    const fl = document.querySelector('#detail .what').textContent;
    expect(fl).toContain('the tolerance is smaller than the rounding error of this format');
    expect(fl).not.toContain('Compare with a tolerance instead');
    // the lucky equality of 0.1 + 0.2 == 0.3 in float names no unrelated program
    pick('sum');
    document.querySelector('.vcell[data-step="7"][data-fmt="binary32"]')?.click();
    const sumWhat = document.querySelector('#detail .what').textContent;
    expect(sumWhat).toContain('That is luck, not a guarantee');
    expect(sumWhat).not.toContain('is true in float but false in double');
  });

  it('names double rounding in the x87 column of double(s)', () => {
    document.querySelector('.view-tab[data-view=compare]').click();
    pick('doubleRound');
    const cell = document.querySelector('.vcell[data-step="3"][data-fmt="x87"]');
    expect(cell.querySelector('.cause').textContent).toBe('double rounding');
    cell.click();
    const detail = document.getElementById('detail').textContent;
    expect(detail).toContain('Double rounding: #2 was already rounded');
    expect(detail).toContain('RN₆₄(RN₅₃(s))');
    expect(detail).toContain('store #2');
    // the number line shows the rounding into double
    expect(detail).toContain('binary64 (double)');
  });
});

describe('guidance and consistency', () => {
  const compare = () => document.querySelector('.view-tab[data-view=compare]').click();
  const text = (id) => document.getElementById(id).textContent;

  it('summarises and diagnoses every assigned variable, so paired variants show both sides', () => {
    compare();
    pick('assoc');
    const labels = [...document.querySelectorAll('#summary .sumtab tbody th .mono')].map((e) => e.textContent);
    expect(labels).toEqual(['left', 'right']);
    // one clickable cell per format and the true value for each row
    const cells = document.querySelectorAll('#summary .sum-cell[data-step="4"]');
    expect(cells.length).toBe(1 + 3);
    const groups = [...document.querySelectorAll('#diagnosis .diag-group')];
    expect(groups.map((g) => g.querySelector('summary .mono').textContent)).toEqual(['left', 'right']);
    expect(groups.every((g) => g.open)).toBe(true);
    // clicking a summary cell opens that step
    document.querySelector('#summary .sum-cell[data-step="4"][data-fmt="binary64"]').click();
    expect(document.querySelector('#detail .pill').textContent).toBe('#4');

    pick('kahansum');
    const rows = [...document.querySelectorAll('#summary .sumtab tbody th .mono')].map((e) => e.textContent);
    // variables holding the same value share a row, the last assigned name first
    expect(rows).toContain('kahan, k, t');
    expect(rows).toContain('naive, s');
    // helpers the program reads again are collapsed, the two answers are open
    const open = [...document.querySelectorAll('#diagnosis .diag-group[open] summary .mono')].map((e) => e.textContent);
    expect(open).toEqual(['kahan, k, t', 'naive, s']);
  });

  it('says that float matches 0.1 + 0.2 − 0.3 only because the rounding errors cancelled', () => {
    compare();
    pick('sum');
    const diag = text('diagnosis');
    expect(diag).toMatch(/float: exact result, although earlier values were rounded \(#0, #1, #2, #3\)/);
    expect(diag).toContain('that is luck');
    // the intermediate c is reported too, with float's 0.3 marked as inexact, next to the final test c == 0.3
    expect([...document.querySelectorAll('#summary .sumtab tbody th .mono')].map((e) => e.textContent)).toEqual(['c', 'c == 0.3']);
    expect(document.querySelector('#summary .sum-cell[data-step="2"][data-fmt="binary32"] .badge').className).not.toContain('q-exact');
    expect(text('summary')).toContain('shortest decimal that converts back to the same stored binary number');
  });

  it('does not call x − x luck: equal operands cancel their errors by construction', async () => {
    compare();
    pick('sum');
    const prog = document.getElementById('program');
    prog.value = 'x = a * b\ny = a * b - x';
    prog.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
    const diag = text('diagnosis');
    expect(diag).toContain('float: exact result: both operands are computed the same way');
    expect(diag).not.toContain('that is luck');
  });

  it('keeps "true value" for the reference and names the exact result of the operation differently', () => {
    compare();
    pick('sum');
    expect(document.querySelector('#steps .exact-col').textContent).toBe('true value');
    expect(document.querySelector('#summary thead .exact-col').textContent).toBe('true value');
    document.querySelector('.vcell[data-step="2"][data-fmt="binary64"]').click();
    const detail = text('detail');
    expect(detail).toContain('Exact result of this operation on the stored operands (before rounding)');
    expect(detail).toContain('not from their true values');
    expect(detail).toContain('its distance from the true value (0.3) is the error inherited');
    expect(document.querySelector('#detail .numline').textContent).toMatch(/unrounded \(\d/);
    expect(document.querySelector('#detail .bin-exact th').textContent).toContain('unrounded');
    expect(document.querySelector('#detail .detail-tabs .tab').textContent).toBe('true value');
  });

  it('has a visible key for badges, arrows, chips and flags, and the flags carry titles', () => {
    compare();
    const legend = text('steps-legend');
    expect(legend).toContain('≥ 85 %');
    expect(legend).toContain('40–85 %');
    expect(legend).toContain('below 40 %');
    expect(legend).toContain('OVF overflow');
    expect(legend).toContain('INV invalid operation');
    expect(legend).toContain('rounded up / down in this step');
    pick('range');
    const flag = document.querySelector('#steps .flag-mini');
    expect(flag).toBeTruthy();
    expect(flag.getAttribute('title')).toBeTruthy();
    // ▲ never marks a bad value (it means "better" in the Rearrange view)
    expect([...document.querySelectorAll('#steps .badge, #summary .badge')].some((b) => b.textContent.includes('▲'))).toBe(false);
    const bad = document.querySelector('#steps .badge.q-bad');
    if (bad && bad.textContent !== '✕') expect(bad.textContent.startsWith('✕ ')).toBe(true);
  });

  it('uses the same badge icons and key in the Rearrange view', () => {
    pick('assoc');
    document.querySelector('.view-tab[data-view=rewrite]').click();
    expect(text('rw-legend')).toContain('≥ 85 %');
    const badges = [...document.querySelectorAll('#rw-compare .badge')];
    expect(badges.some((b) => b.classList.contains('q-bad') && b.textContent.startsWith('✕ '))).toBe(true);
    compare();
  });

  it('introduces the page, its views and the format vocabulary', () => {
    const intro = document.getElementById('intro');
    expect(intro.hidden).toBe(false);
    expect(intro.textContent).toContain('IEEE 754');
    expect(intro.textContent).toContain('Precision sweep');
    document.getElementById('intro-close').click();
    expect(intro.hidden).toBe(true);
    document.getElementById('help').click();
    expect(intro.hidden).toBe(false);
    expect([...document.querySelectorAll('.view-sub')].map((e) => e.textContent)).toEqual(['Which step goes wrong?', 'Does more precision help?', 'Does a different formula help?']);
    const setup = document.querySelector('.setup').textContent;
    expect(setup).toContain('significant bits of the significand');
    expect(setup).toContain('an idealised exponent without overflow or underflow');
    expect(document.querySelector('#formats .fmt-check [title]').getAttribute('title')).toMatch(/^p = \d+ significant bits ≈/);
    expect(text('chart-subtitle')).toContain('Click a point to explain that step.');
  });

  it('links the diagnosis to the precision sweep and the Rearrange view', () => {
    compare();
    pick('cancel');
    const link = document.querySelector('#diagnosis .view-link[data-view=sweep]');
    expect(link).toBeTruthy();
    link.click();
    expect(document.getElementById('view-sweep').hidden).toBe(false);
    compare();
    document.querySelector('#diagnosis .view-link[data-view=rewrite]').click();
    expect(document.getElementById('view-rewrite').hidden).toBe(false);
    compare();
  });

  it('hides the step detail outside the format comparison and gives its width to the view', () => {
    document.querySelector('.view-tab[data-view=sweep]').click();
    expect(document.getElementById('detail-panel').hidden).toBe(true);
    expect(document.querySelector('.layout').classList.contains('no-detail')).toBe(true);
    compare();
    expect(document.getElementById('detail-panel').hidden).toBe(false);
    expect(document.querySelector('.layout').classList.contains('no-detail')).toBe(false);
  });

  it('marks the old results as stale while the program does not parse', async () => {
    compare();
    pick('sum');
    const prog = document.getElementById('program');
    prog.value = 'c = a +';
    prog.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
    const banner = document.getElementById('stale');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('still those of the last valid program');
    expect(document.getElementById('view-compare').classList.contains('stale')).toBe(true);
    prog.value = 'c = a + b';
    prog.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
    expect(banner.hidden).toBe(true);
    expect(document.getElementById('view-compare').classList.contains('stale')).toBe(false);
  });

  it('on a narrow screen every link scrolls to the explanation', () => {
    compare();
    pick('assoc');
    const mm = window.matchMedia;
    const detail = document.getElementById('detail');
    let scrolled = 0;
    const old = detail.scrollIntoView;
    detail.scrollIntoView = () => { scrolled++; };
    window.matchMedia = (q) => ({ matches: q.includes('max-width: 1279px'), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      document.querySelector('#diagnosis .step-link').click();
      expect(scrolled).toBe(1);
      document.querySelector('#summary .sum-cell[data-fmt="binary32"]').click();
      expect(scrolled).toBe(2);
      // the chip's meaning is written next to it, not only in a hover title
      expect(document.querySelector('#detail .what .cause-tip').textContent.length).toBeGreaterThan(5);
    } finally {
      window.matchMedia = mm;
      detail.scrollIntoView = old;
    }
  });

  it('shows the concrete bits first, the formal notation last, with the binary point and the tie rule', () => {
    compare();
    pick('sum');
    document.querySelector('.vcell[data-step="2"][data-fmt="binary64"]').click();
    const heads = [...document.querySelectorAll('#detail .binary h4')].map((h) => h.textContent);
    expect(heads[0]).toContain('Operands as stored');
    expect(heads[heads.length - 1]).toBe('Formal notation');
    // 0.1 + 0.2 lies below 1: the aligned view still draws the binary point
    expect(document.querySelectorAll('#detail .bin-table .bin-point').length).toBeGreaterThan(0);
    const decision = document.querySelector('#detail .bin-decision').textContent;
    expect(decision).toContain('a tie');
    expect(decision).toContain('whose last bit is 0');
    expect(decision).toContain('the last kept bit is 1, so 1 is added to it');
    expect(decision).not.toContain('(default)');
  });

  it('explains the shortest decimal, the x87 format, precision vs range and the rounding modes', () => {
    compare();
    pick('sum');
    document.querySelector('.vcell[data-step="0"][data-fmt="x87"]').click();
    const detail = document.getElementById('detail');
    expect(detail.textContent).toContain('the shortest decimal that converts back to exactly this binary number');
    const note = detail.querySelector('.fmt-note');
    expect(note.closest('details')).toBeNull();
    expect(note.textContent).toContain('rounded to double only when they are stored to memory');
    expect([...detail.querySelectorAll('details')].pop().textContent).toContain('Precision and range are separate');
    expect(document.querySelector('.setup').textContent).toContain('-ffast-math');
    const mode = document.getElementById('mode');
    expect(mode.options[0].textContent).toBe('to nearest, ties to even (default)');
    expect(text('mode-hint')).toContain('on a tie the one whose last bit is 0');
    mode.value = 'RD';
    mode.dispatchEvent(new Event('change'));
    expect(text('mode-hint')).toContain('0.09999999999999999');
    mode.value = 'RNE';
    mode.dispatchEvent(new Event('change'));
  });

  it('fits the step table with three formats into a 1440 px window (CSS width budget)', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'style.css'), 'utf8');
    const px = (re) => Number(re.exec(css)[1]);
    const setup = px(/grid-template-columns: (\d+)px minmax\(0, 1fr\) var\(--detail-w, \d+px\)/);
    const detailW = px(/var\(--detail-w, (\d+)px\)/);
    const gap = px(/\.layout \{[^}]*gap: (\d+)px/);
    const pad = px(/\.layout \{[^}]*padding: \d+px (\d+)px/);
    const panelPad = px(/\.panel \{[^}]*padding: (\d+)px/);
    const vcell = px(/\.vcell \{[^}]*min-width: (\d+)px/);
    const steptext = px(/\.steps \.steptext \{[^}]*min-width: (\d+)px/);
    const available = 1440 - 2 * pad - 2 * gap - setup - detailW - 2 * panelPad;
    const needed = 40 + steptext + vcell * (1 + 3); // #, step, true value, three formats
    expect(needed).toBeLessThanOrEqual(available);
  });
});

describe('bit view and formal notation', () => {
  let ev;
  let bv;
  let F;
  beforeAll(async () => {
    ev = await import('../src/engine/evaluator.js');
    bv = await import('../src/ui/binaryView.js');
    F = Object.fromEntries((await import('../src/engine/ieee.js')).FORMATS.map((f) => [f.id, f]));
  });
  const html = (program, variables, fmt, mode) => {
    const r = ev.evaluate({ program, variables, formats: [fmt], mode });
    const st = r.steps[r.result];
    const div = document.createElement('div');
    div.innerHTML = bv.binaryOperationHtml(st, r.steps, fmt, st.fmt[fmt.id], mode);
    return div;
  };

  it('directed rounding: the subnormal bound is a whole spacing and the legend does not say "nearest"', () => {
    const text = html('a * b', [{ name: 'a', value: '0x1.f8p-20' }, { name: 'b', value: '0x1p-5' }], F.binary16, 'RZ').textContent;
    expect(text).toContain('|η| < 2⁻²⁴');
    expect(text).toContain('less than one subnormal spacing (directed rounding)');
    expect(text).toContain('RZ = rounding toward zero');
    expect(text).toContain('the neighbouring number in the direction of the rounding mode');
    const n = html('a * b', [{ name: 'a', value: '0x1p-20' }, { name: 'b', value: '0x1.8p-6' }], F.binary16, 'RNE').textContent;
    expect(n).toContain('|η| ≤ 2⁻²⁵');
    expect(n).toContain('maps a real number to the nearest number');
  });

  it('the aligned view draws the binary point near 1 and says where it is when it is far away', () => {
    const near = html('a + b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }], F.binary64, 'RNE');
    expect(near.querySelectorAll('.bin-point').length).toBeGreaterThan(0);
    expect(near.textContent).toContain('the red point is the binary point');
    const whole = html('a + b', [{ name: 'a', value: '96' }, { name: 'b', value: '33' }], F.binary16, 'RNE');
    expect(whole.querySelectorAll('.bin-point').length).toBeGreaterThan(0);
    const far = html('a + b', [{ name: 'a', value: '1e-30' }, { name: 'b', value: '2e-30' }], F.binary64, 'RNE');
    expect(far.querySelectorAll('.bin-point').length).toBe(0);
    expect(far.textContent).toContain('the binary point (between 2⁰ and 2⁻¹) lies outside this range');
  });

  it('states the guard / sticky rule for every case of rounding to nearest and for directed rounding', () => {
    const above = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1.8p-53' }], F.binary64, 'RNE').textContent;
    expect(above).toContain('Guard bit 1 and sticky bit 1');
    const below = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1p-55' }], F.binary64, 'RNE').textContent;
    expect(below).toContain('Guard bit 0');
    const tieKeep = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1p-53' }], F.binary64, 'RNE').textContent;
    expect(tieKeep).toContain('the last kept bit is 0, so the kept bits stay as they are');
    const away = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1p-53' }], F.binary64, 'RNA').textContent;
    expect(away).toContain('ties away from zero always increase the magnitude');
    const directed = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1p-55' }], F.binary64, 'RU').textContent;
    expect(directed).toContain('In directed rounding the guard and sticky bits only show');
  });

  it('calls the aligned view exact at full width and relates guard / sticky to the hardware G/R/S bits', () => {
    const add = html('a + b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.2' }], F.binary64, 'RNE');
    expect(add.textContent).toContain('aligned to a common exponent (exact, at full width)');
    expect(add.textContent).not.toContain('as the adder does it');
    expect(add.querySelector('.bin-hw').textContent).toContain('three extra bits beyond p (guard, round and sticky)');
    expect(add.querySelector('.bin-grs').textContent).toContain('the first bit beyond p plays the role of the guard bit');
    // A product has no aligned view, so no adder note, but the guard / sticky note is still there.
    const mul = html('a * b', [{ name: 'a', value: '0.1' }, { name: 'b', value: '0.3' }], F.binary64, 'RNE');
    expect(mul.querySelector('.bin-hw')).toBeNull();
    expect(mul.querySelector('.bin-grs')).toBeTruthy();
    // outside + and − the note is short: no adder argument, but the last kept bit and the sign are named
    expect(mul.querySelector('.bin-grs').textContent).not.toContain('Hardware textbooks');
    expect(mul.querySelector('.bin-grs').textContent).toContain('last kept bit');
    expect(add.querySelector('.bin-grs').textContent).toContain('also looks at the last kept bit');
    // An exact step makes no rounding decision and needs no note.
    const exactStep = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '2' }], F.binary64, 'RNE');
    expect(exactStep.querySelector('.bin-grs')).toBeNull();
  });

  it('a sticky 1 beyond the shown bits is shown with its position', () => {
    const add = html('a + b', [{ name: 'a', value: '1' }, { name: 'b', value: '0x1p-80' }], F.binary64, 'RNE');
    expect(add.querySelector('.bin-exact .bin-sticky.bin-more').textContent).toBe('…1');
    expect(add.textContent).toContain('next 1 at 2⁻⁸⁰');
    const mul = html('a * b', [{ name: 'a', value: '0x1.0000000000001p0' }, { name: 'b', value: '0x1.0000000001p0' }], F.binary64, 'RNE');
    expect(mul.textContent).toContain('next 1 at 2⁻⁹²');
    expect(mul.textContent).toContain('sticky bit 1');
  });
});

describe('diagnosis wording, helpers, saved state and the step table', () => {
  const compare = () => document.querySelector('.view-tab[data-view=compare]').click();
  const text = (id) => document.getElementById(id).textContent;
  const setProgram = async (program) => {
    const prog = document.getElementById('program');
    prog.value = program;
    prog.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
  };

  it('accumulated rounding: the distance to the best result is counted in representable numbers, and correct digits are defined', () => {
    compare();
    pick('loop');
    const diag = text('diagnosis');
    expect(diag).toContain('The true value rounded once would be 1, but the result is 0.9999999999999999: its neighbour');
    expect(diag).not.toMatch(/0\.50 ulp from the true value/);
    expect(diag).toContain('0.9999999999999999 agrees with 1 to about 16 digits');
    expect(document.querySelector('#diagnosis .diag-digits').getAttribute('title')).toContain('−log₁₀ of the relative error');
  });

  it('Kahan summation: exact by design, and the compensation term is explained', () => {
    compare();
    pick('kahansum');
    const groups = [...document.querySelectorAll('#diagnosis .diag-group')];
    const kahan = groups.find((g) => g.querySelector('summary .mono').textContent === 'kahan, k, t');
    expect(kahan.textContent).toContain('not luck but the purpose of the algorithm');
    expect(kahan.textContent).not.toContain('that is luck');
    const c = groups.find((g) => g.querySelector('summary .mono').textContent.split(', ').includes('c'));
    expect(c.querySelector('.diag-helper').textContent).toContain('compensation term');
    // the note belongs to the example: an edited program gets none
  });

  it('assoc: float’s exact left = (a + b) + c is called exact by construction, not luck', () => {
    compare();
    pick('assoc');
    const left = [...document.querySelectorAll('#diagnosis .diag-group')].find((g) => g.querySelector('summary .mono').textContent === 'left');
    expect(left.textContent).toMatch(/float: exact result, although earlier values were rounded .*cancel by construction/);
    expect(left.textContent).not.toContain('that is luck');
  });

  it('a value in the step table may wrap only before its exponent', () => {
    compare();
    pick('sum');
    const v = document.querySelector('.vcell[data-step="4"][data-fmt="binary64"] .v');
    expect(v.innerHTML).toMatch(/5\.551115123125783<wbr>e/);
  });

  it('a saved example id restores the current version of that example; an unknown id becomes Custom', async () => {
    const { withCurrentExample } = await import('../src/main.js');
    const old = withCurrentExample({ example: 'fma', program: 'plain = a*a - p', variables: [{ name: 'a', value: '0.1' }] });
    const fma = (await import('../src/ui/examples.js')).EXAMPLES.find((e) => e.id === 'fma');
    expect(old.program).toBe(fma.program);
    expect(old.variables).toEqual(fma.variables);
    const gone = withCurrentExample({ example: 'harmonic', program: 's = 1', variables: [] });
    expect(gone.example).toBe('');
    expect(gone.program).toBe('s = 1');
    const custom = withCurrentExample({ example: '', program: 'x + 1', variables: [] });
    expect(custom.program).toBe('x + 1');
  });

  it('a true value beyond the reference range is not called exact, 0 or ∞', async () => {
    compare();
    pick('sum');
    await setProgram('y = exp(-1000000)\nz = exp(1000000)');
    const diag = text('diagnosis');
    expect(diag).toContain('nonzero but smaller than 10^−100000');
    expect(diag).toContain('finite but larger than 10^100000');
    expect(diag).not.toContain('and so is the true value');
    expect(diag).not.toMatch(/: exact result/);
    expect(text('steps')).toContain('0 < |x| < 10^−100000');
  });
});
