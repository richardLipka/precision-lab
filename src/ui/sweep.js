// Precision sweep panel: runs the program for many precisions p in a worker
// and shows (1) the error of the result as a function of p, (2) correct
// digits step by step with one line per precision, (3) a convergence verdict.

import { renderLineChart, escapeHtml } from './chart.js';
import { parsePrecisions } from '../engine/sweep.js';
import { LOG10_2, NOTABLE_DIGITS, digitsInfo, fullDigits, exactLevel, qualityOf } from '../engine/metrics.js';
import { digitsText, QUALITY_ICON, badgeLegendHtml } from './detail.js';
import { t, errorText } from '../i18n.js';

const SEQ_STEPS = 10;
const seqColor = (i, n) => `var(--seq-${n <= 1 ? SEQ_STEPS - 1 : Math.round((i / (n - 1)) * (SEQ_STEPS - 1))})`;

export function createSweepPanel(host, api) {
  let worker = null;
  let out = null;
  let stale = false;
  let running = null;
  let error = null;
  const st = api.state();

  host.innerHTML = `
    <div class="panel sweep-controls">
      <div class="section-title"><h2 data-s="title"></h2></div>
      <p class="muted small" data-s="intro"></p>
      <div class="sweep-form">
        <label class="field"><span class="label" data-s="precisions"></span>
          <input id="sw-spec" class="mono" spellcheck="false" /></label>
        <div class="presets">
          <button class="btn small" data-preset="1-200">1–200</button>
          <button class="btn small" data-preset="1-1000">1–1000</button>
          <button class="btn small" data-preset="2-1000:10">2–1000 : 10</button>
          <button class="btn small" data-preset="8, 11, 24, 53, 64, 113, 237">IEEE</button>
        </div>
        <p class="muted small" data-s="hint"></p>
        <div class="sweep-exp">
          <span class="label" data-s="exponent"></span>
          <label class="check"><input type="checkbox" id="sw-unb" /> <span data-s="unbounded"></span></label>
          <label><input type="number" id="sw-exp" min="2" max="30" /> <span data-s="expBits"></span></label>
        </div>
        <div class="sweep-run">
          <button id="sw-run" class="btn primary"></button>
          <div class="progress" hidden><div class="bar"></div></div>
          <span id="sw-status" class="muted small" role="status"></span>
        </div>
        <div id="sw-error" class="error" role="alert" hidden></div>
      </div>
    </div>
    <div class="panel"><div class="section-title"><h2 data-s="analysis"></h2></div><div id="sw-analysis" class="analysis"></div></div>
    <div class="panel">
      <div class="section-title"><h2 data-s="chartP"></h2>
        <label class="inline small"><span data-s="measure"></span>
          <select id="sw-measure"><option value="abs"></option><option value="rel"></option><option value="digits"></option></select></label></div>
      <p class="muted small" data-s="chartPsub"></p>
      <div id="sw-chart-p"></div>
      <details class="info-fold"><summary data-s="chartAbout"></summary><p class="muted small" id="sw-chart-note"></p></details>
    </div>
    <div class="panel">
      <div class="section-title"><h2 data-s="chartSteps"></h2>
        <label class="inline small"><span data-s="lines"></span>
          <select id="sw-lines"><option>5</option><option>10</option><option>20</option><option>40</option></select></label></div>
      <div id="sw-chart-steps"></div>
    </div>
    <div class="panel"><details id="sw-table-wrap"><summary><span class="summary-h" data-s="table"></span></summary><div id="sw-legend"></div><div class="table-scroll" tabindex="0" role="region" aria-label="Sweep table"><table class="steps sweep-table" id="sw-table"></table></div></details></div>`;

  const $ = (id) => host.querySelector('#' + id);
  $('sw-spec').value = st.spec;
  $('sw-unb').checked = st.unbounded;
  $('sw-exp').value = st.expBits;
  $('sw-measure').value = st.measure;
  $('sw-lines').value = String(st.lines);

  const save = () => api.save({
    spec: $('sw-spec').value,
    unbounded: $('sw-unb').checked,
    expBits: parseInt($('sw-exp').value, 10) || 15,
    measure: $('sw-measure').value,
    lines: parseInt($('sw-lines').value, 10) || 10,
  });
  host.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { $('sw-spec').value = b.dataset.preset; save(); markStale(); }));
  $('sw-spec').addEventListener('input', () => { save(); markStale(); });
  $('sw-spec').addEventListener('keydown', (e) => { if (e.key === 'Enter') runOrCancel(); });
  $('sw-unb').addEventListener('change', () => { $('sw-exp').disabled = $('sw-unb').checked; save(); markStale(); });
  $('sw-exp').addEventListener('change', () => { save(); markStale(); });
  $('sw-measure').addEventListener('change', () => { save(); renderResults(); });
  $('sw-lines').addEventListener('change', () => { save(); renderResults(); });
  $('sw-run').addEventListener('click', runOrCancel);
  $('sw-exp').disabled = st.unbounded;

  function runOrCancel() {
    if (running) cancel(); else run();
  }

  function cancel() {
    worker?.terminate();
    worker = null;
    running = null;
    renderStatus();
  }

  function run() {
    cancel();
    error = null;
    let precisions;
    try {
      precisions = parsePrecisions($('sw-spec').value);
    } catch (e) {
      error = e;
      renderStatus();
      return;
    }
    const cfg = api.config();
    const expBits = $('sw-unb').checked ? null : Math.min(30, Math.max(2, parseInt($('sw-exp').value, 10) || 15));
    worker = new Worker(new URL('../sweep/worker.js', import.meta.url), { type: 'module' });
    running = { done: 0, total: precisions.length, t0: performance.now() };
    renderStatus();
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        running.done = msg.done;
        renderStatus();
      } else if (msg.type === 'done') {
        out = msg.out;
        out.ms = performance.now() - running.t0;
        out.precisions = precisions;
        running = null;
        stale = false;
        worker.terminate();
        worker = null;
        renderStatus();
        renderResults();
      } else if (msg.type === 'error') {
        error = msg.error;
        running = null;
        worker.terminate();
        worker = null;
        renderStatus();
      }
    };
    worker.onerror = (e) => {
      error = { message: e.message };
      running = null;
      renderStatus();
    };
    worker.postMessage({ ...cfg, precisions, expBits });
  }

  function renderStatic() {
    host.querySelectorAll('[data-s]').forEach((el) => { el.textContent = t('sweep.' + el.dataset.s); });
    $('sw-spec').placeholder = t('sweep.hint');
    const opts = $('sw-measure').options;
    opts[0].textContent = t('sweep.m.abs');
    opts[1].textContent = t('sweep.m.rel');
    opts[2].textContent = t('sweep.m.digits');
  }

  function renderStatus() {
    $('sw-run').textContent = running ? t('sweep.cancel') : t('sweep.run');
    const prog = host.querySelector('.progress');
    prog.hidden = !running;
    if (running) prog.querySelector('.bar').style.width = `${(100 * running.done) / running.total}%`;
    let s = '';
    if (running) s = t('sweep.progress', { done: running.done, total: running.total });
    else if (out && stale) s = t('sweep.stale');
    else if (out) s = t('sweep.done', { n: out.rows.length, steps: out.meta.steps.length, ms: out.ms.toFixed(0) });
    else s = t('sweep.notRun');
    $('sw-status').textContent = s;
    $('sw-status').classList.toggle('warn-text', !!(out && stale && !running));
    const errEl = $('sw-error');
    errEl.hidden = !error;
    if (error) errEl.textContent = errorText(error);
  }

  function markStale() {
    if (out && !stale) { stale = true; renderStatus(); }
  }

  function renderResults() {
    if (!out) {
      $('sw-analysis').innerHTML = `<p class="muted">${t('sweep.notRun')}</p>`;
      $('sw-chart-p').innerHTML = '';
      $('sw-chart-steps').innerHTML = '';
      $('sw-table').innerHTML = '';
      return;
    }
    renderAnalysis();
    renderChartP();
    renderChartSteps();
    renderTable();
  }

  function renderAnalysis() {
    const an = out.analysis;
    const meta = out.meta;
    const paras = [];
    const p = (key, params, cls = '') => paras.push(`<p class="${cls}">${escapeHtml(t(key, params))}</p>`);
    const nr = t('an.notReached');
    switch (an.kind) {
      case 'undefined': p('an.undefined', {}, 'bad'); break;
      case 'noComparable': p('an.noComparable', {}, 'bad'); break;
      default: {
        const verdictCls = an.kind === 'converges' || an.kind === 'exact' ? 'good' : an.kind === 'convergesSlow' ? '' : 'bad';
        // "all intermediate results fit" only when they really are all exact; otherwise their errors cancelled.
        if (an.kind === 'exact') p(an.allStepsExact ? 'an.exact' : 'an.exactLucky', { exactFrom: an.exactFrom }, verdictCls);
        else if (an.kind === 'converges') p('an.converges', { slope: an.slope.toFixed(3) }, verdictCls);
        else if (an.kind === 'convergesSlow') p('an.convergesSlow', { slope: (an.slope ?? 0).toFixed(3) });
        else if (an.kind === 'notYet') p('an.notYet', { pMax: an.pMax, est: an.estimate1 ?? '?' }, verdictCls);
        else if (an.kind === 'noTrend') p('an.noTrend', { pMax: an.pMax }, verdictCls);
        else if (an.kind === 'special') p('an.special', {}, 'bad');
        p('an.thresholds', { one: an.oneFrom ?? nr, six: an.sixFrom ?? nr, fifteen: an.fifteenFrom ?? nr });
        if (an.jump) p('an.jump', { from: an.jump.from, to: an.jump.to, dFrom: an.jump.dFrom.toFixed(1), dTo: an.jump.dTo === Infinity ? '∞' : an.jump.dTo.toFixed(1) });
        if (an.loss != null && an.loss >= NOTABLE_DIGITS) p('an.loss', { loss: an.loss.toFixed(1), bits: Math.ceil(an.loss / LOG10_2) });
        else if (an.kind === 'converges' || an.kind === 'exact') p('an.lossNone');
        if (an.drops) p('an.drops', { drops: an.drops });
        p('an.final', { pMax: an.pMax, value: an.lastValue, digits: an.lastDigits === Infinity ? '∞' : an.lastDigits == null ? '—' : an.lastDigits.toFixed(1), exact: meta.exact }, 'muted');
      }
    }
    $('sw-analysis').innerHTML = `<div class="kv"><span>${t('sweep.trueValue')}</span><span class="mono long">${escapeHtml(meta.exact)}</span></div>${paras.join('')}`;
  }

  function renderChartP() {
    const measure = $('sw-measure').value;
    const rows = out.rows.filter((r) => r.final);
    const xs = rows.map((r) => r.p);
    const exLog = out.meta.exactLog10;
    // Digits are shown capped at p·log10 2 (metrics.js); "exact" is ONE labelled level
    // above the largest capacity in the chart, as in the format comparison chart.
    const level = exactLevel(fullDigits(Math.max(1, ...rows.map((r) => r.p))));
    const shownAt = (raw, p) => {
      const dg = digitsInfo(raw, fullDigits(p));
      return dg.shown == null ? null : dg.shown === Infinity ? level : dg.shown;
    };
    let vals;
    let best;
    let bound;
    if (measure === 'digits') {
      vals = rows.map((r) => shownAt(r.final.digits, r.p));
      best = rows.map((r) => shownAt(r.final.bestDigits, r.p));
      bound = null; // the capped best possible result already lies on p·log10 2
    } else {
      const key = measure === 'abs' ? 'log10Abs' : 'log10Rel';
      const bkey = measure === 'abs' ? 'bestLog10Abs' : 'bestLog10Rel';
      vals = rows.map((r) => (Number.isFinite(r.final[key]) ? r.final[key] : null));
      best = rows.map((r) => (Number.isFinite(r.final[bkey]) ? r.final[bkey] : null));
      bound = rows.map((r) => (measure === 'abs' ? (Number.isFinite(exLog) ? exLog - r.p * LOG10_2 : null) : -r.p * LOG10_2));
    }
    const finiteVals = [...vals, ...best, ...(bound || [])].filter((v) => v != null && Number.isFinite(v));
    let yMin = finiteVals.length ? Math.min(...finiteVals) : 0;
    let yMax = finiteVals.length ? Math.max(...finiteVals) : 1;
    if (measure !== 'digits') { yMin = Math.floor(yMin) - 1; yMax = Math.ceil(yMax) + 1; } else { yMin = 0; yMax = Math.ceil(Math.max(yMax, level)) + 1; }
    const markers = [];
    if (measure !== 'digits') {
      // zero error cannot be drawn on a log scale: markers on the bottom edge
      rows.forEach((r) => {
        if (r.final.bestLog10Abs === -Infinity) markers.push({ x: r.p, y: yMin, cls: 'best-mk' });
        if (r.final.status === 'exact') markers.push({ x: r.p, y: yMin, cls: 'exact-mk' });
      });
    }
    const shift = Number.isFinite(exLog) ? exLog : null;
    $('sw-chart-note').textContent = t('sweep.note.' + measure, { shift: shift == null ? '—' : shift.toFixed(2) });
    const yTick = measure === 'digits' ? (v) => String(Math.round(v)) : (v) => `1e${Math.round(v)}`.replace('-', '−');
    renderLineChart($('sw-chart-p'), {
      xs,
      series: [
        { id: 'measured', label: t('sweep.measured'), color: 'var(--series-1)', values: vals },
        { id: 'best', label: t('sweep.best'), color: 'var(--series-3)', values: best, dashed: true, width: 1.5 },
        ...(bound ? [{ id: 'bound', label: t('sweep.bound'), color: 'var(--muted)', values: bound, dotted: true, width: 1.25 }] : []),
      ],
      yMin, yMax, markers,
      bands: measure === 'digits' ? [{ y: level, label: t('chart.exact') }] : [],
      yLabel: measure === 'abs' ? t('sweep.axisAbs') : measure === 'rel' ? t('sweep.axisRel') : t('chart.digits'),
      xLabel: t('sweep.axisP'),
      yTick,
      legend: 'items',
      tipTitle: (x, i) => `${t('sweep.tipP', { p: x })} → ${rows[i].final.value}`,
      tipValue: (s, v, i) => {
        const f = rows[i].final;
        if (s.id === 'measured') {
          if (f.status === 'exact') return t('sweep.exactPoint');
          if (f.digits == null) return t('sweep.notComparable');
          const dg = digitsText(digitsInfo(f.digits, fullDigits(rows[i].p)));
          if (measure === 'digits') return dg;
          const errTxt = measure === 'rel' ? f.relText : f.absText;
          return `${errTxt ?? ''} · ${t('badge.digits', { d: dg })}`;
        }
        if (s.id === 'best') {
          if (f.bestDigits === Infinity) return t('sweep.exactPoint');
          if (f.bestDigits == null && f.bestText == null) return '—';
          const dg = f.bestDigits == null ? '—' : digitsText(digitsInfo(f.bestDigits, fullDigits(rows[i].p)));
          if (measure === 'digits') return dg;
          const errTxt = measure === 'rel' ? f.bestRelText : f.bestText;
          return `${errTxt ?? '—'} · ${t('badge.digits', { d: dg })}`;
        }
        return v == null ? '—' : measure === 'digits' ? v.toFixed(1) : `1e${v.toFixed(1)}`;
      },
      onPick: (x) => api.openPrecision(x, out.expBits),
      ariaLabel: t('sweep.chartP'),
      height: 260,
    });
  }

  function renderChartSteps() {
    const n = Math.min(parseInt($('sw-lines').value, 10) || 10, out.rows.length);
    const pick = [];
    for (let i = 0; i < n; i++) {
      const idx = n === 1 ? out.rows.length - 1 : Math.round((i / (n - 1)) * (out.rows.length - 1));
      if (!pick.includes(idx)) pick.push(idx);
    }
    const steps = out.meta.steps;
    const xs = steps.map((s) => s.id);
    // One common, labelled "exact" level above the largest capacity shown (as in the other charts).
    const level = exactLevel(fullDigits(Math.max(...pick.map((idx) => out.rows[idx].p))));
    const series = pick.map((idx, i) => {
      const r = out.rows[idx];
      return {
        id: 'p' + r.p,
        label: `p=${r.p}`,
        color: seqColor(i, pick.length),
        values: Array.from(r.digits, (d) => {
          if (Number.isNaN(d)) return null;
          const dg = digitsInfo(d, fullDigits(r.p));
          return dg.shown === Infinity ? level : dg.shown;
        }),
      };
    });
    renderLineChart($('sw-chart-steps'), {
      xs,
      series,
      yMin: 0,
      yMax: Math.ceil(level + 1),
      bands: [{ y: level, label: t('chart.exact') }],
      yLabel: t('chart.digits'),
      xTick: (x) => '#' + x,
      legend: { gradient: [0, 3, 6, 9].map((k) => `var(--seq-${k})`), low: `${t('sweep.legendLow')} (p=${out.rows[pick[0]].p})`, high: `${t('sweep.legendHigh')} (p=${out.rows[pick[pick.length - 1]].p})`, note: t('sweep.linesShown', { n: pick.length, total: out.rows.length }) },
      tipTitle: (x) => `#${x} ${steps[x].text}`,
      tipValue: (s, v, i) => {
        const row = out.rows[pick[series.indexOf(s)]];
        const raw = row.digits[i];
        return Number.isNaN(raw) ? '—' : raw === Infinity ? t('chart.exact') : digitsText(digitsInfo(raw, fullDigits(row.p)));
      },
      onPick: (x) => api.openPrecision(out.rows[pick[pick.length - 1]].p, out.expBits, x),
      ariaLabel: t('sweep.chartSteps'),
      height: 260,
    });
  }

  function renderTable() {
    const head = `<thead><tr><th>p</th><th>${t('sweep.col.value')}</th><th>${t('sweep.col.abs')}</th><th>${t('sweep.col.digits')}</th><th></th></tr></thead>`;
    const body = out.rows.map((r) => {
      const f = r.final;
      if (!f) return '';
      // same capped figure and colour thresholds as the badges of the other views
      const dg = digitsInfo(f.digits, fullDigits(r.p));
      const q = dg.shown == null ? 'q-bad' : qualityOf(dg.shown, dg.full);
      const d = f.status === 'exact' ? `<span class="badge q-exact">${t('badge.exact')}</span>`
        : dg.shown == null ? `<span class="badge q-bad" title="${escapeHtml(t('badge.mismatchTitle'))}">${t('badge.mismatch')}</span>`
          : `<span class="badge ${q}"${dg.capped ? ` title="${escapeHtml(digitsText(dg))}"` : ''}>${QUALITY_ICON[q] || ''}${escapeHtml(t('badge.digits', { d: dg.shown.toFixed(1) }))}</span>`;
      return `<tr><td class="num">${r.p}</td><td class="mono long">${escapeHtml(f.value)}</td><td class="mono">${escapeHtml(f.absText ?? (f.status === 'exact' ? '0' : '—'))}</td><td>${d}</td><td><button class="btn small" data-open="${r.p}" title="${escapeHtml(t('sweep.openTitle', { p: r.p }))}">${t('sweep.open')}</button></td></tr>`;
    }).join('');
    $('sw-table').innerHTML = head + `<tbody>${body}</tbody>`;
    $('sw-legend').innerHTML = badgeLegendHtml();
    $('sw-table').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => api.openPrecision(Number(b.dataset.open), out.expBits)));
  }

  function relang() {
    renderStatic();
    renderStatus();
    renderResults();
  }

  relang();
  return { relang, markStale, redraw: () => { if (out) { renderChartP(); renderChartSteps(); } } };
}
