/**
 * Small SVG chart builders. No dependencies, no canvas — the marks are DOM
 * nodes, so they inherit the identity colours and the theme like everything
 * else on the page.
 *
 * Specs held here rather than at each call site: columns capped at 24px with a
 * 4px rounded data-end squared off at the baseline, a 2px surface gap between
 * touching segments, hairline gridlines, a legend whenever there is more than
 * one series, and a hover tooltip on every mark.
 */
import { el, money } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLUMN_MAX = 24;
const GAP = 2;
const RADIUS = 4;

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * A rectangle with two rounded corners at the data end and square corners at
 * the baseline. `direction` is 'up' for a positive column, 'down' for negative.
 */
function columnPath(x, y, width, height, direction) {
  const r = Math.min(RADIUS, width / 2, height);
  if (height <= 0) return '';
  return direction === 'up'
    ? `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
    : `M${x},${y} L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height} L${x + width - r},${y + height} Q${x + width},${y + height} ${x + width},${y + height - r} L${x + width},${y} Z`;
}

/** Rounds an axis bound up to a readable step. */
function niceBound(value) {
  if (value === 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    const candidate = step * magnitude;
    if (candidate >= Math.abs(value)) return Math.sign(value) * candidate;
  }
  return Math.sign(value) * 10 * magnitude;
}

let tooltipNode = null;

function tooltip() {
  if (!tooltipNode) {
    tooltipNode = el('div', { class: 'chart-tooltip', role: 'status', hidden: true });
    document.body.append(tooltipNode);
  }
  return tooltipNode;
}

function showTooltip(event, lines) {
  const node = tooltip();
  node.replaceChildren(...lines.map((line) => el('div', {}, line)));
  node.hidden = false;
  // Keep it clear of the pointer and inside the viewport.
  const x = Math.min(event.clientX + 14, window.innerWidth - node.offsetWidth - 8);
  const y = Math.max(8, event.clientY - node.offsetHeight - 12);
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipNode) tooltipNode.hidden = true;
}

/**
 * A stacked column chart around a zero baseline: positive values stack upward,
 * negative downward, so income and expenses read as opposite without a second
 * axis.
 *
 * @param {object} options
 * @param {{key: string, label: string}[]} options.buckets x-axis slots
 * @param {{key: string, label: string, slotClass: string, values: number[]}[]} options.series
 * @param {(value: number) => string} [options.format]
 * @param {string} [options.emptyMessage]
 */
export function stackedColumns({ buckets, series, format = money, emptyMessage = 'Nothing to plot yet.' }) {
  if (buckets.length === 0 || series.length === 0) {
    return el('div', { class: 'empty' }, emptyMessage);
  }

  const width = Math.max(360, Math.min(960, buckets.length * 64 + 80));
  const height = 260;
  const margin = { top: 16, right: 12, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Stack extents drive the scale: the tallest positive stack and deepest
  // negative one, never each series alone.
  let maxUp = 0;
  let maxDown = 0;
  buckets.forEach((_, i) => {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const v = s.values[i] ?? 0;
      if (v > 0) up += v;
      else down += v;
    }
    maxUp = Math.max(maxUp, up);
    maxDown = Math.min(maxDown, down);
  });
  const top = niceBound(maxUp || 1);
  const bottom = niceBound(maxDown);
  const span = top - bottom || 1;
  const yFor = (value) => margin.top + ((top - value) / span) * plotHeight;
  const zeroY = yFor(0);

  const band = plotWidth / buckets.length;
  const columnWidth = Math.min(COLUMN_MAX, band * 0.62);

  const ticks = [top, top / 2, 0, bottom / 2, bottom].filter(
    (v, i, arr) => Number.isFinite(v) && arr.indexOf(v) === i,
  );

  const marks = [];
  buckets.forEach((bucket, i) => {
    const x = margin.left + band * i + (band - columnWidth) / 2;
    let upCursor = 0;
    let downCursor = 0;

    series.forEach((s) => {
      const value = s.values[i] ?? 0;
      if (value === 0) return;
      const isUp = value > 0;
      const start = isUp ? upCursor : downCursor;
      const end = start + value;
      if (isUp) upCursor = end;
      else downCursor = end;

      const yStart = yFor(start);
      const yEnd = yFor(end);
      const rawHeight = Math.abs(yEnd - yStart);
      // The 2px surface gap separates touching segments; keep a sliver visible
      // for values too small to give a gap to.
      const drawnHeight = Math.max(rawHeight - GAP, Math.min(rawHeight, 1));
      const y = isUp ? Math.min(yStart, yEnd) : Math.min(yStart, yEnd) + (rawHeight - drawnHeight);
      // Only the outermost segment of a stack gets the rounded data end.
      const outermost = isUp ? upCursor === maxUpAt(i) : downCursor === maxDownAt(i);

      marks.push(
        svg('path', {
          d: outermost
            ? columnPath(x, y, columnWidth, drawnHeight, isUp ? 'up' : 'down')
            : `M${x},${y} h${columnWidth} v${drawnHeight} h${-columnWidth} Z`,
          class: `mark ${s.slotClass}`,
          tabindex: '0',
          role: 'img',
          'aria-label': `${bucket.label}, ${s.label}, ${format(value)}`,
          onmousemove: (event) => showTooltip(event, [bucket.label, `${s.label}: ${format(value)}`]),
          onmouseleave: hideTooltip,
          onfocus: (event) => {
            const box = event.target.getBoundingClientRect();
            showTooltip(
              { clientX: box.left + box.width / 2, clientY: box.top },
              [bucket.label, `${s.label}: ${format(value)}`],
            );
          },
          onblur: hideTooltip,
        }),
      );
    });
  });

  function maxUpAt(i) {
    return series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0);
  }
  function maxDownAt(i) {
    return series.reduce((sum, s) => sum + Math.min(0, s.values[i] ?? 0), 0);
  }

  // Direct labels are deliberately sparse: the most recent month and the
  // biggest month, not a number on every column. The rest are in the tooltip
  // and, exactly, in the table view below.
  const nets = buckets.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const extremeIndex = nets.reduce((best, net, i) => (Math.abs(net) > Math.abs(nets[best]) ? i : best), 0);
  const labelled = new Set([buckets.length - 1, extremeIndex]);

  const netLabels = [...labelled].map((i) =>
    svg(
      'text',
      {
        x: margin.left + band * i + band / 2,
        y: Math.max(10, yFor(maxUpAt(i)) - 6),
        class: 'chart-value',
        'text-anchor': 'middle',
      },
      format(nets[i]),
    ),
  );

  return el(
    'div',
    { class: 'chart' },
    svg(
      'svg',
      {
        viewBox: `0 0 ${width} ${height}`,
        class: 'chart-svg',
        role: 'img',
        'aria-label': 'Monthly totals. The same figures are in the table below.',
      },
      ...ticks.map((value) =>
        svg('line', {
          x1: margin.left,
          x2: width - margin.right,
          y1: yFor(value),
          y2: yFor(value),
          class: value === 0 ? 'axis-line' : 'grid-line',
        }),
      ),
      ...ticks.map((value) =>
        svg(
          'text',
          { x: margin.left - 8, y: yFor(value) + 4, class: 'chart-tick', 'text-anchor': 'end' },
          format(value),
        ),
      ),
      ...marks,
      ...netLabels,
      ...buckets.map((bucket, i) =>
        svg(
          'text',
          {
            x: margin.left + band * i + band / 2,
            y: height - 12,
            class: 'chart-tick',
            'text-anchor': 'middle',
          },
          bucket.label,
        ),
      ),
      svg('line', {
        x1: margin.left,
        x2: width - margin.right,
        y1: zeroY,
        y2: zeroY,
        class: 'axis-line',
      }),
    ),
  );
}

/**
 * Caps a series list at the eight palette slots, folding the smallest into a
 * single neutral "Other". A ninth hue would have to be generated, and a
 * generated hue is not colourblind-safe against the eight that exist.
 *
 * @param {{key: string, label: string, slotClass: string, values: number[]}[]} series
 * @param {number} [limit]
 */
export function capSeries(series, limit = 8) {
  if (series.length <= limit) return { series, folded: 0 };
  const weight = (s) => s.values.reduce((sum, v) => sum + Math.abs(v), 0);
  const ranked = [...series].sort((a, b) => weight(b) - weight(a));
  const kept = ranked.slice(0, limit - 1);
  const rest = ranked.slice(limit - 1);
  const other = {
    key: '__other__',
    label: `Other (${rest.length})`,
    slotClass: 'slot-neutral',
    values: series[0].values.map((_, i) => rest.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)),
  };
  // Keep the original order for the survivors so colours never shuffle.
  return {
    series: [...series.filter((s) => kept.includes(s)), other],
    folded: rest.length,
  };
}

/** Legend: always present for two or more series. */
export function legend(series) {
  if (series.length < 2) return null;
  return el(
    'ul',
    { class: 'chart-legend' },
    ...series.map((s) =>
      el(
        'li',
        { class: `legend-item ${s.slotClass}` },
        el('span', { class: 'swatch', 'aria-hidden': 'true' }),
        s.label,
      ),
    ),
  );
}

/**
 * The table behind every chart. Charts are the quick read; this is the one that
 * is always exact, screen-readable, and immune to the light-mode contrast
 * warning on three of the palette slots.
 */
export function chartTable({ buckets, series, format = money, firstHeading = 'Month' }) {
  return el(
    'details',
    { class: 'chart-table' },
    el('summary', {}, 'Show the numbers'),
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, firstHeading),
          ...series.map((s) => el('th', { class: 'num' }, s.label)),
          el('th', { class: 'num' }, 'Net'),
        ),
      ),
      el(
        'tbody',
        {},
        ...buckets.map((bucket, i) =>
          el(
            'tr',
            {},
            el('td', {}, bucket.label),
            ...series.map((s) => el('td', { class: 'num' }, format(s.values[i] ?? 0))),
            el(
              'td',
              { class: 'num strong' },
              format(series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)),
            ),
          ),
        ),
      ),
    ),
  );
}
