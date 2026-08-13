/**
 * The identity icon bank.
 *
 * The icons are drawn here rather than loaded, so the things that can break are
 * bookkeeping ones: a duplicate key silently shadowing another icon, a path
 * that lost its `fill-rule` and filled in its own windows, a stored choice that
 * no longer exists after the bank changed. Those are what these check.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATEGORY_ICONS,
  PROPERTY_ICONS,
  categoryMark,
  iconByKey,
  iconOf,
  iconsFor,
  propertyMark,
} from '../src/icons.js';

const ALL = [
  ['property', PROPERTY_ICONS],
  ['category', CATEGORY_ICONS],
];

describe('the icon banks', () => {
  it('has the sizes the app promises', () => {
    assert.equal(PROPERTY_ICONS.length, 4);
    assert.equal(CATEGORY_ICONS.length, 10);
  });

  it('gives every icon a unique key', () => {
    for (const [kind, icons] of ALL) {
      const keys = icons.map((i) => i.key);
      assert.equal(new Set(keys).size, keys.length, `duplicate key in ${kind} icons`);
    }
  });

  it('gives every icon a label and path data', () => {
    for (const [kind, icons] of ALL) {
      for (const icon of icons) {
        assert.ok(icon.label?.trim(), `${kind}/${icon.key} has no label`);
        assert.match(icon.d, /^M/, `${kind}/${icon.key} path does not start with a move`);
      }
    }
  });

  it('cuts holes with evenodd wherever a shape has more than one subpath', () => {
    // A window or a doorway is a second subpath. Without evenodd the nonzero
    // rule fills it in, and the icon silently becomes a solid blob.
    for (const [kind, icons] of ALL) {
      for (const icon of icons) {
        const subpaths = (icon.d.match(/M/g) ?? []).length;
        if (subpaths > 1 && !icon.rule) {
          // The exceptions are the ones whose subpaths are meant to merge or
          // sit apart rather than cut: percent (two discs and a bar) and tree
          // (canopy plus trunk).
          assert.ok(
            ['percent', 'tree'].includes(icon.key),
            `${kind}/${icon.key} has ${subpaths} subpaths but no fill-rule`,
          );
        }
      }
    }
  });

  it('looks icons up by key, and admits when one is unknown', () => {
    assert.equal(iconByKey('property', 'house').label, 'House');
    assert.equal(iconByKey('category', 'key').key, 'key');
    assert.equal(iconByKey('property', 'castle'), null);
  });

  it('returns the right bank for each kind', () => {
    assert.equal(iconsFor('property'), PROPERTY_ICONS);
    assert.equal(iconsFor('category'), CATEGORY_ICONS);
  });
});

describe('iconOf', () => {
  it('honours an explicit choice', () => {
    assert.equal(iconOf({ id: 'p1', icon: 'mansion' }, 'property'), 'mansion');
    assert.equal(iconOf({ id: 'Rent', icon: 'bolt' }, 'category'), 'bolt');
  });

  it('ignores a choice that is no longer in the bank', () => {
    // A backup from a version with a different set must not render nothing.
    assert.equal(iconOf({ id: 'p1', icon: 'castle' }, 'property'), 'house');
    assert.equal(iconOf({ id: 'x', icon: 'castle' }, 'category'), 'tag');
  });

  it('gives the seeded categories a sensible icon before anyone picks one', () => {
    assert.equal(iconOf({ id: 'Rent' }, 'category'), 'key');
    assert.equal(iconOf({ id: 'Ins' }, 'category'), 'shield');
    assert.equal(iconOf({ id: 'Repairs' }, 'category'), 'nut');
    assert.equal(iconOf({ id: 'Interest' }, 'category'), 'percent');
    assert.equal(iconOf({ id: 'Management' }, 'category'), 'briefcase');
  });

  it('always returns something in the bank', () => {
    // A record with a mark and one without would read as a mistake rather than
    // a choice, so there is no "no icon" state.
    for (const record of [{}, { id: '' }, { id: 'whatever' }, { icon: null }]) {
      assert.ok(iconByKey('property', iconOf(record, 'property')), JSON.stringify(record));
      assert.ok(iconByKey('category', iconOf(record, 'category')), JSON.stringify(record));
    }
  });
});

describe('marks', () => {
  it('hands back the whole icon, ready to render', () => {
    const mark = propertyMark({ id: 'p1', icon: 'flat' });
    assert.equal(mark.key, 'flat');
    assert.ok(mark.d);
    assert.equal(categoryMark({ id: 'Rent' }).key, 'key');
  });
});
