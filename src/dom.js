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
 * A property or category as it appears anywhere on screen: its colour swatch
 * followed by its name. The name is always present — three of the light-mode
 * slots sit below 3:1 against the surface, so colour never carries the meaning
 * on its own.
 *
 * @param {string} name
 * @param {string} slotClass e.g. "slot-blue", from palette.js
 * @param {string} [description] shown as a tooltip
 */
export function entityTag(name, slotClass, description) {
  return el(
    'span',
    { class: `entity ${slotClass}`, title: description || name },
    el('span', { class: 'swatch', 'aria-hidden': 'true' }),
    name,
  );
}

/** A bare swatch, for places that already show the name in an adjacent cell. */
export function swatch(slotClass, label) {
  return el('span', { class: `swatch standalone ${slotClass}`, title: label, role: 'img', 'aria-label': label });
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
