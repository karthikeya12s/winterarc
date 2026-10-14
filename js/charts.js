/* Winter Arc — tiny dependency-free SVG charts (bar, line, heatmap) with hover tooltips. */
(function (root) {
  const WA = (root.WA = root.WA || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // round step (1, 2, 2.5, 5 × 10^k) so axis ticks read cleanly
  function niceStep(span, ticks) {
    const raw = span / ticks;
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }
  const short = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : String(+n.toFixed(1)));

  function frame(points, { height = 180, goal, min }) {
    const W = 640, H = height, L = 40, R = 8, T = 12, B = 24;
    const ys = points.map((p) => p.y).filter((y) => y != null);
    const TICKS = H < 120 ? 2 : 4;
    let lo = 0, hi = Math.max(...ys, goal || 0, 1);
    if (min === 'auto' && ys.length) {
      const all = goal ? ys.concat(goal) : ys;
      const span = Math.max(...all) - Math.min(...all) || 1;
      lo = Math.min(...all) - span * 0.15;
      hi = Math.max(...all) + span * 0.15;
    }
    const step = niceStep(hi - lo, TICKS);
    lo = Math.floor(lo / step) * step;
    hi = Math.max(lo + step, Math.ceil(hi / step) * step);
    const x = (i) => L + ((W - L - R) * (i + 0.5)) / points.length;
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${short(v)}</text>`;
    }
    const every = Math.ceil(points.length / 8);
    const xl = points
      .map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 6}" class="tick" text-anchor="middle">${esc(p.label)}</text>` : ''))
      .join('');
    const goalLine = goal ? `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - R}" y="${y(goal) - 4}" class="tick goal-label" text-anchor="end">goal ${short(goal)}</text>` : '';
    return { W, H, L, R, T, B, x, y, lo, grid, xl, goalLine };
  }

  /** points: [{label, y, tip}] */
  function bar(points, opts = {}) {
    if (!points.some((p) => p.y)) return empty(opts.empty);
    const f = frame(points, opts);
    const bw = Math.max(2, Math.min(28, ((f.W - f.L - f.R) / points.length) * 0.7));
    const bars = points
      .map((p, i) => {
        if (!p.y) return '';
        const top = f.y(p.y), base = f.y(f.lo), h = Math.max(1, base - top);
        const r = Math.min(4, bw / 2, h);
        const cx = f.x(i), x0 = cx - bw / 2;
        // rounded top, square base
        const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`;
        const met = !opts.goal || p.y >= opts.goal ? ' met' : '';
        return `<g class="hit" data-tip="${esc(p.tip || `${p.label}: ${p.y}`)}"><rect x="${cx - bw / 2 - 3}" y="${f.T}" width="${bw + 6}" height="${base - f.T}" fill="transparent"/><path d="${d}" class="bar${met}"/></g>`;
      })
      .join('');
    return wrap(f, f.grid + bars + f.goalLine + f.xl, opts);
  }

  function line(points, opts = {}) {
    const pts = points.map((p, i) => ({ ...p, i })).filter((p) => p.y != null);
    if (pts.length < 2) return empty(opts.empty);
    const f = frame(points, { ...opts, min: opts.min != null ? opts.min : 'auto' });
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${f.x(p.i).toFixed(1)},${f.y(p.y).toFixed(1)}`).join('');
    const dots = pts
      .map((p) => `<g class="hit" data-tip="${esc(p.tip || `${p.label}: ${p.y}`)}"><circle cx="${f.x(p.i)}" cy="${f.y(p.y)}" r="10" fill="transparent"/><circle cx="${f.x(p.i)}" cy="${f.y(p.y)}" r="${pts.length > 40 ? 0 : 3.5}" class="dot"/></g>`)
      .join('');
    return wrap(f, f.grid + f.goalLine + `<path d="${d}" class="line"/>` + dots + f.xl, opts);
  }

  function wrap(f, inner, opts) {
    return `<svg viewBox="0 0 ${f.W} ${f.H}" class="chart" role="img" aria-label="${esc(opts.label || 'chart')}">${inner}</svg>`;
  }
  const empty = (msg) => `<div class="chart-empty">${esc(msg || 'No data yet')}</div>`;

  /** GitHub-style calendar: days = [{date, score (0..1 | null), tip}] ; rows = weekdays (Mon..Sun). */
  function heatmap(days) {
    if (!days.length) return empty();
    const { weekStart, diffDays, fmt } = WA.date;
    const first = weekStart(days[0].date);
    const cols = Math.floor(diffDays(first, days[days.length - 1].date) / 7) + 1;
    const S = 14, G = 3, L = 22, T = 16;
    let cells = '', months = '', lastMonth = '';
    for (const d of days) {
      const off = diffDays(first, d.date);
      const c = Math.floor(off / 7), r = off % 7;
      const lvl = d.score == null ? 'future' : d.score >= 1 ? 4 : d.score >= 0.8 ? 3 : d.score >= 0.5 ? 2 : d.score > 0 ? 1 : 0;
      cells += `<rect x="${L + c * (S + G)}" y="${T + r * (S + G)}" width="${S}" height="${S}" rx="3" class="hm hm-${lvl}${d.today ? ' hm-today' : ''}" data-tip="${esc(d.tip)}" data-date="${d.date}"/>`;
      const m = fmt(d.date, { month: 'short' });
      if (m !== lastMonth && r === 0) {
        months += `<text x="${L + c * (S + G)}" y="10" class="tick">${m}</text>`;
        lastMonth = m;
      }
    }
    const labels = ['M', '', 'W', '', 'F', '', ''].map((l, r) => `<text x="0" y="${T + r * (S + G) + 11}" class="tick">${l}</text>`).join('');
    const W = L + cols * (S + G), H = T + 7 * (S + G);
    return `<svg viewBox="0 0 ${W} ${H}" class="heatmap" style="max-width:${W * 1.6}px" role="img" aria-label="Challenge calendar">${months}${labels}${cells}</svg>`;
  }

  /** Progress ring (stat, not a chart). */
  function ring(pct, label, sub) {
    const r = 50, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct || 0));
    return `<svg viewBox="0 0 120 120" class="ring ${p >= 1 ? 'full' : ''}" role="img" aria-label="${esc(label)} ${esc(sub || '')}">
      <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
      <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
      <text x="60" y="62" text-anchor="middle" class="ring-big">${esc(label)}</text>
      <text x="60" y="80" text-anchor="middle" class="ring-sub">${esc(sub || '')}</text></svg>`;
  }

  /** Small per-day ring used in the week strip. */
  function miniRing(pct, label) {
    const r = 15, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct || 0));
    return `<svg viewBox="0 0 36 36" class="mini-ring ${p >= 1 ? 'full' : ''}" aria-hidden="true">
      <circle cx="18" cy="18" r="${r}" class="ring-bg"/>
      ${p ? `<circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/>` : ''}
      <text x="18" y="22.5" text-anchor="middle" class="mini-num">${esc(label)}</text></svg>`;
  }

  /** The "arc": the whole challenge drawn as a rising arc, with a marker where you are today. */
  function arc(start, end, on) {
    const { diffDays, addDays, parse, fmt } = WA.date;
    const total = diffDays(start, end) + 1;
    const p = Math.max(0, Math.min(1, (diffDays(start, on) + 1) / total));
    const W = 320, cx = 160, rx = 140, ry = 64, base = 78;
    const pt = (q) => [cx - rx * Math.cos(Math.PI * q), base - ry * Math.sin(Math.PI * q)];
    const path = `M${cx - rx},${base} A${rx},${ry} 0 0 1 ${cx + rx},${base}`;
    const [mx, my] = pt(p);
    // a tick at the first of each month inside the challenge
    let ticks = '';
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (parse(d).getDate() !== 1 || d === start) continue;
      const [tx, ty] = pt(diffDays(start, d) / (total - 1));
      ticks += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="2.2" class="arc-tick"/><text x="${tx.toFixed(1)}" y="${(ty - 9).toFixed(1)}" text-anchor="middle" class="arc-label">${fmt(d, { month: 'short' })}</text>`;
    }
    return `<svg viewBox="0 0 ${W} 96" class="arc" role="img" aria-label="${Math.round(p * 100)}% of the challenge done">
      <path d="${path}" class="arc-bg"/>
      ${p > 0 ? `<path d="M${cx - rx},${base} A${rx},${ry} 0 0 1 ${mx.toFixed(2)},${my.toFixed(2)}" class="arc-fg"/>` : ''}
      ${ticks}
      <text x="${cx - rx}" y="94" text-anchor="middle" class="arc-label">${fmt(start)}</text>
      <text x="${cx + rx}" y="94" text-anchor="middle" class="arc-label">${fmt(end)}</text>
      ${p > 0 ? `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9" class="arc-glow"/><circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5" class="arc-dot"/>` : ''}
    </svg>`;
  }

  // one shared tooltip for every chart on the page
  function installTooltips(doc) {
    const tip = doc.createElement('div');
    tip.className = 'tooltip';
    doc.body.appendChild(tip);
    const show = (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return (tip.style.opacity = 0);
      tip.textContent = t.getAttribute('data-tip');
      tip.style.opacity = 1;
      const x = Math.min(e.clientX + 12, doc.documentElement.clientWidth - tip.offsetWidth - 8);
      tip.style.transform = `translate(${x}px, ${e.clientY - tip.offsetHeight - 10}px)`;
    };
    doc.addEventListener('pointermove', show);
    doc.addEventListener('pointerdown', show);
    doc.addEventListener('scroll', () => (tip.style.opacity = 0), true);
  }

  WA.charts = { bar, line, heatmap, ring, miniRing, arc, installTooltips, esc };
})(typeof window !== 'undefined' ? window : globalThis);
