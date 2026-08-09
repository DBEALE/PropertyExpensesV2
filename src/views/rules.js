import { hasSplit } from '../allocation.js';
import { el, entityTag, money, sortableTh, toast } from '../dom.js';
import { sortRows, toggleSort } from '../sort.js';
import {
  amountRange,
  countMatches,
  describeAmount,
  hasAmount,
  hasText,
  hasType,
  isExactAmount,
  orderRules,
} from '../rules.js';
import {
  categoryName,
  categorySlot,
  deleteRule,
  getState,
  propertyName,
  propertySlot,
  reapplyRules,
} from '../store.js';
import { highlight, takeFocus } from '../focus.js';
import { openRuleEditor } from './rule-editor.js';

/** Default order is the order rules actually fire in. */
const sort = { key: 'position', dir: 'asc' };

export function renderRules(root, rerender) {
  const { rules, properties, transactions } = getState();
  const counts = countMatches(rules, transactions);

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Rules'),
      el('span', { class: 'count' }, `${rules.length} rule(s)`),
      el(
        'button',
        {
          class: 'primary',
          onclick: () => openRuleEditor({ onSaved: () => void reapplyRules().then(rerender) }),
        },
        'New rule',
      ),
      el(
        'button',
        {
          onclick: () =>
            void reapplyRules().then((n) => {
              toast(n === 0 ? 'No transactions changed.' : `Re-categorised ${n} transaction(s).`);
              rerender();
            }),
        },
        'Re-apply to all transactions',
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      'A rule can test the Details text, the Transaction Type and the exact amount, in any combination; ' +
        'a transaction must satisfy every condition set. Rules are listed and evaluated most-specific ' +
        'first, so an amount-pinned rule beats a looser one for the same payee. Re-applying leaves ' +
        'manually assigned transactions untouched.',
    ),
  );

  if (properties.length === 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        'Add a property before creating rules. ',
        el('a', { href: '#/properties' }, 'Go to Properties'),
      ),
    );
    return;
  }

  if (rules.length === 0) {
    root.append(
      el(
        'div',
        { class: 'empty' },
        'No rules yet. Create one here, or open the Transactions tab and click ',
        el('strong', {}, 'Rule'),
        ' on a row to build one from it.',
      ),
    );
    return;
  }

  // The number is the rule's position in evaluation order, worked out before
  // any display sort — so re-sorting the table never misstates which rule
  // fires first.
  const ranked = orderRules(rules).map((rule, i) => ({ rule, position: i + 1 }));

  const rows = sortRows(ranked, sort, {
    position: (r) => r.position,
    details: (r) => (hasText(r.rule) ? r.rule.matchText : ''),
    type: (r) => (hasType(r.rule) ? r.rule.transactionTypeEquals : ''),
    amount: (r) => (hasAmount(r.rule) ? amountRange(r.rule).min : null),
    property: (r) => (hasSplit(r.rule) ? 'Split' : propertyName(r.rule.propertyId)),
    category: (r) => (hasSplit(r.rule) ? 'Split' : categoryName(r.rule.category)),
    matches: (r) => counts.get(r.rule.id) ?? 0,
  });

  const onSort = (key) => {
    toggleSort(sort, key, key === 'matches' || key === 'amount' ? 'desc' : 'asc');
    rerender();
  };
  const th = (label, key, options) => sortableTh(label, key, sort, onSort, options);

  root.append(
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          th('#', 'position', { title: 'Sort by evaluation order' }),
          th('Details', 'details'),
          th('Type', 'type'),
          th('Amount', 'amount', { class: 'num' }),
          th('Property', 'property'),
          th('Category', 'category'),
          th('Matches', 'matches', { class: 'num' }),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map(({ rule, position }) =>
          el(
            'tr',
            { 'data-rule': rule.id },
            el('td', { class: 'num muted' }, String(position)),
            el(
              'td',
              { class: 'details' },
              hasText(rule)
                ? el('span', {}, el('span', { class: 'match-type' }, rule.matchType), ` ${rule.matchText}`)
                : el('span', { class: 'unset' }, 'any'),
            ),
            el('td', {}, hasType(rule) ? rule.transactionTypeEquals : el('span', { class: 'unset' }, 'any')),
            el(
              'td',
              { class: 'num' },
              hasAmount(rule)
                ? el(
                    'span',
                    { class: `badge badge-pin ${isExactAmount(rule) ? '' : 'badge-range'}` },
                    describeAmount(rule, money),
                  )
                : el('span', { class: 'unset' }, 'any'),
            ),
            hasSplit(rule)
              ? el(
                  'td',
                  { colspan: 2, class: 'split-cell' },
                  el('span', { class: 'badge badge-split' }, `Split ${rule.allocations.length}`),
                  ...rule.allocations.map((a) =>
                    el(
                      'div',
                      { class: 'share' },
                      ...[entityTag(propertyName(a.propertyId), propertySlot(a.propertyId)), ' · ', entityTag(categoryName(a.category), categorySlot(a.category)), ` · ${money(a.amount)}`],
                    ),
                  ),
                )
              : el('td', {}, entityTag(propertyName(rule.propertyId), propertySlot(rule.propertyId))),
            hasSplit(rule) ? null : el('td', {}, entityTag(categoryName(rule.category), categorySlot(rule.category))),
            el('td', { class: 'num' }, String(counts.get(rule.id) ?? 0)),
            el(
              'td',
              { class: 'actions' },
              el(
                'button',
                {
                  class: 'link',
                  onclick: () => openRuleEditor({ rule, onSaved: () => void reapplyRules().then(rerender) }),
                },
                'Edit',
              ),
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () => {
                    if (!confirm(`Delete this rule?\n\n${describe(rule)}`)) return;
                    void deleteRule(rule.id).then(() => void reapplyRules().then(rerender));
                  },
                },
                'Delete',
              ),
            ),
          ),
        ),
      ),
    ),
  );

  // Arrived from a transaction's "By rule" badge: show which rule did it.
  const target = takeFocus('rules');
  if (target) highlight(root.querySelector(`[data-rule="${target}"]`));
}

function describe(rule) {
  const parts = [];
  if (hasText(rule)) parts.push(`Details ${rule.matchType} "${rule.matchText}"`);
  if (hasType(rule)) parts.push(`Type is "${rule.transactionTypeEquals}"`);
  if (hasAmount(rule)) parts.push(`Amount is ${describeAmount(rule, money)}`);
  if (hasSplit(rule)) parts.push(`Splits across ${rule.allocations.length} properties`);
  return parts.join('\n');
}
