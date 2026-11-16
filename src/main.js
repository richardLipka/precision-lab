import './style.css';
import { evaluate } from './engine/evaluator.js';
import { FORMATS, ROUNDING_MODES, makeFormat, shortestDecimal, exactShort } from './engine/ieee.js';
import { compareToExact, correctDigits, qualityOf, fullDigits, exactLevel } from './engine/metrics.js';
import { explainStep, diagnose, sameOperands } from './engine/explain.js';
import { MAX_DEC_EXP } from './engine/real.js';
import { EXAMPLES, EXAMPLE_GROUPS, DEFAULT_EXAMPLE } from './ui/examples.js';
import { BIB, EXAMPLE_REFS, refLink } from './ui/references.js';
import { renderLineChart, escapeHtml } from './ui/chart.js';
import { log10Abs } from './engine/rational.js';
import { statementsOf, walk } from './engine/ast.js';
import {
  renderDetail, fmtErr, fmtName, causeChip, trueText, digitsText, QUALITY_ICON, flagMiniHtml, badgeLegendHtml,
} from './ui/detail.js';
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
const INTRO_KEY = 'precision-lab-intro-hidden';
/** Below this width the step detail sits under the results (see style.css), so links scroll to it. */
const NARROW = '(max-width: 1279px)';

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
    chartMeasure: 'digits',
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
    if (location.hash.length > 1) return withCurrentExample(merge(base, decodeState(location.hash.slice(1))));
  } catch { /* ignore a malformed link */ }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return withCurrentExample(merge(base, JSON.parse(raw)));
  } catch { /* storage unavailable */ }
  return base;
}

/**
 * A saved state or a shared link that names an example holds that example
 * unedited (any edit switches to "Custom"), but possibly an older version of
 * it: the texts shown next to it always describe the CURRENT version, so its
 * program and variables are taken from EXAMPLES. An example id that no longer
 * exists becomes "Custom" with the stored program kept.
 */
export function withCurrentExample(s) {
  if (!s.example) return s;
  const ex = EXAMPLES.find((e) => e.id === s.example);
  if (!ex) return { ...s, example: '' };
  return { ...s, variables: ex.variables.map((v) => ({ ...v })), program: ex.program };
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

  $('mode').addEventListener('change', (e) => { state.mode = e.target.value; renderModeHint(); run(); });

  // Short dismissible introduction; the header button brings it back.
  const showIntro = (on) => {
    $('intro').hidden = !on;
    try { localStorage.setItem(INTRO_KEY, on ? '0' : '1'); } catch { /* ignore */ }
  };
  let introHidden = false;
  try { introHidden = localStorage.getItem(INTRO_KEY) === '1'; } catch { /* ignore */ }
  $('intro').hidden = introHidden;
  $('intro-close').addEventListener('click', () => showIntro(false));
  $('help').addEventListener('click', () => showIntro($('intro').hidden));
  $('chart-measure').addEventListener('change', (e) => { state.chartMeasure = e.target.value; saveState(); renderChartPanel(); });
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
  // The step detail belongs to the format comparison only; the other views get its width.
  $('detail-panel').hidden = view !== 'compare';
  document.querySelector('.layout').classList.toggle('no-detail', view !== 'compare');
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
  renderExampleText();
  renderExampleRefs();
}

/**
 * Description of the selected example: what happens, the take-away ("Lesson")
 * and where in the tool to see it ("Look at"), so that every example reads as
 * one step of a curriculum rather than a bare phenomenon.
 */
function renderExampleText() {
  const ex = EXAMPLES.find((e) => e.id === state.example);
  if (!ex) { $('example-blurb').innerHTML = ''; return; }
  const lang = getLang();
  $('example-blurb').innerHTML = `<span class="ex-blurb">${escapeHtml(ex.blurb[lang])}</span>`
    + `<span class="ex-lesson"><b>${escapeHtml(t('setup.lesson'))}</b> ${escapeHtml(ex.lesson[lang])}</span>`
    + `<span class="ex-look"><b>${escapeHtml(t('setup.lookAt'))}</b> ${escapeHtml(ex.look[lang])}</span>`;
}

/** The example selector: one <optgroup> per curriculum group, in learning order. */
function exampleOptionsHtml(lang) {
  const option = (e) => `<option value="${e.id}">${escapeHtml(e.title[lang])}</option>`;
  return `<option value="">${escapeHtml(t('setup.custom'))}</option>` + EXAMPLE_GROUPS.map((g) =>
    `<optgroup label="${escapeHtml(t('exgroup.' + g))}">${EXAMPLES.filter((e) => e.group === g).map(option).join('')}</optgroup>`).join('');
}

/** Sources of the selected example (original publication, analysis, textbook). */
function renderExampleRefs() {
  const host = $('example-refs');
  const refs = EXAMPLE_REFS[state.example] || [];
  if (!refs.length) { host.innerHTML = ''; return; }
  const lang = getLang();
  host.innerHTML = `<div class="refs-title">${escapeHtml(t('refs.title'))}</div><ul>${refs.map((r) => {
    const b = BIB[r.id];
    const link = refLink(b);
    const note = r.note ? ` <span class="ref-note">— ${escapeHtml(r.note[lang])}</span>` : '';
    return `<li><span class="ref-role">${escapeHtml(t('refs.' + r.role))}:</span> ${escapeHtml(b.authors)} (${b.year}). <a href="${escapeHtml(link)}" rel="noopener" target="_blank">${escapeHtml(b.title)}</a>. ${escapeHtml(b.venue)}.${note}</li>`;
  }).join('')}</ul>`;
}

/** Texts that are not tied to the current result. */
function applyTexts() {
  document.documentElement.lang = getLang();
  applyStatic();
  const lang = getLang();
  $('example').innerHTML = exampleOptionsHtml(lang);
  $('formats').innerHTML = FORMATS.map((f) => `
    <label class="check fmt-check"><input type="checkbox" data-fmt="${f.id}" />
      <span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span>${escapeHtml(fmtName(f))}
      <span class="muted small" title="${escapeHtml(t('setup.pTitle', { p: f.p, d: fullDigits(f).toFixed(1) }))}">p=${f.p}</span></label>`).join('');
  $('mode').innerHTML = ROUNDING_MODES.map((m) => `<option value="${m.id}">${escapeHtml(t('mode.' + m.id) + (m.id === 'RNE' ? ' ' + t('mode.default') : ''))}</option>`).join('');
  $('steps-legend').innerHTML = badgeLegendHtml({ table: true });
}

/** What the rounding mode selector changes, and what the chosen mode is good for. */
function renderModeHint() {
  $('mode-hint').textContent = `${t('setup.modeHint')} ${t('modeHint.' + state.mode)}`;
}

function syncInputs() {
  $('example').value = state.example || '';
  renderExampleText();
  renderExampleRefs();
  $('program').value = state.program;
  $('mode').value = state.mode;
  renderModeHint();
  $('show-const').checked = state.showConst;
  $('chart-measure').value = state.chartMeasure || 'digits';
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
  // Results of the previous program stay on screen while the program does not
  // parse: mark them as stale where they are shown, not only next to the editor.
  const stale = !!lastError && !!result;
  $('stale').hidden = !stale;
  if (stale) $('stale').textContent = t('results.stale', { error: errorText(lastError) });
  $('view-compare').classList.toggle('stale', stale);
  $('detail-panel').classList.toggle('stale', stale);
}

/** Variable names the program reads somewhere (in any expression), as opposed to names it only assigns. */
function readNames(program) {
  const names = new Set();
  for (const { expr } of statementsOf(program)) {
    for (const { node } of walk(expr)) if (node.type === 'var') names.add(node.name);
  }
  return names;
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
    result.readNames = readNames(state.program);
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

/** A value for a narrow table cell: it may wrap only before its exponent (5.55e−17), never inside the digits. */
function numHtml(text) {
  return escapeHtml(text).replace(/e(?=[−+-]?\d)/, '<wbr>e');
}

function causeOf(step, fmt) {
  const c = cell(step, fmt);
  if (!c.cause) c.cause = explainStep(step, result.steps, fmt, result.mode, { trace: false }).cause;
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

/** Quality badge of a cell: shown (capped) digits and colour from metrics.js; the raw value goes into the tooltip. */
function badge(cmp, fmt) {
  const dg = correctDigits(cmp, fmt);
  const q = qualityOf(dg.shown, dg.full);
  let text;
  let title;
  if (cmp.status === 'exact') { text = t('badge.exact'); title = t('badge.exactTitle'); }
  else if (cmp.status === 'both-nan') { text = t('badge.undef'); title = t('badge.undefTitle'); }
  else if (cmp.status === 'both-inf') { text = t('badge.inf'); title = t('badge.infTitle'); }
  else if (cmp.status === 'mismatch') { text = t('badge.mismatch'); title = t('badge.mismatchTitle'); }
  else if (!cmp.rel) { text = fmtErr(cmp.abs, 2); title = t('badge.absTitle'); }
  else {
    text = t('badge.digits', { d: dg.shown.toFixed(1) });
    title = t('badge.digitsTitle', { d: dg.shown.toFixed(1), rel: fmtErr(cmp.rel, 3), ulps: fmtErr(cmp.ulps, 3) });
    if (dg.capped) title += ' · ' + t('digits.rawNote', { raw: dg.raw.toFixed(2), full: dg.full.toFixed(1) });
  }
  const icon = cmp.status === 'mismatch' ? '' : QUALITY_ICON[q] || ''; // ✕ alone already says "not comparable"
  return `<span class="badge ${q}" title="${escapeHtml(title)}">${icon}${escapeHtml(text)}</span>`;
}

/**
 * The values the summary and the diagnosis report: the final value of every
 * assigned variable that is not an input (variables holding the same step are
 * merged), plus the value of the last statement when no variable holds it, in
 * evaluation order. Programs that compare two variants (left / right, stable /
 * naive, kahan / naive) thus show both sides where the student looks first.
 *   final:  the value of the last statement
 *   output: the program never reads one of its variables (an answer it computes,
 *           such as kahan / naive), as opposed to a helper such as the loop's c
 */
function resultRows() {
  const byStep = new Map();
  for (const [name, id] of Object.entries(result.env || {})) {
    if (result.steps[id].kind === 'input') continue;
    if (!byStep.has(id)) byStep.set(id, []);
    byStep.get(id).push(name);
  }
  if (result.steps[result.result] && !byStep.has(result.result)) byStep.set(result.result, null);
  const used = new Set();
  for (const s of result.steps) for (const o of s.operands) used.add(o);
  const read = result.readNames || new Set();
  const short = (s) => (s.length > 32 ? s.slice(0, 30) + '…' : s);
  return [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([id, names]) => {
    const st = result.steps[id];
    // the name the value was assigned to last comes first: "kahan, k, t"
    const ordered = names && [...names].sort((a, b) => (b === st.lastAssigned) - (a === st.lastAssigned));
    return {
      step: st,
      label: ordered ? ordered.join(', ') : short(st.text),
      final: id === result.result,
      output: ordered ? ordered.some((n) => !read.has(n)) : !used.has(id),
    };
  });
}

/** Small tag after a result's name: "result" for the last statement, "intermediate" for a value used again. */
function rowTag(row) {
  if (row.final) return ` <span class="row-tag" title="${escapeHtml(t('summary.finalTitle'))}">${escapeHtml(t('summary.final'))}</span>`;
  if (!row.output) return ` <span class="row-tag muted" title="${escapeHtml(t('summary.interTitle'))}">${escapeHtml(t('summary.inter'))}</span>`;
  return '';
}

/** Results as a compact table (result × format): value and quality badge, each cell opens its step. */
function renderSummary() {
  const host = $('summary');
  const rows = resultRows();
  if (!rows.length) { host.innerHTML = `<div class="panel muted">${escapeHtml(t('summary.empty'))}</div>`; return; }
  const isSel = (st, id) => (sel?.fmt === id && sel?.step === st.id ? ' active' : '');
  const head = `<thead><tr><th>${escapeHtml(t('summary.variable'))}</th><th class="exact-col">${escapeHtml(t('summary.exactTitle'))}</th>${result.formats.map((f) => `<th><span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span>${escapeHtml(f.short)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((row) => {
    const st = row.step;
    const sub = st.exact.approx ? `<span class="muted small">${escapeHtml(t(st.exact.big ? 'steps.big' : 'steps.irrational'))}</span>` : '';
    const cells = result.formats.map((f) => {
      const c = cell(st, f);
      return `<td><button class="sum-cell${isSel(st, f.id)}" data-step="${st.id}" data-fmt="${f.id}"><span class="mono v">${escapeHtml(c.text)}</span> ${badge(c.cmp, f)}</button></td>`;
    }).join('');
    return `<tr class="${row.final ? 'final-row' : ''}${row.output || row.final ? '' : ' inter-row'}"><th><span class="mono">${escapeHtml(row.label)}</span> <span class="muted small">#${st.id}</span>${rowTag(row)}</th>
      <td class="exact-col"><button class="sum-cell${isSel(st, 'exact')}" data-step="${st.id}" data-fmt="exact"><span class="mono v">${escapeHtml(trueText(st.exact, 20))}</span> ${sub}</button></td>${cells}</tr>`;
  }).join('');
  host.innerHTML = `<div class="summary-head"><h2>${escapeHtml(t('summary.results'))}</h2><span class="muted small">${escapeHtml(t('summary.steps', { n: result.steps.length, ms: result.ms.toFixed(0) }))}</span></div>
    <div class="summary-scroll"><table class="sumtab">${head}<tbody>${body}</tbody></table></div>
    <p class="muted small summary-note">${escapeHtml(t('summary.note'))}</p>`;
  host.querySelectorAll('.sum-cell').forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.step), b.dataset.fmt)));
}

/** "#0, #1, #3" (or the first three and the count) of the earlier values an exact result was built on. */
function carriedText(ids) {
  const list = ids.slice(0, 3).map((id) => '#' + id).join(', ');
  return ids.length > 4 ? t('diag.carriedMore', { list, n: ids.length }) : ids.map((id) => '#' + id).join(', ');
}

/**
 * "Why do the results differ?" for every result row: per format the verdict
 * and the steps that cost the most digits. Answers (outputs and the final value)
 * are open; intermediate helpers are collapsed. Links lead to the step, to the
 * precision sweep and to the Rearrange view.
 */
function renderDiagnosis() {
  const host = $('diagnosis');
  const rows = resultRows();
  if (!rows.length || !result.formats.length) { host.hidden = true; return; }
  host.hidden = false;
  let anyInexact = false;
  // Variables an example marks as exact by design (Kahan summation), and notes on its helper
  // variables; only while the example is unedited (any edit switches to "Custom").
  const ex = EXAMPLES.find((e) => e.id === state.example);
  const designed = new Set((ex?.byDesign || []).map((name) => result.env?.[name]).filter((id) => id != null));
  const helperNote = (row) => {
    const n = row.label.split(', ').find((name) => ex?.helpers?.[name]);
    return n ? `<p class="small muted diag-helper">${escapeHtml(ex.helpers[n][getLang()])}</p>` : '';
  };
  const groupLines = (root) => result.formats.map((f) => {
    const dg = diagnose(result, f, { root: root.id, shownOf: (s) => correctDigits(cell(s, f).cmp, f).shown });
    const head = `<span class="swatch" style="background:${FORMAT_COLOR[f.id]}"></span><b>${escapeHtml(f.short)}:</b> `;
    let text;
    if (dg.final.status !== 'exact' && dg.final.status !== 'both-nan' && dg.final.status !== 'both-inf') anyInexact = true;
    // Exact although the values it was built on were rounded: their errors cancelled (float's 0.1 + 0.2 − 0.3) —
    // by luck, unless the two operands are the same value (x − x), where that is certain.
    if (dg.final.status === 'exact') {
      // sameOperands (explain.js): x − x is 0 by construction (dg.exactBy: also a + (−a) and
      // c == c further up); a compensated algorithm (marked by its example) cancels the errors on purpose.
      const k = !dg.carried.length ? 'diag.exact' : sameOperands(root, result.steps) ? 'diag.exactSame'
        : designed.has(root.id) ? 'diag.exactByDesign' : dg.exactBy === 'construction' ? 'diag.exactConstruction' : 'diag.exactCarried';
      text = escapeHtml(t(k, { list: carriedText(dg.carried) }));
    }
    else if (dg.final.status === 'both-inf' || dg.final.status === 'both-nan') text = escapeHtml(t(dg.final.status === 'both-nan' ? 'diag.bothNan' : 'diag.bothInf'));
    // a true value beyond the reference's range: finite and nonzero, but not measurable
    else if (dg.final.beyond) text = escapeHtml(t(dg.final.beyond === 'huge' ? 'diag.beyondHuge' : dg.final.beyond === 'unknown' ? 'diag.beyondUnknown' : 'diag.beyondTiny', { value: shortestDecimal(root.fmt[f.id].value, f), max: MAX_DEC_EXP }));
    else if (dg.final.status === 'mismatch') text = escapeHtml(t('diag.mismatch', { value: shortestDecimal(root.fmt[f.id].value, f), exact: trueText(root.exact) }));
    else if (!dg.final.rel) text = escapeHtml(t('diag.trueZero', { abs: fmtErr(dg.final.abs) }));
    // "correct digits" is defined in plain words where the figure is shown
    else text = `<span class="diag-digits" title="${escapeHtml(t('digits.def'))}">${escapeHtml(t('diag.digits', { digits: dg.digits.toFixed(1), full: dg.full.toFixed(1) }))}</span>`;
    // dg.losses holds only losses of at least NOTABLE_DIGITS, measured like the verdict sentences.
    let losses = '';
    const shortText = (st) => (st.text.length > 28 ? '…' + st.text.slice(-26) : st.text);
    // A link to a step, labelled with a diag.* sentence naming the step and its cause chip.
    const stepLink = (k, st, extra = {}) => {
      const cause = causeOf(st, f);
      const label = t(k, { id: st.id, text: shortText(st), cause: t('cause.' + cause.code, cause.params), ...extra });
      return `<a href="#" class="step-link" data-step="${st.id}" data-fmt="${f.id}">${escapeHtml(label)}</a>`;
    };
    if (dg.final.status === 'mismatch' && dg.origin) {
      // Where the problem starts (e.g. an underflow to 0) and, if different, where it shows (÷ 0).
      losses = ' ' + stepLink('diag.origin', dg.origin) + (dg.revealed ? ' ' + stepLink('diag.revealed', dg.revealed) : '');
    } else if (dg.final.status === 'approx' || dg.final.status === 'mismatch') {
      const big = dg.losses;
      if (big.length) {
        // "lost at #5, revealed at #6": a cancellation only exposes what an earlier step destroyed.
        losses = ` ${escapeHtml(t('diag.losses'))} ` + big.map((l) => stepLink('diag.loss', l.step, { lost: l.lost.toFixed(1) })
          + (l.source ? ' ← ' + stepLink('diag.lostAt', l.source) : '')).join('; ');
      } else if (dg.final.status === 'approx') {
        // Distance to the true value rounded once, counted in representable numbers
        // (an error in ulps of the true value can read 0.5 ulp for a neighbour).
        losses = ' ' + escapeHtml(dg.bestPossible === false && dg.apart != null
          ? t('diag.accumulated', {
            n: dg.rounded,
            best: shortestDecimal(dg.best, f),
            value: shortestDecimal(root.fmt[f.id].value, f),
            apart: dg.apart === 1 ? t('diag.apartOne') : t('diag.apartMany', { k: dg.apart }),
          }) + ' ' + t('digits.def')
          : t('diag.onlyRounding'));
      }
    }
    return `<li>${head}${text}${losses}</li>`;
  }).join('');
  const groups = rows.length === 1
    ? `<ul class="diag">${groupLines(rows[0].step)}</ul>`
    : rows.map((row) => `<details class="diag-group"${row.output || row.final ? ' open' : ''}><summary><span class="mono">${escapeHtml(row.label)}</span> <span class="muted small">#${row.step.id}</span>${rowTag(row)}</summary>${helperNote(row)}<ul class="diag">${groupLines(row.step)}</ul></details>`).join('');
  const next = anyInexact
    ? `<p class="diag-next small">${escapeHtml(t('diag.next'))} <a href="#" class="view-link" data-view="sweep">${escapeHtml(t('diag.toSweep'))}</a> · <a href="#" class="view-link" data-view="rewrite">${escapeHtml(t('diag.toRewrite'))}</a></p>`
    : '';
  host.innerHTML = `<div class="section-title"><h2>${escapeHtml(t('diag.title'))}</h2><span class="muted small">${escapeHtml(t('diag.hint'))}</span></div>${groups}${next}`;
  host.querySelectorAll('.step-link').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    select(Number(a.dataset.step), a.dataset.fmt);
  }));
  host.querySelectorAll('.view-link').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    setView(a.dataset.view);
  }));
}

/**
 * Error-propagation chart. Three measures of the same thing:
 *  digits = correct significant digits, abs = |computed − true| (log scale),
 *  rel = |computed − true| / |true| (log scale). Exact values are drawn as
 *  markers on the bottom edge of the log charts; ∞/NaN results leave a gap.
 */
function renderChartPanel() {
  if (!result || state.view !== 'compare') return;
  const measure = state.chartMeasure || 'digits';
  $('chart-subtitle').textContent = `${t('chart.sub.' + measure)} ${t('chart.clickHint')}`;
  const steps = result.steps.filter((s) => s.kind === 'op' || state.showConst);
  const xs = steps.map((s) => s.id);
  const logOf = (cmp) => {
    if (cmp.status !== 'approx') return null;
    if (measure === 'abs') return log10Abs(cmp.abs);
    return cmp.rel ? Math.max(-cmp.digits, log10Abs(cmp.rel)) : null;
  };
  // Digits: the shown (capped) figure, at most p·log10 2; "exact" is one common
  // level above the largest capacity, so no inexact point can reach it.
  const level = exactLevel(Math.max(0, ...result.formats.map((f) => fullDigits(f))));
  const series = result.formats.map((f) => {
    const raw = steps.map((s) => cell(s, f).cmp);
    const values = raw.map((cmp) => {
      if (measure === 'digits') {
        if (cmp.status === 'both-nan') return null;
        const dg = correctDigits(cmp, f);
        return dg.shown === Infinity ? level : dg.shown ?? 0;
      }
      return logOf(cmp);
    });
    return { id: f.id, label: f.short, color: FORMAT_COLOR[f.id], values, raw, fmt: f };
  });
  let yMin = 0;
  let yMax;
  const markers = [];
  const bands = [];
  if (measure === 'digits') {
    yMax = Math.ceil(level + 1);
    bands.push({ y: level, label: t('chart.exact') });
  }
  if (measure !== 'digits') {
    const all = series.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
    yMin = all.length ? Math.floor(Math.min(...all)) - 1 : -20;
    yMax = all.length ? Math.ceil(Math.max(...all)) + 1 : 1;
    series.forEach((s) => s.raw.forEach((cmp, i) => {
      if (cmp.status === 'exact') markers.push({ x: xs[i], y: yMin, cls: 'exact-mk' });
    }));
  }
  renderLineChart($('chart'), {
    xs,
    series,
    yMin,
    yMax,
    markers,
    bands,
    yLabel: t('chart.axis.' + measure),
    yTick: measure === 'digits' ? undefined : (v) => `1e${Math.round(v)}`.replace('-', '−'),
    xTick: (x) => '#' + x,
    legend: 'items',
    directLabels: true,
    emptyText: t('chart.empty'),
    ariaLabel: t('chart.aria'),
    tipTitle: (x) => `#${x} ${result.steps[x].text}`,
    tipValue: (s, v, i) => {
      const c = s.raw[i];
      if (c.status === 'exact') return t('chart.exact');
      if (c.status === 'both-inf') return t('badge.inf');
      if (c.status === 'mismatch') return t('sweep.notComparable');
      if (v == null) return '—';
      if (measure === 'digits') return c.status === 'approx' ? digitsText(correctDigits(c, s.fmt)) : v.toFixed(1);
      return fmtErr(measure === 'abs' ? c.abs : c.rel, 3);
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
      const cause = causeOf(s, f);
      const active = sel && sel.step === s.id && sel.fmt === f.id ? ' active' : '';
      return `<td class="vcell${active}" data-step="${s.id}" data-fmt="${f.id}" tabindex="0">
        <div class="v mono">${numHtml(c.text)}${dir}</div>
        <div class="b">${badge(c.cmp, f)}${flagMiniHtml(c.res.flags)}${cause.code !== 'exact' ? causeChip(cause) : ''}</div></td>`;
    }).join('');
    const exActive = sel && sel.step === s.id && sel.fmt === 'exact' ? ' active' : '';
    return `<tr class="${s.id === result.result ? 'result-row' : ''} ${s.kind !== 'op' ? 'conv-row' : ''}">
      <td class="num">${s.id}</td><td class="steptext">${label}${assigned}${iter}</td>
      <td class="vcell exact-col${exActive}" data-step="${s.id}" data-fmt="exact" tabindex="0"><div class="v mono">${numHtml(trueText(s.exact, 17))}</div>${s.exact.approx ? `<div class="b"><span class="cause" title="${escapeHtml(t(s.exact.big ? 'steps.bigTip' : 'steps.irrationalTip', { v: Math.floor(s.exact.reliable) }))}">${escapeHtml(t(s.exact.big ? 'steps.big' : 'steps.irrational'))}</span></div>` : ''}</td>${cells}</tr>`;
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
  renderDetail($('detail'), { result, sel, formatsById: fmtById(), select, fitWidth: fitDetailToBits });
}

// ---------------------------------------------------------------------------
// Resizable step-detail panel (wide layout only)
// ---------------------------------------------------------------------------

const DETAIL_KEY = 'precision-lab-detail-width';
const DETAIL_MIN = 320;

function detailMax() {
  const layout = document.querySelector('.layout');
  // keep at least 330 px for the setup column and 360 px for the results
  return Math.max(DETAIL_MIN, layout.clientWidth - 330 - 360 - 64);
}

function setDetailWidth(w, save = true) {
  const width = Math.round(Math.min(detailMax(), Math.max(DETAIL_MIN, w)));
  document.querySelector('.layout').style.setProperty('--detail-w', `${width}px`);
  $('detail-resizer').setAttribute('aria-valuenow', String(width));
  if (save) {
    try { localStorage.setItem(DETAIL_KEY, String(width)); } catch { /* ignore */ }
  }
  // redraw the chart (its width changed) at most once per frame while dragging
  if (!chartFrame) {
    chartFrame = requestAnimationFrame(() => { chartFrame = 0; renderChartPanel(); });
  }
}
let chartFrame = 0;

/** Widen the panel so that the longest bit row fits on one line. */
function fitDetailToBits() {
  const panel = $('detail-panel');
  let need = 0;
  panel.querySelectorAll('.bin-scroll, .bits').forEach((el) => { need = Math.max(need, el.scrollWidth - el.clientWidth); });
  setDetailWidth(panel.getBoundingClientRect().width + need + 24);
}

function initResizer() {
  const handle = $('detail-resizer');
  try {
    const w = Number(localStorage.getItem(DETAIL_KEY));
    if (w) setDetailWidth(w, false);
  } catch { /* ignore */ }
  let startX = 0;
  let startW = 0;
  const move = (e) => setDetailWidth(startW + (startX - e.clientX));
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing');
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = $('detail-panel').getBoundingClientRect().width;
    document.body.classList.add('resizing');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => setDetailWidth(440));
  handle.addEventListener('keydown', (e) => {
    const w = $('detail-panel').getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setDetailWidth(w + 40); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setDetailWidth(w - 40); }
  });
  handle.setAttribute('aria-valuemin', String(DETAIL_MIN));
}

/**
 * Show the explanation of a step. Wide layout: the detail panel is beside the
 * results, so the chosen table cell is scrolled into view (unless the click came
 * from the table itself). Narrow layout: the detail sits below everything, so
 * every link (table, diagnosis, results, chart) scrolls to the explanation.
 */
function select(stepId, fmtId, scroll = true) {
  sel = { step: stepId, fmt: fmtId || 'exact' };
  const rows = visibleSteps();
  const idx = rows.findIndex((s) => s.id === stepId);
  if (idx >= 0) page = Math.floor(idx / PAGE);
  renderSummary();
  renderTable();
  renderDetailPanel();
  if (state.view !== 'compare') return;
  if (window.matchMedia?.(NARROW).matches) {
    $('detail').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    return;
  }
  const td = $('steps').querySelector(`.vcell[data-step="${stepId}"][data-fmt="${sel.fmt}"]`);
  if (scroll && td) td.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
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
initResizer();
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
