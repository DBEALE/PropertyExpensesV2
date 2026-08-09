import { categoryIdFor } from '../categories.js';
import { newId } from '../db.js';
import { SLOTS, nextSlot, slotOf } from '../palette.js';
import { el, entityTag, swatch, toast } from '../dom.js';
import {
  categoryUsage,
  deleteCategory,
  deleteProperty,
  getState,
  saveCategory,
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
            el('th', {}, 'Name'),
            el('th', {}, 'Colour'),
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
              el('td', {}, entityTag(property.name, `slot-${slotOf(property)}`)),
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
}

function renderCategories(root, rerender) {
  const { categories } = getState();

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
          el('th', {}, 'Name'),
          el('th', {}, 'Description'),
          el('th', {}, 'Colour'),
          el('th', { class: 'num' }, 'Rules'),
          el('th', { class: 'num' }, 'Transactions'),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...categories.map((category) => {
          const usage = categoryUsage(category.id);
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
