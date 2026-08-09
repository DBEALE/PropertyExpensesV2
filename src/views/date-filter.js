/**
 * The date-range filter shared by Transactions, Summary and Accounts: a
 * shortcut dropdown plus the two dates it fills in.
 *
 * The dates stay visible and editable — the dropdown is a shortcut, not a
 * replacement — and editing them by hand flips the dropdown to "Custom" so it
 * never claims a range it isn't showing.
 */
import { CUSTOM, datePresetGroups, matchPreset, presetByKey } from '../date-presets.js';
import { el } from '../dom.js';

/**
 * @param {object} options
 * @param {{date: string}[]} options.transactions used to derive the year options
 * @param {string} options.from ISO date or ''
 * @param {string} options.to ISO date or ''
 * @param {(range: {from: string, to: string}) => void} options.onChange
 * @param {string} [options.today]
 * @returns {Node[]} the select and the two date inputs, to spread into a bar
 */
export function dateRangeControls({ transactions, from, to, onChange, today }) {
  const now = today ?? new Date().toISOString().slice(0, 10);
  const groups = datePresetGroups(transactions, now);
  const selected = matchPreset(transactions, now, from, to);

  const select = el(
    'select',
    {
      'aria-label': 'Date range',
      class: 'date-preset',
      onchange: (event) => {
        const preset = presetByKey(transactions, now, event.target.value);
        // "Custom" is a state the dates put the dropdown into, not a choice
        // that means anything on its own, so picking it changes nothing.
        if (preset) onChange({ from: preset.from, to: preset.to });
      },
    },
    ...groups.map((group) =>
      el(
        'optgroup',
        { label: group.label },
        ...group.options.map((option) =>
          el('option', { value: option.key, selected: option.key === selected }, option.label),
        ),
      ),
    ),
    selected === CUSTOM ? el('option', { value: CUSTOM, selected: true }, 'Custom range') : null,
  );

  const dateInput = (which, value, label) =>
    el('input', {
      type: 'date',
      class: 'date-bound',
      value,
      'aria-label': label,
      title: label,
      onchange: (event) =>
        onChange(which === 'from' ? { from: event.target.value, to } : { from, to: event.target.value }),
    });

  return [select, dateInput('from', from, 'From date'), dateInput('to', to, 'To date')];
}
