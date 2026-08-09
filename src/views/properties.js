import { newId } from '../db.js';
import { el, toast } from '../dom.js';
import { deleteProperty, getState, saveProperty } from '../store.js';
import { CATEGORIES } from '../types.js';

export function renderProperties(root, rerender) {
  const { properties, rules, transactions } = getState();

  const nameInput = el('input', { type: 'text', placeholder: 'e.g. 3 Peterborough Gate', required: true });

  root.append(
    el('div', { class: 'toolbar' }, el('h2', {}, 'Properties'), el('span', { class: 'count' }, `${properties.length}`)),
    el(
      'form',
      {
        class: 'row-form',
        onsubmit: (event) => {
          event.preventDefault();
          const name = nameInput.value.trim();
          if (name === '') return;
          if (properties.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
            toast('A property with that name already exists.', 'error');
            return;
          }
          void saveProperty({ id: newId(), name }).then(() => {
            toast('Property added.');
            rerender();
          });
        },
      },
      el('label', {}, 'Name ', nameInput),
      el('button', { class: 'primary', type: 'submit' }, 'Add property'),
    ),
  );

  if (properties.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No properties yet. Add one above.'));
  } else {
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
            el('th', {}, 'Name'),
            el('th', { class: 'num' }, 'Rules'),
            el('th', { class: 'num' }, 'Transactions'),
            el('th', {}, ''),
          ),
        ),
        el(
          'tbody',
          {},
          ...properties.map((property) => {
            const ruleCount = rules.filter((r) => r.propertyId === property.id).length;
            const txCount = transactions.filter((t) => t.propertyId === property.id).length;
            return el(
              'tr',
              {},
              el('td', {}, property.name),
              el('td', { class: 'num' }, String(ruleCount)),
              el('td', { class: 'num' }, String(txCount)),
              el(
                'td',
                { class: 'actions' },
                el(
                  'button',
                  {
                    class: 'link',
                    onclick: () => {
                      const name = prompt('Property name', property.name);
                      if (name === null || name.trim() === '') return;
                      void saveProperty({ ...property, name: name.trim() }).then(rerender);
                    },
                  },
                  'Rename',
                ),
                el(
                  'button',
                  {
                    class: 'link danger',
                    onclick: () => {
                      const warning =
                        `Delete "${property.name}"?\n\n` +
                        `This also deletes its ${ruleCount} rule(s) and unassigns ${txCount} transaction(s). ` +
                        'The transactions themselves are kept.';
                      if (!confirm(warning)) return;
                      void deleteProperty(property.id).then(() => {
                        toast('Property deleted.');
                        rerender();
                      });
                    },
                  },
                  'Delete',
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  root.append(
    el('h3', {}, 'Categories'),
    el('p', { class: 'hint' }, 'Categories are fixed and cannot be edited.'),
    el('ul', { class: 'chips' }, ...CATEGORIES.map((c) => el('li', { class: 'chip' }, c))),
  );
}
