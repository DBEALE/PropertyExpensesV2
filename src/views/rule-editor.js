import { hasSplit, splitEvenly, sumAllocations } from '../allocation.js';
import { newId } from '../db.js';
import { el, money, toast } from '../dom.js';
import { draftRuleFromTransaction, draftToRule, validateDraft } from '../rule-draft.js';
import { countMatches, hasAmount, hasText, hasType } from '../rules.js';
import { getState, saveRule } from '../store.js';
import { CATEGORIES } from '../types.js';

const MATCH_TYPES = ['contains', 'exact', 'regex'];

/** Existing rule -> the form state this editor works in. */
function draftFromRule(rule) {
  return {
    useText: hasText(rule),
    matchText: rule.matchText ?? '',
    matchType: rule.matchType ?? 'contains',
    useType: hasType(rule),
    transactionTypeEquals: rule.transactionTypeEquals ?? '',
    useAmount: hasAmount(rule),
    amountEquals: hasAmount(rule) ? rule.amountEquals : 0,
    propertyId: rule.propertyId,
    category: rule.category,
    collides: false,
    split: hasSplit(rule),
    allocations: hasSplit(rule) ? rule.allocations.map((a) => ({ ...a })) : [],
  };
}

/**
 * Opens the rule editor.
 *
 * @param {object} options
 * @param {import('../types.js').Transaction} [options.transaction] pre-fill from this row
 * @param {import('../types.js').Rule} [options.rule] edit this existing rule
 * @param {() => void} options.onSaved
 */
export function openRuleEditor({ transaction, rule, onSaved }) {
  const { properties, rules, transactions } = getState();
  if (properties.length === 0) {
    toast('Add a property before creating rules.', 'error');
    return;
  }

  const draft = rule ? draftFromRule(rule) : draftRuleFromTransaction(transaction, rules);
  if (!draft.propertyId) draft.propertyId = properties[0].id;
  if (!draft.category) draft.category = CATEGORIES[0];

  // --- condition: details text -----------------------------------------
  const useText = el('input', { type: 'checkbox', checked: draft.useText, onchange: sync });
  const matchText = el('input', {
    type: 'text',
    value: draft.matchText,
    placeholder: 'e.g. PETERBOROUGH',
    oninput: sync,
  });
  const matchType = el(
    'select',
    { onchange: sync },
    ...MATCH_TYPES.map((t) => el('option', { value: t, selected: t === draft.matchType }, t)),
  );

  /** Sets the text box and refreshes everything that depends on it. */
  function setMatchText(value) {
    matchText.value = value;
    useText.checked = true;
    sync();
    matchText.focus();
  }

  // The box starts with the whole description; these narrow it in one click.
  const fullText = (draft.matchText ?? '').trim();
  const narrowings = (draft.suggestions ?? []).filter((w) => w !== fullText);
  const suggestions =
    narrowings.length > 0
      ? el(
          'div',
          { class: 'suggestions' },
          el('span', { class: 'hint' }, 'Narrow to:'),
          ...narrowings.slice(0, 6).map((word) =>
            el('button', { type: 'button', class: 'chip-button', onclick: () => setMatchText(word) }, word),
          ),
          el(
            'button',
            { type: 'button', class: 'chip-button', onclick: () => setMatchText(fullText) },
            'full description',
          ),
        )
      : null;

  // --- condition: transaction type -------------------------------------
  const useType = el('input', { type: 'checkbox', checked: draft.useType, onchange: sync });
  const typeValue = el('input', {
    type: 'text',
    value: draft.transactionTypeEquals,
    placeholder: 'e.g. Direct Debit',
    list: 'known-transaction-types',
    oninput: sync,
  });
  // Offer the types actually seen in the imported data.
  const knownTypes = [...new Set(transactions.map((t) => t.transactionType).filter(Boolean))].sort();

  // --- condition: amount ------------------------------------------------
  const useAmount = el('input', { type: 'checkbox', checked: draft.useAmount, onchange: sync });
  const amountValue = el('input', {
    type: 'number',
    step: '0.01',
    value: String(draft.amountEquals),
    oninput: sync,
  });

  // --- outcome ----------------------------------------------------------
  const property = el(
    'select',
    { onchange: sync },
    ...properties.map((p) => el('option', { value: p.id, selected: p.id === draft.propertyId }, p.name)),
  );
  const category = el(
    'select',
    { onchange: sync },
    ...CATEGORIES.map((c) => el('option', { value: c, selected: c === draft.category }, c)),
  );

  // --- outcome: split across properties ---------------------------------
  /** Working copy of the split rows; the DOM is rebuilt from this. */
  let allocations = draft.allocations.map((a) => ({ ...a }));

  const split = el('input', {
    type: 'checkbox',
    checked: draft.split,
    onchange: () => {
      if (split.checked && allocations.length === 0) allocations = seedAllocations();
      renderAllocations();
      sync();
    },
  });

  const allocationRows = el('div', { class: 'allocation-rows' });
  const remainder = el('p', { class: 'remainder' });

  /** Two rows splitting the pinned amount evenly, as a starting point. */
  function seedAllocations() {
    const total = Number(amountValue.value) || 0;
    const halves = splitEvenly(total, 2);
    return halves.map((amount, i) => ({
      propertyId: properties[Math.min(i, properties.length - 1)].id,
      category: draft.category ?? CATEGORIES[0],
      amount,
    }));
  }

  function renderAllocations() {
    allocationRows.replaceChildren();
    if (!split.checked) return;

    allocations.forEach((allocation, index) => {
      const propertySelect = el(
        'select',
        {
          'aria-label': `Property for share ${index + 1}`,
          onchange: (event) => {
            allocations[index].propertyId = event.target.value;
            sync();
          },
        },
        ...properties.map((p) =>
          el('option', { value: p.id, selected: p.id === allocation.propertyId }, p.name),
        ),
      );
      const categorySelect = el(
        'select',
        {
          'aria-label': `Category for share ${index + 1}`,
          onchange: (event) => {
            allocations[index].category = event.target.value;
            sync();
          },
        },
        ...CATEGORIES.map((c) => el('option', { value: c, selected: c === allocation.category }, c)),
      );
      const amountInput = el('input', {
        type: 'number',
        step: '0.01',
        class: 'allocation-amount',
        'aria-label': `Amount for share ${index + 1}`,
        value: String(allocation.amount),
        oninput: (event) => {
          allocations[index].amount = event.target.value;
          sync();
        },
      });

      allocationRows.append(
        el(
          'div',
          { class: 'allocation-row' },
          propertySelect,
          categorySelect,
          amountInput,
          el(
            'button',
            {
              type: 'button',
              class: 'link danger',
              'aria-label': `Remove share ${index + 1}`,
              disabled: allocations.length <= 2,
              onclick: () => {
                allocations.splice(index, 1);
                renderAllocations();
                sync();
              },
            },
            'Remove',
          ),
        ),
      );
    });

    allocationRows.append(
      el(
        'div',
        { class: 'allocation-actions' },
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              // New rows start at zero so the user states the value explicitly.
              allocations.push({ propertyId: properties[0].id, category: CATEGORIES[0], amount: 0 });
              renderAllocations();
              sync();
            },
          },
          'Add property',
        ),
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              const even = splitEvenly(Number(amountValue.value) || 0, allocations.length);
              allocations = allocations.map((a, i) => ({ ...a, amount: even[i] }));
              renderAllocations();
              sync();
            },
          },
          'Split evenly',
        ),
        remainder,
      ),
    );
  }

  const preview = el('p', { class: 'rule-preview' });
  const problem = el('p', { class: 'rule-problem' });
  const saveButton = el('button', { class: 'primary', type: 'submit' }, rule ? 'Save rule' : 'Create rule');

  /** Reads the controls back into a draft object. */
  function read() {
    return {
      useText: useText.checked,
      matchText: matchText.value,
      matchType: matchType.value,
      useType: useType.checked,
      transactionTypeEquals: typeValue.value,
      useAmount: useAmount.checked,
      amountEquals: amountValue.value,
      propertyId: property.value,
      category: category.value,
      split: split.checked,
      allocations,
    };
  }

  /** Keeps enablement, the live preview and the match count in step. */
  function sync() {
    const current = read();
    matchText.disabled = !current.useText;
    matchType.disabled = !current.useText;
    typeValue.disabled = !current.useType;
    amountValue.disabled = !current.useAmount;
    // A split needs a fixed total to reconcile against, so pin the amount.
    if (current.split && !useAmount.checked) {
      useAmount.checked = true;
      amountValue.disabled = false;
      current.useAmount = true;
    }
    useAmount.disabled = current.split;
    property.disabled = current.split;
    category.disabled = current.split;

    if (current.split) {
      const total = Number(current.amountEquals) || 0;
      const allocated = sumAllocations(allocations);
      remainder.textContent = `Allocated ${money(allocated)} of ${money(total)}`;
      remainder.className = `remainder ${Math.round((total - allocated) * 100) === 0 ? 'ok' : 'off'}`;
    }

    const error = validateDraft(current);
    problem.textContent = error ?? '';
    saveButton.disabled = error !== null;

    if (error) {
      preview.textContent = '';
      return;
    }
    // Show how many stored transactions this rule would claim, ignoring the
    // rules that already exist so the number reflects this rule alone.
    const candidate = draftToRule(current, '__preview__');
    const count = countMatches([candidate], transactions).get('__preview__') ?? 0;
    preview.textContent = `Matches ${count} of your ${transactions.length} stored transaction(s).`;
  }

  const dialog = el(
    'dialog',
    { class: 'rule-dialog' },
    el(
      'form',
      {
        method: 'dialog',
        onsubmit: (event) => {
          event.preventDefault();
          const current = read();
          const error = validateDraft(current);
          if (error) {
            toast(error, 'error');
            return;
          }
          void saveRule(draftToRule(current, rule ? rule.id : newId())).then(() => {
            toast(rule ? 'Rule updated.' : 'Rule created.');
            dialog.close();
            onSaved();
          });
        },
      },
      el('h3', {}, rule ? 'Edit rule' : 'Create rule'),
      transaction
        ? el(
            'p',
            { class: 'rule-source' },
            'From: ',
            el('strong', {}, transaction.details),
            ` · ${transaction.transactionType} · ${money(transaction.amount)}`,
          )
        : null,
      el('p', { class: 'hint' }, 'Tick any combination. A transaction must satisfy every ticked condition.'),

      el(
        'div',
        { class: 'condition' },
        el('label', { class: 'inline' }, useText, ' Details'),
        matchType,
        matchText,
      ),
      suggestions,
      el(
        'div',
        { class: 'condition' },
        el('label', { class: 'inline' }, useType, ' Type is'),
        typeValue,
        el(
          'datalist',
          { id: 'known-transaction-types' },
          ...knownTypes.map((t) => el('option', { value: t })),
        ),
      ),
      el(
        'div',
        { class: 'condition' },
        el('label', { class: 'inline' }, useAmount, ' Amount is'),
        amountValue,
        el('small', {}, 'expenses are negative'),
      ),
      draft.collides
        ? el(
            'p',
            { class: 'hint warn' },
            'That text is already used by another property, so Amount is ticked to keep the two apart.',
          )
        : null,

      el(
        'div',
        { class: 'condition outcome' },
        el('span', {}, 'Then assign'),
        property,
        category,
      ),
      el(
        'div',
        { class: 'condition' },
        el('label', { class: 'inline' }, split, ' Split across properties'),
        el('small', {}, 'shares must total the pinned amount exactly'),
      ),
      allocationRows,

      preview,
      problem,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        saveButton,
      ),
    ),
  );

  // Clean up so repeated opens don't pile up detached dialogs.
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  renderAllocations();
  sync();
  dialog.showModal();
  // Focus without selecting: the box holds the full description, and a stray
  // keystroke shouldn't wipe it.
  matchText.focus();
  matchText.setSelectionRange(matchText.value.length, matchText.value.length);
}
