/**
 * The tab icon.
 *
 * It has to be a static file — a bookmark, a history entry and a half-loaded
 * tab all want an icon before any script has run — which means the house path
 * now exists in two places. Nothing at runtime couples them, so this is what
 * notices if the icon bank is redrawn and the favicon is left behind.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { iconByKey } from '../src/icons.js';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
const favicon = read('favicon.svg');
const indexHtml = read('index.html');

/**
 * Path data reduced to its geometry, so formatting is not what is being
 * tested: every command letter is isolated and runs of space collapsed, which
 * makes "Z M10.25" and "ZM10.25" compare equal without merging two numbers
 * into one the way stripping all whitespace would.
 */
const normalise = (d) =>
  d
    .replace(/([A-Za-z])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

describe('favicon.svg', () => {
  it('draws the same house as the app’s icon bank', () => {
    const house = iconByKey('property', 'house');
    const drawn = favicon.match(/\sd="([^"]+)"/)?.[1];
    assert.ok(drawn, 'no path data in favicon.svg');
    assert.equal(normalise(drawn), normalise(house.d));
  });

  it('keeps the fill-rule, or the windows and doorway fill themselves in', () => {
    assert.match(favicon, /fill-rule="evenodd"/);
    assert.equal(iconByKey('property', 'house').rule, 'evenodd');
  });

  it('uses both steps of the red palette slot', () => {
    // Browser chrome is a surface like any other: the light-mode red muddies
    // against a dark one, which is why each slot has two steps to begin with.
    const styles = read('src/styles.css');
    const light = styles.match(/^\.slot-red \{ --entity: (#[0-9a-f]{6}); \}/m)?.[1];
    const dark = styles.match(/^\s+\.slot-red \{ --entity: (#[0-9a-f]{6}); \}/m)?.[1];
    assert.ok(light && dark && light !== dark, 'could not read both red steps from styles.css');
    assert.ok(favicon.includes(light), `favicon does not use the light red ${light}`);
    assert.ok(favicon.includes(dark), `favicon does not use the dark red ${dark}`);
    assert.match(favicon, /prefers-color-scheme: dark/);
  });

  it('carries a viewBox, so it scales to whatever size the browser asks for', () => {
    assert.match(favicon, /viewBox="0 0 24 24"/);
  });
});

describe('index.html', () => {
  it('links the favicon', () => {
    assert.match(indexHtml, /<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg" \/>/);
  });

  it('links it relatively, so a repo-subpath deploy still finds it', () => {
    // Every other asset here is relative for the same reason; an absolute
    // "/favicon.svg" would 404 on GitHub Pages under /PropertyExpensesV2/.
    const href = indexHtml.match(/rel="icon"[^>]*href="([^"]+)"/)?.[1];
    assert.ok(href?.startsWith('./'), `expected a relative href, got ${href}`);
  });
});

describe('the deploy', () => {
  it('ships every root-level file index.html asks for', () => {
    // The workflow copies named files rather than the whole repo, to keep
    // tests and docs out of the deploy — which means adding an asset to
    // index.html and forgetting the workflow gives a live site that 404s for
    // something that works perfectly on localhost. Exactly how the favicon was
    // nearly shipped broken.
    const workflow = read('.github/workflows/deploy.yml');
    const referenced = [...indexHtml.matchAll(/(?:href|src)="\.\/([^"/]+)"/g)].map((m) => m[1]);
    assert.ok(referenced.length > 0, 'no root-level assets found in index.html');
    for (const file of referenced) {
      assert.ok(workflow.includes(file), `deploy.yml does not copy ${file}`);
    }
  });
});
