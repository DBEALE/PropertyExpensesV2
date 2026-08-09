/**
 * One property in full: its address, insurance, mortgage, valuation and
 * tenancy — each kept as a dated record, with everything it replaced still
 * readable underneath.
 */
import { accountSummary, sharesFor } from '../accounts.js';
import { el, entityTag, money, toast, ukDate } from '../dom.js';
import { slotClass } from '../palette.js';
import {
  SECTIONS,
  currentRecord,
  equity,
  historyFor,
  loanToValue,
  upcomingDates,
} from '../property-details.js';
import { deletePropertyDetail, getState, savePropertyDetail } from '../store.js';

/** Which section is open for editing, so a re-render doesn't close it. */
let editing = null;

export function renderProperty(root, rerender, propertyId) {
  const { properties, propertyDetails, transactions } = getState();
  const property = properties.find((p) => p.id === propertyId);

  if (!property) {
    root.append(
      el('h2', {}, 'Property'),
      el('div', { class: 'empty' }, 'That property no longer exists. ', el('a', { href: '#/properties' }, 'Back to the list')),
    );
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const mortgage = currentRecord(propertyDetails, propertyId, 'mortgage');
  const valuation = currentRecord(propertyDetails, propertyId, 'valuation');
  const ltv = loanToValue(mortgage, valuation);
  const owned = equity(mortgage, valuation);
  const totals = accountSummary(sharesFor(transactions, propertyId));

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, entityTag(property.name, slotClass(property))),
      el('a', { class: 'link', href: '#/properties' }, '← All properties'),
      el('a', { class: 'link', href: '#/accounts' }, 'Accounts'),
    ),
  );

  // Headline figures, including the two that are computed rather than entered.
  root.append(
    el(
      'div',
      { class: 'tiles' },
      tile('Value', valuation ? money(number(valuation.data.value)) : '—'),
      tile('Mortgage', mortgage ? money(number(mortgage.data.amount)) : '—'),
      tile('LTV', ltv === null ? '—' : `${ltv}%`, ltv !== null && ltv > 75 ? 'out' : ''),
      tile('Equity', owned === null ? '—' : money(owned)),
      tile('Net from statements', money(totals.net), totals.net < 0 ? 'out' : 'in'),
    ),
  );

  const upcoming = upcomingDates(propertyDetails, propertyId, today, 90);
  if (upcoming.length > 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        el('strong', {}, 'Coming up: '),
        upcoming.map((item) => `${item.label} ${ukDate(item.date)}`).join(' · '),
      ),
    );
  }

  for (const section of SECTIONS) {
    root.append(renderSection(section, property, propertyDetails, rerender));
  }
}

function tile(label, value, tone = '') {
  return el(
    'div',
    { class: 'tile' },
    el('span', { class: 'tile-label' }, label),
    el('strong', { class: `tile-value ${tone}` }, value),
  );
}

function number(value) {
  const n = Number(String(value ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function renderSection(section, property, records, rerender) {
  const current = currentRecord(records, property.id, section.key);
  const history = historyFor(records, property.id, section.key);
  const isEditing = editing === section.key;

  const body = el('div', { class: 'section-body' });

  if (isEditing) {
    body.append(sectionForm(section, property, current, rerender));
  } else if (current) {
    body.append(
      el(
        'dl',
        { class: 'detail-grid' },
        ...section.fields
          .filter((field) => String(current.data[field.key] ?? '').trim() !== '')
          .flatMap((field) => [
            el('dt', {}, field.label),
            el('dd', {}, formatValue(field, current.data[field.key])),
          ]),
      ),
      el(
        'p',
        { class: 'hint' },
        `In effect from ${ukDate(current.effectiveFrom)}.`,
      ),
    );
  } else {
    body.append(el('p', { class: 'hint' }, 'Nothing recorded yet.'));
  }

  if (history.length > 0) {
    body.append(
      el(
        'details',
        { class: 'chart-table' },
        el('summary', {}, `Previous versions (${history.length})`),
        ...history.map((record) =>
          el(
            'div',
            { class: 'past-record' },
            el(
              'div',
              { class: 'past-head' },
              el('span', { class: 'badge badge-warn' }, 'Expired'),
              ` ${ukDate(record.effectiveFrom)} – ${ukDate(record.supersededOn)}`,
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () => {
                    if (!confirm('Delete this historical record? It cannot be recovered.')) return;
                    void deletePropertyDetail(record.id).then(rerender);
                  },
                },
                'Delete',
              ),
            ),
            el(
              'dl',
              { class: 'detail-grid' },
              ...section.fields
                .filter((field) => String(record.data[field.key] ?? '').trim() !== '')
                .flatMap((field) => [
                  el('dt', {}, field.label),
                  el('dd', {}, formatValue(field, record.data[field.key])),
                ]),
            ),
          ),
        ),
      ),
    );
  }

  return el(
    'section',
    { class: 'detail-section' },
    el(
      'div',
      { class: 'section-head' },
      el('h3', {}, section.label),
      current && !isEditing ? el('span', { class: 'count' }, section.summary(current.data)) : null,
      el(
        'button',
        {
          class: 'link',
          onclick: () => {
            editing = isEditing ? null : section.key;
            rerender();
          },
        },
        isEditing ? 'Cancel' : current ? 'Change' : 'Add',
      ),
    ),
    body,
  );
}

/**
 * The edit form. Saving writes a *new* dated record rather than overwriting,
 * so the effective-from date is a required part of the form, not an option.
 */
function sectionForm(section, property, current, rerender) {
  const today = new Date().toISOString().slice(0, 10);
  const inputs = new Map();

  for (const field of section.fields) {
    const value = current?.data?.[field.key] ?? '';
    let input;
    if (field.type === 'textarea') {
      input = el('textarea', { rows: '2', class: 'wide' });
      input.value = value;
    } else if (field.type === 'select') {
      input = el(
        'select',
        {},
        el('option', { value: '' }, '—'),
        ...field.options.map((o) => el('option', { value: o, selected: o === value }, o)),
      );
    } else {
      input = el('input', {
        type: inputType(field.type),
        class: field.type === 'textarea' ? 'wide' : '',
        step: field.type === 'money' ? '0.01' : field.type === 'percent' ? '0.01' : undefined,
        min: field.type === 'day' ? '1' : undefined,
        max: field.type === 'day' ? '31' : undefined,
        placeholder: field.type === 'url' ? 'https://…' : '',
        value,
      });
    }
    inputs.set(field.key, input);
  }

  const effectiveFrom = el('input', { type: 'date', required: true, value: today });

  return el(
    'form',
    {
      class: 'detail-form',
      onsubmit: (event) => {
        event.preventDefault();
        if (!effectiveFrom.value) {
          toast('Choose the date this takes effect.', 'error');
          return;
        }
        if (current && effectiveFrom.value < current.effectiveFrom) {
          toast(
            `The current record starts ${ukDate(current.effectiveFrom)} — a replacement cannot start before it.`,
            'error',
          );
          return;
        }
        const data = {};
        for (const [key, input] of inputs) data[key] = input.value.trim();
        if (Object.values(data).every((v) => v === '')) {
          toast('Fill in at least one field.', 'error');
          return;
        }
        void savePropertyDetail({
          propertyId: property.id,
          section: section.key,
          data,
          effectiveFrom: effectiveFrom.value,
        }).then(() => {
          editing = null;
          toast(current ? `${section.label} updated — the old version is kept.` : `${section.label} saved.`);
          rerender();
        });
      },
    },
    el(
      'div',
      { class: 'detail-fields' },
      ...section.fields.map((field) =>
        el(
          'label',
          { class: field.type === 'textarea' ? 'grow' : '' },
          field.label,
          inputs.get(field.key),
        ),
      ),
    ),
    el(
      'div',
      { class: 'effective-row' },
      el('label', { class: 'inline' }, 'In effect from ', effectiveFrom),
      current
        ? el(
            'span',
            { class: 'hint' },
            `The version starting ${ukDate(current.effectiveFrom)} will be kept as history.`,
          )
        : null,
      el('button', { class: 'primary', type: 'submit' }, 'Save'),
    ),
  );
}

function inputType(type) {
  if (type === 'date') return 'date';
  if (type === 'money' || type === 'percent' || type === 'day') return 'number';
  if (type === 'url') return 'url';
  return 'text';
}

function formatValue(field, value) {
  if (field.type === 'money') return money(number(value));
  if (field.type === 'percent') return `${value}%`;
  if (field.type === 'date') return ukDate(value);
  if (field.type === 'day') return `day ${value} of the month`;
  if (field.type === 'url') {
    return el('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value);
  }
  return String(value);
}
