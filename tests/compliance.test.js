/**
 * Compliance scheduling: when an inspection is next due, when it is late, and
 * what happens to the record of it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBackup, validateBackup } from '../src/backup.js';
import {
  DEFAULT_COMPLIANCE_TYPES,
  complianceStatus,
  complianceTypeIdFor,
  completionHistory,
  completionsForType,
  lastCompletion,
  nextDue,
  upcomingCompliance,
} from '../src/compliance.js';
import { addMonths } from '../src/dates.js';

const GAS = { id: 'gas-safety-certificate', name: 'Gas Safety Certificate', frequencyMonths: 12, description: '' };
const EICR = { id: 'eicr', name: 'EICR', frequencyMonths: 60, description: '' };
const TYPES = [GAS, EICR];

function completion(id, typeId, completedDate, propertyId = 'p1') {
  return { id, propertyId, complianceTypeId: typeId, completedDate, reference: '', notes: '' };
}

describe('defaults', () => {
  it('seeds the four statutory checks with their frequencies', () => {
    assert.deepEqual(
      DEFAULT_COMPLIANCE_TYPES.map((t) => [t.name, t.frequencyMonths]),
      [
        ['Gas Safety Certificate', 12],
        ['EICR (Electrical Installation Condition Report)', 60],
        ['PAT Testing', 12],
        ['Legionella Risk Assessment', 24],
      ],
    );
  });

  it('gives each an id that survives a rename', () => {
    // Ids are the slug of the original name, so completions keep resolving.
    assert.equal(DEFAULT_COMPLIANCE_TYPES[0].id, 'gas-safety-certificate');
    assert.ok(DEFAULT_COMPLIANCE_TYPES.every((t) => /^[a-z0-9-]+$/.test(t.id)));
  });
});

describe('complianceTypeIdFor', () => {
  it('slugs the name', () => {
    assert.equal(complianceTypeIdFor('Fire Alarm Service', []), 'fire-alarm-service');
    assert.equal(complianceTypeIdFor('EICR (5 yearly)', []), 'eicr-5-yearly');
  });

  it('keeps ids unique', () => {
    const existing = [{ id: 'fire-alarm-service' }, { id: 'fire-alarm-service-2' }];
    assert.equal(complianceTypeIdFor('Fire Alarm Service', existing), 'fire-alarm-service-3');
  });

  it('falls back when the name slugs to nothing', () => {
    assert.equal(complianceTypeIdFor('!!!', []), 'compliance-type');
  });
});

describe('nextDue', () => {
  it('adds the frequency to the last completion', () => {
    assert.equal(nextDue('2026-07-24', 12), '2027-07-24');
    assert.equal(nextDue('2026-07-24', 60), '2031-07-24');
  });

  it('clamps to the end of a short month, exactly as addMonths does', () => {
    // 31 August + 6 months is 28 February, not 3 March.
    assert.equal(nextDue('2025-08-31', 6), '2026-02-28');
    assert.equal(nextDue('2025-08-31', 6), addMonths('2025-08-31', 6));
    // And a leap year gives the 29th.
    assert.equal(nextDue('2027-08-31', 6), '2028-02-29');
  });

  it('has no answer when the inspection has never been done', () => {
    assert.equal(nextDue(null, 12), null);
    assert.equal(nextDue('', 12), null);
  });

  it('has no answer for a nonsensical frequency', () => {
    assert.equal(nextDue('2026-07-24', 0), null);
    assert.equal(nextDue('2026-07-24', -12), null);
    assert.equal(nextDue('2026-07-24', 'soon'), null);
  });
});

describe('lastCompletion and history', () => {
  const completions = [
    completion('c1', 'gas-safety-certificate', '2024-07-01'),
    completion('c3', 'gas-safety-certificate', '2026-07-01'),
    completion('c2', 'gas-safety-certificate', '2025-07-01'),
    completion('other', 'gas-safety-certificate', '2027-01-01', 'p2'),
  ];

  it('finds the most recent for this property, whatever order they are stored in', () => {
    assert.equal(lastCompletion(completions, 'p1', 'gas-safety-certificate').id, 'c3');
  });

  it('does not look at another property or another type', () => {
    assert.equal(lastCompletion(completions, 'p1', 'eicr'), null);
    assert.equal(lastCompletion(completions, 'p3', 'gas-safety-certificate'), null);
  });

  it('lists history newest first', () => {
    assert.deepEqual(
      completionHistory(completions, 'p1', 'gas-safety-certificate').map((c) => c.id),
      ['c3', 'c2', 'c1'],
    );
  });
});

describe('completionsForType', () => {
  const completions = [
    completion('c1', 'gas-safety-certificate', '2026-01-01', 'p1'),
    completion('c2', 'gas-safety-certificate', '2026-02-01', 'p2'),
    completion('c3', 'eicr', '2026-03-01', 'p1'),
  ];

  it('finds what deleting a type would take with it, across every property', () => {
    // The cascade in deleteComplianceType uses this, so it must not be
    // property-scoped: a shared type's completions live under many properties.
    assert.deepEqual(
      completionsForType(completions, 'gas-safety-certificate').map((c) => c.id),
      ['c1', 'c2'],
    );
  });

  it('returns nothing, rather than throwing, when a type has none', () => {
    assert.deepEqual(completionsForType(completions, 'pat-testing'), []);
    assert.deepEqual(completionsForType([], 'gas-safety-certificate'), []);
  });
});

describe('complianceStatus', () => {
  it('is due a year later, and not overdue the day before', () => {
    const completions = [completion('c1', 'gas-safety-certificate', '2026-07-24')];
    const onTime = complianceStatus(TYPES, completions, 'p1', '2027-07-23').find((s) => s.type.id === GAS.id);
    assert.equal(onTime.nextDue, '2027-07-24');
    assert.equal(onTime.overdue, false);
    assert.equal(onTime.neverRecorded, false);
    assert.equal(onTime.lastCompletedDate, '2026-07-24');
  });

  it('is overdue once today passes the due date', () => {
    const completions = [completion('c1', 'gas-safety-certificate', '2026-07-24')];
    const late = complianceStatus(TYPES, completions, 'p1', '2027-07-25').find((s) => s.type.id === GAS.id);
    assert.equal(late.overdue, true);
  });

  it('reports a never-recorded type as such, without inventing a due date', () => {
    const status = complianceStatus(TYPES, [], 'p1', '2026-07-24');
    assert.ok(status.every((s) => s.neverRecorded === true));
    assert.ok(status.every((s) => s.nextDue === null));
    // Never recorded is not the same as overdue — there is no date to be late against.
    assert.ok(status.every((s) => s.overdue === false));
  });

  it('covers every type, whether or not it has completions', () => {
    const status = complianceStatus(TYPES, [completion('c1', 'gas-safety-certificate', '2026-01-01')], 'p1', '2026-07-24');
    assert.equal(status.length, 2);
    assert.equal(status.find((s) => s.type.id === 'eicr').neverRecorded, true);
  });
});

describe('upcomingCompliance', () => {
  const completions = [
    completion('c1', 'gas-safety-certificate', '2025-09-01'), // due 2026-09-01
    completion('c2', 'eicr', '2024-01-01'), // due 2029-01-01
  ];

  it('reports what falls due inside the window', () => {
    const due = upcomingCompliance(TYPES, completions, 'p1', '2026-08-01', 90);
    assert.deepEqual(due.map((d) => d.label), ['Gas Safety Certificate']);
    assert.equal(due[0].date, '2026-09-01');
    assert.equal(due[0].overdue, false);
  });

  it('leaves out what is beyond the window', () => {
    assert.deepEqual(upcomingCompliance(TYPES, completions, 'p1', '2026-01-01', 90), []);
  });

  it('always includes something already overdue, however long ago', () => {
    // A year past due is well outside a 90-day window, but must not disappear.
    const due = upcomingCompliance(TYPES, completions, 'p1', '2027-10-01', 90);
    assert.equal(due.length, 1);
    assert.equal(due[0].overdue, true);
  });

  it('matches the shape of upcomingDates so the two can be merged', () => {
    const [item] = upcomingCompliance(TYPES, completions, 'p1', '2026-08-01', 90);
    assert.deepEqual(Object.keys(item).sort(), ['date', 'label', 'overdue', 'section']);
  });

  it('says nothing for a property with no completions logged', () => {
    assert.deepEqual(upcomingCompliance(TYPES, [], 'p1', '2026-08-01', 90), []);
  });
});

describe('backup of compliance data', () => {
  const state = {
    properties: [{ id: 'p1', name: '3 Peterborough Gate' }],
    categories: [{ id: 'Rent', name: 'Rent', description: '' }],
    propertyDetails: [],
    complianceTypes: TYPES,
    complianceCompletions: [completion('c1', 'gas-safety-certificate', '2026-07-24')],
    rules: [],
    transactions: [],
  };
  const backup = () => JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00Z')));

  it('round-trips both stores', () => {
    const restored = validateBackup(backup());
    assert.equal(restored.complianceTypes.length, 2);
    assert.equal(restored.complianceCompletions.length, 1);
    assert.equal(restored.complianceCompletions[0].complianceTypeId, 'gas-safety-certificate');
  });

  it('rejects a completion referencing an unknown type', () => {
    const file = backup();
    file.complianceCompletions[0].complianceTypeId = 'vanished';
    assert.throws(() => validateBackup(file), /compliance completions/i);
  });

  it('rejects a completion referencing an unknown property', () => {
    const file = backup();
    file.complianceCompletions[0].propertyId = 'ghost';
    assert.throws(() => validateBackup(file), /compliance completions/i);
  });

  it('rejects a type with a nonsensical frequency', () => {
    const file = backup();
    file.complianceTypes[0].frequencyMonths = 0;
    assert.throws(() => validateBackup(file), /compliance types/i);
  });

  it('accepts an older backup that predates compliance entirely', () => {
    const older = { format: 'property-expenses-backup', properties: [], rules: [], transactions: [] };
    const restored = validateBackup(older);
    assert.deepEqual(restored.complianceTypes, []);
    assert.deepEqual(restored.complianceCompletions, []);
  });
});

describe('acceptance: a certificate that lapsed a fortnight ago', () => {
  const today = '2026-08-07';
  // Completed a year and two weeks before today.
  const completions = [completion('c1', 'gas-safety-certificate', '2025-07-24')];

  it('shows as overdue, and as overdue in the coming-up list rather than upcoming', () => {
    const status = complianceStatus(TYPES, completions, 'p1', today).find((s) => s.type.id === GAS.id);
    assert.equal(status.nextDue, '2026-07-24');
    assert.equal(status.overdue, true);

    const [banner] = upcomingCompliance(TYPES, completions, 'p1', today, 90);
    assert.equal(banner.overdue, true);
    assert.equal(banner.date, '2026-07-24');
  });

  it('clears once a completion is logged today, with next due a year out', () => {
    const after = [...completions, completion('c2', 'gas-safety-certificate', today)];
    const status = complianceStatus(TYPES, after, 'p1', today).find((s) => s.type.id === GAS.id);
    assert.equal(status.overdue, false);
    assert.equal(status.nextDue, '2027-08-07');
    // The earlier certificate is still on record.
    assert.equal(status.history.length, 2);
  });
});
