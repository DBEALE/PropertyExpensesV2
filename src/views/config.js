import { categoryIdFor } from '../categories.js';
import { complianceTypeIdFor } from '../compliance.js';
import { newId } from '../db.js';
import { SLOTS, nextSlot, slotOf } from '../palette.js';
import { el, entityTag, sortableTh, swatch, toast } from '../dom.js';
import { sortRows, toggleSort } from '../sort.js';
import {
  categoryUsage,
  complianceTypeUsage,
  deleteCategory,
  deleteComplianceType,
  deleteProperty,
  getState,
  saveCategory,
  saveComplianceType,
  saveProperty,
} from '../store.js';

/**
 * The eight palette slots as a row of buttons.
 *
 * Deliberately a fixed set rather than a free colour input: the slot order is
 * what keeps the palette colourblind-safe and legible against both the light
 * and dark surfaces, and an arbitrary hex would quietly break that.
 */
function colourPicker(record, onPick) {
  const current = slotOf(record);
  return el(
    'div',
    { class: 'swatch-picker' },
    ...SLOTS.map((slot) =>
      el('button', {
        type: 'button',
        class: `swatch-option slot-${slot.key}`,
        title: slot.label,
        'aria-label': `${slot.label} for ${record.name}`,
        'aria-pressed': slot.key === current ? 'true' : 'false',
        onclick: () => void onPick(slot.key),
      }),
    ),
  );
}

const propertySort = { key: 'name', dir: 'asc' };
const categorySort = { key: null, dir: 'asc' };
const complianceSort = { key: null, dir: 'asc' };

export function renderConfig(root, rerender) {
  const { properties, rules, transactions } = getState();

  // Counts are wanted both for display and for sorting, so work them out once.
  const rows = properties.map((property) => ({
    property,
    rules: rules.filter((r) => r.propertyId === property.id).length,
    transactions: transactions.filter((t) => t.propertyId === property.id).length,
  }));
  const sorted = sortRows(rows, propertySort, {
    name: (r) => r.property.name,
    rules: (r) => r.rules,
    transactions: (r) => r.transactions,
  });
  const pTh = (label, key, options) =>
    sortableTh(label, key, propertySort, (k) => {
      toggleSort(propertySort, k, k === 'name' ? 'asc' : 'desc');
      rerender();
    }, options);

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
          void saveProperty({ id: newId(), name, colour: nextSlot(properties) }).then(() => {
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
            pTh('Name', 'name'),
            el('th', {}, 'Colour'),
            pTh('Rules', 'rules', { class: 'num' }),
            pTh('Transactions', 'transactions', { class: 'num' }),
            el('th', {}, ''),
          ),
        ),
        el(
          'tbody',
          {},
          ...sorted.map(({ property, rules: ruleCount, transactions: txCount }) => {
            return el(
              'tr',
              {},
              el(
                'td',
                {},
                el(
                  'a',
                  { href: `#/properties/${encodeURIComponent(property.id)}`, class: 'property-link' },
                  entityTag(property.name, `slot-${slotOf(property)}`),
                ),
              ),
              el('td', {}, colourPicker(property, (colour) => saveProperty({ ...property, colour }).then(rerender))),
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
                  'a',
                  { class: 'link', href: `#/properties/${encodeURIComponent(property.id)}` },
                  'Details',
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

  renderCategories(root, rerender);
  renderComplianceTypes(root, rerender);
}

/**
 * Compliance types are shared reference data in the same sense categories are
 * — one list used by every property — so they are edited here rather than on
 * any one property's page.
 */
function renderComplianceTypes(root, rerender) {
  const { complianceTypes } = getState();

  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Fire alarm service', required: true });
  const monthsInput = el('input', { type: 'number', min: '1', step: '1', value: '12', class: 'months' });
  const descriptionInput = el('input', {
    type: 'text',
    class: 'wide',
    placeholder: 'What this covers (optional)',
  });

  const rows = sortRows(complianceTypes, complianceSort, {
    name: (t) => t.name,
    frequency: (t) => Number(t.frequencyMonths),
    description: (t) => t.description ?? '',
    completions: (t) => complianceTypeUsage(t.id).completions,
  });
  const kTh = (label, key, options) =>
    sortableTh(label, key, complianceSort, (k) => {
      toggleSort(complianceSort, k, k === 'name' || k === 'description' ? 'asc' : 'desc');
      rerender();
    }, options);

  root.append(
    el('h3', {}, 'Compliance types'),
    el(
      'p',
      { class: 'hint' },
      'Certificates and inspections that fall due on a fixed cycle. They can’t be read from a bank ' +
        'statement, so each property logs its own completions on its page; this is the shared list ' +
        'of what to track and how often.',
    ),
    el(
      'form',
      {
        class: 'row-form',
        onsubmit: (event) => {
          event.preventDefault();
          const name = nameInput.value.trim();
          if (name === '') return;
          const months = Number(monthsInput.value);
          if (!Number.isFinite(months) || months <= 0) {
            toast('Enter how many months between inspections.', 'error');
            return;
          }
          if (complianceTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
            toast('A compliance type with that name already exists.', 'error');
            return;
          }
          void saveComplianceType({
            id: complianceTypeIdFor(name, complianceTypes),
            name,
            frequencyMonths: Math.round(months),
            description: descriptionInput.value.trim(),
          }).then(() => {
            toast('Compliance type added.');
            rerender();
          });
        },
      },
      el('label', {}, 'Name ', nameInput),
      el('label', {}, 'Every (months) ', monthsInput),
      el('label', { class: 'grow' }, 'Description ', descriptionInput),
      el('button', { class: 'primary', type: 'submit' }, 'Add type'),
    ),
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          kTh('Name', 'name'),
          kTh('Every', 'frequency', { class: 'num' }),
          kTh('Description', 'description'),
          kTh('Logged', 'completions', { class: 'num' }),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map((type) => {
          const usage = complianceTypeUsage(type.id);
          const name = el('input', { type: 'text', value: type.name, 'aria-label': 'Type name' });
          const months = el('input', {
            type: 'number',
            min: '1',
            step: '1',
            class: 'months',
            value: String(type.frequencyMonths),
            'aria-label': 'Months between inspections',
          });
          const description = el('input', {
            type: 'text',
            class: 'wide',
            value: type.description ?? '',
            'aria-label': 'Type description',
          });

          const save = () => {
            const trimmed = name.value.trim();
            const every = Number(months.value);
            if (trimmed === '') {
              toast('A compliance type needs a name.', 'error');
              return;
            }
            if (!Number.isFinite(every) || every <= 0) {
              toast('Months between inspections must be a positive number.', 'error');
              return;
            }
            void saveComplianceType({
              ...type,
              name: trimmed,
              frequencyMonths: Math.round(every),
              description: description.value.trim(),
            }).then(() => {
              toast('Compliance type saved.');
              rerender();
            });
          };

          return el(
            'tr',
            {},
            el('td', {}, name),
            el('td', { class: 'num' }, months),
            el('td', {}, description),
            el('td', { class: 'num' }, String(usage.completions)),
            el(
              'td',
              { class: 'actions' },
              el('button', { class: 'link', onclick: save }, 'Save'),
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () => {
                    const warning =
                      `Delete the compliance type "${type.name}"?\n\n` +
                      `This also removes ${usage.completions} logged completion(s) across all properties.`;
                    if (!confirm(warning)) return;
                    void deleteComplianceType(type.id).then(() => {
                      toast('Compliance type deleted.');
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

function renderCategories(root, rerender) {
  const { categories } = getState();

  const rows = categories.map((category) => ({ category, usage: categoryUsage(category.id) }));
  const sorted = sortRows(rows, categorySort, {
    name: (r) => r.category.name,
    description: (r) => r.category.description ?? '',
    rules: (r) => r.usage.rules,
    transactions: (r) => r.usage.transactions,
  });
  const cTh = (label, key, options) =>
    sortableTh(label, key, categorySort, (k) => {
      toggleSort(categorySort, k, k === 'rules' || k === 'transactions' ? 'desc' : 'asc');
      rerender();
    }, options);

  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Ground rent', required: true });
  const descriptionInput = el('input', {
    type: 'text',
    class: 'wide',
    placeholder: 'What belongs in this category (optional)',
  });

  root.append(
    el('h3', {}, 'Categories'),
    el(
      'p',
      { class: 'hint' },
      'Rename them, describe what belongs in each, and add your own. A category’s description shows ' +
        'as a tooltip wherever it is offered.',
    ),
    el(
      'form',
      {
        class: 'row-form',
        onsubmit: (event) => {
          event.preventDefault();
          const name = nameInput.value.trim();
          if (name === '') return;
          if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            toast('A category with that name already exists.', 'error');
            return;
          }
          const category = {
            id: categoryIdFor(name, categories),
            name,
            description: descriptionInput.value.trim(),
            colour: nextSlot(categories),
          };
          void saveCategory(category).then(() => {
            toast('Category added.');
            rerender();
          });
        },
      },
      el('label', {}, 'Name ', nameInput),
      el('label', { class: 'grow' }, 'Description ', descriptionInput),
      el('button', { class: 'primary', type: 'submit' }, 'Add category'),
    ),
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          cTh('Name', 'name'),
          cTh('Description', 'description'),
          el('th', {}, 'Colour'),
          cTh('Rules', 'rules', { class: 'num' }),
          cTh('Transactions', 'transactions', { class: 'num' }),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...sorted.map(({ category, usage }) => {
          const name = el('input', { type: 'text', value: category.name, 'aria-label': 'Category name' });
          const description = el('input', {
            type: 'text',
            class: 'wide',
            value: category.description ?? '',
            'aria-label': 'Category description',
            placeholder: 'What belongs here',
          });

          const save = () => {
            const trimmed = name.value.trim();
            if (trimmed === '') {
              toast('A category needs a name.', 'error');
              return;
            }
            void saveCategory({ ...category, name: trimmed, description: description.value.trim() }).then(
              () => {
                toast('Category saved.');
                rerender();
              },
            );
          };

          return el(
            'tr',
            {},
            el('td', { class: 'with-swatch' }, swatch(`slot-${slotOf(category)}`, category.name), name),
            el('td', {}, description),
            el(
              'td',
              {},
              colourPicker(category, (colour) => saveCategory({ ...category, colour }).then(rerender)),
            ),
            el('td', { class: 'num' }, String(usage.rules)),
            el('td', { class: 'num' }, String(usage.transactions)),
            el(
              'td',
              { class: 'actions' },
              el('button', { class: 'link', onclick: save }, 'Save'),
              el(
                'button',
                {
                  class: 'link danger',
                  disabled: categories.length <= 1,
                  onclick: () => {
                    const warning =
                      `Delete the category "${category.name}"?\n\n` +
                      `This also deletes ${usage.rules} rule(s) and unassigns ${usage.transactions} ` +
                      'transaction(s). The transactions themselves are kept.';
                    if (!confirm(warning)) return;
                    void deleteCategory(category.id).then(() => {
                      toast('Category deleted.');
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
