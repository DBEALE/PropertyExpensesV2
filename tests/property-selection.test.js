import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OVERVIEW, resolveSelectedProperty } from '../src/views/property.js';

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

  it('shows the overview on a first visit, before anything has been opened', () => {
    assert.equal(resolveSelectedProperty(PROPERTIES, null, null), OVERVIEW);
  });

  it('falls back to the overview rather than sticking on a deleted property', () => {
    assert.equal(resolveSelectedProperty(PROPERTIES, 'gone', 'p2'), OVERVIEW, 'a stale URL id is not silently swapped');
    assert.equal(resolveSelectedProperty(PROPERTIES, null, 'gone'), OVERVIEW, 'a stale memory drops to the overview');
    assert.equal(resolveSelectedProperty(PROPERTIES, 'gone', 'gone'), OVERVIEW);
  });

  it('shows the overview when there are no properties at all', () => {
    assert.equal(resolveSelectedProperty([], 'p1', 'p2'), OVERVIEW);
  });

  it('never silently shows a different property than the URL asked for', () => {
    // Landing on someone else's figures because an id went stale would be
    // worse than landing on the overview.
    for (const requested of ['gone', 'p9']) {
      assert.equal(resolveSelectedProperty(PROPERTIES, requested, 'p1'), OVERVIEW);
    }
  });
});
