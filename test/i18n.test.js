// Czech / English parity: every text exists in both languages and every key the
// code uses is defined.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DICT } from '../src/i18n.js';
import { ENGINE_MESSAGES } from '../src/engine/messages.js';
import { EXAMPLES } from '../src/ui/examples.js';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe('cs/en parity', () => {
  it('UI dictionary has the same keys and placeholders in both languages', () => {
    expect(Object.keys(DICT.cs).sort()).toEqual(Object.keys(DICT.en).sort());
    for (const k of Object.keys(DICT.en)) {
      expect(placeholders(DICT.cs[k]), k).toEqual(placeholders(DICT.en[k]));
      expect(DICT.cs[k].trim().length, k).toBeGreaterThan(0);
    }
  });

  it('engine messages have the same keys and placeholders', () => {
    expect(Object.keys(ENGINE_MESSAGES.cs).sort()).toEqual(Object.keys(ENGINE_MESSAGES.en).sort());
    for (const k of Object.keys(ENGINE_MESSAGES.en)) {
      expect(placeholders(ENGINE_MESSAGES.cs[k]), k).toEqual(placeholders(ENGINE_MESSAGES.en[k]));
    }
  });

  it('examples are described in both languages', () => {
    for (const e of EXAMPLES) {
      expect(e.title.en && e.title.cs && e.blurb.en && e.blurb.cs, e.id).toBeTruthy();
    }
  });

  it('every key used in the code is defined', () => {
    const files = ['src/main.js', 'index.html', ...readdirSync(join(root, 'src/ui')).map((f) => 'src/ui/' + f)];
    const missing = [];
    for (const f of files) {
      const src = read(f);
      // Keys ending with '.' are dynamic prefixes such as t('mode.' + id); those are covered by the parity test.
      for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) if (!m[1].endsWith('.') && !(m[1] in DICT.en)) missing.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/data-i18n(?:-html|-title|-aria|-placeholder)?="([\w.]+)"/g)) if (!(m[1] in DICT.en)) missing.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/data-s="([\w.]+)"/g)) if (!(('sweep.' + m[1]) in DICT.en)) missing.push(`${f}: sweep.${m[1]}`);
    }
    // Explanation codes and causes produced by the engine
    const ex = read('src/engine/explain.js');
    for (const m of ex.matchAll(/push\('([\w.]+)'/g)) if (!(m[1] in DICT.en)) missing.push('explain: ' + m[1]);
    for (const m of ex.matchAll(/key\('([\w.]+)'\)/g)) if (!(m[1] in DICT.en)) missing.push('explain key: ' + m[1]);
    for (const m of ex.matchAll(/setCause\('(\w+)'/g)) {
      if (!(('cause.' + m[1]) in DICT.en)) missing.push('cause: ' + m[1]);
      if (!(('cause.' + m[1] + '.tip') in DICT.en)) missing.push('cause tip: ' + m[1]);
    }
    for (const m of ex.matchAll(/'(budget\.\w+)'/g)) if (!(m[1] in DICT.en)) missing.push('budget: ' + m[1]);
    // Engine error codes
    for (const f of ['src/engine/parser.js', 'src/engine/evaluator.js', 'src/engine/ieee.js', 'src/engine/sweep.js']) {
      for (const m of read(f).matchAll(/EngineError\('([\w.]+)'/g)) if (!(m[1] in ENGINE_MESSAGES.en)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
