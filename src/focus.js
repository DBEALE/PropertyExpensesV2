/**
 * Hand-off between screens: "take me to that transaction", "show me the rule
 * that did this".
 *
 * The target is held here rather than in the URL because it is a one-shot
 * instruction, not a location — after the destination view has scrolled to it
 * and highlighted it, reloading or navigating back should not do it again.
 */
const pending = new Map();

/** @param {'transactions'|'rules'} view */
export function setFocus(view, id) {
  pending.set(view, id);
}

/** Reads and clears the pending target for a view. */
export function takeFocus(view) {
  const id = pending.get(view) ?? null;
  pending.delete(view);
  return id;
}

/**
 * Scrolls an element into view and marks it, once the row exists in the DOM.
 * The class is removed after the animation so a later render doesn't repeat it.
 */
export function highlight(element) {
  if (!element) return;
  requestAnimationFrame(() => {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.add('focus-flash');
    setTimeout(() => element.classList.remove('focus-flash'), 2600);
  });
}
