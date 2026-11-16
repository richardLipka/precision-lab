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
});
