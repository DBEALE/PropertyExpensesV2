import { newId } from '../db.js';
import { el, money, toast } from '../dom.js';
import { countMatches } from '../rules.js';
import { deleteRule, getState, propertyName, reapplyRules, saveRule } from '../store.js';
import { CATEGORIES, isCategory } from '../types.js';

const MATCH_TYPES = ['contains', 'exact', 'regex'];

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
      'Amount-pinned rules are checked first, so a rule pinned to an exact amount beats a text-only rule ' +
        'for the same payee. Re-applying leaves manually assigned transactions untouched.',
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

  root.append(ruleForm(null, rerender));

  if (rules.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No rules yet.'));
    return;
  }

  // Pinned rules are listed first, matching the order they are evaluated in.
  const ordered = [
    ...rules.filter((r) => r.amountEquals !== undefined),
    ...rules.filter((r) => r.amountEquals === undefined),
  ];

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
          el('th', {}, 'Match'),
          el('th', {}, 'Type'),
          el('th', { class: 'num' }, 'Amount pin'),
          el('th', {}, 'Property'),
          el('th', {}, 'Category'),
          el('th', { class: 'num' }, 'Matches'),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...ordered.map((rule) =>
          el(
            'tr',
            {},
            el('td', { class: 'details' }, rule.matchText),
            el('td', {}, rule.matchType),
            el(
              'td',
              { class: 'num' },
              rule.amountEquals === undefined
                ? el('span', { class: 'badge' }, 'Text only')
                : el('span', { class: 'badge badge-pin' }, money(rule.amountEquals)),
            ),
            el('td', {}, propertyName(rule.propertyId)),
            el('td', {}, rule.category),
            el('td', { class: 'num' }, String(counts.get(rule.id) ?? 0)),
            el(
              'td',
              { class: 'actions' },
              el(
                'button',
                {
                  class: 'link',
                  onclick: (event) => {
                    const row = event.target.closest('tr');
                    row.after(el('tr', {}, el('td', { colspan: 7 }, ruleForm(rule, rerender))));
                    event.target.disabled = true;
                  },
                },
                'Edit',
              ),
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () => {
                    if (!confirm(`Delete the rule for "${rule.matchText}"?`)) return;
                    void deleteRule(rule.id).then(rerender);
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
}

/**
 * @param {import('../types.js').Rule|null} existing null to add a new rule.
 */
function ruleForm(existing, rerender) {
  const { properties } = getState();

  const matchText = el('input', {
    type: 'text',
    required: true,
    placeholder: 'e.g. PETERBOROUGH',
    value: existing ? existing.matchText : '',
  });
  const matchType = el(
    'select',
    {},
    ...MATCH_TYPES.map((t) =>
      el('option', { value: t, selected: (existing ? existing.matchType : 'contains') === t }, t),
    ),
  );
  const isPinned = Boolean(existing && existing.amountEquals !== undefined);
  const pin = el('input', {
    type: 'checkbox',
    checked: isPinned,
    onchange: () => {
      amount.disabled = !pin.checked;
    },
  });
  const amount = el('input', {
    type: 'number',
    step: '0.01',
    placeholder: 'e.g. -428.06',
    value: isPinned ? String(existing.amountEquals) : '',
    disabled: !isPinned,
  });
  const property = el(
    'select',
    { required: true },
    ...properties.map((p) =>
      el('option', { value: p.id, selected: existing ? p.id === existing.propertyId : false }, p.name),
    ),
  );
  const category = el(
    'select',
    { required: true },
    ...CATEGORIES.map((c) => el('option', { value: c, selected: existing ? c === existing.category : false }, c)),
  );

  return el(
    'form',
    {
      class: 'row-form',
      onsubmit: (event) => {
        event.preventDefault();
        const text = matchText.value.trim();
        if (text === '') {
          toast('Match text is required.', 'error');
          return;
        }
        if (matchType.value === 'regex') {
          try {
            new RegExp(text);
          } catch {
            toast('That is not a valid regular expression.', 'error');
            return;
          }
        }
        const pinnedAmount = pin.checked ? Number(amount.value) : undefined;
        if (pin.checked && (amount.value.trim() === '' || !Number.isFinite(pinnedAmount))) {
          toast('Enter an amount to pin, or untick the box.', 'error');
          return;
        }
        if (!isCategory(category.value)) {
          toast('Choose a category.', 'error');
          return;
        }
        const rule = {
          id: existing ? existing.id : newId(),
          matchText: text,
          matchType: matchType.value,
          propertyId: property.value,
          category: category.value,
          ...(pinnedAmount === undefined ? {} : { amountEquals: Math.round(pinnedAmount * 100) / 100 }),
        };
        void saveRule(rule).then(() => {
          toast(existing ? 'Rule updated.' : 'Rule added.');
          rerender();
        });
      },
    },
    el('label', {}, 'Match text ', matchText),
    el('label', {}, 'Match type ', matchType),
    el('label', { class: 'inline' }, pin, ' Pin to amount ', amount, el('small', {}, 'expenses are negative')),
    el('label', {}, 'Property ', property),
    el('label', {}, 'Category ', category),
    el('button', { class: 'primary', type: 'submit' }, existing ? 'Save rule' : 'Add rule'),
  );
}
