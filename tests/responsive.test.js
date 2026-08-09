import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headingText, labelsForRow } from '../src/responsive.js';

const COLUMNS = ['Date', 'Details', 'Type', 'Amount', 'Property', 'Category', 'Status', ''];

describe('headingText', () => {
  it('strips the sort arrow so the label reads as a column name', () => {
    assert.equal(headingText('Date ▼'), 'Date');
    assert.equal(headingText('Amount ▲'), 'Amount');
    assert.equal(headingText('  Property  '), 'Property');
  });

  it('copes with nothing at all', () => {
    assert.equal(headingText(undefined), '');
    assert.equal(headingText(''), '');
  });
});

describe('labelsForRow', () => {
  it('labels an ordinary row column by column', () => {
    const labels = labelsForRow(COLUMNS, [1, 1, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(labels, ['Date', 'Details', 'Type', 'Amount', 'Property', 'Category', 'Status', '']);
  });

  it('leaves a spanning cell unlabelled and keeps the ones after it aligned', () => {
    // A split row merges Property and Category into one cell.
    const labels = labelsForRow(COLUMNS, [1, 1, 1, 1, 2, 1, 1]);
    assert.deepEqual(labels, ['Date', 'Details', 'Type', 'Amount', '', 'Status', '']);
  });

  it('does not invent a label for cells past the last column', () => {
    assert.deepEqual(labelsForRow(['One', 'Two'], [1, 1, 1]), ['One', 'Two', '']);
  });

  it('handles a row of one wide cell, such as an inline editor', () => {
    assert.deepEqual(labelsForRow(COLUMNS, [8]), ['']);
  });

  it('returns nothing for a row with no cells', () => {
    assert.deepEqual(labelsForRow(COLUMNS, []), []);
  });
});
