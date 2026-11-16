// "Rearrange (AST)" view: shows the expression tree of a statement, offers only
// meaning-preserving rewrites for the selected node and compares the rounded
// results before and after.

import { evaluate } from '../engine/evaluator.js';
import { shortestDecimal } from '../engine/ieee.js';
import { compareToExact, correctDigits, qualityOf } from '../engine/metrics.js';
import {
  statementsOf, walk, getAt, print, applicableRules, applyRule, replaceExpression, sameMeaning,
} from '../engine/ast.js';
import { escapeHtml } from './chart.js';
import { fmtName, trueText, digitsText, QUALITY_ICON, badgeLegendHtml } from './detail.js';
import { t, errorText } from '../i18n.js';

const OP_LABEL = { '+': '+', '-': '−', '*': '×', '/': '÷', '==': '==', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

/** Correct digits as every view shows them (capped at the format's capacity; see metrics.js). */
const digitsOf = (v, x, fmt) => correctDigits(compareToExact(v, x, fmt), fmt);

function badge(dg) {
  if (dg.shown === Infinity) return `<span class="badge q-exact">${t('badge.exact')}</span>`;
  if (dg.shown == null) return `<span class="badge q-bad" title="${escapeHtml(t('badge.mismatchTitle'))}">${t('badge.mismatch')}</span>`;
  const title = dg.capped ? ` title="${escapeHtml(digitsText(dg))}"` : '';
  const q = qualityOf(dg.shown, dg.full);
  return `<span class="badge ${q}"${title}>${QUALITY_ICON[q] || ''}${t('badge.digits', { d: dg.shown.toFixed(1) })}</span>`;
}

function nodeLabel(n) {
  switch (n.type) {
    case 'bin': return OP_LABEL[n.op];
    case 'neg': return '−( )';
    case 'pow': return `^${n.n}`;
    case 'call': return `${n.name}( )`;
    case 'num': return n.text;
    case 'var': return n.name;
    default: return '?';
  }
}

export function createRewritePanel(host, api) {
  let notice = null;
  let error = null;
  let cache = null; // { key, before, after }

  const st = () => api.state();

  host.innerHTML = `
    <div class="panel">
      <div class="section-title"><h2 data-r="title"></h2></div>
      <p class="muted small" data-r="intro"></p>
      <div class="rw-toolbar">
        <label class="inline"><span data-r="statement"></span> <select id="rw-stmt"></select></label>
        <label class="inline"><span data-r="digitsIn"></span> <select id="rw-fmt"></select></label>
        <button class="btn small" id="rw-undo" data-r="undo"></button>
        <button class="btn small" id="rw-reset" data-r="reset"></button>
        <button class="btn small primary" id="rw-use" data-r="use"></button>
      </div>
      <div id="rw-notice" class="notice small" hidden></div>
      <div id="rw-error" class="error" role="alert" hidden></div>
    </div>
    <div class="rw-grid">
      <div class="panel"><div class="section-title"><h2 data-r="tree"></h2></div><div id="rw-tree" class="ast-tree" role="tree"></div></div>
      <div class="panel"><div class="section-title"><h2 data-r="rules"></h2></div><div id="rw-node"></div><div id="rw-rules" class="rw-rules"></div></div>
    </div>
    <div class="panel"><div class="section-title"><h2 data-r="compare"></h2></div><div class="table-scroll"><table class="steps rw-compare" id="rw-compare"></table></div><div id="rw-legend"></div></div>
    <div class="panel"><div class="section-title"><h2 data-r="history"></h2></div><ol id="rw-history" class="rw-history"></ol>
      <div class="rw-programs"><div><h3 data-r="original"></h3><pre id="rw-before" class="mono"></pre></div><div><h3 data-r="rearranged"></h3><pre id="rw-after" class="mono"></pre></div></div></div>`;

  const $ = (id) => host.querySelector('#' + id);

  $('rw-stmt').addEventListener('change', (e) => { st().stmt = Number(e.target.value); st().path = []; api.save(); render(); });
  $('rw-fmt').addEventListener('change', (e) => { st().fmt = e.target.value; api.save(); render(); });
  $('rw-undo').addEventListener('click', () => {
    const s = st();
    const last = s.history.pop();
    if (last) { s.current = last.prev; s.stmt = last.stmt; s.path = last.path; }
    error = null;
    api.save();
    render();
  });
  $('rw-reset').addEventListener('click', () => {
    const s = st();
    s.current = s.base;
    s.history = [];
    s.path = [];
    error = null;
    api.save();
    render();
  });
  $('rw-use').addEventListener('click', () => {
    api.useProgram(st().current);
  });

  /** Make sure the rearrangement starts from the program currently in the editor. */
  function sync() {
    const s = st();
    const program = api.config().program;
    if (s.base !== program) {
      if (s.history.length) notice = t('rw.restarted');
      s.base = program;
      s.current = program;
      s.history = [];
      s.path = [];
      s.stmt = 0;
      api.save();
    }
  }

  function evaluateBoth() {
    const cfg = api.config();
    const formats = api.formats();
    const key = JSON.stringify([st().base, st().current, cfg.variables, cfg.mode, cfg.refDigits, formats.map((f) => [f.id, f.p, f.expBits])]);
    if (cache?.key === key) return cache;
    const run = (program) => evaluate({ variables: cfg.variables, program, formats, mode: cfg.mode, refDigits: cfg.refDigits });
    cache = { key, before: run(st().base), after: run(st().current), formats };
    return cache;
  }

  function render() {
    host.querySelectorAll('[data-r]').forEach((el) => { el.textContent = t('rw.' + el.dataset.r); });
    sync();
    const s = st();
    $('rw-notice').hidden = !notice;
    if (notice) $('rw-notice').textContent = notice;
    $('rw-error').hidden = !error;
    if (error) $('rw-error').textContent = error;
    $('rw-undo').disabled = !s.history.length;
    $('rw-reset').disabled = !s.history.length;
    $('rw-use').disabled = !s.history.length;

    let stmts;
    let ev;
    try {
      stmts = statementsOf(s.current);
      ev = evaluateBoth();
    } catch (e) {
      $('rw-tree').innerHTML = `<p class="error">${escapeHtml(errorText(e))}</p>`;
      $('rw-rules').innerHTML = '';
      $('rw-compare').innerHTML = '';
      return;
    }
    if (!stmts.length) {
      $('rw-stmt').innerHTML = '';
      $('rw-tree').innerHTML = `<p class="muted">${t('rw.noStatements')}</p>`;
      $('rw-rules').innerHTML = '';
      $('rw-node').innerHTML = '';
      renderCompare(ev);
      renderHistory();
      return;
    }
    if (s.stmt >= stmts.length) s.stmt = 0;
    $('rw-stmt').innerHTML = stmts.map((x, i) => `<option value="${i}">${'· '.repeat(x.depth)}${escapeHtml(x.text.length > 70 ? x.text.slice(0, 68) + '…' : x.text)}</option>`).join('');
    $('rw-stmt').value = String(s.stmt);
    const formats = ev.formats;
    if (!formats.some((f) => f.id === s.fmt)) s.fmt = formats[0]?.id;
    $('rw-fmt').innerHTML = formats.map((f) => `<option value="${f.id}">${escapeHtml(f.short)}</option>`).join('');
    if (s.fmt) $('rw-fmt').value = s.fmt;
    const fmt = formats.find((f) => f.id === s.fmt);

    const root = stmts[s.stmt].expr;
    let sel;
    try { sel = getAt(root, s.path); } catch { s.path = []; sel = root; }
    if (!sel) { s.path = []; sel = root; }
    renderTree(root, ev.after, fmt);
    renderRules(root, sel, stmts);
    renderCompare(ev);
    renderHistory();
  }

  function renderTree(root, res, fmt) {
    const s = st();
    const rows = walk(root).map(({ node, path }) => {
      const id = res.nodeSteps[`${node.start}:${node.end}`];
      const step = id != null ? res.steps[id] : null;
      let val = '';
      if (step && fmt) {
        const v = step.fmt[fmt.id].value;
        val = `<span class="ast-val mono">${escapeHtml(shortestDecimal(v, fmt))}</span>${badge(digitsOf(v, step.exact, fmt))}`;
      }
      const selected = path.join('.') === s.path.join('.');
      const text = print(node);
      const leaf = node.type === 'num' || node.type === 'var';
      const ruleCount = applicableRules(node).length;
      return `<div class="ast-row ${selected ? 'selected' : ''}" role="treeitem" aria-selected="${selected}" tabindex="0" data-path="${path.join('.')}" style="--depth:${path.length}">
        <span class="ast-chip ${leaf ? 'leaf' : 'op'}">${escapeHtml(nodeLabel(node))}</span>
        <span class="ast-text mono" title="${escapeHtml(text)}">${escapeHtml(text.length > 60 ? text.slice(0, 58) + '…' : text)}</span>
        ${ruleCount ? `<span class="ast-rules" title="${escapeHtml(t('rw.ruleCount', { n: ruleCount }))}">⇄ ${ruleCount}</span>` : ''}
        <span class="ast-right">${val}</span></div>`;
    });
    $('rw-tree').innerHTML = rows.join('');
    $('rw-tree').querySelectorAll('.ast-row').forEach((row) => {
      const go = () => {
        st().path = row.dataset.path ? row.dataset.path.split('.').map(Number) : [];
        api.save();
        render();
      };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function renderRules(root, sel) {
    const s = st();
    $('rw-node').innerHTML = `<div class="kv"><span>${t('rw.selected')}</span><span class="mono long">${escapeHtml(print(sel))}</span></div>`;
    const rules = applicableRules(sel);
    if (!rules.length) {
      $('rw-rules').innerHTML = `<p class="muted small">${t('rw.noRules')}</p>`;
      return;
    }
    $('rw-rules').innerHTML = rules.map((r) => {
      let after = '';
      try { after = print(r.apply(sel)); } catch { after = '?'; }
      const short = (x) => (x.length > 70 ? x.slice(0, 68) + '…' : x);
      return `<button class="rw-rule" data-rule="${r.id}">
        <span class="rw-rule-name">${escapeHtml(t('rw.' + r.id))}</span>
        <span class="rw-rule-preview mono">${escapeHtml(short(print(sel)))} <b>→</b> ${escapeHtml(short(after))}</span>
        <span class="rw-rule-desc muted small">${escapeHtml(t('rw.' + r.id + '.desc'))}</span></button>`;
    }).join('');
    $('rw-rules').querySelectorAll('.rw-rule').forEach((b) => b.addEventListener('click', () => apply(root, b.dataset.rule)));
  }

  function apply(root, ruleId) {
    const s = st();
    notice = null;
    error = null;
    let next;
    try {
      next = replaceExpression(s.current, s.stmt, applyRule(root, s.path, ruleId));
    } catch (e) {
      error = errorText(e);
      render();
      return;
    }
    let check;
    try {
      check = sameMeaning(s.current, next, api.config().variables);
    } catch (e) {
      error = errorText(e);
      render();
      return;
    }
    if (!check.ok) {
      error = t('rw.changed', { names: check.differences.join(', ') });
      render();
      return;
    }
    s.history.push({ rule: ruleId, stmt: s.stmt, path: s.path.slice(), prev: s.current, text: print(getAt(root, s.path)) });
    s.current = next;
    api.save();
    render();
  }

  function renderCompare(ev) {
    const { before, after, formats } = ev;
    const names = [...new Set([...Object.keys(before.env), ...Object.keys(after.env)])]
      .filter((n) => before.steps[before.env[n]]?.kind !== 'input');
    const groups = names.map((n) => ({ label: n, a: before.steps[before.env[n]], b: after.steps[after.env[n]] }));
    const ra = before.steps[before.result];
    const rb = after.steps[after.result];
    if (ra && rb && !names.some((n) => before.env[n] === before.result)) groups.push({ label: t('summary.result'), a: ra, b: rb });
    const head = `<thead><tr><th></th><th>${t('rw.format')}</th><th>${t('rw.before')}</th><th>${t('rw.after')}</th><th>${t('rw.change')}</th></tr></thead>`;
    const body = groups.filter((g) => g.a && g.b).map((g) => {
      const rows = formats.map((f, i) => {
        const va = g.a.fmt[f.id].value;
        const vb = g.b.fmt[f.id].value;
        const ga = digitsOf(va, g.a.exact, f);
        const gb = digitsOf(vb, g.b.exact, f);
        // compare the shown figures (not comparable = 0 digits), as everywhere else
        const da = ga.shown ?? 0;
        const db = gb.shown ?? 0;
        let change;
        if (da === db || (Math.abs(da - db) < 0.05)) change = `<span class="muted">${t('rw.same')}</span>`;
        else if (db > da) change = `<span class="good">▲ ${escapeHtml(t('rw.better', { d: db === Infinity ? '∞' : (db - da).toFixed(1) }))}</span>`;
        else change = `<span class="bad">▼ ${escapeHtml(t('rw.worse', { d: da === Infinity ? '∞' : (da - db).toFixed(1) }))}</span>`;
        return `<tr>${i === 0 ? `<td rowspan="${formats.length}" class="rw-var"><b class="mono">${escapeHtml(g.label)}</b><div class="muted small">${escapeHtml(t('rw.trueValue'))}: <span class="mono">${escapeHtml(trueText(g.b.exact, 18))}</span></div></td>` : ''}
          <td>${escapeHtml(fmtName(f))}</td>
          <td><span class="mono">${escapeHtml(shortestDecimal(va, f))}</span> ${badge(ga)}</td>
          <td><span class="mono">${escapeHtml(shortestDecimal(vb, f))}</span> ${badge(gb)}</td>
          <td>${change}</td></tr>`;
      }).join('');
      return rows;
    }).join('');
    $('rw-compare').innerHTML = formats.length ? head + `<tbody>${body}</tbody>` : `<tbody><tr><td class="muted">${t('rw.noFormats')}</td></tr></tbody>`;
    $('rw-legend').innerHTML = formats.length ? badgeLegendHtml() : '';
  }

  function renderHistory() {
    const s = st();
    $('rw-history').innerHTML = s.history.length
      ? s.history.map((h) => `<li><b>${escapeHtml(t('rw.' + h.rule))}</b> <span class="mono muted">${escapeHtml(h.text.length > 60 ? h.text.slice(0, 58) + '…' : h.text)}</span></li>`).join('')
      : `<li class="muted">${t('rw.historyEmpty')}</li>`;
    $('rw-before').textContent = s.base;
    const a = s.base.split('\n');
    $('rw-after').innerHTML = s.current.split('\n').map((line, i) => (line !== a[i] ? `<mark>${escapeHtml(line)}</mark>` : escapeHtml(line))).join('\n');
  }

  return {
    render: () => { render(); },
    invalidate: () => { cache = null; },
    clearNotice: () => { notice = null; },
  };
}
