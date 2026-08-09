Add a way to sync property data between browsers/devices via a private GitHub repo, so a small team can share one dataset without a server.

Read the existing code first and match its conventions: `db.js` (store/version pattern), `store.js` (state + CRUD conventions), `backup.js` (`buildBackup`/`validateBackup`, reject-rather-than-repair philosophy), and the Node-test-runner, DOM-free style used for `accounts.js`, `compliance.js` etc.

## Design summary

- The **app code** stays in this repo (`PropertyExpensesV2`), public, deployed to GitHub Pages as now — it contains no secrets, so this is unchanged.
- The **data** goes in a **separate, private** GitHub repo, created manually by the user (not by this build) — e.g. `PropertyExpenses-data`, containing just one JSON file.
- Each person's browser holds their own **GitHub personal access token** (fine-grained, scoped to only that private repo, Contents: Read and write) and a **shared group key** (a GUID, the same value on every team member's device). Neither is ever written into the app-code repo, the exported backup file, or the synced data file itself — both live only in this browser's local storage, entered once per device.
- Data is encrypted client-side with the group key before it leaves the browser, so the token controls *who can reach the file*, and the encryption controls *who can read it* if that ever diverges (e.g. a token is later revoked but the ciphertext was already fetched).
- Sync is **manual** (a Pull button and a Push button), not automatic/background — predictable, and avoids surprise GitHub API usage.
- This is **last-write-wins with conflict detection**, not real merging. If someone else has pushed since your last pull, your push is rejected with a clear message telling you to pull first — never silently overwritten.

## New module: `sync-crypto.js`

DOM-free, using the Web Crypto API (`crypto.subtle`), which Node also implements — keep it testable with `node --test` like the rest of the codebase.

- `deriveKey(groupKey)` — derives an AES-256-GCM `CryptoKey` from the group key string via HKDF. Don't use the raw GUID bytes directly as key material even though its entropy is adequate; derive properly.
- `encryptPayload(key, plaintext)` — generates a fresh random 12-byte IV via `crypto.getRandomValues` for every call (never reuse an IV with the same key), encrypts, and returns a versioned envelope: `{ format: 'property-expenses-sync', version: 1, iv: base64, ciphertext: base64 }`.
- `decryptPayload(key, envelope)` — rejects an unrecognized `format`/`version` up front. Lets GCM's authentication tag do its job: a wrong key or any tampering must throw, not silently return corrupted JSON. Wrap the SubtleCrypto failure in a clear `DecryptionError` ("wrong group key, or the file is corrupted") rather than leaking the raw low-level error.

## New module: `github-sync.js`

Talks to the GitHub Contents API directly from the browser (it supports CORS with an `Authorization` header, no proxy needed).

- `pull(settings)` — `GET /repos/{owner}/{repo}/contents/{path}` with the token. Base64-decode the content, decrypt with `decryptPayload`, `JSON.parse`, then run through the existing `validateBackup` from `backup.js` before returning it — a corrupted or malicious file must be rejected the same way a bad local backup already is. A 404 means "nothing pushed yet" and should return `null`, not throw.
- `push(settings, backupObject, lastKnownSha)` — build the backup via the existing `buildBackup`, `JSON.stringify`, encrypt, base64-encode, then `PUT` to the same endpoint. Include `sha: lastKnownSha` when updating an existing file (required by the API to prevent blind overwrites); omit it when creating the file for the first time.
- Distinct, typed errors so the UI can react appropriately: `SyncAuthError` (401/403 — bad or insufficiently-scoped token), `SyncConflictError` (409 — someone else pushed since your last pull), `SyncNotFoundError` (repo or path doesn't exist — check settings).

## Settings storage

Add a `syncSettings` object store (single record, following the same `db.js` pattern as the other stores) holding: `token`, `owner`, `repo`, `branch` (default `main`), `path` (default `property-expenses-sync.json`), `groupKey`, `lastSyncedSha`, `lastSyncedAt`.

This store must **never** be included in `buildBackup`/`validateBackup` and must **never** be part of `db.js`'s `replaceAll` used by backup restore — the token and group key must not end up inside the JSON backup file a user might casually share or attach to an email. Keep it structurally separate from the syncable data stores.

## UI: new "Sync" screen

A settings section: token (password-style input, masked after saving — don't redisplay it in plaintext), owner/repo/branch/path fields, and the group key, with two ways to fill the key in: **Generate new** (`crypto.randomUUID()`, for starting a brand-new shared dataset) or paste one in (for joining an existing team). Make clear in the copy that the token and key are stored only in this browser, are never included in the downloadable backup file, and need to be recorded somewhere durable (a password manager) to set up a second device.

Below that: **Pull latest** and **Push now** buttons with status feedback — last synced time, an in-progress state, and a clear message on `SyncConflictError` telling the user to pull before pushing again. Pulling should go through the same confirmation step the existing local-file restore already uses before it overwrites what's in this browser (reuse `restoreBackup` from `store.js` once the pulled data is validated).

## Explicitly out of scope

- No automatic/background sync — manual buttons only.
- No real conflict merging — detection and a clear message only.
- No change to the existing local JSON backup download/restore — this is an additional sync path, not a replacement for it.
- Creating the private GitHub repo and the personal access token are manual one-time setup steps for the user; document them in the README rather than automating them.

## Tests

Add `tests/sync-crypto.test.js`:
- Round-trip: `decryptPayload(key, encryptPayload(key, plaintext))` returns the original plaintext.
- Decrypting with the wrong key throws `DecryptionError`.
- Flipping a byte in the ciphertext (simulating tampering or corruption) throws rather than returning malformed JSON.
- An envelope with an unrecognized `version` is rejected before attempting to decrypt.

Add `tests/github-sync.test.js` with a mocked `fetch`:
- `pull` returns `null` on a 404 rather than throwing.
- `pull` on a well-formed response decrypts and validates correctly; a response that decrypts to something `validateBackup` rejects throws rather than being returned.
- `push` sends `sha` when one is provided and omits it when creating a new file.
- A 409 response from `push` surfaces as `SyncConflictError`; a 401/403 surfaces as `SyncAuthError`.

## Acceptance check

Simulate two devices sharing one group key and token settings: push a backup from "device A", pull it on "device B" and confirm the restored properties/transactions match exactly. Then push again from "device A" without device B pulling first, and confirm device B's subsequent push is rejected with `SyncConflictError` rather than silently overwriting device A's newer data.

## README additions

Document the manual setup: create a private repo for the data, create a fine-grained personal access token scoped to just that repo with Contents read/write, and share the group key with teammates out-of-band (a password manager, not the repo, not a commit message, not an issue). State plainly that if the group key ever leaks, anyone who has a copy of the encrypted file can decrypt it — rotating the key afterwards protects future pushes but not what was already fetched.
