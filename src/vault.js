/**
 * Sealing the backup document so it can be stored somewhere you do not control.
 *
 * A secret GitHub Gist is *unlisted*, not private: anyone holding the URL can
 * read it. So the encryption here is not decoration — it is the only thing
 * standing between a leaked link and a stranger reading your bank transactions,
 * your tenants' names and the addresses they live at. The provider stores an
 * opaque blob and could not help an attacker if it wanted to.
 *
 * The order is **compress, then encrypt**, and it matters twice over.
 * Ciphertext is indistinguishable from noise and does not compress at all, so
 * the other order would achieve nothing. And the size actually counts here: the
 * Gist API truncates a file's `content` above 1MB, and base64 inflates whatever
 * it wraps by a third. A few thousand transactions of JSON is a couple of
 * megabytes and gzips by roughly ten to one, which is the difference between
 * fitting comfortably and having to chase `raw_url` on every read.
 *
 * WebCrypto only — no dependencies, and the same code runs in the browser and
 * under `node --test`.
 */

/** Everything about how a payload was sealed, so a future format can change it. */
export const VAULT_VERSION = 1;
const KDF = 'PBKDF2-SHA256';
/** OWASP's floor for PBKDF2-SHA256 at the time of writing. */
export const ITERATIONS = 600000;
const SALT_BYTES = 16;
/** 96 bits, the size AES-GCM is specified around. */
const IV_BYTES = 12;

/**
 * A passphrase that does not open a vault.
 *
 * Named, because AES-GCM's failure is an `OperationError` with no message —
 * showing that to someone who has simply mistyped would be useless.
 */
export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes to base64, chunked so a large payload cannot blow the argument limit. */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Runs bytes through a compression stream and collects the result. */
async function through(stream, bytes) {
  const written = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(written).arrayBuffer());
}

const gzip = (bytes) => through(new CompressionStream('gzip'), bytes);
const gunzip = (bytes) => through(new DecompressionStream('gzip'), bytes);

/**
 * Stretches a passphrase into an AES key.
 *
 * The iteration count and salt travel with the envelope rather than being
 * baked in here, so raising the count later still leaves old vaults openable.
 */
async function keyFrom(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * @typedef {object} Envelope
 * @property {number} v format version
 * @property {string} kdf how the key was derived
 * @property {number} iterations
 * @property {string} salt base64
 * @property {string} iv base64
 * @property {string} ciphertext base64
 */

/**
 * Seals a document.
 *
 * A fresh salt and IV every time, so two pushes of identical data produce
 * completely different envelopes — nobody watching the gist can tell whether
 * anything actually changed, or how often you edit which parts.
 *
 * @param {unknown} document anything JSON-serialisable
 * @param {string} passphrase
 * @returns {Promise<Envelope>}
 */
export async function seal(document, passphrase) {
  if (typeof passphrase !== 'string' || passphrase === '') {
    throw new VaultError('A passphrase is needed to seal the vault.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await keyFrom(passphrase, salt, ITERATIONS);
  const packed = await gzip(encoder.encode(JSON.stringify(document)));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed);

  return {
    v: VAULT_VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(sealed)),
  };
}

/**
 * Opens a sealed document.
 *
 * AES-GCM authenticates as well as encrypts, so a wrong passphrase and a
 * tampered payload fail identically and neither can return plausible-looking
 * rubbish. That is the property that lets the caller trust what comes out.
 *
 * @param {Envelope} envelope
 * @param {string} passphrase
 */
export async function open(envelope, passphrase) {
  if (!envelope || typeof envelope !== 'object') {
    throw new VaultError('That is not a vault file.');
  }
  if (envelope.v !== VAULT_VERSION) {
    throw new VaultError(`This vault was written in format ${envelope.v}, which this app cannot read.`);
  }
  if (envelope.kdf !== KDF) {
    throw new VaultError(`This vault uses ${envelope.kdf}, which this app cannot read.`);
  }
  if (typeof passphrase !== 'string' || passphrase === '') {
    throw new VaultError('A passphrase is needed to open the vault.');
  }

  const key = await keyFrom(passphrase, fromBase64(envelope.salt), envelope.iterations);

  let packed;
  try {
    packed = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    // Deliberately one message for both causes: we genuinely cannot tell a
    // mistyped passphrase from a corrupted payload, and guessing would send
    // someone hunting the wrong problem.
    throw new VaultError('That passphrase does not open this vault, or the file has been damaged.');
  }

  try {
    return JSON.parse(decoder.decode(await gunzip(new Uint8Array(packed))));
  } catch {
    // Past the auth tag but unreadable: the payload was sealed by something
    // that did not follow this format.
    throw new VaultError('The vault opened but its contents could not be read.');
  }
}
