/**
 * The GitHub Gist end of cloud sync.
 *
 * Plain `fetch` against the REST API rather than an SDK — this project has no
 * bundler and no dependencies, and adding one for four HTTP calls would be a
 * bigger change to how it works than the sync feature itself.
 *
 * A gist is a git repository, which is the property the rest of the design
 * leans on: every write is a commit, `history` gives us the version identifiers
 * that make conflict detection possible, and any earlier revision stays
 * retrievable. That last part is what makes an accidental overwrite survivable
 * — and it is why the weaker conflict detection here (the API has no
 * conditional write) is an acceptable trade rather than a hole.
 *
 * Nothing in this file knows what the payload means. It moves opaque text.
 */

const API = 'https://api.github.com';
/** The file inside the gist. Named so it is obvious what it is years later. */
export const VAULT_FILE = 'property-expenses.vault.json';
/** A plain-text neighbour, so someone finding the gist can tell what it is. */
const README_FILE = 'README.md';

const README = `# Property Expenses — encrypted vault

This gist is the synced data for a personal buy-to-let bookkeeping app.

\`${VAULT_FILE}\` is **encrypted on the device before it is uploaded** —
gzip, then AES-256-GCM with a key derived from a passphrase that is never sent
anywhere. Without that passphrase the contents cannot be read, including by
anyone who has this URL and by GitHub.

Every revision of this gist is a saved state; the history is the backup.
`;

/** An HTTP problem worth showing a person, rather than a raw status code. */
export class GistError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GistError';
    this.status = status;
  }
}

async function call(token, path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    // fetch only rejects for network-level failures, which for an offline-first
    // app is an expected state rather than an error to shout about.
    throw new GistError('Could not reach GitHub. Check your connection and try again.', 0);
  }

  if (response.ok) return response.json();

  const detail = await response.json().catch(() => ({}));
  throw new GistError(gistMessage(response.status, detail.message), response.status);
}

/** Turns the statuses this app can actually provoke into instructions. */
function gistMessage(status, message) {
  if (status === 401) return 'GitHub rejected that token. Check it has not expired or been revoked.';
  if (status === 403) {
    return message?.includes('rate limit')
      ? 'GitHub rate limit reached. Wait a few minutes and try again.'
      : 'That token does not have permission to read and write gists.';
  }
  if (status === 404) {
    return 'That gist could not be found. Check the id, and that the token can see it.';
  }
  if (status === 422) return `GitHub would not accept the vault: ${message ?? 'unprocessable'}`;
  return `GitHub returned ${status}${message ? `: ${message}` : ''}.`;
}

/** The current revision id — a commit sha, so it changes on every write. */
function versionOf(gist) {
  return gist?.history?.[0]?.version ?? null;
}

function filesFor(envelope) {
  return {
    [VAULT_FILE]: { content: JSON.stringify(envelope) },
    [README_FILE]: { content: README },
  };
}

/**
 * Reads the vault file out of a gist response.
 *
 * The API truncates `content` above 1MB and hands back a `raw_url` instead.
 * Compression should keep us well under that, but "should" is not a thing to
 * rely on for someone's only copy of their records.
 */
async function contentOf(gist) {
  const file = gist.files?.[VAULT_FILE];
  if (!file) {
    throw new GistError(`That gist has no ${VAULT_FILE} in it — is it the right one?`, 404);
  }
  if (!file.truncated) return file.content;

  const response = await fetch(file.raw_url);
  if (!response.ok) throw new GistError('Could not download the full vault from GitHub.', response.status);
  return response.text();
}

function parseEnvelope(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new GistError('The vault file in that gist is not readable JSON.', 0);
  }
}

/** Confirms a token works, and says who it belongs to. */
export async function whoami(token) {
  const user = await call(token, '/user');
  return user.login;
}

/**
 * Creates the gist. Secret rather than public — though "secret" means unlisted,
 * not access-controlled, which is precisely why the payload is encrypted.
 */
export async function createVault(token, envelope) {
  const gist = await call(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: 'Property Expenses — encrypted vault',
      public: false,
      files: filesFor(envelope),
    }),
  });
  return { gistId: gist.id, version: versionOf(gist), url: gist.html_url };
}

export async function writeVault(token, gistId, envelope) {
  const gist = await call(token, `/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: filesFor(envelope) }),
  });
  return { version: versionOf(gist), url: gist.html_url };
}

export async function readVault(token, gistId) {
  const gist = await call(token, `/gists/${gistId}`);
  return {
    envelope: parseEnvelope(await contentOf(gist)),
    version: versionOf(gist),
    url: gist.html_url,
  };
}

/**
 * One earlier revision, by version id. This is how the ancestor for a
 * three-way merge is fetched — and how a bad overwrite is recovered.
 */
export async function readRevision(token, gistId, version) {
  const gist = await call(token, `/gists/${gistId}/${version}`);
  return { envelope: parseEnvelope(await contentOf(gist)), version };
}

/** Just the head revision id, for the check before a push. */
export async function remoteVersion(token, gistId) {
  return versionOf(await call(token, `/gists/${gistId}`));
}
