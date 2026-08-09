import { hasSplit } from '../allocation.js';
import { CsvFormatError } from '../csv.js';
import { newId } from '../db.js';
import { el, money, toast, ukDate } from '../dom.js';
import { buildTransactions, isDuplicate } from '../importer.js';
import { addTransactions, categoryName, getState, propertyName } from '../store.js';

export function renderImport(root, navigate) {
  /** @type {{transaction: import('../types.js').Transaction, duplicate: boolean}[]} */
  let staged = [];

  const fileInput = el('input', {
    type: 'file',
    accept: '.csv,text/csv',
    id: 'csv-file',
    onchange: () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) void handleFile(file);
    },
  });

  const preview = el('div', { class: 'preview' });

  const dropZone = el(
    'div',
    {
      class: 'dropzone',
      ondragover: (event) => {
        event.preventDefault();
        dropZone.classList.add('dragging');
      },
      ondragleave: () => dropZone.classList.remove('dragging'),
      ondrop: (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragging');
        const file = event.dataTransfer && event.dataTransfer.files[0];
        if (file) void handleFile(file);
      },
    },
    el('p', {}, 'Drop a statement CSV here, or choose a file:'),
    fileInput,
  );

  root.append(
    el('h2', {}, 'Import statement'),
    el(
      'p',
      { class: 'hint' },
      'Expected columns: Date, Details, Transaction Type, In, Out, Balance. Dates in DD/MM/YYYY.',
    ),
    dropZone,
    preview,
  );

  async function handleFile(file) {
    preview.replaceChildren();
    let text;
    try {
      text = await file.text();
    } catch {
      toast('Could not read that file.', 'error');
      return;
    }

    let transactions;
    try {
      transactions = buildTransactions(text, {
        rules: getState().rules,
        filename: file.name,
        importedAt: new Date().toISOString(),
        newId,
      });
    } catch (err) {
      preview.append(
        el(
          'div',
          { class: 'error' },
          err instanceof CsvFormatError ? err.message : 'Could not parse that file as CSV.',
        ),
      );
      return;
    }

    if (transactions.length === 0) {
      preview.append(el('div', { class: 'error' }, 'No transaction rows found in that file.'));
      return;
    }

    const existing = getState().transactions;
    staged = transactions.map((transaction) => ({
      transaction,
      duplicate: isDuplicate(transaction, existing),
    }));
    renderPreview(file.name);
  }

  function renderPreview(filename) {
    const matched = staged.filter((s) => s.transaction.matchedRuleId !== null).length;
    const duplicates = staged.filter((s) => s.duplicate).length;
    const skipDuplicates = el('input', { type: 'checkbox', checked: true });

    const table = el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Date'),
          el('th', {}, 'Details'),
          el('th', {}, 'Type'),
          el('th', { class: 'num' }, 'Amount'),
          el('th', {}, 'Property'),
          el('th', {}, 'Category'),
          el('th', {}, 'Status'),
        ),
      ),
      el(
        'tbody',
        {},
        ...staged.map(({ transaction, duplicate }) =>
          el(
            'tr',
            { class: duplicate ? 'row-duplicate' : '' },
            el('td', {}, ukDate(transaction.date)),
            el('td', { class: 'details' }, transaction.details),
            el('td', {}, transaction.transactionType),
            el('td', { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` }, money(transaction.amount)),
            hasSplit(transaction)
              ? el(
                  'td',
                  { colspan: 2 },
                  el('span', { class: 'badge badge-split' }, `Split ${transaction.allocations.length}`),
                  ...transaction.allocations.map((a) =>
                    el(
                      'div',
                      { class: 'share' },
                      `${propertyName(a.propertyId)} · ${categoryName(a.category)} · ${money(a.amount)}`,
                    ),
                  ),
                )
              : el('td', {}, propertyName(transaction.propertyId)),
            hasSplit(transaction) ? null : el('td', {}, categoryName(transaction.category)),
            el(
              'td',
              {},
              duplicate
                ? el('span', { class: 'badge badge-warn' }, 'Already imported')
                : transaction.matchedRuleId
                  ? el('span', { class: 'badge badge-ok' }, 'Auto-categorised')
                  : el('span', { class: 'badge' }, 'Needs review'),
            ),
          ),
        ),
      ),
    );

    preview.append(
      el(
        'div',
        { class: 'summary-bar' },
        el('strong', {}, `${staged.length} rows in ${filename}`),
        el('span', {}, `${matched} auto-categorised, ${staged.length - matched} need review`),
        duplicates > 0 ? el('label', { class: 'inline' }, skipDuplicates, ` Skip ${duplicates} row(s) already imported`) : null,
        el('button', { class: 'primary', onclick: () => void commit(skipDuplicates.checked) }, 'Import'),
      ),
      table,
    );
  }

  async function commit(skipDuplicates) {
    const toImport = staged.filter((s) => !(skipDuplicates && s.duplicate)).map((s) => s.transaction);
    if (toImport.length === 0) {
      toast('Nothing to import.', 'error');
      return;
    }
    await addTransactions(toImport);
    toast(`Imported ${toImport.length} transaction(s).`);
    navigate('transactions');
  }
}
