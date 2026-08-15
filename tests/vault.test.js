/**
 * Sealing the backup document for storage somewhere you do not control.
 *
 * The property that has to hold is that a wrong passphrase or a tampered
 * payload *fails* rather than returning something plausible. Everything
 * downstream — the merge especially — trusts that what comes out of `open` is
 * what went into `seal`, so a silent corruption here would be laundered into
 * the user's real data.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ITERATIONS, VAULT_VERSION, VaultError, open, seal } from '../src/vault.js';

/** Close enough in shape to the real thing to be worth round-tripping. */
const DOCUMENT = {
  format: 'property-expenses-backup',
  version: 6,
  exportedAt: '2026-08-15T09:00:00.000Z',
  properties: [{ id: 'p1', name: '3 Peterborough Gardens', colour: 'orange', icon: 'house' }],
  categories: [{ id: 'Rent', name: 'Rent', description: 'Rent received from tenants.' }],
  propertyDetails: [
    {
      id: 'd1',
      propertyId: 'p1',
      section: 'tenancy',
      effectiveFrom: '2025-01-01',
      data: { tenantName: 'S Agyapong', rentAmount: '1150' },
    },
  ],
  complianceTypes: [],
  complianceCompletions: [],
  complianceExemptions: [],
  settings: [{ id: 'tax', otherIncome: 45000 }],
  rules: [],
  transactions: [
    {
      id: 't1',
      date: '2026-07-24',
      details: 'S Agyapong 3 PETERBOROUGH GAT',
      amount: 1150,
      notes: 'Cheque — cleared late',
      propertyId: 'p1',
      category: 'Rent',
    },
  ],
};

const PASSPHRASE = 'correct horse battery staple';

describe('seal and open', () => {
  it('round-trips a document unchanged', async () => {
    const opened = await open(await seal(DOCUMENT, PASSPHRASE), PASSPHRASE);
    assert.deepEqual(opened, DOCUMENT);
  });

  it('survives the characters a real record actually contains', async () => {
    // Non-ASCII in tenant names and the app's own curly quotes must come back
    // byte-identical, or a round trip would quietly rewrite people's names.
    const awkward = {
      ...DOCUMENT,
      properties: [{ id: 'p1', name: 'Flat 4, Mühlenstraße — “the annexe”' }],
      transactions: [{ id: 't1', details: 'CAFÉ ROUGE 東京', notes: 'Ünïcødé ✓ £30.16' }],
    };
    assert.deepEqual(await open(await seal(awkward, PASSPHRASE), PASSPHRASE), awkward);
  });

  it('produces an envelope that says how it was made', async () => {
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    assert.equal(envelope.v, VAULT_VERSION);
    assert.equal(envelope.kdf, 'PBKDF2-SHA256');
    assert.equal(envelope.iterations, ITERATIONS);
    // Everything a future version needs to open this without guessing.
    for (const key of ['salt', 'iv', 'ciphertext']) {
      assert.equal(typeof envelope[key], 'string', `${key} should be base64 text`);
      assert.ok(envelope[key].length > 0);
    }
  });

  it('leaks nothing readable into the envelope', async () => {
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    const blob = JSON.stringify(envelope);
    for (const secret of ['Peterborough', 'Agyapong', '1150', 'cleared late']) {
      assert.ok(!blob.includes(secret), `"${secret}" is readable in the sealed envelope`);
    }
  });

  it('seals identical input differently every time', async () => {
    // A fresh salt and IV per push, so nobody watching the gist can tell
    // whether anything changed between two revisions.
    const a = await seal(DOCUMENT, PASSPHRASE);
    const b = await seal(DOCUMENT, PASSPHRASE);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.deepEqual(await open(b, PASSPHRASE), DOCUMENT);
  });

  it('compresses, so a big document stays well inside the gist limit', async () => {
    // The Gist API truncates `content` over 1MB. Two thousand transactions is
    // a realistic few years of statements.
    const big = {
      ...DOCUMENT,
      transactions: Array.from({ length: 2000 }, (_, i) => ({
        id: `t${i}`,
        date: '2026-07-24',
        details: 'DIRECT LINE FR BUS',
        transactionType: 'Direct Debit',
        amount: -30.16,
        balance: 16019.21,
        propertyId: 'p1',
        category: 'Ins',
        matchedRuleId: null,
        sourceFilename: 'july.csv',
        importedAt: '2026-08-01T00:00:00.000Z',
      })),
    };
    const raw = JSON.stringify(big).length;
    const sealed = JSON.stringify(await seal(big, PASSPHRASE)).length;
    assert.ok(raw > 400_000, `expected a big fixture, got ${raw} bytes`);
    assert.ok(sealed < raw / 4, `sealed ${sealed} vs raw ${raw} — compression is not working`);
    assert.ok(sealed < 1_000_000, `sealed ${sealed} bytes would be truncated by the Gist API`);
  });
});

describe('when it should refuse', () => {
  it('rejects the wrong passphrase with a named error, not an OperationError', async () => {
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    await assert.rejects(() => open(envelope, 'not the passphrase'), (error) => {
      assert.ok(error instanceof VaultError, `got ${error.name}: ${error.message}`);
      assert.match(error.message, /passphrase/i);
      return true;
    });
  });

  it('rejects a tampered ciphertext rather than returning rubbish', async () => {
    // AES-GCM authenticates as well as encrypts. Without that guarantee a
    // corrupted gist could be laundered straight into the user's data.
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    const bytes = [...atob(envelope.ciphertext)].map((c) => c.charCodeAt(0));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered = { ...envelope, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await assert.rejects(() => open(tampered, PASSPHRASE), VaultError);
  });

  it('rejects a tampered salt or IV', async () => {
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    await assert.rejects(() => open({ ...envelope, salt: btoa('sixteen bytes!!!') }, PASSPHRASE), VaultError);
    await assert.rejects(() => open({ ...envelope, iv: btoa('twelve bytes') }, PASSPHRASE), VaultError);
  });

  it('refuses a format it does not understand rather than guessing', async () => {
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    await assert.rejects(() => open({ ...envelope, v: 99 }, PASSPHRASE), /format 99/);
    await assert.rejects(() => open({ ...envelope, kdf: 'scrypt' }, PASSPHRASE), /scrypt/);
  });

  it('refuses an empty passphrase at both ends', async () => {
    await assert.rejects(() => seal(DOCUMENT, ''), VaultError);
    const envelope = await seal(DOCUMENT, PASSPHRASE);
    await assert.rejects(() => open(envelope, ''), VaultError);
  });

  it('refuses something that is not a vault at all', async () => {
    for (const notAVault of [null, undefined, 'a string', 42]) {
      await assert.rejects(() => open(notAVault, PASSPHRASE), VaultError);
    }
  });
});
