// Bit- and digit-level view of one step across all format families:
//   * Binary floating-point (IEEE 754): bit fields, aligned significands (2^k),
//     binary scientific with kept p bits / guard bit / sticky bits, RN_p formal model.
//   * Decimal floating-point (IEEE 754 decimal64 BID & DPD): BID or DPD bit fields,
//     base-10 aligned digits (10^k), decimal scientific with kept 16 digits / guard
//     digit (0–9) / sticky digits, RN_{10,16} formal model.
//   * Fixed-point (Q16.16 binary, DEC(18,4) decimal): two's-complement / fixed-scale
//     operand fields, fixed-column grid (no exponent shifting, overflow & cutoff marked),
//     additive error formal model x̂ = Q_Δ(x) = x + η (with clamp / mod 2^W on overflow).

import { encode, fpToFraction, shortestDecimal, binarySci, maxFinite, minFinite, FORMATS } from '../engine/ieee.js';
import { COMPARISONS } from '../engine/parser.js';
import { floorLog2, floorLog10, fmtFrac, dyadic, frac, pow10, Fraction } from '../engine/rational.js';
import { MAX_DEC_EXP } from '../engine/real.js';
import { escapeHtml } from './chart.js';
import { t } from '../i18n.js';

const MAX_ALIGNED = 200; // columns of the aligned view
const EXTRA_BITS = 16; // discarded bits shown after the kept ones
const EXTRA_DEC = 8; // discarded decimal digits shown after the kept ones
const POINT_REACH = 8;

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const sub = (n) => String(n).split('').map((c) => SUB[c] ?? c).join('');
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

const ROUND_NAME = { RNE: 'RN', RNA: 'RNA', RZ: 'RZ', RU: 'RU', RD: 'RD' };
const CMP_OPS = new Set(COMPARISONS);
const FORMAT_P = Object.fromEntries(FORMATS.map((f) => [f.id, f.p]));
const OP_TEXT = { '+': '+', '-': '−', '*': '·', '/': '/', '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

function markDiff(s, other) {
  if (!other || other.length !== s.length) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) out += s[i] !== other[i] ? `<span class="bit-diff">${s[i]}</span>` : s[i];
  return out;
}

/** Compact coloured bit fields of a stored value (optional diff highlight against a peer). */
export function bitFields(v, fmt, peerEnc = null) {
  const enc = encode(v, fmt);
  if (fmt.family === 'decfloat') {
    if (enc.encoding === 'bid') {
      const s = `<span class="b-sign">${markDiff(enc.sign, peerEnc?.sign)}</span>`;
      const g = `<span class="b-comb">${markDiff(enc.comb, peerEnc?.comb)}</span>`;
      const cont = `<span class="b-frac">${markDiff(enc.cont, peerEnc?.cont)}</span>`;
      return `<span class="bits-inline">${s}${g}${cont}</span>`;
    }
    const s = `<span class="b-sign">${markDiff(enc.sign, peerEnc?.sign)}</span>`;
    const g5 = `<span class="b-comb">${markDiff(enc.comb5, peerEnc?.comb5)}</span>`;
    const ec = `<span class="b-exp">${markDiff(enc.eCont, peerEnc?.eCont)}</span>`;
    const decs = enc.declets.map((d, idx) => `<span class="b-declet">${markDiff(d, peerEnc?.declets?.[idx])}</span>`).join('');
    return `<span class="bits-inline">${s}${g5}${ec}${decs}</span>`;
  }
  if (fmt.fixed) {
    if (enc.cls === 'trap') return `<span class="mono bad">ERR</span>`;
    if (fmt.radix === 2) {
      const s = `<span class="b-sign">${markDiff(enc.sign, peerEnc?.sign)}</span>`;
      const ip = `<span class="b-int">${markDiff(enc.intPart, peerEnc?.intPart)}</span>`;
      const fpPart = `<span class="b-frac">${markDiff(enc.fracPart, peerEnc?.fracPart)}</span>`;
      return `<span class="bits-inline">${s}${ip}<span class="bin-point">.</span>${fpPart}</span>`;
    }
    const s = `<span class="b-sign">${markDiff(enc.sign, peerEnc?.sign)}</span>`;
    const body = `<span class="b-int">${markDiff(enc.intBits, peerEnc?.intBits)}</span>`;
    return `<span class="bits-inline">${s}${body}</span>`;
  }
  if (enc.unbounded) {
    if (v.kind !== 'finite') return `<span class="mono">${escapeHtml(shortestDecimal(v, fmt))}</span>`;
    return `<span class="bits-inline"><span class="b-sign">${enc.sign}</span> <span class="b-frac">${enc.significand[0]}.${enc.significand.slice(1)}</span> ×2${sup(enc.exponentValue)}</span>`;
  }
  const signHtml = `<span class="b-sign">${markDiff(enc.sign, peerEnc?.sign)}</span>`;
  const expHtml = `<span class="b-exp">${markDiff(enc.exponent, peerEnc?.exponent)}</span>`;
  const fracHtml = fmt.explicitBit
    ? `<span class="b-int">${markDiff(enc.fraction[0], peerEnc?.fraction?.[0])}</span><span class="b-frac">${markDiff(enc.fraction.slice(1), peerEnc?.fraction?.slice(1))}</span>`
    : `<span class="b-frac">${markDiff(enc.fraction, peerEnc?.fraction)}</span>`;
  return `<span class="bits-inline">${signHtml}${expHtml}${fracHtml}</span>`;
}

// ---------------------------------------------------------------------------
// Binary floating-point helpers
// ---------------------------------------------------------------------------

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
  const nextOne = more ? low + floorLog2(new Fraction(scaled.n % scaled.d, scaled.d)) : null;
  return { E: Eeff, kept, disc, more, nextOne, neg: r.s < 0n };
}

function sciRow(label, content, cls = '') {
  return `<tr class="${cls}"><th>${label}</th><td class="mono bin-sci">${content}</td></tr>`;
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
    const pos = `2${sup(b.nextOne)}`;
    tail = `<span class="bin-sticky bin-more" title="${escapeHtml(t('bin.stickyHidden', { pos }))}">…1</span><span class="muted small"> ${escapeHtml(t('bin.firstOne', { pos }))}</span>`;
  } else tail = '<span class="bin-more" title="' + escapeHtml(t('bin.more')) + '">…</span>';
  return `${b.neg ? '−' : '+'}${keptHtml(b.kept)}<span class="bin-guard" title="${escapeHtml(t('bin.guard'))}">${guard}</span><span class="bin-sticky" title="${escapeHtml(t('bin.sticky'))}">${sticky}</span>${tail} ×2${sup(b.E)}`;
}

function storedSciHtml(v, fmt) {
  if (v.kind !== 'finite') return escapeHtml(shortestDecimal(v, fmt));
  const s = binarySci(v, fmt);
  const m = /^(−?)([01])\.([01]*) × 2\^(-?\d+)$/.exec(s);
  if (!m) return escapeHtml(s);
  const fracStr = m[3].length > 300 ? m[3].slice(0, 300) + '…' : m[3];
  return `${m[1] ? '−' : '+'}<span class="bin-kept">${m[2]}.${fracStr}</span> ×2${sup(m[4])}`;
}

function alignedHtml(rows, cutQ, { cancelledAbove = null, showCutoff = false, overflowAbove = null } = {}) {
  const nonzero = rows.filter((r) => r.m !== 0n);
  if (!nonzero.length) return '';
  let hi = Math.max(...nonzero.map((r) => r.q + r.m.toString(2).length - 1));
  let lo = Math.min(...nonzero.map((r) => r.q), cutQ);
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
  let hasOvf = false;
  const body = rows.map((r) => {
    const top = r.m === 0n ? lo - 1 : r.q + r.m.toString(2).length - 1;
    const cells = [];
    for (let k = hi; k >= lo; k--) {
      let ch;
      const isPad = r.m === 0n || k > top || k < r.q;
      if (isPad) ch = '<span class="bin-pad">·</span>';
      else ch = ((r.m >> BigInt(k - r.q)) & 1n) === 1n ? '1' : '0';
      if (!isPad) {
        if (r.cut && overflowAbove != null && k > overflowAbove) {
          hasOvf = true;
          ch = `<span class="bin-ovf" title="${escapeHtml(t('bin.overflowBits'))}">${ch}</span>`;
        } else if (r.cut && k < cutQ) {
          ch = `<span class="${k === cutQ - 1 ? 'bin-guard' : 'bin-sticky'}">${ch}</span>`;
        } else if (r.operand && cancelledAbove != null && k > cancelledAbove) {
          ch = `<span class="bin-cancelled" title="${escapeHtml(t('bin.cancelled'))}">${ch}</span>`;
        }
      }
      if (hasCut && k === cutQ - 1) cells.push(cutMark);
      if (k === -1) cells.push('<span class="bin-point">.</span>');
      cells.push(ch);
    }
    return `<tr class="${r.cls || ''}"><th>${r.label}</th><td class="mono">${r.neg ? '−' : '+'}${cells.join('')}</td></tr>`;
  }).join('');
  const legendItems = [];
  if (cancelledAbove != null) legendItems.push(`<span><i class="bin-cancelled"></i>${escapeHtml(t('bin.cancelled'))}</span>`);
  if (hasOvf) legendItems.push(`<span><i class="bin-ovf"></i>${escapeHtml(t('bin.overflowBits'))}</span>`);
  if (hasCut) legendItems.push(`<span><span class="bin-cut">│</span> ${escapeHtml(t('bin.cutoff'))}</span>`);
  const legendHtml = legendItems.length ? `<div class="bin-legend small">${legendItems.join('')}</div>` : '';
  return `<div class="bin-scroll"><table class="bin-table">${header}${body}</table></div>
    ${legendHtml}
    <p class="muted small">${escapeHtml(t(hasPoint ? 'bin.alignedNote' : 'bin.alignedNoteFar', { hi, lo }))}</p>`;
}

function dyadicOf(r) {
  const k = r.d.toString(2).length - 1;
  return { m: r.n, q: -k };
}

// ---------------------------------------------------------------------------
// Decimal floating-point (decimal64) & decimal fixed-point helpers
// ---------------------------------------------------------------------------

function splitDecimalDigits(r, fmt) {
  const a = r.abs();
  const E = floorLog10(a);
  const Eeff = E < fmt.emin ? fmt.emin : E;
  const qe = Eeff - fmt.p + 1;
  const low = qe - EXTRA_DEC;
  const scaled = low >= 0 ? a.div(frac(pow10(low), 1n)) : a.mul(frac(pow10(-low), 1n));
  const N = scaled.n / scaled.d;
  const more = scaled.n % scaled.d !== 0n;
  const width = Eeff - low + 1;
  const s = N.toString().padStart(width, '0').slice(-width);
  const kept = s.slice(0, fmt.p);
  let disc = s.slice(fmt.p);
  if (!more) disc = disc.replace(/0+$/, '');
  const nextPos = more ? low + floorLog10(new Fraction(scaled.n % scaled.d, scaled.d)) : null;
  return { E: Eeff, kept, disc, more, nextPos, neg: r.s < 0n };
}

function exactDecSciHtml(r, fmt) {
  const b = splitDecimalDigits(r, fmt);
  const guard = b.disc[0] ?? '';
  const sticky = b.disc.slice(1);
  let tail;
  if (!b.more) tail = `<span class="muted small"> ${escapeHtml(t('bin.ends'))}</span>`;
  else if (/^0*$/.test(sticky)) {
    const pos = `10${sup(b.nextPos)}`;
    tail = `<span class="bin-sticky bin-more" title="${escapeHtml(t('bin.stickyHiddenDec', { pos }))}">…d</span><span class="muted small"> ${escapeHtml(t('bin.firstNonZeroDec', { pos }))}</span>`;
  } else tail = '<span class="bin-more" title="' + escapeHtml(t('bin.moreDec')) + '">…</span>';
  return `${b.neg ? '−' : '+'}${keptHtml(b.kept)}<span class="bin-guard" title="${escapeHtml(t('bin.guardDec'))}">${guard}</span><span class="bin-sticky" title="${escapeHtml(t('bin.stickyDec'))}">${sticky}</span>${tail} ×10${sup(b.E)}`;
}

function storedDecSciHtml(v, fmt) {
  if (v.kind !== 'finite') return escapeHtml(shortestDecimal(v, fmt));
  const s = v.m.toString();
  const E = s.length - 1 + v.q;
  const disp = s.length > 1 ? `${s[0]}.${s.slice(1)}` : s;
  return `${v.sign ? '−' : '+'}<span class="bin-kept">${disp}</span> ×10${sup(E)} <span class="muted small">(${v.sign ? '−' : ''}${s}×10${sup(v.q)})</span>`;
}

/** Exact decimal integer & exponent for a terminating base-10 fraction. */
function decimalOf(r) {
  let d = r.d;
  let a = 0;
  let b = 0;
  while ((d & 1n) === 0n) { d >>= 1n; a++; }
  while (d % 5n === 0n) { d /= 5n; b++; }
  if (d !== 1n) return null;
  let m = r.n;
  const q = -Math.max(a, b);
  if (a > b) m *= 5n ** BigInt(a - b);
  else if (b > a) m <<= BigInt(b - a);
  return { m, q };
}

/** Aligned base-10 positional view for + and − in decimal64 (or fixed decimal). */
function alignedDecimalHtml(rows, cutQ, { cancelledAbove = null, showCutoff = false } = {}) {
  const nonzero = rows.filter((r) => r.m !== 0n);
  if (!nonzero.length) return '';
  let hi = Math.max(...nonzero.map((r) => r.q + r.m.toString().length - 1));
  let lo = Math.min(...nonzero.map((r) => r.q), cutQ);
  if (hi < 0 && -hi <= POINT_REACH) hi = 0;
  if (lo > -1 && lo + 1 <= POINT_REACH) lo = -1;
  const hasPoint = hi >= 0 && lo <= -1;
  const hasCut = showCutoff && cutQ > lo && cutQ <= hi;
  const width = hi - lo + 1;
  if (width > 100) return `<p class="muted small">${escapeHtml(t('bin.tooWideDec', { n: width }))}</p>`;
  const cutMark = `<span class="bin-cut" title="${escapeHtml(t('bin.cutoffDec'))}">│</span>`;
  const header = `<tr class="bin-head"><th></th><td class="mono">${Array.from({ length: width }, (_, i) => {
    const k = hi - i;
    const mark = k === 0 ? '0' : k % 3 === 0 ? '|' : ' ';
    return `${hasCut && k === cutQ - 1 ? cutMark : ''}${k === -1 ? '<span class="bin-point"> </span>' : ''}${mark}`;
  }).join('')}</td></tr>`;
  const body = rows.map((r) => {
    const digits = r.m === 0n ? '' : r.m.toString();
    const top = r.m === 0n ? lo - 1 : r.q + digits.length - 1;
    const cells = [];
    for (let k = hi; k >= lo; k--) {
      let ch;
      const isPad = r.m === 0n || k > top || k < r.q;
      if (isPad) ch = '<span class="bin-pad">·</span>';
      else ch = digits[top - k];
      if (!isPad) {
        if (r.cut && k < cutQ) ch = `<span class="${k === cutQ - 1 ? 'bin-guard' : 'bin-sticky'}">${ch}</span>`;
        else if (r.operand && cancelledAbove != null && k > cancelledAbove) ch = `<span class="bin-cancelled" title="${escapeHtml(t('bin.cancelledDec'))}">${ch}</span>`;
      }
      if (hasCut && k === cutQ - 1) cells.push(cutMark);
      if (k === -1) cells.push('<span class="bin-point">.</span>');
      cells.push(ch);
    }
    return `<tr class="${r.cls || ''}"><th>${r.label}</th><td class="mono">${r.neg ? '−' : '+'}${cells.join('')}</td></tr>`;
  }).join('');
  const legendItems = [];
  if (cancelledAbove != null) legendItems.push(`<span><i class="bin-cancelled"></i>${escapeHtml(t('bin.cancelledDec'))}</span>`);
  if (hasCut) legendItems.push(`<span><span class="bin-cut">│</span> ${escapeHtml(t('bin.cutoffDec'))}</span>`);
  const legendHtml = legendItems.length ? `<div class="bin-legend small">${legendItems.join('')}</div>` : '';
  return `<div class="bin-scroll"><table class="bin-table">${header}${body}</table></div>
    ${legendHtml}
    <p class="muted small">${escapeHtml(t(hasPoint ? 'bin.alignedNoteDec' : 'bin.alignedNoteFarDec', { hi, lo }))}</p>`;
}

/** Fixed-column grid for fixed-point Q16.16 (base 2) or DEC(18,4) (base 10) rounding/overflow. */
function fixedGridHtml(r, v, fmt, R) {
  const neg = r.s < 0n;
  const a = r.abs();
  const isDec = fmt.radix === 10;
  const fracPlaces = isDec ? fmt.scaleDigits : fmt.fracBits;
  const extra = isDec ? 6 : 10;
  const scaled = isDec
    ? a.mul(frac(pow10(fracPlaces + extra), 1n))
    : a.mul(dyadic(1n, fracPlaces + extra));
  const N = scaled.n / scaled.d;
  const more = scaled.n % scaled.d !== 0n;
  const rawStr = N.toString(isDec ? 10 : 2).padStart(fracPlaces + extra + 1, '0');
  const intStr = rawStr.slice(0, -(fracPlaces + extra));
  const keptFrac = rawStr.slice(-(fracPlaces + extra), -extra);
  let disc = rawStr.slice(-extra);
  if (!more) disc = disc.replace(/0+$/, '');
  const guard = disc[0] ?? '';
  const sticky = disc.slice(1);
  const intShow = intStr.length > 40 ? '…' + intStr.slice(-36) : intStr;
  const intSpan = R?.overflow
    ? `<span class="bin-ovf" title="${escapeHtml(t('bin.overflowBits'))}">${intShow}</span>`
    : `<span class="bin-kept">${intShow}</span>`;
  const fracSpan = `<span class="bin-kept">${keptFrac}</span>`;
  const discSpan = (guard || sticky || more)
    ? `<span class="bin-cut" title="${escapeHtml(t(isDec ? 'bin.cutoffDec' : 'bin.cutoff'))}">│</span><span class="bin-guard">${guard}</span><span class="bin-sticky">${sticky}${more ? '…' : ''}</span>`
    : `<span class="muted small"> ${escapeHtml(t('bin.ends'))}</span>`;
  const exactRow = `${neg ? '−' : '+'}${intSpan}<span class="bin-point">.</span>${fracSpan}${discSpan}`;
  let resRow;
  if (v.kind === 'nan') resRow = '<span class="bad">ERR</span>';
  else if (v.kind === 'zero') resRow = `+<span class="bin-kept">0.${'0'.repeat(fracPlaces)}</span>`;
  else {
    const s = v.m.toString(isDec ? 10 : 2).padStart(fracPlaces + 1, '0');
    resRow = `${v.sign ? '−' : '+'}<span class="bin-kept">${s.slice(0, -fracPlaces)}</span><span class="bin-point">.</span><span class="bin-kept">${s.slice(-fracPlaces)}</span>`;
  }
  const rows = [
    sciRow('= ' + escapeHtml(t('bin.exact')), exactRow, 'bin-exact'),
    sciRow('→ ' + escapeHtml(t('bin.result')), resRow, 'bin-result'),
  ];
  const legend = [
    `<span><i class="bin-kept"></i>${escapeHtml(t(isDec ? 'bin.fixedKeptDec' : 'bin.fixedKeptBin', { f: fracPlaces }))}</span>`,
    `<span><i class="bin-guard"></i>${escapeHtml(t(isDec ? 'bin.guardDec' : 'bin.guard'))}</span>`,
    `<span><i class="bin-sticky"></i>${escapeHtml(t(isDec ? 'bin.stickyDec' : 'bin.sticky'))}</span>`,
    ...(R?.overflow ? [`<span><i class="bin-ovf"></i>${escapeHtml(t('bin.overflowBits'))}</span>`] : []),
  ];
  return `<h4>${escapeHtml(t(isDec ? 'bin.fixedGridDec' : 'bin.fixedGridBin'))}</h4>
    <div class="bin-scroll"><table class="bin-table">${rows.join('')}</table></div>
    <div class="bin-legend small">${legend.join('')}</div>`;
}

function nameOf(s) {
  const n = s.lastAssigned || (s.assigned && s.assigned[0]);
  if (n && n.length <= 8) return n;
  return `#${s.id}`;
}

/** Formal notation of the step with actual δ or additive fixed-point error η. */
function formalHtml(step, steps, fmt, res, mode) {
  const R = res.round;
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

  if (fmt.fixed) {
    const stepStr = fmt.radix === 10 ? `10${sup(fmt.scaleExp)}` : `2${sup(fmt.scaleExp)}`;
    const qOp = `Q${sub(fmt.radix === 10 ? fmt.scaleDigits : fmt.fracBits)}`;
    if (!R) {
      const why = step.op === 'neg' || step.op === 'abs' ? 'fx.signExact' : CMP_OPS.has(step.op) ? 'fx.compare' : 'fx.fixedTrap';
      lines.push(`<div class="fx-line mono">${lhs} = ${expr}</div><div class="muted small">${escapeHtml(t(why))}</div>`);
    } else if (R.overflow) {
      const minS = shortestDecimal(minFinite(fmt), fmt);
      const maxS = shortestDecimal(maxFinite(fmt), fmt);
      if (R.overflowKind === 'wrap') {
        lines.push(`<div class="fx-line mono">${lhs} = (${qOp}(${expr}) mod 2${sup(fmt.totalBits)}·${stepStr}) = ${escapeHtml(shortestDecimal(res.value, fmt))}</div><div class="muted small">${escapeHtml(t('fx.fixedWrap', { bits: fmt.totalBits, min: minS, max: maxS }))}</div>`);
      } else {
        lines.push(`<div class="fx-line mono">${lhs} = clamp(${qOp}(${expr}), ${escapeHtml(minS)}, ${escapeHtml(maxS)}) = ${escapeHtml(shortestDecimal(res.value, fmt))}</div><div class="muted small">${escapeHtml(t('fx.fixedSat', { min: minS, max: maxS }))}</div>`);
      }
    } else if (res.exactOp.kind === 'finite' && (res.value.kind === 'finite' || res.value.kind === 'zero')) {
      const err = fpToFraction(res.value).sub(res.exactOp.r);
      if (err.n === 0n) {
        lines.push(`<div class="fx-line mono">${lhs} = ${expr},  η = 0</div><div class="muted small">${escapeHtml(t('fx.exact'))}</div>`);
      } else {
        const eta = fmtFrac(err, 3, { plainMin: -3, plainMax: 5 });
        const bound = nearest ? `≤ Δ/2 = ${escapeHtml(fmtFrac(fmt.step.div(2), 3))}` : `< Δ = ${escapeHtml(fmtFrac(fmt.step, 3))}`;
        lines.push(`<div class="fx-line mono">${lhs} = ${qOp}(${expr}) = (${expr}) + η,  η = ${escapeHtml(eta)},  |η| ${bound}</div><div class="muted small">${escapeHtml(t('fx.fixedModel', { step: stepStr }))}</div>`);
      }
    }
    return `<div class="fx">${lines.join('')}</div>`;
  }

  const isDec = fmt.family === 'decfloat';
  const rn = isDec ? `${ROUND_NAME[mode]}${sub(10)},${sub(fmt.p)}` : `${ROUND_NAME[mode]}${sub(fmt.p)}`;
  if (!R) {
    const why = step.op === 'neg' || step.op === 'abs' ? 'fx.signExact' : CMP_OPS.has(step.op) ? 'fx.compare' : 'fx.special';
    lines.push(`<div class="fx-line mono">${lhs} = ${expr}</div><div class="muted small">${escapeHtml(t(why))}</div>`);
  } else if (res.cast) {
    const pT = FORMAT_P[res.cast.target];
    lines.push(`<div class="fx-line mono">${lhs} = ${rn}(${ROUND_NAME[mode]}${sub(pT)}(${escapeHtml(names[0])}))</div><div class="muted small">${escapeHtml(t('fx.cast', { pT, p: fmt.p }))}</div>`);
    if (res.exactOp.kind === 'finite' && res.exactOp.r.n !== 0n && res.value.kind === 'finite') {
      const delta = fpToFraction(res.value).sub(res.exactOp.r).div(res.exactOp.r);
      lines.push(`<div class="fx-line mono">${lhs} = ${escapeHtml(names[0])}·(1 + δ),  δ = ${escapeHtml(fmtFrac(delta, 3, { plainMin: -3, plainMax: 5 }))}</div>`);
    }
  } else {
    lines.push(`<div class="fx-line mono">${lhs} = ${rn}(${expr})</div><div class="muted small">${escapeHtml(t('fx.def', { rn: ROUND_NAME[mode], mode: t('mode.' + mode) }))}</div>`);
    const uStr = isDec
      ? (nearest ? `u = 5·10${sup(-fmt.p)}` : `2u = 10${sup(1 - fmt.p)}`)
      : (nearest ? `u = 2${sup(-fmt.p)}` : `2u = 2${sup(1 - fmt.p)}`);
    const uNum = isDec
      ? fmtFrac(nearest ? frac(5n, pow10(fmt.p)) : frac(1n, pow10(fmt.p - 1)), 2)
      : fmtFrac(dyadic(1n, nearest ? -fmt.p : 1 - fmt.p), 2);
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
        const bound = isDec
          ? (nearest ? `≤ 5·10${sup(fmt.qmin - 1)}` : `< 10${sup(fmt.qmin)}`)
          : (nearest ? `≤ 2${sup(fmt.emin - fmt.p)}` : `< 2${sup(fmt.emin - fmt.p + 1)}`);
        lines.push(`<div class="fx-line mono">${lhs} = (${expr}) + η,  η = ${escapeHtml(eta)},  |η| ${bound}</div><div class="muted small">${escapeHtml(t(nearest ? 'fx.subnormal' : 'fx.subnormalDirected'))}</div>`);
      } else {
        const delta = err.div(x);
        const d = fmtFrac(delta, 3, { plainMin: -3, plainMax: 5 });
        lines.push(`<div class="fx-line mono">${lhs} = (${expr})·(1 + δ),  δ = ${escapeHtml(d)},  |δ| ≤ ${uStr} ≈ ${escapeHtml(uNum)}</div><div class="muted small">${escapeHtml(t('fx.model'))}</div>`);
      }
    }
  }
  const how = t(nearest ? 'fx.how.nearest' : 'fx.how.directed');
  return `<div class="fx">${lines.join('')}</div>
    <details class="fx-more"><summary>${escapeHtml(t('fx.about'))}</summary><p class="small">${escapeHtml(t(isDec ? 'fx.legendDec' : 'fx.legend', { rn: ROUND_NAME[mode], p: fmt.p, mode: t('mode.' + mode), how }))}</p><p class="small">${escapeHtml(t('fx.integer'))}</p></details>`;
}

function decisionRule(R, mode, lastKept, radix = 2) {
  if (mode !== 'RNE' && mode !== 'RNA') return t('bin.rule.directed');
  if (radix === 10) {
    if (R.guard < 5) return t('bin.rule.belowDec', { g: R.guard });
    if (R.guard > 5 || R.sticky) return t('bin.rule.aboveDec', { g: R.guard });
    if (mode === 'RNA') return t('bin.rule.tieAway');
    if (lastKept == null || !/^[0-9]$/.test(lastKept)) return t('bin.rule.tieEvenAny');
    const odd = Number(lastKept) % 2 === 1;
    return t('bin.rule.tieEvenDec', { last: lastKept, action: t(odd ? 'bin.tie.carryDec' : 'bin.tie.keepDec') });
  }
  if (R.guard === 0) return t('bin.rule.below');
  if (R.sticky) return t('bin.rule.above');
  if (mode === 'RNA') return t('bin.rule.tieAway');
  if (lastKept !== '0' && lastKept !== '1') return t('bin.rule.tieEvenAny');
  return t('bin.rule.tieEven', { last: lastKept, action: t(lastKept === '1' ? 'bin.tie.carry' : 'bin.tie.keep') });
}

/**
 * Full bit-by-bit (or digit-by-digit) section of the step detail panel.
 */
export function binaryOperationHtml(step, steps, fmt, res, mode) {
  const parts = [];
  const isCmp = step.kind === 'op' && CMP_OPS.has(step.op);
  const isDec = fmt.family === 'decfloat';
  const isFix = !!fmt.fixed;

  // Operands as stored (with diff highlighting on comparisons)
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

  // ---- Fixed-point path (Q16.16 & DEC(18,4)) ----
  if (isFix) {
    if (!isCmp && exactR && !res.exactOp.beyond) {
      parts.push(fixedGridHtml(exactR, v, fmt, R));
      if (R && R.inexact && !R.overflow) {
        const isD = fmt.radix === 10;
        const scale = -fmt.scaleExp;
        const scaled = isD ? exactR.abs().mul(frac(pow10(scale), 1n)) : exactR.abs().mul(dyadic(1n, scale));
        const intPart = scaled.n / scaled.d;
        const lastKept = isD ? intPart.toString().slice(-1) : String(intPart & 1n);
        const rule = decisionRule(R, mode, lastKept, fmt.radix);
        parts.push(`<p class="small bin-decision">${escapeHtml(t(isD ? 'bin.decisionDec' : 'bin.decision', { g: R.guard, s: R.sticky ? 1 : 0, dir: t('dir.' + R.direction), mode: t('mode.' + mode), rule }))}</p>`);
      }
    }
    parts.push(`<details class="info-fold fx-fold"><summary>${escapeHtml(t('fx.title'))}</summary>${formalHtml(step, steps, fmt, res, mode)}</details>`);
    return parts.join('');
  }

  // ---- Decimal floating-point path (decimal64 BID & DPD) ----
  if (isDec) {
    if (step.kind === 'op' && (step.op === '+' || step.op === '-') && exactR) {
      const ops = step.operands.map((id) => steps[id].fmt[fmt.id].value);
      if (ops.every((o) => o.kind === 'finite' || o.kind === 'zero')) {
        const row = (o, label, flip = false) => ({
          label, m: o.kind === 'zero' ? 0n : o.m, q: o.kind === 'zero' ? 0 : o.q, neg: (o.sign === 1) !== flip, operand: true,
        });
        const r0 = row(ops[0], escapeHtml(nameOf(steps[step.operands[0]])));
        const r1 = row(ops[1], `${step.op === '-' ? '−' : '+'} ${escapeHtml(nameOf(steps[step.operands[1]]))}`, step.op === '-');
        const exDec = exactR.n === 0n ? { m: 0n, q: 0 } : decimalOf(exactR.abs());
        if (exDec) {
          const nonzeroOps = ops.filter((o) => o.kind === 'finite');
          const E = exactR.n === 0n ? null : floorLog10(exactR.abs());
          const cutQ = E == null
            ? (nonzeroOps.length ? Math.min(...nonzeroOps.map((o) => o.q)) : 0)
            : (E < fmt.emin ? fmt.emin : E) - fmt.p + 1;
          let cancelledAbove = null;
          if (r0.m !== 0n && r1.m !== 0n && r0.neg !== r1.neg) {
            const top0 = r0.q + r0.m.toString().length - 1;
            const top1 = r1.q + r1.m.toString().length - 1;
            const topOp = Math.min(top0, top1);
            const topRes = E == null ? Math.min(r0.q, r1.q) - 1 : E;
            if (topOp - topRes >= 2) cancelledAbove = topRes;
          }
          const rows = [
            r0, r1,
            { label: '= ' + escapeHtml(t('bin.exact')), m: exDec.m, q: exDec.q, neg: exactR.s < 0n, cls: 'bin-exact', cut: true },
          ];
          if (v.kind === 'finite') rows.push({ label: '→ ' + escapeHtml(t('bin.result')), m: v.m, q: v.q, neg: v.sign === 1, cls: 'bin-result' });
          const aligned = alignedDecimalHtml(rows, cutQ, { cancelledAbove, showCutoff: !!(R?.inexact && !R.overflow) });
          if (aligned) parts.push(`<h4>${escapeHtml(t('bin.alignedDec'))}</h4>${aligned}`);
        }
      }
    }
    if (!isCmp) {
      const sci = [];
      if (step.kind === 'op') {
        for (const id of step.operands) {
          const o = steps[id].fmt[fmt.id].value;
          sci.push(sciRow(escapeHtml(nameOf(steps[id])), storedDecSciHtml(o, fmt)));
        }
      } else if (exactR) {
        sci.push(sciRow(escapeHtml(t('bin.literal')), exactR.n === 0n ? '0' : exactDecSciHtml(exactR, fmt), 'bin-exact'));
      }
      const cutFmt = res.cast ? FORMATS.find((f) => f.id === res.cast.target) : fmt;
      if (step.kind === 'op' && exactR && exactR.n !== 0n) {
        sci.push(sciRow('= ' + escapeHtml(t('bin.exact')), cutFmt.family === 'decfloat' ? exactDecSciHtml(exactR, cutFmt) : exactSciHtml(exactR, cutFmt), 'bin-exact'));
      }
      sci.push(sciRow('→ ' + escapeHtml(t('bin.result')), storedDecSciHtml(v, fmt), 'bin-result'));
      parts.push(`<h4>${escapeHtml(t('bin.scientificDec'))}</h4><div class="bin-scroll"><table class="bin-table">${sci.join('')}</table></div>
        <div class="bin-legend small"><span><i class="bin-kept"></i>${escapeHtml(t('bin.keptLegendDec', { p: cutFmt.p }))}</span><span><i class="bin-guard"></i>${escapeHtml(t('bin.guardDec'))}</span><span><i class="bin-sticky"></i>${escapeHtml(t('bin.stickyDec'))}</span></div>`);
      if (R && R.inexact && !R.overflow && cutFmt.family === 'decfloat') {
        let lastKept = null;
        if (exactR && exactR.n !== 0n) {
          const kept = splitDecimalDigits(exactR, cutFmt).kept;
          lastKept = kept[kept.length - 1];
        }
        const rule = decisionRule(R, mode, lastKept, 10);
        parts.push(`<p class="small bin-decision">${escapeHtml(t('bin.decisionDec', { g: R.guard, s: R.sticky ? 1 : 0, dir: t('dir.' + R.direction), mode: t('mode.' + mode), rule }))}</p>`);
      }
    }
    parts.push(`<details class="info-fold fx-fold"><summary>${escapeHtml(t('fx.title'))}</summary>${formalHtml(step, steps, fmt, res, mode)}</details>`);
    return parts.join('');
  }

  // ---- Binary floating-point path (original IEEE 754 binary view) ----
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
    const cutFmt = res.cast ? FORMATS.find((f) => f.id === res.cast.target) : fmt;
    if (step.kind === 'op' && exactR && exactR.n !== 0n && !cutFmt.fixed) {
      sci.push(sciRow('= ' + escapeHtml(t('bin.exact')), cutFmt.family === 'decfloat' ? exactDecSciHtml(exactR, cutFmt) : exactSciHtml(exactR, cutFmt), 'bin-exact'));
    }
    sci.push(sciRow('→ ' + escapeHtml(t('bin.result')), storedSciHtml(v, fmt), 'bin-result'));
    parts.push(`<h4>${escapeHtml(t('bin.scientific'))}</h4><div class="bin-scroll"><table class="bin-table">${sci.join('')}</table></div>
      <div class="bin-legend small"><span><i class="bin-kept"></i>${escapeHtml(t('bin.keptLegend', { p: cutFmt.p }))}</span><span><i class="bin-guard"></i>${escapeHtml(t('bin.guard'))}</span><span><i class="bin-sticky"></i>${escapeHtml(t('bin.sticky'))}</span></div>`);
    if (R && R.inexact && !R.overflow && !cutFmt.fixed && cutFmt.family !== 'decfloat') {
      let lastKept = null;
      if (exactR && exactR.n !== 0n) {
        const kept = splitBits(exactR, cutFmt).kept;
        if (!kept.endsWith('…')) lastKept = kept[kept.length - 1];
      }
      const rule = decisionRule(R, mode, lastKept, 2);
      parts.push(`<p class="small bin-decision">${escapeHtml(t('bin.decision', { g: R.guard, s: R.sticky ? 1 : 0, dir: t('dir.' + R.direction), mode: t('mode.' + mode), rule }))}</p>`);
      const hwNote = hasAligned ? `<p class="muted small bin-hw">${escapeHtml(t('bin.alignedHw'))}</p>` : '';
      parts.push(`<details class="info-fold bin-theory"><summary>${escapeHtml(t('bin.grsTitle'))}</summary>${hwNote}<p class="muted small bin-grs">${escapeHtml(t(step.op === '+' || step.op === '-' ? 'bin.grs' : 'bin.grsShort'))}</p></details>`);
    }
  }
  parts.push(`<details class="info-fold fx-fold"><summary>${escapeHtml(t('fx.title'))}</summary>${formalHtml(step, steps, fmt, res, mode)}</details>`);
  return parts.join('');
}
