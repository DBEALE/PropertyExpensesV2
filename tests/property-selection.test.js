import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSelectedProperty } from '../src/views/property.js';

const PROPERTIES = [
  { id: 'p1', name: 'Ash Close' },
  { id: 'p2', name: 'Elm Road' },
  { id: 'p3', name: 'Peterborough Gate' },
];

describe('resolveSelectedProperty', () => {
  it('uses the id in the URL when there is one', () => {
    // A link from Config or a bookmark means that property specifically.
    assert.equal(resolveSelectedProperty(PROPERTIES, 'p3', 'p2').id, 'p3');
  });

  it('falls back to the one last viewed when the URL has no id', () => {
    // This is what makes leaving the tab and coming back keep your place.
    assert.equal(resolveSelectedProperty(PROPERTIES, null, 'p2').id, 'p2');
    assert.equal(resolveSelectedProperty(PROPERTIES, undefined, 'p3').id, 'p3');
  });

  it('falls back to the first when nothing has been viewed yet', () => {
    assert.equal(resolveSelectedProperty(PROPERTIES, null, null).id, 'p1');
  });

  it('falls back rather than sticking on a property that has been deleted', () => {
    assert.equal(resolveSelectedProperty(PROPERTIES, 'gone', 'p2').id, 'p2', 'a stale URL uses the remembered one');
    assert.equal(resolveSelectedProperty(PROPERTIES, null, 'gone').id, 'p1', 'a stale memory uses the first');
    assert.equal(resolveSelectedProperty(PROPERTIES, 'gone', 'gone').id, 'p1');
  });

  it('returns nothing when there are no properties at all', () => {
    assert.equal(resolveSelectedProperty([], 'p1', 'p2'), null);
  });
});
