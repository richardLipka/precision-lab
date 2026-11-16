// Detail panel for one step in one format: what happened (explanation),
// operands, the exact result before rounding, the two neighbouring
// representable numbers, the bit pattern and the error.

import {
  shortestDecimal, encode, binarySci, fpToFraction, fpEquals, exactShort, ulpOf, formatFacts, CASTS, FORMATS,
} from '../engine/ieee.js';
import { exactDecimal, fmtFrac } from '../engine/rational.js';
import { compareToExact, localError, correctDigits, QUALITY_GOOD, QUALITY_MID } from '../engine/metrics.js';
import { explainStep } from '../engine/explain.js';
import { approxText, MAX_DEC_EXP } from '../engine/real.js';
import { OP_SYMBOL } from '../engine/evaluator.js';
import { COMPARISONS } from '../engine/parser.js';
import { escapeHtml } from './chart.js';
import { t } from '../i18n.js';
import { binaryOperationHtml } from './binaryView.js';

export function fmtErr(r, digits = 4) {
  if (!r) return '—';
  if (r.n === 0n) return '0';
  return fmtFrac(r, digits, { plainMin: -3, plainMax: 5 });
}

/**
 * Displayed correct digits (see correctDigits in metrics.js): the capped figure,
 * followed by the measured −log10(relative error) when that was higher.
 */
export function digitsText(info, decimals = 1) {
  if (info.shown == null) return '—';
  if (info.shown === Infinity) return '∞';
  return info.shown.toFixed(decimals) + (info.capped ? ' ' + t('digits.measured', { raw: info.raw.toFixed(decimals) }) : '');
}

/** Translated format name. */
export function fmtName(fmt) {
  if (fmt.id === 'custom') return fmt.expBits ? t('fmt.custom', { p: fmt.p, e: fmt.expBits }) : t('fmt.customUnb', { p: fmt.p });
  const k = 'fmt.name.' + fmt.id;
  const s = t(k);
  return s === k ? fmt.name : s;
}

/** Small chip naming the main cause of the difference. */
export function causeChip(cause) {
  if (!cause) return '';
  return `<span class="cause cause-${cause.tone}" title="${escapeHtml(t('cause.' + cause.code + '.tip'))}">${escapeHtml(t('cause.' + cause.code, cause.params))}</span>`;
}

/**
 * Icons that carry the quality of a badge without colour (the same in every
 * view): none for good, ◐ for partly lost, ✕ for mostly lost. ▲ / ▼ are kept
 * for "better" / "worse" in the Rearrange view, so no glyph changes meaning.
 */
export const QUALITY_ICON = { 'q-mid': '◐ ', 'q-bad': '✕ ' };

/** IEEE exception flags as the step table abbreviates them. */
export const FLAG_ABBR = [['overflow', 'OVF'], ['underflow', 'UNF'], ['divByZero', 'DIV0'], ['invalid', 'INV']];

/** Abbreviated flags of a result, each with its meaning as a title (also listed in the legend). */
export function flagMiniHtml(flags) {
  return FLAG_ABBR.filter(([k]) => flags?.[k]).map(([k, a]) => `<span class="flag-mini" title="${escapeHtml(t('flag.' + k))}">${a}</span>`).join('');
}

/**
 * Visible key to the badges (and, for the step table, to the arrows, chips and
 * flags): what is otherwise only in hover titles must be readable on touch
 * screens too. The thresholds come from metrics.js, as for the badges themselves.
 */
export function badgeLegendHtml({ table = false } = {}) {
  const good = Math.round(QUALITY_GOOD * 100);
  const mid = Math.round(QUALITY_MID * 100);
  const unit = t('badge.digits', { d: '' }).trim();
  const sample = (q, d) => `<span class="badge ${q}">${QUALITY_ICON[q] || ''}${escapeHtml(t('badge.digits', { d }))}</span>`;
  const items = [
    `<span><span class="badge q-exact">${escapeHtml(t('badge.exact'))}</span> ${escapeHtml(t('legend.exact'))}</span>`,
    `<span>${escapeHtml(t('legend.unit', { unit }))} ${sample('q-good', '7.0')} ${escapeHtml(t('legend.good', { pct: good }))}, ${sample('q-mid', '4.0')} ${escapeHtml(t('legend.mid', { lo: mid, hi: good }))}, ${sample('q-bad', '1.0')} ${escapeHtml(t('legend.bad', { pct: mid }))}</span>`,
  ];
  if (table) {
    items.push(
      `<span>${escapeHtml(t('legend.zero'))}</span>`,
      `<span><span class="dir">↑</span> / <span class="dir">↓</span> ${escapeHtml(t('legend.dir'))}</span>`,
      `<span><span class="cause">${escapeHtml(t('cause.round'))}</span> ${escapeHtml(t('legend.chip'))}</span>`,
      `<span>${FLAG_ABBR.map(([k, a]) => `<span class="flag-mini">${a}</span> ${escapeHtml(t('flag.' + k))}`).join(', ')}</span>`,
    );
  }
  return `<div class="legend small"><b>${escapeHtml(t('legend.title'))}</b> ${items.join('<span class="legend-sep" aria-hidden="true"> · </span>')}</div>`;
}

const TONE_ICON = { good: '✓', info: 'ℹ', warn: '!', bad: '✕' };

export function explanationHtml(items) {
  return `<ul class="explain">${items.map((it) => `<li class="ex-${it.tone}"><span class="ex-icon" aria-hidden="true">${TONE_ICON[it.tone] || 'ℹ'}</span><span>${escapeHtml(t(it.code, it.params))}</span></li>`).join('')}</ul>`;
}

function decimalBlock(r, max = 1200) {
  const d = exactDecimal(r, max);
  let note;
  if (d.period > 0) note = t('det.periodic', { n: d.period });
  else if (d.truncated) note = t('det.truncated');
  else note = t('det.exactDigits', { n: d.text.replace(/[^0-9]/g, '').replace(/^0+/, '').length });
  return `<div class="mono long">${escapeHtml(d.text)}</div><span class="muted small">${escapeHtml(note)}</span>`;
}

/**
 * A true value beyond ±10^±MAX_DEC_EXP (exp(±10⁶)): the reference holds only a
 * stand-in (∞ or 0), so only its range is written: "> 10^100000", "0 < |x| < 10^−100000".
 */
function beyondText(x) {
  if (x.kind === 'inf') return `${x.sign ? '< −' : '> '}10^${MAX_DEC_EXP}`;
  if (x.kind === 'nan') return '?';
  return `0 < |x| < 10^−${MAX_DEC_EXP}`;
}

/** Short text of a true value; irrational values get ≈ and only verified digits. */
export function trueText(x, digits = 20) {
  if (x.beyond) return beyondText(x);
  if (x.kind === 'finite' && x.approx) return '≈ ' + approxText(x, digits);
  return exactShort(x, digits);
}

function exactValText(x) {
  if (x.beyond) return `<div class="mono">${escapeHtml(beyondText(x))}</div>`;
  if (x.kind === 'finite' && x.approx) {
    return `<div class="mono long">≈ ${escapeHtml(approxText(x, 400))}…</div><span class="muted small">${escapeHtml(t(x.ziv ? 'det.ziv' : x.big ? 'det.big' : 'det.irrational', { v: Math.floor(x.reliable) }))}</span>`;
  }
  if (x.kind === 'nan') return `<span class="bad">${t('det.undefined')}</span> <span class="muted">(${escapeHtml(x.reason || t('det.notReal'))})</span>`;
  if (x.kind === 'inf') return x.sign ? '−∞' : '+∞';
  return decimalBlock(x.r);
}

function fractionText(r) {
  const s = r.toFraction();
  if (s.length > 400) return `<span class="muted">${t('det.fracLong', { a: r.n.toString().length, b: r.d.toString().length })}</span>`;
  return `<span class="mono long">${escapeHtml(s.replace('-', '−'))}</span>`;
}

function bitsHtml(v, fmt) {
  const enc = encode(v, fmt);
  if (enc.unbounded) {
    if (v.kind !== 'finite') return `<div class="muted">${escapeHtml(t('class.' + (v.kind === 'inf' ? 'infinity' : v.kind === 'nan' ? 'NaN' : 'zero')))}</div>`;
    const sig = enc.significand.length > 256 ? enc.significand.slice(0, 256) + '…' : enc.significand;
    return `<div class="bits"><span class="b-sign">${enc.sign}</span> <span class="b-frac">${sig[0]}.${sig.slice(1)}</span> × 2^${enc.exponentValue}</div>
      <div class="muted small">${t('det.unboundedBits')}</div>`;
  }
  const group = (s) => s.replace(/(.{4})/g, '$1​').split('').map((c) => (c === '​' ? '<wbr>' : c)).join('');
  const fracPart = fmt.explicitBit ? enc.fraction.slice(1) : enc.fraction;
  const fracShown = fracPart.length > 512 ? fracPart.slice(0, 512) + '…' : fracPart;
  const fracHtml = (fmt.explicitBit ? `<span class="b-int" title="${t('bits.int')}">${enc.fraction[0]}</span>` : '') + `<span class="b-frac">${group(fracShown)}</span>`;
  const expVal = parseInt(enc.exponent, 2);
  return `<div class="bits"><span class="b-sign" title="${t('bits.sign')}">${enc.sign}</span><span class="b-exp" title="${t('bits.exp', { n: fmt.expBits, b: fmt.bias })}">${group(enc.exponent)}</span>${fracHtml}</div>
    <div class="bits-legend small"><span><i class="b-sign"></i>${t('bits.sign')}</span><span><i class="b-exp"></i>${t('bits.exp', { n: fmt.expBits, b: fmt.bias })}</span>${fmt.explicitBit ? `<span><i class="b-int"></i>${t('bits.int')}</span>` : ''}<span><i class="b-frac"></i>${fmt.explicitBit ? t('bits.frac', { n: fmt.p - 1 }) : t('bits.fracHidden', { n: fmt.p - 1 })}</span></div>
    <div class="kv"><span>hex</span><span class="mono long">${enc.hex.length > 140 ? enc.hex.slice(0, 140) + '…' : enc.hex}</span></div>
    <div class="kv"><span>${t('bits.class')}</span><span>${t('class.' + enc.cls)}${enc.cls === 'normal' ? t('bits.expField', { f: expVal, b: fmt.bias, e: expVal - fmt.bias }) : ''}</span></div>`;
}

/** Number line with the two neighbours, their midpoint and the exact result. */
function numberLine(res, fmt) {
  const R = res.round;
  if (!R) return '';
  if (R.overflow) {
    return `<p class="bad">${escapeHtml(t('nl.overflow', { fmt: fmtName(fmt), v: shortestDecimal(res.value, fmt) }))}</p>`;
  }
  const W = 420;
  const H = 116;
  const x0 = 40;
  const x1 = W - 40;
  const y = 44;
  if (!R.inexact) {
    return `<svg class="numline" viewBox="0 0 ${W} 60" role="img" aria-label="${escapeHtml(t('nl.representable'))}">
      <line x1="${x0}" x2="${x1}" y1="30" y2="30" class="nl-axis"/>
      <circle cx="${W / 2}" cy="30" r="6" class="nl-chosen"/>
      <text x="${W / 2}" y="54" text-anchor="middle" class="nl-text">${escapeHtml(t('nl.representable'))}</text></svg>`;
  }
  const lo = R.below;
  const hi = R.above;
  let tt = 0.5;
  let gap = null; // the distance between the two neighbours = 1 ulp of this step
  const finite = (v) => v.kind === 'finite' || v.kind === 'zero';
  if (finite(lo) && finite(hi) && res.exactOp.kind === 'finite') {
    const a = fpToFraction(lo);
    const b = fpToFraction(hi);
    gap = b.sub(a);
    const f = res.exactOp.r.sub(a).div(gap);
    tt = Number((f.n * 1000000n) / f.d) / 1000000;
  }
  const yu = y + 54;
  const ulpMark = gap ? `<line x1="${x0}" x2="${x1}" y1="${yu}" y2="${yu}" class="nl-ulp"/>
    <line x1="${x0}" x2="${x0}" y1="${yu - 4}" y2="${yu + 4}" class="nl-ulp"/><line x1="${x1}" x2="${x1}" y1="${yu - 4}" y2="${yu + 4}" class="nl-ulp"/>
    <text x="${(x0 + x1) / 2}" y="${yu + 14}" text-anchor="middle" class="nl-text nl-ulp-text">${escapeHtml(t('nl.ulp', { ulp: fmtErr(gap, 4) }))}</text>` : '';
  const px = x0 + tt * (x1 - x0);
  const chosenX = fpEquals(res.value, hi) ? x1 : fpEquals(res.value, lo) ? x0 : null;
  const lab = (v) => (v.kind === 'inf' ? (v.sign ? '−∞' : '+∞') : shortestDecimal(v, fmt));
  const short = (s) => (s.length > 24 ? s.slice(0, 22) + '…' : s);
  return `<svg class="numline" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t('nl.aria'))}">
    <line x1="${x0 - 20}" x2="${x1 + 20}" y1="${y}" y2="${y}" class="nl-axis"/>
    <line x1="${(x0 + x1) / 2}" x2="${(x0 + x1) / 2}" y1="${y - 10}" y2="${y + 10}" class="nl-mid"/>
    <text x="${(x0 + x1) / 2}" y="${y + 24}" text-anchor="middle" class="nl-text muted-fill">${escapeHtml(t('nl.midpoint'))}</text>
    <circle cx="${x0}" cy="${y}" r="5" class="${chosenX === x0 ? 'nl-chosen' : 'nl-cand'}"/>
    <circle cx="${x1}" cy="${y}" r="5" class="${chosenX === x1 ? 'nl-chosen' : 'nl-cand'}"/>
    <path d="M${px},${y - 7} l-6,-11 h12 z" class="nl-exact"/>
    <text x="${Math.min(Math.max(px, 90), W - 90)}" y="${y - 22}" text-anchor="middle" class="nl-text">${escapeHtml(t('nl.exact', { pct: (tt * 100).toFixed(1) }))}</text>
    <text x="4" y="${y + 40}" text-anchor="start" class="nl-text mono-fill">${escapeHtml(short(lab(lo)))}</text>
    <text x="${W - 4}" y="${y + 40}" text-anchor="end" class="nl-text mono-fill">${escapeHtml(short(lab(hi)))}</text>
    ${ulpMark}
  </svg>`;
}

function flagList(flags) {
  if (!flags) return '';
  const keys = ['inexact', 'overflow', 'underflow', 'divByZero', 'invalid'];
  const on = keys.filter((k) => flags[k]).map((k) => `<span class="flag flag-${k}">${t('flag.' + k)}</span>`);
  return on.length ? on.join(' ') : `<span class="muted">${t('det.flagsNone')}</span>`;
}

function opDescription(step, steps, fmtId, fmt) {
  if (step.kind !== 'op') {
    const text = `<span class="mono">${escapeHtml(step.source ?? step.text)}</span>`;
    const target = fmt ? fmtName(fmt) : t('det.exactRational');
    return t(step.kind === 'input' ? 'det.convertInput' : 'det.convertLiteral', { text, target: escapeHtml(target) });
  }
  const opnd = step.operands.map((id) => {
    const s = steps[id];
    const v = fmtId === 'exact' ? trueText(s.exact, 20) : shortestDecimal(s.fmt[fmtId].value, fmt);
    const name = s.lastAssigned || (s.assigned && s.assigned[0]) || s.text;
    return `<a href="#" class="step-link" data-step="${id}">#${id}</a> <span class="muted">${escapeHtml(name)}</span> = <span class="mono">${escapeHtml(v.length > 60 ? v.slice(0, 58) + '…' : v)}</span>`;
  });
  if (step.op === 'fma') return t('det.fma', { a: opnd[0], b: opnd[1], c: opnd[2] });
  if (CASTS[step.op]) {
    const target = escapeHtml(fmtName(FORMATS.find((f) => f.id === CASTS[step.op])));
    return t(fmtId === 'exact' ? 'det.castExact' : 'det.cast', { a: opnd[0], target });
  }
  if (!OP_SYMBOL[step.op] && step.op !== 'neg' && step.op !== 'abs') return `${escapeHtml(step.op)}(${opnd.join(', ')})`;
  if (step.op === 'neg') return t('det.neg', { a: opnd[0] });
  if (step.op === 'abs') return t('det.abs', { a: opnd[0] });
  return `${opnd[0]}<br>${OP_SYMBOL[step.op]} ${opnd[1]}`;
}

export function renderDetail(host, ctx) {
  const { result, sel, formatsById } = ctx;
  if (!result || !sel || !result.steps[sel.step]) {
    host.innerHTML = `<div class="detail-empty"><h2>${t('det.title')}</h2><p class="muted">${t('det.empty')}</p></div>`;
    return;
  }
  const step = result.steps[sel.step];
  const steps = result.steps;
  const head = `<div class="detail-head"><button class="btn small fit-bits" type="button" title="${escapeHtml(t('det.fitTitle'))}">⇔ ${escapeHtml(t('det.fit'))}</button><span class="pill">#${step.id}</span><span class="mono">${escapeHtml(step.text)}</span>${step.iter ? `<span class="muted small">${t('det.iteration', { i: step.iter.join('.') })}</span>` : ''}${step.lastAssigned ? `<span class="muted small">→ ${escapeHtml(step.lastAssigned)}</span>` : ''}</div>`;
  const tabs = `<div class="detail-tabs" role="tablist">${['exact', ...result.formats.map((f) => f.id)].map((id) => `<button role="tab" class="tab ${sel.fmt === id ? 'active' : ''}" data-fmt="${id}" aria-selected="${sel.fmt === id}">${id === 'exact' ? t('steps.exact') : escapeHtml(formatsById[id].short)}</button>`).join('')}</div>`;

  if (sel.fmt === 'exact' || !formatsById[sel.fmt]) {
    const x = step.exact;
    host.innerHTML = `${head}${tabs}
      <section><h3>${t('det.opExact')}</h3><p>${opDescription(step, steps, 'exact', null)}</p></section>
      <section><h3>${t('det.trueValue')}</h3>${exactValText(x)}
      ${x.kind === 'finite' && !x.approx ? `<div class="kv"><span>${t('det.asFraction')}</span>${fractionText(x.r)}</div>` : ''}</section>
      <p class="muted small">${t('det.exactNote')}</p>`;
    bindLinks(host, ctx);
    return;
  }

  const fmt = formatsById[sel.fmt];
  const res = step.fmt[fmt.id];
  const v = res.value;
  const cmp = compareToExact(v, step.exact, fmt);
  const dg = correctDigits(cmp, fmt);
  const loc = localError(res, fmt);
  const R = res.round;
  const ex = explainStep(step, steps, fmt, result.mode);

  // The exact result of the operation on the STORED operands is not the true value:
  // say so, and relate the two to the error budget (new vs inherited error).
  const exactOpNote = step.kind === 'op' && !res.cast
    ? `<p class="muted small">${escapeHtml(t('det.exactBeforeNote', { fmt: fmtName(fmt), true: trueText(step.exact, 20) }))}</p>` : '';
  const roundingSection = R ? `
    <section><h3>${t('det.exactBefore')}</h3>${exactValText(res.exactOp)}${exactOpNote}</section>
    <section><h3>${escapeHtml(t('det.rounding', { fmt: fmtName(res.cast ? FORMATS.find((f) => f.id === res.cast.target) : fmt) }))} <span class="muted small">(${escapeHtml(t('mode.' + result.mode))})</span></h3>
      ${numberLine(res, fmt)}
      <div class="kv"><span>${t('det.direction')}</span><span>${R.direction === 'exact' ? t('det.noRounding') : R.direction === 'up' ? t('det.roundedUp') : t('det.roundedDown')}${R.inexact && !R.overflow ? ` · ${t('det.guard', { g: R.guard, s: R.sticky ? 1 : 0 })}` : ''}</span></div>
      <div class="kv"><span>${t('det.stepError')}</span><span>${loc ? `${fmtErr(loc.abs)} = ${fmtErr(loc.ulps, 3)} ulp` : '—'}</span></div>
      ${loc && R.inexact && !R.overflow ? `<div class="kv"><span>${t('det.stepUlp')}</span><span class="mono">${fmtErr(loc.ulp, 6)}</span></div>` : ''}
      <div class="kv"><span>${t('det.flags')}</span><span>${flagList(res.flags)}</span></div>
    </section>` : `<section><h3>${t('det.result')}</h3><p class="muted">${step.op === 'neg' || step.op === 'abs' ? t('det.signExact') : COMPARISONS.includes(step.op) ? t('det.compareExact') : t('det.specialRule')}</p><div class="kv"><span>${t('det.flags')}</span><span>${flagList(res.flags)}</span></div></section>`;

  const errSection = (() => {
    if (cmp.status === 'exact') return `<p class="good">${t('det.equal')}</p>`;
    if (cmp.status === 'both-nan') return `<p class="muted">${t('det.bothNan')}</p>`;
    if (cmp.status === 'both-inf') return `<p class="muted">${t('det.bothInf')}</p>`;
    if (cmp.status === 'mismatch') return `<p class="bad">${escapeHtml(t('det.mismatch', { v: shortestDecimal(v, fmt), x: trueText(step.exact) }))}</p>`;
    return `<div class="kv"><span>${t('det.absErr')}</span><span class="mono">${fmtErr(cmp.abs)}</span></div>
      <div class="kv"><span>${t('det.relErr')}</span><span class="mono">${cmp.rel ? fmtErr(cmp.rel) : t('det.relZero')}</span></div>
      <div class="kv"><span>${t('det.ulpErr')}</span><span class="mono">${fmtErr(cmp.ulps, 4)}</span></div>
      <div class="kv"><span>${t('det.digits')}</span><span class="mono">${cmp.rel ? dg.shown.toFixed(1) : '—'} <span class="muted">${t('det.of', { n: dg.full.toFixed(1) })}</span>${cmp.rel && dg.capped ? `<br><span class="muted small">${escapeHtml(t('det.digitsRaw', { raw: dg.raw.toFixed(2) }))}</span>` : ''}</span></div>`;
  })();

  const facts = formatFacts(fmt);
  // The chip's meaning is written out next to it (a title alone is unreachable on touch screens).
  const causeTip = ex.cause ? ` <span class="muted small cause-tip">${escapeHtml(t('cause.' + ex.cause.code + '.tip'))}</span>` : '';
  host.innerHTML = `${head}${tabs}
    <section class="what"><h3>${t('det.what')} ${causeChip(ex.cause)}${causeTip}</h3>${explanationHtml(ex.items)}</section>
    <section><h3>${escapeHtml(t('det.opIn', { fmt: fmtName(fmt) }))}</h3><p>${opDescription(step, steps, fmt.id, fmt)}</p></section>
    <section class="binary"><h3>${escapeHtml(t('bin.title'))}</h3>${binaryOperationHtml(step, steps, fmt, res, result.mode)}</section>
    ${roundingSection}
    <section><h3>${t('det.stored')}</h3>
      <div class="kv"><span>${t('det.shortest')}</span><div><span class="mono strong long">${escapeHtml(shortestDecimal(v, fmt))}</span><span class="muted small">${escapeHtml(t('det.shortestNote'))}</span></div></div>
      ${v.kind === 'finite' ? `<div class="kv"><span>${t('det.binary')}</span><span class="mono long">${escapeHtml(binarySci(v, fmt))}</span></div>` : ''}
      ${v.kind === 'finite' || v.kind === 'zero' ? `<div class="kv"><span>${t('det.storedExact')}</span><div>${decimalBlock(fpToFraction(v), 20000)}</div></div>` : ''}
      ${v.kind === 'finite' ? `<div class="kv"><span>${t('det.ulpHere')}</span><span class="mono">${fmtErr(ulpOf(v, fmt), 6)}</span></div>` : ''}
      ${bitsHtml(v, fmt)}
    </section>
    <section><h3>${t('det.compared')}</h3>
      <div class="kv"><span>${t('det.trueValue')}</span><span class="mono long">${escapeHtml(trueText(step.exact, 25))}</span></div>
      ${errSection}
    </section>
    ${fmt.id === 'x87' ? `<p class="muted small fmt-note">${escapeHtml(t('fmt.note.x87'))}</p>` : ''}
    <details><summary>${escapeHtml(t('det.about', { fmt: fmtName(fmt) }))}</summary>
      ${fmt.bounded ? `<p class="small">${escapeHtml(t('det.rangeVsPrecision', { p: fmt.p, d: dg.full.toFixed(1), e: fmt.expBits, min: fmtFrac(facts.minSubnormal, 3), max: fmtFrac(facts.max, 3) }))}</p>` : ''}
      <div class="kv"><span>${t('det.precision')}</span><span>${t('det.precisionVal', { p: fmt.p, d: dg.full.toFixed(2) })}</span></div>
      <div class="kv"><span>${t('det.eps')}</span><span class="mono">${fmtFrac(facts.epsilon, 6)}</span></div>
      <div class="kv"><span>${t('det.u')}</span><span class="mono">${fmtFrac(facts.unitRoundoff, 6)}</span></div>
      ${fmt.bounded ? `<div class="kv"><span>${t('det.expRange')}</span><span>${fmt.emin} … ${fmt.emax}</span></div>
      <div class="kv"><span>${t('det.max')}</span><span class="mono">${fmtFrac(facts.max, 8)}</span></div>
      <div class="kv"><span>${t('det.minNormal')}</span><span class="mono">${fmtFrac(facts.minNormal, 8)}</span></div>
      <div class="kv"><span>${t('det.minSub')}</span><span class="mono">${fmtFrac(facts.minSubnormal, 8)}</span></div>
      <div class="kv"><span>${t('det.storage')}</span><span>${t('det.storageVal', { n: fmt.totalBits })}</span></div>` : `<p class="muted">${t('det.unboundedFmt')}</p>`}
    </details>`;
  bindLinks(host, ctx);
}

function bindLinks(host, ctx) {
  host.querySelectorAll('.step-link').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    ctx.select(Number(a.dataset.step), ctx.sel.fmt);
  }));
  host.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => ctx.select(ctx.sel.step, b.dataset.fmt)));
  host.querySelector('.fit-bits')?.addEventListener('click', () => ctx.fitWidth?.());
}
