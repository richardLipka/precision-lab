// Bit-level view of one step: the operands as stored, the significands aligned
// as the hardware aligns them, the exact result with the kept bits, the guard
// bit and the sticky bits marked, the rounded result, and the formal notation
// x̂ = RN_p(a ∘ b) = (a ∘ b)(1 + δ).

import { encode, fpToFraction, shortestDecimal, exponentOf, binarySci } from '../engine/ieee.js';
import { floorLog2, fmtFrac, dyadic, Fraction } from '../engine/rational.js';
import { escapeHtml } from './chart.js';
import { t } from '../i18n.js';

const MAX_ALIGNED = 200; // columns of the aligned view
const EXTRA_BITS = 16; // discarded bits shown after the kept ones

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sub = (n) => String(n).split('').map((c) => SUB[c] ?? c).join('');
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

const ROUND_NAME = { RNE: 'RN', RNA: 'RNA', RZ: 'RZ', RU: 'RU', RD: 'RD' };
const OP_TEXT = { '+': '+', '-': '−', '*': '·', '/': '/' };

/** Compact coloured bit fields of a stored value (no legend). */
export function bitFields(v, fmt) {
  const enc = encode(v, fmt);
  if (enc.unbounded) {
    if (v.kind !== 'finite') return `<span class="mono">${escapeHtml(shortestDecimal(v, fmt))}</span>`;
    return `<span class="bits-inline"><span class="b-sign">${enc.sign}</span> <span class="b-frac">${enc.significand[0]}.${enc.significand.slice(1)}</span> ×2${sup(enc.exponentValue)}</span>`;
  }
  const frac = fmt.explicitBit
    ? `<span class="b-int">${enc.fraction[0]}</span><span class="b-frac">${enc.fraction.slice(1)}</span>`
    : `<span class="b-frac">${enc.fraction}</span>`;
  return `<span class="bits-inline"><span class="b-sign">${enc.sign}</span><span class="b-exp">${enc.exponent}</span>${frac}</span>`;
}

/**
 * Bits of |r| at the quantum of the format: kept bits (p of them, or fewer
 * leading zeros for subnormals), then EXTRA_BITS discarded bits.
 */
function splitBits(r, fmt) {
  const a = r.abs();
  const E = floorLog2(a);
  const Eeff = fmt.bounded && E < fmt.emin ? fmt.emin : E;
  const qe = Eeff - fmt.p + 1;
  const low = qe - EXTRA_BITS;
  const scaled = a.mul(dyadic(1n, -low));
  const N = scaled.n / scaled.d;
  const more = scaled.n % scaled.d !== 0n;
  const width = Eeff - low + 1;
  const s = N.toString(2).padStart(width, '0').slice(-width);
  let kept = s.slice(0, fmt.p);
  let disc = s.slice(fmt.p);
  if (!more) disc = disc.replace(/0+$/, '');
  if (kept.length > 300) kept = kept.slice(0, 300) + '…';
  return { E: Eeff, kept, disc, more, neg: r.s < 0n };
}

function sciRow(label, bits, cls = '') {
  return `<tr class="${cls}"><th>${label}</th><td class="mono bin-sci">${bits}</td></tr>`;
}

function keptHtml(kept) {
  return `<span class="bin-kept">${kept[0]}.${kept.slice(1)}</span>`;
}

function exactSciHtml(r, fmt) {
  const b = splitBits(r, fmt);
  const guard = b.disc[0] ?? '';
  const sticky = b.disc.slice(1);
  const tail = b.more ? '<span class="bin-more" title="' + escapeHtml(t('bin.more')) + '">…</span>' : `<span class="muted small"> ${escapeHtml(t('bin.ends'))}</span>`;
  return `${b.neg ? '−' : '+'}${keptHtml(b.kept)}<span class="bin-guard" title="${escapeHtml(t('bin.guard'))}">${guard}</span><span class="bin-sticky" title="${escapeHtml(t('bin.sticky'))}">${sticky}</span>${tail} ×2${sup(b.E)}`;
}

function storedSciHtml(v, fmt) {
  if (v.kind !== 'finite') return escapeHtml(shortestDecimal(v, fmt));
  const s = binarySci(v, fmt); // "1.0101 × 2^-3"
  const m = /^(−?)([01])\.([01]*) × 2\^(-?\d+)$/.exec(s);
  if (!m) return escapeHtml(s);
  const frac = m[3].length > 300 ? m[3].slice(0, 300) + '…' : m[3];
  return `${m[1] ? '−' : '+'}<span class="bin-kept">${m[2]}.${frac}</span> ×2${sup(m[4])}`;
}

/** Aligned positional view for + and −: the significands shifted to a common exponent. */
function alignedHtml(rows, cutQ) {
  // rows: {label, m (BigInt, ≥ 0), q, neg, cls, cut?}
  const nonzero = rows.filter((r) => r.m !== 0n);
  if (!nonzero.length) return '';
  const hi = Math.max(...nonzero.map((r) => r.q + r.m.toString(2).length - 1));
  const lo = Math.min(...nonzero.map((r) => r.q), cutQ);
  const width = hi - lo + 1;
  if (width > MAX_ALIGNED) return `<p class="muted small">${escapeHtml(t('bin.tooWide', { n: width }))}</p>`;
  const header = `<tr class="bin-head"><th></th><td class="mono">${Array.from({ length: width }, (_, i) => {
    const k = hi - i;
    const mark = k === 0 ? '0' : k % 4 === 0 ? '|' : ' ';
    return `${k === -1 ? '<span class="bin-point"> </span>' : ''}${mark}`;
  }).join('')}</td></tr>`;
  const body = rows.map((r) => {
    const top = r.m === 0n ? lo - 1 : r.q + r.m.toString(2).length - 1;
    const cells = [];
    for (let k = hi; k >= lo; k--) {
      let ch;
      if (r.m === 0n || k > top || k < r.q) ch = '<span class="bin-pad">·</span>';
      else ch = ((r.m >> BigInt(k - r.q)) & 1n) === 1n ? '1' : '0';
      if (r.cut && k < cutQ && !ch.includes('bin-pad')) ch = `<span class="${k === cutQ - 1 ? 'bin-guard' : 'bin-sticky'}">${ch}</span>`;
      if (k === -1) cells.push('<span class="bin-point">.</span>');
      cells.push(ch);
    }
    return `<tr class="${r.cls || ''}"><th>${r.label}</th><td class="mono">${r.neg ? '−' : '+'}${cells.join('')}</td></tr>`;
  }).join('');
  return `<div class="bin-scroll"><table class="bin-table">${header}${body}</table></div>
    <p class="muted small">${escapeHtml(t('bin.alignedNote', { hi, lo }))}</p>`;
}

function dyadicOf(r) {
  // r is a dyadic fraction: n / 2^k
  const k = r.d.toString(2).length - 1;
  return { m: r.n, q: -k };
}

function nameOf(s) {
  const n = s.lastAssigned || (s.assigned && s.assigned[0]);
  if (n && n.length <= 8) return n;
  return `#${s.id}`;
}

/** Formal notation of the step with the actual δ. */
function formalHtml(step, steps, fmt, res, mode) {
  const R = res.round;
  const rn = `${ROUND_NAME[mode]}${sub(fmt.p)}`;
  const names = step.operands.map((id) => nameOf(steps[id]));
  let expr;
  if (step.kind !== 'op') expr = escapeHtml(step.source ?? step.text);
  else if (OP_TEXT[step.op]) expr = `${names[0]} ${OP_TEXT[step.op]} ${names[1]}`;
  else if (step.op === 'fma') expr = `${names[0]}·${names[1]} + ${names[2]}`;
  else if (step.op === 'neg') expr = `−${names[0]}`;
  else if (step.op === 'abs') expr = `|${names[0]}|`;
  else expr = `${step.op}(${names.join(', ')})`;
  const lhs = step.lastAssigned && step.lastAssigned.length <= 8 ? `${step.lastAssigned}̂` : 'x̂';
  const lines = [];
  if (!R) {
    lines.push(`<div class="fx-line mono">${lhs} = ${expr}</div><div class="muted small">${escapeHtml(t(step.op === 'neg' || step.op === 'abs' ? 'fx.signExact' : 'fx.special'))}</div>`);
  } else {
    lines.push(`<div class="fx-line mono">${lhs} = ${rn}(${expr})</div><div class="muted small">${escapeHtml(t('fx.def'))}</div>`);
    const u = mode === 'RNE' || mode === 'RNA' ? `u = 2${sup(-fmt.p)}` : `2u = 2${sup(1 - fmt.p)}`;
    if (R.overflow) {
      lines.push(`<div class="fx-line mono">|${expr}| > Ω  ⇒  ${lhs} = ${escapeHtml(shortestDecimal(res.value, fmt))}</div><div class="muted small">${escapeHtml(t('fx.overflow'))}</div>`);
    } else if (res.exactOp.kind === 'finite' && (res.value.kind === 'finite' || res.value.kind === 'zero')) {
      const x = res.exactOp.r;
      const err = fpToFraction(res.value).sub(x);
      if (err.n === 0n) {
        lines.push(`<div class="fx-line mono">${lhs} = ${expr},  δ = 0</div><div class="muted small">${escapeHtml(t('fx.exact'))}</div>`);
      } else if (R.tiny) {
        const eta = fmtFrac(err, 3, { plainMin: -3, plainMax: 5 });
        const bound = `2${sup(fmt.emin - fmt.p)}`;
        lines.push(`<div class="fx-line mono">${lhs} = (${expr}) + η,  η = ${escapeHtml(eta)},  |η| ≤ ${bound}</div><div class="muted small">${escapeHtml(t('fx.subnormal'))}</div>`);
      } else {
        const delta = err.div(x);
        const d = fmtFrac(delta, 3, { plainMin: -3, plainMax: 5 });
        lines.push(`<div class="fx-line mono">${lhs} = (${expr})·(1 + δ),  δ = ${escapeHtml(d)},  |δ| ≤ ${u} ≈ ${escapeHtml(fmtFrac(dyadic(1n, mode === 'RNE' || mode === 'RNA' ? -fmt.p : 1 - fmt.p), 2))}</div><div class="muted small">${escapeHtml(t('fx.model'))}</div>`);
      }
    }
  }
  return `<div class="fx">${lines.join('')}</div>
    <details class="fx-more"><summary>${escapeHtml(t('fx.about'))}</summary><p class="small">${escapeHtml(t('fx.legend', { rn: ROUND_NAME[mode], p: fmt.p, mode: t('mode.' + mode) }))}</p><p class="small">${escapeHtml(t('fx.integer'))}</p></details>`;
}

/** The whole "bit by bit" section of the detail panel. */
export function binaryOperationHtml(step, steps, fmt, res, mode) {
  const parts = [];
  parts.push(`<h4>${escapeHtml(t('fx.title'))}</h4>${formalHtml(step, steps, fmt, res, mode)}`);

  // Operands as stored
  if (step.kind === 'op') {
    const rows = step.operands.map((id) => {
      const s = steps[id];
      const v = s.fmt[fmt.id].value;
      return `<tr><th><a href="#" class="step-link" data-step="${id}">#${id}</a> ${escapeHtml(nameOf(s))}</th><td><span class="mono small">${escapeHtml(shortestDecimal(v, fmt))}</span><div class="bin-scroll">${bitFields(v, fmt)}</div></td></tr>`;
    }).join('');
    parts.push(`<h4>${escapeHtml(t('bin.operands'))}</h4><table class="bin-ops">${rows}</table>`);
  }

  const R = res.round;
  const exactR = res.exactOp.kind === 'finite' ? res.exactOp.r : null;
  const v = res.value;

  // Aligned view for addition / subtraction of finite operands
  if (step.kind === 'op' && (step.op === '+' || step.op === '-') && exactR) {
    const ops = step.operands.map((id) => steps[id].fmt[fmt.id].value);
    if (ops.every((o) => o.kind === 'finite' || o.kind === 'zero')) {
      const row = (o, label, flip = false) => ({
        label, m: o.kind === 'zero' ? 0n : o.m, q: o.kind === 'zero' ? 0 : o.q, neg: (o.sign === 1) !== flip,
      });
      const ex = exactR.n === 0n ? { m: 0n, q: 0 } : dyadicOf(exactR.abs());
      const E = exactR.n === 0n ? 0 : floorLog2(exactR.abs());
      const cutQ = (fmt.bounded && E < fmt.emin ? fmt.emin : E) - fmt.p + 1;
      const rows = [
        row(ops[0], escapeHtml(nameOf(steps[step.operands[0]]))),
        row(ops[1], `${step.op === '-' ? '−' : '+'} ${escapeHtml(nameOf(steps[step.operands[1]]))}`, step.op === '-'),
        { label: '= ' + escapeHtml(t('bin.exact')), m: ex.m, q: ex.q, neg: exactR.s < 0n, cls: 'bin-exact', cut: true },
      ];
      if (v.kind === 'finite') rows.push({ label: '→ ' + escapeHtml(t('bin.result')), m: v.m, q: v.q, neg: v.sign === 1, cls: 'bin-result' });
      parts.push(`<h4>${escapeHtml(t('bin.aligned'))}</h4>${alignedHtml(rows, cutQ)}`);
    }
  }

  // Significands in binary scientific notation (all operations)
  const sci = [];
  if (step.kind === 'op') {
    for (const id of step.operands) {
      const o = steps[id].fmt[fmt.id].value;
      sci.push(sciRow(escapeHtml(nameOf(steps[id])), storedSciHtml(o, fmt)));
    }
  } else if (exactR) {
    sci.push(sciRow(escapeHtml(t('bin.literal')), exactR.n === 0n ? '0' : exactSciHtml(exactR, fmt), 'bin-exact'));
  }
  if (step.kind === 'op' && exactR && exactR.n !== 0n) sci.push(sciRow('= ' + escapeHtml(t('bin.exact')), exactSciHtml(exactR, fmt), 'bin-exact'));
  sci.push(sciRow('→ ' + escapeHtml(t('bin.result')), storedSciHtml(v, fmt), 'bin-result'));
  parts.push(`<h4>${escapeHtml(t('bin.scientific'))}</h4><div class="bin-scroll"><table class="bin-table">${sci.join('')}</table></div>
    <div class="bin-legend small"><span><i class="bin-kept"></i>${escapeHtml(t('bin.keptLegend', { p: fmt.p }))}</span><span><i class="bin-guard"></i>${escapeHtml(t('bin.guard'))}</span><span><i class="bin-sticky"></i>${escapeHtml(t('bin.sticky'))}</span></div>`);
  if (R && R.inexact && !R.overflow) {
    parts.push(`<p class="small">${escapeHtml(t('bin.decision', { g: R.guard, s: R.sticky ? 1 : 0, dir: t('dir.' + R.direction), mode: t('mode.' + mode) }))}</p>`);
  }
  return parts.join('');
}

export { Fraction, exponentOf };
