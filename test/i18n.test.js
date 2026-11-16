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
      expect(e.lesson?.en && e.lesson?.cs && e.look?.en && e.look?.cs, `${e.id}: lesson and look`).toBeTruthy();
      expect(DICT.en['exgroup.' + e.group] && DICT.cs['exgroup.' + e.group], `${e.id}: group ${e.group}`).toBeTruthy();
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
    // Every quoted key-like literal ('prefix.name' with a prefix the dictionary uses) must be a key,
    // wherever it stands: push('…'), a ternary push(c ? 'a' : 'b'), const code = …, key('…'), t(c ? 'a' : 'b').
    const prefixes = new Set(Object.keys(DICT.en).map((k) => k.split('.')[0]));
    const keyLiterals = (src) => [...src.matchAll(/'([a-zA-Z]+)\.([\w.]*\w)'/g)].filter((m) => prefixes.has(m[1])).map((m) => `${m[1]}.${m[2]}`);
    const ex = read('src/engine/explain.js');
    for (const f of ['src/engine/explain.js', 'src/main.js', ...readdirSync(join(root, 'src/ui')).map((x) => 'src/ui/' + x)]) {
      for (const k of keyLiterals(read(f))) if (!(k in DICT.en)) missing.push(`${f}: ${k}`);
    }
    // Causes: setCause('x', …) and setCause(c ? 'x' : 'y', …) — the literal results of the first argument
    for (const m of ex.matchAll(/setCause\(([^,]+),/g)) {
      for (const c of m[1].matchAll(/(?:^|[?:])\s*'(\w+)'/g)) {
        if (!(('cause.' + c[1]) in DICT.en)) missing.push('cause: ' + c[1]);
        if (!(('cause.' + c[1] + '.tip') in DICT.en)) missing.push('cause tip: ' + c[1]);
      }
    }
    // Engine error codes
    for (const f of ['src/engine/parser.js', 'src/engine/evaluator.js', 'src/engine/ieee.js', 'src/engine/sweep.js', 'src/engine/real.js', 'src/engine/fpfunc.js']) {
      for (const m of read(f).matchAll(/EngineError\('([\w.]+)'/g)) if (!(m[1] in ENGINE_MESSAGES.en)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('the key check also sees codes chosen by a ternary or a variable', () => {
    // guards the check above: a key that exists only inside a ternary must be found
    const prefixes = new Set(Object.keys(DICT.en).map((k) => k.split('.')[0]));
    const src = "push(inherited ? 'op.exactZeroLost' : 'op.noSuchCode', {}); const code = x ? 'fn.sqrt' : 'fn.nope';";
    const found = [...src.matchAll(/'([a-zA-Z]+)\.([\w.]*\w)'/g)].filter((m) => prefixes.has(m[1])).map((m) => `${m[1]}.${m[2]}`);
    expect(found).toEqual(['op.exactZeroLost', 'op.noSuchCode', 'fn.sqrt', 'fn.nope']);
    expect(found.filter((k) => !(k in DICT.en))).toEqual(['op.noSuchCode', 'fn.nope']);
  });
});

import { BIB, EXAMPLE_REFS } from '../src/ui/references.js';

describe('example references', () => {
  it('point to existing bibliography entries with a link, for existing examples', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id));
    for (const [ex, refs] of Object.entries(EXAMPLE_REFS)) {
      expect(ids.has(ex), ex).toBe(true);
      for (const r of refs) {
        const b = BIB[r.id];
        expect(b, `${ex}: ${r.id}`).toBeTruthy();
        expect(b.doi || b.url, r.id).toBeTruthy();
        expect(['origin', 'version', 'analysis', 'background']).toContain(r.role);
        expect(DICT.en['refs.' + r.role] && DICT.cs['refs.' + r.role]).toBeTruthy();
        if (r.note) expect(r.note.en && r.note.cs, `${ex}: ${r.id} note`).toBeTruthy();
      }
    }
  });
});
