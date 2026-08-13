import { ariaSort, sortIndicator } from './sort.js';

/**
 * Tiny element builder. Text children are always set as text nodes, never
 * HTML, so statement contents can't inject markup.
 *
 * @param {string} tag
 * @param {Record<string, any>} [attrs] `onclick`-style keys become listeners.
 * @param {...(Node|string|null|undefined|false)} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' && 'value' in node) {
      node.value = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
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

export function clear(node) {
  node.replaceChildren();
}

/**
 * The mark for a property or category: its icon, drawn in its palette colour.
 *
 * An inline SVG rather than a font glyph or an image, so it inherits the slot's
 * custom property and needs nothing loaded. Always `aria-hidden` — the name is
 * beside it, and a screen reader announcing "house" before every property would
 * be noise.
 *
 * @param {string} slotClass e.g. "slot-blue", from palette.js
 * @param {{d: string, rule?: string}|null} icon from icons.js, or null for a plain swatch
 * @param {string} [label] tooltip, when the mark stands alone
 */
export function entityMark(slotClass, icon, label) {
  if (!icon) {
    return el('span', {
      class: `swatch ${slotClass}`,
      'aria-hidden': 'true',
      title: label,
    });
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `entity-icon ${slotClass}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (label) svg.setAttribute('title', label);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', icon.d);
  if (icon.rule) path.setAttribute('fill-rule', icon.rule);
  svg.append(path);
  return svg;
}

/**
 * A property or category as it appears anywhere on screen: its mark followed by
 * its name. The name is always present — three of the light-mode slots sit
 * below 3:1 against the surface, so colour never carries the meaning on its
 * own, and the icon is a second channel rather than a replacement.
 *
 * @param {string} name
 * @param {string} slotClass e.g. "slot-blue", from palette.js
 * @param {string} [description] shown as a tooltip
 * @param {object|null} [icon] from icons.js
 */
export function entityTag(name, slotClass, description, icon = null) {
  return el(
    'span',
    { class: `entity ${slotClass}`, title: description || name },
    entityMark(slotClass, icon),
    name,
  );
}

/**
 * A clickable column heading. Click to sort by it, click again to reverse.
 *
 * @param {string} label
 * @param {string} key column key, matching an accessor
 * @param {import('./sort.js').SortState} state
 * @param {(key: string) => void} onSort
 * @param {{class?: string, initial?: 'asc'|'desc', title?: string}} [options]
 */
export function sortableTh(label, key, state, onSort, options = {}) {
  const active = state.key === key;
  return el(
    'th',
    {
      class: `${options.class ?? ''} sortable${active ? ' sorted' : ''}`.trim(),
      'aria-sort': ariaSort(state, key),
    },
    el(
      'button',
      {
        type: 'button',
        class: 'sort-button',
        title: options.title ?? `Sort by ${label}`,
        onclick: () => onSort(key),
      },
      // A category column carries its mark, so the heading and the cells below
      // it are identified the same way as the same category everywhere else.
      options.mark ?? null,
      label,
      el('span', { class: 'sort-arrow', 'aria-hidden': 'true' }, sortIndicator(state, key)),
    ),
  );
}

/** A bare mark, for places that already show the name in an adjacent cell. */
export function swatch(slotClass, label, icon = null) {
  const mark = entityMark(slotClass, icon, label);
  mark.classList.add('standalone');
  // Standing alone it is the only thing identifying the record in that spot,
  // so unlike the mark inside an entityTag it gets a name of its own.
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', label);
  mark.removeAttribute('aria-hidden');
  return mark;
}

/** Formats a signed amount as £1,234.56 / -£1,234.56. */
export function money(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}£${Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** @param {string} iso YYYY-MM-DD */
export function ukDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

let toastTimer;

/** @param {'ok'|'error'} [kind] */
export function toast(message, kind = 'ok') {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.className = `toast toast-${kind}`;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, 4000);
}

/** Triggers a client-side file download via an object URL. */
export function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
