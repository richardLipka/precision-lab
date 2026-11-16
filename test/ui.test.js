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
});
