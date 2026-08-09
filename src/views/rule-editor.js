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
  const matchText = el('input', { type: 'text', value: draft.matchText, placeholder: 'e.g. PETERBOROUGH', oninput: sync });
  const matchType = el(
    'select',
    { onchange: sync },
    ...MATCH_TYPES.map((t) => el('option', { value: t, selected: t === draft.matchType }, t)),
  );

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
    };
  }

  /** Keeps enablement, the live preview and the match count in step. */
  function sync() {
    const current = read();
    matchText.disabled = !current.useText;
    matchType.disabled = !current.useText;
    typeValue.disabled = !current.useType;
    amountValue.disabled = !current.useAmount;

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
  sync();
  dialog.showModal();
  matchText.focus();
  matchText.select();
}
