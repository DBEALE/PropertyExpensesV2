/**
 * The changelog is data, and the convention is that every feature gets an
 * entry. These are the checks that keep it usable as one: dated, ordered,
 * and written in something other than commit messages.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RELEASES, latestRelease } from '../src/whats-new.js';

describe('the What’s new entries', () => {
  it('has something to say', () => {
    assert.ok(RELEASES.length > 0);
  });

  it('dates every entry as an ISO day', () => {
    for (const release of RELEASES) {
      assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on "${release.title}"`);
      assert.ok(!Number.isNaN(Date.parse(release.date)), `unparseable date on "${release.title}"`);
    }
  });

  it('runs newest first, which is the order it is rendered in', () => {
    const dates = RELEASES.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it('gives every entry a title and at least one point', () => {
    for (const release of RELEASES) {
      assert.ok(release.title?.trim(), 'an entry with no title says nothing');
      assert.ok(Array.isArray(release.points) && release.points.length > 0, `no points on "${release.title}"`);
      for (const point of release.points) {
        assert.ok(point.trim().length > 0, `blank point on "${release.title}"`);
      }
    }
  });

  it('points at the newest entry', () => {
    assert.equal(latestRelease(), RELEASES[0]);
  });
});
