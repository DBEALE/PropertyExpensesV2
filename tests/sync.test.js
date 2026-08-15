/**
 * The two decisions that keep sync from losing work.
 *
 * Both are deliberately pure so they can be reasoned about without a network,
 * a gist or a browser — everything else in `sync.js` is plumbing between
 * modules that already have their own tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDecision, pushDecision } from '../src/sync.js';

describe('pushDecision', () => {
  it('creates the first revision when the gist is empty', () => {
    assert.equal(pushDecision(null, null), 'first-push');
  });

  it('allows a push when nothing has moved under us', () => {
    assert.equal(pushDecision('v2', 'v2'), 'ok');
  });

  it('stops a push when the gist has advanced', () => {
    // The whole point: A pushed v2 while we were still holding v1.
    assert.equal(pushDecision('v1', 'v2'), 'behind');
  });

  it('stops a push when this device has never seen the gist', () => {
    // Connecting to an existing gist and immediately pushing would wipe it.
    assert.equal(pushDecision(null, 'v2'), 'behind');
    assert.equal(pushDecision(undefined, 'v2'), 'behind');
  });
});

describe('openDecision', () => {
  const cases = [
    { dirty: false, moved: false, expected: 'nothing', why: 'in step' },
    { dirty: false, moved: true, expected: 'fast-forward', why: 'nothing local to lose' },
    { dirty: true, moved: false, expected: 'nothing', why: 'the tab dot already says so' },
    { dirty: true, moved: true, expected: 'merge', why: 'both sides moved' },
  ];

  for (const { dirty, moved, expected, why } of cases) {
    it(`${dirty ? 'dirty' : 'clean'} + ${moved ? 'moved' : 'unmoved'} → ${expected} (${why})`, () => {
      assert.equal(openDecision(dirty, moved), expected);
    });
  }

  it('never fast-forwards over unpushed local work', () => {
    // Fast-forward replaces local data outright, so it must only ever run when
    // there is provably nothing there that has not been sent.
    assert.notEqual(openDecision(true, true), 'fast-forward');
    assert.notEqual(openDecision(true, false), 'fast-forward');
  });

  it('never writes anything when the remote has not moved', () => {
    assert.equal(openDecision(true, false), 'nothing');
    assert.equal(openDecision(false, false), 'nothing');
  });
});
