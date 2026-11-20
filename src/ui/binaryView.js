// Bit-level view of one step: the operands as stored, the significands aligned
// to a common exponent, the exact result with the kept bits, the guard bit and
// the sticky bits marked, the rounded result, and the formal notation
// x̂ = RN_p(a ∘ b) = (a ∘ b)(1 + δ).
//
// The view is conceptual, not a datapath: it aligns and adds at full width (up
// to MAX_ALIGNED columns) and names only two bits, the first discarded bit
// ("guard") and the OR of all later ones ("sticky"). Of the discarded part,
// those two decide every rounding exactly (ties to even also read the last kept
// bit, the directed modes the sign). A hardware adder keeps p + 3 bits (guard,
// round, sticky in the textbook G/R/S model); the extra bit only covers a
// one-place left shift of a difference, after which the bit beyond p is our
// guard bit again, so the decision is the same. The texts bin.alignedHw and
// bin.grs say this to the student; the adder argument is shown only for + and −
// (other operations get the short bin.grsShort).

import { encode, fpToFraction, shortestDecimal, binarySci, FORMATS } from '../engine/ieee.js';
import { COMPARISONS } from '../engine/parser.js';
import { floorLog2, fmtFrac, dyadic, Fraction } from '../engine/rational.js';
import { MAX_DEC_EXP } from '../engine/real.js';
import { escapeHtml } from './chart.js';
import { t } from '../i18n.js';

const MAX_ALIGNED = 200; // columns of the aligned view
const EXTRA_BITS = 16; // discarded bits shown after the kept ones
/** The aligned view adds up to this many empty columns so that the binary point (between 2⁰ and 2⁻¹) is drawn. */
const POINT_REACH = 8;

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sub = (n) => String(n).split('').map((c) => SUB[c] ?? c).join('');
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

const ROUND_NAME = { RNE: 'RN', RNA: 'RNA', RZ: 'RZ', RU: 'RU', RD: 'RD' };
const CMP_OPS = new Set(COMPARISONS);
const FORMAT_P = Object.fromEntries(FORMATS.map((f) => [f.id, f.p]));
const OP_TEXT = { '+': '+', '-': '−', '*': '·', '/': '/', '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

/** Compact coloured bit fields of a stored value (optional diff highlight against a peer). */
export function bitFields(v, fmt, peerEnc = null) {
  const enc = encode(v, fmt);
  if (enc.unbounded) {
    if (v.kind !== 'finite') return `<span class="mono">${escapeHtml(shortestDecimal(v, fmt))}</span>`;
    return `<span class="bits-inline"><span class="b-sign">${enc.sign}</span> <span class="b-frac">${enc.significand[0]}.${enc.significand.slice(1)}</span> ×2${sup(enc.exponentValue)}</span>`;
  }
  const mark = (s, other) => {
    if (!other || other.length !== s.length) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) out += s[i] !== other[i] ? `<span class="bit-diff">${s[i]}</span>` : s[i];
    return out;
  };
  const signHtml = `<span class="b-sign">${mark(enc.sign, peerEnc?.sign)}</span>`;
  const expHtml = `<span class="b-exp">${mark(enc.exponent, peerEnc?.exponent)}</span>`;
  const frac = fmt.explicitBit
    ? `<span class="b-int">${mark(enc.fraction[0], peerEnc?.fraction?.[0])}</span><span class="b-frac">${mark(enc.fraction.slice(1), peerEnc?.fraction?.slice(1))}</span>`
    : `<span class="b-frac">${mark(enc.fraction, peerEnc?.fraction)}</span>`;
  return `<span class="bits-inline">${signHtml}${expHtml}${frac}</span>`;
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
  // Exponent of the first 1 bit beyond the shown ones (the rest is scaled.n mod scaled.d, in units of 2^low).
  const nextOne = more ? low + floorLog2(new Fraction(scaled.n % scaled.d, scaled.d)) : null;
  return { E: Eeff, kept, disc, more, nextOne, neg: r.s < 0n };
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
  let tail;
  if (!b.more) tail = `<span class="muted small"> ${escapeHtml(t('bin.ends'))}</span>`;
  else if (!sticky.includes('1')) {
    // The shown sticky bits are all 0, yet sticky = 1: show where the hidden 1 is.
    const pos = `2${sup(b.nextOne)}`;
    tail = `<span class="bin-sticky bin-more" title="${escapeHtml(t('bin.stickyHidden', { pos }))}">…1</span><span class="muted small"> ${escapeHtml(t('bin.firstOne', { pos }))}</span>`;
  } else tail = '<span class="bin-more" title="' + escapeHtml(t('bin.more')) + '">…</span>';
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
function alignedHtml(rows, cutQ, { cancelledAbove = null, showCutoff = false } = {}) {
  // rows: {label, m (BigInt, ≥ 0), q, neg, cls, cut?, operand?}
  const nonzero = rows.filter((r) => r.m !== 0n);
  if (!nonzero.length) return '';
  let hi = Math.max(...nonzero.map((r) => r.q + r.m.toString(2).length - 1));
  let lo = Math.min(...nonzero.map((r) => r.q), cutQ);
  // The binary point sits between columns 2⁰ and 2⁻¹. Values below 1 (0.1 + 0.2)
  // or whole numbers would otherwise show no point at all; a few empty columns
  // bring it into view. Far away (1e-30) the note says where it is instead.
  if (hi < 0 && -hi <= POINT_REACH) hi = 0;
  if (lo > -1 && lo + 1 <= POINT_REACH) lo = -1;
  const hasPoint = hi >= 0 && lo <= -1;
  const hasCut = showCutoff && cutQ > lo && cutQ <= hi;
  const width = hi - lo + 1;
  if (width > MAX_ALIGNED) return `<p class="muted small">${escapeHtml(t('bin.tooWide', { n: width }))}</p>`;
  const cutMark = `<span class="bin-cut" title="${escapeHtml(t('bin.cutoff'))}">│</span>`;
  const header = `<tr class="bin-head"><th></th><td class="mono">${Array.from({ length: width }, (_, i) => {
    const k = hi - i;
    const mark = k === 0 ? '0' : k % 4 === 0 ? '|' : ' ';
    return `${hasCut && k === cutQ - 1 ? cutMark : ''}${k === -1 ? '<span class="bin-point"> </span>' : ''}${mark}`;
  }).join('')}</td></tr>`;
  const body = rows.map((r) => {
    const top = r.m === 0n ? lo - 1 : r.q + r.m.toString(2).length - 1;
    const cells = [];
    for (let k = hi; k >= lo; k--) {
      let ch;
      const isPad = r.m === 0n || k > top || k < r.q;
      if (isPad) ch = '<span class="bin-pad">·</span>';
      else ch = ((r.m >> BigInt(k - r.q)) & 1n) === 1n ? '1' : '0';
      if (!isPad) {
        if (r.cut && k < cutQ) ch = `<span class="${k === cutQ - 1 ? 'bin-guard' : 'bin-sticky'}">${ch}</span>`;
        else if (r.operand && cancelledAbove != null && k > cancelledAbove) ch = `<span class="bin-cancelled" title="${escapeHtml(t('bin.cancelled'))}">${ch}</span>`;
      }
      if (hasCut && k === cutQ - 1) cells.push(cutMark);
      if (k === -1) cells.push('<span class="bin-point">.</span>');
      cells.push(ch);
    }
    return `<tr class="${r.cls || ''}"><th>${r.label}</th><td class="mono">${r.neg ? '−' : '+'}${cells.join('')}</td></tr>`;
  }).join('');
  const legendItems = [];
  if (cancelledAbove != null) legendItems.push(`<span><i class="bin-cancelled"></i>${escapeHtml(t('bin.cancelled'))}</span>`);
  if (hasCut) legendItems.push(`<span><span class="bin-cut">│</span> ${escapeHtml(t('bin.cutoff'))}</span>`);
  const legendHtml = legendItems.length ? `<div class="bin-legend small">${legendItems.join('')}</div>` : '';
  return `<div class="bin-scroll"><table class="bin-table">${header}${body}</table></div>
    ${legendHtml}
    <p class="muted small">${escapeHtml(t(hasPoint ? 'bin.alignedNote' : 'bin.alignedNoteFar', { hi, lo }))}</p>`;
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
  // Round to nearest: error ≤ u (half a spacing); directed rounding: < 2u (a whole spacing).
  const nearest = mode === 'RNE' || mode === 'RNA';
  const names = step.operands.map((id) => nameOf(steps[id]));
  let expr;
  if (step.kind !== 'op') expr = escapeHtml(step.source ?? step.text);
  else if (OP_TEXT[step.op]) expr = `${escapeHtml(names[0])} ${escapeHtml(OP_TEXT[step.op])} ${escapeHtml(names[1])}`;
  else if (step.op === 'fma') expr = `${escapeHtml(names[0])}·${escapeHtml(names[1])} + ${escapeHtml(names[2])}`;
  else if (step.op === 'neg') expr = `−${escapeHtml(names[0])}`;
  else if (step.op === 'abs') expr = `|${escapeHtml(names[0])}|`;
  else expr = `${escapeHtml(step.op)}(${names.map(escapeHtml).join(', ')})`;
  const lhs = step.lastAssigned && step.lastAssigned.length <= 8 ? `${step.lastAssigned}̂` : 'x̂';
  const lines = [];
  if (!R) {
    const why = step.op === 'neg' || step.op === 'abs' ? 'fx.signExact' : CMP_OPS.has(step.op) ? 'fx.compare' : 'fx.special';
    lines.push(`<div class="fx-line mono">${lhs} = ${expr}</div><div class="muted small">${escapeHtml(t(why))}</div>`);
  } else if (res.cast) {
    // A cast rounds twice: into the target format, then back into this column's format.
    const pT = FORMAT_P[res.cast.target];
    lines.push(`<div class="fx-line mono">${lhs} = ${ROUND_NAME[mode]}${sub(fmt.p)}(${ROUND_NAME[mode]}${sub(pT)}(${escapeHtml(names[0])}))</div><div class="muted small">${escapeHtml(t('fx.cast', { pT, p: fmt.p }))}</div>`);
    if (res.exactOp.kind === 'finite' && res.exactOp.r.n !== 0n && res.value.kind === 'finite') {
      const delta = fpToFraction(res.value).sub(res.exactOp.r).div(res.exactOp.r);
      lines.push(`<div class="fx-line mono">${lhs} = ${escapeHtml(names[0])}·(1 + δ),  δ = ${escapeHtml(fmtFrac(delta, 3, { plainMin: -3, plainMax: 5 }))}</div>`);
    }
  } else {
    lines.push(`<div class="fx-line mono">${lhs} = ${rn}(${expr})</div><div class="muted small">${escapeHtml(t('fx.def', { rn: ROUND_NAME[mode], mode: t('mode.' + mode) }))}</div>`);
    const u = nearest ? `u = 2${sup(-fmt.p)}` : `2u = 2${sup(1 - fmt.p)}`;
    if (R.overflow) {
      lines.push(`<div class="fx-line mono">|${expr}| > Ω  ⇒  ${lhs} = ${escapeHtml(shortestDecimal(res.value, fmt))}</div><div class="muted small">${escapeHtml(t('fx.overflow'))}</div>`);
    } else if (res.exactOp.beyond) {
      lines.push(`<div class="muted small">${escapeHtml(t('fx.beyond', { max: MAX_DEC_EXP }))}</div>`);
    } else if (res.exactOp.kind === 'finite' && (res.value.kind === 'finite' || res.value.kind === 'zero')) {
      const x = res.exactOp.r;
      const err = fpToFraction(res.value).sub(x);
      if (err.n === 0n) {
        lines.push(`<div class="fx-line mono">${lhs} = ${expr},  δ = 0</div><div class="muted small">${escapeHtml(t('fx.exact'))}</div>`);
      } else if (R.tiny) {
        const eta = fmtFrac(err, 3, { plainMin: -3, plainMax: 5 });
        // Half the subnormal spacing 2^(emin−p+1) for rounding to nearest, less than a whole spacing for directed rounding.
        const bound = nearest ? `≤ 2${sup(fmt.emin - fmt.p)}` : `< 2${sup(fmt.emin - fmt.p + 1)}`;
        lines.push(`<div class="fx-line mono">${lhs} = (${expr}) + η,  η = ${escapeHtml(eta)},  |η| ${bound}</div><div class="muted small">${escapeHtml(t(nearest ? 'fx.subnormal' : 'fx.subnormalDirected'))}</div>`);
      } else {
        const delta = err.div(x);
        const d = fmtFrac(delta, 3, { plainMin: -3, plainMax: 5 });
        lines.push(`<div class="fx-line mono">${lhs} = (${expr})·(1 + δ),  δ = ${escapeHtml(d)},  |δ| ≤ ${u} ≈ ${escapeHtml(fmtFrac(dyadic(1n, nearest ? -fmt.p : 1 - fmt.p), 2))}</div><div class="muted small">${escapeHtml(t('fx.model'))}</div>`);
      }
    }
  }
  const how = t(nearest ? 'fx.how.nearest' : 'fx.how.directed');
  return `<div class="fx">${lines.join('')}</div>
    <details class="fx-more"><summary>${escapeHtml(t('fx.about'))}</summary><p class="small">${escapeHtml(t('fx.legend', { rn: ROUND_NAME[mode], p: fmt.p, mode: t('mode.' + mode), how }))}</p><p class="small">${escapeHtml(t('fx.integer'))}</p></details>`;
}

/**
 * The rule that turns (guard, sticky) into a direction, for the mode in use:
 * guard 0 = less than half a unit in the last place, guard 1 + sticky 1 = more
 * than half, guard 1 + sticky 0 = exactly half (a tie, decided by the last kept
 * bit under ties-to-even). Directed modes ignore "half" altogether.
 * @param {string|null} lastKept the last kept bit of the exact result ('0' / '1'), if known
 */
function decisionRule(R, mode, lastKept) {
  if (mode !== 'RNE' && mode !== 'RNA') return t('bin.rule.directed');
  if (R.guard === 0) return t('bin.rule.below');
  if (R.sticky) return t('bin.rule.above');
  if (mode === 'RNA') return t('bin.rule.tieAway');
  if (lastKept !== '0' && lastKept !== '1') return t('bin.rule.tieEvenAny');
  return t('bin.rule.tieEven', { last: lastKept, action: t(lastKept === '1' ? 'bin.tie.carry' : 'bin.tie.keep') });
}

/**
 * The whole "bit by bit" section of the detail panel: the concrete bits first
 * (operands, aligned significands with cancellation/cutoff highlights, scientific
 * form, the rounding decision), with G/R/S theory and formal notation tucked into
 * clean collapsible disclosures so the visual bit tables stay uncluttered.
 */
export function binaryOperationHtml(step, steps, fmt, res, mode) {
  const parts = [];
  const isCmp = step.kind === 'op' && CMP_OPS.has(step.op);

  // Operands as stored (on comparisons, diff-highlight the exact bits where operands differ)
  if (step.kind === 'op') {
    const peerEncs = isCmp && step.operands.length === 2
      ? step.operands.map((id) => {
        const ov = steps[id].fmt[fmt.id].value;
        return ov.kind === 'finite' || ov.kind === 'zero' ? encode(ov, fmt) : null;
      })
      : null;
    const rows = step.operands.map((id, idx) => {
      const s = steps[id];
      const v = s.fmt[fmt.id].value;
      const peer = peerEncs && peerEncs[0] && peerEncs[1] && !peerEncs[0].unbounded ? peerEncs[1 - idx] : null;
      return `<tr><th><a href="#" class="step-link" data-step="${id}">#${id}</a> ${escapeHtml(nameOf(s))}</th><td><span class="mono small">${escapeHtml(shortestDecimal(v, fmt))}</span><div class="bin-scroll">${bitFields(v, fmt, peer)}</div></td></tr>`;
    }).join('');
    parts.push(`<h4>${escapeHtml(t(isCmp ? 'bin.cmpOperands' : 'bin.operands'))}</h4><table class="bin-ops">${rows}</table>`);
  }

  const R = res.round;
  const exactR = res.exactOp.kind === 'finite' ? res.exactOp.r : null;
  const v = res.value;

  // Aligned view for addition / subtraction of finite operands
  let hasAligned = false;
  if (step.kind === 'op' && (step.op === '+' || step.op === '-') && exactR) {
    const ops = step.operands.map((id) => steps[id].fmt[fmt.id].value);
    if (ops.every((o) => o.kind === 'finite' || o.kind === 'zero')) {
      const row = (o, label, flip = false) => ({
        label, m: o.kind === 'zero' ? 0n : o.m, q: o.kind === 'zero' ? 0 : o.q, neg: (o.sign === 1) !== flip, operand: true,
      });
      const r0 = row(ops[0], escapeHtml(nameOf(steps[step.operands[0]])));
      const r1 = row(ops[1], `${step.op === '-' ? '−' : '+'} ${escapeHtml(nameOf(steps[step.operands[1]]))}`, step.op === '-');
      const ex = exactR.n === 0n ? { m: 0n, q: 0 } : dyadicOf(exactR.abs());
      const nonzeroOps = ops.filter((o) => o.kind === 'finite');
      const E = exactR.n === 0n ? null : floorLog2(exactR.abs());
      const cutQ = E == null
        ? (nonzeroOps.length ? Math.min(...nonzeroOps.map((o) => o.q)) : 0)
        : (fmt.bounded && E < fmt.emin ? fmt.emin : E) - fmt.p + 1;
      // Highlight cancelled leading bits whenever effective subtraction drops ≥ 2 leading bit columns.
      let cancelledAbove = null;
      if (r0.m !== 0n && r1.m !== 0n && r0.neg !== r1.neg) {
        const top0 = r0.q + r0.m.toString(2).length - 1;
        const top1 = r1.q + r1.m.toString(2).length - 1;
        const topOp = Math.min(top0, top1);
        const topRes = E == null ? Math.min(r0.q, r1.q) - 1 : E;
        if (topOp - topRes >= 2) cancelledAbove = topRes;
      }
      const rows = [
        r0, r1,
        { label: '= ' + escapeHtml(t('bin.exact')), m: ex.m, q: ex.q, neg: exactR.s < 0n, cls: 'bin-exact', cut: true },
      ];
      if (v.kind === 'finite') rows.push({ label: '→ ' + escapeHtml(t('bin.result')), m: v.m, q: v.q, neg: v.sign === 1, cls: 'bin-result' });
      const aligned = alignedHtml(rows, cutQ, { cancelledAbove, showCutoff: !!(R?.inexact && !R.overflow) });
      if (aligned) {
        hasAligned = true;
        parts.push(`<h4>${escapeHtml(t('bin.aligned'))}</h4>${aligned}`);
      }
    }
  }

  // Significands in binary scientific notation (omitted on comparisons, where operand bits above already tell the whole story)
  if (!isCmp) {
    const sci = [];
    if (step.kind === 'op') {
      for (const id of step.operands) {
        const o = steps[id].fmt[fmt.id].value;
        sci.push(sciRow(escapeHtml(nameOf(steps[id])), storedSciHtml(o, fmt)));
      }
    } else if (exactR) {
      sci.push(sciRow(escapeHtml(t('bin.literal')), exactR.n === 0n ? '0' : exactSciHtml(exactR, fmt), 'bin-exact'));
    }
    // A cast rounds the operand into its target format: mark the bits that format keeps.
    const cutFmt = res.cast ? FORMATS.find((f) => f.id === res.cast.target) : fmt;
    if (step.kind === 'op' && exactR && exactR.n !== 0n) sci.push(sciRow('= ' + escapeHtml(t('bin.exact')), exactSciHtml(exactR, cutFmt), 'bin-exact'));
    sci.push(sciRow('→ ' + escapeHtml(t('bin.result')), storedSciHtml(v, fmt), 'bin-result'));
    parts.push(`<h4>${escapeHtml(t('bin.scientific'))}</h4><div class="bin-scroll"><table class="bin-table">${sci.join('')}</table></div>
      <div class="bin-legend small"><span><i class="bin-kept"></i>${escapeHtml(t('bin.keptLegend', { p: cutFmt.p }))}</span><span><i class="bin-guard"></i>${escapeHtml(t('bin.guard'))}</span><span><i class="bin-sticky"></i>${escapeHtml(t('bin.sticky'))}</span></div>`);
    if (R && R.inexact && !R.overflow) {
      let lastKept = null;
      if (exactR && exactR.n !== 0n) {
        const kept = splitBits(exactR, cutFmt).kept;
        if (!kept.endsWith('…')) lastKept = kept[kept.length - 1];
      }
      const rule = decisionRule(R, mode, lastKept);
      parts.push(`<p class="small bin-decision">${escapeHtml(t('bin.decision', { g: R.guard, s: R.sticky ? 1 : 0, dir: t('dir.' + R.direction), mode: t('mode.' + mode), rule }))}</p>`);
      const hwNote = hasAligned ? `<p class="muted small bin-hw">${escapeHtml(t('bin.alignedHw'))}</p>` : '';
      parts.push(`<details class="info-fold bin-theory"><summary>${escapeHtml(t('bin.grsTitle'))}</summary>${hwNote}<p class="muted small bin-grs">${escapeHtml(t(step.op === '+' || step.op === '-' ? 'bin.grs' : 'bin.grsShort'))}</p></details>`);
    }
  }
  parts.push(`<details class="info-fold fx-fold"><summary>${escapeHtml(t('fx.title'))}</summary>${formalHtml(step, steps, fmt, res, mode)}</details>`);
  return parts.join('');
}
