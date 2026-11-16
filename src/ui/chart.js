// Generic SVG line chart with legend, crosshair and tooltip. Used for the
// step-by-step error chart and for both precision-sweep charts.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function niceStep(range, target = 5) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {number[]} o.xs
 * @param {{id:string,label:string,color:string,values:(number|null)[],dashed?:boolean,width?:number}[]} o.series
 * @param {string} o.yLabel
 * @param {(x:number)=>string} [o.xTick]
 * @param {(y:number)=>string} [o.yTick]
 * @param {number} [o.yMin]
 * @param {number} [o.yMax]
 * @param {'items'|{gradient:string[], low:string, high:string, note?:string}} [o.legend]
 * @param {boolean} [o.directLabels]
 * @param {(x:number, i:number)=>string} [o.tipTitle]
 * @param {(s:object, v:number|null, i:number)=>string} [o.tipValue]
 * @param {(x:number, i:number)=>void} [o.onPick]
 * @param {string} [o.ariaLabel]
 * @param {string} [o.emptyText]
 * @param {{x:number,y:number,cls?:string}[]} [o.markers]
 * @param {number} [o.height]
 */
export function renderLineChart(host, o) {
  host.innerHTML = '';
  const { xs, series } = o;
  if (!xs.length || !series.length) {
    host.innerHTML = `<p class="muted small">${escapeHtml(o.emptyText || '')}</p>`;
    return;
  }
  // Legend
  if (o.legend && o.legend !== 'none') {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    if (o.legend === 'items') {
      legend.innerHTML = series.map((s) => `<span class="legend-item"><span class="${s.dashed ? 'swatch-line dashed' : 'swatch'}" style="${s.dashed ? `border-color:${s.color}` : `background:${s.color}`}"></span>${escapeHtml(s.label)}</span>`).join('');
    } else {
      const g = o.legend;
      legend.innerHTML = `<span class="legend-grad"><span>${escapeHtml(g.low)}</span><span class="grad" style="background:linear-gradient(90deg, ${g.gradient.join(', ')})"></span><span>${escapeHtml(g.high)}</span></span>${g.note ? `<span class="muted">${escapeHtml(g.note)}</span>` : ''}`;
    }
    host.appendChild(legend);
  }
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  host.appendChild(wrap);
  const W = Math.max(300, wrap.clientWidth || host.clientWidth || 640);
  const H = o.height || 230;
  const m = { l: 46, r: o.directLabels ? 68 : 14, t: 10, b: 30 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const all = series.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
  for (const mk of o.markers || []) all.push(mk.y);
  let yMin = o.yMin ?? Math.min(...all, 0);
  let yMax = o.yMax ?? Math.max(...all, 1);
  if (!Number.isFinite(yMin)) yMin = 0;
  if (!Number.isFinite(yMax)) yMax = 1;
  if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const sx = (x) => m.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
  const sy = (v) => m.t + ih - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg', role: 'img', 'aria-label': o.ariaLabel || '' }, wrap);

  // Y grid
  const ys = niceStep(yMax - yMin);
  for (let v = Math.ceil(yMin / ys) * ys; v <= yMax + 1e-9; v += ys) {
    el('line', { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: 'grid' }, svg);
    const tx = el('text', { x: m.l - 6, y: sy(v) + 4, class: 'axis-label', 'text-anchor': 'end' }, svg);
    tx.textContent = o.yTick ? o.yTick(v) : String(Math.round(v * 100) / 100);
  }
  const yl = el('text', { x: 11, y: m.t + ih / 2, class: 'axis-label', transform: `rotate(-90 11 ${m.t + ih / 2})`, 'text-anchor': 'middle' }, svg);
  yl.textContent = o.yLabel || '';
  // X ticks
  const nT = Math.min(8, xs.length);
  const used = new Set();
  for (let i = 0; i < nT; i++) {
    const x = xs[Math.round((i / Math.max(1, nT - 1)) * (xs.length - 1))];
    if (used.has(x)) continue;
    used.add(x);
    const tx = el('text', { x: sx(x), y: H - 12, class: 'axis-label', 'text-anchor': 'middle' }, svg);
    tx.textContent = o.xTick ? o.xTick(x) : String(x);
  }
  if (o.xLabel) {
    const xl = el('text', { x: m.l + iw / 2, y: H - 1, class: 'axis-label', 'text-anchor': 'middle' }, svg);
    xl.textContent = o.xLabel;
  }
  el('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'baseline' }, svg);

  // Lines
  for (const s of series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    el('path', { d, class: 'series-line' + (s.dashed ? ' dashed' : ''), stroke: s.color, 'stroke-width': s.width || 2 }, svg);
    if (xs.length <= 60 && !s.dashed) {
      s.values.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) return;
        el('circle', { cx: sx(xs[i]), cy: sy(v), r: 3, fill: s.color, class: 'series-dot' }, svg);
      });
    }
  }
  for (const mk of o.markers || []) {
    el('circle', { cx: sx(mk.x), cy: sy(mk.y), r: 4, class: 'marker ' + (mk.cls || '') }, svg);
  }
  // Direct labels (≤ 4 series), nudged apart and kept inside the plot
  if (o.directLabels && series.length <= 4) {
    const lastIdx = xs.length - 1;
    const labels = series
      .map((s) => {
        let i = lastIdx;
        while (i >= 0 && (s.values[i] == null || !Number.isFinite(s.values[i]))) i--;
        return { s, y: i >= 0 ? sy(s.values[i]) : null };
      })
      .filter((x) => x.y != null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
    for (let i = labels.length - 1; i >= 0; i--) {
      const limit = i === labels.length - 1 ? m.t + ih : labels[i + 1].y - 12;
      if (labels[i].y > limit) labels[i].y = limit;
    }
    for (const l of labels) {
      const tx = el('text', { x: W - m.r + 6, y: l.y + 4, class: 'direct-label' }, svg);
      tx.textContent = l.s.label;
    }
  }

  // Hover layer
  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', class: 'hit' }, svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const x = ((evt.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    xs.forEach((xv, i) => {
      const dd = Math.abs(sx(xv) - x);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  };
  hit.addEventListener('pointermove', (evt) => {
    const i = nearest(evt);
    cross.setAttribute('x1', sx(xs[i]));
    cross.setAttribute('x2', sx(xs[i]));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    const rows = series.slice(0, 14).map((s) => `<div class="tip-row"><span class="${s.dashed ? 'swatch-line dashed' : 'swatch'}" style="${s.dashed ? `border-color:${s.color}` : `background:${s.color}`}"></span>${escapeHtml(s.label)}<b>${escapeHtml(o.tipValue ? o.tipValue(s, s.values[i], i) : String(s.values[i]))}</b></div>`);
    if (series.length > 14) rows.push('<div class="muted">…</div>');
    tip.innerHTML = `<div class="tip-title">${escapeHtml(o.tipTitle ? o.tipTitle(xs[i], i) : String(xs[i]))}</div>${rows.join('')}`;
    const px = (sx(xs[i]) / W) * wrap.clientWidth;
    const tw = tip.offsetWidth || 200;
    tip.style.left = `${px + 14 + tw > wrap.clientWidth ? Math.max(0, px - tw - 14) : px + 14}px`;
    tip.style.top = '8px';
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  if (o.onPick) hit.addEventListener('click', (evt) => { const i = nearest(evt); o.onPick(xs[i], i); });
}
