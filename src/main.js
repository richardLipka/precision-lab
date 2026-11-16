import './style.css';
import { evaluate } from './engine/evaluator.js';
import { FORMATS, ROUNDING_MODES, makeFormat, shortestDecimal, exactShort } from './engine/ieee.js';
import { compareToExact } from './engine/metrics.js';
import { explainStep, diagnose } from './engine/explain.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './ui/examples.js';
import { renderLineChart, escapeHtml } from './ui/chart.js';
import { renderDetail, fmtErr, fmtName, causeChip, trueText } from './ui/detail.js';
import { createSweepPanel } from './ui/sweep.js';
import { createRewritePanel } from './ui/rewrite.js';
import { t, getLang, setLang, onLangChange, applyStatic, errorText } from './i18n.js';

// Series colour follows the format, never its position among the selected ones.
const FORMAT_COLOR = {
  binary32: 'var(--series-1)',
  binary64: 'var(--series-2)',
  x87: 'var(--series-3)',
  binary128: 'var(--series-4)',
  binary16: 'var(--series-5)',
  bfloat16: 'var(--series-6)',
  custom: 'var(--series-7)',
};

const PAGE = 150;
const STORAGE_KEY = 'precision-lab-state-v1';

const $ = (id) => document.getElementById(id);

const defaultState = () => {
  const ex = EXAMPLES.find((e) => e.id === DEFAULT_EXAMPLE);
  return {
    example: ex.id,
    variables: ex.variables.map((v) => ({ ...v })),
    program: ex.program,
    formats: { binary16: false, bfloat16: false, binary32: true, binary64: true, x87: true, binary128: false },
    custom: { on: false, p: 100, expBits: 15, unbounded: true },
    mode: 'RNE',
    showConst: true,
    refDigits: 60,
    view: 'compare',
    sweep: { spec: '1-200', unbounded: true, expBits: 15, measure: 'abs', lines: 10 },
    rewrite: { base: '', current: '', history: [], stmt: 0, path: [], fmt: null },
  };
};

let state = loadState();
let result = null;
let lastError = null;
let sel = null;
let page = 0;
let cache = new Map();
let sweepPanel = null;
let rewritePanel = null;

// ---------------------------------------------------------------------------
// Persistence: URL hash (shareable) > localStorage > default
// ---------------------------------------------------------------------------

function encodeState(s) {
  const json = JSON.stringify(s);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

function merge(base, extra) {
  return {
    ...base,
    ...extra,
    sweep: { ...base.sweep, ...(extra?.sweep || {}) },
    custom: { ...base.custom, ...(extra?.custom || {}) },
    rewrite: { ...base.rewrite, ...(extra?.rewrite || {}) },
  };
}

function loadState() {
  const base = defaultState();
  try {
    if (location.hash.length > 1) return merge(base, decodeState(location.hash.slice(1)));
  } catch { /* ignore a malformed link */ }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return merge(base, JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return base;
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function initControls() {
  const exSel = $('example');
  exSel.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === exSel.value);
    if (!ex) return;
    state.example = ex.id;
    state.variables = ex.variables.map((v) => ({ ...v }));
    state.program = ex.program;
    syncInputs();
    run(true);
  });

  $('formats').addEventListener('change', (e) => {
    const id = e.target.dataset.fmt;
    if (id) { state.formats[id] = e.target.checked; run(); }
  });

  $('mode').addEventListener('change', (e) => { state.mode = e.target.value; run(); });
  $('ref-digits').addEventListener('change', (e) => {
    state.refDigits = Math.min(1000, Math.max(20, parseInt(e.target.value, 10) || 60));
    e.target.value = state.refDigits;
    run();
  });
  $('show-const').addEventListener('change', (e) => { state.showConst = e.target.checked; page = 0; render(); saveState(); });

  const customChanged = () => {
    state.custom = {
      on: $('custom-on').checked,
      p: parseInt($('custom-p').value, 10) || 100,
      expBits: parseInt($('custom-e').value, 10) || 15,
      unbounded: $('custom-unb').checked,
    };
    $('custom-e').disabled = state.custom.unbounded;
    run();
  };
  ['custom-on', 'custom-p', 'custom-e', 'custom-unb'].forEach((id) => $(id).addEventListener('change', customChanged));

  let timer;
  $('program').addEventListener('input', () => {
    state.program = $('program').value;
    markCustom();
    clearTimeout(timer);
    timer = setTimeout(() => run(true), 350);
  });
  $('program').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const tEl = e.target;
      tEl.setRangeText('  ', tEl.selectionStart, tEl.selectionEnd, 'end');
      tEl.dispatchEvent(new Event('input'));
    }
  });

  $('add-var').addEventListener('click', () => {
    const used = new Set(state.variables.map((v) => v.name));
    const name = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !used.has(c)) || 'v' + state.variables.length;
    state.variables.push({ name, value: '1' });
    markCustom();
    renderVars();
    run(true);
    const inputs = $('vars').querySelectorAll('input.var-value');
    inputs[inputs.length - 1]?.focus();
  });

  $('share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#${encodeState(state)}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash($('share'), t('btn.linkCopied'));
    } catch {
      flash($('share'), t('btn.linkInBar'));
    }
  });

  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('precision-lab-theme', root.dataset.theme); } catch { /* ignore */ }
    render();
    sweepPanel?.redraw();
  });
  try {
    const th = localStorage.getItem('precision-lab-theme');
    if (th) document.documentElement.dataset.theme = th;
  } catch { /* ignore */ }

  $('lang').addEventListener('click', () => setLang(getLang() === 'cs' ? 'en' : 'cs'));
  onLangChange(() => {
    applyTexts();
    syncInputs();
    renderError();
    render();
    sweepPanel?.relang();
    if (state.view === 'rewrite') rewritePanel?.render();
  });

  document.querySelectorAll('.view-tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { renderChartPanel(); sweepPanel?.redraw(); }, 150);
  });
}

function setView(view) {
  state.view = view;
  saveState();
  document.querySelectorAll('.view-tab').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $('view-compare').hidden = view !== 'compare';
  $('view-sweep').hidden = view !== 'sweep';
  $('view-rewrite').hidden = view !== 'rewrite';
  if (view === 'compare') renderChartPanel();
  else if (view === 'sweep') sweepPanel?.redraw();
  else rewritePanel?.render();
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1500);
}

function markCustom() {
  state.example = '';
  $('example').value = '';
  $('example-blurb').textContent = '';
}

/** Texts that are not tied to the current result. */
function applyTexts() {
  document.documentElement.lang = getLang();
  applyStatic();
  const lang = getLang();
  $('example').innerHTML = `<option value="">${escapeHtml(t('setup.custom'))}</option>` + EXAMPLES.map((e) => `<option value="${e.id}">${escapeHtml(e.title[lang])}</option>`).join('');
  $('formats').innerHTML = FORMATS.map((f) => `
    <label class="check fmt-check"><input type="checkbox" data-fmt="${f.id}" />
      <span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span>${escapeHtml(fmtName(f))}
      <span class="muted small">p=${f.p}</span></label>`).join('');
  $('mode').innerHTML = ROUNDING_MODES.map((m) => `<option value="${m.id}">${escapeHtml(t('mode.' + m.id))}</option>`).join('');
}

function syncInputs() {
  $('example').value = state.example || '';
  const ex = EXAMPLES.find((e) => e.id === state.example);
  $('example-blurb').textContent = ex ? ex.blurb[getLang()] : '';
  $('program').value = state.program;
  $('mode').value = state.mode;
  $('show-const').checked = state.showConst;
  $('ref-digits').value = state.refDigits ?? 60;
  for (const cb of $('formats').querySelectorAll('input[data-fmt]')) cb.checked = !!state.formats[cb.dataset.fmt];
  $('custom-on').checked = state.custom.on;
  $('custom-p').value = state.custom.p;
  $('custom-e').value = state.custom.expBits;
  $('custom-unb').checked = state.custom.unbounded;
  $('custom-e').disabled = state.custom.unbounded;
  renderVars();
}

function renderVars() {
  const tb = $('vars').querySelector('tbody');
  tb.innerHTML = state.variables.map((v, i) => `<tr>
    <td><input class="var-name mono" data-i="${i}" value="${escapeHtml(v.name)}" aria-label="${escapeHtml(t('setup.name'))}" /></td>
    <td><input class="var-value mono" data-i="${i}" value="${escapeHtml(v.value)}" aria-label="${escapeHtml(t('setup.valueOf', { name: v.name }))}" /></td>
    <td><button class="btn icon" data-del="${i}" title="${escapeHtml(t('setup.remove', { name: v.name }))}" aria-label="${escapeHtml(t('setup.remove', { name: v.name }))}">×</button></td></tr>`).join('')
    || `<tr><td colspan="3" class="muted small">${escapeHtml(t('setup.noVars'))}</td></tr>`;
  let timer;
  tb.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
    const i = Number(inp.dataset.i);
    state.variables[i][inp.classList.contains('var-name') ? 'name' : 'value'] = inp.value;
    markCustom();
    clearTimeout(timer);
    timer = setTimeout(() => run(true), 350);
  }));
  tb.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    state.variables.splice(Number(b.dataset.del), 1);
    markCustom();
    renderVars();
    run(true);
  }));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function selectedFormats() {
  const list = FORMATS.filter((f) => state.formats[f.id]);
  if (state.custom.on) {
    const p = Math.min(100000, Math.max(1, state.custom.p));
    const e = state.custom.unbounded ? null : Math.min(30, Math.max(2, state.custom.expBits));
    list.push(makeFormat({ id: 'custom', name: `custom p=${p}`, short: `p=${p}`, p, expBits: e }));
  }
  return list;
}

function renderError() {
  const err = $('error');
  err.hidden = !lastError;
  if (lastError) err.textContent = errorText(lastError);
  $('program').classList.toggle('has-error', !!lastError);
}

function run(resetSel = false) {
  saveState();
  if (location.hash) history.replaceState(null, '', location.pathname);
  sweepPanel?.markStale();
  rewritePanel?.invalidate();
  try {
    const t0 = performance.now();
    result = evaluate({ variables: state.variables, program: state.program, formats: selectedFormats(), mode: state.mode, refDigits: state.refDigits ?? 60 });
    result.ms = performance.now() - t0;
    lastError = null;
  } catch (e) {
    lastError = e;
    renderError();
    return;
  }
  renderError();
  if (state.view === 'rewrite') rewritePanel?.render();
  cache = new Map();
  if (resetSel || !sel || !result.steps[sel.step]) {
    sel = result.steps.length ? { step: result.result, fmt: result.formats[0]?.id ?? 'exact' } : null;
    page = 0;
  }
  if (sel && sel.fmt !== 'exact' && !result.formats.some((f) => f.id === sel.fmt)) sel.fmt = result.formats[0]?.id ?? 'exact';
  render();
}

function cell(step, fmt) {
  const key = `${step.id}:${fmt.id}`;
  let c = cache.get(key);
  if (!c) {
    const res = step.fmt[fmt.id];
    const cmp = compareToExact(res.value, step.exact, fmt);
    c = { text: shortestDecimal(res.value, fmt), cmp, res };
    cache.set(key, c);
  }
  return c;
}

function causeOf(step, fmt) {
  const c = cell(step, fmt);
  if (!c.cause) c.cause = explainStep(step, result.steps, fmt, result.mode).cause;
  return c.cause;
}

const fmtById = () => Object.fromEntries(result.formats.map((f) => [f.id, f]));

function visibleSteps() {
  if (!result) return [];
  return state.showConst ? result.steps : result.steps.filter((s) => s.kind === 'op' || s.id === result.result);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (!result) return;
  renderSummary();
  renderDiagnosis();
  renderChartPanel();
  renderTable();
  renderDetailPanel();
}

function quality(cmp, fmt) {
  if (cmp.status === 'exact' || cmp.status === 'both-inf' || cmp.status === 'both-nan') return 'q-exact';
  if (cmp.status === 'mismatch') return 'q-bad';
  const full = fmt.p * Math.log10(2);
  const r = cmp.digits / full;
  if (r >= 0.85) return 'q-good';
  if (r >= 0.4) return 'q-mid';
  return 'q-bad';
}

function badge(cmp, fmt) {
  const q = quality(cmp, fmt);
  let text;
  let title;
  if (cmp.status === 'exact') { text = t('badge.exact'); title = t('badge.exactTitle'); }
  else if (cmp.status === 'both-nan') { text = t('badge.undef'); title = t('badge.undefTitle'); }
  else if (cmp.status === 'both-inf') { text = t('badge.inf'); title = t('badge.infTitle'); }
  else if (cmp.status === 'mismatch') { text = t('badge.mismatch'); title = t('badge.mismatchTitle'); }
  else if (!cmp.rel) { text = fmtErr(cmp.abs, 2); title = t('badge.absTitle'); }
  else {
    text = t('badge.digits', { d: cmp.digits.toFixed(1) });
    title = t('badge.digitsTitle', { d: cmp.digits.toFixed(2), rel: fmtErr(cmp.rel, 3), ulps: fmtErr(cmp.ulps, 3) });
  }
  const icon = q === 'q-good' || q === 'q-exact' ? '' : q === 'q-mid' ? '◐ ' : '▲ ';
  return `<span class="badge ${q}" title="${escapeHtml(title)}">${icon}${escapeHtml(text)}</span>`;
}

function renderSummary() {
  const st = result.steps[result.result];
  const host = $('summary');
  if (!st) { host.innerHTML = `<div class="panel muted">${escapeHtml(t('summary.empty'))}</div>`; return; }
  const name = st.lastAssigned || st.text;
  const cards = [`<button class="card exact-card ${sel?.fmt === 'exact' && sel?.step === st.id ? 'active' : ''}" data-fmt="exact">
      <div class="card-title">${escapeHtml(t('summary.exactTitle'))}</div>
      <div class="card-value mono">${escapeHtml(trueText(st.exact, 20))}</div>
      <div class="card-sub muted small">${escapeHtml(st.exact.approx ? t(st.exact.big ? 'summary.bigSub' : 'summary.approxSub', { v: Math.floor(st.exact.reliable) }) : t('summary.exactSub'))}</div></button>`];
  for (const f of result.formats) {
    const c = cell(st, f);
    cards.push(`<button class="card ${sel?.fmt === f.id && sel?.step === st.id ? 'active' : ''}" data-fmt="${f.id}">
      <div class="card-title"><span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span>${escapeHtml(fmtName(f))}</div>
      <div class="card-value mono">${escapeHtml(c.text)}</div>
      <div class="card-sub">${badge(c.cmp, f)} ${c.cmp.ulps && c.cmp.status === 'approx' ? `<span class="muted small">${fmtErr(c.cmp.ulps, 3)} ulp</span>` : ''}</div></button>`);
  }
  host.innerHTML = `<div class="summary-head"><h2>${escapeHtml(t('summary.result'))} <span class="mono">${escapeHtml(name)}</span></h2><span class="muted small">${escapeHtml(t('summary.steps', { n: result.steps.length, ms: result.ms.toFixed(0) }))}</span></div><div class="cards">${cards.join('')}</div>`;
  host.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => select(st.id, b.dataset.fmt)));
}

function renderDiagnosis() {
  const host = $('diagnosis');
  if (!result.steps[result.result] || !result.formats.length) { host.hidden = true; return; }
  host.hidden = false;
  const lines = result.formats.map((f) => {
    const dg = diagnose(result, f);
    const head = `<span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span><b>${escapeHtml(f.short)}:</b> `;
    let text;
    const root = result.steps[result.result];
    if (dg.final.status === 'exact' || dg.final.status === 'both-inf' || dg.final.status === 'both-nan') text = escapeHtml(t('diag.exact'));
    else if (dg.final.status === 'mismatch') text = escapeHtml(t('diag.mismatch', { value: shortestDecimal(root.fmt[f.id].value, f), exact: trueText(root.exact) }));
    else if (!dg.final.rel) text = escapeHtml(t('diag.trueZero', { abs: fmtErr(dg.final.abs) }));
    else text = escapeHtml(t('diag.digits', { digits: dg.digits.toFixed(1), full: dg.full.toFixed(1) }));
    let losses = '';
    const shortText = (st) => (st.text.length > 28 ? '…' + st.text.slice(-26) : st.text);
    if (dg.final.status === 'mismatch' && dg.origin) {
      const cause = causeOf(dg.origin, f);
      losses = ` <a href="#" class="step-link" data-step="${dg.origin.id}" data-fmt="${f.id}">${escapeHtml(t('diag.origin', { id: dg.origin.id, text: shortText(dg.origin), cause: t('cause.' + cause.code, cause.params) }))}</a>`;
    } else if (dg.final.status === 'approx' || dg.final.status === 'mismatch') {
      const big = dg.losses.filter((l) => l.lost >= 1);
      if (big.length) {
        losses = ` ${escapeHtml(t('diag.losses'))} ` + big.map((l) => {
          const cause = causeOf(l.step, f);
          const label = t('diag.loss', { id: l.step.id, text: shortText(l.step), lost: l.lost.toFixed(1), cause: t('cause.' + cause.code, cause.params) });
          return `<a href="#" class="step-link" data-step="${l.step.id}" data-fmt="${f.id}">${escapeHtml(label)}</a>`;
        }).join('; ');
      } else if (dg.final.status === 'approx') {
        losses = ' ' + escapeHtml(t('diag.onlyRounding'));
      }
    }
    return `<li>${head}${text}${losses}</li>`;
  });
  host.innerHTML = `<div class="section-title"><h2>${escapeHtml(t('diag.title'))}</h2><span class="muted small">${escapeHtml(t('diag.hint'))}</span></div><ul class="diag">${lines.join('')}</ul>`;
  host.querySelectorAll('.step-link').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    select(Number(a.dataset.step), a.dataset.fmt);
  }));
}

function renderChartPanel() {
  if (!result || state.view !== 'compare') return;
  const steps = result.steps.filter((s) => s.kind === 'op' || state.showConst);
  const xs = steps.map((s) => s.id);
  const series = result.formats.map((f) => {
    const cap = f.p * Math.log10(2);
    return {
      id: f.id,
      label: f.short,
      color: FORMAT_COLOR[f.id],
      values: steps.map((s) => {
        const cmp = cell(s, f).cmp;
        if (cmp.status === 'exact' || cmp.status === 'both-inf') return cap + 1;
        if (cmp.status === 'approx') return cmp.rel ? cmp.digits : 0;
        if (cmp.status === 'mismatch') return 0;
        return null;
      }),
      raw: steps.map((s) => cell(s, f).cmp),
    };
  });
  renderLineChart($('chart'), {
    xs,
    series,
    yMin: 0,
    yLabel: t('chart.digits'),
    xTick: (x) => '#' + x,
    legend: 'items',
    directLabels: true,
    emptyText: t('chart.empty'),
    ariaLabel: t('chart.aria'),
    tipTitle: (x) => `#${x} ${result.steps[x].text}`,
    tipValue: (s, v, i) => {
      const c = s.raw[i];
      if (c.status === 'exact') return t('chart.exact');
      return v == null ? '—' : v.toFixed(1);
    },
    onPick: (x) => select(x, sel?.fmt === 'exact' ? result.formats[0]?.id ?? 'exact' : sel?.fmt),
  });
}

function renderTable() {
  const fmts = result.formats;
  const rows = visibleSteps();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (page >= pages) page = pages - 1;
  const slice = rows.slice(page * PAGE, (page + 1) * PAGE);
  $('step-count').textContent = rows.length !== result.steps.length ? t('steps.countOf', { n: rows.length, total: result.steps.length }) : t('steps.count', { n: rows.length });
  const head = `<thead><tr><th>#</th><th>${t('steps.step')}</th><th class="exact-col">${t('steps.exact')}</th>${fmts.map((f) => `<th><span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span>${escapeHtml(f.short)}</th>`).join('')}</tr></thead>`;
  const body = slice.map((s) => {
    const label = s.kind === 'op'
      ? `<span class="mono">${escapeHtml(s.text)}</span>`
      : `<span class="kind">${t(s.kind === 'input' ? 'steps.input' : 'steps.literal')}</span> <span class="mono">${escapeHtml(s.text)}</span>`;
    const assigned = s.kind === 'op' && s.lastAssigned ? `<span class="assign">→ ${escapeHtml(s.lastAssigned)}</span>` : '';
    const iter = s.iter ? `<span class="iter" title="${escapeHtml(t('steps.iterTitle'))}">${t('steps.iter')} ${s.iter.join('.')}</span>` : '';
    const cells = fmts.map((f) => {
      const c = cell(s, f);
      const dir = c.res.round?.inexact ? (c.res.round.direction === 'up' ? `<span class="dir" title="${escapeHtml(t('steps.up'))}">↑</span>` : `<span class="dir" title="${escapeHtml(t('steps.down'))}">↓</span>`) : '';
      const flags = [c.res.flags.overflow && 'OVF', c.res.flags.underflow && 'UNF', c.res.flags.divByZero && 'DIV0', c.res.flags.invalid && 'INV'].filter(Boolean);
      const cause = causeOf(s, f);
      const active = sel && sel.step === s.id && sel.fmt === f.id ? ' active' : '';
      return `<td class="vcell${active}" data-step="${s.id}" data-fmt="${f.id}" tabindex="0">
        <div class="v mono">${escapeHtml(c.text)}${dir}</div>
        <div class="b">${badge(c.cmp, f)}${flags.map((x) => `<span class="flag-mini">${x}</span>`).join('')}${cause.code !== 'exact' ? causeChip(cause) : ''}</div></td>`;
    }).join('');
    const exActive = sel && sel.step === s.id && sel.fmt === 'exact' ? ' active' : '';
    return `<tr class="${s.id === result.result ? 'result-row' : ''} ${s.kind !== 'op' ? 'conv-row' : ''}">
      <td class="num">${s.id}</td><td class="steptext">${label}${assigned}${iter}</td>
      <td class="vcell exact-col${exActive}" data-step="${s.id}" data-fmt="exact" tabindex="0"><div class="v mono">${escapeHtml(trueText(s.exact, 17))}</div>${s.exact.approx ? `<div class="b"><span class="cause" title="${escapeHtml(t(s.exact.big ? 'steps.bigTip' : 'steps.irrationalTip', { v: Math.floor(s.exact.reliable) }))}">${escapeHtml(t(s.exact.big ? 'steps.big' : 'steps.irrational'))}</span></div>` : ''}</td>${cells}</tr>`;
  }).join('');
  $('steps').innerHTML = head + `<tbody>${body}</tbody>`;
  $('steps').querySelectorAll('.vcell').forEach((td) => {
    const go = () => select(Number(td.dataset.step), td.dataset.fmt, false);
    td.addEventListener('click', go);
    td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $('pager').innerHTML = pages > 1
    ? `<button class="btn small" data-p="${page - 1}" ${page === 0 ? 'disabled' : ''}>${t('pager.prev')}</button><span class="muted small">${t('pager.page', { a: page + 1, b: pages })}</span><button class="btn small" data-p="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>${t('pager.next')}</button>`
    : '';
  $('pager').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.p); renderTable(); }));
}

function renderDetailPanel() {
  renderDetail($('detail'), { result, sel, formatsById: fmtById(), select });
}

function select(stepId, fmtId, scroll = true) {
  sel = { step: stepId, fmt: fmtId || 'exact' };
  const rows = visibleSteps();
  const idx = rows.findIndex((s) => s.id === stepId);
  if (idx >= 0) page = Math.floor(idx / PAGE);
  renderSummary();
  renderTable();
  renderDetailPanel();
  const td = $('steps').querySelector(`.vcell[data-step="${stepId}"][data-fmt="${sel.fmt}"]`);
  if (scroll && td && state.view === 'compare') td.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (window.matchMedia('(max-width: 1279px)').matches && scroll === false) {
    $('detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** Open precision p (from the sweep) as the custom format in the step view. */
function openPrecision(p, expBits, stepId = null) {
  state.custom = { on: true, p, expBits: expBits ?? state.custom.expBits, unbounded: expBits == null };
  syncInputs();
  setView('compare');
  run(true);
  if (result) select(stepId ?? result.result, 'custom');
}

initControls();
applyTexts();
syncInputs();
sweepPanel = createSweepPanel($('view-sweep'), {
  state: () => state.sweep,
  save: (s) => { state.sweep = s; saveState(); },
  config: () => ({ variables: state.variables, program: state.program, mode: state.mode }),
  openPrecision,
});
rewritePanel = createRewritePanel($('view-rewrite'), {
  state: () => state.rewrite,
  save: saveState,
  config: () => ({ variables: state.variables, program: state.program, mode: state.mode, refDigits: state.refDigits ?? 60 }),
  formats: selectedFormats,
  useProgram: (program) => {
    state.program = program;
    state.example = '';
    state.rewrite = { ...state.rewrite, base: program, current: program, history: [], path: [] };
    syncInputs();
    setView('compare');
    run(true);
  },
});
run(true);
setView(['sweep', 'rewrite'].includes(state.view) ? state.view : 'compare');
